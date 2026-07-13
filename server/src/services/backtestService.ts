import type { ITeam } from '../models/Team.js';
import { Team } from '../models/Team.js';
import { BacktestRun } from '../models/BacktestRun.js';
import { getTagWeightsForTeam } from './feedbackService.js';
import { defaultBacktestWeeks, lastCompletedSeason } from './backtest/calendar.js';
import { replayWeek, type BacktestWeekResult } from './backtest/replay.js';
import { summarizeBacktest, trainTagWeightsFromBacktest } from './backtest/train.js';

export interface RunBacktestOptions {
  season?: number;
  startWeek?: number;
  endWeek?: number;
  /** News lookback ending at each week's decision cutoff (default 7 days) */
  lookbackHours?: number;
  synthesize?: boolean;
}

export async function runSeasonBacktest(
  team: ITeam,
  userId: string,
  options: RunBacktestOptions = {}
) {
  if (team.platform !== 'sleeper') {
    throw new Error('Season backtest currently supports Sleeper leagues only');
  }

  const season = options.season ?? lastCompletedSeason(team.sport);
  const defaults = defaultBacktestWeeks(team.sport);
  const startWeek = options.startWeek ?? defaults.startWeek;
  const endWeek = options.endWeek ?? defaults.endWeek;
  const lookbackHours = options.lookbackHours ?? 168;

  const run = await BacktestRun.create({
    userId,
    teamId: team._id,
    season,
    sport: team.sport,
    startWeek,
    endWeek,
    lookbackHours,
    status: 'running',
    weeks: [],
  });

  const weekResults: BacktestWeekResult[] = [];

  try {
    for (let week = startWeek; week <= endWeek; week++) {
      try {
        const result = await replayWeek({
          team,
          season,
          week,
          lookbackHours,
          synthesize: options.synthesize,
        });
        weekResults.push(result);
      } catch (err) {
        // Skip weeks without matchup data (bye / pre-import) without failing the whole run
        weekResults.push({
          week,
          asOf: new Date().toISOString(),
          newsCount: 0,
          actualStarterIds: [],
          agentStarterIds: [],
          swapsApplied: [
            {
              rationale: [
                {
                  text: `Skipped: ${(err as Error).message}`,
                  source: 'Backtest · week skip',
                  sourceKind: 'agent',
                },
              ],
            },
          ],
          actualPoints: 0,
          agentPoints: 0,
          delta: 0,
          gainedPoints: 0,
          lostPoints: 0,
        });
      }
    }

    const scored = weekResults.filter((w) => w.actualStarterIds.length > 0);
    const priorWeights = await getTagWeightsForTeam(String(team._id));
    const trainedTagWeights = trainTagWeightsFromBacktest(scored, priorWeights);
    const summary = summarizeBacktest(scored);

    run.status = 'completed';
    run.weeks = weekResults;
    run.summary = summary;
    run.trainedTagWeights = trainedTagWeights;
    run.completedAt = new Date();
    await run.save();

    await Team.findByIdAndUpdate(team._id, {
      backtestTagWeights: trainedTagWeights,
      lastBacktestAt: new Date(),
    });

    return {
      backtestId: String(run._id),
      season,
      startWeek,
      endWeek,
      lookbackHours,
      summary,
      trainedTagWeights,
      weeks: weekResults,
      note:
        summary.weeksWithNews === 0
          ? 'No time-stamped news found in Mongo for those weeks. Ingest historical headlines (MCP/cron) into NewsItem with publishedAt for news-driven backtests. Lineups were retained as historically set when news was empty.'
          : 'News windows are look-ahead-safe (publishedAt ≤ week decision cutoff).',
    };
  } catch (err) {
    run.status = 'failed';
    run.errorMessage = (err as Error).message;
    await run.save();
    throw err;
  }
}
