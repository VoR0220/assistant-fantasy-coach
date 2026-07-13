import type { ITeam } from '../../models/Team.js';
import type { SwapRecommendationInput } from '../../types/index.js';
import type { OptimizerInput } from './index.js';
import { generateAllLineupRecommendations, generateInjuryLineupRecommendations } from './lineup.js';
import { generateSwapRecommendations } from './index.js';
import { generateRosterComplianceRecommendations, getRosterComplianceSummary } from './compliance.js';
import {
  buildComplianceDropFacts,
  buildWaiverAddFacts,
  buildWaiverDropFacts,
} from './candidates.js';
import { assessTeam, maxRecommendationsForGoal, type TeamAssessment } from './planner.js';
import { synthesizeRecommendations } from './synthesis.js';
import { isLlmEnabled } from '../llm/client.js';
import {
  gatherPlayerIntel,
  identifyResearchTargets,
} from './playerIntel.js';

export interface RosterAgentInput extends OptimizerInput {
  /** Recent decision summaries for LLM personalization */
  userPreferences?: string[];
  /** Set false to skip LLM even when API key is present */
  synthesize?: boolean;
}

export interface RosterAgentResult {
  recommendations: SwapRecommendationInput[];
  assessment: TeamAssessment;
  agentTrace: string[];
  llmUsed: boolean;
}

function buildUserPreferences(tagWeights?: Record<string, number>): string[] {
  if (!tagWeights) return [];
  const prefs: string[] = [];
  for (const [tag, weight] of Object.entries(tagWeights)) {
    if (weight < 0.4) prefs.push(`User often dismisses suggestions tagged: ${tag}`);
    if (weight > 0.75) prefs.push(`User often accepts suggestions tagged: ${tag}`);
  }
  return prefs.slice(0, 6);
}

/**
 * Goal-directed roster agent: assess team state, run only relevant optimizers,
 * then optionally synthesize comparative rationales via LLM.
 */
export async function runRosterAgent(input: RosterAgentInput): Promise<RosterAgentResult> {
  const {
    team,
    performance,
    leagueNews = [],
    tagWeights,
    userPreferences,
    synthesize = true,
  } = input;

  const assessment = assessTeam(team, performance);
  const trace: string[] = [
    `Assessment: ${assessment.summary}`,
    `Goals: ${assessment.goals.join(' → ')}`,
  ];

  const recommendations: SwapRecommendationInput[] = [];
  const compliance = getRosterComplianceSummary(team);

  for (const goal of assessment.goals) {
    const max = maxRecommendationsForGoal(goal);

    switch (goal) {
      case 'roster_compliance': {
        const complianceRecs = generateRosterComplianceRecommendations({
          team,
          performance,
          maxRecommendations: max,
        });
        recommendations.push(...complianceRecs);
        trace.push(`Compliance: ${complianceRecs.length} recommendation(s)`);
        break;
      }
      case 'lineup_injury': {
        const injuryRecs = generateInjuryLineupRecommendations({
          team,
          performance,
          maxRecommendations: max,
        });
        recommendations.push(...injuryRecs);
        trace.push(`Injury lineup: ${injuryRecs.length} recommendation(s)`);
        break;
      }
      case 'lineup_flex': {
        const flexRecs = generateAllLineupRecommendations({
          team,
          performance,
          maxRecommendations: max,
        }).filter((r) => r.kind === 'lineup_flex_move');
        recommendations.push(...flexRecs);
        trace.push(`Flex optimization: ${flexRecs.length} recommendation(s)`);
        break;
      }
      case 'waiver_upgrades': {
        const swapRecs = generateSwapRecommendations({
          ...input,
          maxRecommendations: max,
        });
        recommendations.push(...swapRecs);
        trace.push(`Waiver swaps: ${swapRecs.length} recommendation(s)`);
        break;
      }
    }
  }

  const llmOn = synthesize && isLlmEnabled();
  if (llmOn) {
    trace.push('LLM synthesis: enabled');
  } else {
    trace.push(
      isLlmEnabled()
        ? 'LLM synthesis: skipped (synthesize=false)'
        : 'LLM synthesis: disabled (no OPENAI_API_KEY)'
    );
  }

  let finalRecs = recommendations;
  if (llmOn) {
    const cutsNeeded = Math.max(
      0,
      compliance.overBy -
        recommendations.filter((r) => r.kind === 'move_to_taxi').length
    );

    const researchTargets = identifyResearchTargets(
      team,
      assessment,
      recommendations,
      performance
    );
    const playerIntel = gatherPlayerIntel(team, performance, leagueNews, researchTargets);
    trace.push(`Player research: ${researchTargets.length} dossier(s) built`);

    finalRecs = await synthesizeRecommendations(
      {
        team,
        assessment,
        leagueNews,
        userPreferences: userPreferences ?? buildUserPreferences(tagWeights),
        playerIntel,
      },
      recommendations,
      {
        complianceDropCandidates: buildComplianceDropFacts(team, performance, leagueNews),
        cutsNeeded,
        waiverDropCandidates: buildWaiverDropFacts(team, performance, leagueNews),
        waiverAddCandidates: buildWaiverAddFacts(team, leagueNews),
      }
    );
    trace.push(`LLM synthesis complete: ${finalRecs.length} recommendation(s)`);
  }

  return {
    recommendations: finalRecs,
    assessment,
    agentTrace: trace,
    llmUsed: llmOn,
  };
}

/** Synchronous fallback — runs goal-directed planner without LLM. */
export function runRosterAgentSync(input: RosterAgentInput): Omit<RosterAgentResult, 'llmUsed'> & { llmUsed: false } {
  const assessment = assessTeam(input.team, input.performance);
  const trace: string[] = [`Assessment: ${assessment.summary}`, `Goals: ${assessment.goals.join(' → ')}`];
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
        recommendations.push(
          ...generateSwapRecommendations({ ...input, maxRecommendations: max })
        );
        break;
    }
  }

  return { recommendations, assessment, agentTrace: trace, llmUsed: false };
}
