import { AgentRun } from '../models/AgentRun.js';
import { SwapRecommendation } from '../models/SwapRecommendation.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { getAdapter } from './fantasy-platform/index.js';
import { getSleeperTrending, getSleeperPlayersMap } from './fantasy-platform/sleeper.js';
import {
  getCurrentWeek,
} from './roster-optimizer/index.js';
import { runRosterAgent } from './roster-optimizer/agent.js';
import { notifyWeeklyRecommendations } from './pushService.js';
import { getTagWeightsForTeam } from './feedbackService.js';
import { getRecentLeagueNews } from './newsService.js';
import { syncTeam } from './teamSync.js';
import { SPORT_CONFIG } from '../types/index.js';
import type { NewsSnippet, Sport, TrendingPlayer, PlatformCredentials } from '../types/index.js';

async function enrichTrending(
  raw: Array<{ player_id: string; count: number }>,
  type: 'add' | 'drop',
  sportKey: string
): Promise<TrendingPlayer[]> {
  const map = await getSleeperPlayersMap(sportKey);
  return raw.map((t) => {
    const p = map[t.player_id];
    return {
      playerId: t.player_id,
      name: p?.full_name ?? `Player ${t.player_id}`,
      position: p?.position ?? 'UNKNOWN',
      team: p?.team ?? undefined,
      injuryStatus: p?.injury_status ?? undefined,
      trendCount: t.count,
      trendType: type,
    };
  });
}

/** Sleeper trending covers the platform-wide market; only some sports have it. */
async function fetchTrending(sport: Sport): Promise<{
  trendingAdds: TrendingPlayer[];
  trendingDrops: TrendingPlayer[];
}> {
  const sleeperKey = SPORT_CONFIG[sport].sleeperKey;
  if (!sleeperKey) return { trendingAdds: [], trendingDrops: [] };
  const [addRaw, dropRaw] = await Promise.all([
    getSleeperTrending('add', 72, 50, sleeperKey),
    getSleeperTrending('drop', 72, 50, sleeperKey),
  ]);
  return {
    trendingAdds: await enrichTrending(addRaw, 'add', sleeperKey),
    trendingDrops: await enrichTrending(dropRaw, 'drop', sleeperKey),
  };
}

export interface AgentRunOptions {
  week?: number;
  /** Latest news headlines from the cron scheduler / MCP news feed, used for reasoning */
  leagueNews?: NewsSnippet[];
  /** Re-run even if a completed run exists for this (team, week) */
  force?: boolean;
  /** Skip LLM synthesis even when OPENAI_API_KEY is set */
  synthesize?: boolean;
}

export async function runAgentForTeam(
  teamId: string,
  options: AgentRunOptions = {}
): Promise<{
  teamId: string;
  recommendationIds: string[];
  skipped: boolean;
  assessment?: import('./roster-optimizer/planner.js').TeamAssessment;
  agentTrace?: string[];
  llmUsed?: boolean;
}> {
  const team = await Team.findById(teamId);
  if (!team) throw new Error('Team not found');

  const week = options.week ?? getCurrentWeek(team.sport);
  const existing = await AgentRun.findOne({ teamId, week, status: 'completed' });
  if (existing && !options.force) {
    return { teamId, recommendationIds: existing.recommendationIds.map(String), skipped: true };
  }

  let agentRun = await AgentRun.findOne({ teamId, week });
  if (!agentRun) {
    agentRun = await AgentRun.create({ teamId, week, status: 'running', recommendationIds: [] });
  } else {
    agentRun.status = 'running';
    agentRun.agentTrace = [];
    agentRun.primaryGoal = undefined;
    agentRun.llmUsed = false;
    await agentRun.save();
  }

  try {
    const synced = await syncTeam(teamId);
    const user = await User.findById(synced.userId);
    if (!user) throw new Error('User not found');

    const conn = user.platformConnections.find((c) => c.platform === synced.platform);
    if (!conn) throw new Error('Platform connection missing');

    const credentials = getDecryptedCredentials(conn) as PlatformCredentials;
    const adapter = getAdapter(synced.platform, synced.sport);
    const account = await adapter.connect(credentials);
    const performance = await adapter.getRecentPerformance(
      account,
      synced.externalLeagueId,
      synced.roster
    );

    const { trendingAdds, trendingDrops } = await fetchTrending(synced.sport);

    const leagueNews =
      options.leagueNews && options.leagueNews.length > 0
        ? options.leagueNews
        : await getRecentLeagueNews(synced.sport, 72);
    const tagWeights = await getTagWeightsForTeam(String(synced._id));

    const agentResult = await runRosterAgent({
      team: synced,
      performance,
      trendingAdds,
      trendingDrops,
      leagueNews,
      tagWeights,
      week,
      synthesize: options.synthesize,
    });
    const suggestions = agentResult.recommendations;

    agentRun.agentTrace = agentResult.agentTrace;
    agentRun.primaryGoal = agentResult.assessment.primaryGoal;
    agentRun.llmUsed = agentResult.llmUsed;

    await SwapRecommendation.deleteMany({
      teamId: synced._id,
      week,
      status: 'pending',
    });

    const recommendationIds: string[] = [];
    for (const s of suggestions) {
      const rec = await SwapRecommendation.create({
        userId: synced.userId,
        teamId: synced._id,
        week,
        ...s,
        status: 'pending',
      });
      recommendationIds.push(String(rec._id));
    }

    agentRun.status = 'completed';
    agentRun.recommendationIds = recommendationIds as unknown as import('mongoose').Types.ObjectId[];
    agentRun.completedAt = new Date();
    await agentRun.save();

    if (suggestions.length > 0) {
      await notifyWeeklyRecommendations(user, synced.teamName, suggestions.length, week, String(synced._id));
    }

    return {
      teamId,
      recommendationIds,
      skipped: false,
      assessment: agentResult.assessment,
      agentTrace: agentResult.agentTrace,
      llmUsed: agentResult.llmUsed,
    };
  } catch (err) {
    agentRun.status = 'failed';
    agentRun.errorMessage = (err as Error).message;
    await agentRun.save();
    throw err;
  }
}

export async function runAgentForAllOptedIn(options: AgentRunOptions & { sport?: Sport } = {}) {
  const filter: Record<string, unknown> = { agentOptIn: true };
  if (options.sport) filter.sport = options.sport;
  const teams = await Team.find(filter);
  const results = [];
  for (const team of teams) {
    try {
      results.push(await runAgentForTeam(String(team._id), options));
    } catch (err) {
      results.push({ teamId: String(team._id), error: (err as Error).message });
    }
  }
  return { results };
}

// Backwards-compatible aliases used by earlier routes
export const runWeeklyAgentForTeam = (teamId: string, week?: number) =>
  runAgentForTeam(teamId, { week });
export const runWeeklyAgentForAllOptedIn = (week?: number) =>
  runAgentForAllOptedIn({ week });

export async function storeRecommendations(
  teamId: string,
  week: number,
  recommendations: Array<{
    kind?: string;
    dropPlayer?: { playerId: string; name: string; position: string; reasonTags?: string[] };
    addPlayer?: { playerId: string; name: string; position: string; reasonTags?: string[] };
    confidence: number;
    rationale: string[];
    newsSnippets: Array<{ headline: string; source: string; url?: string; publishedAt?: Date }>;
  }>
) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error('Team not found');

  await SwapRecommendation.deleteMany({ teamId, week, status: 'pending' });
  const ids = [];
  for (const r of recommendations) {
    const rec = await SwapRecommendation.create({
      userId: team.userId,
      teamId,
      week,
      kind: r.kind ?? 'add_drop',
      ...r,
      status: 'pending',
    });
    ids.push(rec._id);
  }

  const user = await User.findById(team.userId);
  if (user && recommendations.length > 0) {
    await notifyWeeklyRecommendations(user, team.teamName, recommendations.length, week, teamId);
  }

  return ids;
}
