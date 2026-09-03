import {
  NetworkDevice,
  NetworkInterface,
  NetworkAlert,
  AlertRule,
  ServiceCheck,
  EventLog,
  DeviceType,
  DeviceStatus,
  AlertSeverity,
  AlertStatus,
} from '../types';

/**
 * Adapters that translate raw Prisma-shaped JSON payloads returned by the
 * backend REST API into the UI's existing view-model types (types.ts).
 *
 * Important: Prisma `BigInt` columns (ifSpeed, in/outOctets, in/outErrors,
 * in/outDiscards) are serialized as strings by the backend's BigInt JSON
 * patch, so they must be converted with `Number()` before arithmetic/display.
 */

export interface RawPort {
  id: string;
  ifIndex: number;
  ifName: string;
  ifAlias?: string | null;
  ifDescr?: string | null;
  ifType?: string | null;
  ifSpeed: string | number;
  ifPhysAddress?: string | null;
  ifAdminStatus: string;
  ifOperStatus: string;
  inOctets: string | number;
  outOctets: string | number;
  inErrors: string | number;
  outErrors: string | number;
  inDiscards: string | number;
  outDiscards: string | number;
  inRateBps: number;
  outRateBps: number;
  utilization: number;
}

export interface RawDevice {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  type: string;
  vendor?: string | null;
  model?: string | null;
  firmware?: string | null;
  serial?: string | null;
  os?: string | null;
  osVersion?: string | null;
  sysObjectId?: string | null;
  sysDescr?: string | null;
  location?: string | null;
  rack?: string | null;
  status: string;
  uptimeSeconds: number;
  snmpVersion: string;
  snmpCommunity?: string | null;
  cpuUsage: number;
  cpuCount?: number | null;
  memoryUsage: number;
  totalMemoryBytes?: number | null;
  temperature?: number | null;
  pingLatencyMs?: number | null;
  packetLoss: number;
  disabled?: boolean;
  lastPolled?: string | null;
  groupId?: string | null;
  siteId?: string | null;
  ports?: RawPort[];
  sensors?: RawSensor[];
  hardwareComponents?: RawHardwareComponent[];
  vlans?: RawVlan[];
}

export interface RawVlan {
  id: string;
  vlanId: number;
  name: string;
  ports?: { untagged: boolean; port: { id: string; ifName: string } }[];
}

export interface RawSensor {
  id: string;
  type: string;
  index: string;
  description: string;
  value: number | null;
  unit: string;
  status: string;
}

export interface RawHardwareComponent {
  id: string;
  entityIndex: number;
  parentEntityIndex?: number | null;
  name: string;
  description: string;
  class: string;
  model?: string | null;
  serial?: string | null;
  hardwareRev?: string | null;
  softwareRev?: string | null;
  isFru: boolean;
  operStatus?: string | null;
  adminStatus?: string | null;
  alarmStatus?: string | null;
  healthStatus: string;
}

export interface RawAlert {
  id: string;
  deviceId?: string | null;
  serviceId?: string | null;
  device?: { name: string; ip: string } | null;
  service?: { name: string; target: string; type: string; port?: number | null } | null;
  rule?: { name: string } | null;
  interfaceName?: string | null;
  message: string;
  severity: string;
  status: string;
  timestamp: string;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  metricValue?: string | null;
}

export interface RawAlertRule {
  id: string;
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  unit: string;
  severity: string;
  enabled: boolean;
  description?: string | null;
  scope?: string | null;
  deviceId?: string | null;
  serviceId?: string | null;
  serviceIds?: string[] | null;
  portId?: string | null;
  groupId?: string | null;
  groupIds?: string[] | null;
  groupNames?: string[] | null;
  siteId?: string | null;
  portIds?: string[] | null;
  sensorId?: string | null;
  sensorIds?: string[] | null;
  sensorType?: string | null;
  osFilter?: string | null;
  renotifyMinutes?: number | null;
  device?: { name: string } | null;
  port?: { ifName: string } | null;
  group?: { name: string } | null;
  service?: { name: string; target: string; type: string; port?: number | null } | null;
  sensor?: { description: string; unit: string; type: string } | null;
}

export interface RawService {
  id: string;
  name: string;
  type: string;
  target: string;
  port?: number | null;
  status: string;
  responseTimeMs: number;
  uptimePercent: number;
  lastCheck?: string | null;
  siteId?: string | null;
}

export interface RawEvent {
  id: string;
  timestamp: string;
  deviceId?: string | null;
  device?: { name: string } | null;
  facility: string;
  severity: string;
  message: string;
}

export interface RawTopologyNode {
  id: string;
  label: string;
  ip: string;
  type: string;
  status: string;
  external?: boolean;
}

export interface RawTopologyLink {
  source: string;
  target: string;
  sourcePort: string;
  targetPort?: string;
  protocol: string;
}

export interface RawTopology {
  nodes: RawTopologyNode[];
  links: RawTopologyLink[];
}

export function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return 'N/A';
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(bps % 1_000_000_000 === 0 ? 0 : 1)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(bps % 1_000_000 === 0 ? 0 : 1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

export function formatUptime(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0 ngày, 00:00:00';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${days} ngày, ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function mapPortToInterface(p: RawPort, vlanByPortId?: Map<string, number>): NetworkInterface {
  const speedBps = Number(p.ifSpeed) || 0;
  return {
    id: p.id,
    name: p.ifName,
    alias: p.ifAlias ?? undefined,
    // "Description" column shows the admin-configured interface description (ifAlias),
    // not ifDescr (which is the system-generated interface name/type).
    description: p.ifAlias ?? '',
    type: p.ifType ?? 'ethernetCsmacd',
    speed: formatSpeed(speedBps),
    speedBps,
    adminStatus: p.ifAdminStatus === 'up' ? 'up' : 'down',
    operStatus: p.ifOperStatus === 'up' ? 'up' : p.ifOperStatus === 'testing' ? 'testing' : 'down',
    macAddress: p.ifPhysAddress ?? '',
    ipAddress: undefined,
    vlan: vlanByPortId?.get(p.id),
    inRateBps: p.inRateBps ?? 0,
    outRateBps: p.outRateBps ?? 0,
    inErrors: Number(p.inErrors) || 0,
    outErrors: Number(p.outErrors) || 0,
    inDiscards: Number(p.inDiscards) || 0,
    outDiscards: Number(p.outDiscards) || 0,
    utilization: p.utilization ?? 0,
    history: [],
  };
}

export function mapDevice(raw: RawDevice): NetworkDevice {
  const ports = raw.ports ?? [];
  const vlans = raw.vlans ?? [];
  // A port's "access VLAN" (shown in the Interfaces table) is the VLAN it belongs
  // to untagged; ports with no untagged membership (pure trunk ports) show none.
  const vlanByPortId = new Map<string, number>();
  for (const v of vlans) {
    for (const p of v.ports ?? []) {
      if (p.untagged) vlanByPortId.set(p.port.id, v.vlanId);
    }
  }
  return {
    id: raw.id,
    name: raw.name,
    hostname: raw.hostname,
    ip: raw.ip,
    type: (raw.type as DeviceType) ?? 'server',
    vendor: raw.vendor ?? '',
    model: raw.model ?? '',
    firmware: raw.firmware ?? '',
    serial: raw.serial ?? '',
    os: raw.os ?? '',
    osVersion: raw.osVersion ?? undefined,
    sysObjectID: raw.sysObjectId ?? '',
    sysDescr: raw.sysDescr ?? '',
    location: raw.location ?? '',
    rack: raw.rack ?? '',
    status: (raw.status as DeviceStatus) ?? 'down',
    uptime: formatUptime(raw.uptimeSeconds),
    uptimeSeconds: raw.uptimeSeconds ?? 0,
    snmpVersion: (raw.snmpVersion as 'v1' | 'v2c' | 'v3') ?? 'v2c',
    community: raw.snmpCommunity ?? undefined,
    cpuUsage: raw.cpuUsage ?? 0,
    cpuCount: raw.cpuCount ?? undefined,
    memoryUsage: raw.memoryUsage ?? 0,
    totalMemoryBytes: raw.totalMemoryBytes ?? undefined,
    temperature: raw.temperature ?? 0,
    pingLatencyMs: raw.pingLatencyMs ?? 0,
    packetLoss: raw.packetLoss ?? 0,
    disabled: raw.disabled ?? false,
    interfacesCount: ports.length,
    interfaces: ports.map((p) => mapPortToInterface(p, vlanByPortId)),
    sensors: (raw.sensors ?? []).map((s) => ({
      id: s.id,
      type: s.type,
      index: s.index,
      description: s.description,
      value: s.value,
      unit: s.unit ?? '',
      status: s.status ?? 'ok',
    })),
    hardwareComponents: (raw.hardwareComponents ?? []).map((c) => ({
      id: c.id,
      entityIndex: c.entityIndex,
      parentEntityIndex: c.parentEntityIndex ?? null,
      name: c.name,
      description: c.description,
      class: c.class,
      model: c.model ?? undefined,
      serial: c.serial ?? undefined,
      hardwareRev: c.hardwareRev ?? undefined,
      softwareRev: c.softwareRev ?? undefined,
      isFru: c.isFru,
      operStatus: c.operStatus ?? undefined,
      adminStatus: c.adminStatus ?? undefined,
      alarmStatus: c.alarmStatus ?? undefined,
      healthStatus: c.healthStatus ?? 'unknown',
    })),
    vlans: vlans.map((v) => ({
      id: v.id,
      vlanId: v.vlanId,
      name: v.name,
      ports: (v.ports ?? []).map((p) => ({ portId: p.port.id, portName: p.port.ifName, untagged: p.untagged })),
    })),
    lastPolled: raw.lastPolled ? new Date(raw.lastPolled).toLocaleString('vi-VN') : 'Chưa quét',
    groupId: raw.groupId ?? null,
    siteId: raw.siteId ?? null,
  };
}

export function mapAlert(raw: RawAlert): NetworkAlert {
  const entityName = raw.device?.name ?? raw.service?.name ?? 'Service';
  const entityTarget = raw.device?.ip ?? raw.service?.target ?? '';
  return {
    id: raw.id,
    deviceId: raw.deviceId ?? raw.serviceId ?? '',
    deviceName: entityName,
    deviceIp: entityTarget,
    interfaceName: raw.interfaceName ?? undefined,
    ruleName: raw.rule?.name ?? 'Manual/System',
    message: raw.message,
    severity: raw.severity as AlertSeverity,
    status: raw.status as AlertStatus,
    timestamp: new Date(raw.timestamp).toLocaleString('vi-VN'),
    acknowledgedBy: raw.acknowledgedBy ?? undefined,
    acknowledgedAt: raw.acknowledgedAt ? new Date(raw.acknowledgedAt).toLocaleString('vi-VN') : undefined,
    resolvedAt: raw.resolvedAt ? new Date(raw.resolvedAt).toLocaleString('vi-VN') : undefined,
    metricValue: raw.metricValue ?? undefined,
  };
}

export function mapAlertRule(raw: RawAlertRule): AlertRule {
  return {
    id: raw.id,
    name: raw.name,
    metric: raw.metric as AlertRule['metric'],
    condition: raw.condition as AlertRule['condition'],
    threshold: raw.threshold,
    unit: raw.unit,
    severity: raw.severity as AlertSeverity,
    enabled: raw.enabled,
    description: raw.description ?? '',
    scope: (raw.scope as AlertRule['scope']) ?? 'device',
    deviceId: raw.deviceId ?? null,
    serviceId: raw.serviceId ?? null,
    serviceIds: raw.serviceIds ?? [],
    portId: raw.portId ?? null,
    groupId: raw.groupId ?? null,
    groupIds: raw.groupIds ?? [],
    siteId: raw.siteId ?? null,
    portIds: raw.portIds ?? [],
    sensorId: raw.sensorId ?? null,
    sensorIds: raw.sensorIds ?? [],
    sensorType: raw.sensorType ?? null,
    osFilter: raw.osFilter ?? null,
    renotifyMinutes: raw.renotifyMinutes ?? 0,
    deviceName: raw.device?.name ?? null,
    portName: raw.port?.ifName ?? null,
    groupName: raw.group?.name ?? null,
    groupNames: raw.groupNames ?? [],
    sensorLabel: raw.sensor?.description ?? null,
    serviceName: raw.service?.name ?? null,
    serviceTarget: raw.service?.target ?? null,
  };
}

export function mapService(raw: RawService): ServiceCheck {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type as ServiceCheck['type'],
    target: raw.target,
    port: raw.port ?? undefined,
    status: raw.status === 'up' ? 'up' : raw.status === 'warning' ? 'warning' : 'down',
    responseTimeMs: raw.responseTimeMs,
    uptimePercent: raw.uptimePercent,
    lastCheck: raw.lastCheck ? new Date(raw.lastCheck).toLocaleString('vi-VN') : 'Chưa kiểm tra',
    siteId: raw.siteId ?? null,
  };
}

export function mapEvent(raw: RawEvent): EventLog {
  return {
    id: raw.id,
    timestamp: new Date(raw.timestamp).toLocaleString('vi-VN'),
    deviceId: raw.deviceId ?? '',
    deviceName: raw.device?.name ?? 'System',
    facility: raw.facility === 'snmp_trap' ? 'snmp-trap' : (raw.facility as EventLog['facility']),
    severity: raw.severity as EventLog['severity'],
    message: raw.message,
  };
}
