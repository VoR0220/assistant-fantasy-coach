import { Router, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { getAdapter } from '../services/fantasy-platform/index.js';
import { generateAllLineupRecommendations } from '../services/roster-optimizer/lineup.js';
import type { PlatformCredentials } from '../types/index.js';

const router = Router();

router.post('/:id/analyze-lineup', authMiddleware, async (req: AuthRequest, res: Response) => {
  const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
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
  if (!conn) {
    res.status(400).json({ error: 'Platform not connected' });
    return;
  }

  try {
    const credentials = getDecryptedCredentials(conn) as PlatformCredentials;
    const adapter = getAdapter(team.platform);
    const account = await adapter.connect(credentials);
    const performance = await adapter.getRecentPerformance(
      account,
      team.externalLeagueId,
      team.roster
    );

    const recommendations = generateAllLineupRecommendations({
      team,
      performance,
      maxRecommendations: 8,
    });

    res.json({ recommendations, teamId: team._id });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
