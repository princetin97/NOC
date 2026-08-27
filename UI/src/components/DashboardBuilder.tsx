import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { NetworkDevice, NetworkAlert, GlobalTrafficPoint, Dashboard, DashboardWidget, WidgetType, StatMetric, PortMetricPoint, DeviceMetric, PortSortBy, TrafficSource, SiteInfo } from '../types';
import { api } from '../services/api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  Server, ShieldAlert, Activity, AlertTriangle, ArrowDownLeft, ArrowUpRight, Gauge,
  Plus, Pencil, Trash2, Save, Maximize2, Minimize2, LayoutDashboard, Clock, Type as TypeIcon,
  Check, X, LayoutGrid, Star, Copy, RefreshCw, Signal, Cpu, MemoryStick, Thermometer,
} from 'lucide-react';
import { DevicePickerButton, PortPickerButton } from './DevicePortPicker';

// --- Grid constants -------------------------------------------------------
const COLS = 12;
const ROW_H = 88; // px per row unit
const GAP = 12; // px gap between cells

// --- Accent color map (static classes so Tailwind keeps them) -------------
const ACCENT: Record<string, { text: string; bg: string; ring: string }> = {
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30' },
  red: { text: 'text-red-400', bg: 'bg-red-500/15', ring: 'ring-red-500/30' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-500/15', ring: 'ring-amber-500/30' },
  blue: { text: 'text-blue-400', bg: 'bg-blue-500/15', ring: 'ring-blue-500/30' },
  violet: { text: 'text-violet-400', bg: 'bg-violet-500/15', ring: 'ring-violet-500/30' },
  cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/15', ring: 'ring-cyan-500/30' },
  slate: { text: 'text-slate-300', bg: 'bg-slate-500/15', ring: 'ring-slate-500/30' },
};
const ACCENT_KEYS = Object.keys(ACCENT);

// --- Widget catalogue -----------------------------------------------------
const WIDGET_CATALOG: { type: WidgetType; label: string; icon: React.ElementType; defaultSize: { w: number; h: number } }[] = [
  { type: 'stat', label: 'Thẻ số liệu', icon: Gauge, defaultSize: { w: 3, h: 2 } },
  { type: 'traffic-chart', label: 'Biểu đồ lưu lượng', icon: Activity, defaultSize: { w: 8, h: 4 } },
  { type: 'device-gauges', label: 'Đồng hồ CPU/RAM/Nhiệt', icon: Signal, defaultSize: { w: 4, h: 3 } },
  { type: 'device-status', label: 'Trạng thái thiết bị', icon: Server, defaultSize: { w: 6, h: 4 } },
  { type: 'alert-list', label: 'Cảnh báo mới nhất', icon: ShieldAlert, defaultSize: { w: 4, h: 4 } },
  { type: 'top-interfaces', label: 'Top cổng (tải / băng thông)', icon: ArrowUpRight, defaultSize: { w: 6, h: 4 } },
  { type: 'top-devices', label: 'Top thiết bị theo tài nguyên', icon: Cpu, defaultSize: { w: 5, h: 4 } },
  { type: 'clock', label: 'Đồng hồ / Tiêu đề TV', icon: Clock, defaultSize: { w: 4, h: 2 } },
  { type: 'text', label: 'Văn bản tùy chỉnh', icon: TypeIcon, defaultSize: { w: 4, h: 1 } },
];

const STAT_METRICS: { value: StatMetric; label: string; accent: string }[] = [
  { value: 'total-devices', label: 'Tổng thiết bị', accent: 'blue' },
  { value: 'devices-up', label: 'Thiết bị Online', accent: 'emerald' },
  { value: 'devices-down', label: 'Thiết bị Offline', accent: 'red' },
  { value: 'devices-warning', label: 'Thiết bị Cảnh báo', accent: 'amber' },
  { value: 'active-alerts', label: 'Cảnh báo đang mở', accent: 'amber' },
  { value: 'critical-alerts', label: 'Cảnh báo nguy hiểm', accent: 'red' },
  { value: 'total-in-gbps', label: 'Tổng vào (Gbps)', accent: 'cyan' },
  { value: 'total-out-gbps', label: 'Tổng ra (Gbps)', accent: 'violet' },
  { value: 'avg-ping', label: 'Ping trung bình (ms)', accent: 'blue' },
];

interface DashboardBuilderProps {
  devices: NetworkDevice[];
  alerts: NetworkAlert[];
  trafficHistory: GlobalTrafficPoint[];
  sites?: SiteInfo[];
  selectedSiteId?: string | null;
  darkMode: boolean;
  trafficChartMode: 'stacked' | 'mirrored';
  onSelectDevice: (dev: NetworkDevice) => void;
  onAcknowledgeAlert: (id: string) => void;
  onNavigateToTab: (tab: 'devices' | 'alerts' | 'topology') => void;
}

function uid(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Lowest free row for a new widget (place it under everything).
function nextY(widgets: DashboardWidget[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
}

const STARTER_WIDGETS: DashboardWidget[] = [
  { id: uid(), type: 'stat', x: 0, y: 0, w: 3, h: 2, config: { statMetric: 'total-devices', accent: 'blue' } },
  { id: uid(), type: 'stat', x: 3, y: 0, w: 3, h: 2, config: { statMetric: 'devices-up', accent: 'emerald' } },
  { id: uid(), type: 'stat', x: 6, y: 0, w: 3, h: 2, config: { statMetric: 'devices-down', accent: 'red' } },
  { id: uid(), type: 'stat', x: 9, y: 0, w: 3, h: 2, config: { statMetric: 'active-alerts', accent: 'amber' } },
  { id: uid(), type: 'traffic-chart', x: 0, y: 2, w: 8, h: 4, config: { title: 'Lưu lượng toàn hệ thống' } },
  { id: uid(), type: 'alert-list', x: 8, y: 2, w: 4, h: 4, config: { title: 'Cảnh báo mới nhất', limit: 8 } },
  { id: uid(), type: 'device-status', x: 0, y: 6, w: 6, h: 4, config: { title: 'Trạng thái thiết bị' } },
  { id: uid(), type: 'top-interfaces', x: 6, y: 6, w: 6, h: 4, config: { title: 'Top cổng theo tải', limit: 6 } },
];

export const DashboardBuilder: React.FC<DashboardBuilderProps> = ({
  devices,
  alerts,
  trafficHistory,
  sites = [],
  selectedSiteId = null,
  darkMode,
  trafficChartMode,
  onSelectDevice,
  onAcknowledgeAlert,
  onNavigateToTab,
}) => {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [devicesWithInterfaces, setDevicesWithInterfaces] = useState<NetworkDevice[]>(devices);
  const [hydratingInterfaces, setHydratingInterfaces] = useState(false);

  const needsInterfaceData = useMemo(
    () =>
      widgets.some(
        (w) =>
          w.type === 'top-interfaces' ||
          (w.type === 'traffic-chart' && (w.config.source ?? 'global') === 'port'),
      ) || editingWidget?.type === 'traffic-chart',
    [widgets, editingWidget],
  );

  const hasInterfaceData = devicesWithInterfaces.some((d) => d.interfaces.length > 0);

  useEffect(() => {
    const liveById = new Map(devices.map((d) => [d.id, d]));
    setDevicesWithInterfaces((prev) => {
      if (!prev.length) return devices;
      return prev.map((d) => {
        const live = liveById.get(d.id);
        if (!live) return d;
        return { ...live, interfaces: d.interfaces.length > 0 ? d.interfaces : live.interfaces };
      });
    });
  }, [devices]);

  useEffect(() => {
    if (!needsInterfaceData || hasInterfaceData || hydratingInterfaces) return;
    let cancelled = false;
    setHydratingInterfaces(true);
    api.devices
      .listFull()
      .then((full) => {
        if (!cancelled) setDevicesWithInterfaces(full);
      })
      .catch((err) => {
        console.error('Failed to load full device interfaces for dashboard widgets', err);
      })
      .finally(() => {
        if (!cancelled) setHydratingInterfaces(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsInterfaceData, hasInterfaceData, hydratingInterfaces]);

  const effectiveDevices = useMemo(() => {
    if (hasInterfaceData) return devicesWithInterfaces;
    return devices;
  }, [devices, devicesWithInterfaces, hasInterfaceData]);

  // --- Load dashboards on mount ------------------------------------------
  const loadDashboards = useCallback(async (preferId?: string) => {
    setLoading(true);
    try {
      let list = await api.dashboards.list();
      if (list.length === 0) {
        // Seed a starter dashboard so the NOC tab isn't empty on first use.
        const created = await api.dashboards.create({
          name: 'Bảng điều khiển NOC',
          isDefault: true,
          siteId: selectedSiteId,
          widgets: STARTER_WIDGETS,
        });
        list = [created];
      }
      setDashboards(list);
      const pick = list.find((d) => d.id === preferId) ?? list.find((d) => d.isDefault) ?? list[0];
      setActiveId(pick.id);
      setWidgets(pick.widgets);
      setDirty(false);
    } catch (err) {
      console.error('Failed to load dashboards', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    loadDashboards();
  }, [loadDashboards]);

  const activeDashboard = dashboards.find((d) => d.id === activeId) ?? null;

  const siteNameById = useMemo(() => new Map(sites.map((site) => [site.id, site.name])), [sites]);
  const dashboardSiteLabel = (dashboard: Dashboard): string =>
    dashboard.siteId ? siteNameById.get(dashboard.siteId) ?? `Trụ sở ${dashboard.siteId.slice(0, 8)}` : 'Toàn hệ thống';

  const dashboardDisplayName = (dashboard: Dashboard): string =>
    `${dashboard.name}${dashboard.isDefault ? ' ★' : ''} [${dashboardSiteLabel(dashboard)}]`;

  const switchDashboard = (id: string) => {
    if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Chuyển dashboard khác và bỏ thay đổi?')) return;
    const d = dashboards.find((x) => x.id === id);
    if (!d) return;
    setActiveId(id);
    setWidgets(d.widgets);
    setDirty(false);
    setEditMode(false);
  };

  // --- Widget mutation helpers -------------------------------------------
  const updateWidget = (id: string, patch: Partial<DashboardWidget>) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    setDirty(true);
  };

  const addWidget = (type: WidgetType) => {
    const cat = WIDGET_CATALOG.find((c) => c.type === type)!;
    const w: DashboardWidget = {
      id: uid(),
      type,
      x: 0,
      y: nextY(widgets),
      w: cat.defaultSize.w,
      h: cat.defaultSize.h,
      config: type === 'stat' ? { statMetric: 'total-devices', accent: 'blue' } : {},
    };
    setWidgets((prev) => [...prev, w]);
    setDirty(true);
    setShowPicker(false);
    setEditingWidget(w);
  };

  const removeWidget = (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    setDirty(true);
  };

  // --- Persistence --------------------------------------------------------
  const save = async () => {
    if (!activeId) return;
    setSaving(true);
    try {
      const updated = await api.dashboards.update(activeId, { widgets });
      setDashboards((prev) => prev.map((d) => (d.id === activeId ? updated : d)));
      setDirty(false);
    } catch (err) {
      console.error('Failed to save dashboard', err);
      window.alert('Lưu dashboard thất bại.');
    } finally {
      setSaving(false);
    }
  };

  // --- Dashboard CRUD -----------------------------------------------------
  const createDashboard = async (name: string) => {
    try {
      const created = await api.dashboards.create({ name, siteId: selectedSiteId, widgets: [] });
      setDashboards((prev) => [...prev, created]);
      setActiveId(created.id);
      setWidgets([]);
      setDirty(false);
      setEditMode(true);
    } catch (err) {
      console.error('Failed to create dashboard', err);
    }
  };

  const duplicateDashboard = async () => {
    if (!activeDashboard) return;
    try {
      const created = await api.dashboards.create({
        name: `${activeDashboard.name} (bản sao)`,
        siteId: selectedSiteId,
        widgets,
      });
      setDashboards((prev) => [...prev, created]);
      setActiveId(created.id);
      setWidgets(created.widgets);
      setDirty(false);
    } catch (err) {
      console.error('Failed to duplicate dashboard', err);
    }
  };

  const renameDashboard = async (name: string) => {
    if (!activeId) return;
    try {
      const updated = await api.dashboards.update(activeId, { name });
      setDashboards((prev) => prev.map((d) => (d.id === activeId ? updated : d)));
    } catch (err) {
      console.error('Failed to rename dashboard', err);
    }
  };

  const setAsDefault = async () => {
    if (!activeId) return;
    try {
      await api.dashboards.update(activeId, { isDefault: true });
      await loadDashboards(activeId);
    } catch (err) {
      console.error('Failed to set default dashboard', err);
    }
  };

  const deleteDashboard = async () => {
    if (!activeId || dashboards.length <= 1) return;
    if (!window.confirm(`Xóa dashboard "${activeDashboard?.name}"?`)) return;
    try {
      await api.dashboards.remove(activeId);
      await loadDashboards();
    } catch (err) {
      console.error('Failed to delete dashboard', err);
    }
  };

  // --- Fullscreen (TV) ----------------------------------------------------
  const enterFullscreen = () => {
    setFullscreen(true);
    setEditMode(false);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const exitFullscreen = () => {
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  };
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const gridCtx = {
    devices: effectiveDevices,
    alerts,
    trafficHistory,
    darkMode,
    trafficChartMode,
    onSelectDevice,
    onAcknowledgeAlert,
    onNavigateToTab,
  };

  // --- Fullscreen (kiosk) render -----------------------------------------
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 overflow-auto p-4">
        <button
          onClick={exitFullscreen}
          className="fixed top-3 right-3 z-[60] p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 opacity-30 hover:opacity-100 transition-opacity"
          title="Thoát toàn màn hình (Esc)"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
        <WidgetGrid
          widgets={widgets}
          editMode={false}
          darkMode
          ctx={gridCtx}
          devices={effectiveDevices}
          onEditWidget={() => undefined}
          onRemoveWidget={() => undefined}
          onChangeWidget={() => undefined}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Đang tải dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      {/* Toolbar */}
      <div className={`flex flex-wrap items-center gap-2 p-3 rounded-xl border ${
        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <LayoutDashboard className="w-5 h-5 text-blue-400" />
        <select
          value={activeId ?? ''}
          onChange={(e) => switchDashboard(e.target.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
            darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
          }`}
        >
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {dashboardDisplayName(d)}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {editMode && (
          <button
            onClick={() => setShowPicker(true)}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Plus className="w-4 h-4" /> Thêm widget
          </button>
        )}
        {editMode && dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        )}
        <button
          onClick={() => { if (editMode && dirty) save(); setEditMode((v) => !v); }}
          className={`px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1.5 border ${
            editMode
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              : darkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
          }`}
        >
          {editMode ? <><Check className="w-4 h-4" /> Xong</> : <><Pencil className="w-4 h-4" /> Chỉnh sửa</>}
        </button>
        <button
          onClick={() => setShowManage(true)}
          className={`px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1.5 border ${
            darkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <LayoutGrid className="w-4 h-4" /> Quản lý
        </button>
        <button
          onClick={enterFullscreen}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white"
          title="Chế độ TV toàn màn hình"
        >
          <Maximize2 className="w-4 h-4" /> TV
        </button>
      </div>

      {widgets.length === 0 ? (
        <div className={`py-20 text-center rounded-xl border border-dashed ${
          darkMode ? 'border-slate-700 text-slate-400' : 'border-slate-300 text-slate-500'
        }`}>
          <LayoutDashboard className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Dashboard trống. Bấm <strong>Chỉnh sửa</strong> rồi <strong>Thêm widget</strong> để bắt đầu.</p>
        </div>
      ) : (
        <WidgetGrid
          widgets={widgets}
          editMode={editMode}
          darkMode={darkMode}
          ctx={gridCtx}
          devices={effectiveDevices}
          onEditWidget={(w) => setEditingWidget(w)}
          onRemoveWidget={removeWidget}
          onChangeWidget={updateWidget}
        />
      )}

      {showPicker && (
        <WidgetPickerModal darkMode={darkMode} onPick={addWidget} onClose={() => setShowPicker(false)} />
      )}
      {editingWidget && (
        <WidgetConfigModal
          widget={editingWidget}
          devices={effectiveDevices}
          darkMode={darkMode}
          onSave={(cfg) => { updateWidget(editingWidget.id, { config: cfg }); setEditingWidget(null); }}
          onClose={() => setEditingWidget(null)}
        />
      )}
      {showManage && activeDashboard && (
        <ManageDashboardModal
          darkMode={darkMode}
          dashboard={activeDashboard}
          siteLabel={dashboardSiteLabel(activeDashboard)}
          canDelete={dashboards.length > 1}
          onCreate={createDashboard}
          onDuplicate={duplicateDashboard}
          onRename={renameDashboard}
          onSetDefault={setAsDefault}
          onDelete={deleteDashboard}
          onClose={() => setShowManage(false)}
        />
      )}
    </div>
  );
};

// =========================================================================
// Grid: absolute-positioned 12-col grid with pointer drag + resize
// =========================================================================
interface GridCtx {
  devices: NetworkDevice[];
  alerts: NetworkAlert[];
  trafficHistory: GlobalTrafficPoint[];
  darkMode: boolean;
  trafficChartMode: 'stacked' | 'mirrored';
  onSelectDevice: (dev: NetworkDevice) => void;
  onAcknowledgeAlert: (id: string) => void;
  onNavigateToTab: (tab: 'devices' | 'alerts' | 'topology') => void;
}

interface WidgetGridProps {
  widgets: DashboardWidget[];
  editMode: boolean;
  darkMode: boolean;
  ctx: GridCtx;
  devices: NetworkDevice[];
  onEditWidget: (w: DashboardWidget) => void;
  onRemoveWidget: (id: string) => void;
  onChangeWidget: (id: string, patch: Partial<DashboardWidget>) => void;
}

const WidgetGrid: React.FC<WidgetGridProps> = ({
  widgets, editMode, darkMode, ctx, onEditWidget, onRemoveWidget, onChangeWidget,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(1200);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colW = (containerW + GAP) / COLS; // effective column stride incl. gap
  const totalRows = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 4);
  const gridHeight = totalRows * ROW_H;

  const dragRef = useRef<{
    id: string; mode: 'move' | 'resize'; startX: number; startY: number; orig: DashboardWidget;
  } | null>(null);

  const onPointerDownHeader = (e: React.PointerEvent, w: DashboardWidget) => {
    if (!editMode) return;
    e.preventDefault();
    dragRef.current = { id: w.id, mode: 'move', startX: e.clientX, startY: e.clientY, orig: w };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  const onPointerDownResize = (e: React.PointerEvent, w: DashboardWidget) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id: w.id, mode: 'resize', startX: e.clientX, startY: e.clientY, orig: w };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dCols = Math.round((e.clientX - d.startX) / colW);
    const dRows = Math.round((e.clientY - d.startY) / ROW_H);
    if (d.mode === 'move') {
      const x = Math.max(0, Math.min(COLS - d.orig.w, d.orig.x + dCols));
      const y = Math.max(0, d.orig.y + dRows);
      onChangeWidget(d.id, { x, y });
    } else {
      const w = Math.max(2, Math.min(COLS - d.orig.x, d.orig.w + dCols));
      const h = Math.max(1, d.orig.h + dRows);
      onChangeWidget(d.id, { w, h });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colW, onChangeWidget]);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: gridHeight }}>
      {widgets.map((w) => {
        const left = w.x * colW;
        const top = w.y * ROW_H;
        const width = w.w * colW - GAP;
        const height = w.h * ROW_H - GAP;
        return (
          <div
            key={w.id}
            className={`absolute rounded-xl border overflow-hidden ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            } ${editMode ? 'ring-1 ring-blue-500/30' : ''}`}
            style={{ left, top, width, height }}
          >
            {editMode && (
              <div
                className="absolute top-0 left-0 right-0 h-8 z-10 flex items-center justify-between px-2 bg-blue-600/20 border-b border-blue-500/30 cursor-move select-none"
                onPointerDown={(e) => onPointerDownHeader(e, w)}
              >
                <span className="text-[10px] font-mono text-blue-200 truncate">
                  {WIDGET_CATALOG.find((c) => c.type === w.type)?.label ?? w.type}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEditWidget(w)}
                    className="p-1 rounded hover:bg-blue-500/30 text-blue-100"
                    title="Cấu hình"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRemoveWidget(w.id)}
                    className="p-1 rounded hover:bg-red-500/30 text-red-200"
                    title="Xóa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
            <div className={`w-full h-full ${editMode ? 'pt-8' : ''}`}>
              <WidgetRenderer widget={w} ctx={ctx} />
            </div>
            {editMode && (
              <div
                className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-10 flex items-end justify-end p-0.5"
                onPointerDown={(e) => onPointerDownResize(e, w)}
                title="Kéo để đổi kích thước"
              >
                <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-blue-400" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// =========================================================================
// Widget renderer
// =========================================================================
const WidgetRenderer: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  switch (widget.type) {
    case 'stat': return <StatWidget widget={widget} ctx={ctx} />;
    case 'traffic-chart': return <TrafficWidget widget={widget} ctx={ctx} />;
    case 'device-gauges': return <GaugesWidget widget={widget} ctx={ctx} />;
    case 'device-status': return <DeviceStatusWidget widget={widget} ctx={ctx} />;
    case 'alert-list': return <AlertListWidget widget={widget} ctx={ctx} />;
    case 'top-interfaces': return <TopInterfacesWidget widget={widget} ctx={ctx} />;
    case 'top-devices': return <TopDevicesWidget widget={widget} ctx={ctx} />;
    case 'clock': return <ClockWidget widget={widget} />;
    case 'text': return <TextWidget widget={widget} />;
    default: return null;
  }
};

// --- Stat widget ----------------------------------------------------------
function computeStat(metric: StatMetric, ctx: GridCtx): { value: string; sub?: string } {
  const { devices, alerts } = ctx;
  const up = devices.filter((d) => d.status === 'up').length;
  const down = devices.filter((d) => d.status === 'down').length;
  const active = alerts.filter((a) => a.status === 'active');
  const open = alerts.filter((a) => a.status !== 'resolved');
  const warn = new Set(open.map((a) => a.deviceId)).size;
  let inBps = 0, outBps = 0;
  devices.forEach((d) => d.interfaces.forEach((i) => { inBps += i.inRateBps; outBps += i.outRateBps; }));
  switch (metric) {
    case 'total-devices': return { value: String(devices.length), sub: `${up} online / ${down} offline` };
    case 'devices-up': return { value: String(up), sub: 'đang hoạt động' };
    case 'devices-down': return { value: String(down), sub: 'mất kết nối' };
    case 'devices-warning': return { value: String(warn), sub: 'cần chú ý' };
    case 'active-alerts': return { value: String(active.length), sub: 'đang mở' };
    case 'critical-alerts': return { value: String(active.filter((a) => a.severity === 'critical').length), sub: 'nguy hiểm' };
    case 'total-in-gbps': return { value: (inBps / 1e9).toFixed(2), sub: 'Gbps vào' };
    case 'total-out-gbps': return { value: (outBps / 1e9).toFixed(2), sub: 'Gbps ra' };
    case 'avg-ping': {
      const alive = devices.filter((d) => d.status !== 'down');
      const avg = alive.reduce((a, d) => a + (d.pingLatencyMs || 0), 0) / (alive.length || 1);
      return { value: avg.toFixed(1), sub: 'ms trung bình' };
    }
    default: return { value: '—' };
  }
}

const StatWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const metric = (widget.config.statMetric ?? 'total-devices') as StatMetric;
  const meta = STAT_METRICS.find((m) => m.value === metric);
  const accent = ACCENT[widget.config.accent ?? meta?.accent ?? 'blue'] ?? ACCENT.blue;
  const { value, sub } = computeStat(metric, ctx);
  const title = widget.config.title || meta?.label || 'Chỉ số';
  return (
    <div className="w-full h-full p-4 flex flex-col justify-center">
      <div className="flex items-center gap-2 mb-1">
        <span className={`p-1.5 rounded-lg ${accent.bg} ${accent.text}`}><Gauge className="w-4 h-4" /></span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 truncate">{title}</span>
      </div>
      <div className={`text-4xl font-bold ${accent.text} leading-tight`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
};

// --- Traffic chart widget -------------------------------------------------
const TrafficWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const { trafficHistory, darkMode, devices, trafficChartMode } = ctx;
  const source = (widget.config.source ?? 'global') as TrafficSource;
  const portId = widget.config.portId;
  const hours = widget.config.hours ?? 1;

  const [portData, setPortData] = useState<{ time: string; inMbps: number; outMbps: number }[]>([]);
  const [portErr, setPortErr] = useState<string | null>(null);

  const dev = devices.find((d) => d.id === widget.config.deviceId);
  const iface = dev?.interfaces.find((i) => i.id === portId);

  useEffect(() => {
    if (source !== 'port' || !portId) return;
    let active = true;
    const load = () => {
      api.ports.metrics(portId, hours)
        .then((points: PortMetricPoint[]) => {
          if (!active) return;
          setPortErr(null);
          setPortData(points.map((p) => ({
            time: new Date(p.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            inMbps: Number((Math.abs(p.inRateBps) / 1e6).toFixed(2)),
            outMbps: -Number((Math.abs(p.outRateBps) / 1e6).toFixed(2)),
          })));
        })
        .catch((err) => { if (active) setPortErr(String(err)); });
    };
    load();
    const t = setInterval(load, 30000);
    return () => { active = false; clearInterval(t); };
  }, [source, portId, hours]);

  const data = useMemo(
    () =>
      (source === 'port' ? portData : trafficHistory).map((p) => ({
        ...p,
        inMbps: Math.abs(p.inMbps),
        outPlot: trafficChartMode === 'mirrored' ? -Math.abs(p.outMbps) : Math.abs(p.outMbps),
      })),
    [source, portData, trafficHistory, trafficChartMode],
  );
  const maxAbsMbps = useMemo(() => {
    const peak = data.reduce((acc, p) => Math.max(acc, Math.abs(p.inMbps), Math.abs(p.outPlot)), 0);
    return peak > 0 ? Number(peak.toFixed(2)) : 1;
  }, [data]);
  const defaultTitle = source === 'port'
    ? (iface ? `${dev?.name} · ${iface.name}` : 'Lưu lượng cổng')
    : 'Lưu lượng toàn hệ thống';
  const title = widget.config.title || defaultTitle;

  const inId = `wIn-${widget.id}`;
  const outId = `wOut-${widget.id}`;

  return (
    <div className="w-full h-full p-3 flex flex-col">
      <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-cyan-400" /> {title}
        {source === 'port' && <span className="text-slate-600">· {hours}h</span>}
      </div>
      {source === 'port' && !portId ? (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-500">Chưa chọn cổng — bấm cấu hình.</div>
      ) : portErr ? (
        <div className="flex-1 flex items-center justify-center text-xs text-red-400">Không tải được dữ liệu cổng.</div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id={inId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={outId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#1e293b' : '#e2e8f0'} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  domain={trafficChartMode === 'mirrored' ? [-maxAbsMbps, maxAbsMbps] : [0, maxAbsMbps]}
                  tickFormatter={(value) =>
                    trafficChartMode === 'mirrored' ? Math.abs(Number(value)).toFixed(0) : Number(value).toFixed(0)
                  }
                />
                <Tooltip
                  contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => [`${Math.abs(Number(value)).toFixed(2)} Mbps`, name]}
                />
                {trafficChartMode === 'mirrored' && (
                  <ReferenceLine y={0} stroke={darkMode ? '#475569' : '#94a3b8'} strokeDasharray="3 3" />
                )}
                <Area type="monotone" dataKey="inMbps" name="Vào (Mbps)" stroke="#06b6d4" fill={`url(#${inId})`} strokeWidth={2} />
                <Area type="monotone" dataKey="outPlot" name="Ra (Mbps)" stroke="#8b5cf6" fill={`url(#${outId})`} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* Color legend for in/out series */}
          <div className="flex items-center justify-center gap-4 pt-1.5 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: '#06b6d4' }} />
              <ArrowDownLeft className="w-3 h-3 text-cyan-400" /> Vào (In)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: '#8b5cf6' }} />
              <ArrowUpRight className="w-3 h-3 text-violet-400" /> Ra (Out)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Device gauges widget -------------------------------------------------
const GaugeBar: React.FC<{ label: string; value: number; unit: string; color: string }> = ({ label, value, unit, color }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono font-semibold text-slate-200">{value.toFixed(0)}{unit}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const GaugesWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const dev = ctx.devices.find((d) => d.id === widget.config.deviceId) ?? ctx.devices[0];
  const title = widget.config.title || (dev ? dev.name : 'Thiết bị');
  if (!dev) return <div className="p-4 text-xs text-slate-500">Chưa chọn thiết bị.</div>;
  return (
    <div className="w-full h-full p-4 flex flex-col justify-center gap-3">
      <div className="text-xs font-semibold text-slate-300 truncate flex items-center gap-1.5">
        <Signal className="w-3.5 h-3.5 text-emerald-400" /> {title}
      </div>
      <GaugeBar label="CPU" value={dev.cpuUsage} unit="%" color={dev.cpuUsage > 85 ? 'bg-red-500' : 'bg-emerald-500'} />
      <GaugeBar label="RAM" value={dev.memoryUsage} unit="%" color={dev.memoryUsage > 85 ? 'bg-red-500' : 'bg-blue-500'} />
      <GaugeBar label="Nhiệt độ" value={dev.temperature || 0} unit="°C" color={(dev.temperature || 0) > 65 ? 'bg-red-500' : 'bg-amber-500'} />
    </div>
  );
};

// --- Device status grid widget --------------------------------------------
const DeviceStatusWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const title = widget.config.title || 'Trạng thái thiết bị';
  let list = ctx.devices;
  if (widget.config.groupId) list = list.filter((d) => d.groupId === widget.config.groupId);
  const color = (s: string) => s === 'up' ? 'bg-emerald-500' : s === 'down' ? 'bg-red-500' : s === 'critical' ? 'bg-orange-500' : s === 'warning' ? 'bg-amber-500' : 'bg-slate-500';
  return (
    <div className="w-full h-full p-3 flex flex-col">
      <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
        <Server className="w-3.5 h-3.5 text-blue-400" /> {title} <span className="text-slate-600">({list.length})</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 auto-rows-min">
        {list.map((d) => (
          <button
            key={d.id}
            onClick={() => ctx.onSelectDevice(d)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-700/60 text-left"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${color(d.status)} ${d.status === 'down' ? 'animate-pulse' : ''}`} />
            <span className="text-xs text-slate-200 truncate">{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// --- Alert list widget ----------------------------------------------------
const AlertListWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const title = widget.config.title || 'Cảnh báo mới nhất';
  const limit = widget.config.limit ?? 8;
  const list = ctx.alerts
    .filter((a) => a.status !== 'resolved')
    .slice(0, limit);
  const sevColor = (s: string) =>
    s === 'critical'
      ? 'text-red-400'
      : s === 'high'
      ? 'text-orange-400'
      : s === 'medium'
      ? 'text-amber-400'
      : 'text-sky-400';
  const sevRow = (s: string) =>
    s === 'critical'
      ? 'bg-red-950/25 border border-red-500/30'
      : s === 'high'
      ? 'bg-orange-950/20 border border-orange-500/25'
      : s === 'medium'
      ? 'bg-amber-950/20 border border-amber-500/25'
      : 'bg-sky-950/20 border border-sky-500/20';
  const sevText = (s: string) =>
    s === 'critical'
      ? 'text-red-300'
      : s === 'high'
      ? 'text-orange-300'
      : s === 'medium'
      ? 'text-amber-300'
      : 'text-sky-300';
  return (
    <div className="w-full h-full p-3 flex flex-col">
      <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> {title}
      </div>
      <div className="flex-1 min-h-0 overflow-auto space-y-1.5">
        {list.length === 0 && <div className="text-xs text-slate-500 py-4 text-center">Không có cảnh báo.</div>}
        {list.map((a) => (
          <div key={a.id} className={`flex items-start gap-2 px-2 py-1.5 rounded-lg ${sevRow(a.severity)}`}>
            <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${sevColor(a.severity)}`} />
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-semibold truncate ${sevText(a.severity)}`}>{a.deviceName}</div>
              <div className="text-[11px] text-slate-400 truncate">{a.message}</div>
            </div>
            {a.status === 'active' && (
              <button
                onClick={() => ctx.onAcknowledgeAlert(a.id)}
                className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 shrink-0"
                title="Xác nhận"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Top interfaces widget ------------------------------------------------
const TopInterfacesWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const sortBy = (widget.config.sortBy ?? 'utilization') as PortSortBy;
  const limit = widget.config.limit ?? 6;
  const title = widget.config.title || (sortBy === 'bandwidth' ? 'Top cổng theo băng thông' : 'Top cổng theo tải');
  const [fallbackRows, setFallbackRows] = useState<{ dev: string; name: string; desc: string; util: number; inBps: number; outBps: number }[]>([]);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  const extractRows = useCallback((devices: NetworkDevice[]) => {
    const rows: { dev: string; name: string; desc: string; util: number; inBps: number; outBps: number }[] = [];
    devices.forEach((d) =>
      d.interfaces.forEach((i) => {
        rows.push({
          dev: d.name,
          name: i.name,
          desc: i.description || i.alias || '',
          util: i.utilization,
          inBps: i.inRateBps,
          outBps: i.outRateBps,
        });
      }),
    );
    return rows;
  }, []);

  const baseRows = useMemo(() => extractRows(ctx.devices), [ctx.devices, extractRows]);

  useEffect(() => {
    if (baseRows.length > 0) {
      setFallbackRows([]);
      setFallbackLoading(false);
      setFallbackError(null);
      return;
    }

    let cancelled = false;
    setFallbackLoading(true);
    setFallbackError(null);
    api.devices
      .listFull()
      .then((full) => {
        if (cancelled) return;
        setFallbackRows(extractRows(full));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('TopInterfacesWidget fallback load failed', err);
        setFallbackError('Không tải được dữ liệu cổng');
      })
      .finally(() => {
        if (!cancelled) setFallbackLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [baseRows.length, extractRows]);

  const sourceRows = baseRows.length > 0 ? baseRows : fallbackRows;
  const top = sourceRows
    .sort((a, b) => sortBy === 'bandwidth' ? (b.inBps + b.outBps) - (a.inBps + a.outBps) : b.util - a.util)
    .slice(0, limit);
  const fmt = (bps: number) => bps >= 1e9 ? `${(bps / 1e9).toFixed(2)} Gbps` : bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbps` : `${(bps / 1e3).toFixed(0)} Kbps`;
  const maxRate = Math.max(1, ...top.map((t) => Math.max(t.inBps, t.outBps)));
  return (
    <div className="w-full h-full p-3 flex flex-col">
      <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
        <ArrowUpRight className="w-3.5 h-3.5 text-violet-400" /> {title}
      </div>
      <div className="flex-1 min-h-0 overflow-auto space-y-2">
        {top.map((t, idx) => (
          <div key={idx} className="px-2 py-1.5 rounded-lg bg-slate-800/40">
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs text-slate-200 truncate">{t.dev} · {t.name}</span>
              <span className="text-[11px] font-mono text-slate-400 shrink-0">{sortBy === 'utilization' ? `${t.util.toFixed(0)}%` : fmt(t.inBps + t.outBps)}</span>
            </div>
            {t.desc && <div className="text-[10px] text-slate-500 truncate mb-1" title={t.desc}>{t.desc}</div>}
            {/* In line */}
            <div className="flex items-center gap-1.5 mt-1">
              <ArrowDownLeft className="w-3 h-3 text-cyan-400 shrink-0" />
              <div className="h-1.5 flex-1 rounded-full bg-slate-700/50 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-500" style={{ width: `${(t.inBps / maxRate) * 100}%` }} />
              </div>
              <span className="text-[10px] font-mono text-cyan-300 w-20 text-right shrink-0">{fmt(t.inBps)}</span>
            </div>
            {/* Out line */}
            <div className="flex items-center gap-1.5 mt-1">
              <ArrowUpRight className="w-3 h-3 text-violet-400 shrink-0" />
              <div className="h-1.5 flex-1 rounded-full bg-slate-700/50 overflow-hidden">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${(t.outBps / maxRate) * 100}%` }} />
              </div>
              <span className="text-[10px] font-mono text-violet-300 w-20 text-right shrink-0">{fmt(t.outBps)}</span>
            </div>
          </div>
        ))}
        {fallbackLoading && top.length === 0 && <div className="text-xs text-slate-500 py-4 text-center">Đang tải dữ liệu cổng...</div>}
        {!fallbackLoading && top.length === 0 && (
          <div className="text-xs text-slate-500 py-4 text-center">
            {fallbackError ? `${fallbackError}.` : 'Chưa có dữ liệu cổng. Hãy quét SNMP hoặc Poll lại thiết bị để cập nhật interface.'}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Top devices by resource widget --------------------------------------
const DEVICE_METRIC_META: Record<DeviceMetric, { label: string; unit: string; icon: React.ElementType; get: (d: NetworkDevice) => number; warn: number }> = {
  cpu: { label: 'CPU', unit: '%', icon: Cpu, get: (d) => d.cpuUsage, warn: 85 },
  memory: { label: 'RAM', unit: '%', icon: MemoryStick, get: (d) => d.memoryUsage, warn: 85 },
  temperature: { label: 'Nhiệt độ', unit: '°C', icon: Thermometer, get: (d) => d.temperature || 0, warn: 65 },
};

const TopDevicesWidget: React.FC<{ widget: DashboardWidget; ctx: GridCtx }> = ({ widget, ctx }) => {
  const metric = (widget.config.deviceMetric ?? 'cpu') as DeviceMetric;
  const meta = DEVICE_METRIC_META[metric];
  const limit = widget.config.limit ?? 6;
  const title = widget.config.title || `Top thiết bị theo ${meta.label}`;
  const Icon = meta.icon;
  const top = [...ctx.devices]
    .filter((d) => d.status !== 'down')
    .sort((a, b) => meta.get(b) - meta.get(a))
    .slice(0, limit);
  return (
    <div className="w-full h-full p-3 flex flex-col">
      <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-amber-400" /> {title}
      </div>
      <div className="flex-1 min-h-0 overflow-auto space-y-1.5">
        {top.map((d) => {
          const v = meta.get(d);
          const pct = metric === 'temperature' ? Math.min(100, v) : Math.max(0, Math.min(100, v));
          return (
            <button key={d.id} onClick={() => ctx.onSelectDevice(d)} className="w-full text-left px-2 py-1.5 rounded-lg bg-slate-800/40 hover:bg-slate-700/50">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-slate-200 truncate">{d.name}</span>
                <span className="text-[11px] font-mono text-slate-300">{v.toFixed(0)}{meta.unit}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                <div className={`h-full rounded-full ${v >= meta.warn ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
        {top.length === 0 && <div className="text-xs text-slate-500 py-4 text-center">Chưa có dữ liệu thiết bị.</div>}
      </div>
    </div>
  );
};

// --- Clock widget ---------------------------------------------------------
const ClockWidget: React.FC<{ widget: DashboardWidget }> = ({ widget }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const accent = ACCENT[widget.config.accent ?? 'cyan'] ?? ACCENT.cyan;
  return (
    <div className="w-full h-full p-4 flex flex-col items-center justify-center text-center">
      {widget.config.title && <div className="text-sm font-semibold text-slate-300 mb-1 truncate w-full">{widget.config.title}</div>}
      <div className={`font-mono font-bold ${accent.text}`} style={{ fontSize: 'clamp(1.5rem, 6vh, 3rem)' }}>
        {now.toLocaleTimeString('vi-VN')}
      </div>
      <div className="text-xs text-slate-500 mt-1">{now.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
  );
};

// --- Text widget ----------------------------------------------------------
const TextWidget: React.FC<{ widget: DashboardWidget }> = ({ widget }) => {
  const accent = ACCENT[widget.config.accent ?? 'slate'] ?? ACCENT.slate;
  return (
    <div className="w-full h-full p-4 flex flex-col items-center justify-center text-center">
      {widget.config.title && <div className={`font-bold ${accent.text}`} style={{ fontSize: 'clamp(1rem, 3.5vh, 2rem)' }}>{widget.config.title}</div>}
      {widget.config.text && <div className="text-sm text-slate-400 mt-1 whitespace-pre-wrap">{widget.config.text}</div>}
    </div>
  );
};

// =========================================================================
// Modals
// =========================================================================
const WidgetPickerModal: React.FC<{ darkMode: boolean; onPick: (t: WidgetType) => void; onClose: () => void }> = ({ darkMode, onPick, onClose }) => (
  <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className={`w-full max-w-2xl rounded-2xl border p-5 ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-100">Chọn loại widget</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400"><X className="w-5 h-5" /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {WIDGET_CATALOG.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.type}
              onClick={() => onPick(c.type)}
              className="p-4 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-700/60 hover:border-blue-500/50 flex flex-col items-center gap-2 text-center transition-colors"
            >
              <Icon className="w-6 h-6 text-blue-400" />
              <span className="text-xs font-medium text-slate-200">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

const WidgetConfigModal: React.FC<{
  widget: DashboardWidget;
  devices: NetworkDevice[];
  darkMode: boolean;
  onSave: (cfg: DashboardWidget['config']) => void;
  onClose: () => void;
}> = ({ widget, devices, darkMode, onSave, onClose }) => {
  const [cfg, setCfg] = useState<DashboardWidget['config']>({ ...widget.config });
  const set = (patch: Partial<DashboardWidget['config']>) => setCfg((p) => ({ ...p, ...patch }));
  const inputCls = `w-full px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;

  const needsTitle = true;
  const needsDevice = widget.type === 'device-gauges';
  const needsStatMetric = widget.type === 'stat';
  const needsLimit = widget.type === 'alert-list' || widget.type === 'top-interfaces' || widget.type === 'top-devices';
  const needsGroup = widget.type === 'device-status';
  const needsText = widget.type === 'text';
  const needsAccent = widget.type === 'stat' || widget.type === 'clock' || widget.type === 'text';
  const needsTraffic = widget.type === 'traffic-chart';
  const needsSortBy = widget.type === 'top-interfaces';
  const needsDeviceMetric = widget.type === 'top-devices';

  const trafficDev = devices.find((d) => d.id === cfg.deviceId);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-2xl border p-5 space-y-4 ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-100">Cấu hình widget</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {needsTitle && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Tiêu đề {needsText ? '' : '(để trống dùng mặc định)'}</span>
            <input className={inputCls} value={cfg.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="Tiêu đề hiển thị" />
          </label>
        )}

        {needsStatMetric && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Chỉ số</span>
            <select className={inputCls} value={cfg.statMetric ?? 'total-devices'} onChange={(e) => set({ statMetric: e.target.value as StatMetric })}>
              {STAT_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        )}

        {needsDevice && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Thiết bị</span>
            <DevicePickerButton devices={devices} darkMode={darkMode} value={cfg.deviceId ?? ''} onChange={(id) => set({ deviceId: id })} />
          </label>
        )}

        {needsTraffic && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Thiết bị</span>
              <DevicePickerButton devices={devices} darkMode={darkMode} value={cfg.deviceId ?? ''} onChange={(id) => set({ deviceId: id, portId: '', source: 'port' })} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Cổng / Interface</span>
              <PortPickerButton device={trafficDev} darkMode={darkMode} value={cfg.portId ?? ''} onChange={(id) => set({ portId: id, source: 'port' })} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Khoảng thời gian</span>
              <select className={inputCls} value={cfg.hours ?? 1} onChange={(e) => set({ hours: Number(e.target.value) })}>
                <option value={1}>1 giờ</option>
                <option value={6}>6 giờ</option>
                <option value={24}>24 giờ</option>
                <option value={168}>7 ngày</option>
              </select>
            </label>
          </>
        )}

        {needsSortBy && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Sắp xếp theo</span>
            <select className={inputCls} value={(cfg.sortBy ?? 'utilization') as PortSortBy} onChange={(e) => set({ sortBy: e.target.value as PortSortBy })}>
              <option value="utilization">Mức sử dụng (%)</option>
              <option value="bandwidth">Băng thông (bps vào+ra)</option>
            </select>
          </label>
        )}

        {needsDeviceMetric && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Tài nguyên</span>
            <select className={inputCls} value={(cfg.deviceMetric ?? 'cpu') as DeviceMetric} onChange={(e) => set({ deviceMetric: e.target.value as DeviceMetric })}>
              <option value="cpu">CPU (%)</option>
              <option value="memory">RAM (%)</option>
              <option value="temperature">Nhiệt độ (°C)</option>
            </select>
          </label>
        )}

        {needsGroup && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Lọc theo nhóm (tùy chọn)</span>
            <input className={inputCls} value={(cfg.groupId as string) ?? ''} onChange={(e) => set({ groupId: e.target.value || null })} placeholder="ID nhóm, để trống = tất cả" />
          </label>
        )}

        {needsLimit && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Số dòng hiển thị</span>
            <input type="number" min={1} max={50} className={inputCls} value={cfg.limit ?? 8} onChange={(e) => set({ limit: Number(e.target.value) })} />
          </label>
        )}

        {needsText && (
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Nội dung</span>
            <textarea className={`${inputCls} h-24 resize-none`} value={cfg.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder="Dòng chữ hiển thị..." />
          </label>
        )}

        {needsAccent && (
          <div>
            <span className="text-xs font-medium text-slate-400">Màu nhấn</span>
            <div className="flex gap-2 mt-1.5">
              {ACCENT_KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => set({ accent: k })}
                  className={`w-7 h-7 rounded-full ${ACCENT[k].bg} ring-2 ${cfg.accent === k ? ACCENT[k].ring : 'ring-transparent'}`}
                  title={k}
                >
                  <span className={`block w-full h-full rounded-full ${ACCENT[k].text}`}>●</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-700 text-slate-300 hover:bg-slate-800">Hủy</button>
          <button onClick={() => onSave(cfg)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white">Lưu widget</button>
        </div>
      </div>
    </div>
  );
};

const ManageDashboardModal: React.FC<{
  darkMode: boolean;
  dashboard: Dashboard;
  siteLabel: string;
  canDelete: boolean;
  onCreate: (name: string) => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onSetDefault: () => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ darkMode, dashboard, siteLabel, canDelete, onCreate, onDuplicate, onRename, onSetDefault, onDelete, onClose }) => {
  const [name, setName] = useState(dashboard.name);
  const [newName, setNewName] = useState('');
  const inputCls = `w-full px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-2xl border p-5 space-y-5 ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-100">Quản lý dashboard</h3>
            <p className="text-xs text-cyan-300 mt-1">Phạm vi: {siteLabel}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {/* Rename current */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-400">Đổi tên dashboard hiện tại</span>
          <div className="flex gap-2">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            <button onClick={() => name.trim() && onRename(name.trim())} className="px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white shrink-0">Lưu</button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={onSetDefault} disabled={dashboard.isDefault} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" /> {dashboard.isDefault ? 'Đang là mặc định' : 'Đặt làm mặc định'}
            </button>
            <button onClick={onDuplicate} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-600 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Nhân bản
            </button>
            <button onClick={onDelete} disabled={!canDelete} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> Xóa
            </button>
          </div>
        </div>

        <div className="border-t border-slate-700/60" />

        {/* Create new */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-400">Tạo dashboard mới (cho màn hình TV riêng)</span>
          <div className="flex gap-2">
            <input className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tên dashboard mới" />
            <button
              onClick={() => { if (newName.trim()) { onCreate(newName.trim()); onClose(); } }}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Tạo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
