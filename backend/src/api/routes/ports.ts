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

  // For long ranges (especially 7 days), returning only the last 2000 raw points
  // can collapse the visible span to just a few recent hours when polling is frequent.
  // Aggregate into time buckets so the full requested window is always represented.
  if (hours && hours > 24) {
    const since = new Date(Date.now() - hours * 3600_000);
    const bucketSeconds = hours >= 168 ? 900 : hours >= 72 ? 600 : 300; // 15m / 10m / 5m
    type BucketedRow = {
      bucket_ts: Date;
      in_rate_bps: number;
      out_rate_bps: number;
      in_errors: bigint;
      out_errors: bigint;
      utilization: number;
    };
    const rows = await prisma.$queryRaw<BucketedRow[]>`
      SELECT
        to_timestamp(floor(extract(epoch from "timestamp") / ${bucketSeconds}) * ${bucketSeconds})::timestamp AS bucket_ts,
        avg("inRateBps")::double precision AS in_rate_bps,
        avg("outRateBps")::double precision AS out_rate_bps,
        sum("inErrors")::bigint AS in_errors,
        sum("outErrors")::bigint AS out_errors,
        avg(utilization)::double precision AS utilization
      FROM "PortMetric"
      WHERE "portId" = ${req.params.id} AND "timestamp" >= ${since}
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `;

    const metrics = rows.map((r) => ({
      id: `${req.params.id}:${r.bucket_ts.toISOString()}`,
      timestamp: r.bucket_ts,
      inRateBps: Number(r.in_rate_bps ?? 0),
      outRateBps: Number(r.out_rate_bps ?? 0),
      inErrors: Number(r.in_errors ?? 0n),
      outErrors: Number(r.out_errors ?? 0n),
      utilization: Number(r.utilization ?? 0),
    }));

    res.json(metrics);
    return;
  }

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
