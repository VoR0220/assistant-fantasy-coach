import Constants from 'expo-constants';
import { getAuthToken } from './storage';

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string })?.apiUrl ??
  'http://localhost:5000';

async function getToken(): Promise<string | null> {
  return getAuthToken();
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
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Request failed: ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(formatApiError(data, res.status));
  }
  return data as T;
}

function formatApiError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const payload = data as { error?: string; errors?: Array<{ msg?: string; path?: string }> };
    if (payload.error) return payload.error;
    const first = payload.errors?.[0];
    if (first?.path === 'password') return 'Password must be at least 6 characters.';
    if (first?.path === 'email') return 'Enter a valid email address.';
    if (first?.msg) return first.msg;
  }
  return `Request failed (${status})`;
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
  getTeam: (id: string) => request<{ team: Team; compliance?: RosterCompliance }>(`/api/teams/${id}`),
  discoverLeagues: (platform: Platform, credentials?: PlatformCredentials, sport: Sport = 'nfl') =>
    request<{ leagues: LeagueSummary[] }>('/api/teams/discover', {
      method: 'POST',
      body: JSON.stringify({ platform, credentials, sport }),
    }),
  importTeams: (
    platform: Platform,
    credentials?: PlatformCredentials,
    sport: Sport = 'nfl',
    selectedLeagues?: Array<{ externalLeagueId: string; externalTeamId: string }>
  ) =>
    request<{ teams: Team[] }>('/api/teams/import', {
      method: 'POST',
      body: JSON.stringify({ platform, credentials, sport, selectedLeagues }),
    }),
  getConnections: () =>
    request<{ connections: Array<{ platform: Platform; externalUserId: string; connectedAt: string }> }>(
      '/api/connections'
    ),
  getYahooOAuthUrl: () => request<{ url: string }>('/api/connections/yahoo/oauth/url'),
  syncTeam: (id: string) =>
    request<{ team: Team; compliance?: RosterCompliance }>(`/api/teams/${id}/sync`, { method: 'POST' }),
  runAgent: (id: string) =>
    request<{ teamId: string; recommendationIds: string[]; skipped: boolean; compliance?: RosterCompliance }>(
      `/api/teams/${id}/run-agent`,
      { method: 'POST' }
    ),
  setOptIn: (id: string, agentOptIn: boolean) =>
    request<{ team: Team }>(`/api/teams/${id}/opt-in`, {
      method: 'PATCH',
      body: JSON.stringify({ agentOptIn }),
    }),
  setAutoPilot: (id: string, autoPilot: boolean) =>
    request<{ team: Team }>(`/api/teams/${id}/auto-pilot`, {
      method: 'PATCH',
      body: JSON.stringify({ autoPilot }),
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
  getRecommendation: (id: string) =>
    request<{ recommendation: Recommendation }>(`/api/recommendations/${id}`),
  saveConnection: (platform: Platform, credentials: PlatformCredentials) =>
    request(`/api/connections/${platform}`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    }),
  approveRecommendation: (id: string, body?: { selectedDropPlayerId?: string }) =>
    request(`/api/recommendations/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  dismissRecommendation: (id: string) =>
    request(`/api/recommendations/${id}/dismiss`, { method: 'POST' }),
  analyzeLineup: (teamId: string) =>
    request<{
      recommendations: Recommendation[];
      recommendationIds: string[];
      team?: Team;
      compliance?: RosterCompliance;
    }>(`/api/lineup/${teamId}/analyze-lineup`, { method: 'POST' }),
  runBacktest: (
    teamId: string,
    body?: {
      season?: number;
      startWeek?: number;
      endWeek?: number;
      lookbackHours?: number;
      synthesize?: boolean;
    }
  ) =>
    request<{
      backtestId: string;
      season: number;
      summary: {
        weeks: number;
        weeksWithNews: number;
        swapsApplied: number;
        totalDelta: number;
        avgDelta: number;
        wins: number;
        losses: number;
      };
      trainedTagWeights: Record<string, number>;
      note?: string;
      weeks: unknown[];
    }>(`/api/teams/${teamId}/backtest`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  getBacktests: (teamId: string) =>
    request<{ backtests: unknown[] }>(`/api/teams/${teamId}/backtests`),
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
  email?: string;
  password?: string;
  userId?: string;
  sleeperToken?: string;
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

export interface RosterCompliance {
  countable: number;
  maxSize: number;
  overBy: number;
  taxiCount: number;
  taxiSlots: number;
}

export interface Team {
  _id: string;
  platform: Platform;
  sport: Sport;
  leagueName: string;
  teamName: string;
  agentOptIn: boolean;
  autoPilot?: boolean;
  roster?: {
    starters: Array<{ playerId: string; name: string; position: string; injuryStatus?: string }>;
    bench: Array<{ playerId: string; name: string; position: string; injuryStatus?: string }>;
    taxi?: Array<{ playerId: string; name: string; position: string; yearsExp?: number }>;
  };
}

export interface Recommendation {
  _id: string;
  kind?: 'add_drop' | 'lineup_sit_start' | 'lineup_flex_move' | 'roster_drop' | 'move_to_taxi';
  week: number;
  confidence: number;
  status: string;
  dropPlayer?: { playerId: string; name: string; position: string; reasonTags?: string[] };
  /** Equal drop choices — pick one via radio before approving */
  dropAlternatives?: Array<{ playerId: string; name: string; position: string; reasonTags?: string[] }>;
  addPlayer?: { playerId: string; name: string; position: string; reasonTags?: string[] };
  lineupAction?: {
    sitPlayer?: { playerId: string; name: string; position: string };
    startPlayer?: { playerId: string; name: string; position: string };
    movePlayer?: { playerId: string; name: string; position: string };
    fromSlot?: string;
    toSlot?: string;
    freesSlot?: string;
  };
  rationale: Array<
    | string
    | { text: string; source: string; url?: string; sourceKind?: string }
  >;
  newsSnippets?: Array<{ headline: string; source: string; url?: string }>;
  teamId: Team | string;
  executionResult?: { success: boolean; message: string; deepLink?: string };
}

export { API_URL };
