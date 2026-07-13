import { Router, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { runRosterAgent } from '../services/roster-optimizer/agent.js';
import { getAdapter } from '../services/fantasy-platform/index.js';
import { getCurrentWeek } from '../services/roster-optimizer/index.js';
import { getRosterComplianceSummary } from '../services/roster-optimizer/compliance.js';
import { storeRecommendations } from '../services/agentService.js';
import { syncTeam } from '../services/teamSync.js';
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
    const adapter = getAdapter(team.platform, team.sport);
    const account = await adapter.connect(credentials);

    // Always sync first so taxi squad + roster limits are current
    const synced = await syncTeam(String(team._id));
    const performance = await adapter.getRecentPerformance(
      account,
      synced.externalLeagueId,
      synced.roster
    );

    const week = getCurrentWeek(synced.sport);
    const agentResult = await runRosterAgent({
      team: synced,
      performance,
      trendingAdds: [],
      trendingDrops: [],
      week,
    });

    const ids = await storeRecommendations(String(synced._id), week, agentResult.recommendations);

    res.json({
      recommendations: agentResult.recommendations,
      recommendationIds: ids,
      teamId: synced._id,
      team: synced,
      compliance: getRosterComplianceSummary(synced),
      assessment: agentResult.assessment,
      agentTrace: agentResult.agentTrace,
      llmUsed: agentResult.llmUsed,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
