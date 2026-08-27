import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitFork, Plus, Trash2, RefreshCw, Cable, Link2, X, Cloud, Building2, StickyNote,
  ZoomIn, ZoomOut, Maximize2, Magnet, Download, Image as ImageIcon, LayoutGrid, Waypoints,
  Maximize, Minimize,
} from 'lucide-react';
import { api } from '../services/api';
import { NetworkDevice, NetworkAlert, MapNode, MapLink } from '../types';
import { PortPickerButton } from './DevicePortPicker';

// Reference-object kinds a node may take when not backed by a monitored device.
const REFERENCE_KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  cloud: { label: 'Internet / Cloud', icon: Cloud },
  site: { label: 'Site khác', icon: Building2 },
  note: { label: 'Ghi chú', icon: StickyNote },
};

// Glyph shown on a device node, based on its monitored device type.
const DEVICE_TYPE_GLYPH: Record<string, string> = {
  router: '📡',
  switch: '🔀',
  firewall: '🛡️',
  server: '🖥️',
  wireless: '📶',
  storage: '💾',
  ups: '🔋',
};

const GRID_SIZE = 20;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;

interface TopologyEditorProps {
  devices: NetworkDevice[];
  alerts: NetworkAlert[];
  selectedSiteId: string | null;
  darkMode: boolean;
  onOpenDevice?: (device: NetworkDevice) => void;
}

interface LinkSuggestion {
  key: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceName: string;
  targetName: string;
  sourcePortId: string | null;
  targetPortId: string | null;
  sourcePortName?: string;
  targetPortName?: string;
  protocol: string;
}

interface HoverInfo {
  x: number;
  y: number;
  lines: string[];
}

const mbps = (bps: number): string => (bps / 1e6).toFixed(1);

export const TopologyEditor: React.FC<TopologyEditorProps> = ({ devices, alerts, selectedSiteId, darkMode, onOpenDevice }) => {
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [links, setLinks] = useState<MapLink[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [addDeviceId, setAddDeviceId] = useState('');
  const [refKind, setRefKind] = useState<'cloud' | 'site' | 'note'>('cloud');
  const [refLabel, setRefLabel] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startViewX: number; startViewY: number } | null>(null);

  // Fullscreen so the map can be drawn/edited or left up on a monitor for live viewing.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      containerRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  const load = useCallback(async () => {
    const siteFilter = selectedSiteId === null ? undefined : selectedSiteId;
    const { nodes: n, links: l } = await api.topologyMap.get(siteFilter);
    setNodes(n);
    setLinks(l);
  }, [selectedSiteId]);

  useEffect(() => {
    load().catch(() => undefined);
    // Refresh periodically so link traffic figures stay live.
    const t = setInterval(() => load().catch(() => undefined), 10000);
    return () => clearInterval(t);
  }, [load]);

  const devicesOnMap = useMemo(() => new Set(nodes.map((n) => n.deviceId)), [nodes]);
  const availableDevices = devices.filter((d) => !devicesOnMap.has(d.id));

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const nodeByDeviceId = useMemo(() => {
    const map = new Map<string, MapNode>();
    for (const n of nodes) if (n.deviceId) map.set(n.deviceId, n);
    return map;
  }, [nodes]);
  // Active/acknowledged (unresolved) alert count per device, shown as a badge on map nodes.
  const activeAlertCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of alerts) {
      if (a.status !== 'resolved') map.set(a.deviceId, (map.get(a.deviceId) ?? 0) + 1);
    }
    return map;
  }, [alerts]);

  // Parallel links (same pair of objects, either order) so they can be spread apart
  // visually instead of overlapping into a single line.
  const linkGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const l of links) {
      const key = [l.sourceNodeId, l.targetNodeId].sort().join('|');
      const arr = groups.get(key) ?? [];
      arr.push(l.id);
      groups.set(key, arr);
    }
    return groups;
  }, [links]);

  // --- Zoom / pan / drag handling -------------------------------------------
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  }, [view]);

  const onPointerDownNode = (e: React.PointerEvent, node: MapNode) => {
    e.stopPropagation();
    setSelectedNodeId(node.id);
    setSelectedLinkId(null);
    const w = screenToWorld(e.clientX, e.clientY);
    dragRef.current = { id: node.id, dx: w.x - node.x, dy: w.y - node.y };
  };

  // Dragging on empty canvas pans the view instead of moving a node.
  const onPointerDownBackground = (e: React.PointerEvent) => {
    panRef.current = { startX: e.clientX, startY: e.clientY, startViewX: view.x, startViewY: view.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const w = screenToWorld(e.clientX, e.clientY);
      let x = w.x - drag.dx;
      let y = w.y - drag.dy;
      if (snapToGrid) {
        x = Math.round(x / GRID_SIZE) * GRID_SIZE;
        y = Math.round(y / GRID_SIZE) * GRID_SIZE;
      }
      x = Math.max(24, Math.min(2600, x));
      y = Math.max(24, Math.min(1600, y));
      setNodes((prev) => prev.map((n) => (n.id === drag.id ? { ...n, x, y } : n)));
      return;
    }
    const pan = panRef.current;
    if (pan) {
      setView((v) => ({ ...v, x: pan.startViewX + (e.clientX - pan.startX), y: pan.startViewY + (e.clientY - pan.startY) }));
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    panRef.current = null;
    if (!drag) return;
    const node = nodes.find((n) => n.id === drag.id);
    if (node) api.topologyMap.moveNode(node.id, node.x, node.y).catch(() => undefined);
  };

  // Mouse-wheel zoom, keeping the point under the cursor stationary. Attached as a
  // native non-passive listener (see effect below) because React's onWheel is passive
  // by default, so preventDefault() there wouldn't stop the page from scrolling too.
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return { scale, x: cx - worldX * scale, y: cy - worldY * scale };
    });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const zoomBy = (factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return { scale, x: cx - worldX * scale, y: cy - worldY * scale };
    });
  };

  const resetView = () => setView({ x: 0, y: 0, scale: 1 });

  // --- Node / link mutations ------------------------------------------------
  const handleAddDevice = async () => {
    if (!addDeviceId) return;
    await api.topologyMap.addNode({ deviceId: addDeviceId, x: 100 + Math.random() * 300, y: 100 + Math.random() * 200 });
    setAddDeviceId('');
    load().catch(() => undefined);
  };

  // Adds a reference-only object (no monitored device) for diagram context, e.g.
  // an "Internet" cloud or another site.
  const handleAddReference = async () => {
    await api.topologyMap.addNode({
      kind: refKind,
      label: refLabel.trim() || undefined,
      x: 100 + Math.random() * 300,
      y: 100 + Math.random() * 200,
    });
    setRefLabel('');
    load().catch(() => undefined);
  };

  const handleDeleteNode = async (id: string) => {
    await api.topologyMap.removeNode(id);
    setSelectedNodeId(null);
    load().catch(() => undefined);
  };

  const handleDeleteLink = async (id: string) => {
    await api.topologyMap.removeLink(id);
    setSelectedLinkId(null);
    load().catch(() => undefined);
  };

  // Delete/Backspace removes whichever node or link is currently selected
  // (ignored while typing in a form field).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (selectedNodeId) handleDeleteNode(selectedNodeId);
      else if (selectedLinkId) handleDeleteLink(selectedLinkId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, selectedLinkId]);

  // --- Auto-arrange -----------------------------------------------------------
  const handleAutoArrange = async () => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const spacingX = 190;
    const spacingY = 150;
    const arranged = nodes.map((n, i) => ({
      ...n,
      x: 110 + (i % cols) * spacingX,
      y: 110 + Math.floor(i / cols) * spacingY,
    }));
    setNodes(arranged);
    resetView();
    await Promise.all(arranged.map((n) => api.topologyMap.moveNode(n.id, n.x, n.y).catch(() => undefined)));
  };

  // --- LLDP-based link suggestions --------------------------------------------
  const existingPairs = useMemo(() => {
    const set = new Set<string>();
    for (const l of links) set.add([l.sourceNodeId, l.targetNodeId].sort().join('|'));
    return set;
  }, [links]);

  const handleSuggestLinks = async () => {
    setLoadingSuggestions(true);
    try {
      const siteFilter = selectedSiteId === null ? undefined : selectedSiteId;
      const { links: raw } = await api.topology.get(siteFilter);
      const seen = new Set<string>();
      const result: LinkSuggestion[] = [];
      for (const l of raw) {
        const sNode = nodeByDeviceId.get(l.source);
        const tNode = nodeByDeviceId.get(l.target);
        if (!sNode || !tNode || sNode.id === tNode.id) continue;
        const pairKey = [sNode.id, tNode.id].sort().join('|');
        if (existingPairs.has(pairKey) || seen.has(pairKey)) continue;
        seen.add(pairKey);
        const sDevice = deviceById.get(l.source);
        const tDevice = deviceById.get(l.target);
        const sPort = sDevice?.interfaces.find((i) => i.name === l.sourceInterface);
        const tPort = tDevice?.interfaces.find((i) => i.name === l.targetInterface);
        result.push({
          key: pairKey,
          sourceNodeId: sNode.id,
          targetNodeId: tNode.id,
          sourceName: sNode.name,
          targetName: tNode.name,
          sourcePortId: sPort?.id ?? null,
          targetPortId: tPort?.id ?? null,
          sourcePortName: l.sourceInterface,
          targetPortName: l.targetInterface,
          protocol: l.speed,
        });
      }
      setSuggestions(result);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const applySuggestion = async (s: LinkSuggestion) => {
    await api.topologyMap.addLink({
      sourceNodeId: s.sourceNodeId,
      targetNodeId: s.targetNodeId,
      sourcePortId: s.sourcePortId,
      targetPortId: s.targetPortId,
      label: null,
    });
    setSuggestions((prev) => prev?.filter((x) => x.key !== s.key) ?? null);
    load().catch(() => undefined);
  };

  // --- Export --------------------------------------------------------------
  const buildStandaloneSvg = (): { data: string; width: number; height: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(rect.width));
    clone.setAttribute('height', String(rect.height));
    clone.style.background = '#020617';
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectBg.setAttribute('width', '100%');
    rectBg.setAttribute('height', '100%');
    rectBg.setAttribute('fill', '#020617');
    clone.insertBefore(rectBg, clone.firstChild);
    const data = new XMLSerializer().serializeToString(clone);
    return { data, width: rect.width, height: rect.height };
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSvg = () => {
    const built = buildStandaloneSvg();
    if (!built) return;
    downloadBlob(new Blob([built.data], { type: 'image/svg+xml;charset=utf-8' }), 'so-do-mang.svg');
  };

  const handleExportPng = () => {
    const built = buildStandaloneSvg();
    if (!built) return;
    const svgBlob = new Blob([built.data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scaleFactor = 2;
      const canvasEl = document.createElement('canvas');
      canvasEl.width = built.width * scaleFactor;
      canvasEl.height = built.height * scaleFactor;
      const ctx = canvasEl.getContext('2d');
      if (ctx) {
        ctx.scale(scaleFactor, scaleFactor);
        ctx.drawImage(img, 0, 0, built.width, built.height);
      }
      URL.revokeObjectURL(url);
      canvasEl.toBlob((blob) => {
        if (blob) downloadBlob(blob, 'so-do-mang.png');
      });
    };
    img.src = url;
  };

  const panelCls = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';

  return (
    <div
      ref={containerRef}
      className={isFullscreen ? `p-4 space-y-4 overflow-auto h-full ${darkMode ? 'bg-slate-950' : 'bg-white'}` : 'space-y-4 pb-12'}
    >
      {/* Toolbar */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 ${panelCls}`}>
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <GitFork className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm font-mono text-slate-100">Sơ đồ mạng</h3>
            <p className="text-xs text-slate-400">Kéo-thả thiết bị hoặc đối tượng tham chiếu, tạo nhiều liên kết giữa 2 đối tượng, hiển thị traffic in/out theo thời gian thực</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <select
            value={addDeviceId}
            onChange={(e) => setAddDeviceId(e.target.value)}
            className={`py-1.5 px-3 rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`}
          >
            <option value="">+ Thêm thiết bị vào sơ đồ...</option>
            {availableDevices.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
            ))}
          </select>
          <button
            onClick={handleAddDevice}
            disabled={!addDeviceId}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Thêm
          </button>
          <select
            value={refKind}
            onChange={(e) => setRefKind(e.target.value as 'cloud' | 'site' | 'note')}
            className={`py-1.5 px-3 rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`}
            title="Đối tượng tham chiếu (không phải thiết bị được giám sát)"
          >
            {Object.entries(REFERENCE_KIND_META).map(([k, meta]) => (
              <option key={k} value={k}>{meta.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={refLabel}
            onChange={(e) => setRefLabel(e.target.value)}
            placeholder="Tên hiển thị (VD: Internet, Chi nhánh HCM)"
            className={`py-1.5 px-3 rounded-lg border w-52 ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`}
          />
          <button
            onClick={handleAddReference}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Thêm đối tượng
          </button>
          <button
            onClick={() => setShowLinkForm(true)}
            disabled={nodes.length < 2}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center gap-1"
          >
            <Link2 className="w-3.5 h-3.5" /> Tạo liên kết
          </button>
          <button
            onClick={() => load()}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700"
            title="Làm mới"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* View / layout toolbar */}
      <div className={`p-3 rounded-xl border flex flex-wrap items-center gap-2 font-mono text-xs ${panelCls}`}>
        <button onClick={() => zoomBy(1.2)} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700" title="Phóng to">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => zoomBy(1 / 1.2)} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700" title="Thu nhỏ">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={resetView} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700" title="Đặt lại góc nhìn">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <span className="text-slate-500">{Math.round(view.scale * 100)}%</span>
        <button
          onClick={() => setSnapToGrid((v) => !v)}
          className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${snapToGrid ? 'bg-emerald-600/80 border-emerald-500 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'}`}
          title="Hít vào lưới khi kéo-thả"
        >
          <Magnet className="w-3.5 h-3.5" /> Snap lưới
        </button>
        <div className="w-px h-5 bg-slate-700 mx-1" />
        <button
          onClick={handleAutoArrange}
          disabled={nodes.length === 0}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1"
          title="Sắp xếp lại các đối tượng theo lưới"
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Sắp xếp tự động
        </button>
        <button
          onClick={handleSuggestLinks}
          disabled={loadingSuggestions || nodes.length < 2}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1"
          title="Gợi ý liên kết còn thiếu dựa trên LLDP/CDP neighbor"
        >
          <Waypoints className="w-3.5 h-3.5" /> {loadingSuggestions ? 'Đang quét...' : 'Gợi ý liên kết (LLDP)'}
        </button>
        <div className="w-px h-5 bg-slate-700 mx-1" />
        <button onClick={handleExportSvg} disabled={nodes.length === 0} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1" title="Xuất file SVG">
          <Download className="w-3.5 h-3.5" /> SVG
        </button>
        <button onClick={handleExportPng} disabled={nodes.length === 0} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1" title="Xuất ảnh PNG">
          <ImageIcon className="w-3.5 h-3.5" /> PNG
        </button>
        <div className="w-px h-5 bg-slate-700 mx-1" />
        <button
          onClick={toggleFullscreen}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1"
          title={isFullscreen ? 'Thoát toàn màn hình' : 'Mở toàn màn hình (vẽ / theo dõi trên monitor)'}
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />} {isFullscreen ? 'Thoát' : 'Toàn màn hình'}
        </button>
        <span className="text-slate-500 ml-auto">Lăn chuột để zoom · Kéo nền để di chuyển góc nhìn · Delete để xóa mục đang chọn</span>
      </div>

      {/* LLDP link suggestions */}
      {suggestions && (
        <div className={`p-4 rounded-xl border ${panelCls}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-xs font-mono text-slate-200 flex items-center gap-1"><Waypoints className="w-3.5 h-3.5" /> Liên kết gợi ý từ LLDP/CDP ({suggestions.length})</h4>
            <button onClick={() => setSuggestions(null)} className="text-slate-400 hover:text-slate-200"><X className="w-4 h-4" /></button>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-[11px] text-slate-500 font-mono">Không tìm thấy liên kết còn thiếu nào giữa các thiết bị đã có trên sơ đồ.</p>
          ) : (
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <div key={s.key} className="flex items-center justify-between text-[11px] font-mono bg-slate-800/40 rounded-lg px-3 py-1.5">
                  <span className="text-slate-300">
                    <span className="text-emerald-400">{s.sourceName}</span>{s.sourcePortName ? ` [${s.sourcePortName}]` : ''} ↔ <span className="text-emerald-400">{s.targetName}</span>{s.targetPortName ? ` [${s.targetPortName}]` : ''}
                    <span className="text-slate-500 ml-2">({s.protocol})</span>
                  </span>
                  <button onClick={() => applySuggestion(s)} className="px-2.5 py-1 bg-emerald-600/80 hover:bg-emerald-600 text-white rounded flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Thêm liên kết
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Canvas */}
      <div className={`rounded-xl border relative overflow-hidden ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 border-slate-800'}`}>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b20_1px,transparent_1px),linear-gradient(to_bottom,#1e293b20_1px,transparent_1px)] bg-[size:24px_24px]" />
        <svg
          ref={svgRef}
          className={`relative w-full touch-none select-none ${isFullscreen ? 'h-[75vh]' : 'h-[560px]'}`}
          onPointerDown={onPointerDownBackground}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={() => { setSelectedNodeId(null); setSelectedLinkId(null); }}
        >
          {nodes.length === 0 && (
            <text x="50%" y="50%" textAnchor="middle" fill="#64748b" fontSize="13" fontFamily="monospace">
              Chưa có đối tượng nào trên sơ đồ. Dùng "Thêm thiết bị" hoặc "Thêm đối tượng" để bắt đầu.
            </text>
          )}

          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {/* Links */}
          {links.map((link) => {
            const s = nodeById.get(link.sourceNodeId);
            const t = nodeById.get(link.targetNodeId);
            if (!s || !t) return null;
            const down = link.operStatus === 'down';
            const isSel = selectedLinkId === link.id;

            // Spread parallel links (same pair) apart with a perpendicular offset so
            // multiple connections between the same two objects don't overlap.
            const key = [link.sourceNodeId, link.targetNodeId].sort().join('|');
            const group = linkGroups.get(key) ?? [link.id];
            const idx = group.indexOf(link.id);
            const spacing = 26;
            const offset = (idx - (group.length - 1) / 2) * spacing;
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const cx = (s.x + t.x) / 2 + nx * offset;
            const cy = (s.y + t.y) / 2 + ny * offset;
            const path = `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`;
            const mx = 0.25 * s.x + 0.5 * cx + 0.25 * t.x;
            const my = 0.25 * s.y + 0.5 * cy + 0.25 * t.y;

            const linkTooltip = () => [
              `${s.name}${link.sourcePortName ? ` [${link.sourcePortName}]` : ''} \u2194 ${t.name}${link.targetPortName ? ` [${link.targetPortName}]` : ''}`,
              `Trạng thái: ${down ? 'Down' : 'Up'}`,
              `Traffic: ▼ In ${mbps(link.inRateBps)} Mbps · ▲ Out ${mbps(link.outRateBps)} Mbps`,
              `Sử dụng: ${link.utilization}%`,
              ...(link.label ? [`Nhãn: ${link.label}`] : []),
            ];

            return (
              <g
                key={link.id}
                onClick={(e) => { e.stopPropagation(); setSelectedLinkId(link.id); setSelectedNodeId(null); }}
                onMouseEnter={(e) => setHoverInfo({ x: e.clientX, y: e.clientY, lines: linkTooltip() })}
                onMouseMove={(e) => setHoverInfo({ x: e.clientX, y: e.clientY, lines: linkTooltip() })}
                onMouseLeave={() => setHoverInfo(null)}
                className="cursor-pointer"
              >
                <path
                  d={path}
                  fill="none"
                  stroke={down ? '#ef4444' : isSel ? '#22d3ee' : '#10b981'}
                  strokeWidth={isSel ? 4 : 2.5}
                  strokeDasharray={down ? '6 4' : undefined}
                  opacity={0.85}
                />
                {!down && (
                  <circle r="3" fill="#ffffff">
                    <animateMotion path={path} dur="3s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Traffic label */}
                <g transform={`translate(${mx}, ${my})`}>
                  <rect x={-46} y={-22} width={92} height={30} rx={5} fill="#0f172a" stroke="#334155" opacity={0.92} />
                  <text x={0} y={-10} textAnchor="middle" fill="#10b981" fontSize="9" fontFamily="monospace">
                    ▼ In {mbps(link.inRateBps)}
                  </text>
                  <text x={0} y={2} textAnchor="middle" fill="#22d3ee" fontSize="9" fontFamily="monospace">
                    ▲ Out {mbps(link.outRateBps)} Mbps
                  </text>
                </g>
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isSel = selectedNodeId === node.id;
            const isDevice = node.kind === 'device';
            const down = isDevice && node.status === 'down';
            const crit = isDevice && node.status === 'critical';
            const warn = isDevice && node.status === 'warning';
            const refColor = '#818cf8';
            const ringColor = isSel ? '#22d3ee' : isDevice ? (down ? '#ef4444' : crit ? '#f97316' : warn ? '#f59e0b' : '#10b981') : refColor;
            const glyph = node.icon ?? (isDevice ? (DEVICE_TYPE_GLYPH[node.type] ?? '🖥️') : '❔');
            const device = node.deviceId ? deviceById.get(node.deviceId) : undefined;
            const alertCount = node.deviceId ? activeAlertCounts.get(node.deviceId) ?? 0 : 0;

            const nodeTooltip = () => {
              if (device) {
                return [
                  `${device.name} (${device.ip})`,
                  `Trạng thái: ${device.status} · CPU ${device.cpuUsage}% · RAM ${device.memoryUsage}%`,
                  `Uptime: ${device.uptime}`,
                  ...(alertCount > 0 ? [`⚠ ${alertCount} cảnh báo chưa xử lý`] : []),
                ];
              }
              return [node.name, REFERENCE_KIND_META[node.kind]?.label ?? node.kind];
            };

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => onPointerDownNode(e, node)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); if (device && onOpenDevice) onOpenDevice(device); }}
                onMouseEnter={(e) => setHoverInfo({ x: e.clientX, y: e.clientY, lines: nodeTooltip() })}
                onMouseMove={(e) => setHoverInfo({ x: e.clientX, y: e.clientY, lines: nodeTooltip() })}
                onMouseLeave={() => setHoverInfo(null)}
              >
                <circle r={isSel ? 26 : 22} fill={ringColor} fillOpacity="0.15" className={down ? 'animate-ping' : ''} />
                <circle r="20" fill="#0f172a" stroke={ringColor} strokeWidth={isSel ? 3 : 2.5} strokeDasharray={isDevice ? undefined : '4 3'} />
                <text y="4" textAnchor="middle" fontSize="14">{glyph}</text>
                <text y="34" fill="#f8fafc" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle" className="select-none">{node.name}</text>
                {isDevice && <text y="46" fill="#10b981" fontSize="9" fontFamily="monospace" textAnchor="middle" className="select-none">{node.ip}</text>}
                {alertCount > 0 && (
                  <g transform="translate(15, -15)">
                    <circle r="8" fill="#ef4444" stroke="#0f172a" strokeWidth="1.5" />
                    <text y="3" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#ffffff">{alertCount > 9 ? '9+' : alertCount}</text>
                  </g>
                )}
              </g>
            );
          })}
          </g>
        </svg>

        {/* Selection action panel */}
        {selectedNodeId && (
          <div className="absolute top-3 right-3 z-10 p-3 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono">
            <p className="text-slate-300 mb-2">{nodeById.get(selectedNodeId)?.name}</p>
            {selectedNodeId && (
            <button
              onClick={() => handleDeleteNode(selectedNodeId)}
              className="px-2.5 py-1 bg-red-600/80 hover:bg-red-600 text-white rounded flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> {nodeById.get(selectedNodeId)?.kind === 'device' ? 'Gỡ khỏi sơ đồ' : 'Xóa đối tượng'}
            </button>
            )}
          </div>
        )}
        {selectedLinkId && (
          <div className="absolute top-3 right-3 z-10 p-3 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono">
            <p className="text-slate-300 mb-2 flex items-center gap-1"><Cable className="w-3.5 h-3.5" /> Liên kết đã chọn</p>
            <button
              onClick={() => handleDeleteLink(selectedLinkId)}
              className="px-2.5 py-1 bg-red-600/80 hover:bg-red-600 text-white rounded flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Xóa liên kết
            </button>
          </div>
        )}

        <p className="absolute bottom-2 left-3 text-[10px] font-mono text-slate-500 select-none pointer-events-none">
          Nhấp đúp vào thiết bị để mở chi tiết
        </p>
      </div>

      {hoverInfo && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg bg-slate-900/95 border border-slate-700 text-[11px] font-mono text-slate-200 shadow-2xl max-w-xs space-y-0.5"
          style={{ left: hoverInfo.x + 14, top: hoverInfo.y + 14 }}
        >
          {hoverInfo.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Link list */}
      {links.length > 0 && (
        <div className={`p-4 rounded-xl border ${panelCls}`}>
          <h4 className="font-bold text-xs font-mono text-slate-200 mb-2">Danh sách liên kết ({links.length})</h4>
          <div className="space-y-1.5">
            {links.map((l) => {
              const s = nodeById.get(l.sourceNodeId);
              const t = nodeById.get(l.targetNodeId);
              return (
                <div key={l.id} className="flex items-center justify-between text-[11px] font-mono bg-slate-800/40 rounded-lg px-3 py-1.5">
                  <span className="text-slate-300">
                    <span className="text-emerald-400">{s?.name ?? '?'}</span>
                    {l.sourcePortName ? ` [${l.sourcePortName}]` : ''} ↔ <span className="text-emerald-400">{t?.name ?? '?'}</span>
                    {l.targetPortName ? ` [${l.targetPortName}]` : ''}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-emerald-400">In {mbps(l.inRateBps)}</span>
                    <span className="text-cyan-400">Out {mbps(l.outRateBps)} Mbps</span>
                    <button onClick={() => handleDeleteLink(l.id)} className="text-slate-500 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showLinkForm && (
        <LinkForm
          devices={devices}
          nodes={nodes}
          darkMode={darkMode}
          onClose={() => setShowLinkForm(false)}
          onCreated={() => { setShowLinkForm(false); load().catch(() => undefined); }}
        />
      )}
    </div>
  );
};

// --- Link creation modal ----------------------------------------------------
interface LinkFormProps {
  devices: NetworkDevice[];
  nodes: MapNode[];
  darkMode: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const LinkForm: React.FC<LinkFormProps> = ({ devices, nodes, darkMode, onClose, onCreated }) => {
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [sourcePortId, setSourcePortId] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [targetPortId, setTargetPortId] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Port pickers only make sense for a device-backed node.
  const sourceNode = nodes.find((n) => n.id === sourceNodeId);
  const targetNode = nodes.find((n) => n.id === targetNodeId);
  const sourceDevice = sourceNode?.deviceId ? devices.find((d) => d.id === sourceNode.deviceId) : undefined;
  const targetDevice = targetNode?.deviceId ? devices.find((d) => d.id === targetNode.deviceId) : undefined;

  const inputCls = `w-full p-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
    setSaving(true);
    try {
      await api.topologyMap.addLink({
        sourceNodeId,
        targetNodeId,
        sourcePortId: sourcePortId || null,
        targetPortId: targetPortId || null,
        label: label || null,
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-lg p-6 rounded-2xl border font-mono shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-cyan-400 flex items-center gap-2"><Link2 className="w-4 h-4" /> Tạo liên kết</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Đối tượng nguồn:</label>
              <select value={sourceNodeId} onChange={(e) => { setSourceNodeId(e.target.value); setSourcePortId(''); }} className={inputCls} required>
                <option value="">-- Chọn --</option>
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Cổng nguồn (traffic):</label>
              <PortPickerButton device={sourceDevice} darkMode={darkMode} value={sourcePortId} onChange={setSourcePortId} placeholder="(không chọn)" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Đối tượng đích:</label>
              <select value={targetNodeId} onChange={(e) => { setTargetNodeId(e.target.value); setTargetPortId(''); }} className={inputCls} required>
                <option value="">-- Chọn --</option>
                {nodes.filter((n) => n.id !== sourceNodeId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Cổng đích:</label>
              <PortPickerButton device={targetDevice} darkMode={darkMode} value={targetPortId} onChange={setTargetPortId} placeholder="(không chọn)" />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Nhãn (tùy chọn):</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="VD: Uplink 10G" />
          </div>
          <p className="text-[10px] text-slate-500">
            Traffic in/out của liên kết được lấy từ cổng nguồn (nếu không chọn thì lấy từ cổng đích). Có thể tạo nhiều liên kết giữa cùng 2 đối tượng — mỗi liên kết sẽ vẽ tách riêng trên sơ đồ.
          </p>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300">Hủy</button>
            <button type="submit" disabled={saving} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold">
              {saving ? 'Đang lưu...' : 'Tạo liên kết'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
