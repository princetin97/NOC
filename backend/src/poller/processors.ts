import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { OID } from '../lib/mib-oids';
import { snmpGet, snmpWalkColumn, snmpWalkSuffix, varbindToNumber, varbindToString } from '../lib/snmp';

type Session = Parameters<typeof snmpWalkColumn>[0];

interface ProcessorDeviceContext {
  vendor?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
}

function isHpe1910(ctx?: ProcessorDeviceContext): boolean {
  const descr = (ctx?.sysDescr ?? '').toLowerCase();
  const vendor = (ctx?.vendor ?? '').toLowerCase();
  const oid = ctx?.sysObjectId ?? '';
  return (
    vendor === 'hpe' &&
    (oid.startsWith('1.3.6.1.4.1.25506.11.1.136') || /\b1910-\d+\b|\bjg540a\b/.test(descr))
  );
}

// A processor must be missing from discovery for this long (not just one poll cycle)
// before it's pruned — protects its historical trend from single-cycle SNMP hiccups.
const STALE_PROCESSOR_GRACE_MS = 30 * 60 * 1000;

export interface DiscoveredProcessor {
  index: string; // stable per-device key
  description: string; // human label
  usage: number; // percentage 0-100
}

function pct(v: number | undefined): number | undefined {
  if (v === undefined || Number.isNaN(v)) return undefined;
  if (v < 0 || v > 100) return undefined;
  return Math.round(v);
}

/**
 * Discovers every processor on a device and its current utilisation, keeping the
 * per-CPU breakdown (unlike the legacy aggregate). Tries the same vendor OID chain
 * as the old single-value reader and returns the first source that yields entries.
 */
export async function readProcessors(
  session: Session,
  deviceId: string,
  ctx?: ProcessorDeviceContext,
): Promise<DiscoveredProcessor[]> {
  // Some devices expose multiple CPU MIBs where a generic table reports all-zero
  // values while a vendor-specific table has real usage. Keep all-zero reads as a
  // fallback, but prefer the first source that has at least one non-zero value.
  let allZeroFallback: DiscoveredProcessor[] | null = null;
  const choose = (rows: DiscoveredProcessor[]): DiscoveredProcessor[] | null => {
    if (rows.length === 0) return null;
    if (rows.some((r) => r.usage > 0)) return rows;
    if (!allZeroFallback) allZeroFallback = rows;
    return null;
  };

  // HPE 1910 (Comware) often exposes many placeholder hrProcessorLoad rows that stay at 0.
  // Prefer the vendor scalar CPU OID for a realistic single CPU reading.
  if (isHpe1910(ctx)) {
    try {
      const hp = await snmpGet(session, [OID.hpSwitchCpuStat]);
      const usage = pct(varbindToNumber(hp[0]));
      if (usage !== undefined) {
        const picked = choose([{ index: 'hp-0', description: 'CPU', usage }]);
        if (picked) return picked;
      }
    } catch (err) {
      logger.debug({ err, deviceId }, 'HP-ICF-MIB (HPE 1910 priority) processor read failed');
    }
  }

  // 1) HOST-RESOURCES-MIB hrProcessorLoad — one entry per logical CPU (Linux/Windows/appliances).
  try {
    const loads = await snmpWalkColumn(session, OID.hrProcessorLoad);
    if (loads.size > 0) {
      const out: DiscoveredProcessor[] = [];
      let n = 0;
      for (const [suffix, vb] of loads) {
        const usage = pct(varbindToNumber(vb));
        if (usage === undefined) continue;
        n += 1;
        out.push({ index: `hr-${suffix}`, description: `CPU ${n}`, usage });
      }
      const picked = choose(out);
      if (picked) return picked;
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'hrProcessorLoad processor read failed');
  }

  // 2) UCD-SNMP-MIB — Net-SNMP Linux/Unix agents expose a single aggregate CPU.
  try {
    const raw = await snmpGet(session, [OID.ucdCpuRawUser, OID.ucdCpuRawSystem, OID.ucdCpuRawIdle]);
    const user = varbindToNumber(raw[0]) ?? 0;
    const system = varbindToNumber(raw[1]) ?? 0;
    const idle = varbindToNumber(raw[2]) ?? 0;
    const total = user + system + idle;
    if (total > 0) {
      const picked = choose([{ index: 'ucd-0', description: 'CPU', usage: Math.round(((user + system) / total) * 100) }]);
      if (picked) return picked;
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'UCD-SNMP-MIB processor read failed');
  }

  // 3) CISCO-PROCESS-MIB cpmCPUTotal5minRev — per-CPU/module on IOS/IOS-XE.
  try {
    const loads = await snmpWalkColumn(session, OID.cpmCPUTotal5minRev);
    if (loads.size > 0) {
      const out: DiscoveredProcessor[] = [];
      let n = 0;
      for (const [suffix, vb] of loads) {
        const usage = pct(varbindToNumber(vb));
        if (usage === undefined) continue;
        n += 1;
        out.push({ index: `cpm-${suffix}`, description: loads.size > 1 ? `CPU ${n}` : 'CPU', usage });
      }
      const picked = choose(out);
      if (picked) return picked;
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCO-PROCESS-MIB processor read failed');
  }

  // 4) FORTINET-FORTIGATE-MIB — scalar aggregate CPU percentage.
  try {
    const fg = await snmpGet(session, [OID.fgSysCpuUsage]);
    const usage = pct(varbindToNumber(fg[0]));
    if (usage !== undefined) {
      const picked = choose([{ index: 'fg-0', description: 'CPU', usage }]);
      if (picked) return picked;
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'FORTINET-FORTIGATE-MIB processor read failed');
  }

  // 5) JUNIPER-MIB jnxOperatingTable + SRX SPU — per Routing Engine / SPU CPU.
  try {
    const [descrs, cpus] = await Promise.all([
      snmpWalkSuffix(session, OID.jnxOperatingDescr),
      snmpWalkSuffix(session, OID.jnxOperatingCPU),
    ]);
    const out: DiscoveredProcessor[] = [];
    for (const [suffix, descrVb] of descrs) {
      const descr = varbindToString(descrVb)?.trim();
      if (!descr || /fan|sensor|power|psu/i.test(descr)) continue;
      const usage = pct(varbindToNumber(cpus.get(suffix)));
      if (usage === undefined || usage <= 0) continue;
      out.push({ index: `jnx-${suffix}`, description: descr, usage });
    }
    const spu = await snmpWalkSuffix(session, OID.jnxJsSPUMonitoringCPUUsage).catch(() => new Map());
    for (const [suffix, vb] of spu as Map<string, unknown>) {
      const usage = pct(varbindToNumber(vb as never));
      if (usage === undefined) continue;
      out.push({ index: `spu-${suffix}`, description: `SPU ${suffix}`, usage });
    }
    const picked = choose(out);
    if (picked) return picked;
  } catch (err) {
    logger.debug({ err, deviceId }, 'JUNIPER-MIB processor read failed');
  }

  // 6) HP-ICF-MIB — scalar CPU percentage.
  try {
    const hp = await snmpGet(session, [OID.hpSwitchCpuStat]);
    const usage = pct(varbindToNumber(hp[0]));
    if (usage !== undefined) {
      const picked = choose([{ index: 'hp-0', description: 'CPU', usage }]);
      if (picked) return picked;
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'HP-ICF-MIB processor read failed');
  }

  // 7) HH3C-ENTITY-EXT-MIB — per-slot CPU (H3C/3Com/HPE Comware).
  try {
    const cpus = await snmpWalkColumn(session, OID.hh3cEntityExtCpuUsage);
    const out: DiscoveredProcessor[] = [];
    let n = 0;
    for (const [suffix, vb] of cpus) {
      const usage = pct(varbindToNumber(vb));
      if (usage === undefined || usage <= 0) continue;
      n += 1;
      out.push({ index: `hh3c-${suffix}`, description: `CPU ${n}`, usage });
    }
    const picked = choose(out);
    if (picked) return picked;
  } catch (err) {
    logger.debug({ err, deviceId }, 'HH3C-ENTITY-EXT-MIB processor read failed');
  }

  // 8) OLD-CISCO-CPU-MIB — scalar CPU percentage (legacy IOS/APs).
  try {
    const oc = await snmpGet(session, [OID.oldCiscoAvgBusy5]);
    const usage = pct(varbindToNumber(oc[0]));
    if (usage !== undefined) {
      const picked = choose([{ index: 'oldcisco-0', description: 'CPU', usage }]);
      if (picked) return picked;
    }
  } catch (err) {
    logger.debug({ err, deviceId }, 'OLD-CISCO-CPU-MIB processor read failed');
  }

  // 9) CISCOSB-MIB — per-unit CPU (Sx/CBS/Catalyst 1200-1300).
  try {
    const cpus = await snmpWalkColumn(session, OID.ciscosbCpuLastMinute);
    const out: DiscoveredProcessor[] = [];
    for (const [suffix, vb] of cpus) {
      const usage = pct(varbindToNumber(vb));
      if (usage === undefined) continue;
      out.push({ index: `sb-${suffix}`, description: cpus.size > 1 ? `CPU (unit ${suffix})` : 'CPU', usage });
    }
    const picked = choose(out);
    if (picked) return picked;
  } catch (err) {
    logger.debug({ err, deviceId }, 'CISCOSB-MIB processor read failed');
  }

  // 10) A3COM-HUAWEI-MIB — per-slot CPU (3Com/H3C Comware switches).
  try {
    const cpus = await snmpWalkColumn(session, OID.a3comCpuPer1Min);
    const out: DiscoveredProcessor[] = [];
    let n = 0;
    for (const [suffix, vb] of cpus) {
      const usage = pct(varbindToNumber(vb));
      if (usage === undefined) continue;
      n += 1;
      out.push({ index: `a3com-${suffix}`, description: `CPU ${n}`, usage });
    }
    const picked = choose(out);
    if (picked) return picked;
  } catch (err) {
    logger.debug({ err, deviceId }, 'A3COM-HUAWEI-MIB processor read failed');
  }

  // 11) HUAWEI VRP hwEntityCpuUsage — per-board CPU on Huawei switches/routers.
  try {
    const cpus = await snmpWalkColumn(session, OID.hwEntityCpuUsage);
    const out: DiscoveredProcessor[] = [];
    let n = 0;
    for (const [suffix, vb] of cpus) {
      const usage = pct(varbindToNumber(vb));
      if (usage === undefined) continue;
      n += 1;
      out.push({ index: `hw-${suffix}`, description: cpus.size > 1 ? `CPU ${n}` : 'CPU', usage });
    }
    const picked = choose(out);
    if (picked) return picked;
  } catch (err) {
    logger.debug({ err, deviceId }, 'HUAWEI processor read failed');
  }

  return allZeroFallback ?? [];
}

/**
 * Upserts discovered processors, prunes stale ones, and appends a utilisation sample
 * to each processor's time-series. Returns the device-wide aggregate (average) for
 * backward-compatible `Device.cpuUsage` / DeviceMetric, or undefined if none found.
 */
export async function pollProcessors(
  session: Session,
  deviceId: string,
  ctx?: ProcessorDeviceContext,
): Promise<{ avgUsage: number; count: number; processors: DiscoveredProcessor[] } | undefined> {
  const processors = await readProcessors(session, deviceId, ctx);
  if (processors.length === 0) return undefined;

  const now = new Date();
  const seen = new Set<string>();
  const dedupedProcessors: typeof processors = [];
  const upserts: ReturnType<typeof prisma.processor.upsert>[] = [];
  for (const p of processors) {
    if (seen.has(p.index)) continue;
    seen.add(p.index);
    dedupedProcessors.push(p);
    upserts.push(prisma.processor.upsert({
      where: { deviceId_index: { deviceId, index: p.index } },
      create: { deviceId, index: p.index, description: p.description, usage: p.usage, lastPolled: now },
      update: { description: p.description, usage: p.usage, lastPolled: now },
    }));
  }
  const rows = await prisma.$transaction(upserts);
  await prisma.processorMetric.createMany({
    data: rows.map((row, i) => ({ processorId: row.id, usage: dedupedProcessors[i].usage, timestamp: now })),
  });

  // Only prune a processor (and cascade-delete its whole ProcessorMetric history) once
  // it's been missing from discovery for a while — a single poll cycle where one SNMP
  // walk (e.g. jnxJsSPUMonitoringCPUUsage) times out or returns a partial table must not
  // wipe out an otherwise-healthy processor's trend graph.
  const staleCutoff = now.getTime() - STALE_PROCESSOR_GRACE_MS;
  const existing = await prisma.processor.findMany({ where: { deviceId }, select: { id: true, index: true, lastPolled: true } });
  const stale = existing
    .filter((e) => !seen.has(e.index) && (!e.lastPolled || e.lastPolled.getTime() < staleCutoff))
    .map((e) => e.id);
  if (stale.length > 0) await prisma.processor.deleteMany({ where: { id: { in: stale } } });

  const avg = processors.reduce((a, p) => a + p.usage, 0) / processors.length;
  return { avgUsage: Math.round(avg), count: processors.length, processors: dedupedProcessors };
}
