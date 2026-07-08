import { SwapRecommendation } from '../models/SwapRecommendation.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { getAdapter } from './fantasy-platform/index.js';
import { generateInjuryLineupRecommendations, getCurrentWeek } from './roster-optimizer/index.js';
import type { LineupChange, PlatformCredentials, Sport, TransactionResult } from '../types/index.js';
import {
  notifyAutoLineupChange,
  notifyUrgentLineupAlert,
} from './pushService.js';
import { syncTeam } from './teamSync.js';

export interface GamedayCheckResult {
  teamId: string;
  actions: number;
  executed: number;
  failed: number;
  skipped: boolean;
  error?: string;
}

async function alreadyHandledSit(
  teamId: string,
  week: number,
  playerId: string
): Promise<boolean> {
  const existing = await SwapRecommendation.findOne({
    teamId,
    week,
    status: { $in: ['executed', 'approved'] },
    kind: 'lineup_sit_start',
    'lineupAction.sitPlayer.playerId': playerId,
  })
    .select('_id')
    .lean();
  return Boolean(existing);
}

export async function runGamedayCheckForTeam(teamId: string): Promise<GamedayCheckResult> {
  const team = await Team.findById(teamId);
  if (!team) throw new Error('Team not found');
  if (!team.agentOptIn || team.autoPilot === false) {
    return { teamId, actions: 0, executed: 0, failed: 0, skipped: true };
  }

  const week = getCurrentWeek(team.sport);
  let executed = 0;
  let failed = 0;
  let actions = 0;

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

    const suggestions = generateInjuryLineupRecommendations({
      team: synced,
      performance,
      maxRecommendations: 5,
    }).filter((s) => s.lineupAction?.sitPlayer && s.lineupAction?.startPlayer);

    for (const suggestion of suggestions) {
      const sit = suggestion.lineupAction!.sitPlayer!;
      const start = suggestion.lineupAction!.startPlayer!;
      if (await alreadyHandledSit(String(synced._id), week, sit.playerId)) continue;

      actions += 1;
      const changes: LineupChange[] = [
        {
          playerId: sit.playerId,
          fromSlot: suggestion.lineupAction!.fromSlot ?? sit.position,
          toSlot: 'BN',
        },
        {
          playerId: start.playerId,
          fromSlot: 'BN',
          toSlot: suggestion.lineupAction!.toSlot ?? start.position,
        },
      ];

      let executionResult: TransactionResult = {
        success: false,
        message: 'Lineup write not supported for this platform',
      };

      if (adapter.submitLineupChange) {
        executionResult = await adapter.submitLineupChange(
          account,
          synced.externalLeagueId,
          synced.externalTeamId,
          changes
        );
      }

      const rec = await SwapRecommendation.create({
        userId: synced.userId,
        teamId: synced._id,
        week,
        kind: 'lineup_sit_start',
        lineupAction: suggestion.lineupAction,
        confidence: suggestion.confidence,
        rationale: [
          ...suggestion.rationale,
          executionResult.success
            ? 'Auto-pilot executed this lineup change.'
            : 'Auto-pilot could not write lineup — action required.',
        ],
        newsSnippets: [],
        status: executionResult.success ? 'executed' : 'approved',
        decidedAt: new Date(),
        executionResult,
      });

      if (executionResult.success) {
        executed += 1;
        if (user) {
          await notifyAutoLineupChange(
            user,
            synced.teamName,
            sit.name,
            start.name,
            week,
            String(synced._id)
          );
        }
      } else {
        failed += 1;
        if (user) {
          const injuryLabel =
            sit.reasonTags?.find((t) => t !== 'injured_starter') ?? 'OUT';
          await notifyUrgentLineupAlert(
            user,
            synced.teamName,
            sit.name,
            injuryLabel,
            executionResult.deepLink,
            String(synced._id)
          );
        }
      }

      void rec;
    }

    return { teamId, actions, executed, failed, skipped: false };
  } catch (err) {
    return {
      teamId,
      actions,
      executed,
      failed,
      skipped: false,
      error: (err as Error).message,
    };
  }
}

export async function runGamedayCheckForAll(sport?: Sport) {
  const filter: Record<string, unknown> = { agentOptIn: true, autoPilot: { $ne: false } };
  if (sport) filter.sport = sport;
  const teams = await Team.find(filter);
  const results: GamedayCheckResult[] = [];
  for (const team of teams) {
    results.push(await runGamedayCheckForTeam(String(team._id)));
  }
  return { results };
}
