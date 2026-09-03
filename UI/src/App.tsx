/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { NetworkDevice, NetworkAlert, AlertRule, ServiceCheck, EventLog, GlobalTrafficPoint, AlertSeverity, SiteInfo } from './types';
import { soundManager } from './utils/audioAlert';
import { api } from './services/api';
import { isAuthenticated, getStoredUser, logout, AuthUser, refreshSession } from './services/authService';
import { getSocket, disconnectSocket } from './services/socket';

import { Header } from './components/Header';
import { Navigation, TabType } from './components/Navigation';
import { DashboardBuilder } from './components/DashboardBuilder';
import { DeviceManagement } from './components/DeviceManagement';
import { AlertConsole } from './components/AlertConsole';
import { NetworkTopology } from './components/NetworkTopology';
import { ServiceMonitoring } from './components/ServiceMonitoring';
import { AddDeviceModal } from './components/AddDeviceModal';
import { EditDeviceModal } from './components/EditDeviceModal';
import { ScanSubnetModal } from './components/ScanSubnetModal';
import { LoginScreen } from './components/LoginScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { SyslogConsole } from './components/SyslogConsole';
import { VirtualizationMonitor } from './components/VirtualizationMonitor';
import { getSelectedSiteId, setSelectedSiteId as persistSelectedSiteId } from './services/siteContext';

const MAX_TRAFFIC_POINTS = 30;
type TrafficChartMode = 'stacked' | 'mirrored';
const REALTIME_REFRESH_DEBOUNCE_MS = 2000;

// Path-based routing: each tab has its own URL so links/refresh land on the right view.
const TAB_PATHS: Record<TabType, string> = {
  overview: '/overview',
  devices: '/devices',
  alerts: '/alerts',
  syslog: '/syslog',
  topology: '/topology',
  services: '/services',
  virtualization: '/virtualization',
  settings: '/settings',
};
const PATH_TABS: Record<string, TabType> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as TabType]),
);

function tabFromPath(pathname: string): TabType {
  return PATH_TABS[pathname] ?? 'overview';
}

function trafficChartModeStorageKey(username?: string): string {
  return `trafficChartMode.${(username ?? 'anonymous').toLowerCase()}`;
}

function getStoredTrafficChartMode(username?: string): TrafficChartMode {
  if (typeof window === 'undefined') return 'mirrored';
  const raw = window.localStorage.getItem(trafficChartModeStorageKey(username));
  return raw === 'stacked' ? 'stacked' : 'mirrored';
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>(() => tabFromPath(window.location.pathname));
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(30); // 30s
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Auth state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => (isAuthenticated() ? getStoredUser() : null));
  const [trafficChartMode, setTrafficChartMode] = useState<TrafficChartMode>(() =>
    getStoredTrafficChartMode(getStoredUser()?.username),
  );

  // Domain State (populated from the real backend API once authenticated)
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [alerts, setAlerts] = useState<NetworkAlert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [services, setServices] = useState<ServiceCheck[]>([]);
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(() => getSelectedSiteId());
  const [trafficHistory, setTrafficHistory] = useState<GlobalTrafficPoint[]>([]);

  // Modals & Drawers
  const [selectedDevice, setSelectedDevice] = useState<NetworkDevice | null>(null);
  const [isAddDeviceOpen, setIsAddDeviceOpen] = useState<boolean>(false);
  const [editDevice, setEditDevice] = useState<NetworkDevice | null>(null);
  const [isScanOpen, setIsScanOpen] = useState<boolean>(false);
  const [quickSeverityFilter, setQuickSeverityFilter] = useState<AlertSeverity | null>(null);
  const [quickAlertTab, setQuickAlertTab] = useState<'alerts' | 'acknowledged' | null>(null);
  const [quickSeverityRequestKey, setQuickSeverityRequestKey] = useState<number>(0);
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>('Vừa xong');
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() => document.visibilityState !== 'hidden');

  // Sound manager sync
  useEffect(() => {
    soundManager.enabled = isSoundEnabled;
  }, [isSoundEnabled]);

  // Per-user chart mode preference for all traffic charts.
  useEffect(() => {
    setTrafficChartMode(getStoredTrafficChartMode(currentUser?.username));
  }, [currentUser?.username]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(trafficChartModeStorageKey(currentUser?.username), trafficChartMode);
  }, [currentUser?.username, trafficChartMode]);

  // --- Tab routing (path-based URLs) --------------------------------------

  const navigateTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
    if (window.location.pathname !== TAB_PATHS[tab]) {
      window.history.pushState({ tab }, '', TAB_PATHS[tab]);
    }
  }, []);

  // Sync tab state when the user uses the browser back/forward buttons.
  useEffect(() => {
    const onPopState = () => setActiveTab(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Canonicalize the URL on first load (e.g. "/" -> "/overview").
  useEffect(() => {
    const canonical = TAB_PATHS[activeTab];
    if (window.location.pathname !== canonical) {
      window.history.replaceState({ tab: activeTab }, '', canonical);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Data loading -------------------------------------------------------

  const refreshDevices = useCallback(async () => {
    const list = await api.devices.list(selectedSiteId);
    setDevices(list);
    return list;
  }, [selectedSiteId]);

  const refreshAlerts = useCallback(async () => {
    const list = await api.alerts.list(selectedSiteId);
    setAlerts(list);
    return list;
  }, [selectedSiteId]);

  const refreshAlertRules = useCallback(async () => {
    setAlertRules(await api.alertRules.list(selectedSiteId));
  }, [selectedSiteId]);

  const refreshServices = useCallback(async () => {
    setServices(await api.services.list(selectedSiteId));
  }, [selectedSiteId]);

  const refreshEvents = useCallback(async () => {
    setEventLogs(await api.events.list(200, selectedSiteId));
  }, [selectedSiteId]);

  const refreshSites = useCallback(async () => {
    setSites(await api.sites.list());
  }, []);

  const refreshAll = useCallback(async () => {
    setIsPolling(true);
    try {
      await Promise.all([
        refreshDevices(),
        refreshAlerts(),
        refreshAlertRules(),
        refreshServices(),
        refreshEvents(),
        refreshSites(),
      ]);
      setLastUpdatedTime(new Date().toLocaleTimeString());
    } finally {
      setIsPolling(false);
    }
  }, [refreshDevices, refreshAlerts, refreshAlertRules, refreshServices, refreshEvents, refreshSites]);

  const refreshHeartbeat = useCallback(async () => {
    await Promise.all([refreshDevices(), refreshAlerts()]);
  }, [refreshDevices, refreshAlerts]);

  const refreshByActiveTab = useCallback(async () => {
    const tasks: Array<Promise<unknown>> = [refreshDevices(), refreshAlerts()];
    if (activeTab === 'alerts') {
      tasks.push(refreshAlertRules(), refreshEvents(), refreshServices());
    } else if (activeTab === 'syslog') {
      tasks.push(refreshEvents());
    } else if (activeTab === 'services') {
      tasks.push(refreshServices());
    } else if (activeTab === 'settings') {
      tasks.push(refreshSites());
    }
    await Promise.all(tasks);
  }, [activeTab, refreshDevices, refreshAlerts, refreshAlertRules, refreshEvents, refreshServices, refreshSites]);

  useEffect(() => {
    persistSelectedSiteId(selectedSiteId);
  }, [selectedSiteId]);

  // Site-admin accounts must stay scoped to managed sites only (no global/all-sites view).
  useEffect(() => {
    if (!currentUser) return;
    const allowedSiteIds = new Set(sites.map((s) => s.id));
    const isSystemAdmin = currentUser.isSystemAdmin === true;

    if (isSystemAdmin) {
      if (selectedSiteId && !allowedSiteIds.has(selectedSiteId)) {
        setSelectedSiteId(null);
      }
      return;
    }

    if (sites.length === 0) {
      if (selectedSiteId !== null) setSelectedSiteId(null);
      return;
    }

    if (!selectedSiteId || !allowedSiteIds.has(selectedSiteId)) {
      setSelectedSiteId(sites[0].id);
    }
  }, [currentUser, sites, selectedSiteId]);

  const siteByDeviceId = useMemo(() => new Map(devices.map((d) => [d.id, d.siteId ?? null])), [devices]);
  const siteByServiceId = useMemo(() => new Map(services.map((s) => [s.id, s.siteId ?? null])), [services]);

  const filteredDevices = useMemo(
    () => (!selectedSiteId ? devices : devices.filter((d) => d.siteId === selectedSiteId)),
    [devices, selectedSiteId],
  );
  const filteredServices = useMemo(
    () => (!selectedSiteId ? services : services.filter((s) => s.siteId === selectedSiteId)),
    [services, selectedSiteId],
  );
  const filteredAlertRules = useMemo(
    () => (!selectedSiteId ? alertRules : alertRules.filter((r) => (r.siteId ?? null) === selectedSiteId)),
    [alertRules, selectedSiteId],
  );
  const filteredAlerts = useMemo(() => {
    if (!selectedSiteId) return alerts;
    return alerts.filter((a) => {
      const devSite = siteByDeviceId.get(a.deviceId);
      const svcSite = a.serviceId ? siteByServiceId.get(a.serviceId) : undefined;
      if (devSite === selectedSiteId || svcSite === selectedSiteId) return true;
      // Alert list API is already site-scoped; keep alerts that cannot be mapped
      // locally yet (race with device/service refresh) to avoid hiding valid traps.
      return typeof devSite === 'undefined' && typeof svcSite === 'undefined';
    });
  }, [alerts, selectedSiteId, siteByDeviceId, siteByServiceId]);
  const filteredEventLogs = useMemo(() => {
    if (!selectedSiteId) return eventLogs;
    return eventLogs.filter((e) => siteByDeviceId.get(e.deviceId) === selectedSiteId);
  }, [eventLogs, selectedSiteId, siteByDeviceId]);

  // Initial load + reload whenever the user logs in
  useEffect(() => {
    if (!currentUser) return;
    refreshAll().catch((err) => console.error('Failed to load initial data', err));
  }, [currentUser, refreshAll]);

  // Force logout whenever the API reports the token is no longer valid
  useEffect(() => {
    const handleUnauthorized = () => {
      logout();
      setCurrentUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // Sliding-session token refresh: renew the JWT periodically while the user is
  // active so long sessions do not expire mid-work (token TTL is 12h). Besides the
  // interval, also refresh right when the tab regains focus/visibility: browsers
  // throttle/suspend setInterval on long-backgrounded tabs (e.g. an unattended NOC
  // wallboard left open overnight), which can let the interval miss entirely and
  // let the token expire silently — a refresh-on-visible check closes that gap.
  const lastRefreshAtRef = useRef<number>(0);
  useEffect(() => {
    if (!currentUser) return;
    const SLIDING_REFRESH_MS = 30 * 60 * 1000;
    const MIN_REFRESH_GAP_MS = 5 * 60 * 1000;

    const doRefresh = () => {
      lastRefreshAtRef.current = Date.now();
      refreshSession().then((user) => {
        if (user) setCurrentUser(user);
      });
    };

    lastRefreshAtRef.current = Date.now();
    const interval = setInterval(doRefresh, SLIDING_REFRESH_MS);

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastRefreshAtRef.current >= MIN_REFRESH_GAP_MS) doRefresh();
    };
    document.addEventListener('visibilitychange', onFocusOrVisible);
    window.addEventListener('focus', onFocusOrVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      window.removeEventListener('focus', onFocusOrVisible);
    };
  }, [currentUser]);

  // Pause aggressive realtime/interval refreshes when the tab is backgrounded.
  useEffect(() => {
    const onVisibilityChange = () => setIsPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // --- Realtime updates via Socket.IO -------------------------------------

  const [socketConnected, setSocketConnected] = useState(false);
  const deviceRefreshTimerRef = useRef<number | null>(null);
  const alertRefreshTimerRef = useRef<number | null>(null);
  const eventRefreshTimerRef = useRef<number | null>(null);
  const serviceRefreshTimerRef = useRef<number | null>(null);
  const periodicRefreshInFlightRef = useRef(false);

  useEffect(() => {
    if (!currentUser) return;

    const socket = getSocket();
    setSocketConnected(socket.connected);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const scheduleTrailingRefresh = (
      ref: React.MutableRefObject<number | null>,
      run: () => Promise<unknown>,
      delayMs = REALTIME_REFRESH_DEBOUNCE_MS,
    ) => {
      if (ref.current !== null) return;
      ref.current = window.setTimeout(() => {
        ref.current = null;
        run().catch(() => undefined);
      }, delayMs);
    };

    const onDeviceUpdated = () => {
      if (!isPageVisible) return;
      if (activeTab !== 'devices' && activeTab !== 'overview' && activeTab !== 'topology') return;
      scheduleTrailingRefresh(deviceRefreshTimerRef, refreshDevices);
    };
    const onDeviceDiscovered = () => {
      if (!isPageVisible) return;
      if (activeTab !== 'devices' && activeTab !== 'overview' && activeTab !== 'topology') return;
      scheduleTrailingRefresh(deviceRefreshTimerRef, refreshDevices);
    };
    const onAlertNew = (payload: { severity?: string }) => {
      if (!isPageVisible) return;
      scheduleTrailingRefresh(alertRefreshTimerRef, refreshAlerts);
      if (payload?.severity === 'critical' || payload?.severity === 'high') {
        soundManager.playAlertBeep(payload.severity as 'critical' | 'high');
      }
    };
    const onAlertResolved = () => {
      if (!isPageVisible) return;
      scheduleTrailingRefresh(alertRefreshTimerRef, refreshAlerts);
    };
    const onEventNew = () => {
      if (!isPageVisible) return;
      if (activeTab !== 'alerts' && activeTab !== 'syslog') return;
      scheduleTrailingRefresh(eventRefreshTimerRef, refreshEvents);
    };
    const onServiceUpdated = () => {
      if (!isPageVisible) return;
      if (activeTab !== 'services') return;
      scheduleTrailingRefresh(serviceRefreshTimerRef, refreshServices);
    };

    socket.on('device:updated', onDeviceUpdated);
    socket.on('device:discovered', onDeviceDiscovered);
    socket.on('alert:new', onAlertNew);
    socket.on('alert:resolved', onAlertResolved);
    socket.on('event:new', onEventNew);
    socket.on('service:updated', onServiceUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('device:updated', onDeviceUpdated);
      socket.off('device:discovered', onDeviceDiscovered);
      socket.off('alert:new', onAlertNew);
      socket.off('alert:resolved', onAlertResolved);
      socket.off('event:new', onEventNew);
      socket.off('service:updated', onServiceUpdated);

      for (const ref of [deviceRefreshTimerRef, alertRefreshTimerRef, eventRefreshTimerRef, serviceRefreshTimerRef]) {
        if (ref.current !== null) {
          window.clearTimeout(ref.current);
          ref.current = null;
        }
      }
    };
  }, [currentUser, refreshDevices, refreshAlerts, refreshEvents, refreshServices, isPageVisible, activeTab]);

  // Periodic refresh (also drives the "SNMP Poller" status pill). Real-time push
  // events above already keep data fresh, so this is a safety-net poll: use the
  // user-selected fast interval only while the socket is actually disconnected
  // (true fallback); once connected, fall back to a much longer interval so 60+
  // devices don't refetch the full device/alert/event lists every few seconds
  // for no reason.
  useEffect(() => {
    if (!currentUser || autoRefreshInterval <= 0) return;
    const protectedFallbackMs = Math.max(autoRefreshInterval * 1000, devices.length >= 40 ? 15_000 : 7_000);
    const intervalMs = !isPageVisible ? 5 * 60_000 : socketConnected ? 90_000 : protectedFallbackMs;
    const timer = setInterval(() => {
      if (!isPageVisible) return;
      if (periodicRefreshInFlightRef.current) return;
      periodicRefreshInFlightRef.current = true;
      const run = socketConnected ? refreshHeartbeat : refreshByActiveTab;
      run()
        .then(() => setLastUpdatedTime(new Date().toLocaleTimeString()))
        .catch(() => undefined)
        .finally(() => {
          periodicRefreshInFlightRef.current = false;
        });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [currentUser, autoRefreshInterval, socketConnected, devices.length, refreshHeartbeat, refreshByActiveTab, isPageVisible]);

  // Derive a rolling global traffic history point from live device/interface data
  const trafficSeedRef = useRef(false);
  useEffect(() => {
    if (devices.length === 0) return;
    const totalInBps = devices.reduce(
      (acc, d) => acc + d.interfaces.reduce((a, i) => a + i.inRateBps, 0),
      0
    );
    const totalOutBps = devices.reduce(
      (acc, d) => acc + d.interfaces.reduce((a, i) => a + i.outRateBps, 0),
      0
    );
    const avgPing = devices.length
      ? devices.reduce((acc, d) => acc + (d.pingLatencyMs || 0), 0) / devices.length
      : 0;

    const newPoint: GlobalTrafficPoint = {
      time: new Date().toTimeString().slice(0, 5),
      inMbps: Math.round(totalInBps / 1_000_000),
      outMbps: Math.round(totalOutBps / 1_000_000),
      pingMs: Number(avgPing.toFixed(1)),
      totalAlerts: alerts.filter((a) => a.status === 'active').length,
    };

    setTrafficHistory((prev) => {
      const next = trafficSeedRef.current ? [...prev, newPoint] : [newPoint];
      trafficSeedRef.current = true;
      return next.slice(-MAX_TRAFFIC_POINTS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  // Reset all domain state on logout
  const handleLogout = () => {
    disconnectSocket();
    logout();
    setCurrentUser(null);
    setDevices([]);
    setAlerts([]);
    setAlertRules([]);
    setServices([]);
    setEventLogs([]);
    setTrafficHistory([]);
    trafficSeedRef.current = false;
  };

  // Handle alert acknowledge
  const handleAcknowledgeAlert = (id: string) => {
    api.alerts
      .acknowledge(id, currentUser?.username ?? 'noc.engineer')
      .then(() => refreshAlerts())
      .catch((err) => console.error('Failed to acknowledge alert', err));
  };

  // Acknowledge every active alert at once, then refresh a single time.
  const handleAcknowledgeAllAlerts = () => {
    const active = alerts.filter((a) => a.status === 'active');
    if (active.length === 0) return;
    const by = currentUser?.username ?? 'noc.engineer';
    Promise.all(active.map((a) => api.alerts.acknowledge(a.id, by)))
      .then(() => refreshAlerts())
      .catch((err) => console.error('Failed to acknowledge all alerts', err));
  };

  // Handle alert resolve
  const handleResolveAlert = (id: string) => {
    api.alerts
      .resolve(id)
      .then(() => refreshAlerts())
      .catch((err) => console.error('Failed to resolve alert', err));
  };

  // Resolve every acknowledged alert at once, then refresh a single time.
  const handleResolveAllAcknowledged = () => {
    const acknowledged = alerts.filter((a) => a.status === 'acknowledged');
    if (acknowledged.length === 0) return;
    Promise.all(acknowledged.map((a) => api.alerts.resolve(a.id)))
      .then(() => refreshAlerts())
      .catch((err) => console.error('Failed to resolve all acknowledged alerts', err));
  };

  // Manual Poll Device
  const handlePollDevice = (id: string): Promise<void> => {
    setIsPolling(true);
    return api.devices
      .pollNow(id)
      .then(() => {
        // Give the poller a moment to finish discovery + SNMP round-trip before refetching.
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            refreshDevices().finally(() => {
              setIsPolling(false);
              resolve();
            });
          }, 2500);
        });
      })
      .catch((err) => {
        console.error('Failed to poll device', err);
        setIsPolling(false);
      });
  };

  // Add Device - the modal fabricates a full NetworkDevice client-side for
  // preview purposes; extract the fields the backend actually needs.
  const handleAddDevice = (newDev: NetworkDevice, extra?: import('./components/AddDeviceModal').NewDeviceExtra) => {
    api.devices
      .create({
        name: newDev.name,
        hostname: newDev.hostname,
        ip: newDev.ip,
        location: newDev.location,
        snmpVersion: newDev.snmpVersion,
        snmpCommunity: newDev.community,
        groupId: extra?.groupId,
        siteId: extra?.siteId ?? selectedSiteId,
        pingOnly: extra?.pingOnly,
      })
      .then(() => refreshDevices())
      .catch((err) => console.error('Failed to create device', err));
  };

  // Edit device
  const handleSaveEditDevice = (id: string, patch: Partial<import('./services/api').CreateDeviceInput>) => {
    api.devices
      .update(id, patch)
      .then(() => refreshDevices())
      .catch((err) => console.error('Failed to update device', err));
  };

  // Assign / unassign a device to a group (used by the group manager).
  const handleAssignDeviceGroup = (deviceId: string, groupId: string | null, siteId?: string | null): Promise<void> =>
    api.devices
      .update(deviceId, { groupId, ...(typeof siteId !== 'undefined' ? { siteId } : {}) })
      .then(() => {
        refreshDevices();
      })
      .catch((err) => console.error('Failed to assign device group', err));

  // Toggle per-device SNMP monitoring (pause/resume polling + discovery scheduling).
  const handleToggleSnmpMonitoring = (deviceId: string, disabled: boolean): Promise<void> =>
    api.devices
      .update(deviceId, { disabled })
      .then(() => {
        refreshDevices();
      })
      .catch((err) => console.error('Failed to toggle SNMP monitoring', err));

  // Delete device (with confirmation)
  const handleDeleteDevice = (dev: NetworkDevice) => {
    if (!window.confirm(`Xóa thiết bị "${dev.name}" (${dev.ip})? Toàn bộ dữ liệu polling, cổng và cảnh báo liên quan sẽ bị xóa.`)) {
      return;
    }
    api.devices
      .remove(dev.id)
      .then(() => {
        if (selectedDevice?.id === dev.id) setSelectedDevice(null);
        return refreshDevices();
      })
      .catch((err) => console.error('Failed to delete device', err));
  };

  const handleDeleteSelectedDevices = async (deviceIds: string[]): Promise<void> => {
    if (deviceIds.length === 0) return;
    await api.devices.bulkDelete(deviceIds);
    if (selectedDevice?.id && deviceIds.includes(selectedDevice.id)) {
      setSelectedDevice(null);
    }
    await refreshDevices();
    void refreshAlerts();
  };

  // Alert rule create / delete
  const handleCreateRule = (input: import('./types').AlertRuleInput) => {
    api.alertRules
      .create({ ...input, siteId: input.siteId ?? selectedSiteId })
      .then(() => refreshAlertRules())
      .catch((err) => console.error('Failed to create rule', err));
  };

  const handleDeleteRule = (id: string) => {
    api.alertRules
      .remove(id)
      .then(() => Promise.all([refreshAlertRules(), refreshAlerts()]))
      .catch((err) => console.error('Failed to delete rule', err));
  };

  // Update an existing alert rule
  const handleUpdateRule = (id: string, input: import('./types').AlertRuleInput) => {
    api.alertRules
      .update(id, { ...input, siteId: input.siteId ?? selectedSiteId })
      .then(() => refreshAlertRules())
      .catch((err) => console.error('Failed to update rule', err));
  };

  // Toggle Alert Rule
  const handleToggleRule = (id: string) => {
    const rule = alertRules.find((r) => r.id === id);
    if (!rule) return;
    api.alertRules
      .update(id, { enabled: !rule.enabled })
      .then(() => Promise.all([refreshAlertRules(), refreshAlerts()]))
      .catch((err) => console.error('Failed to toggle rule', err));
  };

  const handleApplyRuleSites = async (
    id: string,
    input: import('./types').AlertRuleApplySitesInput,
  ): Promise<import('./types').AlertRuleApplySitesResult> => {
    const result = await api.alertRules.applySites(id, input);
    await refreshAlertRules();
    return result;
  };

  const handleOpenAlertsBySeverity = (severity: AlertSeverity) => {
    setQuickAlertTab('alerts');
    setQuickSeverityFilter(severity);
    setQuickSeverityRequestKey((k) => k + 1);
    navigateTab('alerts');
  };

  const handleOpenAcknowledgedAlerts = () => {
    setQuickAlertTab('acknowledged');
    setQuickSeverityFilter(null);
    setQuickSeverityRequestKey((k) => k + 1);
    navigateTab('alerts');
  };

  const activeAlertCount = filteredAlerts.filter((a) => a.status === 'active').length;
  const acknowledgedAlertCount = filteredAlerts.filter((a) => a.status === 'acknowledged').length;
  const criticalAlertCount = filteredAlerts.filter((a) => a.status === 'active' && a.severity === 'critical').length;
  const alertCountsBySeverity: Record<AlertSeverity, number> = {
    critical: filteredAlerts.filter((a) => a.status === 'active' && a.severity === 'critical').length,
    high: filteredAlerts.filter((a) => a.status === 'active' && a.severity === 'high').length,
    medium: filteredAlerts.filter((a) => a.status === 'active' && a.severity === 'medium').length,
    low: filteredAlerts.filter((a) => a.status === 'active' && a.severity === 'low').length,
  };

  if (!currentUser) {
    return <LoginScreen darkMode={darkMode} onLoginSuccess={setCurrentUser} />;
  }

  const isViewer = currentUser.role === 'viewer';

  return (
    <div className={`min-h-screen transition-colors ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'}`}>
      
      {/* Top Header */}
      <Header
        darkMode={darkMode}
        autoRefreshInterval={autoRefreshInterval}
        setAutoRefreshInterval={setAutoRefreshInterval}
        isSoundEnabled={isSoundEnabled}
        setIsSoundEnabled={setIsSoundEnabled}
        lastUpdatedTime={lastUpdatedTime}
        isPolling={isPolling}
        onManualPoll={() => refreshAll()}
        onLogout={handleLogout}
        alertCountsBySeverity={alertCountsBySeverity}
        onOpenAlertsBySeverity={handleOpenAlertsBySeverity}
        acknowledgedAlertCount={acknowledgedAlertCount}
        onOpenAcknowledgedAlerts={handleOpenAcknowledgedAlerts}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        selectedSiteId={selectedSiteId}
        onChangeSite={setSelectedSiteId}
        allowAllSitesOption={currentUser.isSystemAdmin === true}
      />

      {/* Main Navigation Bar */}
      <Navigation
        activeTab={activeTab}
        setActiveTab={navigateTab}
        darkMode={darkMode}
        deviceCount={filteredDevices.length}
        activeAlertCount={activeAlertCount}
        criticalAlertCount={criticalAlertCount}
      />

      {/* Main View Area */}
      <main className="w-full px-4 sm:px-6 lg:px-8 pt-6">
        {activeTab === 'overview' && (
          <DashboardBuilder
            devices={filteredDevices}
            alerts={filteredAlerts}
            trafficHistory={trafficHistory}
            sites={sites}
            selectedSiteId={selectedSiteId}
            darkMode={darkMode}
            trafficChartMode={trafficChartMode}
            onSelectDevice={(dev) => setSelectedDevice(dev)}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onNavigateToTab={(tab) => navigateTab(tab as TabType)}
          />
        )}

        {activeTab === 'devices' && (
          <DeviceManagement
            devices={filteredDevices}
            sites={sites}
            selectedSiteId={selectedSiteId}
            darkMode={darkMode}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            onPollDevice={handlePollDevice}
            onOpenAddDevice={() => setIsAddDeviceOpen(true)}
            onEditDevice={(dev) => setEditDevice(dev)}
            onDeleteDevice={handleDeleteDevice}
            onDeleteSelectedDevices={handleDeleteSelectedDevices}
            onOpenScanSubnet={() => setIsScanOpen(true)}
            onAssignGroup={handleAssignDeviceGroup}
            onToggleSnmpMonitoring={handleToggleSnmpMonitoring}
            services={filteredServices}
            onCreateAlertRule={handleCreateRule}
            trafficChartMode={trafficChartMode}
          />
        )}

        {activeTab === 'alerts' && (
          <AlertConsole
            alerts={filteredAlerts}
            alertRules={filteredAlertRules}
            eventLogs={filteredEventLogs}
            devices={filteredDevices}
            services={filteredServices}
            sites={sites}
            selectedSiteId={selectedSiteId}
            darkMode={darkMode}
            onAcknowledge={handleAcknowledgeAlert}
            onAcknowledgeAll={handleAcknowledgeAllAlerts}
            onResolve={handleResolveAlert}
            onResolveAllAcknowledged={handleResolveAllAcknowledged}
            onToggleRule={handleToggleRule}
            onCreateRule={handleCreateRule}
            onUpdateRule={handleUpdateRule}
            onDeleteRule={handleDeleteRule}
            onApplyRuleSites={handleApplyRuleSites}
            canApplyRulesAcrossSites={currentUser.isSystemAdmin === true}
            quickSeverityFilter={quickSeverityFilter}
            quickAlertTab={quickAlertTab}
            quickSeverityRequestKey={quickSeverityRequestKey}
          />
        )}

        {activeTab === 'syslog' && <SyslogConsole eventLogs={filteredEventLogs} devices={filteredDevices} darkMode={darkMode} />}

        {activeTab === 'topology' && (
          <NetworkTopology
            devices={filteredDevices}
            alerts={filteredAlerts}
            selectedSiteId={selectedSiteId}
            darkMode={darkMode}
            onOpenDevice={(dev) => { setSelectedDevice(dev); navigateTab('devices'); }}
          />
        )}

        {activeTab === 'services' && (
          <ServiceMonitoring
            services={filteredServices}
            sites={sites}
            selectedSiteId={selectedSiteId}
            darkMode={darkMode}
            onAddService={(input) =>
              (input.methods.length > 1
                ? api.services.createBatch({ name: input.name, target: input.target, siteId: input.siteId ?? selectedSiteId, methods: input.methods })
                : api.services.create({
                    name: input.name,
                    target: input.target,
                    siteId: input.siteId ?? selectedSiteId,
                    type: input.methods[0].type,
                    port: input.methods[0].port,
                  })
              )
                .then(() => refreshServices())
                .catch((err) => console.error('Failed to create service', err))
            }
            onUpdateService={(id, patch) =>
              api.services
                .update(id, patch)
                .then(() => refreshServices())
                .catch((err) => console.error('Failed to update service', err))
            }
            onDeleteService={(id) =>
              api.services
                .remove(id)
                .then(() => refreshServices())
                .catch((err) => console.error('Failed to delete service', err))
            }
            onRefreshService={(id) =>
              api.services
                .checkNow(id)
                .then(() => refreshServices())
                .catch((err) => console.error('Failed to refresh service', err))
            }
          />
        )}

        {activeTab === 'virtualization' && (
          <VirtualizationMonitor
            sites={sites}
            selectedSiteId={selectedSiteId}
            darkMode={darkMode}
            canManage={!isViewer}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            darkMode={darkMode}
            trafficChartMode={trafficChartMode}
            onChangeTrafficChartMode={setTrafficChartMode}
            currentUserRole={currentUser.role}
            currentUserSiteIds={currentUser.siteIds ?? []}
            currentUserIsSystemAdmin={currentUser.isSystemAdmin}
            selectedSiteId={selectedSiteId}
            sites={sites}
          />
        )}
      </main>

      {/* Modals */}
      <AddDeviceModal
        isOpen={isAddDeviceOpen}
        onClose={() => setIsAddDeviceOpen(false)}
        onAddDevice={handleAddDevice}
        darkMode={darkMode}
        sites={sites}
        selectedSiteId={selectedSiteId}
      />

      <EditDeviceModal
        device={editDevice}
        darkMode={darkMode}
        sites={sites}
        onClose={() => setEditDevice(null)}
        onSave={handleSaveEditDevice}
      />

      <ScanSubnetModal
        isOpen={isScanOpen}
        darkMode={darkMode}
        sites={sites}
        defaultSiteId={selectedSiteId}
        allowAllSitesOption={currentUser.isSystemAdmin === true}
        onClose={() => setIsScanOpen(false)}
        onAdded={() => refreshDevices()}
      />

    </div>
  );
}

