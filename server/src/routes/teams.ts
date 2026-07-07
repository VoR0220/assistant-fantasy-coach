import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { Team } from '../models/Team.js';
import { discoverLeagues, importTeamsFromPlatform, syncTeam } from '../services/teamSync.js';
import type { Platform, PlatformCredentials, Sport } from '../types/index.js';

const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const teams = await Team.find({ userId: req.userId })
    .select('-platformRaw -freeAgentsCache.players')
    .sort({ platform: 1, leagueName: 1 });
  res.json({ teams });
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  res.json({ team });
});

router.post(
  '/discover',
  authMiddleware,
  body('platform').isIn(['sleeper', 'espn', 'yahoo']),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    const { platform, credentials, sport } = req.body as {
      platform: Platform;
      credentials: PlatformCredentials;
      sport?: Sport;
    };
    try {
      const leagues = await discoverLeagues(platform, credentials, sport ?? 'nfl');
      res.json({ leagues });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

router.post(
  '/import',
  authMiddleware,
  body('platform').isIn(['sleeper', 'espn', 'yahoo']),
  async (req: AuthRequest, res: Response) => {
    const { platform, credentials, sport, selectedLeagues } = req.body as {
      platform: Platform;
      credentials: PlatformCredentials;
      sport?: Sport;
      selectedLeagues?: Array<{ externalLeagueId: string; externalTeamId: string }>;
    };
    try {
      const teams = await importTeamsFromPlatform(
        req.userId!,
        platform,
        credentials,
        sport ?? 'nfl',
        selectedLeagues
      );
      res.status(201).json({ teams });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

router.post('/:id/sync', authMiddleware, async (req: AuthRequest, res: Response) => {
  const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  try {
    const synced = await syncTeam(String(team._id));
    res.json({ team: synced });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch(
  '/:id/opt-in',
  authMiddleware,
  body('agentOptIn').isBoolean(),
  async (req: AuthRequest, res: Response) => {
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    team.agentOptIn = req.body.agentOptIn as boolean;
    await team.save();
    res.json({ team });
  }
);

export default router;
