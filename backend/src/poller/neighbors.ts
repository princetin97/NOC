import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { OID } from '../lib/mib-oids';
import { snmpWalkColumn, snmpWalkSuffix, varbindToString, type VarBind } from '../lib/snmp';
import type * as snmp from 'net-snmp';

interface DiscoveredNeighbor {
  protocol: 'lldp' | 'cdp';
  localPortName: string;
  remoteSysName?: string;
  remoteChassisId?: string;
  remotePortId?: string;
  remotePortDescr?: string;
}

// Renders an LLDP chassis/port id, which net-snmp returns as a Buffer. A 6-byte
// value is treated as a MAC address; otherwise printable ASCII is used, falling
// back to a hex string.
function renderLldpId(vb: VarBind | undefined): string | undefined {
  if (!vb || vb.value === undefined || vb.value === null) return undefined;
  const value = vb.value;
  if (Buffer.isBuffer(value)) {
    if (value.length === 6) {
      return Array.from(value).map((b) => b.toString(16).padStart(2, '0')).join(':');
    }
    const ascii = value.toString('utf8').replace(/\0/g, '').trim();
    if (ascii && /^[\x20-\x7e]+$/.test(ascii)) return ascii;
    return Array.from(value).map((b) => b.toString(16).padStart(2, '0')).join(':');
  }
  return String(value);
}

async function walkLldp(session: snmp.Session, ifNameByIndex: Map<number, string>): Promise<DiscoveredNeighbor[]> {
  const [locPortId, remSysName, remChassisId, remPortId, remPortDesc] = await Promise.all([
    snmpWalkColumn(session, OID.lldpLocPortId),
    snmpWalkSuffix(session, OID.lldpRemSysName),
    snmpWalkSuffix(session, OID.lldpRemChassisId),
    snmpWalkSuffix(session, OID.lldpRemPortId),
    snmpWalkSuffix(session, OID.lldpRemPortDesc),
  ]);

  const neighbors: DiscoveredNeighbor[] = [];
  // lldpRemTable instance suffix is timeMark.localPortNum.remIndex.
  const suffixes = new Set<string>([...remSysName.keys(), ...remChassisId.keys(), ...remPortId.keys()]);
  for (const suffix of suffixes) {
    const parts = suffix.split('.');
    if (parts.length < 2) continue;
    const localPortNum = Number(parts[1]);
    const localPortName =
      renderLldpId(locPortId.get(localPortNum)) ?? ifNameByIndex.get(localPortNum) ?? `port${localPortNum}`;
    neighbors.push({
      protocol: 'lldp',
      localPortName,
      remoteSysName: varbindToString(remSysName.get(suffix)),
      remoteChassisId: renderLldpId(remChassisId.get(suffix)),
      remotePortId: renderLldpId(remPortId.get(suffix)),
      remotePortDescr: varbindToString(remPortDesc.get(suffix)),
    });
  }
  return neighbors;
}

async function walkCdp(session: snmp.Session, ifNameByIndex: Map<number, string>): Promise<DiscoveredNeighbor[]> {
  const [deviceId, devicePort, platform] = await Promise.all([
    snmpWalkSuffix(session, OID.cdpCacheDeviceId),
    snmpWalkSuffix(session, OID.cdpCacheDevicePort),
    snmpWalkSuffix(session, OID.cdpCachePlatform),
  ]);

  const neighbors: DiscoveredNeighbor[] = [];
  // cdpCache instance suffix is ifIndex.deviceIndex.
  for (const [suffix, vb] of deviceId) {
    const parts = suffix.split('.');
    const ifIndex = Number(parts[0]);
    neighbors.push({
      protocol: 'cdp',
      localPortName: ifNameByIndex.get(ifIndex) ?? `if${ifIndex}`,
      remoteSysName: varbindToString(vb),
      remotePortId: varbindToString(devicePort.get(suffix)),
      remotePortDescr: varbindToString(platform.get(suffix)),
    });
  }
  return neighbors;
}

/**
 * Discovers link-layer neighbors via LLDP (preferred) and CDP, and reconciles
 * them into the DeviceNeighbor table (upsert seen, prune stale). Must run within
 * an active SNMP session opened by the caller.
 */
export async function discoverNeighbors(session: snmp.Session, deviceId: string): Promise<void> {
  const ports = await prisma.port.findMany({ where: { deviceId }, select: { ifIndex: true, ifName: true } });
  const ifNameByIndex = new Map<number, string>(ports.map((p) => [p.ifIndex, p.ifName]));

  let neighbors: DiscoveredNeighbor[] = [];
  try {
    neighbors = await walkLldp(session, ifNameByIndex);
  } catch (err) {
    logger.debug({ err, deviceId }, 'LLDP walk failed');
  }
  if (neighbors.length === 0) {
    try {
      neighbors = await walkCdp(session, ifNameByIndex);
    } catch (err) {
      logger.debug({ err, deviceId }, 'CDP walk failed');
    }
  }

  const now = new Date();
  for (const n of neighbors) {
    await prisma.deviceNeighbor.upsert({
      where: {
        deviceId_localPortName_remoteChassisId_remotePortId: {
          deviceId,
          localPortName: n.localPortName,
          remoteChassisId: n.remoteChassisId ?? '',
          remotePortId: n.remotePortId ?? '',
        },
      },
      create: {
        deviceId,
        protocol: n.protocol,
        localPortName: n.localPortName,
        remoteSysName: n.remoteSysName,
        remoteChassisId: n.remoteChassisId ?? '',
        remotePortId: n.remotePortId ?? '',
        remotePortDescr: n.remotePortDescr,
        lastSeen: now,
      },
      update: {
        protocol: n.protocol,
        remoteSysName: n.remoteSysName,
        remotePortDescr: n.remotePortDescr,
        lastSeen: now,
      },
    });
  }

  // Prune neighbors not seen in this discovery cycle.
  await prisma.deviceNeighbor.deleteMany({ where: { deviceId, lastSeen: { lt: now } } });
}
