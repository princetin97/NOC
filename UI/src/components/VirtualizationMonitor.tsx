import React, { useEffect, useState } from 'react';
import { Activity, Cloud, Pencil, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react';
import { SiteInfo, VirtualizationHost, VirtualizationManager } from '../types';
import { api } from '../services/api';
import { INVENTORY_SECTIONS, compactInventoryPreview, formatInventoryLabel, parseInventorySummary } from '../utils/inventorySummary';

interface Props {
  sites: SiteInfo[];
  selectedSiteId: string | null;
  darkMode: boolean;
  canManage: boolean;
  compact?: boolean;
}

export const VirtualizationMonitor: React.FC<Props> = ({ sites, selectedSiteId, darkMode, canManage, compact = false }) => {
  const [managers, setManagers] = useState<VirtualizationManager[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);
  const [hosts, setHosts] = useState<VirtualizationHost[]>([]);
  const [selectedHost, setSelectedHost] = useState<VirtualizationHost | null>(null);

  const [loading, setLoading] = useState(true);
  const [syncingManagerId, setSyncingManagerId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingManagerId, setEditingManagerId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    endpoint: '',
    username: '',
    password: '',
    siteId: selectedSiteId ?? '',
  });

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState('');

  const panel = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const input = `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-500/40 ${
    darkMode
      ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
      : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
  }`;

  const usage = (value?: number | null): string => (value == null ? 'N/A' : `${Math.round(value)}%`);

  const hostStatus = (host: VirtualizationHost): { label: string; className: string } => {
    if (host.alertState === 'critical' || host.connectionState !== 'connected') {
      return { label: 'CRITICAL', className: 'text-red-400 bg-red-500/10 border-red-500/30' };
    }
    if (host.alertState === 'warning') {
      return { label: 'WARNING', className: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    }
    return { label: 'OK', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
  };

  const needsDiagnostics = (host: VirtualizationHost): boolean => {
    return host.cpuUsage == null || host.memoryUsage == null || !host.inventorySummary;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api.vcenter.listManagers(selectedSiteId);
      setManagers(list);

      const current = list.find((m) => m.id === selectedManagerId) ?? list[0] ?? null;
      setSelectedManagerId(current?.id ?? null);

      if (current) {
        const inv = await api.vcenter.inventory(current.id);
        setHosts(inv.hosts);
      } else {
        setHosts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách vCenter');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [selectedSiteId]);

  const selectManager = async (manager: VirtualizationManager) => {
    setSelectedManagerId(manager.id);
    setError('');
    try {
      const inv = await api.vcenter.inventory(manager.id);
      setHosts(inv.hosts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải inventory');
    }
  };

  const sync = async (manager: VirtualizationManager) => {
    setSyncingManagerId(manager.id);
    setError('');
    try {
      await api.vcenter.sync(manager.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đồng bộ vCenter thất bại');
    } finally {
      setSyncingManagerId(null);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingManagerId(null);
    setForm({ name: '', endpoint: '', username: '', password: '', siteId: selectedSiteId ?? sites[0]?.id ?? '' });
  };

  const startCreate = () => {
    setError('');
    setEditingManagerId(null);
    setForm({ name: '', endpoint: '', username: '', password: '', siteId: selectedSiteId ?? sites[0]?.id ?? '' });
    setShowForm(true);
  };

  const startEdit = (manager: VirtualizationManager) => {
    setError('');
    setEditingManagerId(manager.id);
    setForm({ name: manager.name, endpoint: manager.endpoint, username: '', password: '', siteId: manager.siteId ?? '' });
    setShowForm(true);
  };

  const submitForm = async () => {
    setError('');
    try {
      if (editingManagerId) {
        const patch: Record<string, string> = { siteId: form.siteId };
        if (form.name) patch.name = form.name;
        if (form.endpoint) patch.endpoint = form.endpoint;
        if (form.username) patch.username = form.username;
        if (form.password) patch.password = form.password;
        await api.vcenter.update(editingManagerId, patch);
      } else {
        await api.vcenter.create({ ...form, siteId: form.siteId });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingManagerId ? 'Không thể cập nhật kết nối vCenter' : 'Không thể thêm vCenter');
    }
  };

  const remove = async (manager: VirtualizationManager) => {
    if (!window.confirm(`Xóa kết nối vCenter ${manager.name}?`)) return;
    setError('');
    try {
      await api.vcenter.remove(manager.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa vCenter');
    }
  };

  const runDiagnostics = async (host: VirtualizationHost) => {
    if (!selectedManagerId) return;
    setDiagnosing(true);
    setDiagnosticsError('');
    setDiagnostics(null);
    try {
      const result = await api.vcenter.diagnostics(selectedManagerId, host.id);
      setDiagnostics(result);
    } catch (err) {
      setDiagnosticsError(err instanceof Error ? err.message : 'Chẩn đoán thất bại');
    } finally {
      setDiagnosing(false);
    }
  };

  return (
    <div className={`${compact ? 'space-y-3' : 'max-w-[1440px] mx-auto space-y-4 pb-12'}`}>
      {!compact && (
        <div className={`px-4 py-3 rounded-xl border ${panel} flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Cloud className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm">VMware vCenter / ESXi</h2>
              <p className="text-[11px] text-slate-400 truncate">Host ESXi from vCenter inventory; diagnostics available per host.</p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={startCreate}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Thêm vCenter
            </button>
          )}
        </div>
      )}

      {error && <div className="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 text-xs">{error}</div>}

      {!compact && showForm && (
        <div className={`rounded-xl border ${panel} p-4`}>
          <div className="max-w-4xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">{editingManagerId ? 'Sửa kết nối vCenter' : 'Kết nối vCenter'}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Thông tin kết nối được lưu tại backend.</p>
              </div>
              <button onClick={resetForm} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="block text-[11px] font-medium text-slate-400">Tên kết nối</span>
                <input className={input} placeholder="vCenter Production" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="block text-[11px] font-medium text-slate-400">Endpoint</span>
                <input className={input} placeholder="https://vcenter.example" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] font-medium text-slate-400">Trụ sở</span>
                <select className={input} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                  <option value="" disabled>
                    Chọn trụ sở
                  </option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] font-medium text-slate-400">Tài khoản</span>
                <input
                  className={input}
                  placeholder={editingManagerId ? 'Giữ nguyên nếu để trống' : 'administrator@vsphere.local'}
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] font-medium text-slate-400">Mật khẩu</span>
                <input
                  className={input}
                  type="password"
                  placeholder={editingManagerId ? 'Giữ nguyên nếu để trống' : 'Password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                onClick={submitForm}
                disabled={
                  editingManagerId
                    ? !form.name || !form.endpoint || !form.siteId
                    : !form.name || !form.endpoint || !form.username || !form.password || !form.siteId
                }
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {editingManagerId ? 'Cập nhật kết nối' : 'Lưu kết nối'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-3">
        <div className={`rounded-xl border ${panel} p-3 space-y-2`}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">vCenter</div>
            <span className="text-[10px] text-slate-500">{managers.length}</span>
          </div>

          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : managers.length === 0 ? (
            <div className="text-xs text-slate-500 py-4">Chưa có kết nối.</div>
          ) : (
            managers.map((m) => (
              <button
                key={m.id}
                onClick={() => void selectManager(m)}
                className={`w-full text-left p-2.5 rounded-lg border ${selectedManagerId === m.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-transparent hover:bg-slate-800/60'}`}
              >
                <div className="font-semibold text-xs truncate">{m.name}</div>
                <div className="text-[10px] text-slate-400 truncate mt-1">{m.endpoint}</div>
                <div className="text-[10px] text-cyan-300 mt-1">{m._count?.hosts ?? 0} host</div>
                <div className="flex gap-3 mt-2">
                  <span onClick={(e) => { e.stopPropagation(); void sync(m); }} className="text-emerald-400 text-[10px]">
                    {syncingManagerId === m.id ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}
                  </span>
                  {canManage && (
                    <span onClick={(e) => { e.stopPropagation(); startEdit(m); }} className="text-cyan-400 text-[10px]">
                      <Pencil className="w-3 h-3 inline" /> Sửa
                    </span>
                  )}
                  {canManage && (
                    <span onClick={(e) => { e.stopPropagation(); void remove(m); }} className="text-red-400 text-[10px]">
                      <Trash2 className="w-3 h-3 inline" /> Xóa
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className={`rounded-xl border ${panel} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-sm">Host ESXi</h3>
              <p className="text-[11px] text-slate-500">Click one row to view usage, status and inventory details.</p>
            </div>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>

          {!selectedManagerId ? (
            <div className="text-xs text-slate-400">Chưa có kết nối vCenter.</div>
          ) : hosts.length === 0 ? (
            <div className="text-xs text-slate-400">Chưa có inventory. Bấm Đồng bộ ngay.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="py-2 px-2">Tên host</th>
                    <th className="py-2 px-2">Trạng thái</th>
                    <th className="py-2 px-2">CPU</th>
                    <th className="py-2 px-2">RAM</th>
                    <th className="py-2 px-2">Inventory</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {hosts.map((host) => {
                    const status = hostStatus(host);
                    const inventoryPreview = compactInventoryPreview(host.inventorySummary);
                    return (
                      <tr key={host.id} onClick={() => setSelectedHost(host)} className="cursor-pointer hover:bg-cyan-500/5">
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2 font-semibold text-slate-200">
                            <Server className="w-4 h-4 text-emerald-400" />
                            {host.name}
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${status.className}`}>{status.label}</span>
                          <div className="text-[10px] text-slate-500 mt-1">{host.connectionState ?? host.powerState ?? 'unknown'}</div>
                        </td>
                        <td className={`py-2.5 px-2 font-bold ${host.cpuUsage != null && host.cpuUsage >= 85 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {usage(host.cpuUsage)}
                        </td>
                        <td className={`py-2.5 px-2 font-bold ${host.memoryUsage != null && host.memoryUsage >= 90 ? 'text-red-400' : 'text-amber-400'}`}>
                          {usage(host.memoryUsage)}
                        </td>
                        <td className="py-2.5 px-2 text-[10px] text-slate-500 max-w-[320px] truncate">{inventoryPreview}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selectedHost && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            setSelectedHost(null);
            setDiagnostics(null);
            setDiagnosticsError('');
          }}
        >
          <div className={`w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl ${panel} p-5`} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-700/70 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10">
                  <Server className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">{selectedHost.name}</h2>
                  <p className="text-xs text-slate-400">Host ESXi - vCenter inventory</p>
                </div>
              </div>
              <button onClick={() => setSelectedHost(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              {[
                { label: 'CPU usage', value: usage(selectedHost.cpuUsage), color: selectedHost.cpuUsage != null && selectedHost.cpuUsage >= 85 ? 'text-red-400' : 'text-emerald-400' },
                { label: 'RAM usage', value: usage(selectedHost.memoryUsage), color: selectedHost.memoryUsage != null && selectedHost.memoryUsage >= 90 ? 'text-red-400' : 'text-amber-400' },
              ].map((metric) => (
                <div key={metric.label} className="rounded-lg border border-slate-700/70 bg-slate-800/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</p>
                  <p className={`text-xl font-black mt-1 ${metric.color}`}>{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mt-4 text-xs">
              <div className="rounded-lg border border-slate-700/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Trạng thái</p>
                <p className="text-slate-200">Nguồn: <span className="text-cyan-300">{selectedHost.powerState ?? 'N/A'}</span></p>
                <p className="text-slate-200 mt-1">Kết nối: <span className="text-emerald-400">{selectedHost.connectionState ?? 'N/A'}</span></p>
                <p className="text-slate-200 mt-1">Cảnh báo: <span className={hostStatus(selectedHost).className.split(' ')[0]}>{hostStatus(selectedHost).label}</span></p>
              </div>

              <div className="rounded-lg border border-slate-700/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Inventory</p>
                {(() => {
                  const inventory = parseInventorySummary(selectedHost.inventorySummary);
                  const hasInventory = Object.keys(inventory).length > 0;
                  if (!hasInventory) {
                    return <p className="text-slate-300 break-words">vCenter has not returned detailed inventory for this host.</p>;
                  }

                  return (
                    <div className="space-y-2">
                      {INVENTORY_SECTIONS.map((section) => {
                        const rows = section.keys
                          .map((key) => {
                            const value = inventory[key];
                            if (!value) return null;
                            return { key, value };
                          })
                          .filter((row): row is { key: string; value: string } => Boolean(row));
                        if (rows.length === 0) return null;
                        return (
                          <div key={section.title} className="rounded-md border border-slate-700/60 p-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{section.title}</p>
                            <div className="space-y-1">
                              {rows.map((row) => (
                                <p key={row.key} className="text-slate-300 break-words">
                                  <span className="text-slate-400">{formatInventoryLabel(row.key)}:</span> {row.value}
                                </p>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-[10px] text-slate-500 mt-2">External ID: {selectedHost.externalId}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-amber-300">
                  {needsDiagnostics(selectedHost)
                    ? 'Some host data is still missing (usage or inventory). Run diagnostics to inspect raw vCenter response.'
                    : 'Run diagnostics to inspect raw vCenter response and verify live metrics.'}
                </p>
                <button
                  onClick={() => void runDiagnostics(selectedHost)}
                  disabled={diagnosing}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold disabled:opacity-50"
                >
                  {diagnosing ? 'Đang chẩn đoán...' : 'Chẩn đoán'}
                </button>
              </div>
              {diagnosticsError && <p className="text-[11px] text-red-400 mt-2">{diagnosticsError}</p>}
              {diagnostics && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950/70 border border-slate-800 p-2 text-[10px] text-slate-300 whitespace-pre-wrap break-all">
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  setSelectedHost(null);
                  setDiagnostics(null);
                  setDiagnosticsError('');
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
