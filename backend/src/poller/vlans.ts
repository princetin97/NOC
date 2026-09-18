import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { OID } from '../lib/mib-oids';
import { snmpWalkColumn, snmpWalkSuffix, varbindToNumber, varbindToString, type VarBind } from '../lib/snmp';
import type * as snmp from 'net-snmp';

type BitOrder = 'msb' | 'lsb';

// Q-BRIDGE-MIB port bitmaps (dot1qVlanStatic{Egress,Untagged}Ports) are BITS/OCTET
// STRING encoded: bit 1 of the first octet = dot1dBasePort 1, and so on (RFC 2674).
// Mirrors LibreNMS's StringHelpers::bitsToIndices().
function bitsToIndices(vb: VarBind | undefined, order: BitOrder = 'msb'): number[] {
  const value = vb?.value;
  if (!Buffer.isBuffer(value) || value.length === 0) return [];
  const indices: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const byte = value[i];
    if (order === 'msb') {
      for (let j = 7; j >= 0; j--) {
        if (byte & (1 << j)) indices.push(8 * i + (8 - j));
      }
    } else {
      for (let j = 0; j <= 7; j++) {
        if (byte & (1 << j)) indices.push(8 * i + (j + 1));
      }
    }
  }
  return indices;
}

function chooseQBridgeBitOrder(params: {
  vlanIds: Set<number>;
  pvidByIfIndex: Map<number, number>;
  basePortByIfIndex: Map<number, number>;
  untaggedPorts: Map<number, VarBind>;
  currentUntaggedPorts: Map<number, VarBind>;
  forcedOrder?: BitOrder;
}): BitOrder {
  const { vlanIds, pvidByIfIndex, basePortByIfIndex, untaggedPorts, currentUntaggedPorts, forcedOrder } = params;
  if (forcedOrder) return forcedOrder;
  if (pvidByIfIndex.size === 0) return 'msb';

  const scoreOrder = (order: BitOrder): number => {
    const untaggedByVlan = new Map<number, Set<number>>();
    for (const vlanId of vlanIds) {
      let bases = bitsToIndices(untaggedPorts.get(vlanId), order);
      if (bases.length === 0) bases = bitsToIndices(currentUntaggedPorts.get(vlanId), order);
      untaggedByVlan.set(vlanId, new Set(bases));
    }

    let score = 0;
    for (const [ifIndex, pvid] of pvidByIfIndex) {
      const basePort = basePortByIfIndex.get(ifIndex);
      if (!basePort) continue;
      const expectedSet = untaggedByVlan.get(pvid);
      if (expectedSet?.has(basePort)) score += 3;
      else score -= 2;
    }
    return score;
  };

  const msbScore = scoreOrder('msb');
  const lsbScore = scoreOrder('lsb');
  return lsbScore > msbScore ? 'lsb' : 'msb';
}

/** Persists a device's VLAN list plus per-VLAN port membership, pruning stale rows. */
async function saveVlans(
  deviceId: string,
  vlans: Map<number, string>,
  membership: Map<number, Map<string, boolean>>,
): Promise<void> {
  const now = new Date();
  for (const [vlanId, name] of vlans) {
    const vlan = await prisma.vlan.upsert({
      where: { deviceId_vlanId: { deviceId, vlanId } },
      create: { deviceId, vlanId, name },
      update: { name, updatedAt: now },
    });

    const members = membership.get(vlanId) ?? new Map<string, boolean>();
    const seenPortIds = new Set<string>();
    for (const [portId, untagged] of members) {
      seenPortIds.add(portId);
      await prisma.portVlan.upsert({
        where: { vlanId_portId: { vlanId: vlan.id, portId } },
        create: { vlanId: vlan.id, portId, untagged },
        update: { untagged },
      });
    }

    // Drop memberships for ports that moved out of this VLAN.
    await prisma.portVlan.deleteMany({ where: { vlanId: vlan.id, portId: { notIn: [...seenPortIds] } } });
  }

  // Prune VLANs no longer reported by this device (cascades their PortVlan rows).
  await prisma.vlan.deleteMany({ where: { deviceId, updatedAt: { lt: now } } });
}

/**
 * Keys a dot1qVlanCurrentTable walk (compound index dot1qVlanTimeMark.dot1qVlanIndex,
 * RFC 4363) by VLAN id, taking the LAST index component of each suffix. Some devices
 * (Cisco Small Business observed) don't actually vary the time-filter component and
 * report a single-component suffix already equal to the VLAN id; snmpWalkSuffix +
 * this parse handles both cases safely.
 */
function keyCurrentTableByVlanId(rows: Map<string, VarBind>): Map<number, VarBind> {
  const result = new Map<number, VarBind>();
  for (const [suffix, vb] of rows) {
    const parts = suffix.split('.');
    const vlanId = Number(parts[parts.length - 1]);
    if (Number.isFinite(vlanId)) result.set(vlanId, vb);
  }
  return result;
}

/**
 * VLAN + port-membership discovery via Q-BRIDGE-MIB, modeled on LibreNMS's
 * QBridgeMib trait: walk dot1qVlanStaticName for VLAN id/name, then
 * dot1qVlanStatic{Egress,Untagged}Ports (per-VLAN BaseType bitmaps) mapped
 * through dot1dBasePortIfIndex to real ifIndexes/ports.
 * Returns true if any VLAN was found (i.e. the device implements this MIB).
 */
async function discoverQBridgeVlans(session: snmp.Session, deviceId: string): Promise<boolean> {
  const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { vendor: true, model: true } });
  const vendorLower = (device?.vendor ?? '').toLowerCase();
  const modelLower = (device?.model ?? '').toLowerCase();
  const forceMsbBitOrder = vendorLower.includes('cisco');
  // Cisco SMB families (SF/SG/CBS/C1200/1300) often expose partial static rows
  // while current rows carry the full runtime membership for access VLANs.
  const preferStaticCurrentUnion =
    /\bc(1200|1300)\b|\bcbs(?:\d+)?\b/.test(modelLower) ||
    /\b(?:sf|sg|sx)\d+[a-z0-9-]*\b/.test(modelLower);

  // Some SNMP agents are fragile with concurrent subtree walks on one session.
  // Fetch sequentially and tolerate per-OID failures so VLAN discovery can still
  // proceed with partial data.
  const walkColumnSafe = async (oid: string, label: string): Promise<Map<number, VarBind>> => {
    try {
      return await snmpWalkColumn(session, oid);
    } catch (err) {
      logger.debug({ err, deviceId, oid }, `VLAN discovery: failed to walk ${label}`);
      return new Map<number, VarBind>();
    }
  };
  const walkSuffixSafe = async (oid: string, label: string): Promise<Map<string, VarBind>> => {
    try {
      return await snmpWalkSuffix(session, oid);
    } catch (err) {
      logger.debug({ err, deviceId, oid }, `VLAN discovery: failed to walk ${label}`);
      return new Map<string, VarBind>();
    }
  };

  const vlanNames = await walkColumnSafe(OID.dot1qVlanStaticName, 'dot1qVlanStaticName');
  const egressPorts = await walkColumnSafe(OID.dot1qVlanStaticEgressPorts, 'dot1qVlanStaticEgressPorts');
  const untaggedPorts = await walkColumnSafe(OID.dot1qVlanStaticUntaggedPorts, 'dot1qVlanStaticUntaggedPorts');
  const basePortIfIndex = await walkColumnSafe(OID.dot1dBasePortIfIndex, 'dot1dBasePortIfIndex');
  const currentEgressRows = await walkSuffixSafe(OID.dot1qVlanCurrentEgressPorts, 'dot1qVlanCurrentEgressPorts');
  const currentUntaggedRows = await walkSuffixSafe(OID.dot1qVlanCurrentUntaggedPorts, 'dot1qVlanCurrentUntaggedPorts');
  const pvidRows = await walkSuffixSafe(OID.dot1qPvid, 'dot1qPvid');
  const currentEgressPorts = keyCurrentTableByVlanId(currentEgressRows);
  const currentUntaggedPorts = keyCurrentTableByVlanId(currentUntaggedRows);

  const ports = await prisma.port.findMany({ where: { deviceId }, select: { id: true, ifIndex: true } });
  const portIdByIfIndex = new Map<number, string>(ports.map((p) => [p.ifIndex, p.id]));
  const basePortByIfIndex = new Map<number, number>();
  for (const [basePort, vb] of basePortIfIndex) {
    const ifIndex = varbindToNumber(vb);
    if (ifIndex) basePortByIfIndex.set(ifIndex, basePort);
  }

  const resolveIfIndexFromBasePort = (basePort: number): number | undefined => {
    const ifIndexFromBridge = varbindToNumber(basePortIfIndex.get(basePort));
    if (ifIndexFromBridge) return ifIndexFromBridge;
    // Some Cisco SMB devices expose VLAN bitmaps and dot1qPvid but no dot1dBasePortIfIndex.
    // In that case, bitmap indexes match physical ifIndex values directly.
    return portIdByIfIndex.has(basePort) ? basePort : undefined;
  };

  if (basePortByIfIndex.size === 0) {
    for (const ifIndex of portIdByIfIndex.keys()) {
      if (ifIndex > 0 && ifIndex <= 4094) basePortByIfIndex.set(ifIndex, ifIndex);
    }
  }

  // Different vendors index dot1qPvid inconsistently (ifIndex on some 3Com/H3C,
  // dot1dBasePort on others), so resolve both forms into ifIndex -> pvid.
  const pvidByIfIndex = new Map<number, number>();
  for (const [suffix, vb] of pvidRows) {
    const pvid = varbindToNumber(vb);
    if (!pvid || !Number.isFinite(pvid)) continue;
    const parts = suffix.split('.');
    const idx = Number(parts[parts.length - 1]);
    if (!Number.isFinite(idx)) continue;

    if (portIdByIfIndex.has(idx)) {
      pvidByIfIndex.set(idx, pvid);
      continue;
    }

    const ifIndex = resolveIfIndexFromBasePort(idx);
    if (ifIndex && portIdByIfIndex.has(ifIndex)) pvidByIfIndex.set(ifIndex, pvid);
  }

  // Some devices (observed on 3Com lines) encode Q-BRIDGE BITS bit-order reversed
  // from our default assumption. Pick the order that best matches PVID->untagged.
  const qbridgeBitOrder = chooseQBridgeBitOrder({
    vlanIds: new Set<number>([
      ...vlanNames.keys(),
      ...egressPorts.keys(),
      ...currentEgressPorts.keys(),
      ...new Set<number>(pvidByIfIndex.values()),
    ]),
    pvidByIfIndex,
    basePortByIfIndex,
    untaggedPorts,
    currentUntaggedPorts,
    forcedOrder: forceMsbBitOrder ? 'msb' : undefined,
  });

  const pvidVlanIds = new Set<number>(pvidByIfIndex.values());
  const vlanIds = new Set<number>([
    ...vlanNames.keys(),
    ...egressPorts.keys(),
    ...currentEgressPorts.keys(),
    ...pvidVlanIds,
  ]);
  if (vlanIds.size === 0) return false; // device doesn't implement Q-BRIDGE-MIB

  // Some Cisco Small Business / Catalyst 1200-1300 switches are known to report
  // dot1qPvid=1 on almost/all ports even when access VLANs are different. If we
  // treat that as authoritative, every port collapses into VLAN 1 untagged and
  // other VLANs appear trunk-only. Detect this pattern and fall back to the
  // untagged bitmaps instead.
  const uniquePvidValues = new Set<number>(pvidByIfIndex.values());
  const hasNonVlan1UntaggedBitmap = [...vlanIds].some((vlanId) => {
    if (vlanId === 1) return false;
    return (
      bitsToIndices(untaggedPorts.get(vlanId), qbridgeBitOrder).length > 0 ||
      bitsToIndices(currentUntaggedPorts.get(vlanId), qbridgeBitOrder).length > 0
    );
  });
  const pvidUnreliableAllVlan1 =
    pvidByIfIndex.size > 0 &&
    vlanIds.size > 1 &&
    uniquePvidValues.size === 1 &&
    uniquePvidValues.has(1) &&
    hasNonVlan1UntaggedBitmap;
  const usePvidAsAuthority = pvidByIfIndex.size > 0 && !pvidUnreliableAllVlan1;

  const pvidPortIdsByVlan = new Map<number, string[]>();
  if (usePvidAsAuthority) {
    for (const [ifIndex, vlanId] of pvidByIfIndex) {
      const portId = portIdByIfIndex.get(ifIndex);
      if (!portId) continue;
      const arr = pvidPortIdsByVlan.get(vlanId) ?? [];
      arr.push(portId);
      pvidPortIdsByVlan.set(vlanId, arr);
    }
  }

  const vlans = new Map<number, string>();
  const membership = new Map<number, Map<string, boolean>>();
  const egressBaseByVlan = new Map<number, number[]>();
  const untaggedBaseByVlan = new Map<number, Set<number>>();

  // Cisco Q-BRIDGE on some models can report VLAN 1 untagged overlapping with
  // actual access VLANs. Build per-port candidates so we can force a single
  // authoritative untagged VLAN when overlaps happen.
  const forcedUntaggedVlanByBasePort = new Map<number, number>();
  for (const vlanId of vlanIds) {
    if (!Number.isFinite(vlanId) || vlanId <= 0 || vlanId > 4094) continue;
    vlans.set(vlanId, varbindToString(vlanNames.get(vlanId)) ?? `VLAN${vlanId}`);

    // Use static + current union. Some devices expose incomplete static bitmaps
    // (or current-only rows), so strict static-preferred fallback can miss members.
    const staticEgressBase = bitsToIndices(egressPorts.get(vlanId), qbridgeBitOrder);
    const currentEgressBase = bitsToIndices(currentEgressPorts.get(vlanId), qbridgeBitOrder);
    const staticUntaggedBase = bitsToIndices(untaggedPorts.get(vlanId), qbridgeBitOrder);
    const currentUntaggedBase = bitsToIndices(currentUntaggedPorts.get(vlanId), qbridgeBitOrder);

    const egressBase = preferStaticCurrentUnion
      ? staticEgressBase.length > 0
        ? Array.from(new Set<number>([...staticEgressBase, ...currentEgressBase]))
        : currentEgressBase
      : staticEgressBase.length > 0
        ? staticEgressBase
        : currentEgressBase;
    const untaggedBaseArr = preferStaticCurrentUnion
      ? staticUntaggedBase.length > 0
        ? Array.from(new Set<number>([...staticUntaggedBase, ...currentUntaggedBase]))
        : currentUntaggedBase
      : staticUntaggedBase.length > 0
        ? staticUntaggedBase
        : currentUntaggedBase;
    const untaggedBase = new Set(untaggedBaseArr);

    egressBaseByVlan.set(vlanId, egressBase);
    untaggedBaseByVlan.set(vlanId, untaggedBase);

    membership.set(vlanId, new Map());
  }

  if (vendorLower.includes('cisco')) {
    const untaggedCandidatesByBasePort = new Map<number, number[]>();
    for (const [vlanId, untaggedBases] of untaggedBaseByVlan) {
      for (const basePort of untaggedBases) {
        const arr = untaggedCandidatesByBasePort.get(basePort) ?? [];
        arr.push(vlanId);
        untaggedCandidatesByBasePort.set(basePort, arr);
      }
    }

    for (const [basePort, candidates] of untaggedCandidatesByBasePort) {
      if (candidates.length <= 1) continue;

      const ifIndex = resolveIfIndexFromBasePort(basePort);
      const pvid = ifIndex ? pvidByIfIndex.get(ifIndex) : undefined;

      // Prefer PVID when it matches one of the candidate VLANs.
      if (pvid && candidates.includes(pvid)) {
        forcedUntaggedVlanByBasePort.set(basePort, pvid);
        continue;
      }

      // Otherwise prefer a non-default VLAN over VLAN 1 to avoid false VLAN1 access.
      const nonDefault = candidates.filter((v) => v !== 1).sort((a, b) => a - b);
      if (nonDefault.length > 0) {
        forcedUntaggedVlanByBasePort.set(basePort, nonDefault[0]);
      }
    }
  }

  for (const vlanId of vlans.keys()) {
    const egressBase = egressBaseByVlan.get(vlanId) ?? [];
    const untaggedBase = untaggedBaseByVlan.get(vlanId) ?? new Set<number>();
    const members = membership.get(vlanId) ?? new Map<string, boolean>();

    const hasUntaggedBitmapForVlan = untaggedBase.size > 0;
    for (const basePort of egressBase) {
      const ifIndex = resolveIfIndexFromBasePort(basePort);
      if (!ifIndex) continue;
      const portId = portIdByIfIndex.get(ifIndex);
      if (!portId) continue;

      const pvid = pvidByIfIndex.get(ifIndex);
      const forcedUntaggedVlan = forcedUntaggedVlanByBasePort.get(basePort);
      const isUntagged = hasUntaggedBitmapForVlan
        ? forcedUntaggedVlan
          ? forcedUntaggedVlan === vlanId
          : untaggedBase.has(basePort)
        : Boolean(usePvidAsAuthority && pvid && pvid === vlanId);
      members.set(portId, isUntagged);
    }

    if (!hasUntaggedBitmapForVlan) {
      for (const portId of pvidPortIdsByVlan.get(vlanId) ?? []) members.set(portId, true);
    }
    membership.set(vlanId, members);
  }

  await saveVlans(deviceId, vlans, membership);
  return true;
}


/**
 * Fallback VLAN discovery for Cisco IOS/IOS-XE switches that don't return anything
 * useful over Q-BRIDGE-MIB (Cisco requires a per-VLAN SNMP community/context to read
 * per-VLAN bridge state, so a plain SNMP walk against the default context sees at most
 * VLAN 1). Mirrors LibreNMS's `Cisco::discoverVlans()`/`discoverVlanPorts()`:
 *  - VLAN id/name from CISCO-VTP-MIB's vtpVlanTable (assumes a single VTP domain).
 *  - Access-port (untagged) membership from CISCO-VLAN-MEMBERSHIP-MIB's vmVlan.
 *  - Trunk-port native VLAN (untagged) + allowed VLANs (tagged) from
 *    CISCO-VTP-MIB's vlanTrunkPortTable, indexed directly by ifIndex.
 */
async function discoverCiscoVtpVlans(session: snmp.Session, deviceId: string): Promise<boolean> {
  const vlanNames = await snmpWalkColumn(session, OID.vtpVlanName);
  const vlanIds = new Set<number>(vlanNames.keys());
  if (vlanIds.size === 0) return false; // device doesn't run VTP either

  const ports = await prisma.port.findMany({ where: { deviceId }, select: { id: true, ifIndex: true } });
  const portIdByIfIndex = new Map<number, string>(ports.map((p) => [p.ifIndex, p.id]));

  const [vmVlan, trunkNative, trunkDynamicStatus, trunkXmitJoined, trunkXmitJoined2k, trunkXmitJoined3k, trunkXmitJoined4k, trunkEnabled, trunkEnabled2k, trunkEnabled3k, trunkEnabled4k] = await Promise.all([
    snmpWalkColumn(session, OID.vmVlan),
    snmpWalkColumn(session, OID.vlanTrunkPortNativeVlan),
    snmpWalkColumn(session, OID.vlanTrunkPortDynamicStatus),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansXmitJoined),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansXmitJoined2k),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansXmitJoined3k),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansXmitJoined4k),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansEnabled),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansEnabled2k),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansEnabled3k),
    snmpWalkColumn(session, OID.vlanTrunkPortVlansEnabled4k),
  ]);

  const membership = new Map<number, Map<string, boolean>>();
  const addMember = (vlanId: number, portId: string, untagged: boolean) => {
    if (vlanId <= 0 || vlanId > 4094) return;
    if (!membership.has(vlanId)) membership.set(vlanId, new Map());
    const m = membership.get(vlanId)!;
    m.set(portId, untagged || (m.get(portId) ?? false));
  };

  // Access ports: vmVlan is indexed directly by ifIndex.
  for (const [ifIndex, vb] of vmVlan) {
    const vlanId = varbindToNumber(vb);
    const portId = portIdByIfIndex.get(ifIndex);
    if (!vlanId || !portId) continue;
    addMember(vlanId, portId, true);
  }

  // Trunk ports: native VLAN is untagged, everything else *actively forwarded* is tagged - but
  // only for ports that are ACTUALLY trunking right now (dynamicStatus), not just port rows that
  // exist for every interface with dynamicState left at its 'auto' default (i.e. plain access ports).
  const trunkIfIndexes = new Set<number>([...trunkNative.keys(), ...trunkXmitJoined.keys(), ...trunkDynamicStatus.keys()]);
  for (const ifIndex of trunkIfIndexes) {
    const portId = portIdByIfIndex.get(ifIndex);
    if (!portId) continue;

    // notTrunking(2) - this row isn't actually trunking right now, so skip native + allowed
    // membership entirely. Some C1000/Catalyst models expose native=1 rows for access ports.
    if (varbindToNumber(trunkDynamicStatus.get(ifIndex)) !== 1) continue;

    const native = varbindToNumber(trunkNative.get(ifIndex));
    if (native) addMember(native, portId, true);

    // BITS bitmap: 1-based bit index -> VLAN id, offset per 1024-VLAN chunk (mirrors LibreNMS).
    // XmitJoined only reflects VTP-pruning join state, which many IOS switches never populate
    // (pruning disabled by default, in which case the VarBind is present but decodes to zero
    // bits) - fall back to the static VlansEnabled config whenever a chunk decodes empty. Safe
    // here because we've already confirmed the port is really trunking above.
    const bitsWithFallback = (primary: VarBind | undefined, fallback: VarBind | undefined): number[] => {
      const bits = bitsToIndices(primary);
      return bits.length > 0 ? bits : bitsToIndices(fallback);
    };
    const allowed = [
      ...bitsWithFallback(trunkXmitJoined.get(ifIndex), trunkEnabled.get(ifIndex)).map((i) => i - 1),
      ...bitsWithFallback(trunkXmitJoined2k.get(ifIndex), trunkEnabled2k.get(ifIndex)).map((i) => i + 1023),
      ...bitsWithFallback(trunkXmitJoined3k.get(ifIndex), trunkEnabled3k.get(ifIndex)).map((i) => i + 2047),
      ...bitsWithFallback(trunkXmitJoined4k.get(ifIndex), trunkEnabled4k.get(ifIndex)).map((i) => i + 3071),
    ];
    for (const vlanId of allowed) {
      if (vlanId !== native) addMember(vlanId, portId, false);
    }
  }

  const vlans = new Map<number, string>();
  for (const vlanId of vlanIds) {
    if (!Number.isFinite(vlanId) || vlanId <= 0 || vlanId > 4094) continue;
    vlans.set(vlanId, varbindToString(vlanNames.get(vlanId)) ?? `VLAN${vlanId}`);
  }

  await saveVlans(deviceId, vlans, membership);
  return true;
}

export async function discoverVlans(session: snmp.Session, deviceId: string): Promise<void> {
  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { vendor: true, model: true, os: true } });
    const vendorLower = (device?.vendor ?? '').toLowerCase();
    const modelLower = (device?.model ?? '').toLowerCase();
    const osLower = (device?.os ?? '').toLowerCase();

    // Cisco IOS access/distribution switches (C1000/Catalyst/WS-C families) often
    // expose more reliable per-port access VLAN via vmVlan in CISCO-VTP-MIB than
    // Q-BRIDGE static membership (which can over-report VLAN1 on some models).
    const preferCiscoVtpFirst =
      vendorLower.includes('cisco') &&
      /(\bc1000\b|catalyst|\bws-c\d+|\b2960\b|\b3560\b|\b3650\b|\b3850\b|\b9200\b|\b9300\b|\b9500\b)/.test(
        `${modelLower} ${osLower}`,
      );

    if (preferCiscoVtpFirst) {
      if (await discoverCiscoVtpVlans(session, deviceId)) return;
      if (await discoverQBridgeVlans(session, deviceId)) return;
      return;
    }

    if (await discoverQBridgeVlans(session, deviceId)) return;
    await discoverCiscoVtpVlans(session, deviceId);
  } catch (err) {
    logger.debug({ err, deviceId }, 'VLAN discovery failed');
  }
}
