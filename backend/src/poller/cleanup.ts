import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { env } from '../lib/env';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Prunes unbounded historical tables so the database doesn't grow forever.
 * Runs on an interval from the poller process.
 */
export async function runRetentionCleanup(): Promise<void> {
  const metricCutoff = daysAgo(env.metricRetentionDays);
  const eventCutoff = daysAgo(env.eventRetentionDays);
  const alertCutoff = daysAgo(env.resolvedAlertRetentionDays);

  try {
    const [deviceMetrics, portMetrics, processorMetrics, serviceHistory, events, alerts] = await Promise.all([
      prisma.deviceMetric.deleteMany({ where: { timestamp: { lt: metricCutoff } } }),
      prisma.portMetric.deleteMany({ where: { timestamp: { lt: metricCutoff } } }),
      prisma.processorMetric.deleteMany({ where: { timestamp: { lt: metricCutoff } } }),
      prisma.serviceCheckHistory.deleteMany({ where: { timestamp: { lt: metricCutoff } } }),
      prisma.eventLog.deleteMany({ where: { timestamp: { lt: eventCutoff } } }),
      prisma.alert.deleteMany({ where: { status: 'resolved', resolvedAt: { lt: alertCutoff } } }),
    ]);
    logger.info(
      {
        deviceMetrics: deviceMetrics.count,
        portMetrics: portMetrics.count,
        processorMetrics: processorMetrics.count,
        serviceHistory: serviceHistory.count,
        events: events.count,
        resolvedAlerts: alerts.count,
      },
      'Retention cleanup completed',
    );
  } catch (err) {
    logger.warn({ err }, 'Retention cleanup failed');
  }
}
