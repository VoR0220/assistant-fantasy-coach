import { Router, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { SwapRecommendation } from '../models/SwapRecommendation.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { getAdapter } from '../services/fantasy-platform/index.js';
import type { PlatformCredentials } from '../types/index.js';

const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const week = req.query.week ? parseInt(String(req.query.week), 10) : undefined;
  const teamId = req.query.teamId as string | undefined;
  const filter: Record<string, unknown> = { userId: req.userId };
  if (week) filter.week = week;
  if (teamId) filter.teamId = teamId;
  if (req.query.status) filter.status = req.query.status;
  else filter.status = 'pending';

  const recommendations = await SwapRecommendation.find(filter)
    .populate('teamId', 'teamName leagueName platform')
    .sort({ confidence: -1 });
  res.json({ recommendations });
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rec = await SwapRecommendation.findOne({ _id: req.params.id, userId: req.userId })
    .populate('teamId', 'teamName leagueName platform');
  if (!rec) {
    res.status(404).json({ error: 'Recommendation not found' });
    return;
  }
  res.json({ recommendation: rec });
});

router.post('/:id/approve', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rec = await SwapRecommendation.findOne({ _id: req.params.id, userId: req.userId });
  if (!rec) {
    res.status(404).json({ error: 'Recommendation not found' });
    return;
  }

  if (rec.kind === 'lineup_sit_start' || rec.kind === 'lineup_flex_move') {
    rec.status = 'approved';
    rec.decidedAt = new Date();
    rec.executionResult = {
      success: true,
      message: 'Lineup change noted. Update your lineup in your fantasy app before lock.',
    };
    await rec.save();
    res.json({ recommendation: rec, executionResult: rec.executionResult });
    return;
  }

  if (!rec.dropPlayer || !rec.addPlayer) {
    res.status(400).json({ error: 'Invalid add/drop recommendation' });
    return;
  }

  const team = await Team.findById(rec.teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const conn = user.platformConnections.find((c) => c.platform === team.platform);
  let executionResult: { success: boolean; message: string; deepLink?: string } = {
    success: false,
    message: 'Transaction not supported',
  };

  if (conn) {
    const credentials = getDecryptedCredentials(conn) as PlatformCredentials;
    const adapter = getAdapter(team.platform, team.sport);
    const account = await adapter.connect(credentials);
    if (adapter.submitAddDrop) {
      executionResult = await adapter.submitAddDrop(
        account,
        team.externalLeagueId,
        team.externalTeamId,
        rec.addPlayer.playerId,
        rec.dropPlayer.playerId
      );
    }
  }

  rec.status = executionResult.success ? 'executed' : 'approved';
  rec.decidedAt = new Date();
  rec.executionResult = executionResult;
  await rec.save();
  res.json({ recommendation: rec, executionResult });
});

router.post('/:id/dismiss', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rec = await SwapRecommendation.findOne({ _id: req.params.id, userId: req.userId });
  if (!rec) {
    res.status(404).json({ error: 'Recommendation not found' });
    return;
  }
  rec.status = 'dismissed';
  rec.decidedAt = new Date();
  await rec.save();
  res.json({ recommendation: rec });
});

export default router;
