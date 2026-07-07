const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games';

interface ESPNCookies {
  espnS2: string;
  swid: string;
}

function espnHeaders(cookies?: ESPNCookies): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cookies?.espnS2 && cookies?.swid) {
    headers.Cookie = `espn_s2=${cookies.espnS2}; SWID=${cookies.swid}`;
  }
  return headers;
}

async function espnFetch<T>(
  url: string,
  cookies?: ESPNCookies,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const res = await fetch(url, {
    headers: { ...espnHeaders(cookies), ...extraHeaders },
  });
  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`);
  return res.json() as Promise<T>;
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
  Sport,
  TransactionResult,
} from '../../types/index.js';
import { SPORT_CONFIG } from '../../types/index.js';
import type { FantasyPlatformAdapter } from './types.js';

export class ESPNAdapter implements FantasyPlatformAdapter {
  readonly platform = 'espn' as const;
  readonly sport: Sport;
  private readonly gameCode: string;

  constructor(sport: Sport = 'nfl') {
    this.sport = sport;
    const code = SPORT_CONFIG[sport].espnGameCode;
    if (!code) throw new Error(`ESPN fantasy does not support ${sport}`);
    this.gameCode = code;
  }

  private base(season: number): string {
    return `${ESPN_BASE}/${this.gameCode}/seasons/${season}/segments/0/leagues`;
  }

  private cookies(credentials: PlatformCredentials): ESPNCookies | undefined {
    if (credentials.espnS2 && credentials.swid) {
      return { espnS2: credentials.espnS2, swid: credentials.swid };
    }
    return undefined;
  }

  async connect(credentials: PlatformCredentials): Promise<ConnectedAccount> {
    if (!credentials.espnS2 || !credentials.swid) {
      throw new Error('ESPN espn_s2 and SWID cookies are required for private leagues');
    }
    return {
      platform: 'espn',
      externalUserId: credentials.swid,
      credentials,
    };
  }

  async getLeagues(account: ConnectedAccount): Promise<LeagueSummary[]> {
    const season = new Date().getFullYear();
    const cookies = this.cookies(account.credentials);
    if (!account.credentials.leagueId) {
      throw new Error('ESPN leagueId is required in credentials');
    }

    const leagueUrl = `${this.base(season)}/${account.credentials.leagueId}?view=mTeam&view=mSettings`;
    const league = await espnFetch<{
      id: number;
      settings?: { name?: string };
      teams?: Array<{
        id: number;
        location?: string;
        nickname?: string;
        primaryOwner?: string;
      }>;
    }>(leagueUrl, cookies);

    return (league.teams ?? []).map((t) => ({
      externalLeagueId: String(league.id),
      externalTeamId: String(t.id),
      leagueName: league.settings?.name ?? 'ESPN League',
      teamName: [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`,
      season,
      sport: this.sport,
    }));
  }

  async getTeamRoster(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string
  ) {
    const season = new Date().getFullYear();
    const cookies = this.cookies(account.credentials);
    const url = `${this.base(season)}/${leagueId}?view=mRoster&view=mSettings`;
    const data = await espnFetch<{
      settings?: {
        scoringSettings?: { scoringItems?: Array<{ statId: number; points?: number }> };
        rosterSettings?: { lineupSlotCounts?: Record<string, number> };
        size?: number;
      };
      teams?: Array<{
        id: number;
        roster?: {
          entries?: Array<{
            playerId: number;
            lineupSlotId: number;
            playerPoolEntry?: {
              player?: {
                fullName?: string;
                defaultPositionId?: number;
                proTeamId?: number;
                injuryStatus?: string;
              };
            };
          }>;
        };
      }>;
    }>(url, cookies);

    const posMap: Record<number, string> = {
      1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF',
    };
    const slotIdToName: Record<number, string> = {
      0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'DEF', 17: 'K', 20: 'FLEX', 21: 'IR', 23: 'FLEX',
    };
    const slotStarter = new Set([0, 2, 4, 6, 16, 17, 20, 21, 23]);

    const team = data.teams?.find((t) => String(t.id) === teamId);
    const entries = team?.roster?.entries ?? [];

    const starters: PlayerEntry[] = [];
    const bench: PlayerEntry[] = [];
    const ir: PlayerEntry[] = [];

    for (const e of entries) {
      const p = e.playerPoolEntry?.player;
      const entry: PlayerEntry = {
        playerId: String(e.playerId),
        name: p?.fullName ?? `Player ${e.playerId}`,
        position: posMap[p?.defaultPositionId ?? 0] ?? 'FLEX',
        injuryStatus: p?.injuryStatus,
        lineupSlot: slotIdToName[e.lineupSlotId],
      };
      if (e.lineupSlotId === 21) ir.push(entry);
      else if (slotStarter.has(e.lineupSlotId)) starters.push(entry);
      else bench.push(entry);
    }

    const recPoints =
      data.settings?.scoringSettings?.scoringItems?.find((s) => s.statId === 53)?.points ?? 1;
    const scoringFormat =
      recPoints >= 1 ? 'ppr' : recPoints >= 0.5 ? 'half_ppr' : 'standard';

    const settings: LeagueSettings = {
      scoringFormat,
      rosterSlots: data.settings?.rosterSettings?.lineupSlotCounts ?? {},
      waiverType: 'rolling',
      numTeams: data.settings?.size ?? 12,
    };

    return {
      roster: { starters, bench, ir },
      settings,
      raw: data as Record<string, unknown>,
    };
  }

  async getFreeAgents(
    account: ConnectedAccount,
    leagueId: string,
    filters?: FAFilter
  ): Promise<PlayerEntry[]> {
    const season = new Date().getFullYear();
    const cookies = this.cookies(account.credentials);
    const filter = {
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        limit: filters?.limit ?? 50,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    };
    const url = `${this.base(season)}/${leagueId}?view=kona_player_info`;
    const data = await espnFetch<{
      players?: Array<{
        id: number;
        fullName?: string;
        defaultPositionId?: number;
        injuryStatus?: string;
      }>;
    }>(url, cookies, { 'x-fantasy-filter': JSON.stringify(filter) });

    const posMap: Record<number, string> = {
      1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF',
    };

    return (data.players ?? [])
      .map((p) => ({
        playerId: String(p.id),
        name: p.fullName ?? `Player ${p.id}`,
        position: posMap[p.defaultPositionId ?? 0] ?? 'FLEX',
        injuryStatus: p.injuryStatus,
      }))
      .filter((p) => !filters?.position || p.position === filters.position);
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
    account: ConnectedAccount,
    leagueId: string,
    _teamId: string,
    addPlayerId: string,
    dropPlayerId: string
  ): Promise<TransactionResult> {
    const season = new Date().getFullYear();
    return {
      success: false,
      message: 'ESPN has no official write API. Complete the swap in the ESPN app.',
      deepLink: `https://fantasy.espn.com/football/team?leagueId=${leagueId}&seasonId=${season}&add=${addPlayerId}&drop=${dropPlayerId}`,
    };
  }

  async submitLineupChange(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    changes: import('../../types/index.js').LineupChange[]
  ): Promise<TransactionResult> {
    const cookies = this.cookies(account.credentials);
    if (!cookies) {
      return {
        success: false,
        message: 'ESPN cookies required for lineup writes.',
      };
    }

    const season = new Date().getFullYear();
    const { roster } = await this.getTeamRoster(account, leagueId, teamId);
    const slotNameToId: Record<string, number> = {
      QB: 0, RB: 2, WR: 4, TE: 6, FLEX: 20, K: 17, DEF: 16, IR: 21,
    };

    const entries = [
      ...roster.starters.map((p) => ({ ...p, isStarter: true })),
      ...roster.bench.map((p) => ({ ...p, isStarter: false })),
      ...(roster.ir ?? []).map((p) => ({ ...p, isStarter: false })),
    ];

    for (const change of changes) {
      const sit = entries.find((p) => p.playerId === change.playerId);
      const start = entries.find(
        (c) =>
          c.playerId !== change.playerId &&
          (changes.some((ch) => ch.playerId === c.playerId && ch.toSlot === change.fromSlot) ||
            change.toSlot === c.lineupSlot)
      );
      if (sit && start) {
        const sitSlot = sit.lineupSlot ?? sit.position;
        const startSlot = start.lineupSlot ?? start.position;
        sit.lineupSlot = startSlot;
        start.lineupSlot = sitSlot;
        sit.isStarter = startSlot !== 'BN' && startSlot !== 'IR';
        start.isStarter = sitSlot !== 'BN' && sitSlot !== 'IR';
      }
    }

    const payload = {
      rosterForCurrentScoringPeriod: {
        entries: entries.map((p) => ({
          playerId: parseInt(p.playerId, 10),
          lineupSlotId: slotNameToId[p.lineupSlot ?? (p.isStarter ? p.position : 'BN')] ?? 20,
        })),
      },
    };

    const url = `https://lm-api-writes.fantasy.espn.com/apis/v3/games/${this.gameCode}/seasons/${season}/segments/0/leagues/${leagueId}/teams/${teamId}/roster`;
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          ...espnHeaders(cookies),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          message: `ESPN lineup write failed (${res.status}): ${text.slice(0, 120)}`,
          deepLink: `https://fantasy.espn.com/football/team?leagueId=${leagueId}&seasonId=${season}`,
        };
      }
      return {
        success: true,
        message: 'Lineup updated on ESPN.',
        deepLink: `https://fantasy.espn.com/football/team?leagueId=${leagueId}&seasonId=${season}`,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message,
        deepLink: `https://fantasy.espn.com/football/team?leagueId=${leagueId}&seasonId=${season}`,
      };
    }
  }
}
