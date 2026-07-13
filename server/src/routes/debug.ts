import { Router, Request, Response } from 'express';

const router = Router();

interface ClientLogBody {
  t?: string;
  level?: string;
  msg?: string;
  tag?: string;
  platform?: string;
}

/**
 * In-memory only. We used to append to server/logs/*.log, but those writes
 * were picked up by Metro/Watchman and triggered Fast Refresh — which
 * unmounted the Sleeper login WebView mid-keystroke (see input len=8 → RN unmount
 * → "iOS Bundled" in the Metro log).
 */
const recent: string[] = [];
const MAX_RECENT = 500;

router.post('/client-log', (req: Request, res: Response) => {
  const body = req.body as ClientLogBody;
  const tag = body.tag ?? 'client';
  const level = (body.level ?? 'info').toUpperCase();
  const t = body.t ?? new Date().toISOString();
  const platform = body.platform ?? '?';
  const msg = body.msg ?? '';
  const line = `[${tag}] ${t} ${level} (${platform}) ${msg}`;

  console.log(`\x1b[36m[CLIENT-DEBUG]\x1b[0m ${line}`);

  recent.push(line);
  if (recent.length > MAX_RECENT) recent.shift();

  res.json({ ok: true });
});

router.get('/client-log', (_req: Request, res: Response) => {
  res.json({ recent });
});

router.delete('/client-log', (_req: Request, res: Response) => {
  recent.length = 0;
  res.json({ ok: true });
});

export default router;
