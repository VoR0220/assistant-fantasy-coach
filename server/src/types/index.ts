export type Platform = 'sleeper' | 'espn' | 'yahoo';

/**
 * Sports are expandable: add an entry to SPORT_CONFIG and the adapters,
 * optimizer, and agent runs pick it up automatically.
 */
export type Sport = 'nfl' | 'nba' | 'mlb' | 'nhl';

export interface SportConfig {
  sport: Sport;
  label: string;
  /** Sleeper sport path segment (only some sports supported) */
  sleeperKey?: string;
  /** ESPN fantasy game code (ffl, fba, flb, fhl) */
  espnGameCode?: string;
  /** Yahoo game key prefix */
  yahooGameKey?: string;
  /** Approximate season start (month is 0-based) used for week math */
  seasonStart: { month: number; day: number };
  /** Number of scoring periods in a regular season */
  totalWeeks: number;
}

export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  nfl: {
    sport: 'nfl',
    label: 'Football',
    sleeperKey: 'nfl',
    espnGameCode: 'ffl',
    yahooGameKey: 'nfl',
    seasonStart: { month: 8, day: 3 },
    totalWeeks: 18,
  },
  nba: {
    sport: 'nba',
    label: 'Basketball',
    sleeperKey: 'nba',
    espnGameCode: 'fba',
    yahooGameKey: 'nba',
    seasonStart: { month: 9, day: 20 },
    totalWeeks: 26,
  },
  mlb: {
    sport: 'mlb',
    label: 'Baseball',
    espnGameCode: 'flb',
    yahooGameKey: 'mlb',
    seasonStart: { month: 2, day: 25 },
    totalWeeks: 26,
  },
  nhl: {
    sport: 'nhl',
    label: 'Hockey',
    espnGameCode: 'fhl',
    yahooGameKey: 'nhl',
    seasonStart: { month: 9, day: 7 },
    totalWeeks: 26,
  },
};

export interface PlayerEntry {
  playerId: string;
  name: string;
  position: string;
  team?: string;
  injuryStatus?: string;
  /** Lineup slot the player currently occupies (e.g. QB, FLEX, BN) */
  lineupSlot?: string;
  /** NFL seasons played (Sleeper years_exp) — used for taxi eligibility */
  yearsExp?: number;
  /** Sleeper status: Active, Inactive, Injured Reserve, etc. */
  playerStatus?: string;
  /** Sleeper active flag — false for inactive/retired players */
  active?: boolean;
  fantasyPoints?: { week?: number; season?: number };
}

export interface NormalizedRoster {
  starters: PlayerEntry[];
  bench: PlayerEntry[];
  ir?: PlayerEntry[];
  /** Sleeper taxi squad — does not count against roster limit */
  taxi?: PlayerEntry[];
}

export interface LeagueSettings {
  scoringFormat: 'ppr' | 'half_ppr' | 'standard' | 'points' | 'categories';
  rosterSlots: Record<string, number>;
  waiverType: 'faab' | 'rolling' | 'none';
  numTeams: number;
  /** Starters + bench + IR slots (excludes taxi) */
  maxRosterSize?: number;
  benchSlots?: number;
  irSlots?: number;
  /** Sleeper taxi squad settings */
  taxiSlots?: number;
  /** Max years of experience for taxi eligibility (Sleeper taxi_years) */
  taxiYears?: number;
}

export interface SwapPlayerRef {
  playerId: string;
  name: string;
  position: string;
  reasonTags?: string[];
}

export interface NewsSnippet {
  headline: string;
  source: string;
  url?: string;
  publishedAt?: Date;
}

export type RationaleSourceKind =
  | 'sleeper'
  | 'news'
  | 'league'
  | 'mcp'
  | 'rule_engine'
  | 'performance'
  | 'agent';

/** One rationale claim with an explicit citation */
export interface RationaleLine {
  text: string;
  source: string;
  url?: string;
  sourceKind?: RationaleSourceKind;
}

export interface PlatformCredentials {
  username?: string;
  /** Email or phone for Sleeper password sign-in */
  email?: string;
  /** Password for Sleeper sign-in; forwarded to Sleeper only, never persisted */
  password?: string;
  userId?: string;
  leagueId?: string;
  espnS2?: string;
  swid?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Sleeper private GraphQL token for lineup writes */
  sleeperToken?: string;
}

export interface LineupChange {
  playerId: string;
  fromSlot: string;
  toSlot: string;
}

export interface LeagueSummary {
  externalLeagueId: string;
  externalTeamId: string;
  leagueName: string;
  teamName: string;
  season: number;
  sport: Sport;
}

export interface FAFilter {
  position?: string;
  limit?: number;
}

export interface ConnectedAccount {
  platform: Platform;
  externalUserId: string;
  credentials: PlatformCredentials;
}

export interface TransactionResult {
  success: boolean;
  message: string;
  deepLink?: string;
}

export type RecommendationKind =
  | 'add_drop'
  | 'lineup_sit_start'
  | 'lineup_flex_move'
  | 'roster_drop'
  | 'move_to_taxi';

export interface LineupActionInput {
  sitPlayer?: SwapPlayerRef;
  startPlayer?: SwapPlayerRef;
  movePlayer?: SwapPlayerRef;
  fromSlot?: string;
  toSlot?: string;
  freesSlot?: string;
}

export interface SwapRecommendationInput {
  kind: RecommendationKind;
  dropPlayer?: SwapPlayerRef;
  /** Equal or near-equal drop choices for the user to pick among (includes dropPlayer) */
  dropAlternatives?: SwapPlayerRef[];
  addPlayer?: SwapPlayerRef;
  lineupAction?: LineupActionInput;
  confidence: number;
  /** Preferred: cited claims. Strings still accepted for older callers. */
  rationale: Array<string | RationaleLine>;
  newsSnippets: NewsSnippet[];
}

export interface TrendingPlayer {
  playerId: string;
  name: string;
  position: string;
  team?: string;
  injuryStatus?: string;
  trendCount: number;
  trendType: 'add' | 'drop';
}

export interface PlayerWeekStats {
  playerId: string;
  name: string;
  position: string;
  pointsLast3Weeks: number[];
  avgPoints: number;
}
