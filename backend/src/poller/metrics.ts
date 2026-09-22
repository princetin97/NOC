import { DeviceStatus } from '@prisma/client';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { pollQueue } from '../lib/queue';
import { checkPing } from '../lib/ping';
import { ENTITY_SENSOR_SCALE_FACTORS, ENTITY_SENSOR_TYPE_CELSIUS, OID, decodeIfStatus } from '../lib/mib-oids';
import {
  snmpGet,
  snmpGetSingle,
  snmpWalkColumn,
  snmpWalkSuffix,
  varbindToBigInt,
  varbindToNumber,
  varbindToString,
  withSession,
  type SnmpCredentials,
} from '../lib/snmp';
import { publishEvent } from '../lib/events';
import { evaluateAlertsForDevice } from './alerting';
import { discoverSensors } from './sensors';
import { pollProcessors } from './processors';
import { markPollFailure, markPollSuccess } from './cooldown';

// Device liveness anti-flap: require N consecutive unreachable polls before
// switching status to down, while recovering to up immediately on any success.
const downFailStreakByDevice = new Map<string, number>();

async function scheduleTransitionBoostPolls(deviceId: string, fromStatus: string, toStatus: string): Promise<void> {
  const isTransitionWorthBoost = fromStatus !== toStatus && (fromStatus === 'down' || toStatus === 'down');
  if (!isTransitionWorthBoost) return;

  const windowSeconds = env.pollTransitionBoostWindowSeconds;
  const stepSeconds = env.pollTransitionBoostStepSeconds;
  const maxJobs = env.pollTransitionBoostMaxJobs;
  const desiredJobs = Math.max(1, Math.floor(windowSeconds / stepSeconds));
  const jobs = Math.min(maxJobs, desiredJobs);
  const burstId = Date.now();

  for (let i = 1; i <= jobs; i += 1) {
    await pollQueue.add(
      'poll-transition-boost',
      { deviceId, reason: 'status-transition', fromStatus, toStatus },
      {
        jobId: `poll-boost-${deviceId}-${burstId}-${i}`,
        delay: i * stepSeconds * 1000,
        priority: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  logger.debug({ deviceId, fromStatus, toStatus, jobs, stepSeconds }, 'Scheduled transition boost polls');
}

export function toCredentials(device: {
  ip: string;
  snmpPort: number;
  snmpVersion: string;
  snmpCommunity: string | null;
  snmpV3User: string | null;
  snmpV3AuthProto: string | null;
  snmpV3AuthPass: string | null;
  snmpV3PrivProto: string | null;
  snmpV3PrivPass: string | null;
}): SnmpCredentials {
  return {
    ip: device.ip,
    port: device.snmpPort,
    version: device.snmpVersion as 'v1' | 'v2c' | 'v3',
    community: device.snmpCommunity,
    v3User: device.snmpV3User,
    v3AuthProto: device.snmpV3AuthProto,
    v3AuthPass: device.snmpV3AuthPass,
    v3PrivProto: device.snmpV3PrivProto,
    v3PrivPass: device.snmpV3PrivPass,
  };
}

/** Polls a single device: reachability, CPU/memory, and per-interface counters. */
export async function pollDevice(deviceId: string): Promise<void> {
  const device = await prisma.device.findUnique({ where: { id: deviceId }, include: { ports: true } });
  if (!device || device.disabled) return;

  // Ping and SNMP are independent reachability probes - run them concurrently
  // instead of sequentially so a fully-down device only costs max(pingTimeout,
  // snmpTimeout) per poll cycle instead of their sum.
  const pingPromise = checkPing(device.ip).catch(() => ({ alive: false, latencyMs: null, packetLoss: 100 }));

  let cpuUsage = device.cpuUsage;
  let memoryUsage = device.memoryUsage;
  let cpuCount = device.cpuCount;
  let totalMemoryBytes = device.totalMemoryBytes;
  let temperature = device.temperature ?? undefined;
  let uptimeSeconds = device.uptimeSeconds;
  let snmpReachable = false;

  const creds = toCredentials(device);

  const snmpPromise = (async () => {
    try {
      if (device.snmpPort > 0) {
        await withSession(creds, async (session) => {
      // Prefer HOST-RESOURCES hrSystemUptime (real OS boot time); Windows' sysUpTime is only
      // the SNMP service uptime and resets on service restart (LibreNMS uses the same order).
      // hrSystemUptime read singly so a device without HOST-RESOURCES doesn't fail the poll.
      const sys = await snmpGet(session, [OID.sysUptime]);
      const hrUptime = await snmpGetSingle(session, OID.hrSystemUptime);
      const uptimeTicks = varbindToNumber(hrUptime) ?? varbindToNumber(sys[0]);
      if (uptimeTicks !== undefined) uptimeSeconds = Math.floor(uptimeTicks / 100);
      snmpReachable = true;

      const cpuResult = await pollProcessors(session, deviceId, {
        vendor: device.vendor ?? undefined,
        sysDescr: device.sysDescr ?? undefined,
        sysObjectId: device.sysObjectId ?? undefined,
      });
      cpuUsage = cpuResult?.avgUsage ?? cpuUsage;
      cpuCount = cpuResult?.count ?? cpuCount;

      const memResult = await readMemoryUsage(session, deviceId, {
        sysDescr: device.sysDescr ?? undefined,
        sysObjectId: device.sysObjectId ?? undefined,
        vendor: device.vendor ?? undefined,
      });
      memoryUsage = memResult.percent ?? memoryUsage;
      totalMemoryBytes = memResult.totalBytes ?? totalMemoryBytes;

      temperature = (await readTemperature(session, deviceId)) ?? temperature;

      // FortiGate keeps IPsec interfaces up in IF-MIB even when the tunnel is down;
      // read the real per-tunnel state to correct the port status below. Detect by
      // vendor OR the Fortinet SNMP enterprise OID (12356) in case vendor is unset.
      const isFortinet =
        device.vendor === 'Fortinet' || (device.sysObjectId?.startsWith('1.3.6.1.4.1.12356') ?? false);
      const tunnelStatus = isFortinet ? await readFortiVpnTunnelStatus(session, deviceId) : undefined;

      await pollInterfaces(session, deviceId, device.ports, tunnelStatus);

        await discoverSensors(session, deviceId, {
          vendor: device.vendor,
          sysDescr: device.sysDescr,
          sysObjectId: device.sysObjectId,
          processors: cpuResult?.processors,
        });
      });
      }
    } catch (err) {
      logger.debug({ err, deviceId }, 'SNMP poll failed, falling back to ping-only status');
    }
  })();

  const [pingResult] = await Promise.all([pingPromise, snmpPromise]);

  const reachable = snmpReachable || pingResult.alive;
  let status: DeviceStatus;
  if (reachable) {
    markPollSuccess(deviceId);
    downFailStreakByDevice.delete(deviceId);
    status = 'up';
  } else {
    const backoff = markPollFailure(deviceId);
    const nextFailStreak = (downFailStreakByDevice.get(deviceId) ?? 0) + 1;
    downFailStreakByDevice.set(deviceId, nextFailStreak);
    logger.debug({ deviceId, streak: backoff.streak, cooldownSeconds: backoff.delaySeconds }, 'Poll cooldown increased for unreachable device');
    // Keep a previously-up device as up until it fails enough consecutive polls.
    status = nextFailStreak >= env.downFailStreakThreshold || device.status === 'down' ? 'down' : 'up';
  }
  const previousStatus = device.status;

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      status,
      cpuUsage,
      memoryUsage,
      cpuCount,
      totalMemoryBytes,
      temperature,
      uptimeSeconds,
      pingLatencyMs: pingResult.latencyMs ?? undefined,
      packetLoss: pingResult.packetLoss,
      lastPolled: new Date(),
    },
  });

  await prisma.deviceMetric.create({
    data: {
      deviceId,
      cpuUsage,
      memoryUsage,
      temperature,
      pingLatencyMs: pingResult.latencyMs ?? undefined,
      packetLoss: pingResult.packetLoss,
    },
  });

  await evaluateAlertsForDevice(deviceId);
  await scheduleTransitionBoostPolls(deviceId, previousStatus, status);
  await publishEvent('device:updated', { deviceId, status, cpuUsage, memoryUsage });
}

const HR_STORAGE_RAM = '1.3.6.1.2.1.25.2.1.2'; // HOST-RESOURCES-TYPES::hrStorageRam

interface MemoryReading {
  percent?: number;
  totalBytes?: number;
}

/**
 * CISCO-PROCESS-MIB cpmCPUMemoryUsed/Free. Despite the MIB describing these as
 * byte counts, real devices (confirmed live on NX-OS/Nexus 9000, and matched by
 * LibreNMS's own `mempool_precision => 1024` for this table in Cisco.php) report
 * them in KB - raw bytes would overflow the 32-bit Gauge on boxes with >4GB RAM
 * anyway, which is exactly why large-memory platforms use KB here.
 */
async function readCiscoProcessMibMemory(
  session: Parameters<typeof snmpWalkColumn>[0],
): Promise<MemoryReading | undefined> {
  const [used, free] = await Promise.all([
    snmpWalkColumn(session, OID.cpmCPUMemoryUsed),
    snmpWalkColumn(session, OID.cpmCPUMemoryFree),
  ]);
  let totalUsed = 0;
  let totalFree = 0;
  for (const [idx, vb] of used) {
    totalUsed += (varbindToNumber(vb) ?? 0) * 1024;
    totalFree += (varbindToNumber(free.get(idx)) ?? 0) * 1024;
  }
  const total = totalUsed + totalFree;
  if (total > 0) return { percent: Math.round((totalUsed / total) * 100), totalBytes: total };
  return undefined;
}

async function readMemoryUsage(
  session: Parameters<typeof snmpWalkColumn>[0],
  deviceId: string,
  opts?: { sysDescr?: string; sysObjectId?: string; vendor?: string },
): Promise<MemoryReading> {
  const isF5 =
    opts?.vendor === 'F5' ||
    (opts?.sysObjectId?.startsWith('1.3.6.1.4.1.3375') ?? false) ||
    /\bbig-ip\b|\btmos\b/i.test(opts?.sysDescr ?? '');
  if (isF5) {
    try {
      const [hostTotalVb, hostUsedVb, tmmTotalVb, tmmUsedVb, otherTotalVb, otherUsedVb] = await Promise.all([
        snmpGetSingle(session, OID.f5SysGlobalHostMemTotal),
        snmpGetSingle(session, OID.f5SysGlobalHostMemUsed),
        snmpGetSingle(session, OID.f5SysStatMemoryTotal),
        snmpGetSingle(session, OID.f5SysStatMemoryUsed),
        snmpGetSingle(session, OID.f5SysGlobalHostOtherMemoryTotal),
        snmpGetSingle(session, OID.f5SysGlobalHostOtherMemoryUsed),
      ]);

      const hostTotal = varbindToBigInt(hostTotalVb);
      const hostUsed = varbindToBigInt(hostUsedVb);
      if (hostTotal > 0n) {
        const clampedUsed = hostUsed > hostTotal ? hostTotal : hostUsed;
        const total = Number(hostTotal);
        const used = Number(clampedUsed);
        if (Number.isFinite(total) && Number.isFinite(used) && total > 0) {
          return { percent: Math.round((used / total) * 100), totalBytes: total };
        }
      }

      const tmmTotal = varbindToBigInt(tmmTotalVb);
      const tmmUsed = varbindToBigInt(tmmUsedVb);
      const otherTotal = varbindToBigInt(otherTotalVb);
      const otherUsed = varbindToBigInt(otherUsedVb);
      const combinedTotal = tmmTotal + otherTotal;
      if (combinedTotal > 0n) {
        const combinedUsedRaw = tmmUsed + otherUsed;
        const combinedUsed = combinedUsedRaw > combinedTotal ? combinedTotal : combinedUsedRaw;
        const total = Number(combinedTotal);
        const used = Number(combinedUsed);
        if (Number.isFinite(total) && Number.isFinite(used) && total > 0) {
          return { percent: Math.round((used / total) * 100), totalBytes: total };
        }
      }

      if (tmmTotal > 0n) {
        const clampedUsed = tmmUsed > tmmTotal ? tmmTotal : tmmUsed;
        const total = Number(tmmTotal);
        const used = Number(clampedUsed);
        if (Number.isFinite(total) && Number.isFinite(used) && total > 0) {
          return { percent: Math.round((used / total) * 100), totalBytes: total };
        }
      }
    } catch (err) {
      logger.debug({ err, deviceId }, 'F5-BIGIP-SYSTEM-MIB memory read failed, trying generic memory fallbacks');
    }
  }

  try {
    const mem = await snmpGet(session, [OID.ucdMemTotalReal, OID.ucdMemAvailReal, OID.ucdMemBuffer, OID.ucdMemCached]);
    const total = varbindToNumber(mem[0]);
    const avail = varbindToNumber(mem[1]);
    // memAvailReal is only MemFree; kernel buffers + page cache are reclaimable, so
    // count them as available too (LibreNMS parity). Otherwise a Linux box with a
    // large cache shows a falsely high "used %" (e.g. 94% vs the real ~22% in `free`).
    const buffers = varbindToNumber(mem[2]) ?? 0;
    const cached = varbindToNumber(mem[3]) ?? 0;
    if (total && avail !== undefined && total > 0) {
      const free = Math.min(total, avail + buffers + cached);
      // ucdMemTotalReal is reported in KiB.
      return { percent: Math.round(((total - free) / total) * 100), totalBytes: total * 1024 };
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'UCD-SNMP-MIB memory read failed, trying CISCO-ENHANCED-MEMPOOL-MIB');
  }
  // NX-OS (Nexus/MDS) only exposes a single CISCO-ENHANCED-MEMPOOL-MIB row that
  // represents an internal software heap ("processor" pool), not total system RAM -
  // it does not match `show system resources` at all (confirmed live: ~3.5GB/78%
  // reported vs the real ~23.5GB/28.6%). CISCO-PROCESS-MIB, however, matches the
  // real system-wide total on NX-OS, so prefer it first on that platform.
  if (/nx-os|nxos/i.test(opts?.sysDescr ?? '')) {
    try {
      const cpmResult = await readCiscoProcessMibMemory(session);
      if (cpmResult) return cpmResult;
    } catch (err) {
      logger.debug({ err, deviceId }, 'CISCO-PROCESS-MIB (NX-OS priority) memory read failed, trying CISCO-ENHANCED-MEMPOOL-MIB');
    }
  }
  try {
    // CISCO-ENHANCED-MEMPOOL-MIB - the only memory MIB implemented by NX-OS (Nexus/MDS)
    // and most modern IOS-XE platforms; CISCO-MEMORY-POOL-MIB below is legacy/IOS-only.
    const [valid, used, free, hcUsed, hcFree] = await Promise.all([
      snmpWalkColumn(session, OID.cempMemPoolValid),
      snmpWalkColumn(session, OID.cempMemPoolUsed),
      snmpWalkColumn(session, OID.cempMemPoolFree),
      snmpWalkColumn(session, OID.cempMemPoolHCUsed),
      snmpWalkColumn(session, OID.cempMemPoolHCFree),
    ]);
    let totalUsed = 0;
    let totalFree = 0;
    for (const [idx, validVb] of valid) {
      if (varbindToNumber(validVb) !== 1) continue; // cempMemPoolValid == true(1)
      totalUsed += varbindToNumber(hcUsed.get(idx)) ?? varbindToNumber(used.get(idx)) ?? 0;
      totalFree += varbindToNumber(hcFree.get(idx)) ?? varbindToNumber(free.get(idx)) ?? 0;
    }
    const total = totalUsed + totalFree;
    if (total > 0) return { percent: Math.round((totalUsed / total) * 100), totalBytes: total };
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCO-ENHANCED-MEMPOOL-MIB memory read failed, trying CISCO-MEMORY-POOL-MIB');
  }
  try {
    const [used, free] = await Promise.all([
      snmpWalkColumn(session, OID.ciscoMemoryPoolUsed),
      snmpWalkColumn(session, OID.ciscoMemoryPoolFree),
    ]);
    let totalUsed = 0;
    let totalFree = 0;
    for (const [idx, vb] of used) {
      totalUsed += varbindToNumber(vb) ?? 0;
      totalFree += varbindToNumber(free.get(idx)) ?? 0;
    }
    const total = totalUsed + totalFree;
    if (total > 0) return { percent: Math.round((totalUsed / total) * 100), totalBytes: total };
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCO-MEMORY-POOL-MIB memory read failed, trying CISCO-PROCESS-MIB');
  }
  try {
    // CISCO-PROCESS-MIB cpmCPUMemoryUsed/Free - last-resort Cisco fallback (older
    // platforms exposing neither of the two mempool MIBs above, or non-NX-OS devices
    // where the NX-OS priority check above didn't apply).
    const cpmResult = await readCiscoProcessMibMemory(session);
    if (cpmResult) return cpmResult;
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCO-PROCESS-MIB memory read failed, trying FORTINET-FORTIGATE-MIB');
  }
  try {
    const fg = await snmpGet(session, [OID.fgSysMemUsage, OID.fgSysMemCapacity]);
    const usage = varbindToNumber(fg[0]);
    const capacityKb = varbindToNumber(fg[1]);
    if (usage !== undefined && usage >= 0 && usage <= 100) {
      return { percent: Math.round(usage), totalBytes: capacityKb ? capacityKb * 1024 : undefined };
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'FORTINET-FORTIGATE-MIB memory read failed, trying JUNIPER-MIB');
  }
  try {
    // jnxOperatingBuffer is the memory-buffer utilization percentage per operating entry.
    const bufs = await snmpWalkSuffix(session, OID.jnxOperatingBuffer);
    const values = Array.from(bufs.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0 && v <= 100);
    if (values.length > 0) return { percent: Math.round(Math.max(...values)) };
  } catch (err) {
    logger.debug({ err, deviceId }, 'JUNIPER-MIB memory read failed, trying HP-ICF-MIB');
  }
  try {
    const [total, free] = await Promise.all([
      snmpWalkColumn(session, OID.hpLocalMemTotalBytes),
      snmpWalkColumn(session, OID.hpLocalMemFreeBytes),
    ]);
    let totalBytes = 0;
    let freeBytes = 0;
    for (const [idx, vb] of total) {
      totalBytes += varbindToNumber(vb) ?? 0;
      freeBytes += varbindToNumber(free.get(idx)) ?? 0;
    }
    if (totalBytes > 0) return { percent: Math.round(((totalBytes - freeBytes) / totalBytes) * 100), totalBytes };
  } catch (err) {
    logger.debug({ err, deviceId }, 'HP-ICF-MIB memory read failed, trying HH3C-ENTITY-EXT-MIB');
  }
  try {
    const mems = await snmpWalkColumn(session, OID.hh3cEntityExtMemUsage);
    const values = Array.from(mems.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0 && v <= 100);
    if (values.length > 0) return { percent: Math.round(Math.max(...values)) };
  } catch (err) {
    logger.debug({ err, deviceId }, 'HH3C-ENTITY-EXT-MIB memory read failed, trying A3COM-HUAWEI-MIB');
  }
  try {
    // 3Com / H3C Comware: hwMemSize / hwMemFree (bytes) per frame/slot.
    const [size, free] = await Promise.all([
      snmpWalkColumn(session, OID.a3comMemSize),
      snmpWalkColumn(session, OID.a3comMemFree),
    ]);
    let totalBytes = 0;
    let freeBytes = 0;
    for (const [idx, vb] of size) {
      totalBytes += varbindToNumber(vb) ?? 0;
      freeBytes += varbindToNumber(free.get(idx)) ?? 0;
    }
    if (totalBytes > 0) return { percent: Math.round(((totalBytes - freeBytes) / totalBytes) * 100), totalBytes };
  } catch (err) {
    logger.debug({ err, deviceId }, 'A3COM-HUAWEI-MIB memory read failed, no more fallbacks');
  }
  try {
    // Huawei VRP hwEntityMemUsage percentage per board — take the busiest.
    const mems = await snmpWalkColumn(session, OID.hwEntityMemUsage);
    const values = Array.from(mems.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0 && v <= 100);
    if (values.length > 0) return { percent: Math.round(Math.max(...values)) };
  } catch (err) {
    logger.debug({ err, deviceId }, 'HUAWEI memory read failed, trying HOST-RESOURCES-MIB');
  }
  try {
    // HOST-RESOURCES-MIB hrStorageRam — universal RAM for Windows, Linux, Dell/IBM servers,
    // VMware, printers and appliances that only implement the standard MIB (LibreNMS HostResources).
    const [types, descrs, sizes, useds, units] = await Promise.all([
      snmpWalkColumn(session, OID.hrStorageType),
      snmpWalkColumn(session, OID.hrStorageDescr),
      snmpWalkColumn(session, OID.hrStorageSize),
      snmpWalkColumn(session, OID.hrStorageUsed),
      snmpWalkColumn(session, OID.hrStorageAllocationUnits),
    ]);
    const ramIdx = Array.from(types.keys()).filter((i) => varbindToString(types.get(i)) === HR_STORAGE_RAM);
    // Prefer the "Physical Memory" entry; some agents also list swap/virtual as RAM-typed.
    const physical = ramIdx.find((i) => /physical memory/i.test(varbindToString(descrs.get(i)) ?? ''));
    const chosen = physical !== undefined ? [physical] : ramIdx;
    let size = 0;
    let used = 0;
    let bytes = 0;
    for (const i of chosen) {
      const allocationUnits = varbindToNumber(units.get(i)) ?? 1;
      size += varbindToNumber(sizes.get(i)) ?? 0;
      used += varbindToNumber(useds.get(i)) ?? 0;
      bytes += (varbindToNumber(sizes.get(i)) ?? 0) * allocationUnits;
    }
    if (size > 0) return { percent: Math.round((used / size) * 100), totalBytes: bytes };
  } catch (err) {
    logger.debug({ err, deviceId }, 'HOST-RESOURCES-MIB memory read failed, no more fallbacks');
  }
  return {};
}

const AMBIENT_SENSOR_NAME_RE = /ambient|inlet|intake/i;
const HOTSPOT_SENSOR_NAME_RE = /\bcpu\b|processor|\bdie\b|\bcore\b|asic/i;

/**
 * Picks a single representative value out of several temperature sensor readings.
 * Prefers an explicitly named ambient/inlet/intake probe; otherwise averages the
 * non-CPU/die "hotspot" sensors (or all readings if every sensor looks like a
 * hotspot) instead of blindly taking the single hottest reading — a device with
 * e.g. a hot CPU-die probe shouldn't have that spike misreported as its overall
 * (ambient) temperature.
 */
function pickRepresentativeTemperature(readings: { name?: string; celsius: number }[]): number | undefined {
  if (readings.length === 0) return undefined;
  const ambient = readings.find((r) => r.name && AMBIENT_SENSOR_NAME_RE.test(r.name));
  if (ambient) return Math.round(ambient.celsius * 10) / 10;
  const nonHotspot = readings.filter((r) => !r.name || !HOTSPOT_SENSOR_NAME_RE.test(r.name));
  const pool = nonHotspot.length > 0 ? nonHotspot : readings;
  const avg = pool.reduce((sum, r) => sum + r.celsius, 0) / pool.length;
  return Math.round(avg * 10) / 10;
}

/** Reads chassis/ambient temperature via ENTITY-SENSOR-MIB, falling back to CISCO-ENTITY-SENSOR-MIB / CISCO-ENVMON-MIB. */
async function readTemperature(session: Parameters<typeof snmpWalkColumn>[0], deviceId: string): Promise<number | undefined> {
  try {
    const [types, scales, precisions, values] = await Promise.all([
      snmpWalkColumn(session, OID.entPhySensorType),
      snmpWalkColumn(session, OID.entPhySensorScale),
      snmpWalkColumn(session, OID.entPhySensorPrecision),
      snmpWalkColumn(session, OID.entPhySensorValue),
    ]);
    const readings: number[] = [];
    for (const [idx, typeVb] of types) {
      if (varbindToNumber(typeVb) !== ENTITY_SENSOR_TYPE_CELSIUS) continue;
      const rawValue = varbindToNumber(values.get(idx));
      if (rawValue === undefined) continue;
      const scale = ENTITY_SENSOR_SCALE_FACTORS[varbindToNumber(scales.get(idx)) ?? 9] ?? 1;
      const precision = varbindToNumber(precisions.get(idx)) ?? 0;
      readings.push((rawValue * scale) / 10 ** precision);
    }
    if (readings.length > 0) return Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 10) / 10;
    logger.debug({ deviceId }, 'ENTITY-SENSOR-MIB has no celsius sensors, trying CISCO-ENTITY-SENSOR-MIB');
  } catch (err) {
    logger.debug({ err, deviceId }, 'ENTITY-SENSOR-MIB temperature read failed, trying CISCO-ENTITY-SENSOR-MIB');
  }
  try {
    // CISCO-ENTITY-SENSOR-MIB - Cisco's own pre-standard clone of the table above; many
    // NX-OS platforms (Nexus/MDS) only implement this, not the IETF ENTITY-SENSOR-MIB.
    const [types, scales, precisions, values] = await Promise.all([
      snmpWalkColumn(session, OID.cetSensorType),
      snmpWalkColumn(session, OID.cetSensorScale),
      snmpWalkColumn(session, OID.cetSensorPrecision),
      snmpWalkColumn(session, OID.cetSensorValue),
    ]);
    const readings: number[] = [];
    for (const [idx, typeVb] of types) {
      if (varbindToNumber(typeVb) !== ENTITY_SENSOR_TYPE_CELSIUS) continue;
      const rawValue = varbindToNumber(values.get(idx));
      if (rawValue === undefined) continue;
      const scale = ENTITY_SENSOR_SCALE_FACTORS[varbindToNumber(scales.get(idx)) ?? 9] ?? 1;
      const precision = varbindToNumber(precisions.get(idx)) ?? 0;
      readings.push((rawValue * scale) / 10 ** precision);
    }
    if (readings.length > 0) return Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 10) / 10;
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCO-ENTITY-SENSOR-MIB temperature read failed, trying CISCO-ENVMON-MIB');
  }
  try {
    const temps = await snmpWalkColumn(session, OID.ciscoEnvMonTemperatureStatusValue);
    const readings = Array.from(temps.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0);
    if (readings.length > 0) return Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 10) / 10;
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCO-ENVMON-MIB temperature read failed, trying FORTINET-FORTIGATE-MIB');
  }
  // FortiGate: the sensor table mixes temperature, fan and voltage readings, so only
  // keep sensors whose name identifies them as temperature probes.
  try {
    const [names, values] = await Promise.all([
      snmpWalkColumn(session, OID.fgHwSensorEntName),
      snmpWalkColumn(session, OID.fgHwSensorEntValue),
    ]);
    const readings: { name: string; celsius: number }[] = [];
    for (const [idx, nameVb] of names) {
      const name = (varbindToString(nameVb) ?? '').trim();
      // Newer FortiGate models (e.g. 201G) often label temperature probes as
      // "TMP ..." instead of "Temp ...", so include both naming styles.
      if (!/(temp|\btmp\b|thermal)/i.test(name)) continue;
      const value = varbindToNumber(values.get(idx));
      if (value !== undefined && value > 0 && value < 150) readings.push({ name, celsius: value });
    }
    const representative = pickRepresentativeTemperature(readings);
    if (representative !== undefined) return representative;
  } catch (err) {
    logger.debug({ err, deviceId }, 'FORTINET-FORTIGATE-MIB temperature read failed, trying JUNIPER-MIB');
  }
  try {
    const temps = await snmpWalkSuffix(session, OID.jnxOperatingTemp);
    const readings = Array.from(temps.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0 && v < 150)
      .map((celsius) => ({ celsius }));
    const representative = pickRepresentativeTemperature(readings);
    if (representative !== undefined) return representative;
  } catch (err) {
    logger.debug({ err, deviceId }, 'JUNIPER-MIB temperature read failed, trying HH3C-ENTITY-EXT-MIB');
  }
  try {
    const temps = await snmpWalkColumn(session, OID.hh3cEntityExtTemperature);
    const readings = Array.from(temps.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0 && v < 150)
      .map((celsius) => ({ celsius }));
    const representative = pickRepresentativeTemperature(readings);
    if (representative !== undefined) return representative;
  } catch (err) {
    logger.debug({ err, deviceId }, 'HH3C-ENTITY-EXT-MIB temperature read failed, trying CISCOSB-MIB');
  }
  try {
    // Cisco Small Business / Catalyst 1200-1300 (ciscosb) rlEnvFanDataTemp (celsius, skip 0).
    const temps = await snmpWalkColumn(session, OID.ciscosbEnvTemp);
    const readings = Array.from(temps.values())
      .map((vb) => varbindToNumber(vb))
      .filter((v): v is number => v !== undefined && v > 0 && v < 150)
      .map((celsius) => ({ celsius }));
    const representative = pickRepresentativeTemperature(readings);
    if (representative !== undefined) return representative;
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCOSB-MIB temperature read failed, trying IDRAC-MIB');
  }
  try {
    // Dell iDRAC/OMSA temperatureProbeTable.
    const [temps, names] = await Promise.all([
      snmpWalkColumn(session, OID.dellTempReading),
      snmpWalkColumn(session, OID.dellTempLocation),
    ]);
    const readings: { name?: string; celsius: number }[] = [];
    for (const [idx, vb] of temps) {
      const raw = varbindToNumber(vb);
      if (raw === undefined) continue;
      const celsius = raw / 10; // tenths °C
      if (celsius > 0 && celsius < 150) readings.push({ name: varbindToString(names.get(idx)), celsius });
    }
    const representative = pickRepresentativeTemperature(readings);
    if (representative !== undefined) return representative;
  } catch (err) {
    logger.debug({ err, deviceId }, 'IDRAC-MIB temperature read failed, no more fallbacks');
  }
  return undefined;
}

const MAX_COUNTER32 = 4294967296n; // 2^32
const MAX_COUNTER64 = 18446744073709551616n; // 2^64

/**
 * Computes the delta between two monotonically increasing SNMP counters, correcting
 * for wrap-around. A decrease normally means the counter wrapped past its max; if the
 * wrap-corrected delta is implausibly large it is treated as a device reset and 0 is
 * returned to avoid a bogus traffic spike.
 */
function counterDelta(newVal: bigint, oldVal: bigint, is64: boolean): bigint {
  if (newVal >= oldVal) return newVal - oldVal;
  const max = is64 ? MAX_COUNTER64 : MAX_COUNTER32;
  const wrapped = max - oldVal + newVal;
  return wrapped < max / 2n ? wrapped : 0n;
}

async function pollInterfaces(
  session: Parameters<typeof snmpWalkColumn>[0],
  deviceId: string,
  existingPorts: { id: string; ifIndex: number; ifName: string; inOctets: bigint; outOctets: bigint; lastPolled: Date | null; ifSpeed: bigint }[],
  tunnelStatus?: Map<string, string>,
): Promise<void> {
  const [hcInOctets, hcOutOctets, inOctets32, outOctets32, inErrors, outErrors, inDiscards, outDiscards, operStatus_] = await Promise.all([
    snmpWalkColumn(session, OID.ifHCInOctets),
    snmpWalkColumn(session, OID.ifHCOutOctets),
    snmpWalkColumn(session, OID.ifInOctets),
    snmpWalkColumn(session, OID.ifOutOctets),
    snmpWalkColumn(session, OID.ifInErrors),
    snmpWalkColumn(session, OID.ifOutErrors),
    snmpWalkColumn(session, OID.ifInDiscards),
    snmpWalkColumn(session, OID.ifOutDiscards),
    snmpWalkColumn(session, OID.ifOperStatus),
  ]);

  const portByIndex = new Map(existingPorts.map((p) => [p.ifIndex, p]));
  const now = Date.now();

  // Collect all updates, then flush in a single transaction to avoid hammering
  // PostgreSQL with hundreds of individual UPDATE+INSERT round-trips per device.
  const portUpdates: { id: string; data: Parameters<typeof prisma.port.update>[0]['data'] }[] = [];
  const metricInserts: { portId: string; inRateBps: number; outRateBps: number; inErrors: bigint; outErrors: bigint; inDiscards: bigint; outDiscards: bigint; utilization: number }[] = [];

  // Iterate over whichever counter set has data (HC preferred, else 32-bit).
  const ifIndexes = new Set<number>([...hcInOctets.keys(), ...inOctets32.keys()]);
  for (const ifIndex of ifIndexes) {
    const existing = portByIndex.get(ifIndex);
    if (!existing) continue; // unseen interface, will be picked up by next discovery run

    // Prefer 64-bit HC counters (never wrap in practice); fall back to 32-bit.
    // Decide per direction so a device exposing HC on only one side still works.
    const hcInVb = hcInOctets.get(ifIndex);
    const hcOutVb = hcOutOctets.get(ifIndex);
    const inIs64 = hcInVb !== undefined;
    const outIs64 = hcOutVb !== undefined;
    const newIn = inIs64 ? varbindToBigInt(hcInVb) : varbindToBigInt(inOctets32.get(ifIndex));
    const newOut = outIs64 ? varbindToBigInt(hcOutVb) : varbindToBigInt(outOctets32.get(ifIndex));
    const elapsedSec = existing.lastPolled ? Math.max(1, (now - existing.lastPolled.getTime()) / 1000) : 0;

    let inRateBps = 0;
    let outRateBps = 0;
    if (elapsedSec > 0) {
      const inDelta = counterDelta(newIn, existing.inOctets, inIs64);
      const outDelta = counterDelta(newOut, existing.outOctets, outIs64);
      inRateBps = (Number(inDelta) * 8) / elapsedSec;
      outRateBps = (Number(outDelta) * 8) / elapsedSec;
    }

    const speedBps = Number(existing.ifSpeed);
    // Reject implausible spikes (one-time transient when the counter source switches,
    // or an undetected reset). Clamp against port speed when known, otherwise against
    // an absolute ceiling so logical ports (ifSpeed=0, e.g. PPPoE) are still guarded.
    const ceiling = speedBps > 0 ? speedBps * 10 : 400_000_000_000; // 400 Gbps
    if (inRateBps > ceiling) inRateBps = 0;
    if (outRateBps > ceiling) outRateBps = 0;
    const utilization = speedBps > 0 ? Math.min(100, Math.round((Math.max(inRateBps, outRateBps) / speedBps) * 100)) : 0;


    // Prefer the real FortiGate tunnel state when this port is a VPN tunnel; the
    // standard IF-MIB reports such interfaces as up even when the tunnel is down.
    let operStatus = decodeIfStatus(varbindToNumber(operStatus_.get(ifIndex)) ?? 2);
    const tunnelState = tunnelStatus?.get(existing.ifName.toLowerCase());
    if (tunnelState) operStatus = tunnelState;

    portUpdates.push({
      id: existing.id,
      data: {
        inOctets: newIn,
        outOctets: newOut,
        inErrors: varbindToBigInt(inErrors.get(ifIndex)),
        outErrors: varbindToBigInt(outErrors.get(ifIndex)),
        inDiscards: varbindToBigInt(inDiscards.get(ifIndex)),
        outDiscards: varbindToBigInt(outDiscards.get(ifIndex)),
        ifOperStatus: operStatus,
        inRateBps,
        outRateBps,
        utilization,
        lastPolled: new Date(),
      },
    });

    metricInserts.push({
      portId: existing.id,
      inRateBps,
      outRateBps,
      inErrors: varbindToBigInt(inErrors.get(ifIndex)),
      outErrors: varbindToBigInt(outErrors.get(ifIndex)),
      inDiscards: varbindToBigInt(inDiscards.get(ifIndex)),
      outDiscards: varbindToBigInt(outDiscards.get(ifIndex)),
      utilization,
    });
  }

  // Flush all port updates + metric inserts in a single transaction.
  if (portUpdates.length > 0) {
    await prisma.$transaction([
      ...portUpdates.map((u) => prisma.port.update({ where: { id: u.id }, data: u.data })),
      prisma.portMetric.createMany({ data: metricInserts }),
    ]);
  }
}

/**
 * Reads the FortiGate IPsec tunnel table and returns a map of tunnel (phase1) name
 * (lower-cased) to 'up'/'down'. Used to correct VPN interface status, which IF-MIB
 * always reports as up regardless of the actual tunnel/SA state.
 */
async function readFortiVpnTunnelStatus(
  session: Parameters<typeof snmpWalkColumn>[0],
  deviceId: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    // fgVpnTunTable uses a compound index (fgVpnTunEntIndex.subIndex, e.g. "9.1"),
    // so walk by full suffix to keep each tunnel distinct instead of colliding on
    // the last OID octet.
    const [names, statuses] = await Promise.all([
      snmpWalkSuffix(session, OID.fgVpnTunEntPhase1Name),
      snmpWalkSuffix(session, OID.fgVpnTunEntStatus),
    ]);
    if (names.size === 0) {
      logger.info({ deviceId }, 'FortiGate VPN tunnel table is empty (check SNMP VDOM scope / community)');
      return result;
    }
    for (const [suffix, nameVb] of names) {
      const name = varbindToString(nameVb)?.trim().toLowerCase();
      if (!name) continue;
      // fgVpnTunEntStatus: down(1), up(2).
      const status = varbindToNumber(statuses.get(suffix)) === 2 ? 'up' : 'down';
      // A tunnel name can span multiple phase2 SAs; treat it as up if any SA is up.
      if (status === 'up' || !result.has(name)) result.set(name, status);
    }
    return result;
  } catch (err) {
    logger.debug({ err, deviceId }, 'FortiGate VPN tunnel status read failed');
    return result;
  }
}
