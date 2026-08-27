import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, deviceSiteWhere, isGlobalAdmin, mapNodeSiteWhere } from '../middleware/site-scope';

export const topologyRouter = Router();

function requestedSiteId(req: AuthedRequest): string | null | undefined {
  const raw = req.query.siteId;
  if (raw === undefined) return undefined;
  if (raw === '' || raw === 'null') return null;
  if (typeof raw === 'string') return raw;
  return undefined;
}

function ensureSiteFilterAccess(req: AuthedRequest, siteId: string | null | undefined): boolean {
  if (siteId === undefined) return true;
  if (isGlobalAdmin(req)) return true;
  if (siteId === null) return false;
  return canAccessSite(req, siteId);
}

function scopedDeviceWhere(req: AuthedRequest, siteIdFilter: string | null | undefined): Record<string, unknown> {
  const base = (deviceSiteWhere(req) ?? {}) as Record<string, unknown>;
  if (siteIdFilter === undefined) return base;
  return { ...base, siteId: siteIdFilter };
}

function scopedMapNodeWhere(req: AuthedRequest, siteIdFilter: string | null | undefined): Record<string, unknown> {
  const base = (mapNodeSiteWhere(req) ?? {}) as Record<string, unknown>;
  if (siteIdFilter === undefined) return base;
  const siteFilter = {
    OR: [{ siteId: siteIdFilter }, { device: { siteId: siteIdFilter } }],
  };
  if (Object.keys(base).length === 0) return siteFilter;
  return { AND: [base, siteFilter] };
}

// Builds a link-layer topology graph. Nodes are devices; links are derived from
// LLDP/CDP neighbors, matched to known devices by system name or hostname. A
// neighbor pointing at an unmanaged device becomes an "external" node.
topologyRouter.get('/', async (req: AuthedRequest, res) => {
  const siteIdFilter = requestedSiteId(req);
  if (!ensureSiteFilterAccess(req, siteIdFilter)) {
    res.status(403).json({ error: 'Bạn không có quyền xem sơ đồ của trụ sở này' });
    return;
  }

  const deviceWhere = scopedDeviceWhere(req, siteIdFilter);
  const [devices, neighbors] = await Promise.all([
    prisma.device.findMany({
      where: deviceWhere,
      select: { id: true, name: true, hostname: true, ip: true, type: true, status: true },
    }),
    prisma.deviceNeighbor.findMany({ where: { device: deviceWhere } }),
  ]);

  const nodes: { id: string; label: string; ip: string; type: string; status: string; external: boolean }[] =
    devices.map((d) => ({ id: d.id, label: d.name, ip: d.ip, type: d.type, status: d.status, external: false }));

  // Index managed devices by lowercased name / hostname for neighbor matching.
  const byName = new Map<string, string>();
  for (const d of devices) {
    byName.set(d.name.toLowerCase(), d.id);
    byName.set(d.hostname.toLowerCase(), d.id);
  }

  const externalNodes = new Map<string, { id: string; label: string }>();
  const linkSet = new Set<string>();
  const links: { source: string; target: string; sourcePort: string; targetPort?: string; protocol: string }[] = [];

  for (const n of neighbors) {
    const remoteName = (n.remoteSysName ?? '').split('.')[0].toLowerCase();
    let targetId = remoteName ? byName.get(remoteName) : undefined;

    if (!targetId) {
      // Represent unmanaged neighbors as external nodes so the edge is still shown.
      const key = `ext:${n.remoteSysName ?? n.remoteChassisId ?? n.id}`;
      if (!externalNodes.has(key)) {
        externalNodes.set(key, { id: key, label: n.remoteSysName ?? n.remoteChassisId ?? 'unknown' });
      }
      targetId = key;
    }

    // Deduplicate bidirectional links (A-B and B-A collapse to one edge).
    const pair = [n.deviceId, targetId].sort().join('|');
    if (linkSet.has(pair)) continue;
    linkSet.add(pair);
    links.push({
      source: n.deviceId,
      target: targetId,
      sourcePort: n.localPortName,
      targetPort: n.remotePortId ?? undefined,
      protocol: n.protocol,
    });
  }

  for (const ext of externalNodes.values()) {
    nodes.push({ id: ext.id, label: ext.label, ip: '', type: 'external', status: 'up', external: true });
  }

  res.json({ nodes, links });
});

// ---------------------------------------------------------------------------
// Admin-drawn map: manually placed device nodes + manually created links whose
// endpoints reference device interfaces so live in/out traffic can be shown.
// ---------------------------------------------------------------------------

const portSelect = {
  id: true,
  ifName: true,
  ifAlias: true,
  inRateBps: true,
  outRateBps: true,
  utilization: true,
  ifOperStatus: true,
  ifSpeed: true,
} as const;

// Reference-object kinds a node may take when it has no backing device; each gets a
// sensible default icon/label so the frontend doesn't need its own hardcoded table.
const REFERENCE_DEFAULTS: Record<string, { label: string; icon: string }> = {
  cloud: { label: 'Internet', icon: '☁️' },
  site: { label: 'Site khác', icon: '🏢' },
  note: { label: 'Ghi chú', icon: '📝' },
};

topologyRouter.get('/map', async (req: AuthedRequest, res) => {
  const siteIdFilter = requestedSiteId(req);
  if (!ensureSiteFilterAccess(req, siteIdFilter)) {
    res.status(403).json({ error: 'Bạn không có quyền xem sơ đồ của trụ sở này' });
    return;
  }

  const mapNodeWhere = scopedMapNodeWhere(req, siteIdFilter);
  const [mapNodes, mapLinks] = await Promise.all([
    prisma.mapNode.findMany({
      where: mapNodeWhere,
      include: {
        device: { select: { id: true, name: true, ip: true, type: true, status: true } },
      },
    }),
    prisma.mapLink.findMany({
      where: {
        sourceNode: mapNodeWhere,
        targetNode: mapNodeWhere,
      },
    }),
  ]);

  const portIds = Array.from(
    new Set(
      mapLinks.flatMap((l) => [l.sourcePortId, l.targetPortId].filter((p): p is string => Boolean(p))),
    ),
  );
  const ports = portIds.length
    ? await prisma.port.findMany({ where: { id: { in: portIds } }, select: portSelect })
    : [];
  const portById = new Map(ports.map((p) => [p.id, p]));

  const nodes = mapNodes.map((n) => ({
    id: n.id,
    deviceId: n.deviceId,
    kind: n.kind,
    x: n.x,
    y: n.y,
    name: n.device?.name ?? n.label ?? REFERENCE_DEFAULTS[n.kind]?.label ?? n.kind,
    ip: n.device?.ip ?? '',
    type: n.device?.type ?? n.kind,
    status: n.device?.status ?? 'up',
    icon: n.icon ?? (n.kind === 'device' ? null : REFERENCE_DEFAULTS[n.kind]?.icon ?? null),
  }));

  const links = mapLinks.map((l) => {
    const sp = l.sourcePortId ? portById.get(l.sourcePortId) : undefined;
    const tp = l.targetPortId ? portById.get(l.targetPortId) : undefined;
    return {
      id: l.id,
      sourceNodeId: l.sourceNodeId,
      targetNodeId: l.targetNodeId,
      sourcePortId: l.sourcePortId,
      targetPortId: l.targetPortId,
      label: l.label,
      sourcePortName: sp?.ifName ?? null,
      targetPortName: tp?.ifName ?? null,
      // Live traffic comes from the source interface when set, else the target.
      inRateBps: sp?.inRateBps ?? tp?.inRateBps ?? 0,
      outRateBps: sp?.outRateBps ?? tp?.outRateBps ?? 0,
      utilization: sp?.utilization ?? tp?.utilization ?? 0,
      operStatus: sp?.ifOperStatus ?? tp?.ifOperStatus ?? 'up',
    };
  });

  res.json({ nodes, links });
});

// A node is either backed by a real device (kind "device", deviceId required) or a
// reference-only object (kind "cloud"/"site"/"note", no device, custom label/icon).
const nodeSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    kind: z.enum(['device', 'cloud', 'site', 'note']).default('device'),
    siteId: z.string().nullish(),
    label: z.string().min(1).optional(),
    icon: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .refine((v) => v.kind !== 'device' || !!v.deviceId, { message: 'deviceId là bắt buộc khi kind = device' });

topologyRouter.post('/map/nodes', async (req: AuthedRequest, res) => {
  const parsed = nodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { deviceId, kind, siteId, label, icon, x, y } = parsed.data;

  if (kind === 'device' && deviceId) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, ...deviceSiteWhere(req) },
      select: { id: true },
    });
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const node = await prisma.mapNode.upsert({
      where: { deviceId },
      update: { x, y },
      create: { deviceId, x: x ?? 120, y: y ?? 120 },
    });
    res.status(201).json(node);
    return;
  }

  if (!isGlobalAdmin(req) && !canAccessSite(req, siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo node cho trụ sở này' });
    return;
  }

  const node =
    await prisma.mapNode.create({
      data: { kind, siteId: siteId ?? null, label, icon, x: x ?? 120, y: y ?? 120 },
    });
  res.status(201).json(node);
});

topologyRouter.put('/map/nodes/:id', async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ x: z.number().optional(), y: z.number().optional(), label: z.string().min(1).optional(), icon: z.string().optional(), siteId: z.string().nullish() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await prisma.mapNode.findFirst({ where: { id: req.params.id, ...(mapNodeSiteWhere(req) ?? {}) } });
  if (!existing) {
    res.status(404).json({ error: 'Map node not found' });
    return;
  }

  if (!isGlobalAdmin(req) && typeof parsed.data.siteId !== 'undefined' && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển node sang trụ sở này' });
    return;
  }

  const updateData: Record<string, unknown> = {
    x: parsed.data.x,
    y: parsed.data.y,
    label: parsed.data.label,
    icon: parsed.data.icon,
  };
  if (typeof parsed.data.siteId !== 'undefined' && !existing.deviceId) {
    updateData.siteId = parsed.data.siteId ?? null;
  }
  const node = await prisma.mapNode.update({ where: { id: req.params.id }, data: updateData });
  res.json(node);
});

topologyRouter.delete('/map/nodes/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.mapNode.findFirst({ where: { id: req.params.id, ...(mapNodeSiteWhere(req) ?? {}) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Map node not found' });
    return;
  }
  await prisma.mapNode.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

const linkSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sourcePortId: z.string().nullish(),
  targetPortId: z.string().nullish(),
  label: z.string().nullish(),
});

topologyRouter.post('/map/links', async (req: AuthedRequest, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [srcNode, dstNode] = await Promise.all([
    prisma.mapNode.findFirst({ where: { id: parsed.data.sourceNodeId, ...(mapNodeSiteWhere(req) ?? {}) }, select: { id: true, siteId: true } }),
    prisma.mapNode.findFirst({ where: { id: parsed.data.targetNodeId, ...(mapNodeSiteWhere(req) ?? {}) }, select: { id: true, siteId: true } }),
  ]);
  if (!srcNode || !dstNode) {
    res.status(404).json({ error: 'Map node not found' });
    return;
  }

  if (!isGlobalAdmin(req) && srcNode.siteId !== dstNode.siteId) {
    res.status(403).json({ error: 'Không thể nối node khác trụ sở' });
    return;
  }

  // Multiple links between the same pair of objects are intentionally allowed
  // (e.g. two parallel physical cables shown as separate lines).
  const link = await prisma.mapLink.create({ data: parsed.data });
  res.status(201).json(link);
});

topologyRouter.delete('/map/links/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.mapLink.findFirst({ where: { id: req.params.id, sourceNode: mapNodeSiteWhere(req), targetNode: mapNodeSiteWhere(req) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Map link not found' });
    return;
  }
  await prisma.mapLink.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

