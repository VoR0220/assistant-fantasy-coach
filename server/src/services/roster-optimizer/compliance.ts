import type { ITeam } from '../../models/Team.js';
import type { PlayerEntry, PlayerWeekStats, SwapRecommendationInput } from '../../types/index.js';
import {
  isTaxiStashCandidate,
  scorePlayerAvailability,
} from './playerAvailability.js';

export interface ComplianceInput {
  team: ITeam;
  performance: PlayerWeekStats[];
  maxRecommendations?: number;
}

function countableRoster(team: ITeam): number {
  const { starters, bench, ir } = team.roster;
  return starters.length + bench.length + (ir?.length ?? 0);
}

/** Tiebreaker when multiple players are still on NFL rosters */
function scoreBenchDepthDrop(
  player: PlayerEntry,
  team: ITeam,
  perfMap: Record<string, PlayerWeekStats>
): { score: number; tags: string[] } {
  const tags: string[] = [];
  let score = 0;

  const perf = perfMap[player.playerId];
  const avg = perf?.avgPoints ?? 0;
  if (avg === 0) {
    score += 0.35;
    tags.push('no_production');
  } else if (avg < 3) {
    score += 0.25;
    tags.push('low_points');
  }

  const bench = team.roster.bench;
  const samePos = bench.filter((p) => p.position === player.position).length;
  const startersSame = team.roster.starters.filter((p) => p.position === player.position).length;
  if (player.position === 'QB' && samePos + startersSame > 2) {
    score += 0.45;
    tags.push('qb_depth');
  }
  if (player.position === 'TE' && samePos + startersSame > 2) {
    score += 0.4;
    tags.push('te_depth');
  }
  if (['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'].includes(player.position) && samePos > 2) {
    score += 0.3;
    tags.push('idp_depth');
  }
  if (player.injuryStatus) {
    score += 0.15;
    tags.push('injury_risk');
  }

  return { score, tags };
}

function scoreDropCandidate(
  player: PlayerEntry,
  team: ITeam,
  perfMap: Record<string, PlayerWeekStats>
): { score: number; tags: string[]; summary: string } {
  const availability = scorePlayerAvailability(player);
  const depth = scoreBenchDepthDrop(player, team, perfMap);

  if (availability.score > 0) {
    return {
      score: availability.score + depth.score * 0.1,
      tags: [...availability.tags, ...depth.tags],
      summary: availability.summary,
    };
  }

  return {
    score: depth.score,
    tags: depth.tags,
    summary:
      depth.tags.length > 0
        ? `Bench trim — ${depth.tags.join(', ').replace(/_/g, ' ')}`
        : 'Bench depth trim to meet roster limit',
  };
}

function playerRef(p: PlayerEntry, tags?: string[]) {
  return {
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    reasonTags: tags,
  };
}

export interface ComplianceDropCandidate {
  player: PlayerEntry;
  score: number;
  tags: string[];
  summary: string;
}

export function getComplianceDropCandidates(
  team: ITeam,
  performance: PlayerWeekStats[],
  excludeIds: Set<string> = new Set()
): ComplianceDropCandidate[] {
  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  return team.roster.bench
    .filter((p) => !excludeIds.has(p.playerId))
    .map((p) => {
      const { score, tags, summary } = scoreDropCandidate(p, team, perfMap);
      return { player: p, score, tags, summary };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

function dropEqualityTier(tags: string[]): string {
  if (tags.includes('inactive') || tags.includes('no_fantasy_value')) return 'inactive';
  if (tags.includes('no_nfl_team') || tags.includes('free_agent')) return 'no_nfl_team';
  if (tags.includes('injury') || tags.some((t) => ['out', 'ir', 'pup', 'susp'].includes(t))) {
    return 'injury';
  }
  return 'depth';
}

/**
 * Peers of the chosen drop that are equally good cuts (same tier, score within 0.08).
 * Always includes the chosen player when present.
 */
export function findEqualDropAlternatives(
  candidates: ComplianceDropCandidate[],
  chosen: ComplianceDropCandidate,
  limit = 5
): PlayerEntry[] {
  const tier = dropEqualityTier(chosen.tags);
  const peers = candidates.filter(
    (c) =>
      dropEqualityTier(c.tags) === tier && Math.abs(c.score - chosen.score) <= 0.08
  );
  const ordered = peers.length > 0 ? peers : [chosen];
  return ordered.slice(0, limit).map((c) => c.player);
}

/**
 * Recommend taxi moves and roster cuts when over the league max (taxi excluded).
 */
export function generateRosterComplianceRecommendations(
  input: ComplianceInput
): SwapRecommendationInput[] {
  const { team, performance, maxRecommendations = 5 } = input;
  const maxSize = team.settings.maxRosterSize;
  if (!maxSize) return [];

  const countable = countableRoster(team);
  const overBy = countable - maxSize;
  if (overBy <= 0) return [];

  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  const taxiSlots = team.settings.taxiSlots ?? 0;
  const taxiYears = team.settings.taxiYears;
  const taxiCount = team.roster.taxi?.length ?? 0;
  const taxiOpen = Math.max(0, taxiSlots - taxiCount);

  const recommendations: SwapRecommendationInput[] = [];
  const used = new Set<string>();

  // Prefer moving taxi-eligible bench players before outright drops
  if (taxiOpen > 0 && taxiSlots > 0) {
    const taxiCandidates = team.roster.bench
      .filter((p) => isTaxiStashCandidate(p, taxiYears))
      .sort((a, b) => (a.yearsExp ?? 99) - (b.yearsExp ?? 99));

    for (const player of taxiCandidates) {
      if (recommendations.length >= maxRecommendations) break;
      if (used.has(player.playerId)) continue;
      if (recommendations.filter((r) => r.kind === 'move_to_taxi').length >= taxiOpen) break;

      recommendations.push({
        kind: 'move_to_taxi',
        lineupAction: {
          movePlayer: playerRef(player, ['taxi_eligible', `years_exp_${player.yearsExp ?? 0}`]),
          fromSlot: 'BN',
          toSlot: 'TAXI',
        },
        confidence: 0.92,
        rationale: [
          `Roster over limit by ${overBy} (${countable}/${maxSize} countable players)`,
          `Move ${player.name} to taxi — ${player.yearsExp ?? 0} yr(s) exp (league max ${taxiYears} for taxi)`,
          'Taxi players do not count against your roster limit on Sleeper',
        ],
        newsSnippets: [],
      });
      used.add(player.playerId);
    }
  }

  const remainingCuts =
    overBy -
    recommendations.filter((r) => r.kind === 'move_to_taxi').length;

  if (remainingCuts > 0) {
    const dropCandidates = getComplianceDropCandidates(team, performance, used);

    for (const chosen of dropCandidates) {
      if (recommendations.filter((r) => r.kind === 'roster_drop').length >= remainingCuts) break;
      if (recommendations.length >= maxRecommendations) break;
      if (used.has(chosen.player.playerId)) continue;
      if (chosen.score <= 0) continue;

      const { player, score, tags, summary } = chosen;
      const equalAlts = findEqualDropAlternatives(dropCandidates, chosen).filter(
        (p) => !used.has(p.playerId) || p.playerId === player.playerId
      );
      const altRefs = equalAlts.map((p) => {
        const match = dropCandidates.find((c) => c.player.playerId === p.playerId);
        return playerRef(p, match ? [...match.tags, 'roster_compliance'] : ['roster_compliance']);
      });

      recommendations.push({
        kind: 'roster_drop',
        dropPlayer: playerRef(player, [...tags, 'roster_compliance']),
        dropAlternatives: altRefs.length > 1 ? altRefs : undefined,
        confidence: Math.min(0.98, 0.75 + score * 0.2),
        rationale: [
          `Roster over limit by ${overBy} (${countable}/${maxSize} countable; taxi squad excluded)`,
          `Drop ${player.name} (${player.position}) — ${summary}`,
          altRefs.length > 1
            ? `Equally good cuts: ${altRefs.map((a) => a.name).join(', ')} — pick any in the app`
            : taxiSlots > 0
              ? `Taxi squad: ${taxiCount}/${taxiSlots} filled`
              : 'No taxi squad in this league',
          altRefs.length > 1 && taxiSlots > 0
            ? `Taxi squad: ${taxiCount}/${taxiSlots} filled`
            : '',
        ].filter(Boolean),
        newsSnippets: [],
      });
      used.add(player.playerId);
    }
  }

  return recommendations;
}

export function getRosterComplianceSummary(team: ITeam): {
  countable: number;
  maxSize: number;
  overBy: number;
  taxiCount: number;
  taxiSlots: number;
} {
  const countable = countableRoster(team);
  const maxSize = team.settings.maxRosterSize ?? 0;
  return {
    countable,
    maxSize,
    overBy: Math.max(0, countable - maxSize),
    taxiCount: team.roster.taxi?.length ?? 0,
    taxiSlots: team.settings.taxiSlots ?? 0,
  };
}
