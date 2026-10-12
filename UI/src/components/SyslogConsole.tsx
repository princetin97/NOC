import React, { useMemo, useState } from 'react';
import { EventLog, NetworkDevice } from '../types';
import { ScrollText, Search, Filter, Server, ChevronLeft, ChevronRight } from 'lucide-react';

interface SyslogConsoleProps {
  eventLogs: EventLog[];
  devices: NetworkDevice[];
  darkMode: boolean;
}

const PAGE_SIZE = 20;

export const SyslogConsole: React.FC<SyslogConsoleProps> = ({ eventLogs, devices, darkMode }) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const card = darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800';
  const input = darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900';

  // Count logs per device so the sidebar can show how noisy each device is.
  const logCountByDevice = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of eventLogs) {
      map.set(log.deviceId, (map.get(log.deviceId) ?? 0) + 1);
    }
    return map;
  }, [eventLogs]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;

  const deviceLogs = useMemo(
    () => (selectedDeviceId ? eventLogs.filter((l) => l.deviceId === selectedDeviceId) : []),
    [eventLogs, selectedDeviceId],
  );

  const severities = useMemo(() => Array.from(new Set(deviceLogs.map((l) => l.severity))), [deviceLogs]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return deviceLogs.filter((log) => {
      const matchesSeverity = severityFilter === 'all' || log.severity === severityFilter;
      const matchesSearch =
        !q || log.message.toLowerCase().includes(q) || log.facility.toLowerCase().includes(q);
      return matchesSeverity && matchesSearch;
    });
  }, [deviceLogs, searchQuery, severityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageLogs = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectDevice = (id: string) => {
    setSelectedDeviceId(id);
    setSearchQuery('');
    setSeverityFilter('all');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScrollText className="w-6 h-6 text-cyan-400" />
        <div>
          <h2 className={`text-xl font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>Nhật ký SNMP Trap</h2>
          <p className="text-sm text-slate-400">Chọn thiết bị để xem log riêng của thiết bị đó (SNMP Trap UDP 162).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Device list */}
        <div className={`rounded-xl border ${card} lg:col-span-1 overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-800 font-mono text-xs font-bold text-slate-300">
            Thiết bị ({devices.length})
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-800">
            {devices.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">Chưa có thiết bị.</div>
            ) : (
              devices.map((dev) => {
                const count = logCountByDevice.get(dev.id) ?? 0;
                const active = dev.id === selectedDeviceId;
                return (
                  <button
                    key={dev.id}
                    onClick={() => selectDevice(dev.id)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 font-mono text-xs transition-colors ${
                      active ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Server className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <span className="truncate">{dev.name}</span>
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      count > 0 ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Log panel */}
        <div className={`rounded-xl border ${card} lg:col-span-3`}>
          {!selectedDevice ? (
            <div className="p-10 text-center text-sm text-slate-500 font-mono">
              ← Chọn một thiết bị ở danh sách bên trái để xem nhật ký log.
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-bold text-sm font-mono text-slate-200">
                  Log của <span className="text-emerald-400">{selectedDevice.name}</span> ({filtered.length}/{deviceLogs.length})
                </h3>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                      placeholder="Tìm nội dung, facility..."
                      className={`pl-9 pr-3 py-2 rounded-lg border text-sm w-56 ${input}`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                      value={severityFilter}
                      onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
                      className={`rounded-lg border px-3 py-2 text-sm ${input}`}
                    >
                      <option value="all">Tất cả severity</option>
                      {severities.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border rounded-xl border-slate-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-slate-800/80 border-b border-slate-700 text-slate-400">
                      <th className="py-2.5 px-3">Thời gian</th>
                      <th className="py-2.5 px-3">Facility</th>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">Nội dung Thông điệp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {pageLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">Không có log phù hợp.</td>
                      </tr>
                    ) : (
                      pageLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/50">
                          <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{log.timestamp}</td>
                          <td className="py-2.5 px-3 text-cyan-400">{log.facility}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 text-[10px] rounded uppercase font-bold ${
                                log.severity === 'emerg' || log.severity === 'crit' || log.severity === 'alert' || log.severity === 'error'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-amber-500/20 text-amber-400'
                              }`}
                            >
                              {log.severity}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{log.message}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span>Trang {currentPage}/{totalPages} • {filtered.length} log</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-2.5 py-1 rounded-lg border border-slate-700 disabled:opacity-40 hover:bg-slate-800 flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Trước
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="px-2.5 py-1 rounded-lg border border-slate-700 disabled:opacity-40 hover:bg-slate-800 flex items-center gap-1"
                  >
                    Sau <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
