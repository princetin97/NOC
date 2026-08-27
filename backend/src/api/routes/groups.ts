import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, getScopedSiteIds, isGlobalAdmin } from '../middleware/site-scope';

export const groupsRouter = Router();

const groupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3b82f6'),
  parentId: z.string().nullable().optional(),
  siteId: z.string().nullish(),
});

async function ensureValidParent(
  groupId: string | null,
  parentId: string | null,
  expectedSiteId: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  if (groupId && groupId === parentId) {
    throw new Error('Nhóm không thể là cha của chính nó.');
  }

  const parent = await prisma.deviceGroup.findUnique({ where: { id: parentId }, select: { id: true, parentId: true, siteId: true } });
  if (!parent) {
    throw new Error('Nhóm cha không tồn tại.');
  }

  const parentSite = parent.siteId ?? null;
  if (parentSite !== expectedSiteId) {
    throw new Error('Nhóm cha phải cùng trụ sở với nhóm con.');
  }

  if (!groupId) return parentId;

  let cursor: string | null = parent.parentId;
  let guard = 0;
  while (cursor && guard < 100) {
    if (cursor === groupId) {
      throw new Error('Không thể tạo vòng lặp trong cây nhóm.');
    }
    const node = await prisma.deviceGroup.findUnique({ where: { id: cursor }, select: { parentId: true } });
    cursor = node?.parentId ?? null;
    guard += 1;
  }

  return parentId;
}

function requestedSiteId(req: AuthedRequest): string | null | undefined {
  const raw = req.query.siteId;
  if (raw === undefined) return undefined;
  if (raw === '' || raw === 'null') return null;
  if (typeof raw === 'string') return raw;
  return undefined;
}

function isUniqueNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = Array.isArray(err.meta?.target) ? err.meta.target : [];
  const hasName = target.includes('name');
  const hasSite = target.includes('siteId');
  return hasName || hasSite;
}

groupsRouter.get('/', async (req: AuthedRequest, res) => {
  const siteIdFilter = requestedSiteId(req);
  if (!isGlobalAdmin(req)) {
    if (siteIdFilter === null) {
      res.status(403).json({ error: 'Bạn không có quyền xem nhóm không gán trụ sở' });
      return;
    }
    if (typeof siteIdFilter === 'string' && !canAccessSite(req, siteIdFilter)) {
      res.status(403).json({ error: 'Bạn không có quyền xem nhóm của trụ sở này' });
      return;
    }
  }

  let where: { siteId?: string | null | { in: string[] } } = {};
  if (isGlobalAdmin(req)) {
    if (siteIdFilter !== undefined) where = { siteId: siteIdFilter };
  } else if (siteIdFilter !== undefined) {
    where = { siteId: siteIdFilter };
  } else {
    where = { siteId: { in: getScopedSiteIds(req) } };
  }

  const groups = await prisma.deviceGroup.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { devices: true } } },
  });

  res.json(groups.map((g) => ({ ...g, deviceCount: g._count.devices, _count: undefined })));
});

groupsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const siteId = parsed.data.siteId ?? null;
  if (!isGlobalAdmin(req) && !canAccessSite(req, siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo nhóm cho trụ sở này' });
    return;
  }
  try {
    const parentId = await ensureValidParent(null, parsed.data.parentId ?? null, siteId);
    const group = await prisma.deviceGroup.create({ data: { ...parsed.data, parentId, siteId } });
    res.status(201).json(group);
  } catch (err) {
    if (isUniqueNameConflict(err)) {
      res.status(409).json({ error: 'Tên nhóm đã tồn tại trong trụ sở này.' });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'Tạo nhóm thất bại' });
  }
});

groupsRouter.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = groupSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.deviceGroup.findUnique({ where: { id: req.params.id }, select: { id: true, siteId: true, parentId: true } });
  if (!existing) {
    res.status(404).json({ error: 'Nhóm không tồn tại' });
    return;
  }
  if (!isGlobalAdmin(req) && !canAccessSite(req, existing.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền cập nhật nhóm này' });
    return;
  }

  const nextSiteId = Object.prototype.hasOwnProperty.call(parsed.data, 'siteId') ? (parsed.data.siteId ?? null) : (existing.siteId ?? null);
  if (!isGlobalAdmin(req) && !canAccessSite(req, nextSiteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển nhóm sang trụ sở này' });
    return;
  }

  try {
    const nextParentInput = Object.prototype.hasOwnProperty.call(parsed.data, 'parentId')
      ? parsed.data.parentId ?? null
      : existing.parentId ?? null;
    const parentId = await ensureValidParent(req.params.id, nextParentInput, nextSiteId);

    const group = await prisma.$transaction(async (tx) => {
      const updated = await tx.deviceGroup.update({
        where: { id: req.params.id },
        data: {
          ...parsed.data,
          siteId: nextSiteId,
          parentId,
        },
      });

      // Moving a group to another site also moves its member devices to keep
      // data consistent (selected-site views won't split group vs devices).
      // Descendant groups (all levels) follow the parent's new site as well.
      if ((existing.siteId ?? null) !== nextSiteId) {
        const allGroups = await tx.deviceGroup.findMany({ select: { id: true, parentId: true } });
        const byParent = new Map<string, string[]>();
        for (const g of allGroups) {
          if (!g.parentId) continue;
          const list = byParent.get(g.parentId) ?? [];
          list.push(g.id);
          byParent.set(g.parentId, list);
        }

        const affectedGroupIds: string[] = [req.params.id];
        const queue: string[] = [req.params.id];
        const seen = new Set<string>(queue);
        while (queue.length > 0) {
          const current = queue.shift() as string;
          const children = byParent.get(current) ?? [];
          for (const childId of children) {
            if (seen.has(childId)) continue;
            seen.add(childId);
            affectedGroupIds.push(childId);
            queue.push(childId);
          }
        }

        await tx.deviceGroup.updateMany({
          where: { id: { in: affectedGroupIds } },
          data: { siteId: nextSiteId },
        });
        await tx.device.updateMany({
          where: { groupId: { in: affectedGroupIds } },
          data: { siteId: nextSiteId },
        });
      }

      return updated;
    });

    res.json(group);
  } catch (err) {
    if (isUniqueNameConflict(err)) {
      res.status(409).json({ error: 'Tên nhóm đã tồn tại trong trụ sở này.' });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'Cập nhật nhóm thất bại' });
  }
});

groupsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.deviceGroup.findUnique({ where: { id: req.params.id }, select: { id: true, siteId: true } });
  if (!existing) {
    res.status(404).json({ error: 'Nhóm không tồn tại' });
    return;
  }
  if (!isGlobalAdmin(req) && !canAccessSite(req, existing.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền xóa nhóm này' });
    return;
  }

  // Devices keep existing; their groupId is nulled via the SetNull relation.
  await prisma.deviceGroup.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
