import type {
  ITeam,
} from '../../models/Team.js';
import type {
  Sport,
  SwapRecommendationInput,
  TrendingPlayer,
  PlayerWeekStats,
  NewsSnippet,
  PlayerEntry,
} from '../../types/index.js';
import { SPORT_CONFIG } from '../../types/index.js';
import { newsRecencyMultiplier } from '../newsService.js';

import { generateAllLineupRecommendations, generateInjuryLineupRecommendations } from './lineup.js';
import { generateRosterComplianceRecommendations } from './compliance.js';
import { assessTeam, maxRecommendationsForGoal } from './planner.js';
import { scorePlayerAvailability } from './playerAvailability.js';

const INJURY_DROP = new Set(['OUT', 'IR', 'PUP', 'SUSP', 'DOUBTFUL']);

export interface OptimizerInput {
  team: ITeam;
  performance: PlayerWeekStats[];
  trendingAdds: TrendingPlayer[];
  trendingDrops: TrendingPlayer[];
  newsByPlayerId?: Record<string, NewsSnippet[]>;
  /** Latest league-wide news headlines, matched to players by name */
  leagueNews?: NewsSnippet[];
  week: number;
  maxRecommendations?: number;
  /** Per-team tag weights from accept/dismiss feedback (1.0 = neutral) */
  tagWeights?: Record<string, number>;
}

const NEGATIVE_NEWS = /injur|out for|out indefinitely|ruled out|ir\b|suspend|benched|demot|surgery|setback|doubtful|questionable|miss.*(week|game)|placed on/i;
const POSITIVE_NEWS = /breakout|starting role|promoted|elevated|increased (snaps|usage|targets|touches|minutes)|career.high|waiver.*(add|target)|emerging|hot streak|expected to start/i;

/** Match latest news headlines to a player by name; returns matched snippets and a sentiment score. */
export function matchNewsToPlayer(
  playerName: string,
  leagueNews: NewsSnippet[]
): { snippets: NewsSnippet[]; sentiment: number } {
  const lastName = playerName.split(' ').slice(-1)[0]?.toLowerCase() ?? '';
  if (lastName.length < 3) return { snippets: [], sentiment: 0 };

  const nameLower = playerName.toLowerCase();
  const matched = leagueNews.filter((n) => {
    const h = n.headline.toLowerCase();
    return h.includes(nameLower) || h.includes(lastName);
  });

  const snippets = [...matched].sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });

  let sentiment = 0;
  for (const s of snippets) {
    const recency = newsRecencyMultiplier(
      s.publishedAt ? new Date(s.publishedAt) : undefined
    );
    if (NEGATIVE_NEWS.test(s.headline)) sentiment -= recency;
    if (POSITIVE_NEWS.test(s.headline)) sentiment += recency;
  }
  return { snippets: snippets.slice(0, 3), sentiment };
}

const INJURY_TAGS = new Set([
  'injury',
  'injured_starter',
  'injury_replacement',
  'negative_news',
]);

function applyTagWeight(
  score: number,
  tags: string[],
  tagWeights?: Record<string, number>
): number {
  if (!tagWeights || tags.length === 0) return score;
  if (tags.some((t) => INJURY_TAGS.has(t))) return score;
  const weights = tags.map((t) => tagWeights[t] ?? 1);
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  return score * avg;
}

function positionBaselines(performance: PlayerWeekStats[]): Record<string, number> {
  const byPos: Record<string, number[]> = {};
  for (const p of performance) {
    if (!byPos[p.position]) byPos[p.position] = [];
    byPos[p.position].push(p.avgPoints);
  }
  const baselines: Record<string, number> = {};
  for (const [pos, pts] of Object.entries(byPos)) {
    baselines[pos] = pts.reduce((a, b) => a + b, 0) / Math.max(pts.length, 1);
  }
  return baselines;
}

function scoreDropCandidate(
  player: PlayerWeekStats,
  baselines: Record<string, number>,
  trendingDrops: TrendingPlayer[],
  injuryStatus?: string,
  rosterEntry?: PlayerEntry
): { score: number; tags: string[]; summary: string } {
  if (rosterEntry) {
    const availability = scorePlayerAvailability(rosterEntry);
    if (availability.score > 0) {
      return {
        score: availability.score,
        tags: availability.tags,
        summary: availability.summary,
      };
    }
  }

  const tags: string[] = [];
  let score = 0;
  const baseline = baselines[player.position] ?? 5;

  if (player.avgPoints < baseline * 0.6) {
    score += 0.4;
    tags.push('low_points');
  }
  if (injuryStatus && INJURY_DROP.has(injuryStatus.toUpperCase())) {
    score += 0.5;
    tags.push('injury');
  }
  if (trendingDrops.some((t) => t.playerId === player.playerId)) {
    score += 0.3;
    tags.push('trending_drop');
  }
  if (player.avgPoints === 0) {
    score += 0.2;
    tags.push('no_production');
  }

  return {
    score,
    tags,
    summary: tags.length > 0 ? tags.join(', ').replace(/_/g, ' ') : '',
  };
}

function scoreAddCandidate(
  fa: { playerId: string; name: string; position: string },
  trendingAdds: TrendingPlayer[],
  neededPositions: Set<string>
): { score: number; tags: string[] } {
  const tags: string[] = [];
  let score = 0;

  if (neededPositions.has(fa.position)) {
    score += 0.3;
    tags.push('positional_need');
  }
  const trend = trendingAdds.find((t) => t.playerId === fa.playerId);
  if (trend) {
    score += Math.min(0.5, trend.trendCount / 100);
    tags.push('trending_add');
  }

  return { score, tags };
}

function findNeededPositions(team: ITeam): Set<string> {
  const needed = new Set<string>();
  const starterCounts: Record<string, number> = {};
  for (const p of team.roster.starters) {
    starterCounts[p.position] = (starterCounts[p.position] ?? 0) + 1;
  }
  for (const [pos, required] of Object.entries(team.settings.rosterSlots)) {
    if ((starterCounts[pos] ?? 0) < required) needed.add(pos);
  }
  for (const p of [...team.roster.starters, ...team.roster.bench]) {
    if (p.injuryStatus && INJURY_DROP.has(p.injuryStatus.toUpperCase())) {
      needed.add(p.position);
    }
  }
  return needed;
}

export function generateSwapRecommendations(input: OptimizerInput): SwapRecommendationInput[] {
  const {
    team,
    performance,
    trendingAdds,
    trendingDrops,
    newsByPlayerId = {},
    leagueNews = [],
    maxRecommendations = 3,
    tagWeights,
  } = input;

  const baselines = positionBaselines(performance);
  const neededPositions = findNeededPositions(team);
  const freeAgents = team.freeAgentsCache?.players ?? [];

  const allRoster = [
    ...team.roster.starters,
    ...team.roster.bench,
    ...(team.roster.ir ?? []),
    ...(team.roster.taxi ?? []),
  ];
  const injuryMap = Object.fromEntries(
    allRoster.map((p) => [p.playerId, p.injuryStatus])
  );
  const rosterMap = Object.fromEntries(allRoster.map((p) => [p.playerId, p]));

  const dropCandidates = performance
    .map((p) => {
      const { score, tags, summary } = scoreDropCandidate(
        p,
        baselines,
        trendingDrops,
        injuryMap[p.playerId],
        rosterMap[p.playerId]
      );
      const news = matchNewsToPlayer(p.name, leagueNews);
      let finalScore = score;
      if (news.sentiment < 0) {
        finalScore += 0.25;
        tags.push('negative_news');
      }
      return { player: p, score: finalScore, tags, summary, newsSnippets: news.snippets };
    })
    .filter((d) => d.score > 0.3)
    .map((d) => ({
      ...d,
      score: applyTagWeight(d.score, d.tags, tagWeights),
    }))
    .sort((a, b) => b.score - a.score);

  const addCandidates = freeAgents
    .map((fa) => {
      const { score, tags } = scoreAddCandidate(fa, trendingAdds, neededPositions);
      const news = matchNewsToPlayer(fa.name, leagueNews);
      let finalScore = score;
      if (news.sentiment > 0) {
        finalScore += 0.25;
        tags.push('positive_news');
      }
      return { player: fa, score: finalScore, tags, newsSnippets: news.snippets };
    })
    .filter((a) => a.score > 0.2)
    .map((a) => ({
      ...a,
      score: applyTagWeight(a.score, a.tags, tagWeights),
    }))
    .sort((a, b) => b.score - a.score);

  const recommendations: SwapRecommendationInput[] = [];
  const usedAdds = new Set<string>();
  const usedDrops = new Set<string>();

  for (const drop of dropCandidates) {
    if (recommendations.length >= maxRecommendations) break;
    if (usedDrops.has(drop.player.playerId)) continue;

    const add = addCandidates.find(
      (a) =>
        !usedAdds.has(a.player.playerId) &&
        (neededPositions.has(a.player.position) ||
          a.player.position === drop.player.position ||
          ['RB', 'WR', 'TE'].includes(a.player.position))
    );
    if (!add) continue;

    const confidence = Math.min(
      0.95,
      applyTagWeight((drop.score + add.score) / 2, [...drop.tags, ...add.tags], tagWeights)
    );
    const dropNews = [...(newsByPlayerId[drop.player.playerId] ?? []), ...drop.newsSnippets];
    const addNews = [...(newsByPlayerId[add.player.playerId] ?? []), ...add.newsSnippets];

    recommendations.push({
      kind: 'add_drop',
      dropPlayer: {
        playerId: drop.player.playerId,
        name: drop.player.name,
        position: drop.player.position,
        reasonTags: drop.tags,
      },
      addPlayer: {
        playerId: add.player.playerId,
        name: add.player.name,
        position: add.player.position,
        reasonTags: add.tags,
      },
      confidence,
      rationale: [
        `Drop ${drop.player.name} — ${drop.summary || drop.tags.join(', ') || 'underperforming'}`,
        `Add ${add.player.name} (${add.tags.join(', ') || 'waiver target'})`,
        ...dropNews.slice(0, 1).map((n) => `News: ${n.headline} (${n.source})`),
        ...addNews.slice(0, 1).map((n) => `News: ${n.headline} (${n.source})`),
        `Projected roster improvement for ${team.teamName}`,
      ],
      newsSnippets: [...dropNews, ...addNews].slice(0, 5),
    });

    usedDrops.add(drop.player.playerId);
    usedAdds.add(add.player.playerId);
  }

  return recommendations;
}

export { generateAllLineupRecommendations, generateInjuryLineupRecommendations, generateFlexRepositionRecommendations } from './lineup.js';

export function generateWeeklyRecommendations(input: OptimizerInput): SwapRecommendationInput[] {
  const assessment = assessTeam(input.team, input.performance);
  const recommendations: SwapRecommendationInput[] = [];

  for (const goal of assessment.goals) {
    const max = maxRecommendationsForGoal(goal);
    switch (goal) {
      case 'roster_compliance':
        recommendations.push(
          ...generateRosterComplianceRecommendations({
            team: input.team,
            performance: input.performance,
            maxRecommendations: max,
          })
        );
        break;
      case 'lineup_injury':
        recommendations.push(
          ...generateInjuryLineupRecommendations({
            team: input.team,
            performance: input.performance,
            maxRecommendations: max,
          })
        );
        break;
      case 'lineup_flex':
        recommendations.push(
          ...generateAllLineupRecommendations({
            team: input.team,
            performance: input.performance,
            maxRecommendations: max,
          }).filter((r) => r.kind === 'lineup_flex_move')
        );
        break;
      case 'waiver_upgrades':
        recommendations.push(...generateSwapRecommendations({ ...input, maxRecommendations: max }));
        break;
    }
  }

  return recommendations;
}

export { generateRosterComplianceRecommendations, getRosterComplianceSummary } from './compliance.js';

export function getCurrentWeek(sport: Sport = 'nfl'): number {
  const cfg = SPORT_CONFIG[sport];
  const now = new Date();
  let seasonStart = new Date(now.getFullYear(), cfg.seasonStart.month, cfg.seasonStart.day);
  // If the season started late last calendar year (e.g. NBA/NHL), roll back a year
  if (now < seasonStart) {
    seasonStart = new Date(now.getFullYear() - 1, cfg.seasonStart.month, cfg.seasonStart.day);
    const weeksSince = Math.floor(
      (now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    if (weeksSince > cfg.totalWeeks) return 1;
  }
  const diff = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.min(Math.max(diff + 1, 1), cfg.totalWeeks);
}

/** @deprecated use getCurrentWeek(sport) */
export const getCurrentNflWeek = () => getCurrentWeek('nfl');
