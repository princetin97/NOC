import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, ArrowDownLeft, ArrowUpRight, Activity, Cable, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../services/api';
import { NetworkInterface, PortMetricPoint } from '../types';

interface PortDetailProps {
  port: NetworkInterface;
  darkMode: boolean;
  trafficChartMode: 'stacked' | 'mirrored';
  onClose: () => void;
}

const RANGES = [
  { label: '1 giờ', hours: 1 },
  { label: '6 giờ', hours: 6 },
  { label: '24 giờ', hours: 24 },
  { label: '7 ngày', hours: 168 },
];

export const PortDetail: React.FC<PortDetailProps> = ({ port, darkMode, trafficChartMode, onClose }) => {
  const [hours, setHours] = useState(6);
  const [data, setData] = useState<PortMetricPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.ports
      .metrics(port.id, hours)
      .then((points) => {
        if (!cancelled) setData(points);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port.id, hours]);

  const baseData = data.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    inMbps: Number((Math.abs(p.inRateBps) / 1e6).toFixed(2)),
    outMbps: Number((Math.abs(p.outRateBps) / 1e6).toFixed(2)),
  }));
  const chartData = useMemo(
    () =>
      baseData.map((p) => ({
        ...p,
        outPlot: trafficChartMode === 'mirrored' ? -p.outMbps : p.outMbps,
      })),
    [baseData, trafficChartMode],
  );
  const maxAbsMbps = useMemo(() => {
    const peak = chartData.reduce((acc, p) => Math.max(acc, Math.abs(p.inMbps), Math.abs(p.outPlot)), 0);
    return peak > 0 ? Number(peak.toFixed(2)) : 1;
  }, [chartData]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className={`w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-2xl border shadow-2xl ${
          darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <Cable className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-black font-mono text-base text-emerald-400">{port.name}</h3>
              {port.description && <p className="text-xs text-slate-400">{port.description}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Port summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Trạng thái</span>
              <p className="mt-1">
                <span
                  className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase ${
                    port.operStatus === 'up' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {port.adminStatus}/{port.operStatus}
                </span>
              </p>
            </div>
            <div className="p-3 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Tốc độ cổng</span>
              <p className="text-lg font-black mt-1 text-slate-200">{port.speed}</p>
            </div>
            <div className="p-3 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-center gap-1">
                <ArrowDownLeft className="w-3 h-3 text-emerald-400" /> Rate In
              </span>
              <p className="text-lg font-black mt-1 text-emerald-400">{(port.inRateBps / 1e6).toFixed(1)} Mbps</p>
            </div>
            <div className="p-3 rounded-xl border bg-slate-800/40 border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-cyan-400" /> Rate Out
              </span>
              <p className="text-lg font-black mt-1 text-cyan-400">{(port.outRateBps / 1e6).toFixed(1)} Mbps</p>
            </div>
          </div>

          {/* Range selector */}
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-300 font-mono flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" /> Lịch sử Traffic In / Out
            </h4>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.hours}
                  onClick={() => setHours(r.hours)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    hours === r.hours ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Traffic chart */}
          <div className="h-64 w-full rounded-xl border bg-slate-950/40 border-slate-800 p-3">
            {loading ? (
              <div className="h-full flex items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <AlertTriangle className="w-6 h-6" />
                <span className="text-sm">Chưa có dữ liệu lịch sử cho khoảng thời gian này.</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={10} minTickGap={30} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={10}
                    unit=" Mb"
                    domain={trafficChartMode === 'mirrored' ? [-maxAbsMbps, maxAbsMbps] : [0, maxAbsMbps]}
                    tickFormatter={(value) =>
                      `${trafficChartMode === 'mirrored' ? Math.abs(Number(value)).toFixed(0) : Number(value).toFixed(0)}`
                    }
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
                    formatter={(value: number, name: string) => [`${Math.abs(Number(value)).toFixed(2)} Mbps`, name]}
                  />
                  {trafficChartMode === 'mirrored' && <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />}
                  <Area type="monotone" dataKey="inMbps" name="Vào (In)" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="outPlot" name="Ra (Out)" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Extra port details */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1 text-slate-400">
            <div className="flex justify-between">
              <span>Địa chỉ MAC (ifPhysAddress):</span>
              <span className="text-slate-200">{port.macAddress || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span>Loại giao diện (ifType):</span>
              <span className="text-slate-200">{port.type}</span>
            </div>
            <div className="flex justify-between">
              <span>Mức sử dụng (utilization):</span>
              <span className="text-slate-200">{port.utilization}%</span>
            </div>
            <div className="flex justify-between">
              <span>Lỗi (In / Out):</span>
              <span className="text-slate-200">{port.inErrors} / {port.outErrors}</span>
            </div>
            <div className="flex justify-between">
              <span>Discards (In / Out):</span>
              <span className="text-slate-200">{port.inDiscards} / {port.outDiscards}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
