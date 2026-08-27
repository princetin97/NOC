import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { hashPassword } from '../../lib/auth';
import { requireSystemAdmin, type AuthedRequest } from '../middleware/auth';

export const usersRouter = Router();

// User-management is system-admin only.
usersRouter.use(requireSystemAdmin);

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, createdAt: true, siteMemberships: { select: { siteId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(users.map((u) => ({ ...u, siteIds: u.siteMemberships.map((s) => s.siteId) })));
});

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
  role: z.enum(['admin', 'operator', 'viewer']).default('operator'),
  siteIds: z.array(z.string()).optional(),
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (existing) {
    res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      username: parsed.data.username,
      passwordHash,
      role: parsed.data.role,
      siteMemberships: parsed.data.siteIds?.length
        ? { create: parsed.data.siteIds.map((siteId) => ({ siteId })) }
        : undefined,
    },
    select: { id: true, username: true, role: true, createdAt: true, siteMemberships: { select: { siteId: true } } },
  });
  res.status(201).json({ ...user, siteIds: user.siteMemberships.map((s) => s.siteId) });
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  siteIds: z.array(z.string()).optional(),
});

usersRouter.put('/:id', async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { role, siteIds } = parsed.data;
  const user = await prisma.$transaction(async (tx) => {
    if (typeof siteIds !== 'undefined') {
      await tx.userSite.deleteMany({ where: { userId: req.params.id } });
      if (siteIds.length > 0) {
        await tx.userSite.createMany({ data: siteIds.map((siteId) => ({ userId: req.params.id, siteId })) });
      }
    }

    return tx.user.update({
      where: { id: req.params.id },
      data: { ...(role ? { role } : {}) },
      select: { id: true, username: true, role: true, createdAt: true, siteMemberships: { select: { siteId: true } } },
    });
  });

  res.json({ ...user, siteIds: user.siteMemberships.map((s) => s.siteId) });
});

const resetSchema = z.object({ newPassword: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự') });

usersRouter.post('/:id/reset-password', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
  res.json({ ok: true });
});

usersRouter.delete('/:id', async (req: AuthedRequest, res) => {
  if (req.params.id === req.user!.sub) {
    res.status(400).json({ error: 'Không thể xóa chính tài khoản đang đăng nhập' });
    return;
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
