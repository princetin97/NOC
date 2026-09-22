import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function parseString(value: string | undefined, fallback = ''): string {
  return (value ?? fallback).trim();
}

function isProductionLike(): boolean {
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  apiPort: Number(process.env.API_PORT ?? 4000),
  syslogPort: Number(process.env.SYSLOG_UDP_PORT ?? 514),
  snmpTrapPort: Number(process.env.SNMPTRAP_UDP_PORT ?? 162),
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 60),
  discoveryIntervalSeconds: Number(process.env.DISCOVERY_INTERVAL_SECONDS ?? 3600),
  pollWorkerConcurrency: parsePositiveInt(process.env.POLL_WORKER_CONCURRENCY, 16),
  discoveryWorkerConcurrency: parsePositiveInt(process.env.DISCOVERY_WORKER_CONCURRENCY, 4),
  serviceWorkerConcurrency: parsePositiveInt(process.env.SERVICE_WORKER_CONCURRENCY, 8),
  pollQueueBufferMultiplier: parsePositiveInt(process.env.POLL_QUEUE_BUFFER_MULTIPLIER, 3),
  pollFastIntervalSeconds: parsePositiveInt(process.env.POLL_FAST_INTERVAL_SECONDS, 15),
  pollFastBatchSize: parsePositiveInt(process.env.POLL_FAST_BATCH_SIZE, 60),
  downFailStreakThreshold: parsePositiveInt(process.env.DOWN_FAIL_STREAK_THRESHOLD, 2),
  pollTransitionBoostWindowSeconds: parsePositiveInt(process.env.POLL_TRANSITION_BOOST_WINDOW_SECONDS, 180),
  pollTransitionBoostStepSeconds: parsePositiveInt(process.env.POLL_TRANSITION_BOOST_STEP_SECONDS, 20),
  pollTransitionBoostMaxJobs: parsePositiveInt(process.env.POLL_TRANSITION_BOOST_MAX_JOBS, 9),
  snmpTimeoutMs: parsePositiveInt(process.env.SNMP_TIMEOUT_MS, 3000),
  snmpRetries: parsePositiveInt(process.env.SNMP_RETRIES, 1),
  // Base interval for HTTP/TCP/DNS/PING service checks (was hardcoded to 60s).
  serviceCheckIntervalSeconds: parsePositiveInt(process.env.SERVICE_CHECK_INTERVAL_SECONDS, 20),
  // Faster re-check cadence applied only to services currently down/warning, so a
  // failing service gets re-verified/recovered sooner than the base interval.
  serviceCheckFastIntervalSeconds: parsePositiveInt(process.env.SERVICE_CHECK_FAST_INTERVAL_SECONDS, 8),
  corsOrigin: (process.env.CORS_ORIGIN ?? '*').trim(),
  // Time-series retention (days). Rows older than this are pruned by the poller.
  metricRetentionDays: Number(process.env.METRIC_RETENTION_DAYS ?? 7),
  eventRetentionDays: Number(process.env.EVENT_RETENTION_DAYS ?? 30),
  resolvedAlertRetentionDays: Number(process.env.RESOLVED_ALERT_RETENTION_DAYS ?? 90),
  cleanupIntervalMinutes: Number(process.env.CLEANUP_INTERVAL_MINUTES ?? 60),
  // Optional Basic Auth account for Nagstamon Alertmanager bridge.
  // Leave empty to disable auth on /alertmanager routes (not recommended for public exposure).
  nagstamonUser: (process.env.NAGSTAMON_USER ?? '').trim(),
  nagstamonPassword: (process.env.NAGSTAMON_PASSWORD ?? '').trim(),
  // Export acknowledged alerts to Alertmanager bridge. Default true so Nagstamon
  // can show the same unresolved set as the web UI (active + acknowledged).
  nagstamonIncludeAcknowledged: parseBoolean(process.env.NAGSTAMON_INCLUDE_ACKNOWLEDGED, true),
  // Align bridge source set with web UI behavior (latest 500 alerts by default).
  nagstamonSourceWindow: parsePositiveInt(process.env.NAGSTAMON_SOURCE_WINDOW, 500),
  // How often the poller re-syncs ESXi host/VM inventory from each enabled vCenter manager.
  vcenterSyncIntervalSeconds: parsePositiveInt(process.env.VCENTER_SYNC_INTERVAL_SECONDS, 300),
  // One-time token used only for the first admin bootstrap via /api/auth/bootstrap.
  authBootstrapToken: parseString(process.env.AUTH_BOOTSTRAP_TOKEN),
  allowInsecureDefaults: parseBoolean(process.env.ALLOW_INSECURE_DEFAULTS, false),
};

if (isProductionLike() && !env.allowInsecureDefaults) {
  const insecureSecrets = new Set(['dev-secret-change-me', 'change-me-to-a-long-random-string']);
  if (insecureSecrets.has(env.jwtSecret)) {
    throw new Error('Refusing to start in production with insecure JWT_SECRET. Set a strong JWT_SECRET or ALLOW_INSECURE_DEFAULTS=true.');
  }
  if (env.corsOrigin === '*') {
    throw new Error('Refusing to start in production with CORS_ORIGIN=* . Set an explicit allowed origin or ALLOW_INSECURE_DEFAULTS=true.');
  }
}
