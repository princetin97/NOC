import { Router } from 'express';
import { prisma } from '../../lib/db';
import { pollQueue, discoveryQueue, serviceCheckQueue } from '../../lib/queue';

export const healthRouter = Router();

async function queueStats(queue: typeof pollQueue) {
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  return {
    name: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}

healthRouter.get('/', async (_req, res) => {
  const [queues, deviceCount, staleDevices, downDevices, lastPolledDevice] = await Promise.all([
    Promise.all([queueStats(pollQueue), queueStats(discoveryQueue), queueStats(serviceCheckQueue)]),
    prisma.device.count({ where: { disabled: false } }),
    // Devices not polled in the last 5 minutes are considered stale (polling may be stuck).
    prisma.device.count({ where: { disabled: false, OR: [{ lastPolled: null }, { lastPolled: { lt: new Date(Date.now() - 5 * 60_000) } }] } }),
    prisma.device.count({ where: { disabled: false, status: 'down' } }),
    prisma.device.findFirst({ where: { disabled: false }, orderBy: { lastPolled: 'desc' }, select: { lastPolled: true } }),
  ]);

  res.json({
    queues,
    devices: {
      total: deviceCount,
      down: downDevices,
      stale: staleDevices,
      lastPolledAt: lastPolledDevice?.lastPolled ?? null,
    },
    timestamp: new Date().toISOString(),
  });
});
