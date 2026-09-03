import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { logger } from '../../lib/logger';
import { discoveryQueue, pollQueue } from '../../lib/queue';
import { scanSubnet } from '../../lib/subnet-scan';
import { snmpGetSingle, snmpWalkColumn, varbindToNumber, varbindToString, withSession } from '../../lib/snmp';
import { toCredentials } from '../../poller/metrics';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, deviceSiteWhere, isGlobalAdmin } from '../middleware/site-scope';

export const devicesRouter = Router();

const DEVICE_LIST_CACHE_TTL_MS = 3000;
const deviceListCache = new Map<string, { expiresAt: number; payload: unknown }>();

function invalidateDeviceListCache() {
  deviceListCache.clear();
}

function scopeCacheKey(req: AuthedRequest): string {
  const isSystemAdmin = req.user?.isSystemAdmin === true;
  if (isSystemAdmin) return 'global';
  const siteIds = (req.user?.siteIds ?? []).slice().sort().join(',');
  return `sites:${siteIds}`;
}

const createDeviceSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1),
  ip: z.string().min(1),
  type: z.string().default('server'),
  location: z.string().optional(),
  rack: z.string().optional(),
  groupId: z.string().nullish(),
  siteId: z.string().nullish(),
  snmpVersion: z.enum(['v1', 'v2c', 'v3']).default('v2c'),
  snmpCommunity: z.string().optional(),
  snmpPort: z.number().int().default(161),
  snmpV3User: z.string().optional(),
  snmpV3AuthProto: z.string().optional(),
  snmpV3AuthPass: z.string().optional(),
  snmpV3PrivProto: z.string().optional(),
  snmpV3PrivPass: z.string().optional(),
  pingOnly: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const bulkDeleteDevicesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
});

async function findScopedDevice(req: AuthedRequest, id: string) {
  return prisma.device.findFirst({ where: { id, ...deviceSiteWhere(req) } });
}

async function ensureGroupMatchesSite(groupId: string | null | undefined, siteId: string | null | undefined): Promise<void> {
  if (!groupId) return;
  const group = await prisma.deviceGroup.findUnique({ where: { id: groupId }, select: { id: true, siteId: true } });
  if (!group) throw new Error('Nhóm thiết bị không tồn tại');
  if ((group.siteId ?? null) !== (siteId ?? null)) {
    throw new Error('Nhóm thiết bị phải cùng trụ sở với thiết bị');
  }
}

devicesRouter.get('/', async (req: AuthedRequest, res) => {
  const full = req.query.include === 'full';
  const requestedSiteIdRaw = req.query.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.length > 0 ? requestedSiteIdRaw : undefined;
  if (requestedSiteId && !canAccessSite(req, requestedSiteId)) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập trụ sở này' });
    return;
  }

  const cacheKey = `${scopeCacheKey(req)}|full:${full ? '1' : '0'}|site:${requestedSiteId ?? 'all'}`;
  const now = Date.now();
  const cached = deviceListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    res.json(cached.payload);
    return;
  }

  const devices = await prisma.device.findMany({
    where: {
      ...(deviceSiteWhere(req) ?? {}),
      ...(requestedSiteId ? { siteId: requestedSiteId } : {}),
    },
    orderBy: { name: 'asc' },
    include: full
      ? {
          ports: true,
          vlans: {
            orderBy: { vlanId: 'asc' },
            include: { ports: { include: { port: { select: { id: true, ifName: true } } } } },
          },
        }
      : undefined,
  });
  deviceListCache.set(cacheKey, { expiresAt: now + DEVICE_LIST_CACHE_TTL_MS, payload: devices });
  res.json(devices);
});

devicesRouter.get('/:id', async (req: AuthedRequest, res) => {
  const device = await prisma.device.findFirst({
    where: { id: req.params.id, ...deviceSiteWhere(req) },
    include: {
      ports: true,
      sensors: { orderBy: [{ type: 'asc' }, { index: 'asc' }] },
      vlans: {
        orderBy: { vlanId: 'asc' },
        include: { ports: { include: { port: { select: { id: true, ifName: true } } } } },
      },
    },
  });
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  res.json(device);
});

devicesRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = createDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { pingOnly, ...deviceData } = parsed.data;
  if (!isGlobalAdmin(req) && !canAccessSite(req, deviceData.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo thiết bị cho trụ sở này' });
    return;
  }

  try {
    await ensureGroupMatchesSite(deviceData.groupId, deviceData.siteId ?? null);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Dữ liệu nhóm/trụ sở không hợp lệ' });
    return;
  }

  const device = await prisma.device.create({
    data: {
      ...deviceData,
      ...(pingOnly ? { snmpPort: 0, snmpCommunity: null } : {}),
    },
  });

  // Kick off an immediate discovery + poll cycle for the new device.
  if (!pingOnly) await discoveryQueue.add('discover', { deviceId: device.id });
  await pollQueue.add('poll', { deviceId: device.id });

  invalidateDeviceListCache();

  res.status(201).json(device);
});

devicesRouter.post('/bulk-delete', async (req: AuthedRequest, res) => {
  const parsed = bulkDeleteDevicesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const inputIds = Array.from(new Set(parsed.data.ids));
  if (inputIds.length === 0) {
    res.json({ deleted: 0, deletedIds: [], skippedIds: [] });
    return;
  }

  const scoped = await prisma.device.findMany({
    where: { id: { in: inputIds }, ...deviceSiteWhere(req) },
    select: { id: true },
  });
  const scopedIds = scoped.map((d) => d.id);
  const scopedSet = new Set(scopedIds);
  const skippedIds = inputIds.filter((id) => !scopedSet.has(id));

  if (scopedIds.length === 0) {
    res.json({ deleted: 0, deletedIds: [], skippedIds });
    return;
  }

  await prisma.device.deleteMany({ where: { id: { in: scopedIds } } });
  invalidateDeviceListCache();
  res.json({ deleted: scopedIds.length, deletedIds: scopedIds, skippedIds });
});

devicesRouter.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = createDeviceSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const { pingOnly: _pingOnly, ...patch } = parsed.data;
  if (!isGlobalAdmin(req) && typeof patch.siteId !== 'undefined' && !canAccessSite(req, patch.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển thiết bị sang trụ sở này' });
    return;
  }

  const nextSiteId = typeof patch.siteId !== 'undefined' ? patch.siteId ?? null : existing.siteId ?? null;
  const nextGroupId = typeof patch.groupId !== 'undefined' ? patch.groupId ?? null : existing.groupId ?? null;
  try {
    await ensureGroupMatchesSite(nextGroupId, nextSiteId);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Dữ liệu nhóm/trụ sở không hợp lệ' });
    return;
  }

  const device = await prisma.device.update({ where: { id: req.params.id }, data: patch });
  invalidateDeviceListCache();
  res.json(device);
});

devicesRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  await prisma.device.delete({ where: { id: req.params.id } });
  invalidateDeviceListCache();
  res.status(204).send();
});

devicesRouter.post('/:id/poll-now', async (req: AuthedRequest, res) => {
  // Re-run discovery (interfaces, sysDescr, vendor MIBs) then poll, so a manual
  // "SNMP scan" picks up newly exposed interfaces/metrics, not just fresh counters.
  const dev = await prisma.device.findFirst({ where: { id: req.params.id, ...deviceSiteWhere(req) }, select: { snmpPort: true } });
  if (!dev) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  if (dev?.snmpPort && dev.snmpPort > 0) await discoveryQueue.add('discover', { deviceId: req.params.id });
  await pollQueue.add('poll', { deviceId: req.params.id });
  res.json({ queued: true });
});

devicesRouter.get('/:id/metrics', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const limit = Number(req.query.limit ?? 500);
  // Optional time window in hours (e.g. ?hours=24). Defaults to the most recent `limit` rows.
  const hours = req.query.hours ? Number(req.query.hours) : undefined;
  const where = {
    deviceId: req.params.id,
    ...(hours ? { timestamp: { gte: new Date(Date.now() - hours * 3600_000) } } : {}),
  };
  const metrics = await prisma.deviceMetric.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(hours ? 2000 : limit, 2000),
  });
  res.json(metrics.reverse());
});

devicesRouter.get('/:id/processors', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const processors = await prisma.processor.findMany({
    where: { deviceId: req.params.id },
    orderBy: [{ description: 'asc' }, { index: 'asc' }],
  });
  res.json(processors);
});

devicesRouter.get('/:id/processors/metrics', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const hours = req.query.hours ? Number(req.query.hours) : 24;
  const since = new Date(Date.now() - hours * 3600_000);
  const processors = await prisma.processor.findMany({
    where: { deviceId: req.params.id },
    orderBy: [{ description: 'asc' }, { index: 'asc' }],
    select: {
      id: true,
      index: true,
      description: true,
      usage: true,
      metrics: {
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, usage: true },
      },
    },
  });
  res.json(processors);
});

// Historical trend for sensors of a given category (e.g. type=load -> UPS output load %).
devicesRouter.get('/:id/sensors/metrics', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const type = req.query.type ? String(req.query.type) : undefined;
  const hours = req.query.hours ? Number(req.query.hours) : 24;
  const since = new Date(Date.now() - hours * 3600_000);
  const sensors = await prisma.sensor.findMany({
    where: { deviceId: req.params.id, ...(type ? { type } : {}) },
    orderBy: [{ description: 'asc' }, { index: 'asc' }],
    select: {
      id: true,
      type: true,
      index: true,
      description: true,
      value: true,
      unit: true,
      metrics: {
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, value: true },
      },
    },
  });
  res.json(sensors);
});

devicesRouter.get('/:id/neighbors', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const neighbors = await prisma.deviceNeighbor.findMany({
    where: { deviceId: req.params.id },
    orderBy: { localPortName: 'asc' },
  });
  res.json(neighbors);
});

// Per-device alert history tab: last 30 days only (older rows are pruned by cleanup.ts
// anyway once resolved, but this also bounds still-open long-running alerts).
const ALERT_HISTORY_DAYS = 30;
devicesRouter.get('/:id/alerts', async (req: AuthedRequest, res) => {
  const existing = await findScopedDevice(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const since = new Date(Date.now() - ALERT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const alerts = await prisma.alert.findMany({
    where: { deviceId: req.params.id, timestamp: { gte: since } },
    orderBy: { timestamp: 'desc' },
    include: { rule: { select: { name: true } } },
    take: 500,
  });
  res.json(alerts);
});

// Read-only raw SNMP walk of a single OID column, used to diagnose which MIBs a
// device actually implements (e.g. confirming ENTITY-SENSOR-MIB/CISCO-ENVMON-MIB
// support) without needing shell/snmpwalk access to the box.
devicesRouter.get('/:id/snmp-debug', async (req: AuthedRequest, res) => {
  const oid = String(req.query.oid ?? '');
  if (!/^[0-9]+(\.[0-9]+)+$/.test(oid)) {
    res.status(400).json({ error: 'oid must be numeric dotted notation, e.g. 1.3.6.1.2.1.99.1.1.1.4' });
    return;
  }
  const device = await prisma.device.findFirst({ where: { id: req.params.id, ...deviceSiteWhere(req) } });
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  try {
    const rows = await withSession(toCredentials(device), (session) => snmpWalkColumn(session, oid));
    res.json(
      Array.from(rows.entries()).map(([suffix, vb]) => ({
        oid: `${oid}.${suffix}`,
        value: varbindToString(vb) ?? varbindToNumber(vb) ?? null,
      })),
    );
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Quick scalar diagnostics for common and vendor-specific OIDs, so operators can
// verify SNMP credentials/connectivity without SSHing into the poller host.
devicesRouter.get('/:id/snmp-diagnostics', async (req: AuthedRequest, res) => {
  const device = await prisma.device.findFirst({ where: { id: req.params.id, ...deviceSiteWhere(req) } });
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  if (!device.snmpPort || device.snmpPort <= 0) {
    res.status(400).json({
      error: 'SNMP is disabled on this device (snmpPort <= 0).',
      hint: 'Edit device and set SNMP port/community (or SNMPv3 credentials), then run poll-now again.',
    });
    return;
  }

  const oids: Array<{ key: string; oid: string }> = [
    { key: 'sysDescr', oid: '1.3.6.1.2.1.1.1.0' },
    { key: 'sysObjectID', oid: '1.3.6.1.2.1.1.2.0' },
    { key: 'sysName', oid: '1.3.6.1.2.1.1.5.0' },
    { key: 'pureProductName', oid: '1.3.6.1.4.1.40482.3.1.0' },
    { key: 'pureProductVersion', oid: '1.3.6.1.4.1.40482.3.2.0' },
    { key: 'pureHost', oid: '1.3.6.1.4.1.40482.3.3.0' },
    { key: 'pureArrayReadBandwidth', oid: '1.3.6.1.4.1.40482.4.1.0' },
    { key: 'pureArrayWriteBandwidth', oid: '1.3.6.1.4.1.40482.4.2.0' },
    { key: 'pureArrayReadIOPS', oid: '1.3.6.1.4.1.40482.4.3.0' },
    { key: 'pureArrayWriteIOPS', oid: '1.3.6.1.4.1.40482.4.4.0' },
    { key: 'pureArrayReadLatency', oid: '1.3.6.1.4.1.40482.4.5.0' },
    { key: 'pureArrayWriteLatency', oid: '1.3.6.1.4.1.40482.4.6.0' },
  ];

  try {
    const rows = await withSession(toCredentials(device), async (session) => {
      const out: Array<{ key: string; oid: string; ok: boolean; value: string | number | null }> = [];
      for (const row of oids) {
        try {
          const vb = await snmpGetSingle(session, row.oid);
          out.push({
            key: row.key,
            oid: row.oid,
            ok: true,
            value: varbindToString(vb) ?? varbindToNumber(vb) ?? null,
          });
        } catch {
          out.push({ key: row.key, oid: row.oid, ok: false, value: null });
        }
      }
      return out;
    });

    const hasSystem = rows.some((r) => (r.key === 'sysDescr' || r.key === 'sysObjectID' || r.key === 'sysName') && r.ok);
    const hasPure = rows.some((r) => r.key.startsWith('pure') && r.ok);

    res.json({
      device: {
        id: device.id,
        name: device.name,
        ip: device.ip,
        snmpVersion: device.snmpVersion,
        snmpPort: device.snmpPort,
      },
      summary: {
        hasSystemMib: hasSystem,
        hasPureMib: hasPure,
        hint: !hasSystem
          ? 'Cannot read base system OIDs: check SNMP credentials, ACL, UDP/161 routing, or version mismatch.'
          : !hasPure
          ? 'System OIDs are readable but PURESTORAGE-MIB OIDs are not: enable vendor MIB/permissions on array SNMP settings.'
          : 'SNMP connectivity and PURESTORAGE-MIB OIDs are readable.',
      },
      rows,
    });
  } catch (err) {
    res.status(502).json({
      error: (err as Error).message,
      hint: 'SNMP session failed completely. Verify community/v3 credentials, source ACL, and UDP/161 reachability.',
    });
  }
});

const scanSchema = z.object({
  subnet: z.string().min(1),
  snmpVersion: z.enum(['v1', 'v2c', 'v3']).default('v2c'),
  snmpCommunity: z.string().optional(),
  snmpPort: z.number().int().optional(),
});

type ScanJobStatus = 'running' | 'completed' | 'failed';

interface ScanSubnetJob {
  id: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  status: ScanJobStatus;
  results?: Array<ReturnType<typeof withAlreadyAddedFlag>[number]>;
  error?: string;
}

const SCAN_SUBNET_JOB_TTL_MS = 10 * 60_000;
const scanJobs = new Map<string, ScanSubnetJob>();

function cleanupExpiredScanJobs() {
  const now = Date.now();
  for (const [id, job] of scanJobs) {
    if (now - job.updatedAt > SCAN_SUBNET_JOB_TTL_MS) {
      scanJobs.delete(id);
    }
  }
}

function scanOwnerId(req: AuthedRequest): string {
  return String(req.user?.sub ?? req.user?.username ?? 'unknown');
}

function withAlreadyAddedFlag(
  results: Awaited<ReturnType<typeof scanSubnet>>,
  existingIps: Set<string>,
) {
  return results.map((r) => ({ ...r, alreadyAdded: existingIps.has(r.ip) }));
}

// Probe an IPv4 CIDR with SNMP and return responding hosts, flagged if already managed.
devicesRouter.post('/scan-subnet', async (req: AuthedRequest, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Dữ liệu quét không hợp lệ. Vui lòng kiểm tra subnet/SNMP.' });
    return;
  }
  try {
    const results = await scanSubnet(parsed.data.subnet, {
      version: parsed.data.snmpVersion,
      community: parsed.data.snmpCommunity,
      port: parsed.data.snmpPort,
    });
    const existing = await prisma.device.findMany({ where: deviceSiteWhere(req), select: { ip: true } });
    const existingIps = new Set(existing.map((d) => d.ip));
    res.json(withAlreadyAddedFlag(results, existingIps));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi không xác định khi quét subnet';
    logger.warn({ err, subnet: parsed.data.subnet, user: req.user?.username ?? req.user?.sub }, 'Subnet scan failed');
    // Input/domain errors stay 400, runtime/proxy/network problems surface as 502.
    const inputError = /invalid|prefix|dải mạng quá lớn|IPv4/i.test(message);
    res.status(inputError ? 400 : 502).json({ error: message });
  }
});

// Starts an async subnet scan job and returns immediately with a jobId.
devicesRouter.post('/scan-subnet/start', async (req: AuthedRequest, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Dữ liệu quét không hợp lệ. Vui lòng kiểm tra subnet/SNMP.' });
    return;
  }

  cleanupExpiredScanJobs();

  const jobId = randomUUID();
  const ownerId = scanOwnerId(req);
  const scopeWhere = deviceSiteWhere(req);
  const now = Date.now();
  scanJobs.set(jobId, {
    id: jobId,
    ownerId,
    createdAt: now,
    updatedAt: now,
    status: 'running',
  });

  void (async () => {
    try {
      const results = await scanSubnet(parsed.data.subnet, {
        version: parsed.data.snmpVersion,
        community: parsed.data.snmpCommunity,
        port: parsed.data.snmpPort,
      });
      const existing = await prisma.device.findMany({ where: scopeWhere, select: { ip: true } });
      const existingIps = new Set(existing.map((d) => d.ip));
      const job = scanJobs.get(jobId);
      if (!job) return;
      job.status = 'completed';
      job.results = withAlreadyAddedFlag(results, existingIps);
      job.updatedAt = Date.now();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi quét subnet';
      const job = scanJobs.get(jobId);
      if (!job) return;
      job.status = 'failed';
      job.error = message;
      job.updatedAt = Date.now();
      logger.warn({ err, subnet: parsed.data.subnet, ownerId, jobId }, 'Async subnet scan job failed');
    }
  })();

  res.status(202).json({ jobId, status: 'running' });
});

// Poll async subnet scan job status/results.
devicesRouter.get('/scan-subnet/jobs/:jobId', async (req: AuthedRequest, res) => {
  cleanupExpiredScanJobs();

  const job = scanJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Không tìm thấy job quét subnet hoặc job đã hết hạn.' });
    return;
  }
  if (job.ownerId !== scanOwnerId(req)) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập job quét subnet này.' });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    results: job.status === 'completed' ? job.results ?? [] : undefined,
    error: job.status === 'failed' ? job.error ?? 'Subnet scan failed' : undefined,
  });
});

const bulkDeviceSchema = z.object({
  devices: z
    .array(
      z.object({
        name: z.string().min(1),
        ip: z.string().min(1),
        type: z.string().default('server'),
        siteId: z.string().nullish(),
        groupId: z.string().nullish(),
        snmpVersion: z.enum(['v1', 'v2c', 'v3']).default('v2c'),
        snmpCommunity: z.string().optional(),
        snmpPort: z.number().int().optional(),
        pingOnly: z.boolean().optional(),
      }),
    )
    .min(1),
});

// Create several devices at once (used by the subnet-scan "add selected" flow).
devicesRouter.post('/bulk', async (req: AuthedRequest, res) => {
  const parsed = bulkDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const created: { id: string; ip: string }[] = [];
  const skipped: { ip: string; reason: string }[] = [];
  for (const d of parsed.data.devices) {
    const hostname = (d.name || d.ip).toLowerCase().replace(/\s+/g, '-');
    const fallbackScopedSiteId =
      !isGlobalAdmin(req) && (req.user?.siteIds?.length ?? 0) === 1 ? (req.user?.siteIds[0] ?? null) : null;
    const targetSiteId = d.siteId ?? fallbackScopedSiteId;
    const targetGroupId = d.groupId ?? null;
    try {
      if (!isGlobalAdmin(req) && !canAccessSite(req, targetSiteId)) {
        skipped.push({ ip: d.ip, reason: 'No permission for selected site' });
        continue;
      }
      await ensureGroupMatchesSite(targetGroupId, targetSiteId);
      const device = await prisma.device.create({
        data: {
          name: d.name,
          hostname,
          ip: d.ip,
          type: d.type,
          siteId: targetSiteId,
          groupId: targetGroupId,
          snmpVersion: d.snmpVersion,
          snmpCommunity: d.pingOnly ? null : d.snmpCommunity,
          ...(d.pingOnly ? { snmpPort: 0 } : d.snmpPort ? { snmpPort: d.snmpPort } : {}),
        },
      });
      if (!d.pingOnly) await discoveryQueue.add('discover', { deviceId: device.id });
      await pollQueue.add('poll', { deviceId: device.id });
      created.push({ id: device.id, ip: device.ip });
    } catch (err) {
      skipped.push({ ip: d.ip, reason: (err as Error).message });
    }
  }
  if (created.length > 0) invalidateDeviceListCache();
  res.status(201).json({ created, skipped });
});

