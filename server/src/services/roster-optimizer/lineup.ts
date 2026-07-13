import type { ITeam } from '../../models/Team.js';
import type {
  LineupActionInput,
  PlayerEntry,
  PlayerWeekStats,
  SwapRecommendationInput,
} from '../../types/index.js';
import { isInactivePlayer, isWithoutNflTeam } from './playerAvailability.js';

const MUST_SIT = new Set(['OUT', 'IR', 'PUP', 'SUSP', 'DOUBTFUL']);
const QUESTIONABLE = new Set(['QUESTIONABLE', 'Q', 'GTD']);

const FLEX_SLOTS = new Set(['FLEX', 'REC_FLEX', 'W/R/T', 'RB/WR/TE', 'FLEX_WR', 'FLEX_RB']);
const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);

function normalizeSlot(slot: string): string {
  const upper = slot.toUpperCase();
  if (upper.includes('FLEX') || upper === 'W/R/T' || upper === 'RB/WR/TE') return 'FLEX';
  if (upper.startsWith('RB')) return 'RB';
  if (upper.startsWith('WR')) return 'WR';
  if (upper.startsWith('TE')) return 'TE';
  if (upper.startsWith('QB')) return 'QB';
  if (upper.startsWith('K')) return 'K';
  if (upper.includes('DEF') || upper === 'D/ST') return 'DEF';
  return upper;
}

function isInjured(status?: string, mustSitOnly = false): boolean {
  if (!status) return false;
  const upper = status.toUpperCase();
  if (MUST_SIT.has(upper)) return true;
  if (!mustSitOnly && QUESTIONABLE.has(upper)) return true;
  return false;
}

function isHealthy(status?: string): boolean {
  return !status || (!MUST_SIT.has(status.toUpperCase()) && !QUESTIONABLE.has(status.toUpperCase()));
}

function isViableBenchPlayer(p: PlayerEntry): boolean {
  if (isWithoutNflTeam(p) || isInactivePlayer(p)) return false;
  return isHealthy(p.injuryStatus);
}

function playerRef(p: PlayerEntry, tags?: string[]) {
  return {
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    reasonTags: tags,
  };
}

function slotCapacity(settings: ITeam['settings']): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const [slot, count] of Object.entries(settings.rosterSlots)) {
    caps[normalizeSlot(slot)] = (caps[normalizeSlot(slot)] ?? 0) + count;
  }
  if (!caps.FLEX && (caps.RB || caps.WR || caps.TE)) {
    caps.FLEX = 1;
  }
  return caps;
}

function countStartersBySlot(starters: PlayerEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of starters) {
    const slot = normalizeSlot(p.lineupSlot ?? p.position);
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return counts;
}

function canFillSlot(player: PlayerEntry, slot: string): boolean {
  const normalized = normalizeSlot(slot);
  if (normalized === 'FLEX') return FLEX_ELIGIBLE.has(player.position);
  return player.position === normalized;
}

function benchScore(p: PlayerEntry, perfMap: Record<string, PlayerWeekStats>): number {
  const perf = perfMap[p.playerId];
  return perf?.avgPoints ?? 0;
}

export interface LineupOptimizerInput {
  team: ITeam;
  performance: PlayerWeekStats[];
  maxRecommendations?: number;
}

/** Sit injured/questionable starters and start the best healthy bench replacement. */
export function generateInjuryLineupRecommendations(
  input: LineupOptimizerInput
): SwapRecommendationInput[] {
  const { team, performance, maxRecommendations = 5 } = input;
  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  const recommendations: SwapRecommendationInput[] = [];
  const usedBench = new Set<string>();

  const injuredStarters = team.roster.starters.filter((p) =>
    isInjured(p.injuryStatus, false)
  );

  for (const injured of injuredStarters) {
    if (recommendations.length >= maxRecommendations) break;

    const targetSlot = normalizeSlot(injured.lineupSlot ?? injured.position);
    const benchCandidates = team.roster.bench
      .filter((b) => isViableBenchPlayer(b) && !usedBench.has(b.playerId))
      .filter((b) => canFillSlot(b, targetSlot))
      .sort((a, b) => benchScore(b, perfMap) - benchScore(a, perfMap));

    const replacement = benchCandidates[0];
    if (!replacement) {
      recommendations.push({
        kind: 'lineup_sit_start',
        lineupAction: {
          sitPlayer: playerRef(injured, ['injured_starter', injured.injuryStatus ?? 'injury']),
          fromSlot: targetSlot,
        },
        confidence: 0.9,
        rationale: [
          `Sit ${injured.name} (${injured.injuryStatus ?? 'injured'}) — currently in your ${targetSlot} slot`,
          `No healthy bench player eligible for ${targetSlot}. Check waivers or move a FLEX player first.`,
        ],
        newsSnippets: [],
      });
      continue;
    }

    recommendations.push({
      kind: 'lineup_sit_start',
      lineupAction: {
        sitPlayer: playerRef(injured, ['injured_starter', injured.injuryStatus ?? 'injury']),
        startPlayer: playerRef(replacement, ['bench_upgrade', 'injury_replacement']),
        fromSlot: targetSlot,
        toSlot: targetSlot,
      },
      confidence: injured.injuryStatus && MUST_SIT.has(injured.injuryStatus.toUpperCase()) ? 0.95 : 0.75,
      rationale: [
        `Sit ${injured.name} (${injured.injuryStatus ?? 'injury risk'}) in ${targetSlot}`,
        `Start ${replacement.name} from bench (+${benchScore(replacement, perfMap).toFixed(1)} avg pts)`,
        `Avoid leaving an injured player in your active lineup`,
      ],
      newsSnippets: [],
    });
    usedBench.add(replacement.playerId);
  }

  return recommendations;
}

/**
 * Move a FLEX player into their native position when that slot has capacity,
 * freeing FLEX for injury replacements or future flexibility.
 */
export function generateFlexRepositionRecommendations(
  input: LineupOptimizerInput
): SwapRecommendationInput[] {
  const { team, performance, maxRecommendations = 3 } = input;
  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  const caps = slotCapacity(team.settings);
  const slotCounts = countStartersBySlot(team.roster.starters);
  const recommendations: SwapRecommendationInput[] = [];

  const flexStarters = team.roster.starters.filter((p) => {
    const slot = normalizeSlot(p.lineupSlot ?? '');
    return FLEX_SLOTS.has(slot) || slot === 'FLEX';
  });

  for (const flexPlayer of flexStarters) {
    if (recommendations.length >= maxRecommendations) break;

    const nativePos = flexPlayer.position;
    if (!FLEX_ELIGIBLE.has(nativePos)) continue;

    const nativeCap = caps[nativePos] ?? 0;
    const nativeFilled = slotCounts[nativePos] ?? 0;
    if (nativeFilled >= nativeCap) continue;

    const injuredAtNative = team.roster.starters.some(
      (p) =>
        p.position === nativePos &&
        normalizeSlot(p.lineupSlot ?? p.position) === nativePos &&
        isInjured(p.injuryStatus, true)
    );

    recommendations.push({
      kind: 'lineup_flex_move',
      lineupAction: {
        movePlayer: playerRef(flexPlayer, ['flex_optimization']),
        fromSlot: 'FLEX',
        toSlot: nativePos,
        freesSlot: 'FLEX',
      },
      confidence: injuredAtNative ? 0.92 : 0.7,
      rationale: [
        `Move ${flexPlayer.name} from FLEX to ${nativePos} (${nativeFilled}/${nativeCap} filled)`,
        `Frees FLEX for ${injuredAtNative ? 'an injury replacement or ' : ''}RB/WR/TE subs`,
        injuredAtNative
          ? `You have an injured ${nativePos} — opening FLEX gives more substitution options`
          : `Proactive flex management: keep FLEX open before another position needs a sub`,
      ],
      newsSnippets: [],
    });

    slotCounts[nativePos] = (slotCounts[nativePos] ?? 0) + 1;
    slotCounts.FLEX = Math.max(0, (slotCounts.FLEX ?? 1) - 1);
  }

  // After flex moves, re-check if injured starters can now use freed FLEX via bench WR/RB/TE
  const injuredNonFlex = team.roster.starters.filter(
    (p) =>
      isInjured(p.injuryStatus, true) &&
      !FLEX_SLOTS.has(normalizeSlot(p.lineupSlot ?? ''))
  );

  for (const injured of injuredNonFlex) {
    if (recommendations.length >= maxRecommendations) break;

    const hasFlexMove = recommendations.some((r) => r.kind === 'lineup_flex_move');
    if (!hasFlexMove) continue;

    const flexSub = team.roster.bench.find(
      (b) =>
        isViableBenchPlayer(b) &&
        FLEX_ELIGIBLE.has(b.position) &&
        !canFillSlot(b, injured.position)
    );

    if (flexSub) {
      recommendations.push({
        kind: 'lineup_sit_start',
        lineupAction: {
          sitPlayer: playerRef(injured, ['injured_starter']),
          startPlayer: playerRef(flexSub, ['flex_eligible_sub']),
          fromSlot: normalizeSlot(injured.lineupSlot ?? injured.position),
          toSlot: 'FLEX',
          freesSlot: injured.position,
        },
        confidence: 0.85,
        rationale: [
          `After moving a player off FLEX, start ${flexSub.name} in FLEX`,
          `Covers ${injured.name} (${injured.injuryStatus}) at ${injured.position} indirectly`,
        ],
        newsSnippets: [],
      });
    }
  }

  return recommendations;
}

export function generateAllLineupRecommendations(
  input: LineupOptimizerInput
): SwapRecommendationInput[] {
  const flexFirst = generateFlexRepositionRecommendations(input);
  const injury = generateInjuryLineupRecommendations(input);
  return [...flexFirst, ...injury].slice(0, input.maxRecommendations ?? 8);
}
