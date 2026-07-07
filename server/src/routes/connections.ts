import { Router, Response } from 'express';
import { body } from 'express-validator';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { encrypt } from '../utils/crypto.js';
import { User } from '../models/User.js';
import { getAdapter } from '../services/fantasy-platform/index.js';
import type { Platform, PlatformCredentials } from '../types/index.js';

const router = Router();

router.post(
  '/:platform',
  authMiddleware,
  body('credentials').isObject(),
  async (req: AuthRequest, res: Response) => {
    const platform = req.params.platform as Platform;
    if (!['sleeper', 'espn', 'yahoo'].includes(platform)) {
      res.status(400).json({ error: 'Invalid platform' });
      return;
    }
    const credentials = req.body.credentials as PlatformCredentials;
    try {
      const adapter = getAdapter(platform);
      const account = await adapter.connect(credentials);
      const user = await User.findById(req.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const idx = user.platformConnections.findIndex((c) => c.platform === platform);
      const entry = {
        platform,
        credentials: encrypt(JSON.stringify(credentials)),
        externalUserId: account.externalUserId,
        connectedAt: new Date(),
      };
      if (idx >= 0) user.platformConnections[idx] = entry;
      else user.platformConnections.push(entry);
      await user.save();
      res.json({ connected: true, externalUserId: account.externalUserId });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    connections: user.platformConnections.map((c) => ({
      platform: c.platform,
      externalUserId: c.externalUserId,
      connectedAt: c.connectedAt,
    })),
  });
});

export default router;
