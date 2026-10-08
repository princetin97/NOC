import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { ENTITY_SENSOR_SCALE_FACTORS, ENTITY_SENSOR_TYPE_MAP, OID } from '../lib/mib-oids';
import { snmpGetSingle, snmpWalkColumn, snmpWalkSuffix, varbindToNumber, varbindToString } from '../lib/snmp';
import type { DiscoveredProcessor } from './processors';

type Session = Parameters<typeof snmpWalkColumn>[0];

export interface DiscoveredSensor {
  type: string; // temperature | fan | voltage | current | power | humidity | cpu | memory | disk | state
  index: string;
  description: string;
  value: number | null;
  unit: string;
  status: string; // ok | warning | critical | unknown
}

interface DeviceContext {
  vendor?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  // Already-polled per-CPU readings from processors.ts (same poll cycle). When present,
  // Juniper SPU/RE CPU sensors reuse these instead of re-walking the OID a second time,
  // so the alert-triggering value always matches the value shown on the Processor graph.
  processors?: DiscoveredProcessor[];
}

function isFortinet(ctx: DeviceContext): boolean {
  return ctx.vendor === 'Fortinet' || (ctx.sysObjectId?.startsWith('1.3.6.1.4.1.12356') ?? false);
}

function isJuniper(ctx: DeviceContext): boolean {
  return ctx.vendor === 'Juniper' || (ctx.sysObjectId?.startsWith('1.3.6.1.4.1.2636') ?? false);
}

function isHh3cFamily(ctx: DeviceContext): boolean {
  const vendor = (ctx.vendor ?? '').toLowerCase();
  const descr = (ctx.sysDescr ?? '').toLowerCase();
  const oid = ctx.sysObjectId ?? '';
  return (
    vendor === 'h3c' ||
    vendor === 'hpe' ||
    vendor === 'aruba' ||
    vendor === '3com' ||
    /officeconnect|comware|h3c/.test(descr) ||
    oid.startsWith('1.3.6.1.4.1.25506') ||
    oid.startsWith('1.3.6.1.4.1.43.') ||
    oid.startsWith('1.3.6.1.4.1.11.')
  );
}

function isPureStorage(ctx: DeviceContext): boolean {
  return ctx.vendor === 'Pure Storage' || (ctx.sysObjectId?.startsWith('1.3.6.1.4.1.40482') ?? false);
}

/** Cisco Small Business / Catalyst 1200/1300 run the CISCOSB (switch001) firmware. */
export function isCiscoSb(ctx: DeviceContext): boolean {
  const descr = ctx.sysDescr ?? '';
  if (/Catalyst 1[23]00 Series/i.test(descr)) return true;
  return ctx.sysObjectId?.startsWith('1.3.6.1.4.1.9.6.1.') ?? false;
}

/** ENTITY-SENSOR-MIB: standard temperature/voltage/current/power/fan sensors. */
async function readEntitySensors(session: Session): Promise<DiscoveredSensor[]> {
  const [types, scales, precisions, values, statuses, names, descrs] = await Promise.all([
    snmpWalkColumn(session, OID.entPhySensorType),
    snmpWalkColumn(session, OID.entPhySensorScale),
    snmpWalkColumn(session, OID.entPhySensorPrecision),
    snmpWalkColumn(session, OID.entPhySensorValue),
    snmpWalkColumn(session, OID.entPhySensorOperStatus),
    snmpWalkColumn(session, OID.entPhysicalName),
    snmpWalkColumn(session, OID.entPhysicalDescr),
  ]);

  const sensors: DiscoveredSensor[] = [];
  for (const [idx, typeVb] of types) {
    const map = ENTITY_SENSOR_TYPE_MAP[varbindToNumber(typeVb) ?? 0];
    if (!map) continue;
    const raw = varbindToNumber(values.get(idx));
    if (raw === undefined) continue;
    const scale = ENTITY_SENSOR_SCALE_FACTORS[varbindToNumber(scales.get(idx)) ?? 9] ?? 1;
    const precision = varbindToNumber(precisions.get(idx)) ?? 0;
    const value = (raw * scale) / 10 ** precision;
    const op = varbindToNumber(statuses.get(idx));
    const label = varbindToString(names.get(idx))?.trim() || varbindToString(descrs.get(idx))?.trim() || `${map.type} ${idx}`;
    sensors.push({
      type: map.type,
      index: `ent-${idx}`,
      description: label,
      value,
      unit: map.unit,
      status: op === 1 ? 'ok' : op === undefined ? 'unknown' : 'warning',
    });
  }
  return sensors;
}

const CISCO_ENVMON_STATE: Record<number, string> = { 1: 'ok', 2: 'warning', 3: 'critical', 4: 'critical', 5: 'unknown', 6: 'critical' };

/**
 * CISCO-ENTITY-SENSOR-MIB: Cisco's pre-standard clone of ENTITY-SENSOR-MIB (same column
 * layout, keyed by entPhysicalIndex). Many NX-OS platforms (Nexus/MDS) only implement
 * this, not the IETF version - confirmed live on a MDS 9148S which returns temperature
 * (type 8) plus voltage/current (type 4/5) entries here while the IETF table is empty.
 */
async function readCiscoEntitySensors(session: Session): Promise<DiscoveredSensor[]> {
  const [types, scales, precisions, values, statuses, names, descrs] = await Promise.all([
    snmpWalkColumn(session, OID.cetSensorType),
    snmpWalkColumn(session, OID.cetSensorScale),
    snmpWalkColumn(session, OID.cetSensorPrecision),
    snmpWalkColumn(session, OID.cetSensorValue),
    snmpWalkColumn(session, OID.cetSensorStatus),
    snmpWalkColumn(session, OID.entPhysicalName),
    snmpWalkColumn(session, OID.entPhysicalDescr),
  ]);

  const sensors: DiscoveredSensor[] = [];
  for (const [idx, typeVb] of types) {
    const map = ENTITY_SENSOR_TYPE_MAP[varbindToNumber(typeVb) ?? 0];
    if (!map) continue;
    const raw = varbindToNumber(values.get(idx));
    if (raw === undefined) continue;
    const scale = ENTITY_SENSOR_SCALE_FACTORS[varbindToNumber(scales.get(idx)) ?? 9] ?? 1;
    const precision = varbindToNumber(precisions.get(idx)) ?? 0;
    const value = (raw * scale) / 10 ** precision;
    const op = varbindToNumber(statuses.get(idx));
    const label = varbindToString(names.get(idx))?.trim() || varbindToString(descrs.get(idx))?.trim() || `${map.type} ${idx}`;
    sensors.push({
      type: map.type,
      index: `cet-${idx}`,
      description: label,
      value,
      unit: map.unit,
      status: op === 1 ? 'ok' : op === undefined ? 'unknown' : 'warning',
    });
  }
  return sensors;
}

/**
 * CISCO-ENVMON-MIB: temperature/fan/PSU status tables. Widely implemented by Cisco
 * chassis/fixed-config switches and routers (including NX-OS Nexus/MDS) that predate
 * or don't expose ENTITY-SENSOR-MIB, used as a fallback when that source is empty.
 */
async function readCiscoEnvMonSensors(session: Session): Promise<DiscoveredSensor[]> {
  const sensors: DiscoveredSensor[] = [];
  const [tempDescrs, temps, fanDescrs, fanStates, supplyDescrs, supplyStates] = await Promise.all([
    snmpWalkColumn(session, OID.ciscoEnvMonTemperatureStatusDescr),
    snmpWalkColumn(session, OID.ciscoEnvMonTemperatureStatusValue),
    snmpWalkColumn(session, OID.ciscoEnvMonFanStatusDescr),
    snmpWalkColumn(session, OID.ciscoEnvMonFanState),
    snmpWalkColumn(session, OID.ciscoEnvMonSupplyStatusDescr),
    snmpWalkColumn(session, OID.ciscoEnvMonSupplyState),
  ]);

  for (const [idx, vb] of temps) {
    const t = varbindToNumber(vb);
    if (t === undefined || t <= 0) continue;
    const descr = varbindToString(tempDescrs.get(idx))?.trim() || `Temperature ${idx}`;
    sensors.push({ type: 'temperature', index: `envmon-temp-${idx}`, description: descr, value: t, unit: '°C', status: 'ok' });
  }
  for (const [idx, vb] of fanStates) {
    const state = varbindToNumber(vb);
    if (state === undefined) continue;
    const descr = varbindToString(fanDescrs.get(idx))?.trim() || `Fan ${idx}`;
    sensors.push({ type: 'fan', index: `envmon-fan-${idx}`, description: descr, value: state, unit: '', status: CISCO_ENVMON_STATE[state] ?? 'unknown' });
  }
  for (const [idx, vb] of supplyStates) {
    const state = varbindToNumber(vb);
    if (state === undefined) continue;
    const descr = varbindToString(supplyDescrs.get(idx))?.trim() || `Power Supply ${idx}`;
    sensors.push({ type: 'power', index: `envmon-psu-${idx}`, description: descr, value: state, unit: '', status: CISCO_ENVMON_STATE[state] ?? 'unknown' });
  }
  return sensors;
}

const CEFC_FAN_STATUS: Record<number, string> = { 1: 'unknown', 2: 'ok', 3: 'critical', 4: 'warning' };

/**
 * CISCO-ENTITY-FRU-CONTROL-MIB: discrete fan-tray / power-supply operational status,
 * used on chassis platforms (Nexus, MDS, Catalyst 6500+) as a supplement/fallback to
 * CISCO-ENVMON-MIB (some of these only expose FRU-control, not ENVMON, for hardware state).
 */
async function readCiscoFruSensors(session: Session): Promise<DiscoveredSensor[]> {
  const [names, fanStatus, psuStatus] = await Promise.all([
    snmpWalkColumn(session, OID.entPhysicalName),
    snmpWalkColumn(session, OID.cefcFanTrayOperStatus),
    snmpWalkColumn(session, OID.cefcFRUPowerOperStatus),
  ]);

  const sensors: DiscoveredSensor[] = [];
  for (const [idx, vb] of fanStatus) {
    const status = varbindToNumber(vb);
    if (status === undefined) continue;
    const descr = varbindToString(names.get(idx))?.trim() || `Fan Tray ${idx}`;
    sensors.push({ type: 'fan', index: `cefc-fan-${idx}`, description: descr, value: status, unit: '', status: CEFC_FAN_STATUS[status] ?? 'unknown' });
  }
  for (const [idx, vb] of psuStatus) {
    const status = varbindToNumber(vb);
    if (status === undefined) continue;
    const descr = varbindToString(names.get(idx))?.trim() || `Power Supply ${idx}`;
    sensors.push({ type: 'power', index: `cefc-psu-${idx}`, description: descr, value: status, unit: '', status: status === 2 ? 'ok' : 'critical' });
  }
  return sensors;
}


function classifyFortiSensor(name: string): { type: string; unit: string } {
  if (/fan/i.test(name)) return { type: 'fan', unit: 'rpm' };
  if (/(temp|\btmp\b|thermal)/i.test(name)) return { type: 'temperature', unit: '°C' };
  if (/(?:volt|vcc|vin|vout|\b\d+v\b)/i.test(name)) return { type: 'voltage', unit: 'V' };
  if (/current|amp/i.test(name)) return { type: 'current', unit: 'A' };
  if (/power|watt/i.test(name)) return { type: 'power', unit: 'W' };
  return { type: 'state', unit: '' };
}

/** FORTINET-FORTIGATE-MIB fgHwSensorTable: fans, temperature, voltage sensors. */
async function readFortiSensors(session: Session): Promise<DiscoveredSensor[]> {
  const [names, values, alarms] = await Promise.all([
    snmpWalkColumn(session, OID.fgHwSensorEntName),
    snmpWalkColumn(session, OID.fgHwSensorEntValue),
    snmpWalkColumn(session, OID.fgHwSensorEntAlarmStatus),
  ]);

  const sensors: DiscoveredSensor[] = [];
  for (const [idx, nameVb] of names) {
    const name = varbindToString(nameVb)?.trim();
    if (!name) continue;
    const { type, unit } = classifyFortiSensor(name);
    sensors.push({
      type,
      index: `fg-${idx}`,
      description: name,
      value: varbindToNumber(values.get(idx)) ?? null,
      unit,
      status: varbindToNumber(alarms.get(idx)) === 1 ? 'critical' : 'ok',
    });
  }
  return sensors;
}

function decodeFortiHaSyncStatus(code: number | undefined): { label: string; status: string } {
  if (code === 1) return { label: 'Synchronized', status: 'ok' };
  if (code === 2) return { label: 'Unsynchronized', status: 'critical' };
  if (code === 3) return { label: 'In Progress', status: 'warning' };
  return { label: 'Unknown', status: 'unknown' };
}

/**
 * FORTINET-FORTIGATE-MIB fgHaStatsTable: per-member HA sync state (PRTG parity).
 * Emits one sensor per HA node so alerts can target a specific cluster member.
 */
async function readFortiHaSensors(session: Session): Promise<DiscoveredSensor[]> {
  const [serials, hostnames, syncStatuses] = await Promise.all([
    snmpWalkColumn(session, OID.fgHaStatsSerial),
    snmpWalkColumn(session, OID.fgHaStatsHostname),
    snmpWalkColumn(session, OID.fgHaStatsSyncStatus),
  ]);

  const sensors: DiscoveredSensor[] = [];
  const indexes = new Set<number>([...serials.keys(), ...hostnames.keys(), ...syncStatuses.keys()]);
  for (const idx of indexes) {
    const serial = varbindToString(serials.get(idx))?.trim();
    const hostname = varbindToString(hostnames.get(idx))?.trim();
    const syncRaw = varbindToNumber(syncStatuses.get(idx));
    if (syncRaw === undefined && !serial && !hostname) continue;

    const memberLabel = serial || hostname || `member-${idx}`;
    const sync = decodeFortiHaSyncStatus(syncRaw);
    sensors.push({
      type: 'ha_member_sync',
      index: `fg-ha-sync-${idx}`,
      description: `FortiGate HA Member: ${memberLabel} (Sync: ${sync.label})`,
      value: syncRaw ?? null,
      unit: '',
      status: sync.status,
    });
  }

  return sensors;
}

/** JUNIPER-MIB jnxOperatingTable + SRX SPU monitoring: per-component temp/CPU/memory. */
async function readJuniperSensors(session: Session, processors?: DiscoveredProcessor[]): Promise<DiscoveredSensor[]> {
  const sensors: DiscoveredSensor[] = [];
  const [descrs, temps, buffers] = await Promise.all([
    snmpWalkSuffix(session, OID.jnxOperatingDescr),
    snmpWalkSuffix(session, OID.jnxOperatingTemp),
    snmpWalkSuffix(session, OID.jnxOperatingBuffer),
  ]);
  // Reuse the CPU % already read this poll cycle by processors.ts (same jnxOperatingCPU /
  // jnxJsSPUMonitoringCPUUsage OIDs) instead of re-walking them here. A second, later walk
  // in the same poll can catch a burst load moment the Processor graph didn't, making the
  // sensor-driven alert value disagree with the graph even though nothing is actually wrong.
  const cpuByIndex = new Map((processors ?? []).map((p) => [p.index, p.usage]));

  for (const [suffix, descrVb] of descrs) {
    const descr = varbindToString(descrVb)?.trim();
    if (!descr) continue;
    const temp = varbindToNumber(temps.get(suffix));
    if (temp && temp > 0) {
      sensors.push({ type: 'temperature', index: `jnx-temp-${suffix}`, description: `${descr} Temperature`, value: temp, unit: '°C', status: 'ok' });
    }
    // CPU/memory are only meaningful for Routing Engines, not fans/sensors.
    if (!/fan|sensor|power|psu/i.test(descr)) {
      const cpu = cpuByIndex.get(`jnx-${suffix}`);
      if (cpu !== undefined && cpu > 0) {
        sensors.push({ type: 'cpu', index: `jnx-cpu-${suffix}`, description: `${descr} CPU`, value: cpu, unit: '%', status: 'ok' });
      }
      const buffer = varbindToNumber(buffers.get(suffix));
      if (buffer && buffer > 0) {
        sensors.push({ type: 'memory', index: `jnx-mem-${suffix}`, description: `${descr} Memory`, value: buffer, unit: '%', status: 'ok' });
      }
    }
  }

  const spuMem = await snmpWalkSuffix(session, OID.jnxJsSPUMonitoringMemoryUsage);
  for (const [index, cpu] of cpuByIndex) {
    if (!index.startsWith('spu-')) continue;
    const suffix = index.slice('spu-'.length);
    sensors.push({ type: 'cpu', index: `spu-cpu-${suffix}`, description: `SPU ${suffix} CPU`, value: cpu, unit: '%', status: 'ok' });
  }
  for (const [suffix, vb] of spuMem) {
    const mem = varbindToNumber(vb);
    if (mem !== undefined) sensors.push({ type: 'memory', index: `spu-mem-${suffix}`, description: `SPU ${suffix} Memory`, value: mem, unit: '%', status: 'ok' });
  }
  return sensors;
}

/** CISCOSB rlEnv* tables: temperature, fan speed, per-unit CPU (Sx/CBS/Catalyst 1200-1300). */
async function readCiscoSbSensors(session: Session): Promise<DiscoveredSensor[]> {
  const [temps, fans, cpus] = await Promise.all([
    snmpWalkColumn(session, OID.ciscosbEnvTemp),
    snmpWalkColumn(session, OID.ciscosbEnvFanSpeed),
    snmpWalkColumn(session, OID.ciscosbCpuLastMinute),
  ]);

  const sensors: DiscoveredSensor[] = [];
  for (const [idx, vb] of temps) {
    const t = varbindToNumber(vb);
    if (t && t > 0) sensors.push({ type: 'temperature', index: `sb-temp-${idx}`, description: `Temperature (unit ${idx})`, value: t, unit: '°C', status: 'ok' });
  }
  for (const [idx, vb] of fans) {
    const s = varbindToNumber(vb);
    if (s && s > 0) sensors.push({ type: 'fan', index: `sb-fan-${idx}`, description: `Fan ${idx}`, value: s, unit: 'rpm', status: 'ok' });
  }
  for (const [idx, vb] of cpus) {
    const c = varbindToNumber(vb);
    if (c !== undefined) sensors.push({ type: 'cpu', index: `sb-cpu-${idx}`, description: `CPU (unit ${idx})`, value: c, unit: '%', status: 'ok' });
  }
  return sensors;
}

/** HH3C-ENTITY-EXT-MIB: temperature and per-slot CPU/memory usage on Comware/HPE/3Com. */
async function readHh3cSensors(session: Session): Promise<DiscoveredSensor[]> {
  const [temps, cpus, mems] = await Promise.all([
    snmpWalkColumn(session, OID.hh3cEntityExtTemperature),
    snmpWalkColumn(session, OID.hh3cEntityExtCpuUsage),
    snmpWalkColumn(session, OID.hh3cEntityExtMemUsage),
  ]);

  const sensors: DiscoveredSensor[] = [];
  for (const [idx, vb] of temps) {
    const value = varbindToNumber(vb);
    if (value === undefined || value <= 0 || value > 120) continue;
    sensors.push({
      type: 'temperature',
      index: `hh3c-temp-${idx}`,
      description: `Temperature ${idx}`,
      value,
      unit: '°C',
      status: value > 80 ? 'critical' : value > 65 ? 'warning' : 'ok',
    });
  }
  for (const [idx, vb] of cpus) {
    const value = varbindToNumber(vb);
    if (value === undefined || value <= 0 || value > 100) continue;
    sensors.push({
      type: 'cpu',
      index: `hh3c-cpu-${idx}`,
      description: `CPU ${idx}`,
      value,
      unit: '%',
      status: value > 90 ? 'critical' : value > 80 ? 'warning' : 'ok',
    });
  }
  for (const [idx, vb] of mems) {
    const value = varbindToNumber(vb);
    if (value === undefined || value <= 0 || value > 100) continue;
    sensors.push({
      type: 'memory',
      index: `hh3c-mem-${idx}`,
      description: `Memory ${idx}`,
      value,
      unit: '%',
      status: value > 90 ? 'critical' : value > 80 ? 'warning' : 'ok',
    });
  }

  return sensors;
}

/** PURESTORAGE-MIB: array-level bandwidth/IOPS/latency scalars for FlashArray. */
async function readPureStorageSensors(session: Session): Promise<DiscoveredSensor[]> {
  const [
    productNameVb,
    productVersionVb,
    hostVb,
    readBwVb,
    writeBwVb,
    readIopsVb,
    writeIopsVb,
    readLatencyVb,
    writeLatencyVb,
  ] = await Promise.all([
    snmpGetSingle(session, OID.pureProductName),
    snmpGetSingle(session, OID.pureProductVersion),
    snmpGetSingle(session, OID.pureHost),
    snmpGetSingle(session, OID.pureArrayReadBandwidth),
    snmpGetSingle(session, OID.pureArrayWriteBandwidth),
    snmpGetSingle(session, OID.pureArrayReadIOPS),
    snmpGetSingle(session, OID.pureArrayWriteIOPS),
    snmpGetSingle(session, OID.pureArrayReadLatency),
    snmpGetSingle(session, OID.pureArrayWriteLatency),
  ]);

  const sensors: DiscoveredSensor[] = [];
  const readBw = varbindToNumber(readBwVb);
  const writeBw = varbindToNumber(writeBwVb);
  const readIops = varbindToNumber(readIopsVb);
  const writeIops = varbindToNumber(writeIopsVb);
  const readLatency = varbindToNumber(readLatencyVb);
  const writeLatency = varbindToNumber(writeLatencyVb);

  if (readBw !== undefined) {
    sensors.push({
      type: 'power',
      index: 'pure-read-bandwidth',
      description: 'Pure Array Read Bandwidth',
      value: Math.round((readBw / 1_000_000) * 100) / 100,
      unit: 'MB/s',
      status: 'ok',
    });
  }
  if (writeBw !== undefined) {
    sensors.push({
      type: 'power',
      index: 'pure-write-bandwidth',
      description: 'Pure Array Write Bandwidth',
      value: Math.round((writeBw / 1_000_000) * 100) / 100,
      unit: 'MB/s',
      status: 'ok',
    });
  }
  if (readIops !== undefined) {
    sensors.push({ type: 'state', index: 'pure-read-iops', description: 'Pure Array Read IOPS', value: readIops, unit: 'IOPS', status: 'ok' });
  }
  if (writeIops !== undefined) {
    sensors.push({ type: 'state', index: 'pure-write-iops', description: 'Pure Array Write IOPS', value: writeIops, unit: 'IOPS', status: 'ok' });
  }
  if (readLatency !== undefined) {
    sensors.push({
      type: 'temperature',
      index: 'pure-read-latency',
      description: 'Pure Array Read Latency',
      value: Math.round((readLatency / 1000) * 1000) / 1000,
      unit: 'ms/op',
      status: 'ok',
    });
  }
  if (writeLatency !== undefined) {
    sensors.push({
      type: 'temperature',
      index: 'pure-write-latency',
      description: 'Pure Array Write Latency',
      value: Math.round((writeLatency / 1000) * 1000) / 1000,
      unit: 'ms/op',
      status: 'ok',
    });
  }

  const productName = varbindToString(productNameVb)?.trim();
  const productVersion = varbindToString(productVersionVb)?.trim();
  const host = varbindToString(hostVb)?.trim();
  if (productName || productVersion || host) {
    sensors.push({
      type: 'state',
      index: 'pure-identity',
      description: [productName, productVersion, host].filter(Boolean).join(' | '),
      value: null,
      unit: '',
      status: 'ok',
    });
  }

  return sensors;
}

const HR_STORAGE_FIXED_DISK = '1.3.6.1.2.1.25.2.1.4';
const HR_STORAGE_VIRTUAL_MEMORY = '1.3.6.1.2.1.25.2.1.3'; // Windows "Virtual Memory" / swap

function mountCandidatesFromDescr(descr: string): string[] {
  const trimmed = descr.trim();
  const candidates = new Set<string>();
  if (trimmed) candidates.add(trimmed);
  // Many agents keep the mountpoint at the beginning, e.g. "/data" or "/data (/dev/mapper/...)".
  const firstPath = trimmed.match(/\/[A-Za-z0-9._\-\/]+/);
  if (firstPath?.[0]) candidates.add(firstPath[0]);
  return Array.from(candidates);
}

async function readHrStorageRowsByGet(
  session: Session,
  maxIndex = 32,
): Promise<Array<{ index: number; type: string; descr: string; size?: number; used?: number }>> {
  const rows: Array<{ index: number; type: string; descr: string; size?: number; used?: number }> = [];
  let misses = 0;

  for (let idx = 1; idx <= maxIndex; idx += 1) {
    const type = varbindToString(await snmpGetSingle(session, `${OID.hrStorageType}.${idx}`));
    if (!type) {
      misses += 1;
      if (rows.length > 0 && misses >= 4) break;
      continue;
    }

    misses = 0;
    rows.push({
      index: idx,
      type,
      descr: varbindToString(await snmpGetSingle(session, `${OID.hrStorageDescr}.${idx}`)) ?? `Storage ${idx}`,
      size: varbindToNumber(await snmpGetSingle(session, `${OID.hrStorageSize}.${idx}`)),
      used: varbindToNumber(await snmpGetSingle(session, `${OID.hrStorageUsed}.${idx}`)),
    });
  }

  return rows;
}

/** HOST-RESOURCES-MIB hrStorageTable: fixed-disk usage (Junos RE storage, Linux, appliances). */
async function readStorageSensors(session: Session): Promise<DiscoveredSensor[]> {
  type Row = { idx: number; storageType: string; descr: string; size?: number; used?: number };
  let rows: Row[] = [];

  try {
    const [storageTypes, descrs, sizes, useds] = await Promise.all([
      snmpWalkColumn(session, OID.hrStorageType),
      snmpWalkColumn(session, OID.hrStorageDescr),
      snmpWalkColumn(session, OID.hrStorageSize),
      snmpWalkColumn(session, OID.hrStorageUsed),
    ]);

    rows = Array.from(storageTypes.keys()).map((idx) => ({
      idx,
      storageType: varbindToString(storageTypes.get(idx)) ?? '',
      descr: varbindToString(descrs.get(idx))?.trim() || `Disk ${idx}`,
      size: varbindToNumber(sizes.get(idx)),
      used: varbindToNumber(useds.get(idx)),
    }));
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    const byGet = await readHrStorageRowsByGet(session);
    rows = byGet.map((r) => ({
      idx: r.index,
      storageType: r.type,
      descr: r.descr,
      size: r.size,
      used: r.used,
    }));
  }

  let dskPercentByPath = new Map<string, number>();
  try {
    const [dskPaths, dskPercents] = await Promise.all([
      snmpWalkColumn(session, OID.ucdDskPath),
      snmpWalkColumn(session, OID.ucdDskPercent),
    ]);
    for (const [idx, pathVb] of dskPaths) {
      const path = varbindToString(pathVb)?.trim();
      const percent = varbindToNumber(dskPercents.get(idx));
      if (!path || percent === undefined) continue;
      if (percent < 0 || percent > 100) continue;
      dskPercentByPath.set(path, percent);
    }
  } catch {
    // UCD-SNMP disk table is optional; HOST-RESOURCES fallback keeps compatibility.
  }

  const sensors: DiscoveredSensor[] = [];
  for (const row of rows) {
    const storageType = row.storageType;
    const size = row.size;
    const used = row.used;
    if (storageType === HR_STORAGE_FIXED_DISK) {
      if (!size || used === undefined) continue;
      const descr = row.descr || 'Disk';
      const ucdPercent = mountCandidatesFromDescr(descr)
        .map((c) => dskPercentByPath.get(c))
        .find((v): v is number => v !== undefined);
      // Prefer dskPercent (matches Linux `df` semantics including reserved blocks),
      // fall back to hrStorageUsed/hrStorageSize for non-UCD agents.
      const percent = ucdPercent ?? Math.min(100, Math.round((used / size) * 1000) / 10);
      sensors.push({ type: 'disk', index: `hr-${row.idx}`, description: descr, value: percent, unit: '%', status: percent > 90 ? 'warning' : 'ok' });
    } else if (storageType === HR_STORAGE_VIRTUAL_MEMORY) {
      // Windows pagefile / Unix swap — shown as a separate "memory" gauge like LibreNMS.
      if (!size || used === undefined) continue;
      const percent = Math.min(100, Math.round((used / size) * 1000) / 10);
      const descr = row.descr || 'Bộ nhớ ảo';
      sensors.push({ type: 'memory', index: `hr-swap-${row.idx}`, description: descr, value: percent, unit: '%', status: percent > 90 ? 'critical' : percent > 75 ? 'warning' : 'ok' });
    }
  }
  return sensors;
}

const UPS_BATTERY_STATUS: Record<number, string> = { 1: 'unknown', 2: 'ok', 3: 'warning', 4: 'critical' };

/**
 * UPS-MIB (RFC 1628) health: battery charge / voltage / temperature / runtime plus input
 * and output line readings. Implemented by APC, Eaton, Vertiv, CyberPower and most SNMP UPS
 * cards, so it is attempted for every device and simply returns nothing when absent
 * (mirrors LibreNMS's standard ups-mib module).
 */
async function readUpsSensors(session: Session): Promise<DiscoveredSensor[]> {
  const sensors: DiscoveredSensor[] = [];
  // Probe each scalar individually: SNMPv1 UPS cards fail the whole PDU when one
  // requested OID is unimplemented, so a batched get would return nothing at all.
  const [batStatVb, chargeVb, minVb, secVb, batVoltVb, batTempVb, outSrcVb, outFreqVb] = await Promise.all([
    snmpGetSingle(session, OID.upsBatteryStatus),
    snmpGetSingle(session, OID.upsEstimatedChargeRemaining),
    snmpGetSingle(session, OID.upsEstimatedMinutesRemaining),
    snmpGetSingle(session, OID.upsSecondsOnBattery),
    snmpGetSingle(session, OID.upsBatteryVoltage),
    snmpGetSingle(session, OID.upsBatteryTemperature),
    snmpGetSingle(session, OID.upsOutputSource),
    snmpGetSingle(session, OID.upsOutputFrequency),
  ]);

  const batteryStatus = varbindToNumber(batStatVb);
  const charge = varbindToNumber(chargeVb);
  const minutesLeft = varbindToNumber(minVb);
  const secondsOnBattery = varbindToNumber(secVb);
  const batteryVoltage = varbindToNumber(batVoltVb);
  const batteryTemp = varbindToNumber(batTempVb);
  const outputSource = varbindToNumber(outSrcVb);
  const outputFreq = varbindToNumber(outFreqVb);

  // If none of the core UPS scalars responded, this is not an RFC 1628 UPS.
  if (batteryStatus === undefined && charge === undefined && batteryVoltage === undefined && outputSource === undefined) {
    return sensors;
  }

  const batteryStatusLabel = UPS_BATTERY_STATUS[batteryStatus ?? 1] ?? 'unknown';
  const onBattery = (secondsOnBattery ?? 0) > 0;

  if (charge !== undefined) {
    sensors.push({ type: 'battery', index: 'ups-charge', description: 'Dung lượng pin còn lại', value: charge, unit: '%', status: charge < 20 ? 'critical' : charge < 50 ? 'warning' : batteryStatusLabel });
  }
  if (minutesLeft !== undefined) {
    sensors.push({ type: 'runtime', index: 'ups-runtime', description: 'Thời gian pin còn lại', value: minutesLeft, unit: 'phút', status: minutesLeft < 5 ? 'critical' : minutesLeft < 15 ? 'warning' : 'ok' });
  }
  if (batteryVoltage !== undefined) {
    sensors.push({ type: 'voltage', index: 'ups-batt-voltage', description: 'Điện áp ắc quy', value: batteryVoltage / 10, unit: 'V', status: 'ok' });
  }
  if (batteryTemp !== undefined && batteryTemp > 0) {
    sensors.push({ type: 'temperature', index: 'ups-batt-temp', description: 'Nhiệt độ ắc quy', value: batteryTemp, unit: '°C', status: batteryTemp > 45 ? 'warning' : 'ok' });
  }
  // Discrete power-source indicator (utility vs. running on battery).
  sensors.push({
    type: 'state',
    index: 'ups-batt-status',
    description: onBattery ? 'Nguồn: Đang chạy ắc quy' : 'Nguồn: Điện lưới',
    value: null,
    unit: '',
    status: onBattery ? 'warning' : batteryStatusLabel,
  });
  if (outputFreq !== undefined && outputFreq > 0) {
    sensors.push({ type: 'frequency', index: 'ups-out-freq', description: 'Tần số ngõ ra', value: outputFreq / 10, unit: 'Hz', status: 'ok' });
  }

  // Output lines: voltage / current / power / percent load.
  const [outVolt, outCurr, outPower, outLoad] = await Promise.all([
    snmpWalkColumn(session, OID.upsOutputVoltage),
    snmpWalkColumn(session, OID.upsOutputCurrent),
    snmpWalkColumn(session, OID.upsOutputPower),
    snmpWalkColumn(session, OID.upsOutputPercentLoad),
  ]);
  const multiOut = outVolt.size > 1 || outLoad.size > 1;
  for (const idx of new Set([...outVolt.keys(), ...outLoad.keys(), ...outPower.keys(), ...outCurr.keys()])) {
    const tag = multiOut ? ` L${idx}` : '';
    const v = varbindToNumber(outVolt.get(idx));
    if (v !== undefined) sensors.push({ type: 'voltage', index: `ups-out-v-${idx}`, description: `Điện áp ngõ ra${tag}`, value: v, unit: 'V', status: 'ok' });
    const load = varbindToNumber(outLoad.get(idx));
    if (load !== undefined) sensors.push({ type: 'load', index: `ups-out-load-${idx}`, description: `Tải ngõ ra${tag}`, value: load, unit: '%', status: load > 90 ? 'critical' : load > 75 ? 'warning' : 'ok' });
    const p = varbindToNumber(outPower.get(idx));
    if (p !== undefined) sensors.push({ type: 'power', index: `ups-out-p-${idx}`, description: `Công suất ngõ ra${tag}`, value: p, unit: 'W', status: 'ok' });
    const c = varbindToNumber(outCurr.get(idx));
    if (c !== undefined) sensors.push({ type: 'current', index: `ups-out-c-${idx}`, description: `Dòng ngõ ra${tag}`, value: c / 10, unit: 'A', status: 'ok' });
  }

  // Input lines: voltage / frequency / current.
  const [inVolt, inFreq, inCurr] = await Promise.all([
    snmpWalkColumn(session, OID.upsInputVoltage),
    snmpWalkColumn(session, OID.upsInputFrequency),
    snmpWalkColumn(session, OID.upsInputCurrent),
  ]);
  const multiIn = inVolt.size > 1;
  for (const idx of new Set([...inVolt.keys(), ...inCurr.keys(), ...inFreq.keys()])) {
    const tag = multiIn ? ` L${idx}` : '';
    const v = varbindToNumber(inVolt.get(idx));
    if (v !== undefined) sensors.push({ type: 'voltage', index: `ups-in-v-${idx}`, description: `Điện áp ngõ vào${tag}`, value: v, unit: 'V', status: v < 180 || v > 260 ? 'warning' : 'ok' });
    const f = varbindToNumber(inFreq.get(idx));
    if (f !== undefined && f > 0) sensors.push({ type: 'frequency', index: `ups-in-freq-${idx}`, description: `Tần số ngõ vào${tag}`, value: f / 10, unit: 'Hz', status: 'ok' });
    const c = varbindToNumber(inCurr.get(idx));
    if (c !== undefined) sensors.push({ type: 'current', index: `ups-in-c-${idx}`, description: `Dòng ngõ vào${tag}`, value: c / 10, unit: 'A', status: 'ok' });
  }

  return sensors;
}

const APC_OUTPUT_ON_BATTERY = 3;

/**
 * APC PowerNet-MIB (.1.3.6.1.4.1.318) UPS health. Fallback for APC/Schneider Smart-UPS
 * cards that expose only PowerNet (not RFC 1628). All reads are individual so a partial
 * or SNMPv1 card still returns whatever it supports.
 */
async function readApcSensors(session: Session): Promise<DiscoveredSensor[]> {
  const sensors: DiscoveredSensor[] = [];
  const [capVb, runVb, battTempVb, battVoltVb, outStatVb, inVoltVb, inFreqVb, outVoltVb, outFreqVb, loadVb, outCurrVb] =
    await Promise.all([
      snmpGetSingle(session, OID.apcBatteryCapacity),
      snmpGetSingle(session, OID.apcBatteryRunTimeRemaining),
      snmpGetSingle(session, OID.apcBatteryTemperature),
      snmpGetSingle(session, OID.apcBatteryVoltage),
      snmpGetSingle(session, OID.apcOutputStatus),
      snmpGetSingle(session, OID.apcInputVoltage),
      snmpGetSingle(session, OID.apcInputFrequency),
      snmpGetSingle(session, OID.apcOutputVoltage),
      snmpGetSingle(session, OID.apcOutputFrequency),
      snmpGetSingle(session, OID.apcOutputLoad),
      snmpGetSingle(session, OID.apcOutputCurrent),
    ]);

  const capacity = varbindToNumber(capVb);
  const outputStatus = varbindToNumber(outStatVb);
  // Nothing responded → not an APC UPS.
  if (capacity === undefined && outputStatus === undefined && varbindToNumber(outVoltVb) === undefined) {
    return sensors;
  }

  const onBattery = outputStatus === APC_OUTPUT_ON_BATTERY;
  if (capacity !== undefined) {
    sensors.push({ type: 'battery', index: 'apc-charge', description: 'Dung lượng pin còn lại', value: capacity, unit: '%', status: capacity < 20 ? 'critical' : capacity < 50 ? 'warning' : 'ok' });
  }
  const runTicks = varbindToNumber(runVb); // TimeTicks in 1/100 s → minutes
  if (runTicks !== undefined) {
    const minutes = Math.round(runTicks / 6000);
    sensors.push({ type: 'runtime', index: 'apc-runtime', description: 'Thời gian pin còn lại', value: minutes, unit: 'phút', status: minutes < 5 ? 'critical' : minutes < 15 ? 'warning' : 'ok' });
  }
  const battTemp = varbindToNumber(battTempVb);
  if (battTemp !== undefined && battTemp > 0) {
    sensors.push({ type: 'temperature', index: 'apc-batt-temp', description: 'Nhiệt độ ắc quy', value: battTemp, unit: '°C', status: battTemp > 45 ? 'warning' : 'ok' });
  }
  const battVolt = varbindToNumber(battVoltVb);
  if (battVolt !== undefined) {
    sensors.push({ type: 'voltage', index: 'apc-batt-voltage', description: 'Điện áp ắc quy', value: battVolt, unit: 'V', status: 'ok' });
  }
  sensors.push({ type: 'state', index: 'apc-status', description: onBattery ? 'Nguồn: Đang chạy ắc quy' : 'Nguồn: Điện lưới', value: null, unit: '', status: onBattery ? 'warning' : 'ok' });
  const inVolt = varbindToNumber(inVoltVb);
  if (inVolt !== undefined) sensors.push({ type: 'voltage', index: 'apc-in-v', description: 'Điện áp ngõ vào', value: inVolt, unit: 'V', status: inVolt < 180 || inVolt > 260 ? 'warning' : 'ok' });
  const inFreq = varbindToNumber(inFreqVb);
  if (inFreq !== undefined && inFreq > 0) sensors.push({ type: 'frequency', index: 'apc-in-freq', description: 'Tần số ngõ vào', value: inFreq, unit: 'Hz', status: 'ok' });
  const outVolt = varbindToNumber(outVoltVb);
  if (outVolt !== undefined) sensors.push({ type: 'voltage', index: 'apc-out-v', description: 'Điện áp ngõ ra', value: outVolt, unit: 'V', status: 'ok' });
  const outFreq = varbindToNumber(outFreqVb);
  if (outFreq !== undefined && outFreq > 0) sensors.push({ type: 'frequency', index: 'apc-out-freq', description: 'Tần số ngõ ra', value: outFreq, unit: 'Hz', status: 'ok' });
  const load = varbindToNumber(loadVb);
  if (load !== undefined) sensors.push({ type: 'load', index: 'apc-out-load', description: 'Tải ngõ ra', value: load, unit: '%', status: load > 90 ? 'critical' : load > 75 ? 'warning' : 'ok' });
  const outCurr = varbindToNumber(outCurrVb);
  if (outCurr !== undefined) sensors.push({ type: 'current', index: 'apc-out-c', description: 'Dòng ngõ ra', value: outCurr, unit: 'A', status: 'ok' });

  return sensors;
}

/**
 * DELL iDRAC / OpenManage (IDRAC-MIB-SMIv2) hardware health: temperature, fan, PSU and
 * voltage probes. Values are index-aligned with their location/name columns. Self-noops
 * (returns []) when the device is not a Dell server exposing these tables.
 */
async function readDellSensors(session: Session): Promise<DiscoveredSensor[]> {
  const sensors: DiscoveredSensor[] = [];
  const [temps, tempNames, fans, fanNames, psus, psuNames, volts, voltNames] = await Promise.all([
    snmpWalkColumn(session, OID.dellTempReading),
    snmpWalkColumn(session, OID.dellTempLocation),
    snmpWalkColumn(session, OID.dellFanReading),
    snmpWalkColumn(session, OID.dellFanLocation),
    snmpWalkColumn(session, OID.dellPsuWattage),
    snmpWalkColumn(session, OID.dellPsuLocation),
    snmpWalkColumn(session, OID.dellVoltReading),
    snmpWalkColumn(session, OID.dellVoltLocation),
  ]);

  for (const [i, vb] of temps) {
    const raw = varbindToNumber(vb);
    if (raw === undefined) continue;
    const c = raw / 10; // tenths °C
    if (c <= 0 || c > 150) continue;
    const name = varbindToString(tempNames.get(i)) || `Cảm biến nhiệt ${i}`;
    sensors.push({ type: 'temperature', index: `dell-temp-${i}`, description: name, value: Math.round(c * 10) / 10, unit: '°C', status: c > 75 ? 'critical' : c > 60 ? 'warning' : 'ok' });
  }
  for (const [i, vb] of fans) {
    const rpm = varbindToNumber(vb);
    if (rpm === undefined || rpm <= 0 || rpm > 60000) continue;
    const name = varbindToString(fanNames.get(i)) || `Quạt ${i}`;
    sensors.push({ type: 'fan', index: `dell-fan-${i}`, description: name, value: Math.round(rpm), unit: 'RPM', status: 'ok' });
  }
  for (const [i, vb] of psus) {
    const raw = varbindToNumber(vb);
    if (raw === undefined) continue;
    const w = raw / 10; // tenths W
    if (w <= 0 || w > 20000) continue;
    const name = varbindToString(psuNames.get(i)) || `Nguồn ${i}`;
    sensors.push({ type: 'power', index: `dell-psu-${i}`, description: name, value: Math.round(w), unit: 'W', status: 'ok' });
  }
  for (const [i, vb] of volts) {
    const raw = varbindToNumber(vb);
    if (raw === undefined) continue;
    const v = raw / 1000; // millivolts
    if (v <= 0 || v > 600) continue;
    const name = varbindToString(voltNames.get(i)) || `Điện áp ${i}`;
    sensors.push({ type: 'voltage', index: `dell-volt-${i}`, description: name, value: Math.round(v * 100) / 100, unit: 'V', status: 'ok' });
  }
  return sensors;
}

/**
 * IBM / Lenovo IMM2 / XClarity Controller (IMM-MIB) hardware health: temperature, voltage
 * and fan (percent of max). Self-noops when the device is not an IBM/Lenovo server.
 */
async function readIbmSensors(session: Session): Promise<DiscoveredSensor[]> {
  const sensors: DiscoveredSensor[] = [];
  const [temps, tempNames, volts, voltNames, fans, fanNames] = await Promise.all([
    snmpWalkColumn(session, OID.ibmTempReading),
    snmpWalkColumn(session, OID.ibmTempName),
    snmpWalkColumn(session, OID.ibmVoltReading),
    snmpWalkColumn(session, OID.ibmVoltName),
    snmpWalkColumn(session, OID.ibmFanSpeed),
    snmpWalkColumn(session, OID.ibmFanName),
  ]);

  for (const [i, vb] of temps) {
    const c = varbindToNumber(vb);
    if (c === undefined || c <= 0 || c > 150) continue;
    const name = varbindToString(tempNames.get(i)) || `Cảm biến nhiệt ${i}`;
    sensors.push({ type: 'temperature', index: `ibm-temp-${i}`, description: name, value: Math.round(c * 10) / 10, unit: '°C', status: c > 75 ? 'critical' : c > 60 ? 'warning' : 'ok' });
  }
  for (const [i, vb] of volts) {
    const raw = varbindToNumber(vb);
    if (raw === undefined) continue;
    const v = raw / 1000; // millivolts
    if (v <= 0 || v > 600) continue;
    const name = varbindToString(voltNames.get(i)) || `Điện áp ${i}`;
    sensors.push({ type: 'voltage', index: `ibm-volt-${i}`, description: name, value: Math.round(v * 100) / 100, unit: 'V', status: 'ok' });
  }
  for (const [i, vb] of fans) {
    const pct = varbindToNumber(vb);
    if (pct === undefined || pct < 0 || pct > 100) continue;
    const name = varbindToString(fanNames.get(i)) || `Quạt ${i}`;
    sensors.push({ type: 'load', index: `ibm-fan-${i}`, description: `${name} (tốc độ)`, value: Math.round(pct), unit: '%', status: 'ok' });
  }
  return sensors;
}

async function persistSensors(deviceId: string, sensors: DiscoveredSensor[]): Promise<void> {
  const now = new Date();
  const seen = new Set<string>();
  const metricRows: { sensorId: string; value: number }[] = [];
  for (const s of sensors) {
    const key = `${s.type}:${s.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = await prisma.sensor.upsert({
      where: { deviceId_type_index: { deviceId, type: s.type, index: s.index } },
      create: { deviceId, type: s.type, index: s.index, description: s.description, value: s.value, unit: s.unit, status: s.status, lastPolled: now },
      update: { description: s.description, value: s.value, unit: s.unit, status: s.status, lastPolled: now },
    });
    if (s.value !== null && s.value !== undefined && !Number.isNaN(s.value)) {
      metricRows.push({ sensorId: row.id, value: s.value });
    }
  }
  if (metricRows.length > 0) {
    await prisma.sensorMetric.createMany({ data: metricRows.map((r) => ({ ...r, timestamp: now })) });
  }

  const existing = await prisma.sensor.findMany({ where: { deviceId }, select: { id: true, type: true, index: true } });
  const stale = existing.filter((e) => !seen.has(`${e.type}:${e.index}`)).map((e) => e.id);
  if (stale.length > 0) await prisma.sensor.deleteMany({ where: { id: { in: stale } } });
}

/**
 * Discovers and refreshes all health sensors for a device, choosing the most
 * accurate source per vendor and falling back to ENTITY-SENSOR-MIB. Storage
 * (fixed disk) is collected for every device that exposes HOST-RESOURCES-MIB.
 */
export async function discoverSensors(session: Session, deviceId: string, ctx: DeviceContext): Promise<void> {
  const sensors: DiscoveredSensor[] = [];
  // Each source is isolated: a failure in one (e.g. ENTITY-SENSOR-MIB times out on a Windows
  // box that doesn't implement it) must NOT prevent the others (storage/disk, UPS) from running.
  const collect = async (label: string, fn: () => Promise<DiscoveredSensor[]>): Promise<void> => {
    try {
      sensors.push(...(await fn()));
    } catch (err) {
      logger.debug({ err, deviceId, label }, 'Sensor source failed, continuing with others');
    }
  };

  const isWindowsHost = /windows/i.test(ctx.sysDescr ?? '') || /microsoft/i.test(ctx.vendor ?? '');

  // Windows hosts frequently expose only HOST-RESOURCES storage reliably while
  // other sensor tables time out; prioritize the RAM/disk data path first.
  if (isWindowsHost) {
    await collect('storage', () => readStorageSensors(session));
    await persistSensors(deviceId, sensors);
    return;
  }

  if (isFortinet(ctx)) {
    await collect('fortinet', () => readFortiSensors(session));
    await collect('fortinet-ha', () => readFortiHaSensors(session));
  }
  else if (isJuniper(ctx)) await collect('juniper', () => readJuniperSensors(session, ctx.processors));
  else if (isPureStorage(ctx)) await collect('purestorage', () => readPureStorageSensors(session));
  else if (isCiscoSb(ctx)) await collect('ciscosb', () => readCiscoSbSensors(session));
  else await collect('entity', () => readEntitySensors(session));

  if (sensors.length === 0 && isHh3cFamily(ctx)) {
    await collect('hh3c', () => readHh3cSensors(session));
  }

  // Cisco hardware (routers/switches/NX-OS Nexus & MDS) that returned nothing via
  // ENTITY-SENSOR-MIB — many chassis/fixed-config platforms only expose temp/fan/PSU
  // health via CISCO-ENTITY-SENSOR-MIB, CISCO-ENVMON-MIB and/or CISCO-ENTITY-FRU-CONTROL-MIB instead.
  const isCisco = (ctx.vendor ?? '').toLowerCase() === 'cisco' || (ctx.sysObjectId?.startsWith('1.3.6.1.4.1.9.') ?? false);
  if (sensors.length === 0 && isCisco && !isFortinet(ctx) && !isJuniper(ctx) && !isCiscoSb(ctx)) {
    await collect('cisco-entity-sensor', () => readCiscoEntitySensors(session));
    if (sensors.length === 0) await collect('cisco-envmon', () => readCiscoEnvMonSensors(session));
    await collect('cisco-fru', () => readCiscoFruSensors(session));
  }

  // Storage (fixed disks + swap/pagefile) — collected for every device that exposes HOST-RESOURCES.
  await collect('storage', () => readStorageSensors(session));

  // UPS health: RFC 1628 UPS-MIB first, else APC PowerNet-MIB (older APC cards).
  await collect('ups', async () => {
    const upsSensors = await readUpsSensors(session);
    return upsSensors.length ? upsSensors : readApcSensors(session);
  });

  // Server hardware health (temp/fan/PSU/voltage). Only probed for the relevant vendors
  // (or when vendor is still unknown) to avoid extra SNMP load on network gear.
  const vendor = ctx.vendor ?? '';
  if (vendor === 'Dell' || vendor === '' || vendor === 'Unknown') await collect('dell', () => readDellSensors(session));
  if (vendor === 'IBM' || vendor === 'Lenovo' || vendor === '' || vendor === 'Unknown') await collect('ibm', () => readIbmSensors(session));

  await persistSensors(deviceId, sensors);
}
