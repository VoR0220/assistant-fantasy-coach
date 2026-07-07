const YAHOO_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

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

export class YahooAdapter implements FantasyPlatformAdapter {
  readonly platform = 'yahoo' as const;
  readonly sport: Sport;
  private readonly gameKey: string;

  constructor(sport: Sport = 'nfl') {
    this.sport = sport;
    const key = SPORT_CONFIG[sport].yahooGameKey;
    if (!key) throw new Error(`Yahoo fantasy does not support ${sport}`);
    this.gameKey = key;
  }

  private authHeader(credentials: PlatformCredentials): HeadersInit {
    if (!credentials.accessToken) throw new Error('Yahoo OAuth accessToken is required');
    return { Authorization: `Bearer ${credentials.accessToken}`, Accept: 'application/json' };
  }

  async connect(credentials: PlatformCredentials): Promise<ConnectedAccount> {
    if (!credentials.accessToken) throw new Error('Yahoo accessToken is required');
    const res = await fetch(`${YAHOO_BASE}/users;use_login=1`, {
      headers: this.authHeader(credentials),
    });
    if (!res.ok) throw new Error(`Yahoo auth failed: ${res.status}`);
    const text = await res.text();
    const guidMatch = text.match(/<guid>([^<]+)<\/guid>/);
    return {
      platform: 'yahoo',
      externalUserId: guidMatch?.[1] ?? 'yahoo-user',
      credentials,
    };
  }

  async getLeagues(account: ConnectedAccount): Promise<LeagueSummary[]> {
    const season = new Date().getFullYear();
    const res = await fetch(
      `${YAHOO_BASE}/users;use_login=1/games;game_keys=${this.gameKey}/leagues`,
      { headers: this.authHeader(account.credentials) }
    );
    if (!res.ok) throw new Error(`Yahoo leagues fetch failed: ${res.status}`);
    const text = await res.text();

    const summaries: LeagueSummary[] = [];
    const leagueRegex = /<league_key>([^<]+)<\/league_key>[\s\S]*?<name>([^<]+)<\/name>/g;
    let match;
    while ((match = leagueRegex.exec(text)) !== null) {
      const leagueKey = match[1];
      const leagueName = match[2];
      const teamRes = await fetch(
        `${YAHOO_BASE}/league/${leagueKey}/teams`,
        { headers: this.authHeader(account.credentials) }
      );
      const teamText = await teamRes.text();
      const teamMatch = teamText.match(
        /<team_key>([^<]+)<\/team_key>[\s\S]*?<name>([^<]+)<\/name>/
      );
      if (teamMatch) {
        summaries.push({
          externalLeagueId: leagueKey,
          externalTeamId: teamMatch[1],
          leagueName,
          teamName: teamMatch[2],
          season,
          sport: this.sport,
        });
      }
    }
    return summaries;
  }

  async getTeamRoster(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string
  ) {
    const res = await fetch(`${YAHOO_BASE}/team/${teamId}/roster`, {
      headers: this.authHeader(account.credentials),
    });
    if (!res.ok) throw new Error(`Yahoo roster fetch failed: ${res.status}`);
    const text = await res.text();

    const starters: PlayerEntry[] = [];
    const bench: PlayerEntry[] = [];
    const playerRegex =
      /<player_id>([^<]+)<\/player_id>[\s\S]*?<full>([^<]+)<\/full>[\s\S]*?<display_position>([^<]+)<\/display_position>[\s\S]*?(?:<selected_position>[\s\S]*?<position>([^<]+)<\/position>)?/g;
    let match;
    while ((match = playerRegex.exec(text)) !== null) {
      const entry: PlayerEntry = {
        playerId: match[1],
        name: match[2],
        position: match[3],
      };
      const slot = match[4] ?? 'BN';
      if (slot === 'BN' || slot === 'IR') bench.push(entry);
      else starters.push(entry);
    }

    const settings: LeagueSettings = {
      scoringFormat: 'ppr',
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
      waiverType: 'rolling',
      numTeams: 12,
    };

    return {
      roster: { starters, bench, ir: [] },
      settings,
      raw: { xml: text.slice(0, 5000) },
    };
  }

  async getFreeAgents(
    account: ConnectedAccount,
    leagueId: string,
    filters?: FAFilter
  ): Promise<PlayerEntry[]> {
    const res = await fetch(`${YAHOO_BASE}/league/${leagueId}/players;status=FA`, {
      headers: this.authHeader(account.credentials),
    });
    if (!res.ok) throw new Error(`Yahoo FA fetch failed: ${res.status}`);
    const text = await res.text();

    const players: PlayerEntry[] = [];
    const regex =
      /<player_id>([^<]+)<\/player_id>[\s\S]*?<full>([^<]+)<\/full>[\s\S]*?<display_position>([^<]+)<\/display_position>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const entry: PlayerEntry = {
        playerId: match[1],
        name: match[2],
        position: match[3],
      };
      if (filters?.position && entry.position !== filters.position) continue;
      players.push(entry);
      if (players.length >= (filters?.limit ?? 50)) break;
    }
    return players;
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
    teamId: string,
    addPlayerId: string,
    dropPlayerId: string
  ): Promise<TransactionResult> {
    if (!account.credentials.accessToken) {
      return { success: false, message: 'Yahoo OAuth token required for transactions' };
    }
    return {
      success: false,
      message: 'Yahoo add/drop requires OAuth transaction scope. Open Yahoo Fantasy to complete.',
      deepLink: `https://football.fantasysports.yahoo.com/f1/${leagueId.split('.').pop()}`,
    };
  }

  async submitLineupChange(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    changes: import('../../types/index.js').LineupChange[]
  ): Promise<TransactionResult> {
    if (!account.credentials.accessToken) {
      return { success: false, message: 'Yahoo OAuth token required for lineup writes' };
    }

    const errors: string[] = [];
    for (const change of changes) {
      const playerKey = change.playerId.includes('.')
        ? change.playerId
        : `${leagueId}.p.${change.playerId}`;
      const position = change.toSlot === 'BN' ? 'BN' : change.toSlot;
      const xml = `<?xml version="1.0"?>
<fantasy_content>
  <roster>
    <coverage_type>week</coverage_type>
    <position>${position}</position>
    <player>
      <player_key>${playerKey}</player_key>
      <position>${position}</position>
    </player>
  </roster>
</fantasy_content>`;
      const res = await fetch(
        `${YAHOO_BASE}/team/${teamId}/roster/players;player_key=${encodeURIComponent(playerKey)}/position`,
        {
          method: 'PUT',
          headers: {
            ...this.authHeader(account.credentials),
            'Content-Type': 'application/xml',
          },
          body: xml,
        }
      );
      if (!res.ok) {
        errors.push(`${change.playerId}: HTTP ${res.status}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        message: `Yahoo lineup write failed: ${errors.join('; ')}`,
        deepLink: `https://football.fantasysports.yahoo.com/f1/${leagueId.split('.').pop()}`,
      };
    }
    return {
      success: true,
      message: 'Lineup updated on Yahoo.',
      deepLink: `https://football.fantasysports.yahoo.com/f1/${leagueId.split('.').pop()}`,
    };
  }
}
