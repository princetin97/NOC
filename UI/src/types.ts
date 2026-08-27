export type DeviceStatus = 'up' | 'down' | 'warning' | 'maintenance';
export type DeviceType = 'router' | 'switch' | 'firewall' | 'server' | 'wireless' | 'storage' | 'ups';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type NotificationChannelType = 'email' | 'telegram' | 'webhook' | 'slack';

export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  minSeverity: AlertSeverity;
  siteId?: string | null;
  categories: string[];
  config: Record<string, unknown>;
  lastError?: string | null;
  lastSentAt?: string | null;
  createdAt: string;
}

export interface NotificationChannelInput {
  name: string;
  type: NotificationChannelType;
  enabled?: boolean;
  minSeverity?: AlertSeverity;
  siteId?: string | null;
  categories?: string[];
  config: Record<string, unknown>;
}

export interface SiteInfo {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// Global per-severity re-notify defaults (minutes) for Telegram/Slack while an alert
// stays active & unacknowledged. Used when a rule's own renotifyMinutes is 0 (unset).
export interface AlertRenotifySettings {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface AppUser {
  id: string;
  username: string;
  role: string;
  siteIds?: string[];
  isSystemAdmin?: boolean;
  createdAt: string;
}

export interface DeviceMetricPoint {
  id: string;
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  temperature: number | null;
  pingLatencyMs: number | null;
  packetLoss: number;
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface PollerHealth {
  queues: QueueStats[];
  devices: {
    total: number;
    down: number;
    stale: number;
    lastPolledAt: string | null;
  };
  timestamp: string;
}

export interface DeviceGroup {
  id: string;
  name: string;
  description: string | null;
  color: string;
  parentId?: string | null;
  siteId?: string | null;
  deviceCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceGroupInput {
  name: string;
  description?: string;
  color?: string;
  parentId?: string | null;
  siteId?: string | null;
}

export interface DeviceNeighbor {
  id: string;
  deviceId: string;
  protocol: 'lldp' | 'cdp';
  localPortName: string;
  remoteSysName: string | null;
  remoteChassisId: string | null;
  remotePortId: string | null;
  remotePortDescr: string | null;
  lastSeen: string;
}

export interface DeviceHardwareComponent {
  id: string;
  entityIndex: number;
  parentEntityIndex?: number | null;
  name: string;
  description: string;
  class: string;
  model?: string;
  serial?: string;
  hardwareRev?: string;
  softwareRev?: string;
  isFru: boolean;
  operStatus?: string;
  adminStatus?: string;
  alarmStatus?: string;
  healthStatus: string;
}

export interface PortMetricPoint {
  id: string;
  timestamp: string;
  inRateBps: number;
  outRateBps: number;
  inErrors: number | string;
  outErrors: number | string;
  utilization: number;
}

export interface NetworkInterface {
  id: string;
  name: string; // e.g., 'GigabitEthernet0/0/1', 'eth0', 'xe-0/0/0'
  alias?: string;
  description: string;
  type: string;
  speed: string; // '1 Gbps', '10 Gbps', '40 Gbps'
  speedBps: number;
  adminStatus: 'up' | 'down';
  operStatus: 'up' | 'down' | 'testing';
  macAddress: string;
  ipAddress?: string;
  vlan?: number;
  inRateBps: number; // bytes per sec
  outRateBps: number;
  inErrors: number;
  outErrors: number;
  inDiscards: number;
  outDiscards: number;
  utilization: number; // percentage 0-100
  history: {
    time: string;
    inRateKbps: number;
    outRateKbps: number;
  }[];
}

export interface NetworkDevice {
  id: string;
  name: string; // e.g., 'Core-Router-01'
  hostname: string; // e.g., 'cr01.hanoi.datacenter.net'
  ip: string;
  type: DeviceType;
  vendor: string; // 'Cisco', 'Juniper', 'Fortinet', 'MikroTik', 'Dell', 'Arista'
  model: string;
  firmware?: string;
  serial?: string;
  os: string;
  osVersion?: string;
  sysObjectID: string;
  sysDescr?: string;
  location: string;
  rack: string;
  status: DeviceStatus;
  uptime: string; // e.g., '142 days, 06:12:45'
  uptimeSeconds: number;
  snmpVersion: 'v1' | 'v2c' | 'v3';
  community?: string;
  cpuUsage: number; // percentage
  cpuCount?: number;
  memoryUsage: number; // percentage
  totalMemoryBytes?: number;
  temperature: number; // Celsius
  pingLatencyMs: number;
  packetLoss: number; // percentage
  disabled: boolean;
  interfacesCount: number;
  interfaces: NetworkInterface[];
  sensors?: DeviceSensor[];
  hardwareComponents?: DeviceHardwareComponent[];
  vlans?: DeviceVlan[];
  lastPolled: string;
  groupId?: string | null;
  siteId?: string | null;
}

export interface DeviceSensor {
  id: string;
  type: string; // temperature | fan | voltage | current | power | humidity | cpu | memory | disk | state | ...
  index: string;
  description: string;
  value: number | null;
  unit: string;
  status: string; // ok | warning | critical | unknown
}

// A VLAN discovered on a switch via Q-BRIDGE-MIB, with its member ports.
export interface DeviceVlan {
  id: string;
  vlanId: number;
  name: string;
  ports: { portId: string; portName: string; untagged: boolean }[];
}

// One processor's utilisation trend, as returned by GET /devices/:id/processors/metrics.
export interface ProcessorSeries {
  id: string;
  index: string;
  description: string;
  usage: number; // last polled percentage
  metrics: { timestamp: string; usage: number }[];
}

// One sensor's historical trend, as returned by GET /devices/:id/sensors/metrics?type=...
export interface SensorSeries {
  id: string;
  type: string;
  index: string;
  description: string;
  value: number | null; // last polled value
  unit: string;
  metrics: { timestamp: string; value: number }[];
}

// A configured vCenter connection used to inventory ESXi hosts/VMs.
export interface VirtualizationManager {
  id: string;
  name: string;
  endpoint: string;
  siteId: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { hosts: number };
}

// One ESXi host discovered under a vCenter manager.
export interface VirtualizationHost {
  id: string;
  managerId: string;
  externalId: string;
  name: string;
  powerState: string | null;
  connectionState: string | null;
  cpuMhz: number | null;
  cpuCores: number | null;
  memoryBytes: number | null;
  vmCount: number;
  cpuUsage: number | null;
  memoryUsage: number | null;
  inventorySummary: string | null;
  alertState: 'ok' | 'warning' | 'critical';
  lastSeenAt: string;
}

export type AlertMetric =
  | 'cpu'
  | 'memory'
  | 'ping'
  | 'temperature'
  | 'packet_loss'
  | 'uptime'
  | 'interface_traffic'
  | 'interface_traffic_in'
  | 'interface_traffic_out'
  | 'interface_utilization'
  | 'interface_status'
  | 'interface_errors'
  | 'interface_discards'
  | 'device_status'
  | 'bgp_session'
  | 'sensor_value'
  | 'service_status'
  | 'service_response_time'
  | 'service_uptime'
  | 'port_security_trap';

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  condition: '>' | '<' | '==' | '!=';
  threshold: number;
  unit: string;
  severity: AlertSeverity;
  enabled: boolean;
  description: string;
  scope?: 'device' | 'interface' | 'sensor' | 'service';
  deviceId?: string | null;
  deviceIds?: string[];
  serviceId?: string | null;
  serviceIds?: string[];
  portId?: string | null;
  groupId?: string | null;
  siteId?: string | null;
  portIds?: string[];
  sensorId?: string | null;
  sensorIds?: string[];
  sensorType?: string | null;
  osFilter?: string | null;
  renotifyMinutes?: number;
  deviceName?: string | null;
  portName?: string | null;
  groupName?: string | null;
  sensorLabel?: string | null;
  serviceName?: string | null;
  serviceTarget?: string | null;
}

export interface AlertRuleInput {
  name: string;
  metric: AlertMetric;
  condition: '>' | '<' | '==' | '!=';
  threshold: number;
  unit?: string;
  severity?: AlertSeverity;
  enabled?: boolean;
  description?: string;
  scope?: 'device' | 'interface' | 'sensor' | 'service';
  deviceId?: string | null;
  deviceIds?: string[];
  serviceId?: string | null;
  serviceIds?: string[];
  portId?: string | null;
  groupId?: string | null;
  siteId?: string | null;
  portIds?: string[];
  sensorId?: string | null;
  sensorIds?: string[];
  sensorType?: string | null;
  osFilter?: string | null;
  renotifyMinutes?: number;
}

export interface AlertRuleCopyInput {
  siteIds: string[];
  copyTargets?: boolean;
  skipIfExists?: boolean;
}

export interface AlertRuleCopyResult {
  sourceRuleId: string;
  sourceSiteId?: string | null;
  totalTargets: number;
  created: number;
  updated?: number;
  skipped: number;
  deduplicated?: number;
  targetSiteIds: string[];
  warnings?: string[];
}

export interface AlertRuleApplySitesInput {
  siteIds: string[];
  copyTargets?: boolean;
}

export interface AlertRuleApplySitesResult {
  sourceRuleId: string;
  appliedSiteIds: string[];
  created: number;
  updated: number;
  deduplicated: number;
  removed: number;
}

export interface NetworkAlert {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  interfaceName?: string;
  ruleName: string;
  message: string;
  severity: AlertSeverity;
  status: AlertStatus;
  timestamp: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  metricValue?: string;
}

export interface EventLog {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceName: string;
  facility: 'syslog' | 'snmp-trap' | 'system' | 'auth';
  severity: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info';
  message: string;
}

export interface ServiceCheck {
  id: string;
  name: string;
  type: 'PING' | 'HTTP' | 'HTTPS' | 'DNS' | 'SSH' | 'MYSQL' | 'BGP' | 'TCP';
  target: string;
  port?: number;
  status: 'up' | 'down' | 'warning';
  responseTimeMs: number;
  uptimePercent: number;
  lastCheck: string;
  siteId?: string | null;
}

export interface ServiceMethodInput {
  type: ServiceCheck['type'];
  port?: number;
}

export interface ServiceCreateRequest {
  name: string;
  target: string;
  siteId?: string | null;
  methods: ServiceMethodInput[];
}

export interface TopologyNode {
  id: string;
  label: string;
  ip: string;
  type: DeviceType;
  status: DeviceStatus;
  x: number;
  y: number;
  layer: 'core' | 'distribution' | 'access' | 'edge' | 'server';
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  sourceInterface: string;
  targetInterface: string;
  speed: string;
  utilizationPercent: number;
  status: 'up' | 'degraded' | 'down';
}

export interface GlobalTrafficPoint {
  time: string;
  inMbps: number;
  outMbps: number;
  pingMs: number;
  totalAlerts: number;
}

// Admin-drawn network map (persisted server-side).
export interface MapNode {
  id: string;
  deviceId: string | null;
  // "device" (backed by a monitored device) or a reference-only object kind
  // ("cloud" | "site" | "note") used purely for diagram context.
  kind: string;
  x: number;
  y: number;
  name: string;
  ip: string;
  type: string;
  status: DeviceStatus;
  icon?: string | null;
  siteId?: string | null;
}

export interface MapLink {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string | null;
  targetPortId?: string | null;
  label?: string | null;
  sourcePortName?: string | null;
  targetPortName?: string | null;
  inRateBps: number;
  outRateBps: number;
  utilization: number;
  operStatus: string;
}

export interface MapLinkInput {
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string | null;
  targetPortId?: string | null;
  label?: string | null;
}

export interface SubnetScanResult {
  ip: string;
  sysName: string | null;
  sysDescr: string | null;
  pingAlive: boolean;
  snmpAlive: boolean;
  pingLatencyMs: number | null;
  alreadyAdded: boolean;
}

// --- Customizable dashboards (NOC / TV monitor) --------------------------

export type WidgetType =
  | 'stat'            // single big metric (device count, up/down, active alerts, bandwidth)
  | 'traffic-chart'   // global in/out traffic over time
  | 'device-gauges'   // CPU/RAM/temperature gauges for one device
  | 'device-status'   // grid of devices with up/down status
  | 'alert-list'      // latest alerts
  | 'top-interfaces'  // top interfaces by utilization or bandwidth
  | 'top-devices'     // top devices by CPU / memory / temperature
  | 'clock'           // clock + custom title text (for TV headers)
  | 'text';           // free text / heading

// Which summary metric a `stat` widget shows.
export type StatMetric =
  | 'total-devices'
  | 'devices-up'
  | 'devices-down'
  | 'devices-warning'
  | 'active-alerts'
  | 'critical-alerts'
  | 'total-in-gbps'
  | 'total-out-gbps'
  | 'avg-ping';

// Traffic chart data source.
export type TrafficSource = 'global' | 'port';
// How the top-interfaces widget ranks ports.
export type PortSortBy = 'utilization' | 'bandwidth';
// Which device resource the top-devices widget ranks by.
export type DeviceMetric = 'cpu' | 'memory' | 'temperature';

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  // Grid position/size in 12-column units. `y` is the row, `h` is height in row units.
  x: number;
  y: number;
  w: number;
  h: number;
  config: {
    title?: string;
    statMetric?: StatMetric;
    deviceId?: string;
    portId?: string;
    groupId?: string | null;
    limit?: number;
    text?: string;
    accent?: string; // tailwind color key: emerald | red | amber | blue | violet | cyan
    source?: TrafficSource;
    hours?: number;
    sortBy?: PortSortBy;
    deviceMetric?: DeviceMetric;
    [key: string]: unknown;
  };
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  siteId?: string | null;
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardInput {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  siteId?: string | null;
  widgets?: DashboardWidget[];
}

