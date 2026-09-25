import { prisma } from '../lib/db';
import { publishEvent } from '../lib/events';
import { dispatchAlertNotification } from '../lib/notifications';

const PING_SAMPLE_PACKETS = 3;

type RuleRow = {
  id: string;
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  unit: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  scope: string;
  deviceId: string | null;
  deviceIds: string[];
  portId: string | null;
  groupId: string | null;
  groupIds: string[];
  siteId: string | null;
  serviceId: string | null;
  serviceIds: string[];
  portIds: string[];
  sensorId: string | null;
  sensorIds: string[];
  sensorType: string | null;
  osFilter: string | null;
  renotifyMinutes: number;
};

const INTERFACE_METRICS = new Set([
  'interface_traffic',
  'interface_traffic_in',
  'interface_traffic_out',
  'interface_utilization',
  'interface_status',
  'interface_errors',
  'interface_discards',
]);

const SERVICE_METRICS = new Set(['service_status', 'service_response_time', 'service_uptime']);

function isInterfaceRule(rule: { scope: string; metric: string }): boolean {
  return rule.scope === 'interface' || INTERFACE_METRICS.has(rule.metric);
}

function isServiceRule(rule: { scope: string; metric: string }): boolean {
  return rule.scope === 'service' || SERVICE_METRICS.has(rule.metric);
}

// Boolean up/down metrics whose raw 0/1 values should render as "Up"/"Down" text
// in alert messages and notifications, never as raw numbers.
const STATUS_METRICS = new Set(['interface_status', 'device_status', 'bgp_session', 'service_status']);

function formatMetricValue(metric: string, value: number, unit: string): string {
  if (STATUS_METRICS.has(metric)) return value > 0 ? 'Down' : 'Up';
  return `${value}${unit}`;
}

// Coarse alert category used to route notifications to different Telegram topics/
// channels (e.g. "temperature" vs "service"). Sensor-type rules use sensorType
// directly; everything else falls back to scope or a handful of known metrics.
function normalizeSensorCategory(sensorType: string | null): string | null {
  if (!sensorType) return null;
  const raw = sensorType.trim().toLowerCase();
  if (!raw) return null;

  if (['temperature', 'temp', 'thermal', 'celsius'].includes(raw)) return 'temperature';
  if (['cpu', 'processor', 'core'].includes(raw)) return 'cpu';
  if (['memory', 'ram'].includes(raw)) return 'memory';
  if (['fan', 'fans'].includes(raw)) return 'fan';
  if (['power', 'psu', 'wattage', 'watt'].includes(raw)) return 'power';
  if (['voltage', 'volt', 'v'].includes(raw)) return 'voltage';
  if (['humidity', 'rh'].includes(raw)) return 'humidity';
  if (['disk', 'storage', 'drive'].includes(raw)) return 'disk';
  if (raw === 'service') return 'service';
  if (raw === 'interface') return 'interface';
  if (raw === 'bgp') return 'bgp';
  if (raw === 'device_status') return 'device_status';
  if (raw === 'other') return 'other';
  return null;
}

function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferLegacySensorCategory(rule: { metric: string; name: string; unit: string }): string | null {
  const metric = foldText(rule.metric);
  const name = foldText(rule.name);
  const unitRaw = foldText(rule.unit);
  const unit = unitRaw.replace(/[^a-z0-9%]/g, '');

  if (metric === 'temperature') return 'temperature';
  if (/nhiet|temperature|temp/.test(name) || ['c', 'f', 'degc', 'degf', 'celsius', 'fahrenheit'].includes(unit)) return 'temperature';
  if (/cpu|processor|core/.test(name)) return 'cpu';
  if (/memory|ram/.test(name)) return 'memory';
  if (/fan|quat|rpm/.test(name) || unit.includes('rpm')) return 'fan';
  if (/power|nguon|psu/.test(name) || unit === 'w') return 'power';
  if (/voltage|dien ap|volt/.test(name) || unit === 'v') return 'voltage';
  if (/humidity|do am/.test(name) || unit.includes('%rh')) return 'humidity';
  if (/disk|ổ đĩa|storage|drive/.test(name)) return 'disk';
  return null;
}

function alertCategory(rule: { scope: string; metric: string; sensorType: string | null; name: string; unit: string }): string {
  if (rule.scope === 'service') return 'service';
  if (rule.scope === 'interface') return 'interface';

  const normalized = normalizeSensorCategory(rule.sensorType);
  if (normalized) return normalized;

  if (rule.scope === 'sensor' || rule.metric === 'sensor_value') {
    const inferred = inferLegacySensorCategory(rule);
    if (inferred) return inferred;
  }

  switch (rule.metric) {
    case 'device_status':
      return 'device_status';
    case 'bgp_session':
      return 'bgp';
    case 'temperature':
      return 'temperature';
    case 'cpu_usage':
      return 'cpu';
    case 'memory_usage':
      return 'memory';
    default:
      return 'other';
  }
}

function isSensorRule(rule: {
  scope: string;
  metric: string;
  sensorId: string | null;
  sensorIds: string[];
  sensorType: string | null;
}): boolean {
  return (
    rule.scope === 'sensor' ||
    rule.metric === 'sensor_value' ||
    !!rule.sensorId ||
    rule.sensorIds.length > 0 ||
    !!rule.sensorType
  );
}

// Cache enabled alert rules briefly — they rarely change and are identical across
// all devices in the same poll cycle, so fetching them once saves ~100 DB queries/min.
let rulesCache: { data: RuleRow[]; expiresAt: number } | null = null;

async function getEnabledRules(): Promise<RuleRow[]> {
  if (rulesCache && rulesCache.expiresAt > Date.now()) return rulesCache.data;
  const data = (await prisma.alertRule.findMany({ where: { enabled: true } })) as RuleRow[];
  rulesCache = { data, expiresAt: Date.now() + 30_000 };
  return data;
}

/**
 * Global rules (siteId=null) are template-only and should not keep active alerts.
 * This cleanup resolves legacy alerts created before template-only enforcement.
 */
export async function resolveAlertsFromGlobalTemplateRules(): Promise<number> {
  const result = await prisma.alert.updateMany({
    where: {
      status: { in: ['active', 'acknowledged'] },
      rule: { siteId: null },
    },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  return result.count;
}

/** Evaluates enabled alert rules against a device's latest metrics and creates/resolves alerts. */
export async function evaluateAlertsForDevice(deviceId: string): Promise<void> {
  const rules = await getEnabledRules();
  const hasInterfaceRules = rules.some(isInterfaceRule);

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { ports: hasInterfaceRules },
  });
  if (!device) return;

  // Cast: ports are always present when hasInterfaceRules is true (the only path
  // that calls evaluateInterfaceRule).
  const deviceWithPorts = device as typeof device & { ports: typeof device extends { ports: infer P } ? P : never[] };

  for (const rule of rules) {
    if (isServiceRule(rule)) continue;
    // Trap-driven port-security alerts are lifecycle-managed in trap.ts (violation/new,
    // recovery or linkUp/resolved). They must not go through periodic interface
    // evaluation, otherwise they'll be treated as "orphan" object names and get
    // auto-resolved even while the port is still err-disabled.
    if (rule.metric === 'port_security_trap') continue;
    // Global rules (siteId=null) are templates only and must not generate alerts.
    if (!rule.siteId) continue;
    // Multi-device target takes precedence over single deviceId
    if (rule.deviceIds && rule.deviceIds.length > 0) {
      if (!rule.deviceIds.includes(deviceId)) continue;
    } else if (rule.deviceId && rule.deviceId !== deviceId) {
      continue;
    }
    if (rule.siteId && rule.siteId !== device.siteId) continue;
    if (rule.groupIds && rule.groupIds.length > 0) {
      if (!device.groupId || !rule.groupIds.includes(device.groupId)) continue;
    } else if (rule.groupId && device.groupId !== rule.groupId) continue;
    if (rule.osFilter && !(device.os ?? '').toLowerCase().includes(rule.osFilter.toLowerCase())) continue;

    if (isSensorRule(rule)) {
      await evaluateSensorRule(device, rule);
    } else if (isInterfaceRule(rule)) {
      await evaluateInterfaceRule(deviceWithPorts as any, rule);
    } else {
      await evaluateDeviceRule(device, rule);
    }
  }
}

/** Evaluates enabled service rules against the latest result of one service check. */
export async function evaluateAlertsForService(serviceId: string): Promise<void> {
  const rules = await getEnabledRules();
  const service = await prisma.serviceCheck.findUnique({ where: { id: serviceId } });
  if (!service) return;

  for (const rule of rules) {
    if (!isServiceRule(rule)) continue;
    // Global rules (siteId=null) are templates only and must not generate alerts.
    if (!rule.siteId) continue;

    if (rule.serviceIds && rule.serviceIds.length > 0) {
      if (!rule.serviceIds.includes(service.id)) continue;
    } else if (rule.serviceId && rule.serviceId !== service.id) {
      continue;
    }

    if (rule.siteId && rule.siteId !== service.siteId) continue;

    await evaluateServiceRule(service, rule);
  }
}

async function evaluateDeviceRule(
  device: {
    id: string;
    name: string;
    ip: string;
    siteId: string | null;
    cpuUsage: number;
    memoryUsage: number;
    temperature: number | null;
    pingLatencyMs: number | null;
    packetLoss: number;
    uptimeSeconds: number;
    status: string;
  },
  rule: RuleRow,
): Promise<void> {
  const alertSource = { deviceId: device.id, name: device.name, ip: device.ip, serviceId: null, siteId: device.siteId };
  const metricValue = readDeviceMetric(rule.metric, device);
  if (metricValue === undefined) return;

  const breached = compare(metricValue, rule.condition, rule.threshold);
  const existing = await prisma.alert.findFirst({
    where: { deviceId: device.id, ruleId: rule.id, interfaceName: null, status: { in: ['active', 'acknowledged'] } },
  });

  if (breached && !existing) {
    await raiseAlert(alertSource, rule, metricValue, null);
  } else if (!breached && existing) {
    await resolveAlert(alertSource, existing.id, existing.status === 'acknowledged', rule, metricValue);
  } else if (breached && existing) {
    await maybeRenotify(alertSource, rule, existing, metricValue, null);
  }
}

async function evaluateInterfaceRule(
  device: {
    id: string;
    name: string;
    ip: string;
    siteId: string | null;
    ports: {
      id: string;
      ifName: string;
      ifAlias: string | null;
      ifDescr: string | null;
      ifOperStatus: string;
      inRateBps: number;
      outRateBps: number;
      utilization: number;
    }[];
  },
  rule: RuleRow,
): Promise<void> {
  const alertSource = { deviceId: device.id, name: device.name, ip: device.ip, serviceId: null, siteId: device.siteId };
  const openAlerts = await prisma.alert.findMany({
    where: { deviceId: device.id, ruleId: rule.id, status: { in: ['active', 'acknowledged'] } },
    orderBy: { timestamp: 'desc' },
  });
  const openByObject = new Map<string, (typeof openAlerts)[number]>();
  const duplicateOpenAlerts: (typeof openAlerts)[number][] = [];
  for (const alert of openAlerts) {
    const key = alert.interfaceName ?? '';
    if (openByObject.has(key)) {
      duplicateOpenAlerts.push(alert);
      continue;
    }
    openByObject.set(key, alert);
  }

  // Restrict to the targeted interfaces: portIds (multi) takes precedence, then a
  // single portId, otherwise every port of the device.
  const targetIds = rule.portIds.length > 0 ? new Set(rule.portIds) : rule.portId ? new Set([rule.portId]) : null;
  const ports = targetIds ? device.ports.filter((p) => targetIds.has(p.id)) : device.ports;
  const seenObjects = new Set<string>();

  for (const port of ports) {
    seenObjects.add(port.ifName);
    const metricValue = await readInterfaceMetric(rule.metric, port);
    if (metricValue === undefined) continue;
    const interfaceDescription = rule.metric === 'interface_status' ? portDescription(port) : null;

    const breached = compare(metricValue, rule.condition, rule.threshold);
    const existing = openByObject.get(port.ifName);

    if (breached && !existing) {
      await raiseAlert(alertSource, rule, metricValue, port.ifName, interfaceDescription);
    } else if (!breached && existing) {
      await resolveAlert(alertSource, existing.id, existing.status === 'acknowledged', rule, metricValue, interfaceDescription);
    } else if (breached && existing) {
      await maybeRenotify(alertSource, rule, existing, metricValue, port.ifName, interfaceDescription);
    }
  }

  // Resolve orphaned/duplicate open alerts that are no longer represented in this
  // evaluation pass (port renamed/removed) or created concurrently in older cycles.
  for (const [objectName, existing] of openByObject.entries()) {
    if (objectName.length > 0 && seenObjects.has(objectName)) continue;
    await resolveAlert(alertSource, existing.id, existing.status === 'acknowledged', rule);
  }
  for (const dup of duplicateOpenAlerts) {
    await resolveAlert(alertSource, dup.id, dup.status === 'acknowledged', rule);
  }
}

// Per-object rule: evaluates a custom threshold against one or more discovered
// sensors/components (temperature/fan/voltage/power/humidity/disk/per-component CPU...).
// A single rule may target several same-unit objects; each is evaluated independently
// and keyed by its own description so alerts raise/resolve per object.
async function evaluateSensorRule(
  device: { id: string; name: string; ip: string; siteId: string | null },
  rule: RuleRow,
): Promise<void> {
  const alertSource = { deviceId: device.id, name: device.name, ip: device.ip, serviceId: null, siteId: device.siteId };
  const openAlerts = await prisma.alert.findMany({
    where: { deviceId: device.id, ruleId: rule.id, status: { in: ['active', 'acknowledged'] } },
    orderBy: { timestamp: 'desc' },
  });
  const openByObject = new Map<string, (typeof openAlerts)[number]>();
  const duplicateOpenAlerts: (typeof openAlerts)[number][] = [];
  for (const alert of openAlerts) {
    const key = alert.interfaceName ?? '';
    if (openByObject.has(key)) {
      duplicateOpenAlerts.push(alert);
      continue;
    }
    openByObject.set(key, alert);
  }

  // Dynamic fleet rule: match every sensor of the given type on this device.
  // Otherwise fall back to the explicit sensor id list (per-object rule).
  let sensors: { description: string; value: number | null }[];
  if (rule.sensorType) {
    sensors = await prisma.sensor.findMany({
      where: { deviceId: device.id, type: rule.sensorType },
      select: { description: true, value: true },
    });
  } else {
    const ids = rule.sensorIds.length > 0 ? rule.sensorIds : rule.sensorId ? [rule.sensorId] : [];
    if (ids.length === 0) return;
    // Group/multi-device rules store sensor IDs from one reference device. For other
    // devices, match by type+index so identical sensors on same-model devices are evaluated.
    const isOtherDevice = rule.deviceId !== device.id;
    if (isOtherDevice && (rule.groupId || rule.groupIds.length > 0 || rule.deviceIds.length > 1)) {
      const refSensors = await prisma.sensor.findMany({
        where: { id: { in: ids } },
        select: { type: true, index: true },
      });
      if (refSensors.length === 0) return;
      sensors = await prisma.sensor.findMany({
        where: {
          deviceId: device.id,
          OR: refSensors.map((s) => ({ type: s.type, index: s.index })),
        },
        select: { description: true, value: true },
      });
    } else {
      sensors = await prisma.sensor.findMany({
        where: { id: { in: ids }, deviceId: device.id },
        select: { description: true, value: true },
      });
    }
  }

  const seenObjects = new Set<string>();

  for (const sensor of sensors) {
    if (sensor.value === null || sensor.value === undefined) continue;
    seenObjects.add(sensor.description);

    const breached = compare(sensor.value, rule.condition, rule.threshold);
    const existing = openByObject.get(sensor.description);

    if (breached && !existing) {
      await raiseAlert(alertSource, rule, sensor.value, sensor.description);
    } else if (!breached && existing) {
      await resolveAlert(alertSource, existing.id, existing.status === 'acknowledged', rule, sensor.value);
    } else if (breached && existing) {
      await maybeRenotify(alertSource, rule, existing, sensor.value, sensor.description);
    }
  }

  for (const [objectName, existing] of openByObject.entries()) {
    if (objectName.length > 0 && seenObjects.has(objectName)) continue;
    await resolveAlert(alertSource, existing.id, existing.status === 'acknowledged', rule);
  }
  for (const dup of duplicateOpenAlerts) {
    await resolveAlert(alertSource, dup.id, dup.status === 'acknowledged', rule);
  }
}

async function evaluateServiceRule(
  service: { id: string; name: string; target: string; type: string; port: number | null; status: string; responseTimeMs: number; uptimePercent: number; siteId: string | null },
  rule: RuleRow,
): Promise<void> {
  const metricValue = readServiceMetric(rule.metric, service);
  if (metricValue === undefined) return;

  const breached = compare(metricValue, rule.condition, rule.threshold);
  const objectName = `${service.type}${service.port ? `:${service.port}` : ''}`;
  const openAlerts = await prisma.alert.findMany({
    where: { serviceId: service.id, ruleId: rule.id, status: { in: ['active', 'acknowledged'] } },
    orderBy: { timestamp: 'desc' },
  });
  const openByObject = new Map<string, (typeof openAlerts)[number]>();
  const duplicateOpenAlerts: (typeof openAlerts)[number][] = [];
  for (const alert of openAlerts) {
    const key = alert.interfaceName ?? '';
    if (openByObject.has(key)) {
      duplicateOpenAlerts.push(alert);
      continue;
    }
    openByObject.set(key, alert);
  }
  const existing = openByObject.get(objectName);

  const alertSource = {
    deviceId: null,
    name: service.name,
    ip: service.target,
    serviceId: service.id,
    siteId: service.siteId,
  };

  // Service flaps are common on a single probe timeout. For status-down alerts,
  // require two consecutive failed checks before opening a new alert.
  let shouldRaise = breached;
  if (breached && !existing && rule.metric === 'service_status' && metricValue > 0) {
    shouldRaise = await hasConsecutiveServiceFailures(service.id, 2);
  }

  if (shouldRaise && !existing) {
    await raiseAlert(alertSource, rule, metricValue, objectName);
  } else if (!breached && existing) {
    await resolveAlert(alertSource, existing.id, existing.status === 'acknowledged', rule, metricValue);
  } else if (breached && existing) {
    await maybeRenotify(alertSource, rule, existing, metricValue, objectName);
  }

  for (const [key, alert] of openByObject.entries()) {
    if (key === objectName) continue;
    await resolveAlert(alertSource, alert.id, alert.status === 'acknowledged', rule);
  }
  for (const dup of duplicateOpenAlerts) {
    await resolveAlert(alertSource, dup.id, dup.status === 'acknowledged', rule);
  }
}

async function hasConsecutiveServiceFailures(serviceId: string, requiredFailures: number): Promise<boolean> {
  const rows = await prisma.serviceCheckHistory.findMany({
    where: { serviceId },
    orderBy: { timestamp: 'desc' },
    take: requiredFailures,
    select: { status: true },
  });
  if (rows.length < requiredFailures) return false;
  return rows.every((row) => row.status === 'down');
}

type RenotifyDefaults = { critical: number; high: number; medium: number; low: number };

// Global per-severity re-notify defaults are admin-editable and rarely change, so cache
// them briefly to avoid a DB round-trip on every still-breached rule check.
let renotifyDefaultsCache: { data: RenotifyDefaults; expiresAt: number } | null = null;

async function getRenotifyDefaults(): Promise<RenotifyDefaults> {
  if (renotifyDefaultsCache && renotifyDefaultsCache.expiresAt > Date.now()) return renotifyDefaultsCache.data;
  const row = await prisma.alertRenotifySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  const data: RenotifyDefaults = { critical: row.critical, high: row.high, medium: row.medium, low: row.low };
  renotifyDefaultsCache = { data, expiresAt: Date.now() + 300_000 };
  return data;
}

// Re-sends a notification for an already-active alert once the renotify interval has
// elapsed. The rule's own renotifyMinutes overrides the interval; when it's 0 (unset),
// the global per-severity default applies instead. Skips acknowledged alerts (an
// operator is already handling them).
async function maybeRenotify(
  source: { deviceId: string | null; name: string; ip: string; serviceId?: string | null; siteId?: string | null },
  rule: RuleRow,
  alert: { id: string; status: string; lastNotifiedAt: Date | null; timestamp: Date },
  value: number,
  objectName: string | null,
  objectDescription: string | null = null,
): Promise<void> {
  if (alert.status !== 'active') return;
  const defaults = await getRenotifyDefaults();
  const minutes = rule.renotifyMinutes > 0 ? rule.renotifyMinutes : defaults[rule.severity];
  if (minutes <= 0) return;
  const last = alert.lastNotifiedAt ?? alert.timestamp;
  if (Date.now() < last.getTime() + minutes * 60_000) return;

  const rounded = Math.round(value * 100) / 100;
  const isStatus = STATUS_METRICS.has(rule.metric);
  await prisma.alert.update({ where: { id: alert.id }, data: { lastNotifiedAt: new Date() } });
  await dispatchAlertNotification({
    deviceName: source.name,
    deviceIp: source.ip,
    message: rule.name,
    severity: rule.severity,
    event: 'new',
    timestamp: new Date(),
    ruleName: rule.name,
    siteId: source.siteId ?? null,
    objectName,
    objectDescription,
    currentValue: formatMetricValue(rule.metric, rounded, rule.unit),
    threshold: isStatus ? undefined : `${rule.condition} ${rule.threshold}${rule.unit}`,
    category: alertCategory(rule),
  });
}

async function raiseAlert(
  source: { deviceId: string | null; name: string; ip: string; serviceId?: string | null; siteId?: string | null },
  rule: RuleRow,
  metricValue: number,
  interfaceName: string | null,
  interfaceDescription: string | null = null,
): Promise<void> {
  const rounded = Math.round(metricValue * 100) / 100;
  const portPart = interfaceName ? ` [${interfaceName}]` : '';
  const isStatus = STATUS_METRICS.has(rule.metric);
  const valueLabel = formatMetricValue(rule.metric, rounded, rule.unit);
  const message = isStatus
    ? `${rule.name}${portPart}: ${valueLabel}`
    : `${rule.name}${portPart}: ${rule.metric} ${rule.condition} ${rule.threshold}${rule.unit} (hiện tại: ${rounded}${rule.unit})`;
  const alert = await prisma.alert.create({
    data: {
      deviceId: source.deviceId,
      serviceId: source.serviceId ?? null,
      ruleId: rule.id,
      interfaceName,
      message,
      severity: rule.severity,
      metricValue: valueLabel,
      lastNotifiedAt: new Date(),
    },
  });
  await publishEvent('alert:new', alert);
  await dispatchAlertNotification({
    deviceName: source.name,
    deviceIp: source.ip,
    message: rule.name,
    severity: alert.severity,
    event: 'new',
    timestamp: alert.timestamp,
    ruleName: rule.name,
    siteId: source.siteId ?? null,
    objectName: interfaceName,
    objectDescription: interfaceDescription,
    currentValue: valueLabel,
    threshold: isStatus ? undefined : `${rule.condition} ${rule.threshold}${rule.unit}`,
    category: alertCategory(rule),
  });
}

async function resolveAlert(
  source: { name: string; ip: string; siteId?: string | null },
  alertId: string,
  wasAcknowledged: boolean,
  rule?: Pick<RuleRow, 'name' | 'metric' | 'unit' | 'scope' | 'sensorType'>,
  currentMetricValue?: number,
  objectDescription?: string | null,
): Promise<void> {
  const resolved = await prisma.alert.update({
    where: { id: alertId },
    data: { status: 'resolved', resolvedAt: new Date() },
    include: { rule: { select: { name: true } } },
  });
  await publishEvent('alert:resolved', resolved);
  // Always notify when an alert is resolved, including alerts that were previously
  // acknowledged, so operators get closure confirmation.
  const currentValue =
    currentMetricValue !== undefined && rule
      ? formatMetricValue(rule.metric, Math.round(currentMetricValue * 100) / 100, rule.unit)
      : resolved.metricValue;
  await dispatchAlertNotification({
    deviceName: source.name,
    deviceIp: source.ip,
    message: rule?.name ?? resolved.rule?.name ?? resolved.message,
    severity: resolved.severity,
    event: 'resolved',
    timestamp: resolved.resolvedAt ?? new Date(),
    ruleName: rule?.name ?? resolved.rule?.name ?? null,
    siteId: source.siteId ?? null,
    objectName: resolved.interfaceName,
    objectDescription: objectDescription ?? null,
    currentValue,
    category: rule ? alertCategory(rule) : undefined,
  });
}

function portDescription(port: { ifAlias: string | null; ifDescr: string | null }): string | null {
  const alias = (port.ifAlias ?? '').trim();
  if (alias) return alias;
  const descr = (port.ifDescr ?? '').trim();
  return descr || null;
}

function readServiceMetric(
  metric: string,
  service: { status: string; responseTimeMs: number; uptimePercent: number },
): number | undefined {
  switch (metric) {
    case 'service_status':
      return service.status === 'down' ? 1 : 0;
    case 'service_response_time':
      return service.responseTimeMs;
    case 'service_uptime':
      return service.uptimePercent;
    default:
      return undefined;
  }
}

function readDeviceMetric(
  metric: string,
  device: { cpuUsage: number; memoryUsage: number; temperature: number | null; pingLatencyMs: number | null; packetLoss: number; uptimeSeconds: number; status: string },
): number | undefined {
  switch (metric) {
    case 'cpu':
      return device.cpuUsage;
    case 'memory':
      return device.memoryUsage;
    case 'ping':
      return device.pingLatencyMs ?? undefined;
    case 'temperature':
      return device.temperature ?? undefined;
    case 'packet_loss':
      return device.packetLoss;
    case 'ping_loss_packets':
      return Math.max(0, Math.min(PING_SAMPLE_PACKETS, Math.round((device.packetLoss * PING_SAMPLE_PACKETS) / 100)));
    case 'uptime':
      return device.uptimeSeconds;
    case 'device_status':
      return device.status === 'down' ? 1 : 0;
    default:
      return undefined;
  }
}

// Interface traffic thresholds are expressed in Mbps; utilization in percent;
// status maps down->1/up->0; errors and discards are per-poll deltas.
async function readInterfaceMetric(
  metric: string,
  port: { id: string; ifOperStatus: string; inRateBps: number; outRateBps: number; utilization: number },
): Promise<number | undefined> {
  switch (metric) {
    case 'interface_traffic':
    case 'interface_traffic_in':
      return port.inRateBps / 1_000_000;
    case 'interface_traffic_out':
      return port.outRateBps / 1_000_000;
    case 'interface_utilization':
      return port.utilization;
    case 'interface_status':
      return port.ifOperStatus === 'down' ? 1 : 0;
    case 'interface_errors':
      return portCounterDelta(port.id, 'errors');
    case 'interface_discards':
      return portCounterDelta(port.id, 'discards');
    default:
      return undefined;
  }
}

// Number of errors/discards observed between the two most recent polls; undefined
// until at least two samples exist. Counter resets (e.g. reboot) clamp to 0.
async function portCounterDelta(portId: string, kind: 'errors' | 'discards'): Promise<number | undefined> {
  const rows = await prisma.portMetric.findMany({
    where: { portId },
    orderBy: { timestamp: 'desc' },
    take: 2,
    select: { inErrors: true, outErrors: true, inDiscards: true, outDiscards: true },
  });
  if (rows.length < 2) return undefined;
  const [latest, prev] = rows;
  const latestTotal = kind === 'errors' ? latest.inErrors + latest.outErrors : latest.inDiscards + latest.outDiscards;
  const prevTotal = kind === 'errors' ? prev.inErrors + prev.outErrors : prev.inDiscards + prev.outDiscards;
  const delta = latestTotal - prevTotal;
  return delta > 0n ? Number(delta) : 0;
}

function compare(value: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case '>':
      return value > threshold;
    case '<':
      return value < threshold;
    case '==':
      return value === threshold;
    case '!=':
      return value !== threshold;
    default:
      return false;
  }
}
