import { Router, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { SwapRecommendation } from '../models/SwapRecommendation.js';
import { Team } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { getAdapter } from '../services/fantasy-platform/index.js';
import type { LineupChange, PlatformCredentials } from '../types/index.js';

const router = Router();

async function executeRecommendation(
  rec: InstanceType<typeof SwapRecommendation>,
  team: InstanceType<typeof Team>,
  credentials: PlatformCredentials
) {
  const adapter = getAdapter(team.platform, team.sport);
  const account = await adapter.connect(credentials);

  if (rec.kind === 'roster_drop' && rec.dropPlayer) {
    if (adapter.submitDrop) {
      return adapter.submitDrop(
        account,
        team.externalLeagueId,
        team.externalTeamId,
        rec.dropPlayer.playerId
      );
    }
    return { success: false, message: 'Drop not supported for this platform' };
  }

  if (rec.kind === 'move_to_taxi' && rec.lineupAction?.movePlayer) {
    if (adapter.submitTaxiMove) {
      return adapter.submitTaxiMove(
        account,
        team.externalLeagueId,
        team.externalTeamId,
        rec.lineupAction.movePlayer.playerId
      );
    }
    return { success: false, message: 'Taxi moves not supported for this platform' };
  }

  if (rec.kind === 'lineup_sit_start' || rec.kind === 'lineup_flex_move') {
    if (!adapter.submitLineupChange || !rec.lineupAction) {
      return {
        success: false,
        message: 'Lineup write not supported. Update your lineup in the fantasy app.',
      };
    }
    const changes: LineupChange[] = [];
    const action = rec.lineupAction;
    if (action.sitPlayer) {
      changes.push({
        playerId: action.sitPlayer.playerId,
        fromSlot: action.fromSlot ?? action.sitPlayer.position,
        toSlot: 'BN',
      });
    }
    if (action.startPlayer) {
      changes.push({
        playerId: action.startPlayer.playerId,
        fromSlot: 'BN',
        toSlot: action.toSlot ?? action.startPlayer.position,
      });
    }
    if (action.movePlayer) {
      changes.push({
        playerId: action.movePlayer.playerId,
        fromSlot: action.fromSlot ?? 'FLEX',
        toSlot: action.toSlot ?? action.movePlayer.position,
      });
    }
    if (changes.length === 0) {
      return { success: false, message: 'No lineup changes to apply' };
    }
    return adapter.submitLineupChange(
      account,
      team.externalLeagueId,
      team.externalTeamId,
      changes
    );
  }

  if (rec.kind === 'add_drop' && rec.dropPlayer && rec.addPlayer) {
    if (adapter.submitAddDrop) {
      return adapter.submitAddDrop(
        account,
        team.externalLeagueId,
        team.externalTeamId,
        rec.addPlayer.playerId,
        rec.dropPlayer.playerId
      );
    }
    return { success: false, message: 'Add/drop not supported for this platform' };
  }

  return { success: false, message: 'Transaction not supported' };
}

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
    message: 'Platform not connected',
  };

  if (conn) {
    const credentials = getDecryptedCredentials(conn) as PlatformCredentials;

    const selectedDropPlayerId = req.body?.selectedDropPlayerId as string | undefined;
    if (
      selectedDropPlayerId &&
      (rec.kind === 'roster_drop' || rec.kind === 'add_drop') &&
      selectedDropPlayerId !== rec.dropPlayer?.playerId
    ) {
      const alts = rec.dropAlternatives ?? [];
      const chosen =
        alts.find((a) => a.playerId === selectedDropPlayerId) ??
        (rec.dropPlayer?.playerId === selectedDropPlayerId ? rec.dropPlayer : undefined);
      if (!chosen) {
        res.status(400).json({
          error: 'selectedDropPlayerId is not among the equal drop alternatives',
        });
        return;
      }
      rec.dropPlayer = chosen;
    }

    executionResult = await executeRecommendation(rec, team, credentials);
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
