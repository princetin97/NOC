import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Loader2, LineChart as LineChartIcon } from 'lucide-react';
import { api } from '../services/api';
import { DeviceMetricPoint } from '../types';

interface DeviceMetricsHistoryProps {
  deviceId: string;
  darkMode: boolean;
}

const RANGES = [
  { label: '1 giờ', hours: 1 },
  { label: '6 giờ', hours: 6 },
  { label: '24 giờ', hours: 24 },
  { label: '7 ngày', hours: 168 },
];

export const DeviceMetricsHistory: React.FC<DeviceMetricsHistoryProps> = ({ deviceId, darkMode }) => {
  const [hours, setHours] = useState(6);
  const [data, setData] = useState<DeviceMetricPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.devices
      .metrics(deviceId, hours)
      .then((rows) => {
        if (!cancelled) setData(rows);
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
  }, [deviceId, hours]);

  const chartData = data.map((p) => ({
    time: new Date(p.timestamp).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
    cpu: Math.round(p.cpuUsage),
    ram: Math.round(p.memoryUsage),
    temp: p.temperature ?? null,
    ping: p.pingLatencyMs ?? null,
  }));

  const gridColor = darkMode ? '#1e293b' : '#e2e8f0';
  const axisColor = darkMode ? '#64748b' : '#94a3b8';

  return (
    <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <LineChartIcon className="w-4 h-4 text-emerald-400" /> Lịch sử hiệu năng
        </h3>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                hours === r.hours ? 'bg-emerald-500 text-white' : darkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-56 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải dữ liệu...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-slate-500 text-sm">
          Chưa có dữ liệu lịch sử trong khoảng thời gian này.
        </div>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" stroke={axisColor} fontSize={10} minTickGap={40} />
                <YAxis stroke={axisColor} fontSize={10} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="cpu" name="CPU %" stroke="#34d399" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="ram" name="RAM %" stroke="#fbbf24" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="temp" name="Nhiệt độ °C" stroke="#f87171" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-40 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" stroke={axisColor} fontSize={10} minTickGap={40} />
                <YAxis stroke={axisColor} fontSize={10} />
                <Tooltip contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="ping" name="Độ trễ ICMP (ms)" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
};
