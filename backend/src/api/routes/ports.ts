import { Router } from 'express';
import { prisma } from '../../lib/db';

export const portsRouter = Router();

portsRouter.get('/', async (req, res) => {
  const deviceId = req.query.deviceId as string | undefined;
  const ports = await prisma.port.findMany({
    where: deviceId ? { deviceId } : undefined,
    orderBy: { ifIndex: 'asc' },
  });
  res.json(ports);
});

portsRouter.get('/:id', async (req, res) => {
  const port = await prisma.port.findUnique({ where: { id: req.params.id } });
  if (!port) {
    res.status(404).json({ error: 'Port not found' });
    return;
  }
  res.json(port);
});

portsRouter.get('/:id/metrics', async (req, res) => {
  const limit = Number(req.query.limit ?? 200);
  // Optional time window in hours (e.g. ?hours=24). Defaults to the most recent `limit` rows.
  const hours = req.query.hours ? Number(req.query.hours) : undefined;
  const where = {
    portId: req.params.id,
    ...(hours ? { timestamp: { gte: new Date(Date.now() - hours * 3600_000) } } : {}),
  };
  const metrics = await prisma.portMetric.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(hours ? 2000 : limit, 2000),
  });
  res.json(metrics.reverse());
});
