import { apiClient } from './apiClient';
import {
  RawDevice,
  RawAlert,
  RawAlertRule,
  RawService,
  RawEvent,
  RawTopology,
  mapDevice,
  mapAlert,
  mapAlertRule,
  mapService,
  mapEvent,
} from './adapters';
import { NetworkDevice, NetworkAlert, AlertRule, ServiceCheck, EventLog, TopologyNode, TopologyLink, NotificationChannel, NotificationChannelInput, AppUser, DeviceMetricPoint, PollerHealth, DeviceGroup, DeviceGroupInput, DeviceNeighbor, PortMetricPoint, AlertRuleInput, AlertRuleCopyInput, AlertRuleCopyResult, AlertRuleApplySitesInput, AlertRuleApplySitesResult, MapNode, MapLink, MapLinkInput, SubnetScanResult, Dashboard, DashboardInput, ProcessorSeries, SensorSeries, AlertRenotifySettings, ServiceMethodInput, SiteInfo } from '../types';

export interface CreateDeviceInput {
  name: string;
  hostname: string;
  ip: string;
  type?: string; // optional: auto-detected via SNMP discovery when omitted
  location?: string;
  rack?: string;
  groupId?: string | null;
  siteId?: string | null;
  snmpVersion: 'v1' | 'v2c' | 'v3';
  snmpCommunity?: string;
  snmpPort?: number;
  pingOnly?: boolean;
}

export interface CreateServiceInput {
  name: string;
  type: ServiceMethodInput['type'];
  target: string;
  port?: number;
  siteId?: string | null;
}

export interface CreateServiceBatchInput {
  name: string;
  target: string;
  methods: ServiceMethodInput[];
  siteId?: string | null;
}

interface SubnetScanJobResponse {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  results?: SubnetScanResult[];
  error?: string;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export const api = {
  devices: {
    list: async (siteId?: string | null): Promise<NetworkDevice[]> => {
      const q = typeof siteId === 'string' && siteId.length > 0 ? `?siteId=${encodeURIComponent(siteId)}` : '';
      const raw = await apiClient.get<RawDevice[]>(`/devices${q}`);
      return raw.map(mapDevice);
    },
    listFull: async (): Promise<NetworkDevice[]> => {
      const raw = await apiClient.get<RawDevice[]>('/devices?include=full');
      return raw.map(mapDevice);
    },
    get: async (id: string): Promise<NetworkDevice> => {
      const raw = await apiClient.get<RawDevice>(`/devices/${id}`);
      return mapDevice(raw);
    },
    create: async (input: CreateDeviceInput): Promise<NetworkDevice> => {
      const raw = await apiClient.post<RawDevice>('/devices', input);
      return mapDevice(raw);
    },
    update: async (id: string, patch: Partial<CreateDeviceInput>): Promise<NetworkDevice> => {
      const raw = await apiClient.put<RawDevice>(`/devices/${id}`, patch);
      return mapDevice(raw);
    },
    remove: (id: string): Promise<void> => apiClient.delete(`/devices/${id}`),
    bulkDelete: (ids: string[]): Promise<{ deleted: number; deletedIds: string[]; skippedIds: string[] }> =>
      apiClient.post('/devices/bulk-delete', { ids }),
    pollNow: (id: string): Promise<{ queued: boolean }> => apiClient.post(`/devices/${id}/poll-now`),
    metrics: (id: string, hours: number): Promise<DeviceMetricPoint[]> =>
      apiClient.get<DeviceMetricPoint[]>(`/devices/${id}/metrics?hours=${hours}`),
    processorMetrics: (id: string, hours: number): Promise<ProcessorSeries[]> =>
      apiClient.get<ProcessorSeries[]>(`/devices/${id}/processors/metrics?hours=${hours}`),
    sensorMetrics: (id: string, type: string, hours: number): Promise<SensorSeries[]> =>
      apiClient.get<SensorSeries[]>(`/devices/${id}/sensors/metrics?type=${encodeURIComponent(type)}&hours=${hours}`),
    scanSubnet: async (input: { subnet: string; snmpVersion: string; snmpCommunity?: string; snmpPort?: number }): Promise<SubnetScanResult[]> => {
      const start = await apiClient.post<SubnetScanJobResponse>('/devices/scan-subnet/start', input, 15_000);
      const startedAt = Date.now();
      const maxWaitMs = 8 * 60_000;

      while (Date.now() - startedAt < maxWaitMs) {
        await delay(1500);
        const job = await apiClient.get<SubnetScanJobResponse>(`/devices/scan-subnet/jobs/${start.jobId}`, 15_000);
        if (job.status === 'completed') return job.results ?? [];
        if (job.status === 'failed') {
          throw new Error(job.error || 'Quét subnet thất bại.');
        }
      }

      throw new Error('Quét subnet mất quá nhiều thời gian. Vui lòng thử dải nhỏ hơn (/28 hoặc /29).');
    },
    bulkAdd: (
      devices: { name: string; ip: string; type?: string; siteId?: string | null; snmpVersion: string; snmpCommunity?: string; pingOnly?: boolean }[],
    ): Promise<{ created: { id: string; ip: string }[]; skipped: { ip: string; reason: string }[] }> =>
      apiClient.post('/devices/bulk', { devices }),
  },

  alerts: {
    list: async (siteId?: string | null): Promise<NetworkAlert[]> => {
      // Realtime console needs unresolved alerts only; fetching resolved rows can
      // crowd out active/acknowledged rows under the source window cap.
      const params = new URLSearchParams({ status: 'open', limit: '500' });
      if (typeof siteId === 'string' && siteId.length > 0) params.set('siteId', siteId);
      const q = `?${params.toString()}`;
      const raw = await apiClient.get<RawAlert[]>(`/alerts${q}`);
      return raw.map(mapAlert);
    },
    acknowledge: async (id: string, by: string): Promise<NetworkAlert> => {
      const raw = await apiClient.post<RawAlert>(`/alerts/${id}/acknowledge`, { by });
      return mapAlert(raw);
    },
    resolve: async (id: string): Promise<NetworkAlert> => {
      const raw = await apiClient.post<RawAlert>(`/alerts/${id}/resolve`);
      return mapAlert(raw);
    },
  },

  alertRules: {
    list: async (siteId?: string | null): Promise<AlertRule[]> => {
      const q = typeof siteId === 'string' && siteId.length > 0 ? `?siteId=${encodeURIComponent(siteId)}` : '';
      const raw = await apiClient.get<RawAlertRule[]>(`/alert-rules${q}`);
      return raw.map(mapAlertRule);
    },
    create: async (input: AlertRuleInput): Promise<AlertRule> => {
      const raw = await apiClient.post<RawAlertRule>('/alert-rules', input);
      return mapAlertRule(raw);
    },
    update: async (id: string, patch: Partial<RawAlertRule>): Promise<AlertRule> => {
      const raw = await apiClient.put<RawAlertRule>(`/alert-rules/${id}`, patch);
      return mapAlertRule(raw);
    },
    copyToSites: (id: string, input: AlertRuleCopyInput): Promise<AlertRuleCopyResult> =>
      apiClient.post<AlertRuleCopyResult>(`/alert-rules/${id}/copy-sites`, input),
    applySites: (id: string, input: AlertRuleApplySitesInput): Promise<AlertRuleApplySitesResult> =>
      apiClient.post<AlertRuleApplySitesResult>(`/alert-rules/${id}/apply-sites`, input),
    remove: (id: string): Promise<void> => apiClient.delete(`/alert-rules/${id}`),
  },

  // Global per-severity re-notify defaults (minutes), used when a rule leaves its own
  // renotifyMinutes at 0.
  renotifySettings: {
    get: (): Promise<AlertRenotifySettings> => apiClient.get<AlertRenotifySettings>('/alerts/renotify-settings'),
    update: (patch: Partial<AlertRenotifySettings>): Promise<AlertRenotifySettings> =>
      apiClient.put<AlertRenotifySettings>('/alerts/renotify-settings', patch),
  },

  services: {
    list: async (siteId?: string | null): Promise<ServiceCheck[]> => {
      const q = typeof siteId === 'string' && siteId.length > 0 ? `?siteId=${encodeURIComponent(siteId)}` : '';
      const raw = await apiClient.get<RawService[]>(`/services${q}`);
      return raw.map(mapService);
    },
    create: async (input: CreateServiceInput): Promise<ServiceCheck> => {
      const raw = await apiClient.post<RawService>('/services', input);
      return mapService(raw);
    },
    createBatch: async (input: CreateServiceBatchInput): Promise<ServiceCheck[]> => {
      const raw = await apiClient.post<{ created: RawService[] }>('/services/batch', input);
      return raw.created.map(mapService);
    },
    update: async (id: string, patch: Partial<CreateServiceInput>): Promise<ServiceCheck> => {
      const raw = await apiClient.put<RawService>(`/services/${id}`, patch);
      return mapService(raw);
    },
    remove: (id: string): Promise<void> => apiClient.delete(`/services/${id}`),
    checkNow: (id: string): Promise<{ queued: boolean }> => apiClient.post(`/services/${id}/check-now`),
  },

  events: {
    list: async (limit = 200, siteId?: string | null): Promise<EventLog[]> => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (typeof siteId === 'string' && siteId.length > 0) params.set('siteId', siteId);
      const raw = await apiClient.get<RawEvent[]>(`/events?${params.toString()}`);
      return raw.map(mapEvent);
    },
  },

  topology: {
    get: async (siteId?: string | null): Promise<{ nodes: TopologyNode[]; links: TopologyLink[] }> => {
      const q = typeof siteId === 'undefined' ? '' : `?siteId=${siteId ?? ''}`;
      const raw = await apiClient.get<RawTopology>(`/topology${q}`);
      const nodes: TopologyNode[] = raw.nodes.map((n, i) => ({
        id: n.id,
        label: n.label,
        ip: n.ip,
        type: n.type as TopologyNode['type'],
        status: n.status as TopologyNode['status'],
        x: 100 + (i % 5) * 180,
        y: 100 + Math.floor(i / 5) * 140,
        layer: 'access',
      }));
      const links: TopologyLink[] = raw.links.map((l, i) => ({
        id: `link-${i}`,
        source: l.source,
        target: l.target,
        sourceInterface: l.sourcePort,
        targetInterface: l.targetPort ?? '',
        speed: l.protocol.toUpperCase(),
        utilizationPercent: 0,
        status: 'up',
      }));
      return { nodes, links };
    },
  },

  notificationChannels: {
    list: (): Promise<NotificationChannel[]> => apiClient.get<NotificationChannel[]>('/notification-channels'),
    create: (input: NotificationChannelInput): Promise<NotificationChannel> =>
      apiClient.post<NotificationChannel>('/notification-channels', input),
    update: (id: string, patch: Partial<NotificationChannelInput>): Promise<NotificationChannel> =>
      apiClient.put<NotificationChannel>(`/notification-channels/${id}`, patch),
    remove: (id: string): Promise<void> => apiClient.delete(`/notification-channels/${id}`),
    test: (type: string, config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
      apiClient.post('/notification-channels/test', { type, config }),
  },

  account: {
    changePassword: (currentPassword: string, newPassword: string): Promise<{ ok: boolean }> =>
      apiClient.post('/auth/change-password', { currentPassword, newPassword }),
  },

  users: {
    list: (): Promise<AppUser[]> => apiClient.get<AppUser[]>('/users'),
    create: (input: { username: string; password: string; role: string; siteIds?: string[] }): Promise<AppUser> =>
      apiClient.post<AppUser>('/users', input),
    update: (id: string, patch: { role?: string; siteIds?: string[] }): Promise<AppUser> =>
      apiClient.put<AppUser>(`/users/${id}`, patch),
    resetPassword: (id: string, newPassword: string): Promise<{ ok: boolean }> =>
      apiClient.post(`/users/${id}/reset-password`, { newPassword }),
    remove: (id: string): Promise<void> => apiClient.delete(`/users/${id}`),
  },

  sites: {
    list: (): Promise<SiteInfo[]> => apiClient.get<SiteInfo[]>('/sites'),
    create: (input: { name: string; code?: string; description?: string }): Promise<SiteInfo> =>
      apiClient.post<SiteInfo>('/sites', input),
    update: (id: string, patch: { name?: string; code?: string; description?: string }): Promise<SiteInfo> =>
      apiClient.put<SiteInfo>(`/sites/${id}`, patch),
    remove: (id: string): Promise<void> => apiClient.delete(`/sites/${id}`),
  },

  pollerHealth: {
    get: (): Promise<PollerHealth> => apiClient.get<PollerHealth>('/poller-health'),
  },

  deviceGroups: {
    list: (siteId?: string | null): Promise<DeviceGroup[]> => {
      const q = typeof siteId === 'undefined' ? '' : `?siteId=${siteId ?? ''}`;
      return apiClient.get<DeviceGroup[]>(`/device-groups${q}`);
    },
    create: (input: DeviceGroupInput): Promise<DeviceGroup> => apiClient.post<DeviceGroup>('/device-groups', input),
    update: (id: string, patch: Partial<DeviceGroupInput>): Promise<DeviceGroup> =>
      apiClient.put<DeviceGroup>(`/device-groups/${id}`, patch),
    remove: (id: string): Promise<void> => apiClient.delete(`/device-groups/${id}`),
  },

  deviceNeighbors: {
    list: (deviceId: string): Promise<DeviceNeighbor[]> =>
      apiClient.get<DeviceNeighbor[]>(`/devices/${deviceId}/neighbors`),
  },

  ports: {
    metrics: (portId: string, hours: number): Promise<PortMetricPoint[]> =>
      apiClient.get<PortMetricPoint[]>(`/ports/${portId}/metrics?hours=${hours}`),
  },

  topologyMap: {
    get: (siteId?: string | null): Promise<{ nodes: MapNode[]; links: MapLink[] }> => {
      const q = typeof siteId === 'undefined' ? '' : `?siteId=${siteId ?? ''}`;
      return apiClient.get<{ nodes: MapNode[]; links: MapLink[] }>(`/topology/map${q}`);
    },
    addNode: (input: { deviceId?: string; kind?: string; label?: string; icon?: string; x?: number; y?: number }): Promise<MapNode> =>
      apiClient.post<MapNode>('/topology/map/nodes', input),
    moveNode: (id: string, x: number, y: number): Promise<MapNode> =>
      apiClient.put<MapNode>(`/topology/map/nodes/${id}`, { x, y }),
    removeNode: (id: string): Promise<void> => apiClient.delete(`/topology/map/nodes/${id}`),
    addLink: (input: MapLinkInput): Promise<MapLink> => apiClient.post<MapLink>('/topology/map/links', input),
    removeLink: (id: string): Promise<void> => apiClient.delete(`/topology/map/links/${id}`),
  },

  dashboards: {
    list: (): Promise<Dashboard[]> => apiClient.get<Dashboard[]>('/dashboards'),
    get: (id: string): Promise<Dashboard> => apiClient.get<Dashboard>(`/dashboards/${id}`),
    create: (input: DashboardInput): Promise<Dashboard> => apiClient.post<Dashboard>('/dashboards', input),
    update: (id: string, patch: Partial<DashboardInput>): Promise<Dashboard> =>
      apiClient.put<Dashboard>(`/dashboards/${id}`, patch),
    remove: (id: string): Promise<void> => apiClient.delete(`/dashboards/${id}`),
  },
};
