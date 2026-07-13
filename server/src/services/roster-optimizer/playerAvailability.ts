import type { PlayerEntry } from '../../types/index.js';

const INACTIVE_STATUSES = new Set([
  'Inactive',
  'Retired',
  'Physically Unable to Perform',
  'Non Football Injury',
  'Practice Squad',
]);

const SEASON_ENDING_INJURY = new Set(['OUT', 'IR', 'PUP', 'SUSP', 'DOUBTFUL']);

export interface AvailabilityScore {
  /** 0–1; higher = stronger drop candidate */
  score: number;
  tags: string[];
  /** Plain-language reason for rationales */
  summary: string;
}

/** True when the player has no current NFL team in Sleeper's player DB. */
export function isWithoutNflTeam(player: PlayerEntry): boolean {
  return !player.team || player.team.trim() === '';
}

/** True when Sleeper marks the player inactive / not fantasy-relevant. */
export function isInactivePlayer(player: PlayerEntry): boolean {
  if (player.active === false) return true;
  const status = player.playerStatus?.trim();
  return Boolean(status && INACTIVE_STATUSES.has(status));
}

/**
 * Score how strongly a player should be dropped for roster compliance or waiver moves.
 * Availability (NFL team, active status) dominates depth-of-bench heuristics.
 */
export function scorePlayerAvailability(player: PlayerEntry): AvailabilityScore {
  if (isInactivePlayer(player)) {
    const status = player.playerStatus ?? 'Inactive';
    return {
      score: 1,
      tags: ['inactive', 'no_fantasy_value'],
      summary: `${status} in Sleeper — not a playable asset`,
    };
  }

  if (isWithoutNflTeam(player)) {
    return {
      score: 0.95,
      tags: ['no_nfl_team', 'free_agent'],
      summary: 'Not on an NFL roster — no upcoming-season fantasy value',
    };
  }

  if (player.injuryStatus && SEASON_ENDING_INJURY.has(player.injuryStatus.toUpperCase())) {
    return {
      score: 0.75,
      tags: ['injury', player.injuryStatus.toLowerCase()],
      summary: `Listed ${player.injuryStatus} — limited or no near-term value`,
    };
  }

  return { score: 0, tags: [], summary: '' };
}

/** Players who should never be stashed on taxi — dead roster weight. */
export function isTaxiStashCandidate(player: PlayerEntry, taxiYears?: number): boolean {
  if (isInactivePlayer(player) || isWithoutNflTeam(player)) return false;
  if (taxiYears === undefined || taxiYears === null) return false;
  return (player.yearsExp ?? 99) <= taxiYears;
}
