import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { discoverLeagues, importTeamsFromPlatform, syncTeam } from '../services/teamSync.js';
import { runAgentForTeam } from '../services/agentService.js';
import { getRosterComplianceSummary } from '../services/roster-optimizer/compliance.js';
import type { Platform, PlatformCredentials, Sport } from '../types/index.js';

const router = Router();

/** Resolve credentials from the request body, falling back to the user's saved connection. */
async function resolveCredentials(
  userId: string,
  platform: Platform,
  provided?: PlatformCredentials
): Promise<PlatformCredentials> {
  if (provided && Object.values(provided).some((v) => v)) return provided;
  const user = await User.findById(userId);
  const conn = user?.platformConnections.find((c) => c.platform === platform);
  if (!conn) {
    throw new Error(`No saved ${platform} connection. Connect the platform first.`);
  }
  return getDecryptedCredentials(conn);
}

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
  res.json({ team, compliance: getRosterComplianceSummary(team) });
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
      credentials?: PlatformCredentials;
      sport?: Sport;
    };
    try {
      const creds = await resolveCredentials(req.userId!, platform, credentials);
      const leagues = await discoverLeagues(platform, creds, sport ?? 'nfl');
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
      credentials?: PlatformCredentials;
      sport?: Sport;
      selectedLeagues?: Array<{ externalLeagueId: string; externalTeamId: string }>;
    };
    try {
      const creds = await resolveCredentials(req.userId!, platform, credentials);
      const teams = await importTeamsFromPlatform(
        req.userId!,
        platform,
        creds,
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
    res.json({ team: synced, compliance: getRosterComplianceSummary(synced) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/run-agent', authMiddleware, async (req: AuthRequest, res: Response) => {
  const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  try {
    const result = await runAgentForTeam(String(team._id), { force: true });
    const synced = await Team.findById(team._id);
    res.json({
      ...result,
      compliance: synced ? getRosterComplianceSummary(synced) : undefined,
    });
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

router.patch(
  '/:id/auto-pilot',
  authMiddleware,
  body('autoPilot').isBoolean(),
  async (req: AuthRequest, res: Response) => {
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    team.autoPilot = req.body.autoPilot as boolean;
    await team.save();
    res.json({ team });
  }
);

export default router;
