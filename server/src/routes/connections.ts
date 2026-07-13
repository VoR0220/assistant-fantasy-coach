import { Router, Response, Request } from 'express';
import { body } from 'express-validator';
import jwt from 'jsonwebtoken';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { encrypt } from '../utils/crypto.js';
import { User } from '../models/User.js';
import { getAdapter } from '../services/fantasy-platform/index.js';
import type { Platform, PlatformCredentials } from '../types/index.js';

const router = Router();

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

function yahooRedirectUri(): string {
  return `${config.apiPublicUrl}/api/connections/yahoo/oauth/callback`;
}

/**
 * Step 1 of "Sign in with Yahoo": return the authorize URL. The state param
 * is a short-lived JWT carrying the userId so the unauthenticated callback
 * can attribute the tokens to the right account.
 */
router.get('/yahoo/oauth/url', authMiddleware, (req: AuthRequest, res: Response) => {
  if (!config.yahooClientId || !config.yahooClientSecret) {
    res.status(501).json({
      error:
        'Yahoo OAuth is not configured on the server. Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET, or paste an access token manually.',
    });
    return;
  }
  const state = jwt.sign({ userId: req.userId, purpose: 'yahoo-oauth' }, config.jwtSecret, {
    expiresIn: '10m',
  });
  const url =
    `${YAHOO_AUTH_URL}?client_id=${encodeURIComponent(config.yahooClientId)}` +
    `&redirect_uri=${encodeURIComponent(yahooRedirectUri())}` +
    `&response_type=code&state=${encodeURIComponent(state)}`;
  res.json({ url });
});

/** Step 2: Yahoo redirects here; exchange the code and save the connection. */
router.get('/yahoo/oauth/callback', async (req: Request, res: Response) => {
  const appUrl = `${config.appWebUrl}/teams/connect`;
  const fail = (reason: string) =>
    res.redirect(`${appUrl}?error=${encodeURIComponent(reason)}`);

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !state) return fail('Yahoo sign-in was cancelled.');

  let userId: string;
  try {
    const payload = jwt.verify(state, config.jwtSecret) as { userId: string; purpose: string };
    if (payload.purpose !== 'yahoo-oauth') throw new Error('bad state');
    userId = payload.userId;
  } catch {
    return fail('Sign-in session expired. Please try again.');
  }

  try {
    const basic = Buffer.from(`${config.yahooClientId}:${config.yahooClientSecret}`).toString(
      'base64'
    );
    const tokenRes = await fetch(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: yahooRedirectUri(),
        code,
      }).toString(),
    });
    if (!tokenRes.ok) {
      return fail(`Yahoo token exchange failed (${tokenRes.status}).`);
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
    };

    const credentials: PlatformCredentials = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
    const adapter = getAdapter('yahoo');
    const account = await adapter.connect(credentials);

    const user = await User.findById(userId);
    if (!user) return fail('User not found.');

    const entry = {
      platform: 'yahoo' as Platform,
      credentials: encrypt(JSON.stringify(credentials)),
      externalUserId: account.externalUserId,
      connectedAt: new Date(),
    };
    const idx = user.platformConnections.findIndex((c) => c.platform === 'yahoo');
    if (idx >= 0) user.platformConnections[idx] = entry;
    else user.platformConnections.push(entry);
    await user.save();

    res.redirect(`${appUrl}?connected=yahoo`);
  } catch (err) {
    fail((err as Error).message);
  }
});

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
      // Persist the adapter-resolved credentials (e.g. Sleeper token), never the
      // raw sign-in password the client may have sent.
      const entry = {
        platform,
        credentials: encrypt(JSON.stringify(account.credentials)),
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
