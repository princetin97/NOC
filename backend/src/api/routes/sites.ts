import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { requireSystemAdmin, type AuthedRequest } from '../middleware/auth';
import { isGlobalAdmin } from '../middleware/site-scope';

export const sitesRouter = Router();

const siteSchema = z.object({
  name: z.string().min(1),
  code: z.string().trim().min(1).optional(),
  description: z.string().optional(),
});

sitesRouter.get('/', async (req: AuthedRequest, res) => {
  if (isGlobalAdmin(req)) {
    const sites = await prisma.site.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { devices: true, services: true, userMemberships: true } } },
    });
    res.json(sites);
    return;
  }

  const siteIds = req.user?.siteIds ?? [];
  const sites = await prisma.site.findMany({
    where: { id: { in: siteIds } },
    orderBy: { name: 'asc' },
  });
  res.json(sites);
});

sitesRouter.post('/', requireSystemAdmin, async (req, res) => {
  const parsed = siteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const site = await prisma.site.create({
    data: {
      name: parsed.data.name,
      code: parsed.data.code,
      description: parsed.data.description,
    },
  });
  res.status(201).json(site);
});

sitesRouter.put('/:id', requireSystemAdmin, async (req, res) => {
  const parsed = siteSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const site = await prisma.site.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(site);
});

sitesRouter.delete('/:id', requireSystemAdmin, async (req, res) => {
  await prisma.site.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
