import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { hashPassword, signToken, verifyPassword } from '../../lib/auth';
import { env } from '../../lib/env';
import { requireAuth, type AuthedRequest } from '../middleware/auth';

export const authRouter = Router();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginKey(req: { ip?: string | undefined }, username: string): string {
  return `${(req.ip ?? 'unknown').trim().toLowerCase()}:${username.trim().toLowerCase()}`;
}

function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state) return false;
  if (state.resetAt <= now) {
    loginAttempts.delete(key);
    return false;
  }
  return state.count >= LOGIN_MAX_ATTEMPTS;
}

function registerFailedLogin(key: string): void {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function clearFailedLogin(key: string): void {
  loginAttempts.delete(key);
}

const bootstrapSchema = z.object({
  token: z.string().min(1),
  username: z.string().min(3).max(64),
  password: z.string().min(8),
});

// One-time secure bootstrap for the very first admin account.
authRouter.post('/bootstrap', async (req, res) => {
  const parsed = bootstrapSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const configuredToken = env.authBootstrapToken;
  if (!configuredToken) {
    res.status(503).json({ error: 'AUTH_BOOTSTRAP_TOKEN is not configured on the server' });
    return;
  }
  if (parsed.data.token !== configuredToken) {
    res.status(401).json({ error: 'Invalid bootstrap token' });
    return;
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    res.status(409).json({ error: 'Bootstrap is disabled because users already exist' });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({ data: { username: parsed.data.username, passwordHash, role: 'admin' } });
  const token = signToken({ sub: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, siteIds: [], isSystemAdmin: true } });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const key = loginKey(req, username);
  if (isLoginRateLimited(key)) {
    res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
    return;
  }

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    res.status(503).json({ error: 'No users exist yet. Use /api/auth/bootstrap with AUTH_BOOTSTRAP_TOKEN first.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { username }, include: { siteMemberships: { select: { siteId: true } } } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    registerFailedLogin(key);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  clearFailedLogin(key);

  const token = signToken({ sub: user.id, username: user.username, role: user.role });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      siteIds: user.siteMemberships.map((s) => s.siteId),
      isSystemAdmin: user.role === 'admin' && user.siteMemberships.length === 0,
    },
  });
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: {
      id: true,
      username: true,
      role: true,
      createdAt: true,
      siteMemberships: { select: { siteId: true, site: { select: { name: true, code: true } } } },
    },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    isSystemAdmin: user.role === 'admin' && user.siteMemberships.length === 0,
    createdAt: user.createdAt,
    siteIds: user.siteMemberships.map((s) => s.siteId),
    sites: user.siteMemberships.map((s) => ({ id: s.siteId, name: s.site.name, code: s.site.code })),
  });
});

// Sliding-session refresh: exchanges a still-valid token for a fresh one so
// active users are not logged out mid-session. The requireAuth middleware
// rejects expired/invalid tokens, and we re-read the user to reflect role changes.
authRouter.post('/refresh', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, include: { siteMemberships: { select: { siteId: true } } } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  const token = signToken({ sub: user.id, username: user.username, role: user.role });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      siteIds: user.siteMemberships.map((s) => s.siteId),
      isSystemAdmin: user.role === 'admin' && user.siteMemberships.length === 0,
    },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Mật khẩu mới phải có ít nhất 6 ký tự'),
});

authRouter.post('/change-password', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});
