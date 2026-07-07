const SLEEPER_BASE = 'https://api.sleeper.app/v1';

async function sleeperFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status} ${path}`);
  return res.json() as Promise<T>;
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
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  reserve?: string[];
  settings?: { fpts?: number; fpts_against?: number };
}

interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  settings?: { waiver_type?: number };
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
  };
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
    const username = credentials.username?.trim();
    if (!username) throw new Error('Sleeper username is required');
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
    const allIds = roster.players ?? [];
    const rosterPositions = league.roster_positions ?? [];

    const starters: PlayerEntry[] = [];
    const bench: PlayerEntry[] = [];
    const ir: PlayerEntry[] = [];

    for (let i = 0; i < (roster.starters ?? []).length; i++) {
      const id = roster.starters![i];
      const entry = resolvePlayer(id, playersMap);
      const slotRaw = rosterPositions[i] ?? entry.position;
      entry.lineupSlot = slotRaw === 'BN' ? entry.position : slotRaw;
      starters.push(entry);
    }

    for (const id of allIds) {
      if (starterSet.has(id) || reserveSet.has(id)) continue;
      bench.push(resolvePlayer(id, playersMap));
    }

    for (const id of roster.reserve ?? []) {
      ir.push(resolvePlayer(id, playersMap));
    }

    const settings: LeagueSettings = {
      scoringFormat: inferScoring(league.scoring_settings),
      rosterSlots: buildRosterSlots(league.roster_positions),
      waiverType: league.settings?.waiver_type === 0 ? 'none' : 'rolling',
      numTeams: league.total_rosters,
    };

    return {
      roster: { starters, bench, ir },
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
    const all = [...roster.starters, ...roster.bench, ...(roster.ir ?? [])];
    return all.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      pointsLast3Weeks: [p.fantasyPoints?.week ?? 0, 0, 0],
      avgPoints: p.fantasyPoints?.week ?? 0,
    }));
  }

  async submitAddDrop(
    _account: ConnectedAccount,
    leagueId: string,
    _teamId: string,
    addPlayerId: string,
    dropPlayerId: string
  ): Promise<TransactionResult> {
    return {
      success: false,
      message: 'Sleeper does not expose a public write API. Open Sleeper to complete the swap.',
      deepLink: `sleeper://league/${leagueId}?add=${addPlayerId}&drop=${dropPlayerId}`,
    };
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

    const mutation = `
      mutation UpdateRosterStarters($leagueId: String!, $rosterId: Int!, $starters: [String!]!) {
        update_roster_starters(league_id: $leagueId, roster_id: $rosterId, starters: $starters) {
          roster_id
          starters
        }
      }
    `;

    try {
      const res = await fetch('https://api.sleeper.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            leagueId,
            rosterId: parseInt(teamId, 10),
            starters: starterIds,
          },
        }),
      });
      const data = (await res.json()) as {
        data?: { update_roster_starters?: { roster_id: number } };
        errors?: Array<{ message: string }>;
      };
      if (!res.ok || data.errors?.length) {
        return {
          success: false,
          message:
            data.errors?.[0]?.message ??
            `Sleeper lineup update failed (${res.status}). Open Sleeper to complete.`,
          deepLink: `sleeper://league/${leagueId}`,
        };
      }
      return {
        success: true,
        message: 'Lineup updated on Sleeper.',
        deepLink: `sleeper://league/${leagueId}`,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message,
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
