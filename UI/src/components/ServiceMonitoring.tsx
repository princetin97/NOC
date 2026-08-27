import React, { useState } from 'react';
import { ServiceCheck, ServiceCreateRequest, SiteInfo } from '../types';
import { Cpu, Globe, Database, ShieldCheck, RefreshCw, Plus, Pencil, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';

interface ServiceMonitoringProps {
  services: ServiceCheck[];
  sites?: SiteInfo[];
  selectedSiteId?: string | null;
  darkMode: boolean;
  onAddService: (input: ServiceCreateRequest) => void;
  onUpdateService: (id: string, patch: { name: string; type: ServiceCheck['type']; target: string; port?: number }) => void;
  onDeleteService: (id: string) => void;
  onRefreshService: (id: string) => Promise<void>;
}

const METHOD_OPTIONS: Array<{ type: ServiceCheck['type']; label: string; defaultPort?: number }> = [
  { type: 'PING', label: 'ICMP Ping' },
  { type: 'HTTP', label: 'HTTP', defaultPort: 80 },
  { type: 'HTTPS', label: 'HTTPS', defaultPort: 443 },
  { type: 'DNS', label: 'DNS' },
  { type: 'SSH', label: 'SSH', defaultPort: 22 },
  { type: 'MYSQL', label: 'MySQL', defaultPort: 3306 },
  { type: 'BGP', label: 'BGP', defaultPort: 179 },
  { type: 'TCP', label: 'TCP Custom', defaultPort: 8080 },
];

const PORT_METHODS = new Set<ServiceCheck['type']>(['HTTP', 'HTTPS', 'SSH', 'MYSQL', 'BGP', 'TCP']);

function normalizeTargetHost(target: string): string {
  const input = target.trim();
  if (!input) return input;

  const withScheme = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.hostname.toLowerCase();
  } catch {
    const fallback = input.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0] ?? input;
    return fallback.toLowerCase();
  }
}

function normalizeServiceDisplayName(name: string): string {
  return name.trim().replace(/\s[-•]\s(PING|HTTP|HTTPS|DNS|SSH|MYSQL|BGP|TCP)$/i, '');
}

export const ServiceMonitoring: React.FC<ServiceMonitoringProps> = ({
  services,
  sites = [],
  selectedSiteId = null,
  darkMode,
  onAddService,
  onUpdateService,
  onDeleteService,
  onRefreshService,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<ServiceCheck['type']>('HTTP');
  const [target, setTarget] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<Record<ServiceCheck['type'], boolean>>({
    PING: false,
    HTTP: true,
    HTTPS: false,
    DNS: false,
    SSH: false,
    MYSQL: false,
    BGP: false,
    TCP: false,
  });
  const [methodPorts, setMethodPorts] = useState<Record<ServiceCheck['type'], number>>({
    PING: 0,
    HTTP: 80,
    HTTPS: 443,
    DNS: 53,
    SSH: 22,
    MYSQL: 3306,
    BGP: 179,
    TCP: 8080,
  });
  const [refreshingServiceIds, setRefreshingServiceIds] = useState<Set<string>>(new Set());
  const [siteId, setSiteId] = useState<string>(selectedSiteId ?? '');

  const handleRefreshService = async (serviceId: string) => {
    setRefreshingServiceIds((prev) => new Set(prev).add(serviceId));
    try {
      await onRefreshService(serviceId);
    } finally {
      setRefreshingServiceIds((prev) => {
        const next = new Set(prev);
        next.delete(serviceId);
        return next;
      });
    }
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingId(null);
  };

  const openAddModal = () => {
    setEditingId(null);
    setName('');
    setType('HTTP');
    setTarget('');
    setSelectedMethods({
      PING: false,
      HTTP: true,
      HTTPS: false,
      DNS: false,
      SSH: false,
      MYSQL: false,
      BGP: false,
      TCP: false,
    });
    setMethodPorts({
      PING: 0,
      HTTP: 80,
      HTTPS: 443,
      DNS: 53,
      SSH: 22,
      MYSQL: 3306,
      BGP: 179,
      TCP: 8080,
    });
    setSiteId(selectedSiteId ?? '');
    setShowAddModal(true);
  };

  const openEditModal = (svc: ServiceCheck) => {
    setEditingId(svc.id);
    setName(svc.name);
    setType(svc.type);
    setTarget(svc.target);
    setSelectedMethods({
      PING: svc.type === 'PING',
      HTTP: svc.type === 'HTTP',
      HTTPS: svc.type === 'HTTPS',
      DNS: svc.type === 'DNS',
      SSH: svc.type === 'SSH',
      MYSQL: svc.type === 'MYSQL',
      BGP: svc.type === 'BGP',
      TCP: svc.type === 'TCP',
    });
    setMethodPorts((prev) => ({
      ...prev,
      ...(PORT_METHODS.has(svc.type) ? { [svc.type]: svc.port ?? prev[svc.type] } : {}),
    }));
    setShowAddModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !target) return;
    if (editingId) {
      const selectedType = type;
      const selectedPort = PORT_METHODS.has(selectedType) ? methodPorts[selectedType] : undefined;
      onUpdateService(editingId, { name, type: selectedType, target, port: selectedPort });
    } else {
      const methods = METHOD_OPTIONS.filter((m) => selectedMethods[m.type]).map((m) => ({
        type: m.type,
        port: PORT_METHODS.has(m.type) ? methodPorts[m.type] : undefined,
      }));
      if (!methods.length) return;
      onAddService({ name, target, siteId: siteId || null, methods });
    }
    closeModal();
  };

  const groupedServices = Object.values(
    services.reduce<Record<string, { target: string; items: ServiceCheck[] }>>((acc, svc) => {
      const key = normalizeTargetHost(svc.target);
      if (!acc[key]) {
        acc[key] = { target: key || svc.target, items: [] };
      }
      acc[key].items.push(svc);
      return acc;
    }, {}),
  ).map((group) => {
    const items = [...group.items].sort((a, b) => a.type.localeCompare(b.type));
    const preferredName = normalizeServiceDisplayName(items[0]?.name ?? '');
    const overallStatus: 'up' | 'down' | 'warning' = items.some((s) => s.status === 'down')
      ? 'down'
      : items.some((s) => s.status === 'warning')
        ? 'warning'
        : 'up';
    return {
      displayName: preferredName || group.target,
      target: group.target,
      items,
      overallStatus,
      healthyCount: items.filter((s) => s.status === 'up').length,
    };
  });

  return (
    <div className="space-y-4 pb-6">
      
      {/* Top Header */}
      <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm tracking-wide font-mono text-slate-100">Giám sát Dịch vụ Mạng (Service Poller Checks)</h3>
            <p className="text-xs text-slate-400">Kiểm tra kết nối HTTP, DNS, SSH, MySQL, BGP Peer theo thời gian thực</p>
          </div>
        </div>

        <button
          onClick={openAddModal}
          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow flex items-center space-x-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Thêm Service Check</span>
        </button>
      </div>

      {/* Grouped Service Cards (by target host/domain) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {groupedServices.map((group) => (
          <div
            key={group.target}
            className={`p-2.5 rounded-lg border font-mono transition-all ${
              group.overallStatus === 'down'
                ? 'bg-red-950/20 border-red-500/40'
                : group.overallStatus === 'warning'
                  ? 'bg-amber-950/20 border-amber-500/40'
                  : darkMode
                    ? 'bg-slate-900 border-slate-800'
                    : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <div className={`p-1.5 rounded-lg ${
                  group.overallStatus === 'down'
                    ? 'bg-red-500/10 text-red-400'
                    : group.overallStatus === 'warning'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-emerald-500/10 text-emerald-400'
                }`}>
                  <Globe className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-xs text-slate-100 truncate">{group.displayName}</h4>
                  <p className="text-[10px] text-slate-400">
                    {group.target} • {group.items.length} phương thức giám sát • {group.healthyCount}/{group.items.length} UP
                  </p>
                </div>
              </div>

              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                group.overallStatus === 'down'
                  ? 'bg-red-500/20 text-red-400'
                  : group.overallStatus === 'warning'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-emerald-500/20 text-emerald-400'
              }`}>
                {group.overallStatus}
              </span>
            </div>

            <div className="mt-2 border-t border-slate-800/70 pt-1.5 space-y-1.5">
              {group.items.map((svc) => (
                <div key={svc.id} className="rounded-md border border-slate-800/80 bg-slate-950/30 p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-100">
                      {svc.type}
                      {svc.port ? ` • Port ${svc.port}` : ''}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        svc.status === 'up'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : svc.status === 'warning'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-red-500/20 text-red-400'
                      }`}>
                        {svc.status}
                      </span>
                      <button
                        onClick={() => openEditModal(svc)}
                        className="text-cyan-400 hover:underline flex items-center space-x-1 font-semibold text-[10px]"
                        title="Sửa"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                      <button
                        onClick={() => onDeleteService(svc.id)}
                        className="text-red-400 hover:underline flex items-center space-x-1 font-semibold text-[10px]"
                        title="Xóa"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] leading-tight">
                    <div>
                      <span className="text-slate-500">Phản hồi:</span>
                      <p className="text-emerald-400 font-bold">{svc.status === 'down' ? 'TIMEOUT' : `${svc.responseTimeMs} ms`}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Uptime:</span>
                      <p className="text-slate-200 font-bold">{svc.uptimePercent}%</p>
                    </div>
                    <div className="col-span-1">
                      <span className="text-slate-500">Đã kiểm tra:</span>
                      <p className="text-slate-300 truncate" title={svc.lastCheck}>{svc.lastCheck}</p>
                    </div>
                  </div>

                  <div className="mt-1.5 pt-1.5 border-t border-slate-800/70 flex items-center justify-end gap-2 text-[10px]">
                    <button
                      onClick={() => void handleRefreshService(svc.id)}
                      disabled={refreshingServiceIds.has(svc.id)}
                      className="text-emerald-400 hover:underline flex items-center space-x-1 font-semibold disabled:opacity-50 disabled:no-underline"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshingServiceIds.has(svc.id) ? 'animate-spin' : ''}`} />
                      <span>{refreshingServiceIds.has(svc.id) ? 'Đang test...' : 'Test lại'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Service Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-md p-6 rounded-2xl border font-mono shadow-2xl ${
            darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <h3 className="text-base font-bold mb-4 text-emerald-400">
              {editingId ? 'Sửa Kiểm tra Dịch vụ (Service Check)' : 'Thêm Kiểm tra Dịch vụ (Service Check)'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Tên Dịch vụ:</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Web App HTTPS Portal"
                  className={`w-full p-2 rounded-lg border focus:ring-1 focus:ring-emerald-500 ${
                    darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Trụ sở:</label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className={`w-full p-2 rounded-lg border focus:ring-1 focus:ring-emerald-500 ${
                    darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                  }`}
                >
                  <option value="">(Chưa gán trụ sở)</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Loại Service Check:</label>
                <div className={`rounded-lg border p-2.5 space-y-2 ${darkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-300'}`}>
                  {METHOD_OPTIONS.map((method) => (
                    <label key={method.type} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedMethods[method.type]}
                          onChange={(e) => {
                            if (editingId) {
                              if (!e.target.checked) return;
                              setType(method.type);
                              setSelectedMethods({
                                PING: method.type === 'PING',
                                HTTP: method.type === 'HTTP',
                                HTTPS: method.type === 'HTTPS',
                                DNS: method.type === 'DNS',
                                SSH: method.type === 'SSH',
                                MYSQL: method.type === 'MYSQL',
                                BGP: method.type === 'BGP',
                                TCP: method.type === 'TCP',
                              });
                              return;
                            }
                            setSelectedMethods((prev) => ({
                              ...prev,
                              [method.type]: e.target.checked,
                            }));
                          }}
                          className="accent-emerald-500"
                        />
                        <span>{method.label}</span>
                      </span>
                      {PORT_METHODS.has(method.type) && selectedMethods[method.type] && (
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={methodPorts[method.type]}
                          onChange={(e) =>
                            setMethodPorts((prev) => ({
                              ...prev,
                              [method.type]: Number(e.target.value) || (method.defaultPort ?? 1),
                            }))
                          }
                          className={`w-24 p-1.5 rounded border text-[11px] ${
                            darkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300'
                          }`}
                        />
                      )}
                    </label>
                  ))}
                  <p className="text-[10px] text-slate-400">
                    {editingId
                      ? 'Ở chế độ sửa, chỉ chọn 1 phương thức kiểm tra cho dịch vụ này.'
                      : 'Một đối tượng có thể bật nhiều phương thức kiểm tra cùng lúc. Có thể cấu hình cổng riêng cho từng phương thức.'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Target Host / URL / IP:</label>
                <input
                  type="text"
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="10.200.0.1 hoặc portal.company.com"
                  className={`w-full p-2 rounded-lg border focus:ring-1 focus:ring-emerald-500 ${
                    darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                >
                  {editingId ? 'Lưu thay đổi' : 'Lưu Service Check'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
