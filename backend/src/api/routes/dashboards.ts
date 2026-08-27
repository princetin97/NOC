import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, dashboardSiteWhere, isGlobalAdmin } from '../middleware/site-scope';

export const dashboardsRouter = Router();

// A widget is stored inside the dashboard `layout` JSON. We keep the schema
// permissive (config is a free-form object) so new widget types can be added
// on the UI without a backend/schema change.
const widgetSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

const dashboardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  siteId: z.string().nullish(),
  widgets: z.array(widgetSchema).optional(),
});

type RawDashboardRow = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  siteId: string | null;
  layout: string;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(row: RawDashboardRow) {
  let widgets: unknown = [];
  try {
    widgets = JSON.parse(row.layout);
  } catch {
    widgets = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    siteId: row.siteId,
    widgets,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

dashboardsRouter.get('/', async (req: AuthedRequest, res) => {
  const rows = await prisma.dashboard.findMany({
    where: dashboardSiteWhere(req),
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  res.json(rows.map(serialize));
});

dashboardsRouter.get('/:id', async (req: AuthedRequest, res) => {
  const row = await prisma.dashboard.findFirst({ where: { id: req.params.id, ...(dashboardSiteWhere(req) ?? {}) } });
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(serialize(row));
});

dashboardsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = dashboardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, description, isDefault, widgets, siteId } = parsed.data;
  if (!isGlobalAdmin(req) && !canAccessSite(req, siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo dashboard cho trụ sở này' });
    return;
  }

  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.dashboard.updateMany({ where: { isDefault: true, siteId: siteId ?? null }, data: { isDefault: false } });
    }
    return tx.dashboard.create({
      data: {
        name,
        description: description ?? null,
        isDefault: isDefault ?? false,
        siteId: siteId ?? null,
        layout: JSON.stringify(widgets ?? []),
      },
    });
  });
  res.status(201).json(serialize(row));
});

dashboardsRouter.put('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.dashboard.findFirst({ where: { id: req.params.id, ...(dashboardSiteWhere(req) ?? {}) } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const parsed = dashboardSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, description, isDefault, widgets, siteId } = parsed.data;
  if (!isGlobalAdmin(req) && typeof siteId !== 'undefined' && !canAccessSite(req, siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển dashboard sang trụ sở này' });
    return;
  }

  const nextSiteId = typeof siteId !== 'undefined' ? (siteId ?? null) : existing.siteId;
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description ?? null;
  if (isDefault !== undefined) data.isDefault = isDefault;
  if (siteId !== undefined) data.siteId = siteId ?? null;
  if (widgets !== undefined) data.layout = JSON.stringify(widgets);

  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.dashboard.updateMany({
        where: { isDefault: true, siteId: nextSiteId, NOT: { id: req.params.id } },
        data: { isDefault: false },
      });
    }
    return tx.dashboard.update({ where: { id: req.params.id }, data });
  });
  res.json(serialize(row));
});

dashboardsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.dashboard.findFirst({ where: { id: req.params.id, ...(dashboardSiteWhere(req) ?? {}) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.dashboard.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
