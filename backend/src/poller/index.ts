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
import { shouldPollDeviceNow, getPollCooldownRemainingMs } from './cooldown';

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

function pollPriorityScore(device: { isPriority: boolean; status: string; packetLoss: number; lastPolled: Date | null }): number {
  if (device.isPriority) return -1;
  if (device.status === 'down') return 0;
  if (device.status === 'warning') return 1;
  if (device.packetLoss > 0) return 2;
  if (!device.lastPolled) return 3;
  return 4;
}

function byPollPriority(
  a: { isPriority: boolean; status: string; packetLoss: number; lastPolled: Date | null },
  b: { isPriority: boolean; status: string; packetLoss: number; lastPolled: Date | null },
): number {
  const scoreDiff = pollPriorityScore(a) - pollPriorityScore(b);
  if (scoreDiff !== 0) return scoreDiff;
  const aTs = a.lastPolled?.getTime() ?? 0;
  const bTs = b.lastPolled?.getTime() ?? 0;
  return aTs - bTs;
}

function pickEligibleDevices<T extends { id: string }>(
  candidates: T[],
  maxCount: number,
  options?: { bypassCooldown?: (device: T) => boolean },
): { picked: T[]; skippedCooldown: number } {
  const picked: T[] = [];
  let skippedCooldown = 0;
  for (const device of candidates) {
    if (picked.length >= maxCount) break;
    if (options?.bypassCooldown?.(device)) {
      picked.push(device);
      continue;
    }
    if (!shouldPollDeviceNow(device.id)) {
      skippedCooldown += 1;
      continue;
    }
    picked.push(device);
  }
  return { picked, skippedCooldown };
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
    select: { id: true, isPriority: true, status: true, packetLoss: true, lastPolled: true },
    take: Math.max(toAdd * 8, toAdd),
    orderBy: [{ lastPolled: 'asc' }],
  });
  const sorted = candidates.sort(byPollPriority);
  const { picked: devices, skippedCooldown } = pickEligibleDevices(sorted, toAdd);
  if (devices.length > 0) {
    await pollQueue.addBulk(
      devices.map((device) => ({
        name: 'poll',
        data: { deviceId: device.id },
        opts: {
          // jobId dedupes so a slow poll doesn't pile up duplicate jobs for the same device.
          // BullMQ treats unprioritized jobs as highest priority, so this must be explicitly
          // lower than the fast/boost recheck jobs (priority: 1) or it would starve them.
          jobId: `poll-${device.id}`,
          priority: device.isPriority ? 2 : 5,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
  }
  const priorityCount = devices.filter((d) => d.isPriority).length;
  logger.info({ count: devices.length, priorityCount, skippedCooldown, inflight, bufferTarget }, 'Poll cycle scheduled');
}

async function scheduleFastPollCycle(): Promise<void> {
  const fastDueBefore = new Date(Date.now() - env.pollFastIntervalSeconds * 1000);
  const candidates = await prisma.device.findMany({
    where: {
      disabled: false,
      OR: [
        { isPriority: true },
        { status: 'down' },
        { status: 'warning' },
        { packetLoss: { gt: 0 } },
        { lastPolled: null },
        { lastPolled: { lt: fastDueBefore } },
      ],
    },
    select: { id: true, isPriority: true, status: true, packetLoss: true, lastPolled: true },
    take: Math.max(env.pollFastBatchSize * 6, env.pollFastBatchSize),
    orderBy: [{ lastPolled: 'asc' }],
  });

  const sorted = candidates.sort(byPollPriority);
  const { picked: devices, skippedCooldown } = pickEligibleDevices(sorted, env.pollFastBatchSize, {
    // Recovery-first behavior: devices currently marked DOWN are always eligible for
    // fast rechecks, even during cooldown, so they can flip back to UP immediately
    // when ping is back (without waiting for SNMP/cooldown windows).
    bypassCooldown: (device) => device.status === 'down',
  });
  if (devices.length > 0) {
    await pollQueue.addBulk(
      devices.map((device) => ({
        name: 'poll-fast',
        data: { deviceId: device.id },
        opts: {
          // Re-use the same poll jobId to avoid duplicate jobs for one device.
          jobId: `poll-${device.id}`,
          priority: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
  }

  if (devices.length > 0) {
    const priorityCount = devices.filter((d) => d.isPriority).length;
    const maxCooldownSeconds = Math.max(
      0,
      ...sorted.map((d) => Math.floor(getPollCooldownRemainingMs(d.id) / 1000)),
    );
    logger.debug({ count: devices.length, priorityCount, skippedCooldown, maxCooldownSeconds, fastInterval: env.pollFastIntervalSeconds }, 'Fast poll cycle scheduled');
  }
}

async function scheduleDiscoveryCycle(): Promise<void> {
  const devices = await prisma.device.findMany({ where: { disabled: false, snmpPort: { gt: 0 } }, select: { id: true } });
  const windowMs = Math.max(1, env.discoveryIntervalSeconds * 1000);
  if (devices.length > 0) {
    await discoveryQueue.addBulk(
      devices.map((device) => ({
        name: 'discover',
        data: { deviceId: device.id },
        opts: {
          jobId: `discover-${device.id}`,
          // Spread discovery jobs over the full interval to avoid synchronized bursts.
          delay: Math.floor(Math.random() * windowMs),
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
  }
  logger.info({ count: devices.length }, 'Discovery cycle scheduled');
}

async function scheduleServiceCheckCycle(): Promise<void> {
  const services = await prisma.serviceCheck.findMany({ where: { enabled: true }, select: { id: true } });
  if (services.length > 0) {
    await serviceCheckQueue.addBulk(
      services.map((service) => ({
        name: 'check',
        data: { serviceId: service.id },
        opts: {
          // See the poll queue's 'poll' job above: unprioritized jobs are treated as highest
          // priority by BullMQ, so this needs an explicit lower priority than 'check-fast'.
          jobId: `check-${service.id}`,
          priority: 5,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
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
  if (services.length > 0) {
    await serviceCheckQueue.addBulk(
      services.map((service) => ({
        name: 'check-fast',
        data: { serviceId: service.id },
        opts: {
          jobId: `check-${service.id}`,
          priority: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
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
