import type { ITeam } from '../../models/Team.js';
import type { PlayerWeekStats } from '../../types/index.js';
import { getRosterComplianceSummary } from './compliance.js';

const MUST_SIT = new Set(['OUT', 'IR', 'PUP', 'SUSP', 'DOUBTFUL']);
const QUESTIONABLE = new Set(['QUESTIONABLE', 'Q', 'GTD']);

export type AgentGoal =
  | 'roster_compliance'
  | 'lineup_injury'
  | 'lineup_flex'
  | 'waiver_upgrades';

export interface TeamAssessment {
  /** Goals to pursue this run, in priority order */
  goals: AgentGoal[];
  primaryGoal: AgentGoal;
  context: {
    overBy: number;
    countable: number;
    maxSize: number;
    taxiCount: number;
    taxiSlots: number;
    injuredStarters: number;
    questionableStarters: number;
    freeAgentCount: number;
  };
  /** Human-readable summary for agent trace / UI */
  summary: string;
}

function isInjured(status?: string, includeQuestionable = false): boolean {
  if (!status) return false;
  const upper = status.toUpperCase();
  if (MUST_SIT.has(upper)) return true;
  if (includeQuestionable && QUESTIONABLE.has(upper)) return true;
  return false;
}

function countInjuredStarters(team: ITeam): { injured: number; questionable: number } {
  let injured = 0;
  let questionable = 0;
  for (const p of team.roster.starters) {
    if (!p.injuryStatus) continue;
    const upper = p.injuryStatus.toUpperCase();
    if (MUST_SIT.has(upper)) injured += 1;
    else if (QUESTIONABLE.has(upper)) questionable += 1;
  }
  return { injured, questionable };
}

/**
 * Decide which optimization goals apply to this team right now.
 * Compliance blocks waivers; injury lineup takes priority over flex tinkering.
 */
export function assessTeam(team: ITeam, _performance: PlayerWeekStats[]): TeamAssessment {
  const compliance = getRosterComplianceSummary(team);
  const { injured, questionable } = countInjuredStarters(team);
  const freeAgentCount = team.freeAgentsCache?.players?.length ?? 0;

  const context = {
    overBy: compliance.overBy,
    countable: compliance.countable,
    maxSize: compliance.maxSize,
    taxiCount: compliance.taxiCount,
    taxiSlots: compliance.taxiSlots,
    injuredStarters: injured,
    questionableStarters: questionable,
    freeAgentCount,
  };

  if (compliance.overBy > 0) {
    const taxiNote =
      compliance.taxiSlots > 0 && compliance.taxiCount < compliance.taxiSlots
        ? ` Taxi has ${compliance.taxiSlots - compliance.taxiCount} open slot(s) — try that before cuts.`
        : compliance.taxiSlots > 0
          ? ` Taxi is full (${compliance.taxiCount}/${compliance.taxiSlots}).`
          : '';
    const goals: AgentGoal[] = ['roster_compliance'];
    const also: string[] = [];
    if (injured > 0 || questionable > 0) {
      goals.push('lineup_injury');
      also.push(
        `${injured + questionable} starter(s) flagged (injury/questionable) — lineup advisories included.`
      );
    }
    return {
      goals,
      primaryGoal: 'roster_compliance',
      context,
      summary: `Roster is ${compliance.countable}/${compliance.maxSize} (${compliance.overBy} over limit). Focus: compliance first.${taxiNote}${also.length ? ` ${also.join(' ')}` : ''}`,
    };
  }

  const goals: AgentGoal[] = [];

  if (injured > 0 || questionable > 0) {
    goals.push('lineup_injury');
  }

  const hasFlexStarters = team.roster.starters.some((p) => {
    const slot = (p.lineupSlot ?? p.position).toUpperCase();
    return slot.includes('FLEX') || slot === 'W/R/T' || slot === 'RB/WR/TE';
  });
  if (hasFlexStarters || injured > 0) {
    goals.push('lineup_flex');
  }

  if (freeAgentCount > 0) {
    goals.push('waiver_upgrades');
  }

  if (goals.length === 0) {
    goals.push('lineup_flex');
  }

  const primaryGoal = goals[0];
  const parts: string[] = ['Roster is compliant.'];
  if (injured > 0) parts.push(`${injured} starter(s) must sit.`);
  if (questionable > 0) parts.push(`${questionable} questionable starter(s).`);
  if (goals.includes('waiver_upgrades')) parts.push('Scanning waivers for upgrades.');

  return {
    goals,
    primaryGoal,
    context,
    summary: parts.join(' '),
  };
}

export function maxRecommendationsForGoal(goal: AgentGoal): number {
  switch (goal) {
    case 'roster_compliance':
      return 5;
    case 'lineup_injury':
      return 5;
    case 'lineup_flex':
      return 3;
    case 'waiver_upgrades':
      return 3;
    default:
      return 3;
  }
}
