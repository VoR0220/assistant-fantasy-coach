import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { config } from '../config/index.js';
import { User } from '../models/User.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const router = Router();

router.post(
  '/register',
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    const { email, password } = req.body as { email: string; password: string };
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash, deviceTokens: [], platformConnections: [], teamIds: [] });
    const token = jwt.sign({ userId: String(user._id) }, config.jwtSecret, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, email: user.email } });
  }
);

router.post(
  '/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    const { email, password } = req.body as { email: string; password: string };
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign({ userId: String(user._id) }, config.jwtSecret, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, email: user.email } });
  }
);

router.post(
  '/device-token',
  authMiddleware,
  body('token').notEmpty(),
  body('platform').isIn(['ios', 'android']),
  async (req: AuthRequest, res: Response) => {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { token, platform } = req.body as { token: string; platform: 'ios' | 'android' };
    const idx = user.deviceTokens.findIndex((d) => d.token === token);
    if (idx >= 0) user.deviceTokens[idx].updatedAt = new Date();
    else user.deviceTokens.push({ token, platform, updatedAt: new Date() });
    await user.save();
    res.json({ ok: true });
  }
);

export default router;
