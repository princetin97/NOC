import 'dotenv/config';
import * as snmp from 'net-snmp';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { publishEvent } from '../lib/events';
import { dispatchAlertNotification } from '../lib/notifications';

interface TrapNotification {
  pdu: { varbinds?: { oid: string; value: unknown }[] };
  rinfo: { address: string };
}

const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';
const IF_INDEX_OID = '1.3.6.1.2.1.2.2.1.1';
const IF_DESCR_OID = '1.3.6.1.2.1.2.2.1.2';
const IF_NAME_OID = '1.3.6.1.2.1.31.1.1.1.1';
const IF_OPER_STATUS_OID = '1.3.6.1.2.1.2.2.1.8';
const LINK_UP_TRAP_OID = '1.3.6.1.6.3.1.1.5.4';

const PORT_SECURITY_TRAP_OID_PREFIXES = [
  // CISCO-PORT-SECURITY-MIB
  '1.3.6.1.4.1.9.9.315',
  // Cisco err-disable notifications (often used when psecure violation shuts interface)
  '1.3.6.1.4.1.9.9.548',
];

const PORT_SECURITY_VIOLATION_KEYWORDS = [
  'port-security',
  'port security',
  'security violation',
  'psecure',
  'secure mac',
  'err-disable',
  'errdisable',
];

const PORT_SECURITY_RECOVERY_KEYWORDS = [
  'recovery',
  'recovered',
  'clear',
  'cleared',
  'normal',
  'up',
];

const LINK_UP_KEYWORDS = [
  'changed state to up',
  'line protocol on interface',
  'link-3-updown',
  'interface up',
  'link up',
];

const INTERFACE_TOKEN_REGEX =
  /\b(?:gigabitethernet|tengigabitethernet|fastethernet|ethernet|gi|te|fa|eth|port-channel|po)\s*\d+(?:\/\d+){0,3}(?:\.\d+)?\b/i;

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) {
    const ascii = value.toString('utf8').replace(/\0/g, '').trim();
    if (ascii) return ascii;
    return Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeIfName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[,:;()\[\]{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/^tengigabitethernet/, 'te')
    .replace(/^gigabitethernet/, 'gi')
    .replace(/^fastethernet/, 'fa')
    .replace(/^ethernet/, 'eth')
    .replace(/^port-channel/, 'po');
}

function extractInterfaceHint(values: string[]): string | undefined {
  for (const raw of values) {
    const match = raw.match(INTERFACE_TOKEN_REGEX);
    if (match?.[0]) {
      return match[0].replace(/\s+/g, '');
    }
  }
  return undefined;
}

function parseTrailingIndex(oid: string, prefix: string): number | undefined {
  if (!oid.startsWith(`${prefix}.`)) return undefined;
  const tail = oid.slice(prefix.length + 1).split('.')[0];
  const idx = Number(tail);
  return Number.isFinite(idx) && idx > 0 ? idx : undefined;
}

function parseCiscoIfIndexFromVendorOid(oid: string): number | undefined {
  const isCiscoPortSecurity = oid.startsWith('1.3.6.1.4.1.9.9.548.') || oid.startsWith('1.3.6.1.4.1.9.9.315.');
  if (!isCiscoPortSecurity) return undefined;

  const tokens = oid.split('.').map((p) => Number(p));
  if (tokens.some((n) => !Number.isFinite(n))) return undefined;
  if (tokens.length < 3) return undefined;

  const last = tokens[tokens.length - 1];
  const prev = tokens[tokens.length - 2];

  // Several Cisco notifications encode ifIndex as the last sub-id, while others
  // append an extra '.0' and place ifIndex one position before the tail.
  if (last === 0 && Number.isFinite(prev) && prev > 0) return prev;
  if (Number.isFinite(last) && last > 0) return last;
  return undefined;
}

interface PortSecurityRuleSnapshot {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  name: string;
}

async function ensurePortSecurityRule(siteId?: string | null): Promise<PortSecurityRuleSnapshot | null> {
  if (!siteId) return null;

  const existing = await prisma.alertRule.findFirst({
    where: { metric: 'port_security_trap', scope: 'interface', enabled: true, siteId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, severity: true, name: true },
  });

  if (!existing) return null;
  return { id: existing.id, severity: existing.severity, name: existing.name };
}

function detectTrapType(varbinds: { oid: string; value: unknown }[]): {
  isPortSecurity: boolean;
  isRecovery: boolean;
  isLinkUp: boolean;
  trapOid?: string;
  ifIndex?: number;
  ifNameHint?: string;
  macHint?: string;
  text: string;
} {
  let trapOid: string | undefined;
  let ifIndex: number | undefined;
  let ifNameHint: string | undefined;
  let macHint: string | undefined;
  let operStatusUpHint = false;
  const values: string[] = [];

  for (const vb of varbinds) {
    const text = valueToString(vb.value);
    if (text) values.push(text);

    if (vb.oid === SNMP_TRAP_OID && text) {
      trapOid = text;
    }

    if (vb.oid.startsWith(`${IF_INDEX_OID}.`)) {
      const v = Number(text);
      if (Number.isFinite(v) && v > 0) ifIndex = v;
    }

    const ifIndexFromOperStatus = parseTrailingIndex(vb.oid, IF_OPER_STATUS_OID);
    if (ifIndexFromOperStatus && !ifIndex) {
      ifIndex = ifIndexFromOperStatus;
    }

    if (vb.oid.startsWith(`${IF_OPER_STATUS_OID}.`)) {
      const status = Number(text);
      if (status === 1) operStatusUpHint = true;
    }

    if (vb.oid.startsWith(`${IF_NAME_OID}.`) && text) {
      ifNameHint = text;
    }

    if (!ifNameHint && vb.oid.startsWith(`${IF_DESCR_OID}.`) && text) {
      ifNameHint = text;
    }

    const ifIndexFromIfName = parseTrailingIndex(vb.oid, IF_NAME_OID);
    if (ifIndexFromIfName && !ifIndex) {
      ifIndex = ifIndexFromIfName;
    }

    const ifIndexFromIfDescr = parseTrailingIndex(vb.oid, IF_DESCR_OID);
    if (ifIndexFromIfDescr && !ifIndex) {
      ifIndex = ifIndexFromIfDescr;
    }

    const ifIndexFromCiscoVendor = parseCiscoIfIndexFromVendorOid(vb.oid);
    if (ifIndexFromCiscoVendor && !ifIndex) {
      ifIndex = ifIndexFromCiscoVendor;
    }

    if (!macHint) {
      const m = text.match(/([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}/);
      if (m) macHint = m[0].replace(/-/g, ':').toLowerCase();
    }
  }

  const joinedText = normalizeText(values.join(' | '));
  const oidMatched = !!trapOid && PORT_SECURITY_TRAP_OID_PREFIXES.some((p) => trapOid!.startsWith(p));
  const keywordMatched = PORT_SECURITY_VIOLATION_KEYWORDS.some((k) => joinedText.includes(k));
  if (!ifNameHint) {
    ifNameHint = extractInterfaceHint(values);
  }
  const isPortSecurity = oidMatched || keywordMatched;
  const isRecovery =
    isPortSecurity &&
    PORT_SECURITY_RECOVERY_KEYWORDS.some((k) => joinedText.includes(k)) &&
    !joinedText.includes('violation');
  const isLinkUpByTrapOid = trapOid === LINK_UP_TRAP_OID;
  const isLinkUpByKeyword = LINK_UP_KEYWORDS.some((k) => joinedText.includes(k)) && joinedText.includes('up');
  const isLinkUp = isLinkUpByTrapOid || isLinkUpByKeyword || operStatusUpHint;

  return {
    isPortSecurity,
    isRecovery,
    isLinkUp,
    trapOid,
    ifIndex,
    ifNameHint,
    macHint,
    text: joinedText,
  };
}

async function resolvePortLabel(deviceId: string, ifIndex?: number, ifNameHint?: string): Promise<string> {
  if (ifIndex) {
    const byIndex = await prisma.port.findFirst({ where: { deviceId, ifIndex }, select: { ifName: true } });
    if (byIndex?.ifName) return byIndex.ifName;
  }

  if (ifNameHint) {
    const normalizedHint = normalizeIfName(ifNameHint);
    const candidates = await prisma.port.findMany({
      where: { deviceId },
      select: { ifName: true, ifAlias: true, ifDescr: true },
    });

    const match = candidates.find((p) => {
      const ifName = normalizeIfName(p.ifName);
      const ifAlias = p.ifAlias ? normalizeIfName(p.ifAlias) : '';
      const ifDescr = p.ifDescr ? normalizeIfName(p.ifDescr) : '';
      return ifName === normalizedHint || ifAlias === normalizedHint || ifDescr === normalizedHint;
    });

    if (match?.ifName) return match.ifName;
    return ifNameHint;
  }

  return ifIndex ? `ifIndex-${ifIndex}` : 'unknown-port';
}

async function upsertPortSecurityAlert(params: {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  siteId?: string | null;
  portLabel: string;
  trapText: string;
  isRecovery: boolean;
  macHint?: string;
}): Promise<void> {
  const key = `PORT-SECURITY:${params.portLabel}`;
  const unknownKey = 'PORT-SECURITY:unknown-port';
  const open = await prisma.alert.findFirst({
    where: {
      deviceId: params.deviceId,
      serviceId: null,
      interfaceName: { in: [key, unknownKey] },
      status: { in: ['active', 'acknowledged'] },
    },
    orderBy: [{ interfaceName: 'asc' }, { timestamp: 'desc' }],
  });

  if (!params.isRecovery) {
    const rule = await ensurePortSecurityRule(params.siteId ?? null);
    // Global rules are templates-only. Without a site-specific trap rule,
    // we keep trap events but do not raise monitoring alerts.
    if (!rule) return;

    const ruleId = rule.id;
    const severity = rule.severity;
    const ruleName = rule.name;
    const message = params.macHint
      ? `Port security violation tại ${params.portLabel} (MAC lạ: ${params.macHint})`
      : `Port security violation tại ${params.portLabel}`;

    if (!open) {
      const created = await prisma.alert.create({
        data: {
          deviceId: params.deviceId,
          ruleId,
          interfaceName: key,
          message,
          severity,
          status: 'active',
          metricValue: 'Down',
          lastNotifiedAt: new Date(),
        },
      });
      await publishEvent('alert:new', created);
      await dispatchAlertNotification({
        deviceName: params.deviceName,
        deviceIp: params.deviceIp,
        message,
        severity,
        event: 'new',
        timestamp: created.timestamp,
        ruleName,
        siteId: params.siteId ?? null,
        objectName: params.portLabel,
        currentValue: 'Down',
      });
      return;
    }

    await prisma.alert.update({
      where: { id: open.id },
      data: {
        ruleId,
        interfaceName: key,
        message,
        severity,
        status: open.status === 'acknowledged' ? 'acknowledged' : 'active',
        resolvedAt: null,
        timestamp: new Date(),
      },
    });
    return;
  }

  if (!open) return;

  const resolved = await prisma.alert.update({
    where: { id: open.id },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  await publishEvent('alert:resolved', resolved);
  await dispatchAlertNotification({
    deviceName: params.deviceName,
    deviceIp: params.deviceIp,
    message: `Port security đã khôi phục tại ${params.portLabel}`,
    severity: resolved.severity,
    event: 'resolved',
    timestamp: resolved.resolvedAt ?? new Date(),
    ruleName: 'Port Security Violation',
    siteId: params.siteId ?? null,
    objectName: params.portLabel,
    currentValue: 'Up',
  });
}

async function resolvePortSecurityAlertsByLinkUp(params: {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  siteId?: string | null;
  portLabel?: string;
}): Promise<void> {
  const key = params.portLabel ? `PORT-SECURITY:${params.portLabel}` : null;
  const candidates = await prisma.alert.findMany({
    where: {
      deviceId: params.deviceId,
      serviceId: null,
      status: { in: ['active', 'acknowledged'] },
      interfaceName: key ? { in: [key, 'PORT-SECURITY:unknown-port'] } : { startsWith: 'PORT-SECURITY:' },
    },
  });

  if (candidates.length === 0) return;

  for (const open of candidates) {
    const resolved = await prisma.alert.update({
      where: { id: open.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    await publishEvent('alert:resolved', resolved);
    await dispatchAlertNotification({
      deviceName: params.deviceName,
      deviceIp: params.deviceIp,
      message: `Port security đã khôi phục${params.portLabel ? ` tại ${params.portLabel}` : ''}`,
      severity: resolved.severity,
      event: 'resolved',
      timestamp: resolved.resolvedAt ?? new Date(),
      ruleName: 'Port Security Violation',
      siteId: params.siteId ?? null,
      objectName: params.portLabel ?? open.interfaceName?.replace('PORT-SECURITY:', '') ?? null,
      currentValue: 'Up',
    });
  }
}

async function syncOpenPortSecurityAlertsToRule(): Promise<void> {
  const rules = await prisma.alertRule.findMany({
    where: { metric: 'port_security_trap', scope: 'interface', enabled: true, siteId: { not: null } },
    select: { id: true, severity: true, siteId: true },
  });

  for (const rule of rules) {
    await prisma.alert.updateMany({
      where: {
        status: { in: ['active', 'acknowledged'] },
        interfaceName: { startsWith: 'PORT-SECURITY:' },
        device: { siteId: rule.siteId },
      },
      data: { severity: rule.severity, ruleId: rule.id },
    });
  }
}

const receiver = snmp.createReceiver(
  { port: env.snmpTrapPort, disableAuthorization: true, transport: 'udp4' },
  (error: Error | null, rawNotification: unknown) => {
    void handleNotification(error, rawNotification as TrapNotification);
  },
);

async function handleNotification(error: Error | null, notification: TrapNotification): Promise<void> {
  if (error) {
    logger.warn({ error }, 'SNMP trap parse error');
    return;
  }

  const varbinds = notification.pdu.varbinds ?? [];
  const message = varbinds.map((vb) => `${vb.oid}=${vb.value}`).join(', ');

  try {
    const device = await prisma.device.findFirst({ where: { ip: notification.rinfo.address } });
    const event = await prisma.eventLog.create({
      data: {
        deviceId: device?.id,
        facility: 'snmp_trap',
        severity: 'warning',
        message: message || 'SNMP trap received',
        rawSource: notification.rinfo.address,
      },
    });
    await publishEvent('event:new', event);

    if (device) {
      const parsed = detectTrapType(varbinds);
      if (parsed.isPortSecurity) {
        const portLabel = await resolvePortLabel(device.id, parsed.ifIndex, parsed.ifNameHint);
        await upsertPortSecurityAlert({
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          siteId: device.siteId,
          portLabel,
          trapText: parsed.text,
          isRecovery: parsed.isRecovery,
          macHint: parsed.macHint,
        });
      } else if (parsed.isLinkUp) {
        const portLabel = await resolvePortLabel(device.id, parsed.ifIndex, parsed.ifNameHint);
        await resolvePortSecurityAlertsByLinkUp({
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          siteId: device.siteId,
          portLabel: portLabel === 'unknown-port' ? undefined : portLabel,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to store SNMP trap');
  }
}

logger.info(`SNMP trap collector listening on port ${env.snmpTrapPort}`);

void syncOpenPortSecurityAlertsToRule().catch((err) => {
  logger.warn({ err }, 'Failed to sync open Port Security alert severities from rule');
});

process.on('SIGTERM', () => receiver.close());
