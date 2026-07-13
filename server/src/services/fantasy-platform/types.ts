import type {
  ConnectedAccount,
  FAFilter,
  LeagueSettings,
  LeagueSummary,
  LineupChange,
  NormalizedRoster,
  Platform,
  PlatformCredentials,
  PlayerEntry,
  PlayerWeekStats,
  Sport,
  TransactionResult,
} from '../../types/index.js';

export interface FantasyPlatformAdapter {
  readonly platform: Platform;
  /** Sport this adapter instance is scoped to (nfl, nba, mlb, nhl, ...) */
  readonly sport: Sport;
  connect(credentials: PlatformCredentials): Promise<ConnectedAccount>;
  getLeagues(account: ConnectedAccount): Promise<LeagueSummary[]>;
  getTeamRoster(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string
  ): Promise<{ roster: NormalizedRoster; settings: LeagueSettings; raw: Record<string, unknown> }>;
  getFreeAgents(
    account: ConnectedAccount,
    leagueId: string,
    filters?: FAFilter
  ): Promise<PlayerEntry[]>;
  getRecentPerformance(
    account: ConnectedAccount,
    leagueId: string,
    roster: NormalizedRoster
  ): Promise<PlayerWeekStats[]>;
  submitAddDrop?(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    addPlayerId: string,
    dropPlayerId: string
  ): Promise<TransactionResult>;
  submitDrop?(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    dropPlayerId: string
  ): Promise<TransactionResult>;
  submitTaxiMove?(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    playerId: string
  ): Promise<TransactionResult>;
  submitLineupChange?(
    account: ConnectedAccount,
    leagueId: string,
    teamId: string,
    changes: LineupChange[]
  ): Promise<TransactionResult>;
}
