const SLEEPER_BASE = 'https://api.sleeper.app/v1';
/** Private GraphQL endpoint used by Sleeper's own web/mobile apps (unofficial). */
const SLEEPER_GRAPHQL = 'https://sleeper.com/graphql';

async function sleeperFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

interface SleeperGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function sleeperGraphQL<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Sleeper-GraphQL-Op': operationName,
  };
  // Sleeper uses the raw token string, no "Bearer" prefix.
  if (token) headers.Authorization = token;

  const res = await fetch(SLEEPER_GRAPHQL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operationName, variables, query }),
  });
  const payload = (await res.json().catch(() => null)) as SleeperGraphQLResponse<T> | null;
  if (!res.ok || !payload) {
    throw new Error(`Sleeper GraphQL error: HTTP ${res.status}`);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message);
  }
  if (!payload.data) throw new Error('Sleeper GraphQL returned no data');
  return payload.data;
}

export interface SleeperLoginResult {
  token: string;
  userId: string;
  displayName?: string;
  email?: string;
}

/**
 * Log in with Sleeper credentials via the private GraphQL `login_query`.
 * Returns the auth token Sleeper's own apps use for writes (lineup changes etc).
 * The password is forwarded to Sleeper only and never stored.
 */
export async function sleeperLogin(
  identifier: string,
  password: string
): Promise<SleeperLoginResult> {
  const query = `query login_query($email_or_phone_or_username: String!, $password: String, $captcha: String) {
  login(email_or_phone_or_username: $email_or_phone_or_username, password: $password, captcha: $captcha) {
    token
    user_id
    display_name
    email
  }
}`;
  try {
    const data = await sleeperGraphQL<{
      login: { token: string; user_id: string; display_name?: string; email?: string };
    }>('login_query', query, {
      email_or_phone_or_username: identifier,
      password,
      captcha: null,
    });
    if (!data.login?.token) throw new Error('Sleeper login did not return a token');
    return {
      token: data.login.token,
      userId: data.login.user_id,
      displayName: data.login.display_name,
      email: data.login.email,
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (/captcha/i.test(msg)) {
      throw new Error(
        'Sleeper is asking for a captcha. Sign in at sleeper.com once, then retry — or use username-only mode.'
      );
    }
    if (/password|credential|invalid|unauthorized/i.test(msg)) {
      throw new Error('Sleeper sign-in failed: check your email/username and password.');
    }
    throw new Error(`Sleeper sign-in failed: ${msg}`);
  }
}

interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  injury_status?: string | null;
  fantasy_positions?: string[];
  years_exp?: number;
  status?: string | null;
  active?: boolean;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  reserve?: string[];
  taxi?: string[];
  settings?: { fpts?: number; fpts_against?: number };
}

interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  settings?: {
    waiver_type?: number;
    taxi_slots?: number;
    taxi_years?: number;
    taxi_deadline?: number;
  };
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
}

interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
}

const playersCaches: Record<string, { map: Record<string, SleeperPlayer>; at: number }> = {};
const PLAYERS_TTL = 1000 * 60 * 60 * 6;

async function getPlayersMap(sportKey = 'nfl'): Promise<Record<string, SleeperPlayer>> {
  const cached = playersCaches[sportKey];
  if (cached && Date.now() - cached.at < PLAYERS_TTL) return cached.map;
  const map = await sleeperFetch<Record<string, SleeperPlayer>>(`/players/${sportKey}`);
  playersCaches[sportKey] = { map, at: Date.now() };
  return map;
}

function resolvePlayer(id: string, map: Record<string, SleeperPlayer>): import('../../types/index.js').PlayerEntry {
  const p = map[id];
  const name =
    p?.full_name ??
    [p?.first_name, p?.last_name].filter(Boolean).join(' ') ??
    `Player ${id}`;
  return {
    playerId: id,
    name,
    position: p?.position ?? p?.fantasy_positions?.[0] ?? 'UNKNOWN',
    team: p?.team ?? undefined,
    injuryStatus: p?.injury_status ?? undefined,
    yearsExp: p?.years_exp,
    playerStatus: p?.status ?? undefined,
    active: p?.active,
  };
}

function buildRosterLimits(positions?: string[]): {
  maxRosterSize: number;
  benchSlots: number;
  irSlots: number;
} {
  const rp = positions ?? [];
  const benchSlots = rp.filter((p) => p === 'BN').length;
  const irSlots = rp.filter((p) => p === 'IR').length;
  const starterSlots = rp.filter((p) => p !== 'BN' && p !== 'IR').length;
  return { maxRosterSize: starterSlots + benchSlots + irSlots, benchSlots, irSlots };
}

function inferScoring(settings?: Record<string, number>): 'ppr' | 'half_ppr' | 'standard' {
  const rec = settings?.rec ?? 0;
  if (rec >= 1) return 'ppr';
  if (rec >= 0.5) return 'half_ppr';
  return 'standard';
}

function buildRosterSlots(positions?: string[]): Record<string, number> {
  const slots: Record<string, number> = {};
  for (const pos of positions ?? []) {
    if (pos === 'BN' || pos === 'IR') continue;
    slots[pos] = (slots[pos] ?? 0) + 1;
  }
  return slots;
}

import type {
  ConnectedAccount,
  FAFilter,
  LeagueSettings,
  LeagueSummary,
  NormalizedRoster,
  PlatformCredentials,
  PlayerEntry,
  PlayerWeekStats,
  TransactionResult,
} from '../../types/index.js';
import type { Sport } from '../../types/index.js';
import { SPORT_CONFIG } from '../../types/index.js';
import type { FantasyPlatformAdapter } from './types.js';

export class SleeperAdapter implements FantasyPlatformAdapter {
  readonly platform = 'sleeper' as const;
  readonly sport: Sport;
  private readonly sportKey: string;

  constructor(sport: Sport = 'nfl') {
    this.sport = sport;
    const key = SPORT_CONFIG[sport].sleeperKey;
    if (!key) throw new Error(`Sleeper does not support ${sport}`);
    this.sportKey = key;
  }

  async connect(credentials: PlatformCredentials): Promise<ConnectedAccount> {
    // Path A: a token already captured by the in-app Sleeper login WebView.
    // Trust it for writes; resolve the username from the public user endpoint.
    const capturedToken = credentials.sleeperToken?.trim();
    if (capturedToken) {
      const userId = credentials.userId?.trim();
      const user = userId
        ? await sleeperFetch<SleeperUser>(`/user/${userId}`).catch(() => null)
        : null;
      if (!userId && !user) {
        throw new Error('Sleeper token capture is missing a user id.');
      }
      return {
        platform: 'sleeper',
        externalUserId: user?.user_id ?? userId!,
        credentials: {
          username: user?.username,
          userId: user?.user_id ?? userId,
          sleeperToken: capturedToken,
        },
      };
    }

    // Path B: full sign-in with email/username + password, which yields the
    // auth token Sleeper's own apps use for writes (lineup changes, etc).
    const password = credentials.password?.trim();
    const identifier = (credentials.username ?? credentials.email)?.trim();

    if (password && identifier) {
      const login = await sleeperLogin(identifier, password);
      const user = await sleeperFetch<SleeperUser>(`/user/${login.userId}`);
      return {
        platform: 'sleeper',
        externalUserId: login.userId,
        credentials: {
          username: user.username,
          userId: login.userId,
          // Token used by submitLineupChange; never expose the password again.
          sleeperToken: login.token,
        },
      };
    }

    // Fallback: username-only (read-only). Writes will require the user to
    // sign in with a password later to obtain a token.
    const username = credentials.username?.trim();
    if (!username) throw new Error('Sleeper username (or email + password) is required');
    const user = await sleeperFetch<SleeperUser>(`/user/${username}`);
    return {
      platform: 'sleeper',
      externalUserId: user.user_id,
      credentials: { username, userId: user.user_id },
    };
  }

  async getLeagues(account: ConnectedAccount): Promise<LeagueSummary[]> {
    const season = new Date().getFullYear();
    const leagues = await sleeperFetch<SleeperLeague[]>(
      `/user/${account.externalUserId}/leagues/${this.sportKey}/${season}`
    );
    const rostersByLeague = await Promise.all(
      leagues.map(async (league) => {
        const rosters = await sleeperFetch<SleeperRoster[]>(`/league/${league.league_id}/rosters`);
        const users = await sleeperFetch<SleeperUser[]>(`/league/${league.league_id}/users`);
        return { league, rosters, users };
      })
    );

    const summaries: LeagueSummary[] = [];
    for (const { league, rosters, users } of rostersByLeague) {
      const userRoster = rosters.find((r) => r.owner_id === account.externalUserId);
      if (!userRoster) continue;
      const owner = users.find((u) => u.user_id === account.externalUserId);
      summaries.push({
        externalLeagueId: league.league_id,
        externalTeamId: String(userRoster.roster_id),
        leagueName: league.name,
        teamName: owner?.display_name ?? owner?.username ?? 'My Team',
        season: parseInt(league.season, 10),
        sport: this.sport,
      });
    }
    return summaries;
  }

  async getTeamRoster(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string
  ) {
    const [league, rosters, playersMap] = await Promise.all([
      sleeperFetch<SleeperLeague>(`/league/${leagueId}`),
      sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),
      getPlayersMap(this.sportKey),
    ]);

    const roster = rosters.find((r) => String(r.roster_id) === teamId);
    if (!roster) throw new Error(`Roster ${teamId} not found in league ${leagueId}`);

    const starterSet = new Set(roster.starters ?? []);
    const reserveSet = new Set(roster.reserve ?? []);
    const taxiSet = new Set(roster.taxi ?? []);
    const allIds = roster.players ?? [];
    const rosterPositions = league.roster_positions ?? [];

    const starters: PlayerEntry[] = [];
    const bench: PlayerEntry[] = [];
    const ir: PlayerEntry[] = [];
    const taxi: PlayerEntry[] = [];

    for (let i = 0; i < (roster.starters ?? []).length; i++) {
      const id = roster.starters![i];
      const entry = resolvePlayer(id, playersMap);
      const slotRaw = rosterPositions[i] ?? entry.position;
      entry.lineupSlot = slotRaw === 'BN' ? entry.position : slotRaw;
      starters.push(entry);
    }

    for (const id of roster.taxi ?? []) {
      const entry = resolvePlayer(id, playersMap);
      entry.lineupSlot = 'TAXI';
      taxi.push(entry);
    }

    for (const id of allIds) {
      if (starterSet.has(id) || reserveSet.has(id) || taxiSet.has(id)) continue;
      bench.push(resolvePlayer(id, playersMap));
    }

    for (const id of roster.reserve ?? []) {
      ir.push(resolvePlayer(id, playersMap));
    }

    const limits = buildRosterLimits(league.roster_positions);
    const settings: LeagueSettings = {
      scoringFormat: inferScoring(league.scoring_settings),
      rosterSlots: buildRosterSlots(league.roster_positions),
      waiverType: league.settings?.waiver_type === 0 ? 'none' : 'rolling',
      numTeams: league.total_rosters,
      maxRosterSize: limits.maxRosterSize,
      benchSlots: limits.benchSlots,
      irSlots: limits.irSlots,
      taxiSlots: league.settings?.taxi_slots ?? 0,
      taxiYears: league.settings?.taxi_years,
    };

    return {
      roster: { starters, bench, ir, taxi },
      settings,
      raw: { league, roster },
    };
  }

  async getFreeAgents(
    account: ConnectedAccount,
    leagueId: string,
    filters?: FAFilter
  ): Promise<PlayerEntry[]> {
    const [rosters, playersMap] = await Promise.all([
      sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),
      getPlayersMap(this.sportKey),
    ]);

    const owned = new Set<string>();
    for (const r of rosters) {
      for (const id of r.players ?? []) owned.add(id);
    }

    const trending = await sleeperFetch<Array<{ player_id: string; count: number }>>(
      `/players/${this.sportKey}/trending/add?lookback_hours=72&limit=${filters?.limit ?? 100}`
    );

    const freeAgents: PlayerEntry[] = [];
    for (const t of trending) {
      if (owned.has(t.player_id)) continue;
      const entry = resolvePlayer(t.player_id, playersMap);
      if (filters?.position && entry.position !== filters.position) continue;
      if (!entry.team) continue;
      freeAgents.push(entry);
    }

    if (freeAgents.length < (filters?.limit ?? 25)) {
      for (const [id, p] of Object.entries(playersMap)) {
        if (owned.has(id)) continue;
        if (!p.team || p.position === 'DEF') continue;
        if (filters?.position && p.position !== filters.position) continue;
        freeAgents.push(resolvePlayer(id, playersMap));
        if (freeAgents.length >= (filters?.limit ?? 50)) break;
      }
    }

    return freeAgents.slice(0, filters?.limit ?? 50);
  }

  async getRecentPerformance(
    _account: ConnectedAccount,
    _leagueId: string,
    roster: NormalizedRoster
  ): Promise<PlayerWeekStats[]> {
    const all = [
      ...roster.starters,
      ...roster.bench,
      ...(roster.ir ?? []),
      ...(roster.taxi ?? []),
    ];
    return all.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      pointsLast3Weeks: [p.fantasyPoints?.week ?? 0, 0, 0],
      avgPoints: p.fantasyPoints?.week ?? 0,
    }));
  }

  async submitAddDrop(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    addPlayerId: string,
    dropPlayerId: string
  ): Promise<TransactionResult> {
    const token = account.credentials.sleeperToken;
    if (!token) {
      return {
        success: false,
        message: 'Sleeper add/drop requires full sign-in (sleeperToken). Open Sleeper to complete the swap.',
        deepLink: `sleeper://league/${leagueId}?add=${addPlayerId}&drop=${dropPlayerId}`,
      };
    }
    return this.createSleeperTransaction(token, leagueId, teamId, addPlayerId, dropPlayerId);
  }

  async submitDrop(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    dropPlayerId: string
  ): Promise<TransactionResult> {
    const token = account.credentials.sleeperToken;
    if (!token) {
      return {
        success: false,
        message: 'Sleeper drop requires full sign-in (sleeperToken). Open Sleeper to drop the player.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    }
    return this.createSleeperTransaction(token, leagueId, teamId, undefined, dropPlayerId);
  }

  async submitTaxiMove(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    playerId: string
  ): Promise<TransactionResult> {
    const token = account.credentials.sleeperToken;
    if (!token) {
      return {
        success: false,
        message: 'Moving to taxi requires full Sleeper sign-in (sleeperToken).',
        deepLink: `sleeper://league/${leagueId}`,
      };
    }

    const { roster } = await this.getTeamRoster(account, leagueId, teamId);
    const taxiIds = (roster.taxi ?? []).map((p) => p.playerId);
    if (taxiIds.includes(playerId)) {
      return { success: true, message: 'Player is already on your taxi squad.' };
    }
    if (!roster.bench.some((p) => p.playerId === playerId)) {
      return {
        success: false,
        message: 'Only bench players can be moved to taxi. Adjust your lineup in Sleeper first.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    }

    const mutation = `mutation roster_update_taxi($league_id: String!, $roster_id: Int!, $taxi: [String!]!) {
  roster_update_taxi(league_id: $league_id, roster_id: $roster_id, taxi: $taxi) {
    roster_id
    taxi
  }
}`;

    try {
      await sleeperGraphQL<{ roster_update_taxi: { roster_id: number } }>(
        'roster_update_taxi',
        mutation,
        {
          league_id: leagueId,
          roster_id: parseInt(teamId, 10),
          taxi: [...taxiIds, playerId],
        },
        token
      );
      return {
        success: true,
        message: 'Player moved to taxi squad on Sleeper.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message || 'Sleeper taxi move failed.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    }
  }

  private async createSleeperTransaction(
    token: string,
    leagueId: string,
    teamId: string,
    addPlayerId: string | undefined,
    dropPlayerId: string
  ): Promise<TransactionResult> {
    const rosterId = parseInt(teamId, 10);
    const mutation = `mutation league_create_transaction($league_id: String!, $type: String!, $k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]) {
  league_create_transaction(league_id: $league_id, type: $type, k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops) {
    transaction_id
    status
    type
  }
}`;

    const variables: Record<string, unknown> = {
      league_id: leagueId,
      type: 'free_agent',
      k_adds: addPlayerId ? [addPlayerId] : [],
      v_adds: addPlayerId ? [rosterId] : [],
      k_drops: [dropPlayerId],
      v_drops: [rosterId],
    };

    try {
      const data = await sleeperGraphQL<{ league_create_transaction: { transaction_id: string } }>(
        'league_create_transaction',
        mutation,
        variables,
        token
      );
      const label = addPlayerId ? 'Add/drop' : 'Drop';
      return {
        success: true,
        message: `${label} submitted on Sleeper (transaction ${data.league_create_transaction.transaction_id}).`,
        deepLink: `sleeper://league/${leagueId}`,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message || 'Sleeper transaction failed.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    }
  }

  async submitLineupChange(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    changes: import('../../types/index.js').LineupChange[]
  ): Promise<TransactionResult> {
    const token = account.credentials.sleeperToken;
    if (!token) {
      return {
        success: false,
        message: 'Sleeper lineup write requires sleeperToken. Open Sleeper to update your lineup.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    }

    const { roster } = await this.getTeamRoster(account, leagueId, teamId);
    const starterIds = roster.starters.map((p) => p.playerId);
    const benchIds = roster.bench.map((p) => p.playerId);

    for (const change of changes) {
      const sitIdx = starterIds.indexOf(change.playerId);
      const benchIdx = benchIds.indexOf(change.playerId);
      const replacement = changes.find(
        (c) => c.playerId !== change.playerId && c.toSlot === change.fromSlot
      );

      if (sitIdx >= 0 && replacement) {
        starterIds[sitIdx] = replacement.playerId;
        const repBenchIdx = benchIds.indexOf(replacement.playerId);
        if (repBenchIdx >= 0) benchIds[repBenchIdx] = change.playerId;
      } else if (benchIdx >= 0 && replacement) {
        const startIdx = starterIds.indexOf(replacement.playerId);
        if (startIdx >= 0) {
          starterIds[startIdx] = change.playerId;
          benchIds[benchIdx] = replacement.playerId;
        }
      }
    }

    // Matches Sleeper's own web/mobile app mutation captured from the client bundle.
    const mutation = `mutation roster_update_starters($league_id: String!, $roster_id: Int!, $starters: [String!]!) {
  roster_update_starters(league_id: $league_id, roster_id: $roster_id, starters: $starters) {
    roster_id
    starters
  }
}`;

    try {
      await sleeperGraphQL<{ roster_update_starters: { roster_id: number } }>(
        'roster_update_starters',
        mutation,
        {
          league_id: leagueId,
          roster_id: parseInt(teamId, 10),
          starters: starterIds,
        },
        token
      );
      return {
        success: true,
        message: 'Lineup updated on Sleeper.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    } catch (err) {
      return {
        success: false,
        message:
          (err as Error).message ||
          `Sleeper lineup update failed. Open Sleeper to complete.`,
        deepLink: `sleeper://league/${leagueId}`,
      };
    }
  }
}

export async function getSleeperTrending(
  type: 'add' | 'drop',
  lookbackHours = 24,
  limit = 25,
  sportKey = 'nfl'
) {
  return sleeperFetch<Array<{ player_id: string; count: number }>>(
    `/players/${sportKey}/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`
  );
}

export { getPlayersMap as getSleeperPlayersMap };
