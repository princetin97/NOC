import React, { useState, useEffect, useMemo, useRef } from 'react';
import { NetworkDevice, DeviceStatus, DeviceType, NetworkInterface, DeviceGroup, DeviceSensor, DeviceVlan, AlertRuleInput, ServiceCheck, SiteInfo } from '../types';
import { Server, Search, Filter, RefreshCw, Cpu, HardDrive, Thermometer, Clock, ShieldCheck, Activity, Cable, Terminal, ArrowDownLeft, ArrowUpRight, X, Pencil, Trash2, Radar, Boxes, Plus, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, Folder, FolderOpen, Network, Columns3, PauseCircle, PlayCircle } from 'lucide-react';
import { DeviceMetricsHistory } from './DeviceMetricsHistory';
import { DeviceNeighbors } from './DeviceNeighbors';
import { ProcessorsPanel } from './ProcessorsPanel';
import { SensorHistoryPanel } from './SensorHistoryPanel';
import { PortDetail } from './PortDetail';
import { AlertRuleForm } from './AlertConsole';
import { api } from '../services/api';

// Every interface (including VLAN/virtual), naturally sorted.
const getAllPorts = (device: NetworkDevice): NetworkInterface[] =>
  [...device.interfaces].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

const isVlanInterface = (iface: NetworkInterface): boolean => {
  const type = (iface.ifType || '').toLowerCase();
  if (type === 'l2vlan' || type === 'l3ipvlan' || type === 'propvirtual' || type === 'bridge') return true;
  const name = (iface.name || '').toLowerCase();
  const desc = (iface.description || '').toLowerCase();
  return (
    /^vlan\d+$/i.test(name) ||
    /^vlan\d+$/i.test(desc) ||
    /^vlanif\d+$/i.test(name) ||
    /^vlanif\d+$/i.test(desc) ||
    /^bdi\d+$/i.test(name) ||
    /^irb\.?\d+$/i.test(name) ||
    /\bvlan\s*\d+\b/.test(name) ||
    /\bvlan\s*\d+\b/.test(desc)
  );
};

const isPhysicalOrLagInterface = (iface: NetworkInterface): boolean => {
  const type = (iface.ifType || '').toLowerCase();
  if (type === 'ethernetcsmacd' || type === 'ieee8023adlag' || type === 'fibrechannel') return true;
  const name = (iface.name || '').toLowerCase();
  const numericOnly = /^\d+$/.test(name);
  // Many SMB/HPE devices expose physical ports as A1/A2 or plain numeric labels.
  // Treat them as physical unless they match common virtual interface patterns.
  const isVirtualByName = /^(vlan|vlan-interface|loopback|lo\d*|null\d*|tunnel\d*|dialer\d*|br\d*|bridge\d*|irb\d*|nve\d*|virtual)/.test(name);
  const isVirtualByType = /^(l2vlan|l3ipvlan|propvirtual|softwareloopback|bridge|tunnel|mplstunnel|type-136|type-53|type-24|type-209)$/.test(type);
  if (isVirtualByType) return false;
  if (!isVirtualByName && (iface.speedBps ?? 0) > 0) return true;
  if (numericOnly) return false;
  return /^(fc\d+\/\d+|gi|fa|te|et|eth|xe|ge|po\d+|port-channel|bridge-aggregation|bagg|trk\d*|[a-z]\d+|\d+)$/.test(name);
};

const isNumericInterfaceBackedByVlanId = (device: NetworkDevice, iface: NetworkInterface): boolean => {
  if (device.type !== 'switch') return false;
  const name = (iface.name || '').trim();
  if (!/^\d+$/.test(name)) return false;
  const asVlanId = Number(name);
  if (!Number.isFinite(asVlanId) || asVlanId <= 0) return false;
  const vlanIds = new Set((device.vlans ?? []).map((v) => v.vlanId));
  return vlanIds.has(asVlanId);
};

const getVisiblePorts = (device: NetworkDevice, includeVirtual: boolean): NetworkInterface[] =>
  {
    const ports = getAllPorts(device)
    // For switches, hide SVI/l2vlan interfaces from the interface list.
    .filter((iface) => device.type !== 'switch' || !isVlanInterface(iface))
    .filter((iface) => !isNumericInterfaceBackedByVlanId(device, iface))
    .filter((iface) => includeVirtual || isPhysicalOrLagInterface(iface));

    // If strict physical detection filtered everything out, fall back to showing
    // non-VLAN interfaces so users don't have to manually toggle "virtual".
    if (!includeVirtual && ports.length === 0) {
      return getAllPorts(device).filter((iface) => device.type !== 'switch' || !isVlanInterface(iface));
    }

    return ports;
  };

// Human labels + display formatting for each sensor category (LibreNMS parity).
const SENSOR_GROUPS: { type: string; label: string }[] = [
  { type: 'temperature', label: 'Nhiệt độ' },
  { type: 'cpu', label: 'CPU' },
  { type: 'memory', label: 'Bộ nhớ' },
  { type: 'disk', label: 'Ổ đĩa / Lưu trữ' },
  { type: 'battery', label: 'Pin / Ắc quy' },
  { type: 'runtime', label: 'Thời gian dự phòng' },
  { type: 'load', label: 'Tải (UPS)' },
  { type: 'fan', label: 'Quạt' },
  { type: 'voltage', label: 'Điện áp' },
  { type: 'current', label: 'Dòng điện' },
  { type: 'power', label: 'Công suất' },
  { type: 'frequency', label: 'Tần số' },
  { type: 'humidity', label: 'Độ ẩm' },
  { type: 'airflow', label: 'Luồng khí' },
  { type: 'state', label: 'Trạng thái' },
];

type DeviceTableColumnKey =
  | 'name'
  | 'ip'
  | 'vendorModel'
  | 'location'
  | 'status'
  | 'cpu'
  | 'ram'
  | 'temperature'
  | 'ping'
  | 'uptime'
  | 'actions';

interface DeviceTableColumn {
  key: DeviceTableColumnKey;
  label: string;
  hideable: boolean;
}

const DEVICE_TABLE_COLUMNS: DeviceTableColumn[] = [
  { key: 'name', label: 'Tên thiết bị', hideable: false },
  { key: 'ip', label: 'IP Address', hideable: true },
  { key: 'vendorModel', label: 'Hãng / Model', hideable: true },
  { key: 'location', label: 'Vị trí', hideable: true },
  { key: 'status', label: 'Trạng thái', hideable: true },
  { key: 'cpu', label: 'CPU', hideable: true },
  { key: 'ram', label: 'RAM', hideable: true },
  { key: 'temperature', label: 'Nhiệt độ', hideable: true },
  { key: 'ping', label: 'Ping', hideable: true },
  { key: 'uptime', label: 'Uptime', hideable: true },
  { key: 'actions', label: 'Thao tác', hideable: false },
];

const DEVICE_TABLE_COLUMNS_STORAGE_KEY = 'deviceManagement.visibleColumns.v1';

interface GroupTreeNode {
  group: DeviceGroup;
  children: GroupTreeNode[];
  devices: NetworkDevice[];
}

const buildGroupTree = (groups: DeviceGroup[], devices: NetworkDevice[]): GroupTreeNode[] => {
  const nodeById = new Map<string, GroupTreeNode>();
  for (const g of groups) {
    nodeById.set(g.id, { group: g, children: [], devices: [] });
  }

  for (const node of nodeById.values()) {
    const parentId = node.group.parentId ?? null;
    if (!parentId) continue;
    const parent = nodeById.get(parentId);
    if (parent) parent.children.push(node);
  }

  for (const dev of devices) {
    if (!dev.groupId) continue;
    const node = nodeById.get(dev.groupId);
    if (node) node.devices.push(dev);
  }

  const sortNodes = (nodes: GroupTreeNode[]) => {
    nodes.sort((a, b) => a.group.name.localeCompare(b.group.name, undefined, { sensitivity: 'base' }));
    for (const n of nodes) {
      n.devices.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      sortNodes(n.children);
    }
  };

  const roots = Array.from(nodeById.values()).filter((n) => {
    const parentId = n.group.parentId ?? null;
    return !parentId || !nodeById.has(parentId);
  });
  sortNodes(roots);
  return roots;
};

const flattenGroupOptions = (nodes: GroupTreeNode[], depth = 0, acc: Array<{ id: string; label: string }> = []) => {
  for (const node of nodes) {
    const prefix = depth > 0 ? `${'  '.repeat(depth)}↳ ` : '';
    acc.push({ id: node.group.id, label: `${prefix}${node.group.name}` });
    flattenGroupOptions(node.children, depth + 1, acc);
  }
  return acc;
};

const formatSensorValue = (s: DeviceSensor): string => {
  if (s.value === null || s.value === undefined || Number.isNaN(s.value)) return 'N/A';
  const rounded = Math.abs(s.value) >= 100 ? Math.round(s.value) : Math.round(s.value * 10) / 10;
  return s.unit ? `${rounded} ${s.unit}` : `${rounded}`;
};

const sensorStatusColor = (status: string): string => {
  switch (status) {
    case 'critical':
      return 'text-red-400';
    case 'warning':
      return 'text-amber-400';
    case 'unknown':
      return 'text-slate-400';
    default:
      return 'text-emerald-400';
  }
};

// Health panel: groups discovered sensors by category, shown in the overview tab.
const DeviceSensorsPanel: React.FC<{ sensors: DeviceSensor[] }> = ({ sensors }) => {
  if (!sensors || sensors.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 text-xs text-slate-400 font-mono">
        Chưa có dữ liệu cảm biến sức khỏe. Nhấn "Quét SNMP" và chờ một chu kỳ thu thập.
      </div>
    );
  }

  const knownTypes = new Set<string>(SENSOR_GROUPS.map((g) => g.type));
  const extraGroups = Array.from(new Set<string>(sensors.map((s) => s.type)))
    .filter((t) => !knownTypes.has(t))
    .map((t) => ({ type: t, label: t }));
  const groups = [...SENSOR_GROUPS, ...extraGroups];

  return (
    <div className="space-y-3">
      <h4 className="font-bold text-sm font-mono flex items-center space-x-2 text-slate-200">
        <Activity className="w-4 h-4 text-emerald-400" />
        <span>Cảm biến sức khỏe ({sensors.length})</span>
      </h4>
      {groups.map((g) => {
        const items = sensors.filter((s) => s.type === g.type);
        if (items.length === 0) return null;
        return (
          <div key={g.type}>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">{g.label}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {items.map((s) => (
                <div key={s.id} className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/60">
                  <p className="text-[11px] text-slate-400 truncate font-mono" title={s.description}>{s.description}</p>
                  <p className={`text-base font-black mt-0.5 font-mono ${sensorStatusColor(s.status)}`}>{formatSensorValue(s)}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface DeviceManagementProps {
  devices: NetworkDevice[];
  sites: SiteInfo[];
  selectedSiteId: string | null;
  darkMode: boolean;
  trafficChartMode: 'stacked' | 'mirrored';
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  selectedDevice: NetworkDevice | null;
  onSelectDevice: (dev: NetworkDevice | null) => void;
  onPollDevice: (id: string) => void | Promise<void>;
  onOpenAddDevice: () => void;
  onEditDevice: (dev: NetworkDevice) => void;
  onDeleteDevice: (dev: NetworkDevice) => void;
  onDeleteSelectedDevices: (deviceIds: string[]) => Promise<void>;
  onOpenScanSubnet: () => void;
  onAssignGroup: (deviceId: string, groupId: string | null, siteId?: string | null) => Promise<void>;
  onToggleSnmpMonitoring: (deviceId: string, disabled: boolean) => Promise<void>;
  services: ServiceCheck[];
  onCreateAlertRule: (input: AlertRuleInput) => void;
}

export const DeviceManagement: React.FC<DeviceManagementProps> = ({
  devices,
  sites,
  selectedSiteId,
  darkMode,
  trafficChartMode,
  searchQuery,
  setSearchQuery,
  selectedDevice,
  onSelectDevice,
  onPollDevice,
  onOpenAddDevice,
  onEditDevice,
  onDeleteDevice,
  onDeleteSelectedDevices,
  onOpenScanSubnet,
  onAssignGroup,
  onToggleSnmpMonitoring,
  services,
  onCreateAlertRule,
}) => {
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [selectedPort, setSelectedPort] = useState<NetworkInterface | null>(null);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<DeviceTableColumnKey, boolean>>(() => {
    const defaults = DEVICE_TABLE_COLUMNS.reduce((acc, col) => {
      acc[col.key] = true;
      return acc;
    }, {} as Record<DeviceTableColumnKey, boolean>);
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(DEVICE_TABLE_COLUMNS_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<Record<DeviceTableColumnKey, boolean>>;
      for (const col of DEVICE_TABLE_COLUMNS) {
        if (typeof parsed[col.key] === 'boolean') {
          defaults[col.key] = parsed[col.key] as boolean;
        }
      }
      for (const col of DEVICE_TABLE_COLUMNS) {
        if (!col.hideable) defaults[col.key] = true;
      }
      return defaults;
    } catch {
      return defaults;
    }
  });

  const visibleTableColumns = useMemo(
    () => DEVICE_TABLE_COLUMNS.filter((col) => !col.hideable || visibleColumns[col.key]),
    [visibleColumns],
  );
  const tableColSpan = visibleTableColumns.length;
  // Tree view: which group folders are collapsed (absent = expanded by default).
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const toggleGroupExpanded = (id: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Device-group management modal (moved here from the settings tab).
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#3b82f6');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupParentId, setNewGroupParentId] = useState('');
  const [newGroupSiteId, setNewGroupSiteId] = useState('');
  const [groupMessage, setGroupMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // ID of the group currently being edited (null = creating a new group).
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  // Group selected for device assignment (checklist target).
  const [assignGroupId, setAssignGroupId] = useState<string | null>(null);
  const [showAssignGroupModal, setShowAssignGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [assigningDeviceIds, setAssigningDeviceIds] = useState<Set<string>>(new Set());
  const [groupAssignOverrides, setGroupAssignOverrides] = useState<Record<string, string | null>>({});
  const [assigningBatch, setAssigningBatch] = useState(false);
  const [assignDeviceSearch, setAssignDeviceSearch] = useState('');
  const [showAlertRuleForm, setShowAlertRuleForm] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [draggingDeviceIds, setDraggingDeviceIds] = useState<string[]>([]);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

  const loadGroups = () => {
    const siteFilter = selectedSiteId === null ? undefined : selectedSiteId;
    api.deviceGroups.list(siteFilter).then(setGroups).catch(() => setGroups([]));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DEVICE_TABLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!columnMenuRef.current) return;
      if (!columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const toggleTableColumn = (key: DeviceTableColumnKey) => {
    const column = DEVICE_TABLE_COLUMNS.find((c) => c.key === key);
    if (!column || !column.hideable) return;
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const resetGroupForm = () => {
    setEditGroupId(null);
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupColor('#3b82f6');
    setNewGroupParentId('');
    setNewGroupSiteId(selectedSiteId ?? '');
  };

  const startEditGroup = (g: DeviceGroup) => {
    setEditGroupId(g.id);
    setNewGroupName(g.name);
    setNewGroupDesc(g.description ?? '');
    setNewGroupColor(g.color ?? '#3b82f6');
    setNewGroupParentId(g.parentId ?? '');
    setNewGroupSiteId(g.siteId ?? '');
    setGroupMessage(null);
  };

  const handleSaveGroup = async () => {
    setGroupMessage(null);
    try {
      if (editGroupId) {
        await api.deviceGroups.update(editGroupId, {
          name: newGroupName,
          description: newGroupDesc || undefined,
          color: newGroupColor,
          parentId: newGroupParentId || null,
          siteId: newGroupSiteId || null,
        });
        setGroupMessage({ ok: true, text: 'Đã cập nhật nhóm.' });
        setShowEditGroupModal(false);
      } else {
        await api.deviceGroups.create({
          name: newGroupName,
          description: newGroupDesc || undefined,
          color: newGroupColor,
          parentId: newGroupParentId || null,
          siteId: newGroupSiteId || null,
        });
        setGroupMessage({ ok: true, text: 'Đã tạo nhóm.' });
      }
      resetGroupForm();
      loadGroups();
    } catch (err) {
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Lưu nhóm thất bại.' });
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await api.deviceGroups.remove(id);
      if (editGroupId === id) resetGroupForm();
      if (assignGroupId === id) {
        closeAssignGroupModal();
      }
      loadGroups();
    } catch (err) {
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Xóa nhóm thất bại.' });
    }
  };

  const handleToggleDeviceGroup = async (deviceId: string, groupId: string, checked: boolean) => {
    const previous = Object.prototype.hasOwnProperty.call(groupAssignOverrides, deviceId)
      ? groupAssignOverrides[deviceId]
      : undefined;
    setAssigningDeviceIds((prev) => {
      const next = new Set(prev);
      next.add(deviceId);
      return next;
    });
    setGroupAssignOverrides((prev) => ({
      ...prev,
      [deviceId]: checked ? groupId : null,
    }));
    try {
      const targetSiteId = checked ? (groups.find((g) => g.id === groupId)?.siteId ?? null) : undefined;
      await onAssignGroup(deviceId, checked ? groupId : null, targetSiteId);
      loadGroups();
    } catch (err) {
      setGroupAssignOverrides((prev) => {
        const next = { ...prev };
        if (previous === undefined) delete next[deviceId];
        else next[deviceId] = previous;
        return next;
      });
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Gán thiết bị thất bại.' });
    } finally {
      setAssigningDeviceIds((prev) => {
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
    }
  };

  const handleAssignFiltered = async (assignToGroup: boolean) => {
    if (!assignGroupId) return;
    const targetGroupId = assignToGroup ? assignGroupId : null;
    const targetSiteId = targetGroupId ? (groups.find((g) => g.id === targetGroupId)?.siteId ?? null) : undefined;
    const candidates = assignableDevices.filter((dev) => {
      if (assigningDeviceIds.has(dev.id)) return false;
      if (!canAssignInCurrentModal(dev)) return false;
      const current = effectiveGroupId(dev);
      if (assignToGroup) return current === null;
      return current === assignGroupId;
    });
    if (candidates.length === 0) return;

    const previousById = new Map<string, string | null | undefined>();
    for (const dev of candidates) {
      previousById.set(
        dev.id,
        Object.prototype.hasOwnProperty.call(groupAssignOverrides, dev.id) ? groupAssignOverrides[dev.id] : undefined,
      );
    }

    setAssigningBatch(true);
    setGroupMessage(null);
    setAssigningDeviceIds((prev) => {
      const next = new Set(prev);
      for (const dev of candidates) next.add(dev.id);
      return next;
    });
    setGroupAssignOverrides((prev) => {
      const next = { ...prev };
      for (const dev of candidates) next[dev.id] = targetGroupId;
      return next;
    });

    try {
      await Promise.all(candidates.map((dev) => onAssignGroup(dev.id, targetGroupId, targetSiteId)));
      loadGroups();
    } catch (err) {
      setGroupAssignOverrides((prev) => {
        const next = { ...prev };
        for (const dev of candidates) {
          const oldVal = previousById.get(dev.id);
          if (oldVal === undefined) delete next[dev.id];
          else next[dev.id] = oldVal;
        }
        return next;
      });
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Gán hàng loạt thất bại.' });
    } finally {
      setAssigningDeviceIds((prev) => {
        const next = new Set(prev);
        for (const dev of candidates) next.delete(dev.id);
        return next;
      });
      setAssigningBatch(false);
    }
  };

  const handleMoveDeviceGroup = async (deviceId: string, targetGroupId: string | null) => {
    setAssigningDeviceIds((prev) => {
      const next = new Set(prev);
      next.add(deviceId);
      return next;
    });
    setGroupMessage(null);
    try {
      const targetSiteId = targetGroupId ? (groups.find((g) => g.id === targetGroupId)?.siteId ?? null) : undefined;
      await onAssignGroup(deviceId, targetGroupId, targetSiteId);
      loadGroups();
    } catch (err) {
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Chuyển nhóm thiết bị thất bại.' });
    } finally {
      setAssigningDeviceIds((prev) => {
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
    }
  };

  const moveDevicesToGroup = async (deviceIds: string[], targetGroupId: string | null) => {
    if (deviceIds.length === 0) return;
    setAssigningBatch(true);
    setGroupMessage(null);
    try {
      const targetSiteId = targetGroupId ? (groups.find((g) => g.id === targetGroupId)?.siteId ?? null) : undefined;
      await Promise.all(deviceIds.map((id) => onAssignGroup(id, targetGroupId, targetSiteId)));
      setGroupMessage({ ok: true, text: `Đã chuyển ${deviceIds.length} thiết bị.` });
      setSelectedDeviceIds(new Set());
      loadGroups();
    } catch (err) {
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Kéo thả chuyển nhóm thất bại.' });
    } finally {
      setAssigningBatch(false);
      setDraggingDeviceIds([]);
      setDropTargetGroupId(null);
    }
  };

  const toggleDeviceSelection = (deviceId: string, checked: boolean) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(deviceId);
      else next.delete(deviceId);
      return next;
    });
  };

  const handleRowDragStart = (event: React.DragEvent<HTMLTableRowElement>, deviceId: string) => {
    const ids = selectedDeviceIds.has(deviceId) ? Array.from(selectedDeviceIds) : [deviceId];
    if (!selectedDeviceIds.has(deviceId)) {
      setSelectedDeviceIds(new Set(ids));
    }
    setDraggingDeviceIds(ids);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
  };

  const handleRowDragEnd = () => {
    setDraggingDeviceIds([]);
    setDropTargetGroupId(null);
  };

  const handleGroupDragOver = (event: React.DragEvent<HTMLTableRowElement>, targetGroupId: string | null) => {
    if (assigningBatch) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetGroupId(targetGroupId ?? UNGROUPED_BUCKET_ID);
  };

  const handleGroupDrop = (event: React.DragEvent<HTMLTableRowElement>, targetGroupId: string | null) => {
    event.preventDefault();
    const fromData = event.dataTransfer.getData('text/plain');
    const ids = fromData ? fromData.split(',').map((x) => x.trim()).filter(Boolean) : draggingDeviceIds;
    const uniqueIds = Array.from(new Set(ids));
    void moveDevicesToGroup(uniqueIds, targetGroupId);
  };

  // Tracks which device is currently being scanned so buttons can show a spinner.
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [togglingSnmpId, setTogglingSnmpId] = useState<string | null>(null);
  const [scanDone, setScanDone] = useState<string | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const runPoll = async (id: string) => {
    if (pollingId) return;
    setPollingId(id);
    setScanDone(null);
    try {
      await Promise.resolve(onPollDevice(id));
      setScanDone(id);
      setTimeout(() => setScanDone((cur) => (cur === id ? null : cur)), 2500);
    } finally {
      setPollingId((cur) => (cur === id ? null : cur));
    }
  };

  const toggleSnmpMonitoring = async (deviceId: string, disabled: boolean) => {
    if (togglingSnmpId) return;
    setTogglingSnmpId(deviceId);
    try {
      await onToggleSnmpMonitoring(deviceId, disabled);
    } finally {
      setTogglingSnmpId((cur) => (cur === deviceId ? null : cur));
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedDeviceIds);
    if (ids.length === 0 || deletingSelected) return;
    const confirmed = window.confirm(
      `Xóa ${ids.length} thiết bị đã chọn? Toàn bộ dữ liệu polling, cổng và cảnh báo liên quan sẽ bị xóa.`,
    );
    if (!confirmed) return;

    setDeletingSelected(true);
    setGroupMessage(null);
    try {
      await onDeleteSelectedDevices(ids);
      setSelectedDeviceIds(new Set());
      setGroupMessage({ ok: true, text: `Đã xóa ${ids.length} thiết bị.` });
    } catch (err) {
      setGroupMessage({ ok: false, text: err instanceof Error ? err.message : 'Xóa thiết bị hàng loạt thất bại.' });
    } finally {
      setDeletingSelected(false);
    }
  };

  // Device detail modal: active tab + interface search/pagination
  const [detailTab, setDetailTab] = useState<'system' | 'neighbors' | 'ports' | 'vlans'>('system');
  const [portSearch, setPortSearch] = useState<string>('');
  const [portPage, setPortPage] = useState<number>(1);
  const [showVirtualInterfaces, setShowVirtualInterfaces] = useState<boolean>(true);
  const [detailSensors, setDetailSensors] = useState<DeviceSensor[]>([]);
  const [detailVlans, setDetailVlans] = useState<DeviceVlan[]>([]);

  // Access (untagged) VLAN per port, derived from the freshly-fetched device detail
  // (the devices list payload omits VLANs, so selectedDevice itself never has this).
  const detailVlanByPortId = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of detailVlans) {
      for (const p of v.ports) {
        if (p.untagged) map.set(p.portId, v.vlanId);
      }
    }
    return map;
  }, [detailVlans]);

  const showVlanTab = useMemo(() => {
    if (!selectedDevice) return false;
    if (selectedDevice.type === 'switch' || selectedDevice.type === 'router' || selectedDevice.type === 'firewall') return true;

    const fingerprint = `${selectedDevice.vendor ?? ''} ${selectedDevice.model ?? ''} ${selectedDevice.os ?? ''} ${selectedDevice.sysDescr ?? ''}`.toLowerCase();
    return /\bc1000\b|catalyst|\bws-c\d+|\b2960\b|\bswitch\b|cisco ios/.test(fingerprint);
  }, [selectedDevice]);

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  // Reset detail tab/search/pagination whenever a different device is opened.
  useEffect(() => {
    setDetailTab('system');
    setPortSearch('');
    setPortPage(1);
    // On switches, default to physical/LAG interfaces only to avoid noisy virtual rows.
    setShowVirtualInterfaces(selectedDevice?.type !== 'switch');
  }, [selectedDevice?.id]);

  // Fetch full device detail (incl. ports, health sensors + VLANs, not present in the list payload)
  // whenever a device modal is opened.
  useEffect(() => {
    if (!selectedDevice?.id) {
      setDetailSensors([]);
      setDetailVlans([]);
      return;
    }
    let cancelled = false;
    api.devices
      .get(selectedDevice.id)
      .then((full) => {
        if (cancelled) return;
        setDetailSensors(full.sensors ?? []);
        setDetailVlans(full.vlans ?? []);
        // Merge ports/interfaces from full detail into the selected device so tabs
        // (Interfaces, VLAN) show data even though the list payload is lightweight.
        if (full.interfaces.length > 0) {
          onSelectDevice({ ...selectedDevice, interfaces: full.interfaces, interfacesCount: full.interfacesCount });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailSensors([]);
          setDetailVlans([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDevice?.id]);

  const groupChildrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of groups) {
      const parentId = g.parentId ?? '__root__';
      const list = map.get(parentId) ?? [];
      list.push(g.id);
      map.set(parentId, list);
    }
    return map;
  }, [groups]);

  const groupDescendants = useMemo(() => {
    const out = new Map<string, Set<string>>();
    const walk = (id: string): Set<string> => {
      const cached = out.get(id);
      if (cached) return cached;
      const set = new Set<string>([id]);
      const children = groupChildrenByParent.get(id) ?? [];
      for (const c of children) {
        for (const x of walk(c)) set.add(x);
      }
      out.set(id, set);
      return set;
    };
    for (const g of groups) walk(g.id);
    return out;
  }, [groups, groupChildrenByParent]);

  // Filter devices
  const filteredDevices = devices.filter((dev) => {
    const matchesSearch =
      dev.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dev.ip.includes(searchQuery) ||
      dev.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dev.location.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesVendor = vendorFilter === 'all' || dev.vendor.toLowerCase() === vendorFilter.toLowerCase();
    const matchesType = typeFilter === 'all' || dev.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || dev.status === statusFilter;
    const validGroupIds = groupFilter === 'all' ? null : groupDescendants.get(groupFilter) ?? new Set<string>([groupFilter]);
    const matchesGroup = validGroupIds ? (dev.groupId ? validGroupIds.has(dev.groupId) : false) : true;

    return matchesSearch && matchesVendor && matchesType && matchesStatus && matchesGroup;
  });

  useEffect(() => {
    const valid = new Set(devices.map((d) => d.id));
    setSelectedDeviceIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      return next;
    });
  }, [devices]);

  const UNGROUPED_BUCKET_ID = '__ungrouped__';
  const filtersActive = !!searchQuery || vendorFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all' || groupFilter !== 'all';

  const allGroupTree = useMemo(() => buildGroupTree(groups, []), [groups]);
  const groupOptions = useMemo(() => flattenGroupOptions(allGroupTree), [allGroupTree]);
  const groupTree = useMemo(() => buildGroupTree(groups, filteredDevices), [groups, filteredDevices]);
  const ungroupedDevices = useMemo(
    () => filteredDevices.filter((d) => !d.groupId || !groups.some((g) => g.id === d.groupId)),
    [filteredDevices, groups],
  );
  const filteredDeviceIds = useMemo(() => filteredDevices.map((d) => d.id), [filteredDevices]);
  const selectedVisibleCount = useMemo(
    () => filteredDeviceIds.filter((id) => selectedDeviceIds.has(id)).length,
    [filteredDeviceIds, selectedDeviceIds],
  );
  const allFilteredSelected = filteredDeviceIds.length > 0 && selectedVisibleCount === filteredDeviceIds.length;

  const groupSubtreeHasVisibleContent = (node: GroupTreeNode): boolean => {
    if (node.devices.length > 0) return true;
    return node.children.some(groupSubtreeHasVisibleContent);
  };

  const vendorOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const dev of devices) {
      const vendor = (dev.vendor ?? '').trim();
      if (vendor) unique.add(vendor);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [devices]);

  const assignableDevices = useMemo(() => {
    const q = assignDeviceSearch.trim().toLowerCase();
    return devices.filter((dev) => {
      if (!q) return true;
      return dev.name.toLowerCase().includes(q) || dev.ip.toLowerCase().includes(q);
    });
  }, [devices, assignDeviceSearch]);

  const effectiveGroupId = (device: NetworkDevice): string | null => {
    if (Object.prototype.hasOwnProperty.call(groupAssignOverrides, device.id)) {
      return groupAssignOverrides[device.id] ?? null;
    }
    return device.groupId ?? null;
  };

  const canAssignInCurrentModal = (device: NetworkDevice): boolean => {
    if (!assignGroupId) return false;
    const current = effectiveGroupId(device);
    return current === null || current === assignGroupId;
  };

  const selectedInAssignListCount = useMemo(() => {
    if (!assignGroupId) return 0;
    return assignableDevices.filter((dev) => effectiveGroupId(dev) === assignGroupId).length;
  }, [assignableDevices, assignGroupId, groupAssignOverrides]);

  // Inline group edit/add trigger — shares the same form/handlers as the "Nhóm thiết bị"
  // modal so validation and persistence stay in one place.
  const openEditGroupModal = (g: DeviceGroup) => {
    startEditGroup(g);
    setShowGroupModal(true);
    setShowEditGroupModal(true);
  };

  const openAssignGroupModal = (groupId: string) => {
    setAssignGroupId(groupId);
    setAssignDeviceSearch('');
    setAssigningDeviceIds(new Set());
    setGroupAssignOverrides({});
    setShowAssignGroupModal(true);
  };

  const closeAssignGroupModal = () => {
    setShowAssignGroupModal(false);
    setAssignGroupId(null);
    setAssignDeviceSearch('');
    setAssigningDeviceIds(new Set());
    setGroupAssignOverrides({});
  };

  const openCreateGroupModal = () => {
    resetGroupForm();
    setGroupMessage(null);
    setShowGroupModal(true);
    setShowEditGroupModal(false);
  };

  const getStatusBadge = (status: DeviceStatus) => {
    switch (status) {
      case 'up':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">● ONLINE</span>;
      case 'warning':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">▲ WARN</span>;
      case 'down':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">■ DOWN</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-slate-500/20 text-slate-400">MAINT</span>;
    }
  };

  const metricHeatClass = (value: number): string => {
    if (value >= 85) return 'bg-red-500/20 text-red-300 border border-red-500/30';
    if (value >= 70) return 'bg-orange-500/20 text-orange-300 border border-orange-500/30';
    if (value >= 50) return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
    return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  };

  const renderDeviceRow = (dev: NetworkDevice, depth: number) => (
    <tr
      key={dev.id}
      draggable={!assigningBatch}
      onDragStart={(e) => handleRowDragStart(e, dev.id)}
      onDragEnd={handleRowDragEnd}
      onClick={() => onSelectDevice(dev)}
      className={`cursor-pointer transition-colors ${selectedDeviceIds.has(dev.id) ? 'bg-emerald-500/10' : 'hover:bg-slate-800/40'} ${draggingDeviceIds.includes(dev.id) ? 'opacity-70' : ''}`}
    >
      {visibleColumns.name && (
        <td className="py-3 px-3 font-bold text-slate-100" style={{ paddingLeft: `${36 + depth * 20}px` }}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedDeviceIds.has(dev.id)}
              disabled={assigningBatch}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => toggleDeviceSelection(dev.id, e.target.checked)}
              className="w-3.5 h-3.5 accent-emerald-500"
              title="Chọn để kéo thả nhiều thiết bị"
            />
            <span className="text-slate-500 cursor-grab active:cursor-grabbing" title="Kéo thả thiết bị sang nhóm khác">::</span>
            <span>{dev.name}</span>
          </div>
        </td>
      )}
      {visibleColumns.ip && <td className="py-3 px-3 text-emerald-400 font-semibold">{dev.ip}</td>}
      {visibleColumns.vendorModel && <td className="py-3 px-3 text-slate-300">{dev.vendor} {dev.model}</td>}
      {visibleColumns.location && <td className="py-3 px-3 text-slate-400">{dev.location}</td>}
      {visibleColumns.status && <td className="py-3 px-3">{getStatusBadge(dev.status)}</td>}
      {visibleColumns.cpu && (
        <td className="py-3 px-3">
          <span className={`inline-flex px-2 py-0.5 rounded font-bold ${metricHeatClass(dev.cpuUsage)}`}>{dev.cpuUsage}%</span>
        </td>
      )}
      {visibleColumns.ram && (
        <td className="py-3 px-3">
          <span className={`inline-flex px-2 py-0.5 rounded font-bold ${metricHeatClass(dev.memoryUsage)}`}>{dev.memoryUsage}%</span>
        </td>
      )}
      {visibleColumns.temperature && <td className={`py-3 px-3 font-bold ${(dev.temperature ?? 0) > 65 ? 'text-red-400' : 'text-orange-400'}`}>{dev.temperature != null ? `${dev.temperature}°C` : 'N/A'}</td>}
      {visibleColumns.ping && <td className="py-3 px-3 text-cyan-400 font-bold">{dev.status === 'down' ? 'N/A' : `${dev.pingLatencyMs}ms`}</td>}
      {visibleColumns.uptime && <td className="py-3 px-3 text-slate-400">{dev.uptime.split(',')[0]}</td>}
      {visibleColumns.actions && <td className="py-3 px-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <select
            value={dev.groupId ?? ''}
            disabled={assigningBatch || assigningDeviceIds.has(dev.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const value = e.target.value || null;
              void handleMoveDeviceGroup(dev.id, value);
            }}
            className="text-[11px] rounded-md border border-slate-700 bg-slate-800 text-slate-200 px-2 py-1 max-w-[200px]"
            title="Chuyển thiết bị sang nhóm khác"
          >
            <option value="">Chưa phân nhóm</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void toggleSnmpMonitoring(dev.id, !dev.disabled);
            }}
            disabled={togglingSnmpId === dev.id}
            className={`p-1 rounded border disabled:opacity-60 ${
              dev.disabled
                ? 'bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25'
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
            }`}
            title={
              dev.disabled
                ? 'Thiết bị đang tạm dừng query SNMP. Bấm để bật lại.'
                : 'Thiết bị đang bật query SNMP. Bấm để tạm dừng.'
            }
          >
            {togglingSnmpId === dev.id ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : dev.disabled ? (
              <PlayCircle className="w-3.5 h-3.5" />
            ) : (
              <PauseCircle className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              runPoll(dev.id);
            }}
            disabled={pollingId === dev.id || dev.disabled}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-400 disabled:opacity-60"
            title={dev.disabled ? 'Thiết bị đang tạm dừng theo dõi SNMP' : 'Quét SNMP ngay'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pollingId === dev.id ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditDevice(dev);
            }}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-400"
            title="Sửa thiết bị"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteDevice(dev);
            }}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-red-400"
            title="Xóa thiết bị"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>}
    </tr>
  );

  const renderGroupNode = (node: GroupTreeNode, depth: number): React.ReactNode => {
    if (filtersActive && !groupSubtreeHasVisibleContent(node)) return null;
    const expanded = !collapsedGroupIds.has(node.group.id);
    const visibleCount = node.devices.length;
    const isDropActive = dropTargetGroupId === node.group.id;
    return (
      <React.Fragment key={node.group.id}>
        <tr
          onDragOver={(e) => handleGroupDragOver(e, node.group.id)}
          onDrop={(e) => handleGroupDrop(e, node.group.id)}
          onDragLeave={() => {
            if (dropTargetGroupId === node.group.id) setDropTargetGroupId(null);
          }}
          onClick={() => toggleGroupExpanded(node.group.id)}
          className={`cursor-pointer select-none ${isDropActive ? 'ring-1 ring-emerald-500 bg-emerald-500/15' : darkMode ? 'bg-slate-800/50 hover:bg-slate-800/80' : 'bg-slate-100 hover:bg-slate-200'}`}
        >
          <td colSpan={tableColSpan} className="py-2 px-3" style={{ paddingLeft: `${12 + depth * 18}px` }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                {expanded ? <FolderOpen className="w-4 h-4 shrink-0" style={{ color: node.group.color }} /> : <Folder className="w-4 h-4 shrink-0" style={{ color: node.group.color }} />}
                <span className="font-bold text-slate-100 truncate">{node.group.name}</span>
                <span className="text-slate-400 font-normal shrink-0">({visibleCount})</span>
                {isDropActive && <span className="text-[10px] text-emerald-300 shrink-0">Thả để chuyển thiết bị vào nhóm</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditGroupModal(node.group);
                  }}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-400"
                  title="Sửa nhóm"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteGroup(node.group.id);
                  }}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-red-400"
                  title="Xóa nhóm (thiết bị bên trong sẽ chuyển thành Chưa phân nhóm)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </td>
        </tr>
        {expanded && node.devices.map((dev) => renderDeviceRow(dev, depth + 1))}
        {expanded && node.children.map((child) => renderGroupNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Filter Bar */}
      <div className={`sticky top-16 z-30 p-4 rounded-xl border shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 ${
        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        
        {/* Search & Filter Controls */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[200px] flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Lọc tên, IP, Model, Vị trí..."
              className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={`text-xs py-1.5 px-3 rounded-lg border focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer ${
              darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="all">Loại thiết bị: Tất cả</option>
            <option value="router">Router Định tuyến</option>
            <option value="switch">Switch Chuyển mạch</option>
            <option value="firewall">Firewall Tường lửa</option>
            <option value="server">Server Máy chủ</option>
            <option value="wireless">Wireless AP</option>
            <option value="storage">Storage SAN/NAS</option>
            <option value="ups">UPS / Nguồn dự phòng</option>
          </select>

          {/* Vendor Filter */}
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className={`text-xs py-1.5 px-3 rounded-lg border focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer ${
              darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="all">Hãng sản xuất: Tất cả</option>
            {vendorOptions.map((vendor) => (
              <option key={vendor} value={vendor}>{vendor}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`text-xs py-1.5 px-3 rounded-lg border focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer ${
              darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="all">Trạng thái: Tất cả</option>
            <option value="up">● Online (UP)</option>
            <option value="warning">▲ Cảnh báo (WARNING)</option>
            <option value="down">■ Mất kết nối (DOWN)</option>
          </select>

          {/* Group Filter */}
          {groups.length > 0 && (
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className={`text-xs py-1.5 px-3 rounded-lg border focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              <option value="all">Nhóm: Tất cả</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          <div className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-[11px] text-slate-300">
            Đã chọn: <span className="font-bold text-emerald-400">{selectedDeviceIds.size}</span>
          </div>
          <button
            onClick={() => {
              if (allFilteredSelected) {
                setSelectedDeviceIds((prev) => {
                  const next = new Set(prev);
                  for (const id of filteredDeviceIds) next.delete(id);
                  return next;
                });
                return;
              }
              setSelectedDeviceIds((prev) => {
                const next = new Set(prev);
                for (const id of filteredDeviceIds) next.add(id);
                return next;
              });
            }}
            disabled={filteredDeviceIds.length === 0 || assigningBatch}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
            title="Chọn hoặc bỏ chọn toàn bộ thiết bị đang hiển thị"
          >
            {allFilteredSelected ? 'Bỏ chọn hiển thị' : 'Chọn hiển thị'}
          </button>
          <button
            onClick={() => setSelectedDeviceIds(new Set())}
            disabled={selectedDeviceIds.size === 0 || assigningBatch || deletingSelected}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
            title="Xóa vùng chọn kéo thả"
          >
            Xóa vùng chọn
          </button>
          <button
            onClick={() => { void handleDeleteSelected(); }}
            disabled={selectedDeviceIds.size === 0 || assigningBatch || deletingSelected}
            className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            title="Xóa nhiều thiết bị theo vùng tích chọn"
          >
            {deletingSelected ? 'Đang xóa...' : `Xóa đã chọn (${selectedDeviceIds.size})`}
          </button>
          <div className="relative" ref={columnMenuRef}>
            <button
              onClick={() => setShowColumnMenu((v) => !v)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5"
              title="Tùy chọn cột hiển thị"
            >
              <Columns3 className="w-3.5 h-3.5" /> Cột hiển thị
            </button>
            {showColumnMenu && (
              <div className={`absolute right-0 mt-2 w-64 rounded-xl border shadow-2xl z-20 p-3 ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 font-semibold">Tùy chỉnh cột bảng</div>
                <div className="space-y-1">
                  {DEVICE_TABLE_COLUMNS.map((col) => (
                    <label key={col.key} className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs ${darkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                      <span className={`${!col.hideable ? 'text-slate-500' : ''}`}>{col.label}</span>
                      <input
                        type="checkbox"
                        checked={visibleColumns[col.key]}
                        onChange={() => toggleTableColumn(col.key)}
                        disabled={!col.hideable}
                        className="w-4 h-4 accent-emerald-500 disabled:opacity-50"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => { setGroupMessage(null); setShowGroupModal(true); }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5"
            title="Quản lý nhóm thiết bị"
          >
            <Boxes className="w-3.5 h-3.5" /> Nhóm thiết bị
          </button>

          <button
            onClick={openCreateGroupModal}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5"
            title="Thêm nhóm mới"
          >
            <Plus className="w-3.5 h-3.5" /> Thêm nhóm
          </button>

          <button
            onClick={onOpenScanSubnet}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5"
            title="Quét dải mạng để tìm thiết bị SNMP"
          >
            <Radar className="w-3.5 h-3.5" /> Quét Subnet
          </button>

          <button
            onClick={onOpenAddDevice}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            + Thêm Thiết Bị
          </button>
        </div>
      </div>

      {/* Device Table */}
      <div className={`p-4 rounded-xl border overflow-x-auto ${
        darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className={`border-b text-slate-400 ${darkMode ? 'border-slate-800 bg-slate-800/40' : 'border-slate-200 bg-slate-50'}`}>
                {visibleTableColumns.map((col) => (
                  <th key={col.key} className={`py-2.5 px-3 ${col.key === 'actions' ? 'text-right' : ''}`}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {groupTree.map((node) => renderGroupNode(node, 0))}
              {(!filtersActive || ungroupedDevices.length > 0) && (
                <React.Fragment key={UNGROUPED_BUCKET_ID}>
                  <tr
                    onDragOver={(e) => handleGroupDragOver(e, null)}
                    onDrop={(e) => handleGroupDrop(e, null)}
                    onDragLeave={() => {
                      if (dropTargetGroupId === UNGROUPED_BUCKET_ID) setDropTargetGroupId(null);
                    }}
                    onClick={() => toggleGroupExpanded(UNGROUPED_BUCKET_ID)}
                    className={`cursor-pointer select-none ${dropTargetGroupId === UNGROUPED_BUCKET_ID ? 'ring-1 ring-emerald-500 bg-emerald-500/15' : darkMode ? 'bg-slate-800/50 hover:bg-slate-800/80' : 'bg-slate-100 hover:bg-slate-200'}`}
                  >
                    <td colSpan={tableColSpan} className="py-2 px-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {!collapsedGroupIds.has(UNGROUPED_BUCKET_ID) ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                        {!collapsedGroupIds.has(UNGROUPED_BUCKET_ID) ? <FolderOpen className="w-4 h-4 shrink-0" style={{ color: '#64748b' }} /> : <Folder className="w-4 h-4 shrink-0" style={{ color: '#64748b' }} />}
                        <span className="font-bold text-slate-100 truncate">Chưa phân nhóm</span>
                        <span className="text-slate-400 font-normal shrink-0">({ungroupedDevices.length})</span>
                        {dropTargetGroupId === UNGROUPED_BUCKET_ID && <span className="text-[10px] text-emerald-300 shrink-0">Thả để bỏ nhóm</span>}
                      </div>
                    </td>
                  </tr>
                  {!collapsedGroupIds.has(UNGROUPED_BUCKET_ID) && ungroupedDevices.map((dev) => renderDeviceRow(dev, 1))}
                </React.Fragment>
              )}
            </tbody>
          </table>

        </div>

      {/* Device Group Management Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl ${
            darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className={`p-5 border-b sticky top-0 z-10 flex items-center justify-between ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Boxes className="w-5 h-5" />
                </div>
                <h2 className="font-bold text-base font-mono">Quản lý nhóm thiết bị</h2>
              </div>
              <button
                onClick={() => {
                  setShowGroupModal(false);
                  setShowEditGroupModal(false);
                  closeAssignGroupModal();
                }}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Existing groups */}
              <div className={`rounded-xl border ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                <div className="p-4 border-b border-inherit font-semibold text-xs uppercase tracking-wider text-slate-400">
                  Danh sách nhóm ({groups.length})
                </div>
                <div className="divide-y divide-slate-800/50">
                  {groups.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">Chưa có nhóm nào.</div>
                  ) : (
                    groups.map((g) => (
                      <div key={g.id} className={`p-4 flex items-center gap-4 ${editGroupId === g.id ? 'bg-emerald-500/5' : ''}`}>
                        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                        <div className="flex-1">
                          <div className={`font-medium ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{g.name}</div>
                          <div className="text-xs text-slate-400">
                            {g.deviceCount ?? 0} thiết bị
                            {g.siteId ? ` • Trụ sở: ${sites.find((s) => s.id === g.siteId)?.name ?? 'Không rõ'}` : ' • Chưa gán trụ sở'}
                            {g.parentId ? ` • Nhóm cha: ${groups.find((x) => x.id === g.parentId)?.name ?? '—'}` : ''}
                            {g.description ? ` • ${g.description}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => openAssignGroupModal(g.id)}
                          className={`p-2 rounded-lg ${assignGroupId === g.id && showAssignGroupModal ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:bg-slate-800'}`}
                          title="Gán thiết bị vào nhóm"
                        >
                          <Server className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEditGroupModal(g)} className="p-2 rounded-lg text-sky-400 hover:bg-sky-500/10" title="Sửa nhóm">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteGroup(g.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" title="Xóa nhóm">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Assign devices popup */}
              {showAssignGroupModal && assignGroupId && (
                <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className={`w-full max-w-2xl rounded-2xl border shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}>
                    <div className={`p-4 border-b flex items-center justify-between ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                      <div className="font-semibold text-xs uppercase tracking-wider text-slate-400">
                        Gán thiết bị vào: {groups.find((g) => g.id === assignGroupId)?.name}
                      </div>
                      <button
                        onClick={closeAssignGroupModal}
                        className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                        <input
                          value={assignDeviceSearch}
                          onChange={(e) => setAssignDeviceSearch(e.target.value)}
                          placeholder="Tìm thiết bị theo tên hoặc IP..."
                          className={`w-full rounded-lg border pl-8 pr-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'}`}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-slate-400">
                          Đã chọn {selectedInAssignListCount}/{assignableDevices.length} thiết bị trong danh sách lọc
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAssignFiltered(true)}
                            disabled={!assignGroupId || assignableDevices.length === 0 || assigningBatch}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Chọn tất cả đã lọc
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAssignFiltered(false)}
                            disabled={!assignGroupId || assignableDevices.length === 0 || assigningBatch}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                          >
                            Bỏ chọn đã lọc
                          </button>
                        </div>
                      </div>
                      <div className={`max-h-72 overflow-y-auto rounded-lg border divide-y ${darkMode ? 'border-slate-800 divide-slate-800/50' : 'border-slate-200 divide-slate-100'}`}>
                        {(() => {
                          const assignable = assignableDevices;
                          if (assignable.length === 0) {
                            return <div className="p-3 text-sm text-slate-500">Không tìm thấy thiết bị phù hợp.</div>;
                          }
                          return assignable.map((dev) => {
                            const currentGroupId = effectiveGroupId(dev);
                            const inGroup = currentGroupId === assignGroupId;
                            const lockedByOtherGroup = !canAssignInCurrentModal(dev);
                            return (
                              <label
                                key={dev.id}
                                className={`flex items-center gap-3 p-3 ${lockedByOtherGroup ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-800/30'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={inGroup}
                                  disabled={assigningDeviceIds.has(dev.id) || lockedByOtherGroup}
                                  onChange={(e) => handleToggleDeviceGroup(dev.id, assignGroupId, e.target.checked)}
                                  className="w-4 h-4 accent-emerald-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium truncate ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{dev.name}</div>
                                  <div className="text-xs text-slate-400 font-mono truncate">{dev.ip}</div>
                                </div>
                                {currentGroupId && currentGroupId !== assignGroupId && (
                                  <span className="text-[10px] text-slate-500 shrink-0">
                                    thuộc: {groups.find((g) => g.id === currentGroupId)?.name ?? 'nhóm khác'}
                                  </span>
                                )}
                              </label>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Create / edit group */}
              <div className={`rounded-xl border p-4 space-y-4 ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                <div className="font-semibold text-xs uppercase tracking-wider text-slate-400">{editGroupId ? 'Sửa nhóm' : 'Thêm nhóm'}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-sm">
                    <span className="block mb-1 text-slate-400">Tên nhóm</span>
                    <input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                      placeholder="VD: Chi nhánh Hà Nội"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block mb-1 text-slate-400">Mô tả</span>
                    <input
                      value={newGroupDesc}
                      onChange={(e) => setNewGroupDesc(e.target.value)}
                      className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block mb-1 text-slate-400">Màu</span>
                    <input
                      type="color"
                      value={newGroupColor}
                      onChange={(e) => setNewGroupColor(e.target.value)}
                      className={`w-full h-10 rounded-lg border px-1 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`}
                    />
                  </label>
                </div>
                <label className="text-sm block">
                  <span className="block mb-1 text-slate-400">Trụ sở</span>
                  <select
                    value={newGroupSiteId}
                    onChange={(e) => {
                      setNewGroupSiteId(e.target.value);
                      setNewGroupParentId('');
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                  >
                    <option value="">(Chưa gán trụ sở)</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm block">
                  <span className="block mb-1 text-slate-400">Nhóm cha (tùy chọn)</span>
                  <select
                    value={newGroupParentId}
                    onChange={(e) => setNewGroupParentId(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                  >
                    <option value="">(Nhóm gốc)</option>
                    {groupOptions
                      .filter((g) => g.id !== editGroupId)
                      .map((g) => (
                        <option key={g.id} value={g.id}>{g.label}</option>
                      ))}
                  </select>
                </label>
                {groupMessage && (
                  <div className={`text-sm flex items-center gap-2 ${groupMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {groupMessage.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {groupMessage.text}
                  </div>
                )}
                <button
                  onClick={handleSaveGroup}
                  disabled={!newGroupName}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-2 text-sm font-semibold"
                >
                  {editGroupId ? <><Pencil className="w-4 h-4" /> Cập nhật nhóm</> : <><Plus className="w-4 h-4" /> Tạo nhóm</>}
                </button>
                {editGroupId && (
                  <button
                    onClick={resetGroupForm}
                    className="ml-2 px-4 py-2 rounded-lg border text-sm font-semibold text-slate-300 border-slate-700 hover:bg-slate-800"
                  >
                    Hủy
                  </button>
                )}
              </div>

              {/* Edit group popup */}
              {showEditGroupModal && editGroupId && (
                <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className={`w-full max-w-xl rounded-2xl border shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}>
                    <div className={`p-4 border-b flex items-center justify-between ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                      <div className="font-semibold text-sm">Sửa nhóm thiết bị</div>
                      <button
                        onClick={() => {
                          setShowEditGroupModal(false);
                          resetGroupForm();
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-400">Tên nhóm</span>
                          <input
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-400">Màu</span>
                          <input
                            type="color"
                            value={newGroupColor}
                            onChange={(e) => setNewGroupColor(e.target.value)}
                            className={`w-full h-10 rounded-lg border px-1 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`}
                          />
                        </label>
                      </div>
                      <label className="text-sm block">
                        <span className="block mb-1 text-slate-400">Mô tả</span>
                        <input
                          value={newGroupDesc}
                          onChange={(e) => setNewGroupDesc(e.target.value)}
                          className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                        />
                      </label>
                      <label className="text-sm block">
                        <span className="block mb-1 text-slate-400">Trụ sở</span>
                        <select
                          value={newGroupSiteId}
                          onChange={(e) => {
                            setNewGroupSiteId(e.target.value);
                            setNewGroupParentId('');
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                        >
                          <option value="">(Chưa gán trụ sở)</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm block">
                        <span className="block mb-1 text-slate-400">Nhóm cha (tùy chọn)</span>
                        <select
                          value={newGroupParentId}
                          onChange={(e) => setNewGroupParentId(e.target.value)}
                          className={`w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}
                        >
                          <option value="">(Nhóm gốc)</option>
                          {groupOptions
                            .filter((g) => g.id !== editGroupId)
                            .map((g) => (
                              <option key={g.id} value={g.id}>{g.label}</option>
                            ))}
                        </select>
                      </label>
                      {groupMessage && (
                        <div className={`text-sm flex items-center gap-2 ${groupMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {groupMessage.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {groupMessage.text}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveGroup}
                          disabled={!newGroupName}
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-2 text-sm font-semibold"
                        >
                          <Pencil className="w-4 h-4" /> Cập nhật nhóm
                        </button>
                        <button
                          onClick={() => {
                            setShowEditGroupModal(false);
                            resetGroupForm();
                          }}
                          className="px-4 py-2 rounded-lg border text-sm font-semibold text-slate-300 border-slate-700 hover:bg-slate-800"
                        >
                          Đóng
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Device Detailed Modal / Drawer */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl ${
            darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            
            {/* Modal Header */}
            <div className={`p-5 border-b sticky top-0 z-10 flex items-center justify-between ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center space-x-3">
                <div className={`p-3 rounded-xl font-bold ${
                  selectedDevice.status === 'up'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : selectedDevice.status === 'warning'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  <Server className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-black font-mono tracking-tight">{selectedDevice.name}</h2>
                    {getStatusBadge(selectedDevice.status)}
                  </div>
                  <p className="text-xs font-mono text-slate-400">
                    IP: <strong className="text-emerald-400">{selectedDevice.ip}</strong> • OS: {selectedDevice.os} • Location: {selectedDevice.location}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => runPoll(selectedDevice.id)}
                  disabled={pollingId === selectedDevice.id}
                  className={`px-3 py-1.5 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors ${
                    scanDone === selectedDevice.id
                      ? 'bg-emerald-700'
                      : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-700/70'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${pollingId === selectedDevice.id ? 'animate-spin' : ''}`} />
                  <span>
                    {pollingId === selectedDevice.id
                      ? 'Đang quét...'
                      : scanDone === selectedDevice.id
                      ? 'Đã cập nhật ✓'
                      : 'Quét SNMP'}
                  </span>
                </button>
                <button
                  onClick={() => setShowAlertRuleForm(true)}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors"
                  title="Thiết lập cảnh báo cho thiết bị này"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Thiết lập cảnh báo</span>
                </button>
                <button
                  onClick={() => onSelectDevice(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className={`px-5 pt-3 flex items-center gap-1 border-b sticky top-[73px] z-10 ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}>
              {([
                { key: 'system', label: 'Trạng thái hệ thống', icon: Activity },
                { key: 'neighbors', label: 'Thiết bị lân cận', icon: ShieldCheck },
                { key: 'ports', label: `Interfaces (${getVisiblePorts(selectedDevice, showVirtualInterfaces).length})`, icon: Cable },
                ...(showVlanTab
                  ? [{ key: 'vlans', label: `VLAN (${detailVlans.length})`, icon: Network }]
                  : []),
              ] as { key: 'system' | 'neighbors' | 'ports' | 'vlans'; label: string; icon: typeof Activity }[]).map((tab) => {
                const Icon = tab.icon;
                const active = detailTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key)}
                    className={`px-3.5 py-2 text-xs font-semibold font-mono rounded-t-lg flex items-center gap-1.5 border-b-2 transition-colors ${
                      active
                        ? 'border-emerald-500 text-emerald-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">

              {/* ==== TAB: Trạng thái hệ thống ==== */}
              {detailTab === 'system' && (
                <>
                  {/* Per-processor utilisation trends (Now/Min/Max/Avg) — LibreNMS parity */}
                  <ProcessorsPanel deviceId={selectedDevice.id} darkMode={darkMode} />

                  {/* Historical performance charts (CPU/RAM/temp/ping over time) */}
                  <div>
                    <DeviceMetricsHistory deviceId={selectedDevice.id} darkMode={darkMode} />
                  </div>

                  {/* Gauges & Telemetry Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
                    <div className="p-3.5 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Mức tải CPU{selectedDevice.cpuCount ? ` (${selectedDevice.cpuCount} lõi)` : ''}</span>
                      <p className={`text-xl font-black mt-1 ${selectedDevice.cpuUsage > 80 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {selectedDevice.cpuUsage}%
                      </p>
                      <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className="bg-emerald-400 h-full" style={{ width: `${selectedDevice.cpuUsage}%` }}></div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Bộ nhớ RAM{selectedDevice.totalMemoryBytes ? ` (${(selectedDevice.totalMemoryBytes / 1024 ** 3).toFixed(1)} GB)` : ''}</span>
                      <p className={`text-xl font-black mt-1 ${selectedDevice.memoryUsage > 80 ? 'text-amber-400' : 'text-slate-200'}`}>
                        {selectedDevice.memoryUsage}%
                      </p>
                      <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className="bg-amber-400 h-full" style={{ width: `${selectedDevice.memoryUsage}%` }}></div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Nhiệt độ Ambient</span>
                      <p className="text-xl font-black mt-1 text-orange-400">{selectedDevice.temperature} °C</p>
                      <p className="text-[10px] text-slate-500 mt-1">Ngưỡng &lt;65°C</p>
                    </div>

                    <div className="p-3.5 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Độ trễ ICMP</span>
                      <p className="text-xl font-black mt-1 text-cyan-400">
                        {selectedDevice.status === 'down' ? 'N/A' : `${selectedDevice.pingLatencyMs} ms`}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">Packet loss: {selectedDevice.packetLoss}%</p>
                    </div>
                  </div>

                  {/* Device identity: name / vendor / model / OS / version */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Tên thiết bị</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={selectedDevice.name}>{selectedDevice.name}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Hãng / Model</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={`${selectedDevice.vendor} ${selectedDevice.model}`}>{selectedDevice.vendor} {selectedDevice.model || '—'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Firmware</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={selectedDevice.firmware}>{selectedDevice.firmware || '—'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Số Serial</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={selectedDevice.serial}>{selectedDevice.serial || '—'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Loại thiết bị</span>
                      <p className="text-slate-100 font-bold mt-0.5">{selectedDevice.type}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Hệ điều hành</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={selectedDevice.osVersion || selectedDevice.os}>{selectedDevice.osVersion || selectedDevice.os || '—'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Mô tả hệ thống (sysDescr)</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={selectedDevice.sysDescr}>{selectedDevice.sysDescr || '—'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Vị trí</span>
                      <p className="text-slate-100 font-bold mt-0.5 truncate" title={selectedDevice.location}>{selectedDevice.location || '—'}</p>
                    </div>
                  </div>

                  {/* UPS output load % history, when the device exposes a load sensor */}
                  {detailSensors.some((s) => s.type === 'load') && (
                    <SensorHistoryPanel deviceId={selectedDevice.id} sensorType="load" title="Lịch sử Tải (UPS)" darkMode={darkMode} />
                  )}

                  {/* Health sensors (temperature/fan/voltage/power/CPU/memory/disk...) — LibreNMS parity */}
                  <DeviceSensorsPanel sensors={detailSensors} />

                  {/* Technical Details Footer */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1 text-slate-400">
                    <div className="flex justify-between">
                      <span>System Object ID (sysObjectID):</span>
                      <span className="text-slate-200">{selectedDevice.sysObjectID}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SNMP Community / Credentials:</span>
                      <span className="text-slate-200">{selectedDevice.snmpVersion} ({selectedDevice.community || 'SNMPv3 User'})</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Thời gian Uptime liên tục:</span>
                      <span className="text-emerald-400 font-bold">{selectedDevice.uptime}</span>
                    </div>
                  </div>
                </>
              )}

              {/* ==== TAB: Thiết bị lân cận ==== */}
              {detailTab === 'neighbors' && (
                <DeviceNeighbors deviceId={selectedDevice.id} darkMode={darkMode} />
              )}

              {/* ==== TAB: Interfaces (search + pagination 20/page) ==== */}
              {detailTab === 'ports' && (() => {
                const PAGE_SIZE = 20;
                const q = portSearch.trim().toLowerCase();
                const allPorts = getVisiblePorts(selectedDevice, showVirtualInterfaces)
                  .map((iface) => ({ ...iface, vlan: detailVlanByPortId.get(iface.id) ?? iface.vlan }))
                  .filter((iface) =>
                  q === '' ||
                  iface.name.toLowerCase().includes(q) ||
                  (iface.description ?? '').toLowerCase().includes(q)
                );
                const totalPages = Math.max(1, Math.ceil(allPorts.length / PAGE_SIZE));
                const page = Math.min(portPage, totalPages);
                const pagePorts = allPorts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

                return (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                      <h4 className="font-bold text-sm font-mono flex items-center space-x-2 text-slate-200">
                        <Cable className="w-4 h-4 text-emerald-400" />
                        <span>Danh sách Cổng Giao diện SNMP ({allPorts.length})</span>
                      </h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setShowVirtualInterfaces((v) => !v); setPortPage(1); }}
                          className={`px-2.5 py-1.5 text-[11px] rounded-lg border font-mono ${
                            showVirtualInterfaces
                              ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                              : 'border-slate-600 bg-slate-800/60 text-slate-300'
                          }`}
                        >
                          {showVirtualInterfaces ? 'Đang hiện interface ảo' : 'Hiện interface ảo'}
                        </button>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input
                            type="text"
                            value={portSearch}
                            onChange={(e) => { setPortSearch(e.target.value); setPortPage(1); }}
                            placeholder="Tìm theo tên / mô tả cổng..."
                            className={`pl-8 pr-3 py-1.5 text-xs font-mono rounded-lg border w-full sm:w-64 ${
                              darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-300'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto border rounded-xl border-slate-800">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="bg-slate-800/80 border-b border-slate-700 text-slate-400">
                            <th className="py-2.5 px-3">Tên Cổng</th>
                            <th className="py-2.5 px-3">Mô tả</th>
                            <th className="py-2.5 px-3">VLAN</th>
                            <th className="py-2.5 px-3">Tốc độ</th>
                            <th className="py-2.5 px-3">Admin / Oper</th>
                            <th className="py-2.5 px-3 text-emerald-400">Rate In</th>
                            <th className="py-2.5 px-3 text-cyan-400">Rate Out</th>
                            <th className="py-2.5 px-3">Tải (%)</th>
                            <th className="py-2.5 px-3">Errors / Discards</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {pagePorts.map((iface) => (
                            <tr
                              key={iface.id}
                              className="hover:bg-slate-800/50 cursor-pointer"
                              onClick={() => setSelectedPort(iface)}
                              title="Xem chi tiết cổng"
                            >
                              <td className="py-2.5 px-3 font-bold text-emerald-400 underline decoration-dotted underline-offset-2">{iface.name}</td>
                              <td className="py-2.5 px-3 text-slate-400">{iface.description}</td>
                              <td className="py-2.5 px-3 text-slate-300">{iface.vlan ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-300">{iface.speed}</td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase ${
                                  iface.operStatus === 'up' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {iface.adminStatus}/{iface.operStatus}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-emerald-400">
                                {(iface.inRateBps / 1e6).toFixed(1)} Mbps
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-cyan-400">
                                {(iface.outRateBps / 1e6).toFixed(1)} Mbps
                              </td>
                              <td className="py-2.5 px-3 font-bold">{iface.utilization}%</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {iface.inErrors}/{iface.inDiscards}
                              </td>
                            </tr>
                          ))}
                          {pagePorts.length === 0 && (
                            <tr>
                              <td colSpan={9} className="py-6 text-center text-slate-500">Không tìm thấy cổng phù hợp.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination controls */}
                    <div className="flex items-center justify-between mt-3 text-xs font-mono text-slate-400">
                      <span>Trang {page}/{totalPages} • {allPorts.length} cổng</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPortPage((p) => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="px-2.5 py-1 rounded-lg border border-slate-700 disabled:opacity-40 hover:bg-slate-800"
                        >
                          ← Trước
                        </button>
                        <button
                          onClick={() => setPortPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="px-2.5 py-1 rounded-lg border border-slate-700 disabled:opacity-40 hover:bg-slate-800"
                        >
                          Sau →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ==== TAB: VLAN (LibreNMS-style: VLAN id/name + member ports) ==== */}
              {detailTab === 'vlans' && (() => {
                const vlans = detailVlans;
                return (
                  <div>
                    <h4 className="font-bold text-sm font-mono flex items-center space-x-2 text-slate-200 mb-3">
                      <Network className="w-4 h-4 text-emerald-400" />
                      <span>VLAN được phát hiện qua SNMP (Q-BRIDGE-MIB) ({vlans.length})</span>
                    </h4>
                    {vlans.length === 0 ? (
                      <div className="p-6 text-center text-sm text-slate-500 border border-dashed rounded-xl border-slate-700">
                        Chưa phát hiện VLAN nào trên thiết bị này. Hãy thử "Quét SNMP" lại, hoặc thiết bị có thể không hỗ trợ Q-BRIDGE-MIB.
                      </div>
                    ) : (
                      <div className={`rounded-xl border overflow-x-auto ${darkMode ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-white'}`}>
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className={`${darkMode ? 'bg-slate-800/70 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                              <th className="py-2.5 px-3 text-left w-[100px]">VLAN ID</th>
                              <th className="py-2.5 px-3 text-left w-[220px]">Tên VLAN</th>
                              <th className="py-2.5 px-3 text-left">Access</th>
                              <th className="py-2.5 px-3 text-left">Trunk</th>
                            </tr>
                          </thead>
                          <tbody className={`${darkMode ? 'divide-y divide-slate-800' : 'divide-y divide-slate-200'}`}>
                            {vlans
                              .slice()
                              .sort((a, b) => a.vlanId - b.vlanId)
                              .map((vlan) => {
                                const accessPorts = vlan.ports
                                  .filter((p) => p.untagged)
                                  .map((p) => p.portName)
                                  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
                                const trunkPorts = vlan.ports
                                  .filter((p) => !p.untagged)
                                  .map((p) => p.portName)
                                  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

                                return (
                                  <tr key={vlan.id} className={`${darkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                                    <td className="py-2.5 px-3 font-bold text-slate-100">{vlan.vlanId}</td>
                                    <td className="py-2.5 px-3 text-slate-300">{vlan.name?.trim() || `VLAN${vlan.vlanId}`}</td>
                                    <td className="py-2.5 px-3 text-emerald-400">{accessPorts.length > 0 ? accessPorts.join(', ') : '—'}</td>
                                    <td className="py-2.5 px-3 text-cyan-400">{trunkPorts.length > 0 ? trunkPorts.join(', ') : '—'}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>

          </div>
        </div>
      )}

      {selectedPort && (
        <PortDetail
          port={selectedPort}
          darkMode={darkMode}
          trafficChartMode={trafficChartMode}
          onClose={() => setSelectedPort(null)}
        />
      )}

      {showAlertRuleForm && selectedDevice && (
        <AlertRuleForm
          devices={devices}
          services={services}
          darkMode={darkMode}
          existingRule={null}
          prefillDeviceId={selectedDevice.id}
          prefillMetric="sensor_value"
          onClose={() => setShowAlertRuleForm(false)}
          onCreate={(input) => {
            onCreateAlertRule(input);
            setShowAlertRuleForm(false);
          }}
          onUpdate={() => {
            setShowAlertRuleForm(false);
          }}
        />
      )}

    </div>
  );
};
