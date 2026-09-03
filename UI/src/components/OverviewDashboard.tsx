import React, { useMemo } from 'react';
import { NetworkDevice, NetworkAlert, GlobalTrafficPoint, NetworkInterface } from '../types';
import { Server, ShieldAlert, ArrowDownLeft, ArrowUpRight, Activity, AlertTriangle, CheckCircle2, Clock, Check, Volume2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, ReferenceLine } from 'recharts';
import { PollerHealth } from './PollerHealth';

interface OverviewDashboardProps {
  devices: NetworkDevice[];
  alerts: NetworkAlert[];
  trafficHistory: GlobalTrafficPoint[];
  darkMode: boolean;
  trafficChartMode: 'stacked' | 'mirrored';
  onSelectDevice: (dev: NetworkDevice) => void;
  onAcknowledgeAlert: (id: string) => void;
  onNavigateToTab: (tab: 'devices' | 'alerts' | 'topology') => void;
  soundEnabled: boolean;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  devices,
  alerts,
  trafficHistory,
  darkMode,
  trafficChartMode,
  onSelectDevice,
  onAcknowledgeAlert,
  onNavigateToTab,
  soundEnabled,
}) => {
  // Stats calculation
  const totalDevices = devices.length;
  const upDevices = devices.filter((d) => d.status === 'up').length;
  const downDevices = devices.filter((d) => d.status === 'down').length;

  const activeAlerts = alerts.filter((a) => a.status === 'active');
  const openAlerts = alerts.filter((a) => a.status !== 'resolved');
  const warningDevices = new Set(openAlerts.map((a) => a.deviceId)).size;
  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical').length;
  const highCount = activeAlerts.filter((a) => a.severity === 'high').length;
  const mediumCount = activeAlerts.filter((a) => a.severity === 'medium').length;

  // Calculate total bandwidth
  let totalInBps = 0;
  let totalOutBps = 0;
  const allInterfaces: { devName: string; devIp: string; iface: NetworkInterface }[] = [];

  devices.forEach((dev) => {
    dev.interfaces.forEach((iface) => {
      totalInBps += iface.inRateBps;
      totalOutBps += iface.outRateBps;
      allInterfaces.push({ devName: dev.name, devIp: dev.ip, iface });
    });
  });

  const totalInGbps = (totalInBps / 1e9).toFixed(2);
  const totalOutGbps = (totalOutBps / 1e9).toFixed(2);

  // Top utilization interfaces
  const topInterfaces = [...allInterfaces]
    .sort((a, b) => b.iface.utilization - a.iface.utilization)
    .slice(0, 5);

  const avgPing = (
    devices.reduce((acc, d) => acc + (d.status !== 'down' ? d.pingLatencyMs : 0), 0) /
    (devices.filter((d) => d.status !== 'down').length || 1)
  ).toFixed(1);

  const chartTrafficHistory = useMemo(
    () =>
      trafficHistory.map((p) => ({
        ...p,
        inMbps: Math.abs(p.inMbps),
        outPlot: trafficChartMode === 'mirrored' ? -Math.abs(p.outMbps) : Math.abs(p.outMbps),
      })),
    [trafficHistory, trafficChartMode],
  );
  const maxTrafficAbs = useMemo(() => {
    const peak = chartTrafficHistory.reduce(
      (acc, p) => Math.max(acc, Math.abs(p.inMbps), Math.abs(p.outPlot)),
      0,
    );
    return peak > 0 ? Number(peak.toFixed(2)) : 1;
  }, [chartTrafficHistory]);

  return (
    <div className="space-y-6 pb-12">
      
      {/* Real-time Alert Banner Ticker */}
      {activeAlerts.length > 0 && (
        <div className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm ${
          criticalCount > 0
            ? 'bg-red-950/40 border-red-500/40 text-red-200'
            : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
        }`}>
          <div className="flex items-center space-x-3">
            <span className={`p-2 rounded-lg ${criticalCount > 0 ? 'bg-red-500/20 text-red-400 animate-bounce' : 'bg-amber-500/20 text-amber-400'}`}>
              <AlertTriangle className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-xs uppercase tracking-wider font-mono">
                  {criticalCount > 0 ? '🚨 Cảnh báo Nguy hiểm (Critical)' : '⚠️ Cảnh báo Mạng'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-black/40 font-mono">
                  {activeAlerts.length} Cần xử lý
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 font-medium line-clamp-1">
                <strong className="text-white">{activeAlerts[0].deviceName}:</strong> {activeAlerts[0].message}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 self-end sm:self-auto">
            <button
              onClick={() => onAcknowledgeAlert(activeAlerts[0].id)}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-colors flex items-center space-x-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Xác nhận ngay</span>
            </button>
            <button
              onClick={() => onNavigateToTab('alerts')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                darkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300'
              }`}
            >
              Xem tất cả ({activeAlerts.length})
            </button>
          </div>
        </div>
      )}

      {/* Top 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Metric 1: Device Summary */}
        <div
          onClick={() => onNavigateToTab('devices')}
          className={`p-4 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] ${
            darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Trạng thái Thiết bị</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Server className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-slate-100">{totalDevices}</span>
            <span className="text-xs font-mono text-emerald-400 font-semibold">{((upDevices / totalDevices) * 100).toFixed(0)}% Hoạt động</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 text-xs font-mono border-t border-slate-800/60 pt-2 text-center">
            <div className="text-emerald-400 font-bold bg-emerald-500/10 py-1 rounded">● {upDevices} UP</div>
            <div className="text-amber-400 font-bold bg-amber-500/10 py-1 rounded">▲ {warningDevices} WARN</div>
            <div className="text-red-400 font-bold bg-red-500/10 py-1 rounded">■ {downDevices} DOWN</div>
          </div>
        </div>

        {/* Metric 2: Active Alerts */}
        <div
          onClick={() => onNavigateToTab('alerts')}
          className={`p-4 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] ${
            darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Cảnh báo Thời gian thực</span>
            <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-slate-100">{activeAlerts.length}</span>
            <span className="text-xs font-mono text-red-400 font-semibold">{criticalCount} Nguy hiểm</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 text-xs font-mono border-t border-slate-800/60 pt-2 text-center">
            <div className="text-red-400 font-bold bg-red-500/10 py-1 rounded">{criticalCount} Crit</div>
            <div className="text-orange-400 font-bold bg-orange-500/10 py-1 rounded">{highCount} High</div>
            <div className="text-amber-400 font-bold bg-amber-500/10 py-1 rounded">{mediumCount} Med</div>
          </div>
        </div>

        {/* Metric 3: Total Bandwidth In/Out */}
        <div
          onClick={() => onNavigateToTab('devices')}
          className={`p-4 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] ${
            darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Tổng Băng thông Mạng</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-slate-100">{totalInGbps} Gbps</span>
            <span className="text-xs font-mono text-cyan-400 font-semibold">Out: {totalOutGbps} Gbps</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono border-t border-slate-800/60 pt-2 text-slate-300">
            <span className="flex items-center text-emerald-400 font-semibold"><ArrowDownLeft className="w-3.5 h-3.5 mr-0.5" /> Inbound</span>
            <span className="flex items-center text-cyan-400 font-semibold"><ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> Outbound</span>
          </div>
        </div>

        {/* Metric 4: Ping Latency & Packet Loss */}
        <div
          onClick={() => onNavigateToTab('devices')}
          className={`p-4 rounded-xl border transition-all ${
            darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Độ trễ Ping & Mất gói</span>
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-slate-100">{avgPing} ms</span>
            <span className="text-xs font-mono text-emerald-400 font-semibold">Loss: 0.1%</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono border-t border-slate-800/60 pt-2 text-slate-300">
            <span>SNMP Timeout: 2.0s</span>
            <span className="text-emerald-400">Jitter: &lt;1ms</span>
          </div>
        </div>

      </div>

      {/* Main Graph Grid (LibreNMS Traffic Area Chart) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: LibreNMS Bandwidth Traffic In/Out Chart */}
        <div className={`lg:col-span-2 p-5 rounded-xl border ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
            <div>
              <h3 className="font-bold text-sm tracking-wide flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Lưu lượng Băng thông Tổng (Global SNMP Bandwidth In/Out)</span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">Biểu đồ tổng hợp Inbound (Vào) & Outbound (Ra) đo bằng Mbps theo thời gian</p>
            </div>
            <div className="flex items-center space-x-4 text-xs font-mono">
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span>
                <span className="text-slate-300">Inbound (Vào)</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-3 rounded bg-cyan-400 inline-block"></span>
                <span className="text-slate-300">Outbound (Ra)</span>
              </div>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartTrafficHistory} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#1e293b' : '#e2e8f0'} />
                <XAxis dataKey="time" stroke={darkMode ? '#64748b' : '#94a3b8'} fontSize={11} tickLine={false} />
                <YAxis
                  stroke={darkMode ? '#64748b' : '#94a3b8'}
                  fontSize={11}
                  tickLine={false}
                  unit="M"
                  domain={trafficChartMode === 'mirrored' ? [-maxTrafficAbs, maxTrafficAbs] : [0, maxTrafficAbs]}
                  tickFormatter={(value) =>
                    trafficChartMode === 'mirrored' ? Math.abs(Number(value)).toFixed(0) : Number(value).toFixed(0)
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? '#0f172a' : '#ffffff',
                    borderColor: darkMode ? '#334155' : '#cbd5e1',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                  }}
                  formatter={(value: number) => [`${Math.abs(Number(value)).toFixed(2)} Mbps`, '']}
                />
                {trafficChartMode === 'mirrored' && (
                  <ReferenceLine y={0} stroke={darkMode ? '#475569' : '#94a3b8'} strokeDasharray="3 3" />
                )}
                <Area type="monotone" dataKey="inMbps" name="Inbound" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorIn)" />
                <Area type="monotone" dataKey="outPlot" name="Outbound" stroke="#22d3ee" strokeWidth={2} fillOpacity={1} fill="url(#colorOut)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right 1 Col: Device Health Matrix & Ping Latency Trend */}
        <div className={`p-5 rounded-xl border flex flex-col justify-between ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        }`}>
          <div>
            <h3 className="font-bold text-sm tracking-wide mb-1">Ma trận Trạng thái Thiết bị (NOC Health Matrix)</h3>
            <p className="text-xs text-slate-300 mb-3">Nhấp vào thiết bị để xem chi tiết thông số SNMP</p>

            {/* Matrix Items */}
            <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1 scrollbar-thin">
              {devices.map((dev) => (
                <div
                  key={dev.id}
                  onClick={() => onSelectDevice(dev)}
                  className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-colors ${
                    darkMode ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700/80' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      dev.status === 'up'
                        ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                        : dev.status === 'warning'
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-red-500 animate-ping'
                    }`}></span>
                    <div>
                      <h4 className="font-semibold text-xs font-mono text-slate-200">{dev.name}</h4>
                      <p className="text-xs font-mono text-slate-300">{dev.ip} • {dev.vendor} {dev.model}</p>
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <span className={`font-semibold ${
                      dev.status === 'up' ? 'text-emerald-400' : dev.status === 'warning' ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {dev.status === 'down' ? 'OFFLINE' : `${dev.pingLatencyMs}ms`}
                    </span>
                    <p className="text-xs text-slate-300">CPU {dev.cpuUsage}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
            <span className="font-mono">Tải CPU TB: 42%</span>
            <button
              onClick={() => onNavigateToTab('devices')}
              className="text-emerald-400 hover:underline font-semibold text-xs"
            >
              Tất cả thiết bị →
            </button>
          </div>
        </div>

      </div>

      {/* Top 5 Utilization Interfaces Table */}
      <div className={`p-5 rounded-xl border ${
        darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Top 5 Cổng Giao diện Tải cao nhất (Top Traffic Ports)</h3>
            <p className="text-xs text-slate-300">Giám sát các cổng kết nối Uplink, Trunk và Server bị sử dụng trên 40%</p>
          </div>
          <button
            onClick={() => onNavigateToTab('devices')}
            className="text-xs text-emerald-400 font-semibold hover:underline"
          >
            Quản lý tất cả cổng →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className={`border-b text-slate-300 ${darkMode ? 'border-slate-800 bg-slate-800/40' : 'border-slate-200 bg-slate-50'}`}>
                <th className="py-2.5 px-3">Thiết bị</th>
                <th className="py-2.5 px-3">Tên Cổng</th>
                <th className="py-2.5 px-3">Mô tả / Đích</th>
                <th className="py-2.5 px-3">Băng thông</th>
                <th className="py-2.5 px-3 text-emerald-400">Inbound (Vào)</th>
                <th className="py-2.5 px-3 text-cyan-400">Outbound (Ra)</th>
                <th className="py-2.5 px-3">Sử dụng (%)</th>
                <th className="py-2.5 px-3 text-right">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {topInterfaces.map(({ devName, devIp, iface }) => {
                const inMbps = (iface.inRateBps / 1e6).toFixed(1);
                const outMbps = (iface.outRateBps / 1e6).toFixed(1);

                return (
                  <tr key={iface.id} className={`hover:bg-slate-800/30 transition-colors ${
                    darkMode ? 'text-slate-300' : 'text-slate-700'
                  }`}>
                    <td className="py-2.5 px-3 font-semibold text-slate-100">
                      <div>{devName}</div>
                      <div className="text-xs text-slate-400">{devIp}</div>
                    </td>
                    <td className="py-2.5 px-3 text-emerald-400 font-bold">{iface.name}</td>
                    <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate">{iface.description}</td>
                    <td className="py-2.5 px-3">{iface.speed}</td>
                    <td className="py-2.5 px-3 font-bold text-emerald-400">{inMbps} Mbps</td>
                    <td className="py-2.5 px-3 font-bold text-cyan-400">{outMbps} Mbps</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-16 bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              iface.utilization > 75 ? 'bg-red-500' : iface.utilization > 50 ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${iface.utilization}%` }}
                          ></div>
                        </div>
                        <span className="font-bold">{iface.utilization}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-2 py-0.5 text-xs rounded font-bold uppercase ${
                        iface.operStatus === 'up' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {iface.operStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Poller health status */}
      <PollerHealth darkMode={darkMode} />

    </div>
  );
};
