import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { serviceCheckQueue } from '../../lib/queue';
import { runServiceCheck } from '../../poller/service-check';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, isGlobalAdmin, serviceSiteWhere } from '../middleware/site-scope';

export const servicesRouter = Router();

const serviceTypeSchema = z.enum(['PING', 'HTTP', 'HTTPS', 'DNS', 'SSH', 'MYSQL', 'BGP', 'TCP']);

const serviceSchema = z.object({
  name: z.string().min(1),
  type: serviceTypeSchema,
  target: z.string().min(1),
  port: z.number().int().optional(),
  enabled: z.boolean().default(true),
  siteId: z.string().nullish(),
});

const serviceBatchSchema = z.object({
  name: z.string().min(1),
  target: z.string().min(1),
  enabled: z.boolean().default(true),
  siteId: z.string().nullish(),
  methods: z
    .array(
      z.object({
        type: serviceTypeSchema,
        port: z.number().int().positive().max(65535).optional(),
      }),
    )
    .min(1),
});

servicesRouter.get('/', async (req: AuthedRequest, res) => {
  const requestedSiteIdRaw = req.query.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.length > 0 ? requestedSiteIdRaw : undefined;
  if (requestedSiteId && !canAccessSite(req, requestedSiteId)) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập trụ sở này' });
    return;
  }

  res.json(
    await prisma.serviceCheck.findMany({
      where: {
        ...(serviceSiteWhere(req) ?? {}),
        ...(requestedSiteId ? { siteId: requestedSiteId } : {}),
      },
      orderBy: { name: 'asc' },
    }),
  );
});

servicesRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!isGlobalAdmin(req) && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo service cho trụ sở này' });
    return;
  }
  const service = await prisma.serviceCheck.create({ data: parsed.data });
  await serviceCheckQueue.add('check', { serviceId: service.id });
  res.status(201).json(service);
});

servicesRouter.post('/batch', async (req: AuthedRequest, res) => {
  const parsed = serviceBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!isGlobalAdmin(req) && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo service cho trụ sở này' });
    return;
  }

  const uniqueMethods = parsed.data.methods.filter(
    (m, idx, arr) =>
      arr.findIndex((x) => x.type === m.type && (x.port ?? null) === (m.port ?? null)) === idx,
  );

  const created = await prisma.$transaction(
    uniqueMethods.map((method) =>
      prisma.serviceCheck.create({
        data: {
          name: uniqueMethods.length > 1 ? `${parsed.data.name} - ${method.type}` : parsed.data.name,
          target: parsed.data.target,
          enabled: parsed.data.enabled,
          siteId: parsed.data.siteId,
          type: method.type,
          port: method.port,
        },
      }),
    ),
  );

  await Promise.all(created.map((service) => serviceCheckQueue.add('check', { serviceId: service.id })));

  res.status(201).json({ created });
});

servicesRouter.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await prisma.serviceCheck.findFirst({ where: { id: req.params.id, ...serviceSiteWhere(req) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Service check not found' });
    return;
  }
  if (!isGlobalAdmin(req) && typeof parsed.data.siteId !== 'undefined' && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển service sang trụ sở này' });
    return;
  }
  const service = await prisma.serviceCheck.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(service);
});

servicesRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.serviceCheck.findFirst({ where: { id: req.params.id, ...serviceSiteWhere(req) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Service check not found' });
    return;
  }
  await prisma.serviceCheck.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

servicesRouter.post('/:id/check-now', async (req: AuthedRequest, res) => {
  const service = await prisma.serviceCheck.findFirst({ where: { id: req.params.id, ...serviceSiteWhere(req) }, select: { id: true } });
  if (!service) {
    res.status(404).json({ error: 'Service check not found' });
    return;
  }

  try {
    await runServiceCheck(service.id);
    res.json({ checked: true, queued: false });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Service check failed' });
  }
});

servicesRouter.get('/:id/history', async (req: AuthedRequest, res) => {
  const service = await prisma.serviceCheck.findFirst({ where: { id: req.params.id, ...serviceSiteWhere(req) }, select: { id: true } });
  if (!service) {
    res.status(404).json({ error: 'Service check not found' });
    return;
  }
  const limit = Number(req.query.limit ?? 100);
  const history = await prisma.serviceCheckHistory.findMany({
    where: { serviceId: req.params.id },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
  res.json(history.reverse());
});
