import type { ITeam } from '../../models/Team.js';
import type { NewsSnippet, SwapRecommendationInput } from '../../types/index.js';
import { chatCompletion, isLlmEnabled } from '../llm/client.js';
import type { PlayerCandidateFacts, WaiverAddFacts } from './candidates.js';
import type { TeamAssessment } from './planner.js';
import { getRosterComplianceSummary } from './compliance.js';
import {
  formatIntelForLlm,
  intelNewsSnippets,
  type PlayerIntelDossier,
} from './playerIntel.js';

import {
  citeAgent,
  citeLeague,
  normalizeRationaleLines,
  type RationaleLine,
} from './citations.js';

export interface SynthesisContext {
  team: ITeam;
  assessment: TeamAssessment;
  leagueNews: NewsSnippet[];
  /** Recent user decisions for personalization */
  userPreferences?: string[];
  /** Researched player dossiers keyed by playerId */
  playerIntel?: Record<string, PlayerIntelDossier>;
}

interface LlmDropDecision {
  selectedPlayerIds: string[];
  confidence: number;
  rationale: Array<string | RationaleLine>;
  comparedAlternatives?: string | RationaleLine;
}

interface LlmSwapDecision {
  dropPlayerId: string;
  addPlayerId: string;
  confidence: number;
  rationale: Array<string | RationaleLine>;
}

interface LlmLineupDecision {
  recommendationIndex: number;
  confidence: number;
  rationale: Array<string | RationaleLine>;
}

function parseJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(json) as T;
}

function playerById(team: ITeam, playerId: string) {
  const all = [
    ...team.roster.starters,
    ...team.roster.bench,
    ...(team.roster.ir ?? []),
    ...(team.roster.taxi ?? []),
  ];
  return all.find((p) => p.playerId === playerId);
}

function formatCandidates(candidates: PlayerCandidateFacts[]): string {
  return JSON.stringify(
    candidates.map((c) => ({
      playerId: c.playerId,
      name: c.name,
      position: c.position,
      nflTeam: c.nflTeam,
      status: c.playerStatus,
      active: c.active,
      injury: c.injuryStatus,
      avgPoints: c.avgPoints,
      depthAtPosition: c.depthAtPosition,
      ruleScore: c.ruleScore,
      summary: c.summary,
      news: c.newsHeadlines,
    })),
    null,
    2
  );
}

const SYSTEM_PROMPT = `You are a fantasy football roster agent. You receive structured player research dossiers with citedFacts and newsFromMcpRss (RSS feeds via the sports-trends MCP).

Rules:
- Never recommend dropping a player who is in the starting lineup.
- Strongly prefer dropping players with no NFL team (nflTeam null) or inactive status over active rostered players.
- EVERY rationale line MUST include a citation copied from citedFacts.*.source or newsFromMcpRss[].citationLabel.
- Prefer News / MCP citations when a matching headline exists; otherwise use Sleeper / league / rule engine sources from the dossiers.
- Do not invent headlines, URLs, or sources not present in the input.
- Compare alternatives explicitly.
- Output valid JSON only.`;

const RATIONALE_SCHEMA = `"rationale": [
  {
    "text": "claim about the player or roster",
    "source": "exact citation from citedFacts.*.source OR newsFromMcpRss[].citationLabel (e.g. News / MCP · ESPN · “headline”)",
    "url": "optional URL from newsFromMcpRss when citing news",
    "sourceKind": "sleeper|news|league|rule_engine|performance|mcp|agent"
  }
]`;

function buildCitedRationale(
  decisionRationale: unknown,
  comparedAlternatives: unknown,
  complianceHeader: RationaleLine
): RationaleLine[] {
  const lines = [complianceHeader, ...normalizeRationaleLines(decisionRationale)];
  if (comparedAlternatives) {
    lines.push(...normalizeRationaleLines([comparedAlternatives], 'Agent · alternatives'));
  }
  // Ensure every line has a source
  return lines.map((l) =>
    l.source?.trim()
      ? l
      : citeAgent(l.text, 'synthesis (missing source)')
  );
}

export async function synthesizeComplianceDrops(
  ctx: SynthesisContext,
  candidates: PlayerCandidateFacts[],
  cutsNeeded: number,
  draftRecs: SwapRecommendationInput[]
): Promise<SwapRecommendationInput[]> {
  if (!isLlmEnabled() || candidates.length === 0 || cutsNeeded === 0) {
    return draftRecs;
  }

  const compliance = getRosterComplianceSummary(ctx.team);
  const userMsg = `Goal: roster_compliance — team is ${compliance.countable}/${compliance.maxSize} (${compliance.overBy} over limit).
Team: ${ctx.team.teamName}
Taxi: ${compliance.taxiCount}/${compliance.taxiSlots} filled
Cuts needed: ${cutsNeeded}

Bench drop candidates (rule engine pre-ranked):
${formatCandidates(candidates)}

Player research dossiers (news, stats, injury — use these for rationale):
${ctx.playerIntel ? formatIntelForLlm(ctx.playerIntel) : 'No dossiers available'}

${ctx.userPreferences?.length ? `User preferences from past decisions:\n${ctx.userPreferences.join('\n')}` : ''}

Return JSON:
{
  "selectedPlayerIds": ["id1", ...],
  "confidence": 0.0-1.0,
  ${RATIONALE_SCHEMA},
  "comparedAlternatives": {
    "text": "why not the other equal cuts / active players",
    "source": "Rule engine · availability tier OR News / MCP citation",
    "sourceKind": "rule_engine"
  }
}

Select exactly ${cutsNeeded} playerId(s) from the candidates. Prefer no-NFL-team players.
Every rationale line MUST have a non-empty source field copied from the dossiers.`;

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { jsonMode: true, temperature: 0.2 }
    );
    const decision = parseJson<LlmDropDecision>(raw);

    const taxiRecs = draftRecs.filter((r) => r.kind === 'move_to_taxi');
    const dropRecs = draftRecs.filter((r) => r.kind === 'roster_drop');
    const otherRecs = draftRecs.filter(
      (r) => r.kind !== 'roster_drop' && r.kind !== 'move_to_taxi'
    );
    if (dropRecs.length === 0) return draftRecs;

    const selectedIds = decision.selectedPlayerIds.slice(0, cutsNeeded);
    const enhancedDrops: SwapRecommendationInput[] = [];

    for (let i = 0; i < dropRecs.length; i++) {
      const draft = dropRecs[i];
      const selectedId = selectedIds[i] ?? draft.dropPlayer?.playerId;
      const player = selectedId ? playerById(ctx.team, selectedId) : undefined;
      const candidate = candidates.find((c) => c.playerId === selectedId);

      if (!player || !candidate) {
        enhancedDrops.push(draft);
        continue;
      }

      const rationale =
        i === 0 && (decision.rationale?.length ?? 0) > 0
          ? buildCitedRationale(
              decision.rationale,
              decision.comparedAlternatives,
              citeLeague(
                `Roster over limit by ${compliance.overBy} (${compliance.countable}/${compliance.maxSize})`,
                `countable=${compliance.countable}, max=${compliance.maxSize}`
              )
            )
          : draft.rationale;

      enhancedDrops.push({
        ...draft,
        dropPlayer: {
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          reasonTags: [...candidate.tags, 'agent_selected', 'roster_compliance'],
        },
        dropAlternatives: (() => {
          const alts =
            draft.dropAlternatives && draft.dropAlternatives.length > 1
              ? draft.dropAlternatives
              : candidates
                  .filter((c) => {
                    const chosenTags = candidate.tags;
                    const sameTiers =
                      (chosenTags.includes('no_nfl_team') && c.tags.includes('no_nfl_team')) ||
                      (chosenTags.includes('inactive') && c.tags.includes('inactive'));
                    return sameTiers && Math.abs(c.ruleScore - candidate.ruleScore) <= 0.08;
                  })
                  .slice(0, 5)
                  .map((c) => ({
                    playerId: c.playerId,
                    name: c.name,
                    position: c.position,
                    reasonTags: [...c.tags, 'roster_compliance'],
                  }));
          return alts.length > 1 ? alts : undefined;
        })(),
        confidence: Math.min(0.98, decision.confidence || draft.confidence),
        rationale,
        newsSnippets: ctx.playerIntel
          ? intelNewsSnippets(ctx.playerIntel, selectedIds)
          : candidate.newsHeadlines.map((h) => ({ headline: h, source: 'news' })),
      });
    }

    return [...taxiRecs, ...enhancedDrops, ...otherRecs];
  } catch {
    return draftRecs;
  }
}

export async function synthesizeWaiverSwap(
  ctx: SynthesisContext,
  dropCandidates: PlayerCandidateFacts[],
  addCandidates: WaiverAddFacts[],
  draftRec: SwapRecommendationInput | undefined
): Promise<SwapRecommendationInput | undefined> {
  if (!isLlmEnabled() || !draftRec || dropCandidates.length === 0 || addCandidates.length === 0) {
    return draftRec;
  }

  const userMsg = `Goal: waiver_upgrades for ${ctx.team.teamName}
Assessment: ${ctx.assessment.summary}

Drop candidates:
${formatCandidates(dropCandidates)}

Add candidates:
${JSON.stringify(addCandidates, null, 2)}

Player research dossiers:
${ctx.playerIntel ? formatIntelForLlm(ctx.playerIntel) : 'No dossiers'}

Return JSON:
{
  "dropPlayerId": "...",
  "addPlayerId": "...",
  "confidence": 0.0-1.0,
  ${RATIONALE_SCHEMA}
}

Pick one drop and one add. Do not drop players with nflTeam unless depth is extreme.
Every rationale line MUST cite a dossier source (News / MCP, Sleeper, or performance).`;

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { jsonMode: true, temperature: 0.3 }
    );
    const decision = parseJson<LlmSwapDecision>(raw);

    const drop = dropCandidates.find((c) => c.playerId === decision.dropPlayerId);
    const add = addCandidates.find((c) => c.playerId === decision.addPlayerId);
    if (!drop || !add) return draftRec;

    return {
      kind: 'add_drop',
      dropPlayer: {
        playerId: drop.playerId,
        name: drop.name,
        position: drop.position,
        reasonTags: [...drop.tags, 'agent_selected'],
      },
      addPlayer: {
        playerId: add.playerId,
        name: add.name,
        position: add.position,
        reasonTags: [...add.tags, 'agent_selected'],
      },
      confidence: Math.min(0.95, decision.confidence),
      rationale: normalizeRationaleLines(decision.rationale),
      newsSnippets: draftRec.newsSnippets,
    };
  } catch {
    return draftRec;
  }
}

export async function synthesizeLineupRecs(
  ctx: SynthesisContext,
  draftRecs: SwapRecommendationInput[]
): Promise<SwapRecommendationInput[]> {
  if (!isLlmEnabled() || draftRecs.length === 0) return draftRecs;

  const lineupRecs = draftRecs.filter(
    (r) => r.kind === 'lineup_sit_start' || r.kind === 'lineup_flex_move'
  );
  if (lineupRecs.length === 0) return draftRecs;

  const involvedIds = new Set<string>();
  for (const r of lineupRecs) {
    const la = r.lineupAction;
    if (la?.sitPlayer) involvedIds.add(la.sitPlayer.playerId);
    if (la?.startPlayer) involvedIds.add(la.startPlayer.playerId);
    if (la?.movePlayer) involvedIds.add(la.movePlayer.playerId);
  }

  const relevantIntel = ctx.playerIntel
    ? Object.fromEntries(
        Object.entries(ctx.playerIntel).filter(([id]) => involvedIds.has(id))
      )
    : {};

  const summaries = lineupRecs.map((r, i) => ({
    index: i,
    kind: r.kind,
    action: r.lineupAction,
    draftRationale: r.rationale,
  }));

  const userMsg = `Goal: lineup_injury / sit-start advisory for ${ctx.team.teamName}
Assessment: ${ctx.assessment.summary}

Draft lineup recommendations (keep the same actions — only improve rationale):
${JSON.stringify(summaries, null, 2)}

Player research dossiers for involved players:
${Object.keys(relevantIntel).length > 0 ? formatIntelForLlm(relevantIntel) : formatIntelForLlm(ctx.playerIntel ?? {})}

Return JSON:
{
  "recommendations": [
    {
      "recommendationIndex": 0,
      "confidence": 0.0-1.0,
      ${RATIONALE_SCHEMA}
    }
  ]
}

Every rationale line MUST cite injuryStatus (Sleeper roster sync), performance, or News / MCP headlines from the dossiers.
For questionable players, explain start vs sit risk with citations.`;

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { jsonMode: true, temperature: 0.3 }
    );
    const decision = parseJson<{ recommendations: LlmLineupDecision[] }>(raw);

    const enhanced = [...draftRecs];
    for (const item of decision.recommendations) {
      const idx = lineupRecs.findIndex((_, i) => i === item.recommendationIndex);
      if (idx < 0) continue;
      const globalIdx = draftRecs.indexOf(lineupRecs[idx]);
      if (globalIdx < 0) continue;

      const rec = enhanced[globalIdx];
      const ids = [
        rec.lineupAction?.sitPlayer?.playerId,
        rec.lineupAction?.startPlayer?.playerId,
        rec.lineupAction?.movePlayer?.playerId,
      ].filter(Boolean) as string[];

      const cited = normalizeRationaleLines(item.rationale);
      enhanced[globalIdx] = {
        ...rec,
        confidence: item.confidence ?? rec.confidence,
        rationale: cited.length > 0 ? cited : rec.rationale,
        newsSnippets: ctx.playerIntel
          ? intelNewsSnippets(ctx.playerIntel, ids)
          : rec.newsSnippets,
      };
    }
    return enhanced;
  } catch {
    return draftRecs;
  }
}

export async function synthesizeRecommendations(
  ctx: SynthesisContext,
  recommendations: SwapRecommendationInput[],
  options: {
    complianceDropCandidates?: PlayerCandidateFacts[];
    cutsNeeded?: number;
    waiverDropCandidates?: PlayerCandidateFacts[];
    waiverAddCandidates?: WaiverAddFacts[];
  }
): Promise<SwapRecommendationInput[]> {
  if (!isLlmEnabled() || recommendations.length === 0) return recommendations;

  let result = recommendations;

  if (ctx.assessment.primaryGoal === 'roster_compliance') {
    const cutsNeeded =
      options.cutsNeeded ??
      result.filter((r) => r.kind === 'roster_drop').length;
    result = await synthesizeComplianceDrops(
      ctx,
      options.complianceDropCandidates ?? [],
      cutsNeeded,
      result
    );
  }

  const lineupKinds = new Set(['lineup_sit_start', 'lineup_flex_move']);
  if (result.some((r) => lineupKinds.has(r.kind))) {
    result = await synthesizeLineupRecs(ctx, result);
  }

  if (ctx.assessment.primaryGoal !== 'roster_compliance') {
    const swapDraft = result.find((r) => r.kind === 'add_drop');
    if (swapDraft && options.waiverDropCandidates && options.waiverAddCandidates) {
      const enhanced = await synthesizeWaiverSwap(
        ctx,
        options.waiverDropCandidates,
        options.waiverAddCandidates,
        swapDraft
      );
      if (enhanced) {
        result = result.map((r) => (r.kind === 'add_drop' ? enhanced : r));
      }
    }
  }

  return result;
}
