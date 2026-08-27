import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import * as vsphere from '../lib/vsphere';

const VCENTER_DEVICE_GROUP_NAME = 'vCenter Device';

function pctOf(numerator?: number, denominator?: number): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function isIpLike(value?: string): boolean {
  return !!value && /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

// One shared "vCenter Device" group per site (or the global scope when the manager
// isn't tied to a site) so synced ESXi hosts show up next to other equipment.
// DeviceGroup's @@unique([siteId, name]) doesn't dedupe NULL siteId rows in
// Postgres, so this looks up by findFirst instead of relying on upsert.
async function resolveDeviceGroupId(siteId: string | null): Promise<string> {
  const existing = await prisma.deviceGroup.findFirst({ where: { name: VCENTER_DEVICE_GROUP_NAME, siteId } });
  if (existing) return existing.id;
  const created = await prisma.deviceGroup.create({
    data: {
      name: VCENTER_DEVICE_GROUP_NAME,
      siteId,
      description: 'ESXi host được đồng bộ tự động từ vCenter',
      color: '#a855f7',
    },
  });
  return created.id;
}

// Device.hostname is globally unique; append a numeric suffix on collision with an
// unrelated device (currentDeviceId excludes the host's own already-linked device).
async function resolveHostname(candidate: string, currentDeviceId: string | null): Promise<string> {
  let hostname = candidate;
  for (let suffix = 2; ; suffix++) {
    const conflict = await prisma.device.findUnique({ where: { hostname }, select: { id: true } });
    if (!conflict || conflict.id === currentDeviceId) return hostname;
    hostname = `${candidate}-${suffix}`;
  }
}

function deviceStatusFor(h: vsphere.VSphereHostInfo, alertState: 'ok' | 'warning' | 'critical'): 'up' | 'down' | 'warning' | 'maintenance' {
  if (h.inMaintenanceMode) return 'maintenance';
  if (alertState === 'critical') return 'down';
  if (alertState === 'warning') return 'warning';
  return 'up';
}

function buildInventorySummary(h: vsphere.VSphereHostInfo, datastoreSummary?: string): string {
  const tokens: string[] = [];
  const push = (key: string, value?: string | number | boolean) => {
    if (value === undefined || value === null || value === '') return;
    tokens.push(`${key}=${value}`);
  };
  push('esxi', h.productName ?? 'VMware ESXi');
  push('version', h.productVersion);
  push('overall_status', h.overallStatus);
  push('maintenance_mode', h.inMaintenanceMode === undefined ? undefined : String(h.inMaintenanceMode));
  push('boot_time', h.bootTime);
  push('vendor', h.vendor);
  push('model', h.model);
  push('host_uuid', h.uuid);
  push('cpu_model', h.cpuModel);
  push('cpu_threads', h.cpuThreads);
  push('physical_nics', h.numNics);
  push('hbas', h.numHBAs);
  push('dns_hostname', h.dnsHostname);
  push('dns_domain', h.dnsDomain);
  push('default_gateway', h.defaultGateway);
  push('vmnics', h.pnics && h.pnics.length > 0 ? h.pnics.join(',') : undefined);
  push('datastore_summary', datastoreSummary);
  return tokens.join(' • ');
}

function alertStateFor(h: vsphere.VSphereHostInfo, cpuUsage?: number, memUsage?: number): 'ok' | 'warning' | 'critical' {
  if (h.connectionState && h.connectionState !== 'connected') return 'critical';
  if (h.overallStatus === 'red') return 'critical';
  if ((cpuUsage !== undefined && cpuUsage >= 90) || (memUsage !== undefined && memUsage >= 95)) return 'critical';
  if (h.overallStatus === 'yellow') return 'warning';
  if ((cpuUsage !== undefined && cpuUsage >= 80) || (memUsage !== undefined && memUsage >= 85)) return 'warning';
  return 'ok';
}

function formatDatastoreSummary(refs: string[] | undefined, byRef: Map<string, vsphere.VSphereDatastoreInfo>): string | undefined {
  const items = (refs ?? []).map((ref) => byRef.get(ref)).filter((d): d is vsphere.VSphereDatastoreInfo => Boolean(d));
  if (items.length === 0) return undefined;
  return items
    .map((d) => {
      if (d.freeSpaceBytes === undefined) return d.name;
      const freeGb = (d.freeSpaceBytes / 1024 ** 3).toFixed(0);
      return `${d.name} (${freeGb}GB free)`;
    })
    .join(', ');
}

export async function syncVCenterManager(managerId: string): Promise<{ hostCount: number; vmCount: number }> {
  const manager = await prisma.virtualizationManager.findUnique({ where: { id: managerId } });
  if (!manager) throw new Error('Không tìm thấy vCenter manager');

  let session: vsphere.VSphereSession | undefined;
  try {
    session = await vsphere.connect({ endpoint: manager.endpoint, username: manager.username, password: manager.password });
    const hosts = await vsphere.retrieveHosts(session);
    const groupId = hosts.length > 0 ? await resolveDeviceGroupId(manager.siteId) : undefined;

    const allDatastoreRefs = Array.from(new Set(hosts.flatMap((h) => h.datastoreRefs ?? [])));
    const datastores = allDatastoreRefs.length > 0 ? await vsphere.retrieveDatastores(session, allDatastoreRefs) : [];
    const datastoreByRef = new Map(datastores.map((d) => [d.externalId, d]));

    const allVmRefs = Array.from(new Set(hosts.flatMap((h) => h.vmRefs ?? [])));
    const vms = allVmRefs.length > 0 ? await vsphere.retrieveVmsByRefs(session, allVmRefs) : [];

    const now = new Date();
    const hostRows: { id: string; externalId: string }[] = [];
    for (const h of hosts) {
      // `summary.hardware.cpuMhz` is the clock speed of a single CPU (per-core), not
      // the host's total capacity — total MHz capacity = per-core clock * physical cores.
      const totalCpuMhz = h.cpuMhz !== undefined && h.cpuCores !== undefined ? h.cpuMhz * h.cpuCores : undefined;
      const cpuUsage = pctOf(h.overallCpuUsageMhz, totalCpuMhz);
      const memUsage = pctOf(
        h.overallMemoryUsageMB !== undefined ? h.overallMemoryUsageMB * 1024 * 1024 : undefined,
        h.memoryBytes,
      );
      const datastoreSummary = formatDatastoreSummary(h.datastoreRefs, datastoreByRef);
      const data = {
        name: h.name,
        powerState: h.powerState,
        connectionState: h.connectionState,
        cpuMhz: h.cpuMhz !== undefined ? Math.round(h.cpuMhz) : undefined,
        cpuCores: h.cpuCores,
        memoryBytes: h.memoryBytes,
        vmCount: h.vmRefs?.length ?? 0,
        cpuUsage,
        memoryUsage: memUsage,
        inventorySummary: buildInventorySummary(h, datastoreSummary),
        alertState: alertStateFor(h, cpuUsage, memUsage),
        lastSeenAt: now,
      };
      const row = await prisma.virtualizationHost.upsert({
        where: { managerId_externalId: { managerId, externalId: h.externalId } },
        create: { managerId, externalId: h.externalId, ...data },
        update: data,
      });
      hostRows.push({ id: row.id, externalId: row.externalId });

      if (groupId) {
        const hostname = await resolveHostname(h.name, row.deviceId);
        const ip = h.managementIp ?? (isIpLike(h.name) ? h.name : '0.0.0.0');
        const uptimeSeconds = h.bootTime ? Math.max(0, Math.floor((now.getTime() - new Date(h.bootTime).getTime()) / 1000)) : 0;
        const deviceData = {
          name: h.name,
          hostname,
          ip,
          type: 'server',
          vendor: h.vendor,
          model: h.model,
          os: 'VMware ESXi',
          osVersion: h.productVersion,
          sysDescr: data.inventorySummary,
          status: deviceStatusFor(h, data.alertState),
          uptimeSeconds,
          cpuUsage: cpuUsage ?? 0,
          cpuCount: h.cpuCores,
          memoryUsage: memUsage ?? 0,
          totalMemoryBytes: h.memoryBytes,
          disabled: true, // synced from vCenter, not polled directly via ping/SNMP
          lastPolled: now,
          groupId,
          siteId: manager.siteId,
        };
        if (row.deviceId) {
          await prisma.device.update({ where: { id: row.deviceId }, data: deviceData });
        } else {
          const device = await prisma.device.create({ data: deviceData });
          await prisma.virtualizationHost.update({ where: { id: row.id }, data: { deviceId: device.id } });
        }
      }
    }

    const hostIdByRef = new Map(hostRows.map((r) => [r.externalId, r.id]));
    for (const vm of vms) {
      const hostId = vm.hostRef ? hostIdByRef.get(vm.hostRef) ?? null : null;
      const data = {
        hostId,
        name: vm.name,
        powerState: vm.powerState,
        cpuCount: vm.cpuCount,
        memoryBytes: vm.memoryBytes,
        guestOs: vm.guestOs,
        ipAddress: vm.ipAddress,
        lastSeenAt: now,
      };
      await prisma.virtualMachine.upsert({
        where: { managerId_externalId: { managerId, externalId: vm.externalId } },
        create: { managerId, externalId: vm.externalId, ...data },
        update: data,
      });
    }

    // Remove hosts/VMs that vCenter no longer reports (decommissioned/removed), along
    // with the Device row mirroring each removed host (also drops its metric history).
    const seenHostIds = hostRows.map((r) => r.id);
    const removedHosts = await prisma.virtualizationHost.findMany({
      where: { managerId, id: { notIn: seenHostIds.length > 0 ? seenHostIds : ['__none__'] } },
      select: { deviceId: true },
    });
    const removedDeviceIds = removedHosts.map((r) => r.deviceId).filter((id): id is string => Boolean(id));
    if (removedDeviceIds.length > 0) {
      await prisma.device.deleteMany({ where: { id: { in: removedDeviceIds } } });
    }
    await prisma.virtualizationHost.deleteMany({
      where: { managerId, id: { notIn: seenHostIds.length > 0 ? seenHostIds : ['__none__'] } },
    });
    const seenVmExternalIds = vms.map((v) => v.externalId);
    await prisma.virtualMachine.deleteMany({
      where: { managerId, externalId: { notIn: seenVmExternalIds.length > 0 ? seenVmExternalIds : ['__none__'] } },
    });

    await prisma.virtualizationManager.update({ where: { id: managerId }, data: { lastSyncAt: now, lastError: null } });
    return { hostCount: hosts.length, vmCount: vms.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Đồng bộ vCenter thất bại';
    await prisma.virtualizationManager.update({ where: { id: managerId }, data: { lastError: message } }).catch(() => undefined);
    logger.warn({ err, managerId }, 'vCenter sync failed');
    throw err;
  } finally {
    if (session) await vsphere.disconnect(session).catch(() => undefined);
  }
}

export async function syncAllEnabledVCenterManagers(): Promise<void> {
  const managers = await prisma.virtualizationManager.findMany({ where: { enabled: true }, select: { id: true, name: true } });
  for (const m of managers) {
    try {
      const result = await syncVCenterManager(m.id);
      logger.info({ managerId: m.id, name: m.name, ...result }, 'vCenter sync completed');
    } catch (err) {
      logger.warn({ err, managerId: m.id, name: m.name }, 'vCenter sync cycle failed for manager');
    }
  }
}

export async function diagnoseVCenterHost(managerId: string, hostId: string): Promise<Record<string, unknown>> {
  const manager = await prisma.virtualizationManager.findUnique({ where: { id: managerId } });
  if (!manager) throw new Error('Không tìm thấy vCenter manager');
  const host = await prisma.virtualizationHost.findFirst({ where: { id: hostId, managerId } });
  if (!host) throw new Error('Không tìm thấy host');

  const session = await vsphere.connect({ endpoint: manager.endpoint, username: manager.username, password: manager.password });
  try {
    const hosts = await vsphere.retrieveHosts(session);
    const match = hosts.find((h) => h.externalId === host.externalId);
    return {
      connected: true,
      endpoint: manager.endpoint,
      externalId: host.externalId,
      hostCountReturned: hosts.length,
      raw: match ?? null,
    };
  } finally {
    await vsphere.disconnect(session).catch(() => undefined);
  }
}
