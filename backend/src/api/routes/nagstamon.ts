import { createHash } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/db';
import { env } from '../../lib/env';

type BridgeAlertStatus = 'active' | 'acknowledged' | 'resolved';

interface BridgeAlert {
  id: string;
  message: string;
  severity: string;
  status: BridgeAlertStatus;
  interfaceName: string | null;
  timestamp: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  device: { name: string; ip: string } | null;
  service: { name: string; target: string } | null;
  rule: { name: string } | null;
}

function decodeBasicAuth(header?: string): { user: string; pass: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  const raw = header.slice(6).trim();
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function requireBridgeAuth(req: Request, res: Response): boolean {
  const user = env.nagstamonUser;
  const pass = env.nagstamonPassword;
  if (!user && !pass) return true;
  const creds = decodeBasicAuth(req.headers.authorization);
  if (creds?.user === user && creds.pass === pass) return true;
  res.setHeader('WWW-Authenticate', 'Basic realm="Nagstamon Bridge"');
  res.status(401).send('Authentication required');
  return false;
}

function fingerprintFromId(id: string): string {
  return createHash('sha1').update(id).digest('hex');
}

function serviceNameFromAlert(alert: BridgeAlert): string {
  if (alert.service?.name) return alert.service.name;
  if (alert.interfaceName) {
    // Keep one row per object (disk mount/interface/sensor target) in Nagstamon.
    if (alert.rule?.name) return `${alert.rule.name} [${alert.interfaceName}]`;
    return `Interface ${alert.interfaceName}`;
  }
  return alert.rule?.name || 'Device Alert';
}

function hostLabelFromAlert(alert: BridgeAlert): string {
  if (alert.device?.name) return alert.device.name;

  // For service checks, prefer a friendly label (e.g. "VNeID - PING" -> "VNeID")
  // instead of raw target IP in Nagstamon's Host column.
  if (alert.service?.name) {
    const head = alert.service.name.split('-')[0]?.trim();
    if (head) return head;
    return alert.service.name;
  }

  return alert.service?.target || 'unknown-host';
}

function hostAddressFromAlert(alert: BridgeAlert): string {
  return alert.device?.ip || alert.service?.target || 'unknown';
}

function mapSeverityForAlertmanager(severity: string): 'critical' | 'high' | 'warning' | 'info' {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'warning';
  return 'info';
}

function alertState(status: BridgeAlertStatus): 'active' | 'suppressed' | 'unprocessed' {
  // Keep acknowledged alerts visible in Nagstamon lists. Some clients hide
  // suppressed rows by default, which makes "acknowledged" disappear.
  if (status === 'acknowledged') return 'active';
  if (status === 'resolved') return 'unprocessed';
  return 'active';
}

function pickUpdatedAt(alert: BridgeAlert): Date {
  return alert.resolvedAt ?? alert.acknowledgedAt ?? alert.timestamp;
}

function endsAt(alert: BridgeAlert): string {
  if (alert.status === 'resolved' && alert.resolvedAt) return alert.resolvedAt.toISOString();
  return '0001-01-01T00:00:00.000Z';
}

async function loadAlerts(): Promise<BridgeAlert[]> {
  const includeAcknowledged = env.nagstamonIncludeAcknowledged;
  const openStatuses: BridgeAlertStatus[] = includeAcknowledged
    ? ['active', 'acknowledged']
    : ['active'];

  const recentAlerts = (await prisma.alert.findMany({
    where: { status: { in: openStatuses } },
    include: {
      device: { select: { name: true, ip: true } },
      service: { select: { name: true, target: true } },
      rule: { select: { name: true } },
    },
    orderBy: { timestamp: 'desc' },
    // Keep the source window aligned with the web UI list for 1:1 comparison.
    take: env.nagstamonSourceWindow,
  })) as BridgeAlert[];

  return recentAlerts;
}

function toAlertmanagerPayload(alert: BridgeAlert, baseUrl: string) {
  const host = hostLabelFromAlert(alert);
  const hostAddress = hostAddressFromAlert(alert);
  const serviceName = serviceNameFromAlert(alert);
  const alertName = serviceName;
  const updated = pickUpdatedAt(alert);
  const state = alertState(alert.status);
  const silencedBy = alert.status === 'acknowledged' ? ['acknowledged'] : [];
  const mappedSeverity = mapSeverityForAlertmanager(alert.severity);
  const priority = mappedSeverity === 'critical' ? 'P1' : mappedSeverity === 'high' ? 'P2' : mappedSeverity === 'warning' ? 'P3' : 'P4';

  return {
    fingerprint: fingerprintFromId(alert.id),
    labels: {
      // Some Alertmanager clients (including Nagstamon integrations) group by
      // alertname+instance, so alertname must include object identity.
      alertname: alertName,
      rule_name: alert.rule?.name || null,
      severity: mappedSeverity,
      severity_original: alert.severity,
      alertstate: state,
      priority,
      instance: host,
      host,
      host_address: hostAddress,
      service: serviceName,
      source: 'device-monitor-system',
      alert_id: alert.id,
    },
    annotations: {
      summary: alert.message,
      description: alert.message,
      ...(alert.interfaceName ? { interface: alert.interfaceName } : {}),
    },
    startsAt: alert.timestamp.toISOString(),
    endsAt: endsAt(alert),
    updatedAt: updated.toISOString(),
    generatorURL: `${baseUrl}/api/alerts/${alert.id}`,
    status: {
      state,
      silencedBy,
      inhibitedBy: [],
    },
    receivers: [{ name: 'default' }],
  };
}

export const nagstamonRouter = Router();

nagstamonRouter.use((req, res, next) => {
  if (!requireBridgeAuth(req, res)) return;
  next();
});

nagstamonRouter.get('/', (_req, res) => {
  res.json({
    name: 'alertmanager-bridge',
    status: 'ok',
    api: {
      alerts: '/alertmanager/api/v2/alerts',
      status: '/alertmanager/api/v2/status',
      health: '/alertmanager/-/healthy',
    },
  });
});

nagstamonRouter.get('/-/healthy', (_req, res) => {
  res.status(200).send('OK');
});

nagstamonRouter.get('/-/ready', (_req, res) => {
  res.status(200).send('OK');
});

nagstamonRouter.get('/api/v2/status', (_req, res) => {
  const now = new Date().toISOString();
  res.json({
    cluster: {
      name: 'device-monitor-system',
      status: 'ready',
      peers: [],
    },
    versionInfo: {
      version: 'bridge-1.0.0',
      revision: 'local',
      branch: 'main',
      buildUser: 'device-monitor-system',
      buildDate: now,
      goVersion: 'n/a',
    },
    uptime: now,
  });
});

nagstamonRouter.get('/api/v2/alerts', async (req, res) => {
  const alerts = await loadAlerts();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json(alerts.map((alert) => toAlertmanagerPayload(alert, baseUrl)));
});

// Read-only bridge: provide a safe, explicit response for silence actions.
nagstamonRouter.get('/api/v2/silences', (_req, res) => {
  res.json([]);
});

nagstamonRouter.post('/api/v2/silences', (_req, res) => {
  res.status(501).json({
    error: 'Silence creation is not supported by this bridge',
  });
});
