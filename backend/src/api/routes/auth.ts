import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { hashPassword, signToken, verifyPassword } from '../../lib/auth';
import { requireAuth, type AuthedRequest } from '../middleware/auth';

export const authRouter = Router();

// Seeds a default admin user on first login attempt if no users exist yet,
// so the platform is usable immediately after a fresh docker compose up.
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const userCount = await prisma.user.count();
  if (userCount === 0 && username === 'admin') {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({ data: { username, passwordHash, role: 'admin' } });
    const token = signToken({ sub: user.id, username: user.username, role: user.role });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, siteIds: [], isSystemAdmin: true } });
    return;
  }

  const user = await prisma.user.findUnique({ where: { username }, include: { siteMemberships: { select: { siteId: true } } } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid credentials' });
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
