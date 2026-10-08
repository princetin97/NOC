import { Router } from 'express';
import { z } from 'zod';
import { AlertStatus } from '@prisma/client';
import { prisma } from '../../lib/db';
import { requireSystemAdmin, type AuthedRequest } from '../middleware/auth';
import { alertRuleScopeWhere, alertScopeWhere, canAccessSite, deviceSiteWhere, isGlobalAdmin, serviceSiteWhere } from '../middleware/site-scope';

export const alertsRouter = Router();

const ALERT_LIST_CACHE_TTL_MS = 3000;
const alertListCache = new Map<string, { expiresAt: number; payload: unknown }>();
const OPEN_ALERT_STATUSES: AlertStatus[] = ['active', 'acknowledged'];

function alertScopeCacheKey(req: AuthedRequest): string {
  const isSystemAdmin = req.user?.isSystemAdmin === true;
  if (isSystemAdmin) return 'global';
  const siteIds = (req.user?.siteIds ?? []).slice().sort().join(',');
  return `sites:${siteIds}`;
}

alertsRouter.get('/', async (req: AuthedRequest, res) => {
  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const requestedSiteIdRaw = req.query.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.length > 0 ? requestedSiteIdRaw : undefined;
  if (requestedSiteId && !canAccessSite(req, requestedSiteId)) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập trụ sở này' });
    return;
  }

  // Default to open alerts only so older clients that omit `status`
  // never fetch historical resolved rows by accident.
  const normalizedStatus = !status || status === 'open' ? 'open' : status;
  const cacheKey = `${alertScopeCacheKey(req)}|status:${normalizedStatus ?? 'all'}|site:${requestedSiteId ?? 'all'}|limit:${limit}`;
  const now = Date.now();
  const cached = alertListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    res.json(cached.payload);
    return;
  }

  const scoped = alertScopeWhere(req);
  // Status is the source of truth for "open" — some rows can carry a stale
  // resolvedAt from a resolve->acknowledge sequence, so don't also require it to be null.
  const statusWhere =
    normalizedStatus === 'open'
      ? {
          status: { in: OPEN_ALERT_STATUSES },
        }
      : normalizedStatus === 'all'
      ? {}
      : normalizedStatus
      ? { status: normalizedStatus as AlertStatus }
      : {};

  const alerts = await prisma.alert.findMany({
    where: {
      ...statusWhere,
      ...(scoped ?? {}),
      ...(requestedSiteId
        ? {
            OR: [{ device: { siteId: requestedSiteId } }, { service: { siteId: requestedSiteId } }],
          }
        : {}),
    },
    orderBy: { timestamp: 'desc' },
    include: {
      device: { select: { name: true, ip: true } },
      service: { select: { name: true, target: true, type: true, port: true } },
      rule: { select: { name: true } },
    },
    take: limit,
  });

  const openAlertKeys = new Set<string>();
  const payload =
    normalizedStatus === 'open'
      ? alerts.filter((alert) => {
          const key = `${alert.ruleId ?? ''}|${alert.deviceId ?? ''}|${alert.serviceId ?? ''}|${alert.interfaceName ?? ''}`;
          if (openAlertKeys.has(key)) return false;
          openAlertKeys.add(key);
          return true;
        })
      : alerts;

  alertListCache.set(cacheKey, { expiresAt: now + ALERT_LIST_CACHE_TTL_MS, payload });
  res.json(payload);
});

// One-time maintenance: resolves duplicate open alerts (same rule+device/service+object,
// keeping the newest) that accumulated before per-object dedup was enforced at write time.
alertsRouter.post('/cleanup-duplicates', requireSystemAdmin, async (_req: AuthedRequest, res) => {
  const openAlerts = await prisma.alert.findMany({
    where: { status: { in: OPEN_ALERT_STATUSES }, resolvedAt: null },
    orderBy: { timestamp: 'desc' },
    select: { id: true, ruleId: true, deviceId: true, serviceId: true, interfaceName: true, status: true },
  });

  const seenKeys = new Set<string>();
  const duplicateIds: string[] = [];
  for (const alert of openAlerts) {
    const key = `${alert.ruleId ?? ''}|${alert.deviceId ?? ''}|${alert.serviceId ?? ''}|${alert.interfaceName ?? ''}`;
    if (seenKeys.has(key)) {
      duplicateIds.push(alert.id);
      continue;
    }
    seenKeys.add(key);
  }

  if (duplicateIds.length === 0) {
    res.json({ resolved: 0 });
    return;
  }

  const result = await prisma.alert.updateMany({
    where: { id: { in: duplicateIds } },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  alertListCache.clear();
  res.json({ resolved: result.count });
});

// One-time maintenance: alerts left with status active/acknowledged but a stale
// resolvedAt (from a resolve->acknowledge sequence) are invisible to the "open"
// list even though the poller still treats them as open. Clears the stale resolvedAt.
alertsRouter.post('/repair-stale-resolved-at', requireSystemAdmin, async (_req: AuthedRequest, res) => {
  const result = await prisma.alert.updateMany({
    where: { status: { in: OPEN_ALERT_STATUSES }, resolvedAt: { not: null } },
    data: { resolvedAt: null },
  });
  alertListCache.clear();
  res.json({ repaired: result.count });
});

alertsRouter.post('/:id/acknowledge', async (req: AuthedRequest, res) => {
  const existing = await prisma.alert.findFirst({ where: { id: req.params.id, ...(alertScopeWhere(req) ?? {}) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }
  const { by } = req.body as { by?: string };
  const alert = await prisma.alert.update({
    where: { id: req.params.id },
    // Clear any stale resolvedAt (e.g. re-acknowledging a previously resolved alert)
    // so the alert is unambiguously open again.
    data: { status: 'acknowledged', acknowledgedBy: by ?? 'unknown', acknowledgedAt: new Date(), resolvedAt: null },
  });
  alertListCache.clear();
  res.json(alert);
});

alertsRouter.post('/:id/resolve', async (req: AuthedRequest, res) => {
  const existing = await prisma.alert.findFirst({ where: { id: req.params.id, ...(alertScopeWhere(req) ?? {}) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }
  const alert = await prisma.alert.update({
    where: { id: req.params.id },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  res.json(alert);
});

// Global per-severity re-notify defaults (minutes). A rule uses its own renotifyMinutes
// when > 0; otherwise it falls back to the value here for its severity.
const renotifySettingsSchema = z.object({
  critical: z.number().int().min(0).max(1440),
  high: z.number().int().min(0).max(1440),
  medium: z.number().int().min(0).max(1440),
  low: z.number().int().min(0).max(1440),
});

alertsRouter.get('/renotify-settings', async (_req, res) => {
  const settings = await prisma.alertRenotifySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  res.json(settings);
});

alertsRouter.put('/renotify-settings', requireSystemAdmin, async (req, res) => {
  const parsed = renotifySettingsSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const settings = await prisma.alertRenotifySettings.upsert({
    where: { id: 'singleton' },
    update: parsed.data,
    create: { id: 'singleton', ...parsed.data },
  });
  res.json(settings);
});

export const alertRulesRouter = Router();

async function ensurePortSecuritySystemRule(): Promise<void> {
  const exists = await prisma.alertRule.findFirst({
    where: { metric: 'port_security_trap', scope: 'interface', siteId: null },
    select: { id: true },
  });
  if (exists) return;

  await prisma.alertRule.create({
    data: {
      name: 'Port Security Violation (SNMP Trap)',
      metric: 'port_security_trap',
      condition: '==',
      threshold: 1,
      unit: '',
      severity: 'high',
      enabled: true,
      description: 'System rule: alert on SNMP trap based port-security violations',
      scope: 'interface',
      siteId: null,
      renotifyMinutes: 0,
      conditions: {
        create: [{ order: 0, condition: '==', threshold: 1, severity: 'high' }],
      },
    },
  });
}

async function ensureFortiHaSystemRule(): Promise<void> {
  const exists = await prisma.alertRule.findFirst({
    where: { metric: 'sensor_value', scope: 'sensor', siteId: null, sensorType: 'ha_member_sync' },
    select: { id: true },
  });
  if (exists) return;

  await prisma.alertRule.create({
    data: {
      name: 'FortiGate HA Member Sync Status',
      metric: 'sensor_value',
      condition: '>',
      threshold: 1,
      unit: '',
      severity: 'critical',
      enabled: true,
      description: 'System rule: alert when any FortiGate HA member is not synchronized',
      scope: 'sensor',
      sensorType: 'ha_member_sync',
      siteId: null,
      renotifyMinutes: 0,
      conditions: {
        create: [{ order: 0, condition: '>', threshold: 1, severity: 'critical' }],
      },
    },
  });
}

const ruleSchema = z.object({
  name: z.string().min(1),
  metric: z.enum([
    'cpu',
    'memory',
    'ping',
    'temperature',
    'packet_loss',
    'ping_loss_packets',
    'uptime',
    'interface_traffic',
    'interface_traffic_in',
    'interface_traffic_out',
    'interface_utilization',
    'interface_status',
    'interface_errors',
    'interface_discards',
    'device_status',
    'bgp_session',
    'sensor_value',
    'service_status',
    'service_response_time',
    'service_uptime',
    'port_security_trap',
  ]),
  condition: z.enum(['>', '<', '==', '!=']),
  threshold: z.number(),
  unit: z.string().default(''),
  severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  scope: z.enum(['device', 'interface', 'sensor', 'service']).default('device'),
  siteId: z.string().nullish(),
  deviceId: z.string().nullish(),
  portId: z.string().nullish(),
  groupId: z.string().nullish(),
  groupIds: z.array(z.string()).optional(),
  serviceId: z.string().nullish(),
  serviceIds: z.array(z.string()).optional(),
  sensorId: z.string().nullish(),
  sensorIds: z.array(z.string()).optional(),
  sensorType: z.string().nullish(),
  osFilter: z.string().nullish(),
  renotifyMinutes: z.number().int().min(0).max(1440).optional(),
  portIds: z.array(z.string()).optional(),
  deviceIds: z.array(z.string()).optional(),
  conditions: z
    .array(
      z.object({
        condition: z.enum(['>', '<', '==', '!=']),
        threshold: z.number(),
        severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
      }),
    )
    .optional(),
});

type RuleConditionInput = {
  condition: '>' | '<' | '==' | '!=';
  threshold: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
};

function normalizeRuleConditions(input: RuleConditionInput[] | undefined, fallback: RuleConditionInput): RuleConditionInput[] {
  const base = input && input.length > 0 ? input : [fallback];
  return base.map((c) => ({ condition: c.condition, threshold: c.threshold, severity: c.severity }));
}

function sameRuleConditions(
  ruleConds: { condition: string; threshold: number; severity: string; order: number }[] | undefined,
  dataConds: RuleConditionInput[] | undefined,
): boolean {
  const a = (ruleConds ?? [])
    .slice()
    .sort((x, y) => x.order - y.order)
    .map((c) => ({ condition: c.condition, threshold: c.threshold, severity: c.severity }));
  const b = (dataConds ?? []).map((c) => ({ condition: c.condition, threshold: c.threshold, severity: c.severity }));
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].condition !== b[i].condition) return false;
    if (a[i].threshold !== b[i].threshold) return false;
    if (a[i].severity !== b[i].severity) return false;
  }
  return true;
}

const copyRuleToSitesSchema = z.object({
  siteIds: z.array(z.string().min(1)).min(1),
  copyTargets: z.boolean().default(false),
  skipIfExists: z.boolean().default(true),
});

const applyRuleSitesSchema = z.object({
  siteIds: z.array(z.string().min(1)).default([]),
  copyTargets: z.boolean().default(false),
});

function sameStringArray(a?: string[] | null, b?: string[] | null): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function isSameRuleSignature(
  rule: {
    name: string;
    metric: string;
    condition: string;
    threshold: number;
    unit: string;
    scope: string;
    deviceId: string | null;
    groupId: string | null;
    groupIds: string[];
    portId: string | null;
    serviceId: string | null;
    sensorId: string | null;
    sensorType: string | null;
    osFilter: string | null;
    deviceIds: string[];
    portIds: string[];
    serviceIds: string[];
    sensorIds: string[];
    conditions?: { condition: string; threshold: number; severity: string; order: number }[];
  },
  data: {
    name: string;
    metric: string;
    condition: string;
    threshold: number;
    unit: string;
    scope: string;
    deviceId: string | null;
    groupId: string | null;
    groupIds: string[];
    portId: string | null;
    serviceId: string | null;
    sensorId: string | null;
    sensorType: string | null;
    osFilter: string | null;
    deviceIds: string[];
    portIds: string[];
    serviceIds: string[];
    sensorIds: string[];
    conditions?: RuleConditionInput[];
  },
): boolean {
  return (
    rule.name === data.name &&
    rule.metric === data.metric &&
    rule.condition === data.condition &&
    rule.threshold === data.threshold &&
    rule.unit === data.unit &&
    rule.scope === data.scope &&
    rule.deviceId === data.deviceId &&
    rule.groupId === data.groupId &&
    rule.portId === data.portId &&
    rule.serviceId === data.serviceId &&
    rule.sensorId === data.sensorId &&
    rule.sensorType === data.sensorType &&
    rule.osFilter === data.osFilter &&
    sameStringArray(rule.deviceIds, data.deviceIds) &&
    sameStringArray(rule.portIds, data.portIds) &&
    sameStringArray(rule.serviceIds, data.serviceIds) &&
    sameStringArray(rule.sensorIds, data.sensorIds) &&
    sameStringArray(rule.groupIds, data.groupIds) &&
    sameRuleConditions(rule.conditions, data.conditions)
  );
}

// Keep the scalar sensorId in sync with sensorIds[0] so the `sensor` include still
// hydrates a representative label and older single-object rules keep working.
// Similarly keep deviceId in sync with deviceIds[0] for the relation, and groupId
// in sync with groupIds[0] for the `group` include.
function withRuleTargets<T extends {
  sensorIds?: string[];
  sensorId?: string | null;
  deviceIds?: string[];
  deviceId?: string | null;
  serviceIds?: string[];
  serviceId?: string | null;
  groupIds?: string[];
  groupId?: string | null;
}>(data: T): T {
  let result = data;
  if (result.sensorIds && result.sensorIds.length > 0) result = { ...result, sensorId: result.sensorIds[0] };
  if (result.deviceIds && result.deviceIds.length > 0) result = { ...result, deviceId: result.deviceIds[0] };
  if (result.serviceIds && result.serviceIds.length > 0) result = { ...result, serviceId: result.serviceIds[0] };
  if (result.groupIds && result.groupIds.length > 0) result = { ...result, groupId: result.groupIds[0] };
  return result;
}

alertRulesRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePortSecuritySystemRule();
  await ensureFortiHaSystemRule();
  const requestedSiteIdRaw = req.query.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.length > 0 ? requestedSiteIdRaw : undefined;
  if (requestedSiteId && !canAccessSite(req, requestedSiteId)) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập trụ sở này' });
    return;
  }

  const scopeWhere = alertRuleScopeWhere(req);
  const rules = await prisma.alertRule.findMany({
    where: {
      ...(scopeWhere ?? {}),
      ...(requestedSiteId
        ? {
            OR: [
              { siteId: requestedSiteId },
              {
                siteId: null,
                NOT: {
                  AND: [
                    { deviceId: { not: null } },
                    { device: { siteId: { not: requestedSiteId } } },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    include: {
      device: { select: { name: true } },
      port: { select: { ifName: true } },
      group: { select: { name: true } },
      service: { select: { name: true, target: true, type: true, port: true } },
      sensor: { select: { description: true, unit: true, type: true } },
      conditions: { orderBy: { order: 'asc' } },
    },
  });

  // groupIds is a plain scalar array (no Prisma relation to eager-load), so resolve
  // display names for the multi-group picker in one batched query across all rules.
  const allGroupIds = [...new Set(rules.flatMap((r) => r.groupIds))];
  const groupNameById = allGroupIds.length > 0
    ? new Map((await prisma.deviceGroup.findMany({ where: { id: { in: allGroupIds } }, select: { id: true, name: true } })).map((g) => [g.id, g.name]))
    : new Map<string, string>();
  const rulesWithGroupNames = rules.map((r) => ({
    ...r,
    groupNames: r.groupIds.map((id) => groupNameById.get(id) ?? id),
  }));
  res.json(rulesWithGroupNames);
});

alertRulesRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!isGlobalAdmin(req) && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo rule cho trụ sở này' });
    return;
  }

  if (parsed.data.deviceId) {
    const device = await prisma.device.findFirst({ where: { id: parsed.data.deviceId, ...deviceSiteWhere(req) }, select: { id: true } });
    if (!device) {
      res.status(400).json({ error: 'Thiết bị mục tiêu không thuộc phạm vi trụ sở của bạn' });
      return;
    }
  }

  if (parsed.data.serviceId) {
    const service = await prisma.serviceCheck.findFirst({ where: { id: parsed.data.serviceId, ...serviceSiteWhere(req) }, select: { id: true } });
    if (!service) {
      res.status(400).json({ error: 'Service mục tiêu không thuộc phạm vi trụ sở của bạn' });
      return;
    }
  }

  const normalizedConditions = normalizeRuleConditions(parsed.data.conditions, {
    condition: parsed.data.condition,
    threshold: parsed.data.threshold,
    severity: parsed.data.severity,
  });
  const primaryCondition = normalizedConditions[0];
  const { conditions: _ignoredConditions, ...parsedWithoutConditions } = parsed.data;
  const createData = withRuleTargets({
    ...parsedWithoutConditions,
    condition: primaryCondition.condition,
    threshold: primaryCondition.threshold,
    severity: primaryCondition.severity,
  });

  const created = await prisma.alertRule.create({
    data: {
      ...createData,
      conditions: {
        create: normalizedConditions.map((c, index) => ({
          order: index,
          condition: c.condition,
          threshold: c.threshold,
          severity: c.severity,
        })),
      },
    },
    include: { conditions: { orderBy: { order: 'asc' } } },
  });

  res.status(201).json(created);
});

alertRulesRouter.post('/:id/copy-sites', async (req: AuthedRequest, res) => {
  if (!isGlobalAdmin(req)) {
    res.status(403).json({ error: 'Chỉ admin hệ thống mới có quyền áp dụng rule sang trụ sở khác' });
    return;
  }

  const source = await prisma.alertRule.findFirst({
    where: { id: req.params.id, ...(alertRuleScopeWhere(req) ?? {}) },
    include: { conditions: { orderBy: { order: 'asc' } } },
  });
  if (!source) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const parsed = copyRuleToSitesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const targetSiteIds = [...new Set(parsed.data.siteIds.filter((id) => !!id))];
  if (targetSiteIds.length === 0) {
    res.status(400).json({ error: 'Danh sách trụ sở đích trống' });
    return;
  }

  if (!isGlobalAdmin(req) && targetSiteIds.some((siteId) => !canAccessSite(req, siteId))) {
    res.status(403).json({ error: 'Bạn không có quyền sao chép rule đến một hoặc nhiều trụ sở đã chọn' });
    return;
  }

  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let deduplicated = 0;
  const sourceConditions = normalizeRuleConditions(
    source.conditions.map((c) => ({ condition: c.condition as RuleConditionInput['condition'], threshold: c.threshold, severity: c.severity as RuleConditionInput['severity'] })),
    { condition: source.condition as RuleConditionInput['condition'], threshold: source.threshold, severity: source.severity as RuleConditionInput['severity'] },
  );
  const primaryCondition = sourceConditions[0];

  for (const siteId of targetSiteIds) {
    const copyData = withRuleTargets({
      name: source.name,
      metric: source.metric,
      condition: primaryCondition.condition,
      threshold: primaryCondition.threshold,
      unit: source.unit,
      severity: primaryCondition.severity,
      enabled: source.enabled,
      description: source.description ?? undefined,
      scope: source.scope,
      siteId,
      renotifyMinutes: source.renotifyMinutes,
      sensorType: source.sensorType,
      osFilter: source.osFilter,
      deviceId: parsed.data.copyTargets ? source.deviceId : null,
      deviceIds: parsed.data.copyTargets ? source.deviceIds : [],
      portId: parsed.data.copyTargets ? source.portId : null,
      portIds: parsed.data.copyTargets ? source.portIds : [],
      groupId: parsed.data.copyTargets ? source.groupId : null,
      groupIds: parsed.data.copyTargets ? source.groupIds : [],
      serviceId: parsed.data.copyTargets ? source.serviceId : null,
      serviceIds: parsed.data.copyTargets ? source.serviceIds : [],
      sensorId: parsed.data.copyTargets ? source.sensorId : null,
      sensorIds: parsed.data.copyTargets ? source.sensorIds : [],
      conditions: sourceConditions,
    });

    if (!parsed.data.copyTargets && source.scope === 'sensor' && !source.sensorType) {
      warnings.push(
        `Rule "${source.name}" là rule sensor theo đối tượng cụ thể. Bản sao ở site ${siteId} sẽ không có sensor target cụ thể.`,
      );
    }

    const sameNameRules = await prisma.alertRule.findMany({
      where: { siteId, name: copyData.name, metric: copyData.metric, scope: copyData.scope },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        metric: true,
        condition: true,
        threshold: true,
        unit: true,
        scope: true,
        deviceId: true,
        groupId: true,
        groupIds: true,
        portId: true,
        serviceId: true,
        sensorId: true,
        sensorType: true,
        osFilter: true,
        deviceIds: true,
        portIds: true,
        serviceIds: true,
        sensorIds: true,
        conditions: { select: { condition: true, threshold: true, severity: true, order: true } },
      },
    });

    const exactMatches = sameNameRules.filter((r) =>
      isSameRuleSignature(r, {
        name: copyData.name,
        metric: copyData.metric,
        condition: copyData.condition,
        threshold: copyData.threshold,
        unit: copyData.unit,
        scope: copyData.scope,
        deviceId: copyData.deviceId ?? null,
        groupId: copyData.groupId ?? null,
        groupIds: copyData.groupIds ?? [],
        portId: copyData.portId ?? null,
        serviceId: copyData.serviceId ?? null,
        sensorId: copyData.sensorId ?? null,
        sensorType: copyData.sensorType ?? null,
        osFilter: copyData.osFilter ?? null,
        deviceIds: copyData.deviceIds ?? [],
        portIds: copyData.portIds ?? [],
        serviceIds: copyData.serviceIds ?? [],
        sensorIds: copyData.sensorIds ?? [],
        conditions: copyData.conditions,
      }),
    );

    if (exactMatches.length > 0) {
      const canonical = exactMatches[0];
      await prisma.alertRule.update({
        where: { id: canonical.id },
        data: {
          condition: primaryCondition.condition,
          threshold: primaryCondition.threshold,
          severity: primaryCondition.severity,
          enabled: copyData.enabled,
          description: copyData.description,
          renotifyMinutes: copyData.renotifyMinutes,
          conditions: {
            deleteMany: {},
            create: sourceConditions.map((c, index) => ({
              order: index,
              condition: c.condition,
              threshold: c.threshold,
              severity: c.severity,
            })),
          },
        },
      });
      updated += 1;

      const duplicateIds = exactMatches.slice(1).map((r) => r.id);
      if (duplicateIds.length > 0) {
        await prisma.alertRule.deleteMany({ where: { id: { in: duplicateIds } } });
        deduplicated += duplicateIds.length;
      }

      if (parsed.data.skipIfExists) skipped += 1;
      continue;
    }

    await prisma.alertRule.create({
      data: {
        ...copyData,
        conditions: {
          create: sourceConditions.map((c, index) => ({
            order: index,
            condition: c.condition,
            threshold: c.threshold,
            severity: c.severity,
          })),
        },
      },
    });
    created += 1;
  }

  res.status(201).json({
    sourceRuleId: source.id,
    sourceSiteId: source.siteId,
    totalTargets: targetSiteIds.length,
    created,
    updated,
    skipped,
    deduplicated,
    targetSiteIds,
    warnings,
  });
});

alertRulesRouter.post('/:id/apply-sites', async (req: AuthedRequest, res) => {
  if (!isGlobalAdmin(req)) {
    res.status(403).json({ error: 'Chỉ admin hệ thống mới có quyền áp dụng rule sang trụ sở khác' });
    return;
  }

  const source = await prisma.alertRule.findFirst({
    where: { id: req.params.id, ...(alertRuleScopeWhere(req) ?? {}) },
    include: { conditions: { orderBy: { order: 'asc' } } },
  });
  if (!source) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const parsed = applyRuleSitesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const targetSiteIds = [...new Set(parsed.data.siteIds.filter((id) => !!id))];
  if (!isGlobalAdmin(req) && targetSiteIds.some((siteId) => !canAccessSite(req, siteId))) {
    res.status(403).json({ error: 'Bạn không có quyền áp dụng rule đến một hoặc nhiều trụ sở đã chọn' });
    return;
  }

  const sourceConditions = normalizeRuleConditions(
    source.conditions.map((c) => ({ condition: c.condition as RuleConditionInput['condition'], threshold: c.threshold, severity: c.severity as RuleConditionInput['severity'] })),
    { condition: source.condition as RuleConditionInput['condition'], threshold: source.threshold, severity: source.severity as RuleConditionInput['severity'] },
  );
  const primaryCondition = sourceConditions[0];

  const buildCopyData = (siteId: string) =>
    withRuleTargets({
      name: source.name,
      metric: source.metric,
      condition: primaryCondition.condition,
      threshold: primaryCondition.threshold,
      unit: source.unit,
      severity: primaryCondition.severity,
      enabled: source.enabled,
      description: source.description ?? undefined,
      scope: source.scope,
      siteId,
      renotifyMinutes: source.renotifyMinutes,
      sensorType: source.sensorType,
      osFilter: source.osFilter,
      deviceId: parsed.data.copyTargets ? source.deviceId : null,
      deviceIds: parsed.data.copyTargets ? source.deviceIds : [],
      portId: parsed.data.copyTargets ? source.portId : null,
      portIds: parsed.data.copyTargets ? source.portIds : [],
      groupId: parsed.data.copyTargets ? source.groupId : null,
      groupIds: parsed.data.copyTargets ? source.groupIds : [],
      serviceId: parsed.data.copyTargets ? source.serviceId : null,
      serviceIds: parsed.data.copyTargets ? source.serviceIds : [],
      sensorId: parsed.data.copyTargets ? source.sensorId : null,
      sensorIds: parsed.data.copyTargets ? source.sensorIds : [],
      conditions: sourceConditions,
    });

  let created = 0;
  let updated = 0;
  let deduplicated = 0;
  let removed = 0;

  for (const siteId of targetSiteIds) {
    const copyData = buildCopyData(siteId);
    const sameNameRules = await prisma.alertRule.findMany({
      where: { siteId, name: copyData.name, metric: copyData.metric, scope: copyData.scope },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        metric: true,
        condition: true,
        threshold: true,
        unit: true,
        scope: true,
        deviceId: true,
        groupId: true,
        groupIds: true,
        portId: true,
        serviceId: true,
        sensorId: true,
        sensorType: true,
        osFilter: true,
        deviceIds: true,
        portIds: true,
        serviceIds: true,
        sensorIds: true,
        conditions: { select: { condition: true, threshold: true, severity: true, order: true } },
      },
    });

    const exactMatches = sameNameRules.filter((r) =>
      isSameRuleSignature(r, {
        name: copyData.name,
        metric: copyData.metric,
        condition: copyData.condition,
        threshold: copyData.threshold,
        unit: copyData.unit,
        scope: copyData.scope,
        deviceId: copyData.deviceId ?? null,
        groupId: copyData.groupId ?? null,
        groupIds: copyData.groupIds ?? [],
        portId: copyData.portId ?? null,
        serviceId: copyData.serviceId ?? null,
        sensorId: copyData.sensorId ?? null,
        sensorType: copyData.sensorType ?? null,
        osFilter: copyData.osFilter ?? null,
        deviceIds: copyData.deviceIds ?? [],
        portIds: copyData.portIds ?? [],
        serviceIds: copyData.serviceIds ?? [],
        sensorIds: copyData.sensorIds ?? [],
        conditions: copyData.conditions,
      }),
    );

    if (exactMatches.length > 0) {
      const canonical = exactMatches[0];
      await prisma.alertRule.update({
        where: { id: canonical.id },
        data: {
          condition: copyData.conditions?.[0]?.condition ?? copyData.condition,
          threshold: copyData.conditions?.[0]?.threshold ?? copyData.threshold,
          severity: copyData.conditions?.[0]?.severity ?? copyData.severity,
          enabled: copyData.enabled,
          description: copyData.description,
          renotifyMinutes: copyData.renotifyMinutes,
          conditions: {
            deleteMany: {},
            create: (copyData.conditions ?? []).map((c, index) => ({
              order: index,
              condition: c.condition,
              threshold: c.threshold,
              severity: c.severity,
            })),
          },
        },
      });
      updated += 1;

      const duplicateIds = exactMatches.slice(1).map((r) => r.id);
      if (duplicateIds.length > 0) {
        await prisma.alertRule.deleteMany({ where: { id: { in: duplicateIds } } });
        deduplicated += duplicateIds.length;
      }
      continue;
    }

    await prisma.alertRule.create({
      data: {
        ...copyData,
        conditions: {
          create: (copyData.conditions ?? []).map((c, index) => ({
            order: index,
            condition: c.condition,
            threshold: c.threshold,
            severity: c.severity,
          })),
        },
      },
    });
    created += 1;
  }

  // Remove unselected site applications of the same template signature.
  const candidates = await prisma.alertRule.findMany({
    where: {
      siteId: { not: null },
      name: source.name,
      metric: source.metric,
      scope: source.scope,
    },
    select: {
      id: true,
      siteId: true,
      name: true,
      metric: true,
      condition: true,
      threshold: true,
      unit: true,
      scope: true,
      deviceId: true,
      groupId: true,
      groupIds: true,
      portId: true,
      serviceId: true,
      sensorId: true,
      sensorType: true,
      osFilter: true,
      deviceIds: true,
      portIds: true,
      serviceIds: true,
      sensorIds: true,
      conditions: { select: { condition: true, threshold: true, severity: true, order: true } },
    },
  });

  for (const candidate of candidates) {
    if (!candidate.siteId) continue;
    if (targetSiteIds.includes(candidate.siteId)) continue;
    const expected = buildCopyData(candidate.siteId);
    if (
      isSameRuleSignature(candidate, {
        name: expected.name,
        metric: expected.metric,
        condition: expected.condition,
        threshold: expected.threshold,
        unit: expected.unit,
        scope: expected.scope,
        deviceId: expected.deviceId ?? null,
        groupId: expected.groupId ?? null,
        groupIds: expected.groupIds ?? [],
        portId: expected.portId ?? null,
        serviceId: expected.serviceId ?? null,
        sensorId: expected.sensorId ?? null,
        sensorType: expected.sensorType ?? null,
        osFilter: expected.osFilter ?? null,
        deviceIds: expected.deviceIds ?? [],
        portIds: expected.portIds ?? [],
        serviceIds: expected.serviceIds ?? [],
        sensorIds: expected.sensorIds ?? [],
        conditions: expected.conditions,
      })
    ) {
      await prisma.alertRule.delete({ where: { id: candidate.id } });
      removed += 1;
    }
  }

  res.status(200).json({
    sourceRuleId: source.id,
    appliedSiteIds: targetSiteIds,
    created,
    updated,
    deduplicated,
    removed,
  });
});

alertRulesRouter.put('/:id', async (req: AuthedRequest, res) => {
  const existingForScope = await prisma.alertRule.findFirst({ where: { id: req.params.id, ...(alertRuleScopeWhere(req) ?? {}) } });
  if (!existingForScope) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!isGlobalAdmin(req) && typeof parsed.data.siteId !== 'undefined' && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển rule sang trụ sở này' });
    return;
  }
  const incomingConditions =
    typeof parsed.data.conditions !== 'undefined'
      ? normalizeRuleConditions(parsed.data.conditions, {
          condition: (parsed.data.condition ?? existingForScope.condition) as RuleConditionInput['condition'],
          threshold: parsed.data.threshold ?? existingForScope.threshold,
          severity: (parsed.data.severity ?? existingForScope.severity) as RuleConditionInput['severity'],
        })
      : undefined;
  const primaryCondition = incomingConditions?.[0];
  const shouldSyncSeverity = typeof parsed.data.severity !== 'undefined' && !incomingConditions;

  const { conditions: _ignoredConditions, ...parsedWithoutConditions } = parsed.data;
  const updateData = withRuleTargets({
    ...parsedWithoutConditions,
    ...(primaryCondition
      ? {
          condition: primaryCondition.condition,
          threshold: primaryCondition.threshold,
          severity: primaryCondition.severity,
        }
      : {}),
  });

  const rule = await prisma.alertRule.update({
    where: { id: req.params.id },
    data: {
      ...(updateData as any),
      ...(incomingConditions
        ? {
            conditions: {
              deleteMany: {},
              create: incomingConditions.map((c, index) => ({
                order: index,
                condition: c.condition,
                threshold: c.threshold,
                severity: c.severity,
              })),
            },
          }
        : {}),
    },
    include: { conditions: { orderBy: { order: 'asc' } } },
  });
  if (shouldSyncSeverity) {
    // Keep open alerts aligned with the latest rule severity after edits.
    if (rule.metric === 'port_security_trap') {
      await prisma.alertRule.updateMany({
        where: { metric: 'port_security_trap', scope: 'interface', siteId: rule.siteId },
        data: { severity: rule.severity },
      });

      const portSecurityRuleIds = (
        await prisma.alertRule.findMany({
          where: { metric: 'port_security_trap', scope: 'interface', siteId: rule.siteId },
          select: { id: true },
        })
      ).map((r) => r.id);

      await prisma.alert.updateMany({
        where: {
          status: { in: ['active', 'acknowledged'] },
          ...(rule.siteId ? { device: { siteId: rule.siteId } } : {}),
          OR: [
            { interfaceName: { startsWith: 'PORT-SECURITY:' } },
            { ruleId: { in: portSecurityRuleIds } },
            { ruleId: null, interfaceName: { startsWith: 'PORT-SECURITY:' } },
          ],
        },
        data: { severity: rule.severity, ruleId: rule.id },
      });
    } else {
      await prisma.alert.updateMany({
        where: { ruleId: rule.id, status: { in: ['active', 'acknowledged'] } },
        data: { severity: rule.severity },
      });
    }
  }
  // Disabling a rule clears its open alerts; monitoring for it has stopped so they
  // should not linger in the active/acknowledged lists.
  if (parsed.data.enabled === false) {
    await prisma.alert.updateMany({
      where: { ruleId: rule.id, status: { in: ['active', 'acknowledged'] } },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }
  res.json(rule);
});

alertRulesRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.alertRule.findFirst({ where: { id: req.params.id, ...(alertRuleScopeWhere(req) ?? {}) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  // Resolve the rule's open alerts first so they don't linger without a parent rule.
  await prisma.alert.updateMany({
    where: { ruleId: req.params.id, status: { in: ['active', 'acknowledged'] } },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  await prisma.alertRule.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
