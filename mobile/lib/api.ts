import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string })?.apiUrl ??
  'http://localhost:5000';

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('auth_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  registerDeviceToken: (token: string, platform: 'ios' | 'android') =>
    request('/api/auth/device-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    }),
  getTeams: () => request<{ teams: Team[] }>('/api/teams'),
  getTeam: (id: string) => request<{ team: Team }>(`/api/teams/${id}`),
  discoverLeagues: (platform: Platform, credentials: PlatformCredentials, sport: Sport = 'nfl') =>
    request<{ leagues: LeagueSummary[] }>('/api/teams/discover', {
      method: 'POST',
      body: JSON.stringify({ platform, credentials, sport }),
    }),
  importTeams: (
    platform: Platform,
    credentials: PlatformCredentials,
    sport: Sport = 'nfl',
    selectedLeagues?: Array<{ externalLeagueId: string; externalTeamId: string }>
  ) =>
    request<{ teams: Team[] }>('/api/teams/import', {
      method: 'POST',
      body: JSON.stringify({ platform, credentials, sport, selectedLeagues }),
    }),
  syncTeam: (id: string) =>
    request<{ team: Team }>(`/api/teams/${id}/sync`, { method: 'POST' }),
  setOptIn: (id: string, agentOptIn: boolean) =>
    request<{ team: Team }>(`/api/teams/${id}/opt-in`, {
      method: 'PATCH',
      body: JSON.stringify({ agentOptIn }),
    }),
  getRecommendations: (params?: { week?: number; teamId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.week) q.set('week', String(params.week));
    if (params?.teamId) q.set('teamId', params.teamId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<{ recommendations: Recommendation[] }>(
      `/api/recommendations${qs ? `?${qs}` : ''}`
    );
  },
  saveConnection: (platform: Platform, credentials: PlatformCredentials) =>
    request(`/api/connections/${platform}`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    }),
  approveRecommendation: (id: string) =>
    request(`/api/recommendations/${id}/approve`, { method: 'POST' }),
  dismissRecommendation: (id: string) =>
    request(`/api/recommendations/${id}/dismiss`, { method: 'POST' }),
  analyzeLineup: (teamId: string) =>
    request<{ recommendations: Recommendation[] }>(`/api/lineup/${teamId}/analyze-lineup`, {
      method: 'POST',
    }),
};

export type Platform = 'sleeper' | 'espn' | 'yahoo';

export type Sport = 'nfl' | 'nba' | 'mlb' | 'nhl';

export const SPORT_LABELS: Record<Sport, string> = {
  nfl: 'Football',
  nba: 'Basketball',
  mlb: 'Baseball',
  nhl: 'Hockey',
};

export interface PlatformCredentials {
  username?: string;
  leagueId?: string;
  espnS2?: string;
  swid?: string;
  accessToken?: string;
}

export interface LeagueSummary {
  externalLeagueId: string;
  externalTeamId: string;
  leagueName: string;
  teamName: string;
  season: number;
  sport: Sport;
}

export interface Team {
  _id: string;
  platform: Platform;
  sport: Sport;
  leagueName: string;
  teamName: string;
  agentOptIn: boolean;
  roster?: {
    starters: Array<{ playerId: string; name: string; position: string }>;
    bench: Array<{ playerId: string; name: string; position: string }>;
  };
}

export interface Recommendation {
  _id: string;
  kind?: 'add_drop' | 'lineup_sit_start' | 'lineup_flex_move';
  week: number;
  confidence: number;
  rationale: string[];
  status: string;
  dropPlayer?: { playerId: string; name: string; position: string; reasonTags?: string[] };
  addPlayer?: { playerId: string; name: string; position: string; reasonTags?: string[] };
  lineupAction?: {
    sitPlayer?: { playerId: string; name: string; position: string };
    startPlayer?: { playerId: string; name: string; position: string };
    movePlayer?: { playerId: string; name: string; position: string };
    fromSlot?: string;
    toSlot?: string;
    freesSlot?: string;
  };
  newsSnippets?: Array<{ headline: string; source: string; url?: string }>;
  teamId: Team | string;
  executionResult?: { success: boolean; message: string; deepLink?: string };
}

export { API_URL };
