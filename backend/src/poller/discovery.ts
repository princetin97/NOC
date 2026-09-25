import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { OID, decodeIfStatus, decodeIfType } from '../lib/mib-oids';
import {
  snmpGet,
  snmpGetSingle,
  snmpWalkColumn,
  varbindToNumber,
  varbindToString,
  withSession,
  type SnmpCredentials,
  type VarBind,
} from '../lib/snmp';
import { publishEvent } from '../lib/events';
import { discoverNeighbors } from './neighbors';
import { discoverVlans } from './vlans';
import { isSnmpAutoPaused } from '../lib/snmpAutoPause';

function toCredentials(device: { ip: string; snmpPort: number; snmpVersion: string; snmpCommunity: string | null; snmpV3User: string | null; snmpV3AuthProto: string | null; snmpV3AuthPass: string | null; snmpV3PrivProto: string | null; snmpV3PrivPass: string | null }): SnmpCredentials {
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

/** SNMP-based discovery: identifies the device and enumerates its interfaces. */
export async function discoverDevice(deviceId: string): Promise<void> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return;
  if (!device.snmpPort || device.snmpPort <= 0) return;
  if (await isSnmpAutoPaused(deviceId)) {
    logger.debug({ deviceId }, 'Skipping SNMP discovery because device is auto-paused (ping-only mode)');
    return;
  }

  const creds = toCredentials(device);

  try {
    await withSession(creds, async (session) => {
      const sysVarbinds = await snmpGet(session, [OID.sysDescr, OID.sysObjectID, OID.sysName, OID.sysLocation]);
      const sysDescr = varbindToString(sysVarbinds[0]);
      const sysObjectId = varbindToString(sysVarbinds[1]);
      const sysName = varbindToString(sysVarbinds[2]);
      const sysLocation = varbindToString(sysVarbinds[3]);

      const vendor = guessVendor(sysDescr, sysObjectId);
      const identity = await readIdentity(session, {
        vendor,
        sysDescr,
        sysObjectId,
        hostname: device.hostname,
        deviceName: device.name,
      });
      const ups = await readUpsIdentity(session);
      const resolvedVendor = ups?.manufacturer ?? vendor;
      const resolvedModel = ups?.model ?? identity.model ?? guessWindowsHardware(sysDescr) ?? undefined;

      await prisma.device.update({
        where: { id: deviceId },
        data: {
          sysDescr,
          sysObjectId,
          vendor: resolvedVendor,
          os: ups ? 'UPS' : (guessOs(vendor, sysDescr) ?? device.os),
          osVersion: ups ? undefined : (guessOsVersion(sysDescr, sysObjectId) ?? device.osVersion),
          firmware: ups?.firmware ?? identity.firmware ?? undefined,
          serial: identity.serial ?? undefined,
          name: device.name || sysName || device.name,
          location: device.location ?? sysLocation ?? undefined,
          // Windows rarely implements ENTITY-MIB, so fall back to the CPU architecture
          // parsed from sysDescr (e.g. "Intel x64") as the model/hardware label.
          model: resolvedModel,
          type: ups ? 'ups' : (guessType(resolvedVendor, sysDescr, resolvedModel) ?? device.type),
        },
      });

      const [ifIndexColumn, ifDescr, ifType, ifSpeed, ifHighSpeed, ifPhysAddress, ifAdminStatus, ifName, ifAlias] = await Promise.all([
        snmpWalkColumn(session, OID.ifIndex),
        snmpWalkColumn(session, OID.ifDescr),
        snmpWalkColumn(session, OID.ifType),
        snmpWalkColumn(session, OID.ifSpeed),
        snmpWalkColumn(session, OID.ifHighSpeed),
        snmpWalkColumn(session, OID.ifPhysAddress),
        snmpWalkColumn(session, OID.ifAdminStatus),
        snmpWalkColumn(session, OID.ifName),
        snmpWalkColumn(session, OID.ifAlias),
      ]);

      const indexes = new Set<number>([...ifIndexColumn.keys(), ...ifDescr.keys(), ...ifName.keys()]);

      if (indexes.size === 0) {
        await prisma.eventLog.create({
          data: {
            deviceId,
            facility: 'system',
            severity: 'warning',
            message:
              'IF-MIB interface table is not accessible (ifIndex/ifDescr/ifName all empty). Check SNMP view/ACL/credentials on device.',
            rawSource: device.ip,
          },
        });
      }

      const ghostStackIndexes = detectGhostStackPlaceholderIfIndexes({
        indexes,
        ifType,
        ifName,
        ifPhysAddress,
      });
      if (ghostStackIndexes.size > 0) {
        logger.info(
          { deviceId, count: ghostStackIndexes.size },
          'Skipping ghost stack placeholder ports (multi-unit template rows)',
        );
        await prisma.port.deleteMany({ where: { deviceId, ifIndex: { in: [...ghostStackIndexes] } } });
      }

      // Some Cisco Small Business switches (SF/SG 200/300/500 series) advertise a
      // fixed-capacity ifTable sized for a full 8-unit stack regardless of how many
      // units are physically present: hundreds of placeholder "ethernetCsmacd" rows.
      // Apply duplicated-MAC filtering only to that family; other vendors (incl. HPE)
      // may legitimately repeat MAC patterns and must not be pruned.
      const descrLower = (sysDescr ?? '').toLowerCase();
      const modelLower = (resolvedModel ?? '').toLowerCase();
      const vendorLower = (resolvedVendor ?? '').toLowerCase();
      const isCiscoSmallBusiness =
        vendorLower.includes('cisco') &&
        /\b(sf|sg)\s*-?\d{2,4}\b|small\s+business/.test(`${descrLower} ${modelLower}`);

      const bogusIndexes = new Set<number>();
      if (isCiscoSmallBusiness) {
        const ethernetMacCounts = new Map<string, number>();
        for (const ifIndex of indexes) {
          if ((varbindToNumber(ifType.get(ifIndex)) ?? 0) !== 6) continue;
          const mac = formatMac(ifPhysAddress.get(ifIndex));
          if (!mac) continue;
          ethernetMacCounts.set(mac, (ethernetMacCounts.get(mac) ?? 0) + 1);
        }
        for (const ifIndex of indexes) {
          if ((varbindToNumber(ifType.get(ifIndex)) ?? 0) !== 6) continue;
          const mac = formatMac(ifPhysAddress.get(ifIndex));
          if (mac && (ethernetMacCounts.get(mac) ?? 0) >= 3) bogusIndexes.add(ifIndex);
        }
        if (bogusIndexes.size > 0) {
          logger.info(
            { deviceId, count: bogusIndexes.size },
            'Skipping bogus placeholder ports (duplicated chassis MAC on Cisco Small Business rows)',
          );
          await prisma.port.deleteMany({ where: { deviceId, ifIndex: { in: [...bogusIndexes] } } });
        }
      }

      const portUpserts: ReturnType<typeof prisma.port.upsert>[] = [];
      for (const ifIndex of indexes) {
        if (ghostStackIndexes.has(ifIndex)) continue;
        if (bogusIndexes.has(ifIndex)) continue;
        const speedMbps = varbindToNumber(ifHighSpeed.get(ifIndex));
        const speedBps = speedMbps ? speedMbps * 1_000_000 : (varbindToNumber(ifSpeed.get(ifIndex)) ?? 0);
        const portData = {
          ifName: varbindToString(ifName.get(ifIndex)) ?? varbindToString(ifDescr.get(ifIndex)) ?? `if${ifIndex}`,
          ifDescr: varbindToString(ifDescr.get(ifIndex)),
          ifAlias: varbindToString(ifAlias.get(ifIndex)),
          ifType: decodeIfType(varbindToNumber(ifType.get(ifIndex)) ?? 0),
          ifSpeed: BigInt(Math.round(speedBps)),
          ifPhysAddress: formatMac(ifPhysAddress.get(ifIndex)),
          ifAdminStatus: decodeIfStatus(varbindToNumber(ifAdminStatus.get(ifIndex)) ?? 2),
        };

        portUpserts.push(prisma.port.upsert({
          where: { deviceId_ifIndex: { deviceId, ifIndex } },
          create: { deviceId, ifIndex, ...portData },
          update: portData,
        }));
      }
      if (portUpserts.length > 0) await prisma.$transaction(portUpserts);

      await discoverNeighbors(session, deviceId);
      await discoverVlans(session, deviceId);
    });

    await publishEvent('device:discovered', { deviceId });
  } catch (err) {
    logger.warn({ err, deviceId }, 'Discovery failed');
  }
}

function formatMac(vb: VarBind | undefined): string | undefined {
  if (!vb) return undefined;
  // net-snmp returns physical addresses as Buffers.
  const value = vb.value;
  if (Buffer.isBuffer(value)) {
    return Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':');
  }
  return undefined;
}

function detectGhostStackPlaceholderIfIndexes(params: {
  indexes: Set<number>;
  ifType: Map<number, VarBind>;
  ifName: Map<number, VarBind>;
  ifPhysAddress: Map<number, VarBind>;
}): Set<number> {
  const { indexes, ifType, ifName, ifPhysAddress } = params;
  const ethernetIndexes = [...indexes].filter((ifIndex) => (varbindToNumber(ifType.get(ifIndex)) ?? 0) === 6);
  if (ethernetIndexes.length < 96) return new Set<number>();

  const unitCounts = new Map<number, number>();
  const matched = new Map<number, number>();
  const re = /^(fa|gi|te)(\d+)\/0\/(\d+)$/i;
  for (const ifIndex of ethernetIndexes) {
    const name = (varbindToString(ifName.get(ifIndex)) ?? '').trim();
    const m = re.exec(name);
    if (!m) continue;
    const unit = Number(m[2]);
    if (!Number.isFinite(unit)) continue;
    matched.set(ifIndex, unit);
    unitCounts.set(unit, (unitCounts.get(unit) ?? 0) + 1);
  }

  const units = [...unitCounts.keys()].sort((a, b) => a - b);
  if (units.length < 4) return new Set<number>();

  const macCounts = new Map<string, number>();
  for (const ifIndex of ethernetIndexes) {
    const mac = formatMac(ifPhysAddress.get(ifIndex));
    if (!mac) continue;
    macCounts.set(mac, (macCounts.get(mac) ?? 0) + 1);
  }

  let dominantMacCount = 0;
  for (const count of macCounts.values()) dominantMacCount = Math.max(dominantMacCount, count);
  const dominantRatio = ethernetIndexes.length > 0 ? dominantMacCount / ethernetIndexes.length : 0;

  // Signature observed on Cisco stack-template rows: many units + one repeated chassis MAC.
  if (dominantMacCount < 100 || dominantRatio < 0.7) return new Set<number>();

  const primaryUnit = units.includes(1) ? 1 : units[0];
  const ghostIfIndexes = new Set<number>();
  for (const [ifIndex, unit] of matched) {
    if (unit !== primaryUnit) ghostIfIndexes.add(ifIndex);
  }
  return ghostIfIndexes;
}

// Infers the manufacturer from sysDescr keywords first, then the sysObjectID enterprise
// number. Mirrors the breadth of LibreNMS's os discovery for the common vendors.
function guessVendor(sysDescr?: string, sysObjectId?: string): string {
  const d = (sysDescr ?? '').toLowerCase();
  const byKeyword: [RegExp, string][] = [
    [/cisco/, 'Cisco'],
    [/juniper|junos/, 'Juniper'],
    [/mikrotik|routeros/, 'MikroTik'],
    [/fortinet|fortigate|fortios/, 'Fortinet'],
    [/\bf5\b|big-ip|\btmos\b/, 'F5'],
    [/palo alto|pan-os/, 'Palo Alto'],
    [/sonicwall/, 'SonicWall'],
    [/check ?point/, 'Check Point'],
    [/sophos/, 'Sophos'],
    [/watchguard/, 'WatchGuard'],
    [/poweredge|idrac|powerconnect|force10|\bdell\b/, 'Dell'],
    [/lenovo|xclarity/, 'Lenovo'],
    [/\bibm\b/, 'IBM'],
    [/supermicro/, 'Supermicro'],
    [/arista/, 'Arista'],
    [/extreme|\bexos\b/, 'Extreme'],
    [/brocade|foundry/, 'Brocade'],
    [/ruckus/, 'Ruckus'],
    [/aruba|procurve/, 'Aruba'],
    [/huawei/, 'Huawei'],
    [/h3c|comware/, 'H3C'],
    [/3com/, '3Com'],
    [/ubiquiti|unifi|edgeos|edgeswitch|edgerouter/, 'Ubiquiti'],
    [/netgear/, 'Netgear'],
    [/zyxel/, 'Zyxel'],
    [/tp-?link/, 'TP-Link'],
    [/d-?link/, 'D-Link'],
    [/ruijie/, 'Ruijie'],
    [/nokia|alcatel|timos|isam/, 'Nokia'],
    [/vmware|esxi/, 'VMware'],
    [/synology/, 'Synology'],
    [/qnap/, 'QNAP'],
    [/pure storage|flasharray|purity/, 'Pure Storage'],
    [/proxmox/, 'Proxmox'],
    [/pfsense|opnsense|netgate/, 'Netgate'],
    [/hikvision/, 'Hikvision'],
    [/dahua/, 'Dahua'],
    [/schneider|smart-ups|\bapc\b/, 'APC'],
    [/eaton/, 'Eaton'],
    [/vertiv|liebert/, 'Vertiv'],
    [/cyberpower/, 'CyberPower'],
    [/proliant|hewlett|\bhpe?\b/, 'HPE'],
    [/windows|microsoft/, 'Microsoft'],
    [/linux/, 'Linux'],
  ];
  for (const [re, name] of byKeyword) if (re.test(d)) return name;

  const oid = sysObjectId ?? '';
  const byEnterprise: [string, string][] = [
    ['1.3.6.1.4.1.9.', 'Cisco'],
    ['1.3.6.1.4.1.2636.', 'Juniper'],
    ['1.3.6.1.4.1.12356', 'Fortinet'],
    ['1.3.6.1.4.1.3375', 'F5'],
    ['1.3.6.1.4.1.25461', 'Palo Alto'],
    ['1.3.6.1.4.1.8741', 'SonicWall'],
    ['1.3.6.1.4.1.2620', 'Check Point'],
    ['1.3.6.1.4.1.14988', 'MikroTik'],
    ['1.3.6.1.4.1.674.', 'Dell'],
    ['1.3.6.1.4.1.19046', 'Lenovo'],
    ['1.3.6.1.4.1.2.3.51', 'IBM'],
    ['1.3.6.1.4.1.10297', 'Supermicro'],
    ['1.3.6.1.4.1.30065', 'Arista'],
    ['1.3.6.1.4.1.1916', 'Extreme'],
    ['1.3.6.1.4.1.1991', 'Brocade'],
    ['1.3.6.1.4.1.25053', 'Ruckus'],
    ['1.3.6.1.4.1.14823', 'Aruba'],
    ['1.3.6.1.4.1.2011', 'Huawei'],
    ['1.3.6.1.4.1.25506', 'H3C'],
    ['1.3.6.1.4.1.43.', '3Com'],
    ['1.3.6.1.4.1.41112', 'Ubiquiti'],
    ['1.3.6.1.4.1.4526', 'Netgear'],
    ['1.3.6.1.4.1.890', 'Zyxel'],
    ['1.3.6.1.4.1.11863', 'TP-Link'],
    ['1.3.6.1.4.1.171', 'D-Link'],
    ['1.3.6.1.4.1.4881', 'Ruijie'],
    ['1.3.6.1.4.1.6527', 'Nokia'],
    ['1.3.6.1.4.1.637', 'Nokia'],
    ['1.3.6.1.4.1.6876', 'VMware'],
    ['1.3.6.1.4.1.6574', 'Synology'],
    ['1.3.6.1.4.1.24681', 'QNAP'],
    ['1.3.6.1.4.1.40482', 'Pure Storage'],
    ['1.3.6.1.4.1.318', 'APC'],
    ['1.3.6.1.4.1.534', 'Eaton'],
    ['1.3.6.1.4.1.476', 'Vertiv'],
    ['1.3.6.1.4.1.3808', 'CyberPower'],
    ['1.3.6.1.4.1.11.', 'HPE'],
    ['1.3.6.1.4.1.311.', 'Microsoft'],
    ['1.3.6.1.4.1.8072.', 'Linux'],
  ];
  for (const [p, name] of byEnterprise) if (oid.startsWith(p) || oid.startsWith(`.${p}`)) return name;
  return 'Unknown';
}

// Infers the device category from vendor/sysDescr/sysObjectId. Returns undefined when
// nothing matches confidently, so the caller keeps the existing (user-chosen) type.
function guessType(vendor: string, sysDescr?: string, model?: string): string | undefined {
  const descr = (sysDescr ?? '').toLowerCase();
  const modelText = (model ?? '').toLowerCase();
  const combined = `${descr} ${modelText}`;

  // Firewalls first — a FortiGate/SRX/ASA is a firewall even if "router"/"switch" appears.
  if (vendor === 'Fortinet' || /fortigate|firewall|\basa\b|palo alto|pan-os|sonicwall|check ?point|sophos|watchguard/.test(descr)) {
    return 'firewall';
  }
  if (/\bsrx\d/.test(combined)) return 'firewall';

  // F5 BIG-IP / TMOS appliances (LTM/GTM/ASM). Keep type compatible with current UI set.
  if (vendor === 'F5' || /\bbig-ip\b|\bltm\b|\bgtm\b|\btmos\b/.test(combined)) return 'server';

  // UPS / power.
  if (vendor === 'APC' || vendor === 'Eaton' || vendor === 'Vertiv' || vendor === 'CyberPower' || /\bups\b|smart-ups/.test(descr)) {
    return 'ups';
  }

  // Wireless controllers / access points.
  if (/wireless|access point|\bwlc\b|aironet|unifi ap/.test(combined)) return 'wireless';

  // NAS / storage appliances.
  if (vendor === 'Synology' || vendor === 'QNAP' || vendor === 'Pure Storage' || /\bnas\b|synology|qnap|flasharray|pure storage/.test(combined)) return 'storage';

  // Switches — Catalyst/CBS/Nexus, classic Cisco WS-C access lines, Juniper EX/QFX,
  // or any explicit "switch" marker in the description.
  if (
    /switch|catalyst|\bc1000\b|\bws-c\d+|\b2960\b|\bcbs\d|nexus|nx-os|nxos|\bn[2-9]k-|\bex\d{2,}|\bqfx|powerconnect|exos|edgeswitch/.test(
      combined,
    )
  )
    return 'switch';

  // Routers — explicit "router" or Juniper MX / Cisco ISR/ASR families.
  if (/\brouter\b|\bmx\d|\bisr\b|\basr\b|routeros|mikrotik|edgerouter/.test(combined)) return 'router';

  // Servers / hypervisors.
  if (vendor === 'VMware' || /esxi|vmware|proliant|poweredge|xclarity|windows server|ubuntu|debian|centos|red hat|\bserver\b/.test(combined)) {
    return 'server';
  }

  return undefined;
}

// Clean OS-family name (no version — the version lives in the firmware field). Prefers the
// detected vendor so it stays correct even when sysDescr is a customized hostname string.
function guessOs(vendor: string, sysDescr?: string): string | undefined {
  const descr = sysDescr ?? '';
  if (vendor === 'Dell' || /\bidrac\b/i.test(descr)) return 'Dell iDRAC';
  if (vendor === 'Fortinet' || /fortios|fortigate/i.test(descr)) return 'FortiOS';
  if (vendor === 'F5' || /big-ip|tmos/i.test(descr)) return 'F5 TMOS';
  if (vendor === 'Juniper' || /junos/i.test(descr)) return 'JunOS';
  if (/ios-xe/i.test(descr)) return 'Cisco IOS-XE';
  if (/nx-os|nexus/i.test(descr)) return 'Cisco NX-OS';
  if (/ios/i.test(descr) || vendor === 'Cisco') return 'Cisco IOS';
  if (vendor === 'MikroTik' || /routeros/i.test(descr)) return 'RouterOS';
  if (vendor === 'Pure Storage' || /purity|flasharray/i.test(descr)) return 'Purity';
  if (vendor === 'Arista' || /\beos\b/i.test(descr)) return 'Arista EOS';
  if (vendor === 'Palo Alto' || /pan-os/i.test(descr)) return 'PAN-OS';
  if (/exos|extremexos/i.test(descr)) return 'ExtremeXOS';
  if (vendor === 'Huawei' || /\bvrp\b/i.test(descr)) return 'Huawei VRP';
  if (vendor === '3Com') return '3Com OS';
  if (vendor === 'H3C' || /comware/i.test(descr)) return 'Comware';
  if (/esxi|vmware/i.test(descr)) return 'VMware ESXi';
  if (/windows/i.test(descr)) return 'Windows';
  if (/linux/i.test(descr)) return 'Linux';
  return descr ? descr.slice(0, 60) : undefined;
}

// Windows build-number → friendly release name, split by edition the same way LibreNMS's
// Windows.php does (sysObjectID .1=Client/Workstation, .2=Server, .3=Server Datacenter),
// since a handful of build numbers (14393, 17763, 20348, 26100...) are shared between the
// client and server product lines and would otherwise print a misleading combined name.
const WINDOWS_CLIENT_BUILDS: Array<[number, string]> = [
  [26100, 'Windows 11 24H2'],
  [22631, 'Windows 11 23H2'],
  [22621, 'Windows 11 22H2'],
  [22000, 'Windows 11 21H2'],
  [19045, 'Windows 10 22H2'],
  [19044, 'Windows 10 21H2'],
  [19043, 'Windows 10 21H1'],
  [19042, 'Windows 10 20H2'],
  [19041, 'Windows 10 2004'],
  [18363, 'Windows 10 1909'],
  [18362, 'Windows 10 1903'],
  [17763, 'Windows 10 1809'],
  [17134, 'Windows 10 1803'],
  [16299, 'Windows 10 1709'],
  [14393, 'Windows 10 1607'],
  [9600, 'Windows 8.1'],
  [9200, 'Windows 8'],
  [7601, 'Windows 7 SP1'],
  [7600, 'Windows 7'],
];
const WINDOWS_SERVER_BUILDS: Array<[number, string]> = [
  [26100, 'Windows Server 2025 (24H2)'],
  [20348, 'Windows Server 2022 (21H2)'],
  [17763, 'Windows Server 2019 (1809)'],
  [16299, 'Windows Server 2016 (1709)'],
  [14393, 'Windows Server 2016 (1607)'],
  [9600, 'Windows Server 2012 R2'],
  [9200, 'Windows Server 2012'],
  [7601, 'Windows Server 2008 R2 SP1'],
  [7600, 'Windows Server 2008 R2'],
  [6002, 'Windows Server 2008 SP2'],
  [6001, 'Windows Server 2008'],
];
// Legacy fallback for pre-10.0 builds and any sysDescr without a recognizable edition OID.
const WINDOWS_BUILD_NAMES: Record<string, string> = {
  '6.0': 'Windows Vista / Server 2008',
  '6.1': 'Windows 7 / Server 2008 R2',
  '6.2': 'Windows 8 / Server 2012',
  '6.3': 'Windows 8.1 / Server 2012 R2',
};

// CPU architecture token (from "Hardware: Intel64 Family 6 Model 44 ...") → friendly name.
// Mirrors LibreNMS's Windows.php parseHardware().
const WINDOWS_ARCH_NAMES: Record<string, string> = {
  amd64: 'AMD x64',
  intel64: 'Intel x64',
  em64t: 'Intel x64',
  x86: 'Generic x86',
  ia64: 'Intel Itanium IA64',
};

// Windows SNMP agent's sysObjectID enterprise suffix identifies the product edition.
function windowsEdition(sysObjectId?: string): 'client' | 'server' | 'datacenter' | undefined {
  const oid = (sysObjectId ?? '').replace(/^\./, '');
  if (oid === '1.3.6.1.4.1.311.1.1.3.1.1') return 'client';
  if (oid === '1.3.6.1.4.1.311.1.1.3.1.2') return 'server';
  if (oid === '1.3.6.1.4.1.311.1.1.3.1.3') return 'datacenter';
  return undefined;
}

// Parses "Hardware: Intel64 Family 6 Model 44 Stepping 2 AT/AT COMPATIBLE - Software:
// Windows Version 6.3 (Build 20348 Multiprocessor Free)" into its components.
function parseWindowsSysDescr(sysDescr: string) {
  const m = sysDescr.match(/hardware:\s*(\S+).*?-\s*software:.*version\s+(\d+\.\d+)\s*\(build(?:\s+number:)?\s+(\d+)\s*(\S+)?/i);
  if (!m) return undefined;
  const [, archToken, ntVersion, buildStr, smp] = m;
  return {
    hardware: WINDOWS_ARCH_NAMES[archToken.toLowerCase()],
    ntVersion,
    build: Number(buildStr),
    multiprocessor: smp ? /multi/i.test(smp) : undefined,
  };
}

/** CPU architecture (e.g. "Intel x64") parsed from a Windows sysDescr, used as the model field. */
function guessWindowsHardware(sysDescr?: string): string | undefined {
  if (!sysDescr) return undefined;
  return parseWindowsSysDescr(sysDescr)?.hardware;
}

/**
 * Best-effort OS version/distro string from sysDescr — precise for Windows (build-number +
 * edition lookup, see WINDOWS_CLIENT_BUILDS/WINDOWS_SERVER_BUILDS) and common Linux distros
 * (kernel-release suffix heuristics: -generic (Ubuntu), .el7/8/9 (RHEL/CentOS/Rocky/Alma),
 * .amzn2 (Amazon Linux)). Falls back to the raw kernel release when the distro can't be
 * identified. Exact distro/edition names beyond this require SSH-based `/etc/os-release` or
 * `systeminfo` (not implemented).
 */
function guessOsVersion(sysDescr?: string, sysObjectId?: string): string | undefined {
  const descr = sysDescr ?? '';

  const idracVersion = extractDellIdracVersion(descr);
  if (idracVersion) return idracVersion;

  const win = parseWindowsSysDescr(descr);
  if (win) {
    const { ntVersion, build, multiprocessor } = win;
    const edition = windowsEdition(sysObjectId);
    let name: string | undefined;
    // Windows Server (and some Win10/11 builds) misreport the legacy "Version 6.3" NT
    // number via sysDescr even on modern builds (the classic GetVersionEx compat-shim
    // lie), so the modern-vs-legacy branch must be keyed off the build number, not
    // ntVersion — matches LibreNMS's Windows.php (`$build > 10000`).
    if (build > 10000) {
      if (edition === 'server' || edition === 'datacenter') {
        name = WINDOWS_SERVER_BUILDS.find(([b]) => build >= b)?.[1];
        if (name && edition === 'datacenter') name += ' Datacenter';
      } else {
        name = WINDOWS_CLIENT_BUILDS.find(([b]) => build >= b)?.[1];
      }
      name ??= `Windows 10/11 (Build ${build})`;
    } else {
      name = WINDOWS_BUILD_NAMES[ntVersion] ? `${WINDOWS_BUILD_NAMES[ntVersion]} (Build ${build})` : `Windows ${ntVersion} (Build ${build})`;
    }
    return multiprocessor !== undefined ? `${name} (${multiprocessor ? 'Multiprocessor' : 'Uniprocessor'})` : name;
  }
  if (/windows/i.test(descr)) return descr.slice(0, 60);

  const linuxMatch = descr.match(/^linux\s+\S+\s+(\S+)/i);
  if (linuxMatch) {
    const kernel = linuxMatch[1];
    if (/ubuntu/i.test(descr)) return `Ubuntu Linux (kernel ${kernel})`;
    if (/debian/i.test(descr)) return `Debian Linux (kernel ${kernel})`;
    if (/\bsuse\b/i.test(descr)) return `SUSE Linux (kernel ${kernel})`;
    const elMatch = kernel.match(/\.el(\d+)/i);
    if (elMatch) return `RHEL/CentOS/Rocky/Alma ${elMatch[1]} (kernel ${kernel})`;
    if (/\.amzn2023\b/i.test(kernel)) return `Amazon Linux 2023 (kernel ${kernel})`;
    if (/\.amzn2\b/i.test(kernel)) return `Amazon Linux 2 (kernel ${kernel})`;
    return `Linux (kernel ${kernel})`;
  }
  if (/linux/i.test(descr)) return descr.slice(0, 60);

  return undefined;
}


const ENT_PHYSICAL_CLASS_CHASSIS = 3;

interface DeviceIdentity {
  model?: string;
  serial?: string;
  firmware?: string;
}

interface UpsIdentity {
  manufacturer?: string;
  model?: string;
  firmware?: string;
}

// UPS-MIB (RFC 1628) ident. A responding manufacturer/model — or a valid battery status —
// marks the device as a UPS and yields the real vendor + model, so the device type and
// vendor are auto-detected from SNMP instead of any user-selected preset value. Falls back
// to APC PowerNet-MIB for APC/Schneider cards that expose only that MIB. Reads are single
// gets so an SNMPv1 card (whole-PDU failure on a missing OID) still detects correctly.
async function readUpsIdentity(session: Parameters<typeof snmpWalkColumn>[0]): Promise<UpsIdentity | null> {
  try {
    const [manuVb, modelVb, fwVb, battVb] = await Promise.all([
      snmpGetSingle(session, OID.upsIdentManufacturer),
      snmpGetSingle(session, OID.upsIdentModel),
      snmpGetSingle(session, OID.upsIdentUpsSoftwareVersion),
      snmpGetSingle(session, OID.upsBatteryStatus),
    ]);
    const manufacturer = cleanVal(varbindToString(manuVb));
    const model = cleanVal(varbindToString(modelVb));
    const firmware = cleanVal(varbindToString(fwVb));
    if (manufacturer || model || varbindToNumber(battVb) !== undefined) {
      return { manufacturer: manufacturer ?? 'UPS', model, firmware };
    }
  } catch {
    // Not RFC 1628 — fall through to APC PowerNet.
  }

  try {
    const [modelVb, fwVb] = await Promise.all([
      snmpGetSingle(session, OID.apcIdentModel),
      snmpGetSingle(session, OID.apcIdentFirmwareRev),
    ]);
    const model = cleanVal(varbindToString(modelVb));
    if (model) return { manufacturer: 'APC', model, firmware: cleanVal(varbindToString(fwVb)) };
  } catch {
    // Not an APC UPS either.
  }
  return null;
}

function cleanVal(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Applies FortiGate model-prefix normalization (mirrors LibreNMS hardware_replace). */
function normalizeFortiModel(model?: string): string | undefined {
  if (!model) return undefined;
  return model
    .replace(/^FGR_/, 'FortiGate Rugged ')
    .replace(/^FGT_VM64/, 'FortiGate VM')
    .replace(/^FGT_/, 'FortiGate ')
    .replace(/^FWF_/, 'FortiWiFi ');
}

// jnxBoxDescr is verbose ("node0 Juniper SRX340 Internet Router"); extract just the model
// token (SRX340) so the vendor label isn't duplicated in the UI's "Vendor / Model" cell.
function normalizeJuniperModel(raw?: string, sysDescr?: string): string | undefined {
  const token =
    cleanVal(raw)?.match(/\b((?:SRX|MX|EX|QFX|ACX|PTX|NFX|MAG|SSG|J)\d{2,4}[\w-]*)\b/i)?.[1] ??
    sysDescr?.match(/\b((?:SRX|MX|EX|QFX|ACX|PTX|NFX)\d{2,4}[\w-]*)\b/i)?.[1];
  if (token) return token.toUpperCase();
  // Fallback: drop chassis-cluster "nodeN " prefix and trailing "Internet Router".
  return cleanVal(raw)
    ?.replace(/^node\d+\s+/i, '')
    .replace(/\s+Internet Router$/i, '')
    .replace(/^Juniper\s+/i, '');
}

function normalizeDellModel(raw?: string): string | undefined {
  const model = cleanVal(raw);
  if (!model) return undefined;
  return /^dell\b/i.test(model) ? model : `Dell ${model}`;
}

function normalizeF5Model(sysDescr?: string): string | undefined {
  if (!sysDescr) return undefined;
  const m = sysDescr.match(/\b(BIG-IP(?:\s+[A-Za-z0-9_-]+){0,4})\b/i);
  return cleanVal(m?.[1])?.replace(/\s*:\s*linux.*$/i, '').trim();
}

function extractF5Firmware(sysDescr?: string): string | undefined {
  if (!sysDescr) return undefined;
  const m =
    sysDescr.match(/(?:BIG-IP|TMOS)[^\d]*([0-9]+(?:\.[0-9]+){1,3})/i) ??
    sysDescr.match(/\b([0-9]+(?:\.[0-9]+){2,4})\b/);
  return cleanVal(m?.[1]);
}

/**
 * Reads accurate hardware model, serial number and firmware version.
 *
 * Mirrors LibreNMS's strategy: a vendor-neutral ENTITY-MIB pass (getMainSerial +
 * entity discovery) provides model/serial/software for ANY device that implements
 * the standard MIB, and vendor branches only override fields where a cleaner
 * vendor OID exists (Juniper JUNIPER-MIB, FortiGate fgSysVersion, Cisco Small
 * Business CISCOSB-MIB, MikroTik MIKROTIK-MIB). Firmware always falls back through
 * vendor OID -> entPhysicalSoftwareRev -> sysDescr so new models keep working.
 */
async function readIdentity(
  session: Parameters<typeof snmpWalkColumn>[0],
  ctx: { vendor?: string; sysDescr?: string; sysObjectId?: string; hostname?: string; deviceName?: string },
): Promise<DeviceIdentity> {
  const { sysDescr, sysObjectId } = ctx;

  // Vendor-neutral baseline from ENTITY-MIB (works for most enterprise gear).
  const entity = await readEntity(session);
  let model = entity.model ?? guessModel(sysDescr, ctx.hostname, ctx.deviceName);
  let serial = entity.serial;
  let firmware: string | undefined;

  const juniper = ctx.vendor === 'Juniper' || (sysObjectId?.startsWith('1.3.6.1.4.1.2636') ?? false);
  const fortinet = ctx.vendor === 'Fortinet' || (sysObjectId?.startsWith('1.3.6.1.4.1.12356') ?? false);
  const f5 = ctx.vendor === 'F5' || (sysObjectId?.startsWith('1.3.6.1.4.1.3375') ?? false);
  const mikrotik = ctx.vendor === 'MikroTik' || (sysObjectId?.startsWith('1.3.6.1.4.1.14988') ?? false);
  const dell = ctx.vendor === 'Dell' || (sysObjectId?.startsWith('1.3.6.1.4.1.674.') ?? false);
  const ciscoSb = /Catalyst 1[23]00 Series/i.test(sysDescr ?? '') || (sysObjectId?.startsWith('1.3.6.1.4.1.9.6.1.') ?? false);
  const cisco = !ciscoSb && (ctx.vendor === 'Cisco' || (sysObjectId?.startsWith('1.3.6.1.4.1.9.') ?? false));

  try {
    if (juniper) {
      const vb = await snmpGet(session, [OID.jnxBoxDescr, OID.jnxBoxSerialNo]);
      model = normalizeJuniperModel(varbindToString(vb[0]), sysDescr) ?? model;
      serial = cleanVal(varbindToString(vb[1])) ?? serial;
      firmware = await readJuniperFirmware(session, sysDescr);
    } else if (fortinet) {
      const vb = await snmpGet(session, [OID.fgSysVersion]);
      model = normalizeFortiModel(entity.model) ?? model;
      firmware = cleanVal(varbindToString(vb[0]));
    } else if (f5) {
      model = normalizeF5Model(sysDescr) ?? model;
      firmware = extractF5Firmware(sysDescr) ?? entity.softwareRev;
    } else if (mikrotik) {
      const vb = await snmpGet(session, [OID.mtxrSerialNumber, OID.mtxrLicVersion]);
      model = cleanVal(sysDescr?.match(/RouterOS\s+(.+)/i)?.[1]) ?? model;
      serial = cleanVal(varbindToString(vb[0])) ?? serial;
      firmware = cleanVal(varbindToString(vb[1]));
    } else if (dell) {
      const [idracModel, idracServiceTag, legacyModel, legacyServiceTag] = await Promise.all([
        snmpGetSingle(session, OID.dellChassisModelName),
        snmpGetSingle(session, OID.dellChassisServiceTagName),
        snmpGetSingle(session, OID.dellLegacyChassisModelName),
        snmpGetSingle(session, OID.dellLegacyChassisServiceTagName),
      ]);
      model = normalizeDellModel(varbindToString(idracModel)) ?? normalizeDellModel(varbindToString(legacyModel)) ?? model;
      serial = cleanVal(varbindToString(idracServiceTag)) ?? cleanVal(varbindToString(legacyServiceTag)) ?? serial;
      firmware = extractDellIdracVersion(sysDescr) ?? entity.softwareRev;
    } else if (ciscoSb) {
      const vb = await snmpGet(session, [OID.ciscosbModelName, OID.ciscosbSerialNum, OID.ciscosbSoftwareVersion]);
      // rlPhdUnitGenParamSoftwareVersion is the running image version (e.g. 4.1.3.36); sysDescr has no version.
      model = cleanVal(varbindToString(vb[0])) ?? model;
      serial = cleanVal(varbindToString(vb[1])) ?? serial;
      firmware = cleanVal(varbindToString(vb[2]));
    } else if (cisco) {
      // sysDescr "..., Version 15.2(4)E10, ..." is authoritative; entPhysicalSoftwareRev backs it up.
      firmware = extractFirmware(sysDescr) ?? entity.softwareRev;
    }
  } catch (err) {
    logger.debug({ err }, 'Vendor-specific identity read failed; using ENTITY-MIB baseline');
  }

  // Universal firmware fallback chain so unrecognised vendors still populate the field.
  firmware ??= extractFirmware(sysDescr) ?? entity.softwareRev;

  return { model, serial, firmware };
}

interface EntityInfo {
  model?: string;
  serial?: string;
  softwareRev?: string;
}

// Reads the chassis entity from ENTITY-MIB. Selects the "main" physical entity the way
// LibreNMS does (top-level entPhysicalContainedIn==0, else class==chassis, else lowest
// index) and returns its model/serial/software. Serial uses getMainSerial() fallback:
// any non-empty serial is better than none. Works for any vendor implementing ENTITY-MIB.
async function readEntity(session: Parameters<typeof snmpWalkColumn>[0]): Promise<EntityInfo> {
  try {
    const [classes, contained, models, descrs, names, serials, swRevs] = await Promise.all([
      snmpWalkColumn(session, OID.entPhysicalClass),
      snmpWalkColumn(session, OID.entPhysicalContainedIn),
      snmpWalkColumn(session, OID.entPhysicalModelName),
      snmpWalkColumn(session, OID.entPhysicalDescr),
      snmpWalkColumn(session, OID.entPhysicalName),
      snmpWalkColumn(session, OID.entPhysicalSerialNum),
      snmpWalkColumn(session, OID.entPhysicalSoftwareRev),
    ]);

    const indexes = [...new Set([...classes.keys(), ...models.keys(), ...serials.keys()])].sort((a, b) => a - b);
    if (indexes.length === 0) return {};

    const isChassis = (i: number) => varbindToNumber(classes.get(i)) === ENT_PHYSICAL_CLASS_CHASSIS;
    const isTopLevel = (i: number) => varbindToNumber(contained.get(i)) === 0;
    const mainIdx =
      indexes.find((i) => isTopLevel(i) && isChassis(i)) ??
      indexes.find((i) => isChassis(i)) ??
      indexes.find((i) => isTopLevel(i)) ??
      indexes[0];

    const firstNonEmpty = (col: Map<number, VarBind>, prefer: (i: number) => boolean): string | undefined =>
      cleanVal(varbindToString(col.get(indexes.find((i) => prefer(i) && cleanVal(varbindToString(col.get(i))) !== undefined) ?? -1))) ??
      cleanVal(varbindToString(col.get(indexes.find((i) => cleanVal(varbindToString(col.get(i))) !== undefined) ?? -1)));

    const model =
      cleanVal(varbindToString(models.get(mainIdx))) ??
      firstNonEmpty(models, isChassis) ??
      cleanVal(varbindToString(names.get(mainIdx))) ??
      cleanVal(varbindToString(descrs.get(mainIdx)));
    const serial = firstNonEmpty(serials, isTopLevel) ?? firstNonEmpty(serials, isChassis);
    const softwareRev = cleanVal(varbindToString(swRevs.get(mainIdx))) ?? firstNonEmpty(swRevs, isChassis);

    return { model, serial, softwareRev };
  } catch {
    // Device does not implement ENTITY-MIB.
    return {};
  }
}

// Juniper running JUNOS version, following LibreNMS Junos::discoverOS priority:
// jnxVirtualChassisMemberSWVersion → hrSWInstalledName JUNOS package → sysDescr "kernel JUNOS".
async function readJuniperFirmware(
  session: Parameters<typeof snmpWalkColumn>[0],
  sysDescr?: string,
): Promise<string | undefined> {
  try {
    const vb = await snmpGet(session, [`${OID.jnxVirtualChassisMemberSWVersion}.0`]);
    const v = cleanVal(varbindToString(vb[0]));
    if (v) return v;
  } catch {
    // Not a virtual-chassis member.
  }
  try {
    const names = await snmpWalkColumn(session, OID.hrSWInstalledName);
    for (const vb of names.values()) {
      const name = varbindToString(vb) ?? '';
      const m = name.match(/^JUNOS.*\[([^\]]+)\]/) ?? name.match(/^junos-evo.*?(\d+\.\d+.*)$/);
      if (m) return cleanVal(m[1]);
    }
  } catch {
    // HOST-RESOURCES-MIB not available.
  }
  return cleanVal(sysDescr?.match(/kernel JUNOS ([^, ]+)/i)?.[1]);
}

// Extracts a running firmware/software version token from sysDescr. Prefers a token that
// looks like a real version (has digits + a dot, e.g. "V03.03.00s168", "12.2(55)SE") so it
// doesn't grab a vendor word like "3Com" after the literal "Version".
function extractFirmware(sysDescr?: string): string | undefined {
  if (!sysDescr) return undefined;
  const idracVersion = extractDellIdracVersion(sysDescr);
  if (idracVersion) return idracVersion;
  const m =
    sysDescr.match(/(?:Software\s+Version|Version|Ver\.?|Release)\s*:?\s*(?:3Com OS\s+)?(V?\d[\w().-]*\.[\w().-]+)/i) ??
    sysDescr.match(/\b(V\d+\.\d+[\w().-]*)\b/i);
  return cleanVal(m?.[1]);
}

function extractDellIdracVersion(sysDescr?: string): string | undefined {
  if (!sysDescr) return undefined;
  const m = sysDescr.match(/\bidrac\b\s*(?:version\s*)?(\d+(?:\.\d+){1,5})/i);
  return cleanVal(m?.[1]);
}

/** Extracts a likely model string from sysDescr using per-vendor patterns. */
function guessModel(...candidates: Array<string | undefined>): string | undefined {
  const patterns: RegExp[] = [
    // Cisco: Catalyst (WS-C3560, C9300), ISR/ASR routers, Aironet APs, Nexus.
    /\b(WS-C\w+[\w-]*)\b/i,
    /\b(C9\d{3}[\w-]*)\b/i,
    /\b(N\d{1,2}K-[\w-]+)\b/,
    /\b((?:ISR|ASR|CISCO)\d{3,4}[\w/-]*)\b/i,
    /\b(AIR-\w+[\w-]*)\b/i,
    // Juniper: MX/EX/SRX/QFX/ACX/PTX series.
    /\b((?:MX|EX|SRX|QFX|ACX|PTX)\d{3,4}[\w-]*)\b/i,
    // HP/HPE/Aruba ProCurve: 2530-48G, 2930F, 5406R, JL/JG/Jxxxx part numbers.
    /\b(J[LGH]\d{3}[A-Z]?)\b/,
    /\b(\d{4}[A-Z]?-\d{2,3}G?[\w-]*)\b/,
    // H3C / 3Com / Comware: S5560, S5130, LS-5120.
    /\b((?:LS-)?S\d{3,4}[\w-]*)\b/i,
  ];
  for (const text of candidates) {
    if (!text) continue;
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) return m[1].toUpperCase();
    }
  }
  return undefined;
}
