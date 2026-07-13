import type { ITeam } from '../../models/Team.js';
import type {
  NewsSnippet,
  NormalizedRoster,
  PlayerEntry,
  PlayerWeekStats,
  SwapRecommendationInput,
} from '../../types/index.js';
import { getNewsAsOf } from '../newsService.js';
import { getSleeperPlayersMap, type SleeperPlayer } from '../fantasy-platform/sleeper.js';
import { matchNewsToPlayer } from '../roster-optimizer/index.js';
import { generateInjuryLineupRecommendations } from '../roster-optimizer/lineup.js';
import { synthesizeLineupRecs } from '../roster-optimizer/synthesis.js';
import { assessTeam } from '../roster-optimizer/planner.js';
import { citeNews, citeSleeper, normalizeRationaleLines } from '../roster-optimizer/citations.js';
import { isLlmEnabled } from '../llm/client.js';
import { weekDecisionAsOf } from './calendar.js';
import {
  buildWeekPointsMap,
  fetchLeagueMatchups,
  findRosterMatchup,
  sumPriorWeekAverages,
} from './sleeperHistory.js';

const MUST_SIT_NEWS =
  /ruled out|out for|placed on ir|inactive|will not play|not playing|sidelined|out indefinitely/i;
const QUESTIONABLE_NEWS = /questionable|doubtful|game.?time decision|limited|injury|hamstring|ankle|knee|concussion/i;

export interface BacktestWeekResult {
  week: number;
  asOf: string;
  newsCount: number;
  actualStarterIds: string[];
  agentStarterIds: string[];
  swapsApplied: Array<{
    sitPlayerId?: string;
    sitName?: string;
    startPlayerId?: string;
    startName?: string;
    rationale: SwapRecommendationInput['rationale'];
  }>;
  actualPoints: number;
  agentPoints: number;
  delta: number;
  /** Points left on bench that the agent moved into lineup (or 0) */
  gainedPoints: number;
  lostPoints: number;
}

function resolveEntry(
  id: string,
  map: Record<string, SleeperPlayer>,
  lineupSlot?: string
): PlayerEntry {
  const p = map[id];
  const name =
    p?.full_name ||
    [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
    `Player ${id}`;
  return {
    playerId: id,
    name,
    position: p?.position ?? (p?.fantasy_positions?.[0] ?? 'UNKNOWN'),
    team: p?.team ?? undefined,
    injuryStatus: p?.injury_status ?? undefined,
    yearsExp: p?.years_exp,
    playerStatus: p?.status ?? undefined,
    active: p?.active,
    lineupSlot,
  };
}

/**
 * Infer injury designations from contemporaneous news only (no modern Sleeper injury dump).
 */
export function applyNewsInjuryLabels(
  roster: NormalizedRoster,
  leagueNews: NewsSnippet[]
): NormalizedRoster {
  const tag = (p: PlayerEntry): PlayerEntry => {
    const { snippets, sentiment } = matchNewsToPlayer(p.name, leagueNews);
    if (snippets.length === 0) return p;
    const joined = snippets.map((s) => s.headline).join(' | ');
    if (MUST_SIT_NEWS.test(joined) || sentiment <= -0.8) {
      return { ...p, injuryStatus: 'OUT' };
    }
    if (QUESTIONABLE_NEWS.test(joined) || sentiment < -0.2) {
      return { ...p, injuryStatus: p.injuryStatus ?? 'QUESTIONABLE' };
    }
    return p;
  };
  return {
    starters: roster.starters.map(tag),
    bench: roster.bench.map(tag),
    ir: roster.ir?.map(tag),
    taxi: roster.taxi?.map(tag),
  };
}

function applySitStartSwaps(
  starters: PlayerEntry[],
  bench: PlayerEntry[],
  recs: SwapRecommendationInput[]
): { starters: PlayerEntry[]; bench: PlayerEntry[]; applied: BacktestWeekResult['swapsApplied'] } {
  let nextStarters = [...starters];
  let nextBench = [...bench];
  const applied: BacktestWeekResult['swapsApplied'] = [];

  for (const rec of recs) {
    if (rec.kind !== 'lineup_sit_start' || !rec.lineupAction?.sitPlayer) continue;
    const sitId = rec.lineupAction.sitPlayer.playerId;
    const startId = rec.lineupAction.startPlayer?.playerId;
    const sitIdx = nextStarters.findIndex((p) => p.playerId === sitId);
    if (sitIdx < 0) continue;

    const sitPlayer = nextStarters[sitIdx];
    if (!startId) {
      // Sit only — leave slot empty not valid; skip sit-without-replacement
      continue;
    }
    const benchIdx = nextBench.findIndex((p) => p.playerId === startId);
    if (benchIdx < 0) continue;

    const startPlayer = {
      ...nextBench[benchIdx],
      lineupSlot: sitPlayer.lineupSlot ?? sitPlayer.position,
    };
    nextBench = [
      ...nextBench.filter((_, i) => i !== benchIdx),
      { ...sitPlayer, lineupSlot: 'BN' },
    ];
    nextStarters = nextStarters.map((p, i) => (i === sitIdx ? startPlayer : p));
    applied.push({
      sitPlayerId: sitId,
      sitName: sitPlayer.name,
      startPlayerId: startId,
      startName: startPlayer.name,
      rationale: rec.rationale,
    });
  }

  return { starters: nextStarters, bench: nextBench, applied };
}

function sumStarterPoints(starterIds: string[], pts: Record<string, number>): number {
  return starterIds.reduce((sum, id) => sum + (pts[id] ?? 0), 0);
}

function enrichSwapCitations(
  recs: SwapRecommendationInput[],
  leagueNews: NewsSnippet[]
): SwapRecommendationInput[] {
  return recs.map((rec) => {
    const names = [
      rec.lineupAction?.sitPlayer?.name,
      rec.lineupAction?.startPlayer?.name,
    ].filter(Boolean) as string[];
    const newsLines = names.flatMap((name) => {
      const { snippets } = matchNewsToPlayer(name, leagueNews);
      return snippets.slice(0, 2).map((n) =>
        citeNews(`${name}: ${n.headline}`, n)
      );
    });
    if (newsLines.length === 0) return rec;
    return {
      ...rec,
      rationale: [...normalizeRationaleLines(rec.rationale), ...newsLines],
      newsSnippets: [...(rec.newsSnippets ?? []), ...newsLines.map((l) => ({
        headline: l.text,
        source: l.source,
        url: l.url,
      }))],
    };
  });
}

export async function replayWeek(input: {
  team: ITeam;
  season: number;
  week: number;
  lookbackHours?: number;
  synthesize?: boolean;
}): Promise<BacktestWeekResult> {
  const { team, season, week, lookbackHours = 168, synthesize = true } = input;
  const leagueId = team.externalLeagueId;
  const rosterId = parseInt(team.externalTeamId, 10);
  if (!Number.isFinite(rosterId)) {
    throw new Error('Backtest requires a numeric Sleeper roster id');
  }

  const asOf = weekDecisionAsOf(season, week, team.sport);
  const leagueNews = await getNewsAsOf(team.sport, { asOf, lookbackHours, limit: 120 });

  const matchups = await fetchLeagueMatchups(leagueId, week);
  const row = findRosterMatchup(matchups, rosterId);
  if (!row?.starters?.length) {
    throw new Error(`No Sleeper matchup starters for roster ${rosterId} week ${week}`);
  }

  const weekPts = buildWeekPointsMap(matchups);
  const playersMap = await getSleeperPlayersMap(team.sport === 'nfl' ? 'nfl' : team.sport);

  const slots = Object.keys(team.settings.rosterSlots);
  const actualStarters = row.starters
    .filter(Boolean)
    .map((id, i) => resolveEntry(id, playersMap, slots[i] ?? 'FLEX'));
  const starterSet = new Set(actualStarters.map((p) => p.playerId));
  const benchIds = (row.players ?? []).filter((id) => id && !starterSet.has(id));
  const actualBench = benchIds.map((id) => resolveEntry(id, playersMap, 'BN'));

  let labeled = applyNewsInjuryLabels(
    { starters: actualStarters, bench: actualBench },
    leagueNews
  );

  // Prior-week averages only (no look-ahead into week W scores)
  const prior = await sumPriorWeekAverages(leagueId, rosterId, week, 3);
  const performance: PlayerWeekStats[] = [...labeled.starters, ...labeled.bench].map((p) => {
    const hist = prior[p.playerId];
    return {
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      pointsLast3Weeks: hist?.weeks.slice(-3) ?? [0, 0, 0],
      avgPoints: hist?.avg ?? 0,
    };
  });

  const fauxTeam = {
    ...(typeof (team as { toObject?: () => object }).toObject === 'function'
      ? (team as { toObject: () => object }).toObject()
      : team),
    roster: labeled,
  } as ITeam;

  let recs = generateInjuryLineupRecommendations({
    team: fauxTeam,
    performance,
    maxRecommendations: 5,
  });
  recs = enrichSwapCitations(recs, leagueNews);

  if (synthesize && isLlmEnabled() && recs.length > 0) {
    const assessment = assessTeam(fauxTeam, performance);
    recs = await synthesizeLineupRecs(
      {
        team: fauxTeam,
        assessment,
        leagueNews,
        playerIntel: undefined,
      },
      recs
    );
  }

  // Guard: if no injury news at all, don't invent swaps — keep actual lineup
  const newsDriven = recs.filter((r) => {
    const sit = r.lineupAction?.sitPlayer;
    if (!sit) return false;
    const { snippets, sentiment } = matchNewsToPlayer(sit.name, leagueNews);
    return snippets.length > 0 && (sentiment < 0 || MUST_SIT_NEWS.test(snippets.map((s) => s.headline).join(' ')));
  });

  const { starters: agentStarters, applied } = applySitStartSwaps(
    labeled.starters,
    labeled.bench,
    newsDriven.length > 0 ? newsDriven : []
  );

  // Attach sleeper cite when we kept the historical starters
  if (applied.length === 0 && leagueNews.length === 0) {
    applied.push({
      rationale: [
        citeSleeper(
          'No contemporaneous news in window — kept historical lineup as set',
          `week=${week}; asOf=${asOf.toISOString()}`
        ),
      ],
    });
  }

  const actualIds = actualStarters.map((p) => p.playerId);
  const agentIds = agentStarters.map((p) => p.playerId);
  const actualPoints = sumStarterPoints(actualIds, weekPts);
  const agentPoints = sumStarterPoints(agentIds, weekPts);

  let gainedPoints = 0;
  let lostPoints = 0;
  for (const swap of applied) {
    if (!swap.sitPlayerId || !swap.startPlayerId) continue;
    const sitPts = weekPts[swap.sitPlayerId] ?? 0;
    const startPts = weekPts[swap.startPlayerId] ?? 0;
    const d = startPts - sitPts;
    if (d > 0) gainedPoints += d;
    else lostPoints += -d;
  }

  return {
    week,
    asOf: asOf.toISOString(),
    newsCount: leagueNews.length,
    actualStarterIds: actualIds,
    agentStarterIds: agentIds,
    swapsApplied: applied,
    actualPoints: Math.round(actualPoints * 100) / 100,
    agentPoints: Math.round(agentPoints * 100) / 100,
    delta: Math.round((agentPoints - actualPoints) * 100) / 100,
    gainedPoints: Math.round(gainedPoints * 100) / 100,
    lostPoints: Math.round(lostPoints * 100) / 100,
  };
}
