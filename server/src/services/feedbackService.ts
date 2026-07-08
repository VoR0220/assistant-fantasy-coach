import { SwapRecommendation } from '../models/SwapRecommendation.js';

const INJURY_LINEUP_KINDS = new Set(['lineup_sit_start', 'lineup_flex_move']);

function collectTags(rec: {
  kind: string;
  dropPlayer?: { reasonTags?: string[] };
  addPlayer?: { reasonTags?: string[] };
  lineupAction?: {
    sitPlayer?: { reasonTags?: string[] };
    startPlayer?: { reasonTags?: string[] };
    movePlayer?: { reasonTags?: string[] };
  };
}): string[] {
  const tags = new Set<string>();
  for (const t of rec.dropPlayer?.reasonTags ?? []) tags.add(t);
  for (const t of rec.addPlayer?.reasonTags ?? []) tags.add(t);
  for (const t of rec.lineupAction?.sitPlayer?.reasonTags ?? []) tags.add(t);
  for (const t of rec.lineupAction?.startPlayer?.reasonTags ?? []) tags.add(t);
  for (const t of rec.lineupAction?.movePlayer?.reasonTags ?? []) tags.add(t);
  if (INJURY_LINEUP_KINDS.has(rec.kind)) tags.add('injury_lineup');
  return [...tags];
}

export async function getTagWeightsForTeam(teamId: string): Promise<Record<string, number>> {
  const recs = await SwapRecommendation.find({
    teamId,
    status: { $in: ['approved', 'dismissed', 'executed'] },
  })
    .select('kind dropPlayer addPlayer lineupAction status')
    .lean();

  const stats: Record<string, { accepted: number; dismissed: number }> = {};

  for (const rec of recs) {
    const tags = collectTags(rec);
    const accepted = rec.status === 'approved' || rec.status === 'executed';
    for (const tag of tags) {
      if (!stats[tag]) stats[tag] = { accepted: 0, dismissed: 0 };
      if (accepted) stats[tag].accepted += 1;
      else stats[tag].dismissed += 1;
    }
  }

  const weights: Record<string, number> = {};
  for (const [tag, { accepted, dismissed }] of Object.entries(stats)) {
    weights[tag] = (accepted + 1) / (accepted + dismissed + 2);
  }
  return weights;
}

export async function getDecisionHistory(teamId: string) {
  const [recent, tagWeights] = await Promise.all([
    SwapRecommendation.find({
      teamId,
      status: { $in: ['approved', 'dismissed', 'executed'] },
    })
      .sort({ decidedAt: -1, updatedAt: -1 })
      .limit(50)
      .select('kind status confidence rationale dropPlayer addPlayer lineupAction decidedAt week updatedAt')
      .lean(),
    getTagWeightsForTeam(teamId),
  ]);

  return {
    tagWeights,
    recentDecisions: recent.map((r) => ({
      id: String(r._id),
      kind: r.kind,
      status: r.status,
      week: r.week,
      confidence: r.confidence,
      rationale: r.rationale,
      decidedAt: r.decidedAt ?? r.updatedAt,
      dropPlayer: r.dropPlayer?.name,
      addPlayer: r.addPlayer?.name,
      lineupAction: r.lineupAction,
    })),
  };
}
