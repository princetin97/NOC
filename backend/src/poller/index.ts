import 'dotenv/config';
import { Worker } from 'bullmq';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { redisConnection, pollQueue, discoveryQueue, serviceCheckQueue } from '../lib/queue';
import { pollDevice } from './metrics';
import { discoverDevice } from './discovery';
import { runServiceCheck } from './service-check';
import { runRetentionCleanup } from './cleanup';
import { resolveAlertsFromGlobalTemplateRules } from './alerting';
import { syncAllEnabledVCenterManagers } from './vcenter';

const pollWorker = new Worker('device-poll', async (job) => pollDevice(job.data.deviceId), {
  connection: redisConnection,
  concurrency: env.pollWorkerConcurrency,
});

const discoveryWorker = new Worker('device-discovery', async (job) => discoverDevice(job.data.deviceId), {
  connection: redisConnection,
  concurrency: env.discoveryWorkerConcurrency,
});

const serviceWorker = new Worker('service-check', async (job) => runServiceCheck(job.data.serviceId), {
  connection: redisConnection,
  concurrency: env.serviceWorkerConcurrency,
});

for (const worker of [pollWorker, discoveryWorker, serviceWorker]) {
  worker.on('failed', (job, err) => logger.warn({ err, jobId: job?.id, queue: worker.name }, 'Job failed'));
}

function pollPriorityScore(device: { status: string; packetLoss: number; lastPolled: Date | null }): number {
  if (device.status === 'down') return 0;
  if (device.status === 'warning') return 1;
  if (device.packetLoss > 0) return 2;
  if (!device.lastPolled) return 3;
  return 4;
}

function byPollPriority(
  a: { status: string; packetLoss: number; lastPolled: Date | null },
  b: { status: string; packetLoss: number; lastPolled: Date | null },
): number {
  const scoreDiff = pollPriorityScore(a) - pollPriorityScore(b);
  if (scoreDiff !== 0) return scoreDiff;
  const aTs = a.lastPolled?.getTime() ?? 0;
  const bTs = b.lastPolled?.getTime() ?? 0;
  return aTs - bTs;
}

async function schedulePollCycle(): Promise<void> {
  const counts = await pollQueue.getJobCounts('waiting', 'active');
  const inflight = (counts.waiting ?? 0) + (counts.active ?? 0);
  const bufferTarget = env.pollWorkerConcurrency * env.pollQueueBufferMultiplier;
  const toAdd = Math.max(0, bufferTarget - inflight);
  if (toAdd === 0) {
    logger.debug({ inflight, bufferTarget }, 'Poll queue is full enough, skipping schedule cycle');
    return;
  }

  const dueBefore = new Date(Date.now() - env.pollIntervalSeconds * 1000);
  const candidates = await prisma.device.findMany({
    where: {
      disabled: false,
      OR: [{ lastPolled: null }, { lastPolled: { lt: dueBefore } }],
    },
    select: { id: true, status: true, packetLoss: true, lastPolled: true },
    take: Math.max(toAdd * 4, toAdd),
    orderBy: [{ lastPolled: 'asc' }],
  });
  const devices = candidates.sort(byPollPriority).slice(0, toAdd);
  for (const device of devices) {
    // jobId dedupes so a slow poll doesn't pile up duplicate jobs for the same device.
    await pollQueue.add('poll', { deviceId: device.id }, {
      jobId: `poll-${device.id}`,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
  logger.info({ count: devices.length, inflight, bufferTarget }, 'Poll cycle scheduled');
}

async function scheduleFastPollCycle(): Promise<void> {
  const fastDueBefore = new Date(Date.now() - env.pollFastIntervalSeconds * 1000);
  const candidates = await prisma.device.findMany({
    where: {
      disabled: false,
      OR: [
        { status: 'down' },
        { status: 'warning' },
        { packetLoss: { gt: 0 } },
        { lastPolled: null },
        { lastPolled: { lt: fastDueBefore } },
      ],
    },
    select: { id: true, status: true, packetLoss: true, lastPolled: true },
    take: env.pollFastBatchSize,
    orderBy: [{ lastPolled: 'asc' }],
  });

  const devices = candidates.sort(byPollPriority);
  for (const device of devices) {
    // Re-use the same poll jobId to avoid duplicate jobs for one device.
    await pollQueue.add('poll-fast', { deviceId: device.id }, {
      jobId: `poll-${device.id}`,
      priority: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  if (devices.length > 0) {
    logger.debug({ count: devices.length, fastInterval: env.pollFastIntervalSeconds }, 'Fast poll cycle scheduled');
  }
}

async function scheduleDiscoveryCycle(): Promise<void> {
  const devices = await prisma.device.findMany({ where: { disabled: false }, select: { id: true } });
  for (const device of devices) {
    await discoveryQueue.add('discover', { deviceId: device.id }, { jobId: `discover-${device.id}`, removeOnComplete: true, removeOnFail: true });
  }
  logger.info({ count: devices.length }, 'Discovery cycle scheduled');
}

async function scheduleServiceCheckCycle(): Promise<void> {
  const services = await prisma.serviceCheck.findMany({ where: { enabled: true }, select: { id: true } });
  for (const service of services) {
    await serviceCheckQueue.add('check', { serviceId: service.id }, { jobId: `check-${service.id}`, removeOnComplete: true, removeOnFail: true });
  }
}

// Re-checks only down/warning services sooner than the base interval, so a failing
// service (e.g. a PING monitor) is re-verified/recovered faster, mirroring the
// device fast-poll cycle.
async function scheduleServiceCheckFastCycle(): Promise<void> {
  const services = await prisma.serviceCheck.findMany({
    where: { enabled: true, status: { in: ['down', 'warning'] } },
    select: { id: true },
  });
  for (const service of services) {
    await serviceCheckQueue.add('check-fast', { serviceId: service.id }, {
      jobId: `check-${service.id}`,
      priority: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}

logger.info('Poller scheduler starting');
schedulePollCycle();
scheduleFastPollCycle();
scheduleDiscoveryCycle();
scheduleServiceCheckCycle();
runRetentionCleanup();
void syncAllEnabledVCenterManagers().catch((err) => logger.warn({ err }, 'Initial vCenter sync cycle failed'));
void resolveAlertsFromGlobalTemplateRules()
  .then((count) => {
    if (count > 0) logger.info({ resolvedCount: count }, 'Resolved legacy alerts from global template rules');
  })
  .catch((err) => logger.warn({ err }, 'Failed resolving legacy global-template alerts'));

setInterval(schedulePollCycle, env.pollIntervalSeconds * 1000);
setInterval(scheduleFastPollCycle, env.pollFastIntervalSeconds * 1000);
setInterval(scheduleDiscoveryCycle, env.discoveryIntervalSeconds * 1000);
setInterval(scheduleServiceCheckCycle, env.serviceCheckIntervalSeconds * 1000);
setInterval(scheduleServiceCheckFastCycle, env.serviceCheckFastIntervalSeconds * 1000);
setInterval(runRetentionCleanup, env.cleanupIntervalMinutes * 60_000);
setInterval(
  () => {
    void syncAllEnabledVCenterManagers().catch((err) => logger.warn({ err }, 'vCenter sync cycle failed'));
  },
  env.vcenterSyncIntervalSeconds * 1000,
);
setInterval(
  () => {
    void resolveAlertsFromGlobalTemplateRules().catch((err) =>
      logger.warn({ err }, 'Failed resolving legacy global-template alerts'),
    );
  },
  10 * 60_000,
);
