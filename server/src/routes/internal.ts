import { Router, Response, Request } from 'express';
import { body } from 'express-validator';
import { internalAuthMiddleware } from '../middleware/auth.js';
import { Team } from '../models/Team.js';
import {
  runAgentForAllOptedIn,
  runAgentForTeam,
  storeRecommendations,
} from '../services/agentService.js';
import { runGamedayCheckForAll, runGamedayCheckForTeam } from '../services/gamedayService.js';
import { getNewsForSport, upsertNewsBatch } from '../services/newsService.js';
import { getDecisionHistory } from '../services/feedbackService.js';
import { getCurrentWeek } from '../services/roster-optimizer/index.js';
import { syncTeam } from '../services/teamSync.js';
import type { NewsSnippet, Sport } from '../types/index.js';
import { SPORT_CONFIG } from '../types/index.js';

const router = Router();

router.use(internalAuthMiddleware);

router.get('/teams/opted-in', async (req: Request, res: Response) => {
  const sport = req.query.sport as Sport | undefined;
  const filter: Record<string, unknown> = { agentOptIn: true };
  if (sport) filter.sport = sport;
  const teams = await Team.find(filter).select(
    'userId platform sport externalLeagueId externalTeamId teamName leagueName agentOptIn lastSyncedAt'
  );
  const weeks = Object.fromEntries(
    (Object.keys(SPORT_CONFIG) as Sport[]).map((s) => [s, getCurrentWeek(s)])
  );
  res.json({ teams, weeks });
});

router.get('/teams/:id', async (req: Request, res: Response) => {
  const team = await Team.findById(req.params.id);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  res.json({ team });
});

router.post('/teams/:id/sync', async (req: Request, res: Response) => {
  try {
    const team = await syncTeam(String(req.params.id));
    res.json({ team });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Agent run trigger. The cron scheduler POSTs here with the latest news
 * (`leagueNews`) so headlines feed directly into recommendation reasoning.
 */
router.post('/agent/run', async (req: Request, res: Response) => {
  const week = req.body.week ? parseInt(String(req.body.week), 10) : undefined;
  const teamId = req.body.teamId as string | undefined;
  const sport = req.body.sport as Sport | undefined;
  const force = Boolean(req.body.force);
  const leagueNews = (req.body.leagueNews ?? []) as NewsSnippet[];

  try {
    if (teamId) {
      const result = await runAgentForTeam(teamId, { week, leagueNews, force });
      res.json(result);
    } else {
      const result = await runAgentForAllOptedIn({ week, leagueNews, force, sport });
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post(
  '/recommendations',
  body('teamId').notEmpty(),
  body('week').isInt({ min: 1, max: 30 }),
  body('recommendations').isArray(),
  async (req: Request, res: Response) => {
    const { teamId, week, recommendations } = req.body;
    try {
      const ids = await storeRecommendations(teamId, week, recommendations);
      res.status(201).json({ recommendationIds: ids });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

router.post('/news', async (req: Request, res: Response) => {
  const items = (req.body.items ?? req.body.news ?? []) as Array<{
    headline: string;
    source: string;
    url?: string;
    publishedAt?: string;
    sport: Sport;
    matchedPlayerIds?: string[];
  }>;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items array required' });
    return;
  }
  try {
    const result = await upsertNewsBatch(items);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/news', async (req: Request, res: Response) => {
  const sport = (req.query.sport as Sport) ?? 'nfl';
  const sinceHours = req.query.sinceHours
    ? parseInt(String(req.query.sinceHours), 10)
    : req.query.since
      ? Math.ceil((Date.now() - new Date(String(req.query.since)).getTime()) / (1000 * 60 * 60))
      : 72;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
  try {
    const news = await getNewsForSport(sport, { sinceHours, limit });
    res.json({ news, sport, sinceHours });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/teams/:id/decision-history', async (req: Request, res: Response) => {
  try {
    const history = await getDecisionHistory(String(req.params.id));
    res.json(history);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/lineup/gameday-check', async (req: Request, res: Response) => {
  const teamId = req.body.teamId as string | undefined;
  const sport = req.body.sport as Sport | undefined;
  try {
    if (teamId) {
      const result = await runGamedayCheckForTeam(teamId);
      res.json(result);
    } else {
      const result = await runGamedayCheckForAll(sport);
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
