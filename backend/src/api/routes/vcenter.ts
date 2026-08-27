import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { logger } from '../../lib/logger';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, virtualizationManagerSiteWhere } from '../middleware/site-scope';
import { syncVCenterManager, diagnoseVCenterHost } from '../../poller/vcenter';

export const vcenterRouter = Router();

const createManagerSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  siteId: z.string().nullish(),
});

// password is optional on update: an empty/omitted value keeps the existing one
// so the edit form doesn't have to re-enter it every time.
const updateManagerSchema = z.object({
  name: z.string().min(1).optional(),
  endpoint: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  siteId: z.string().nullish(),
});

async function findScopedManager(req: AuthedRequest, id: string) {
  return prisma.virtualizationManager.findFirst({ where: { id, ...virtualizationManagerSiteWhere(req) } });
}

vcenterRouter.get('/managers', async (req: AuthedRequest, res) => {
  const requestedSiteIdRaw = req.query.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.length > 0 ? requestedSiteIdRaw : undefined;

  const scopeWhere = virtualizationManagerSiteWhere(req);
  const where = requestedSiteId ? { ...scopeWhere, siteId: requestedSiteId } : scopeWhere;

  const managers = await prisma.virtualizationManager.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { hosts: true } } },
  });
  res.json(managers.map(({ password: _password, ...rest }) => rest));
});

vcenterRouter.post('/managers', async (req: AuthedRequest, res) => {
  const parsed = createManagerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });
    return;
  }
  const { siteId, ...data } = parsed.data;
  if (siteId && !canAccessSite(req, siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo kết nối cho trụ sở này' });
    return;
  }
  try {
    const manager = await prisma.virtualizationManager.create({ data: { ...data, siteId: siteId ?? null } });
    const { password: _password, ...safe } = manager;
    res.status(201).json(safe);
  } catch (err) {
    logger.warn({ err }, 'Failed to create vCenter manager');
    res.status(400).json({ error: 'Không thể tạo kết nối vCenter (endpoint có thể đã tồn tại)' });
  }
});

vcenterRouter.patch('/managers/:id', async (req: AuthedRequest, res) => {
  const manager = await findScopedManager(req, req.params.id);
  if (!manager) {
    res.status(404).json({ error: 'Không tìm thấy vCenter' });
    return;
  }
  const parsed = updateManagerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });
    return;
  }
  const { siteId, ...data } = parsed.data;
  if (siteId && !canAccessSite(req, siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển kết nối sang trụ sở này' });
    return;
  }
  try {
    const updated = await prisma.virtualizationManager.update({
      where: { id: manager.id },
      data: { ...data, ...(siteId !== undefined ? { siteId: siteId ?? null } : {}) },
    });
    const { password: _password, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    logger.warn({ err }, 'Failed to update vCenter manager');
    res.status(400).json({ error: 'Không thể cập nhật kết nối vCenter (endpoint có thể đã tồn tại)' });
  }
});

vcenterRouter.delete('/managers/:id', async (req: AuthedRequest, res) => {
  const manager = await findScopedManager(req, req.params.id);
  if (!manager) {
    res.status(404).json({ error: 'Không tìm thấy vCenter' });
    return;
  }
  // Manager delete cascades VirtualizationHost rows, but not the mirrored Device
  // rows they link to (FK is on the host side) — clean those up explicitly first.
  const hosts = await prisma.virtualizationHost.findMany({ where: { managerId: manager.id }, select: { deviceId: true } });
  const deviceIds = hosts.map((h) => h.deviceId).filter((id): id is string => Boolean(id));
  if (deviceIds.length > 0) {
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
  }
  await prisma.virtualizationManager.delete({ where: { id: manager.id } });
  res.status(204).end();
});

vcenterRouter.get('/managers/:id/inventory', async (req: AuthedRequest, res) => {
  const manager = await findScopedManager(req, req.params.id);
  if (!manager) {
    res.status(404).json({ error: 'Không tìm thấy vCenter' });
    return;
  }
  const hosts = await prisma.virtualizationHost.findMany({
    where: { managerId: manager.id },
    orderBy: { name: 'asc' },
  });
  res.json({ hosts });
});

vcenterRouter.post('/managers/:id/sync', async (req: AuthedRequest, res) => {
  const manager = await findScopedManager(req, req.params.id);
  if (!manager) {
    res.status(404).json({ error: 'Không tìm thấy vCenter' });
    return;
  }
  try {
    const result = await syncVCenterManager(manager.id);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Đồng bộ vCenter thất bại';
    res.status(502).json({ error: message });
  }
});

vcenterRouter.get('/managers/:id/hosts/:hostId/diagnostics', async (req: AuthedRequest, res) => {
  const manager = await findScopedManager(req, req.params.id);
  if (!manager) {
    res.status(404).json({ error: 'Không tìm thấy vCenter' });
    return;
  }
  try {
    const result = await diagnoseVCenterHost(manager.id, req.params.hostId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chẩn đoán thất bại';
    res.status(502).json({ error: message });
  }
});
