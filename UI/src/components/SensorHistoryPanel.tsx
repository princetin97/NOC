import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, BatteryCharging } from 'lucide-react';
import { api } from '../services/api';
import { SensorSeries } from '../types';

interface SensorHistoryPanelProps {
  deviceId: string;
  sensorType: string; // e.g. 'load' for UPS output load %
  title: string;
  darkMode: boolean;
}

const RANGES = [
  { label: '1 giờ', hours: 1 },
  { label: '6 giờ', hours: 6 },
  { label: '24 giờ', hours: 24 },
  { label: '7 ngày', hours: 168 },
];

const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#ec4899', '#14b8a6'];

const fmtVal = (v: number | null | undefined, unit: string): string =>
  v === null || v === undefined || Number.isNaN(v) ? 'N/A' : `${Math.round(v * 10) / 10}${unit}`;

// Historical trend chart for a category of sensors (used for UPS load %, but reusable
// for any sensor type that should be graphed over time rather than shown as a snapshot).
export const SensorHistoryPanel: React.FC<SensorHistoryPanelProps> = ({ deviceId, sensorType, title, darkMode }) => {
  const [hours, setHours] = useState(6);
  const [series, setSeries] = useState<SensorSeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.devices
      .sensorMetrics(deviceId, sensorType, hours)
      .then((rows) => {
        if (!cancelled) setSeries(rows);
      })
      .catch(() => {
        if (!cancelled) setSeries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, sensorType, hours]);

  // Merge all sensors' samples onto a shared time axis, keyed by epoch ms so
  // out-of-order concatenation across sensors doesn't make the chart jump backwards.
  const chartData = useMemo(() => {
    const byTime = new Map<number, Record<string, number | string>>();
    for (const s of series) {
      for (const m of s.metrics) {
        const ts = new Date(m.timestamp).getTime();
        const row =
          byTime.get(ts) ??
          {
            time: new Date(ts).toLocaleString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: '2-digit',
            }),
          };
        row[s.id] = Math.round(m.value * 10) / 10;
        byTime.set(ts, row);
      }
    }
    return Array.from(byTime.entries())
      .sort(([a], [b]) => a - b)
      .map(([, row]) => row);
  }, [series]);

  const stats = useMemo(
    () =>
      series.map((s, i) => {
        const values = s.metrics.map((m) => m.value);
        const now = values.length ? values[values.length - 1] : s.value;
        const min = values.length ? Math.min(...values) : null;
        const max = values.length ? Math.max(...values) : null;
        const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        return { id: s.id, description: s.description, unit: s.unit, color: COLORS[i % COLORS.length], now, min, max, avg };
      }),
    [series],
  );

  const gridColor = darkMode ? '#1e293b' : '#e2e8f0';
  const axisColor = darkMode ? '#64748b' : '#94a3b8';
  const isPercent = series.every((s) => s.unit === '%');

  if (!loading && series.length === 0) return null;

  return (
    <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2 text-slate-200">
          <BatteryCharging className="w-4 h-4 text-orange-400" /> {title}{series.length > 1 ? ` — ${series.length}` : ''}
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
        <div className="h-24 flex items-center justify-center text-slate-500 text-sm text-center px-4">
          Chưa có dữ liệu lịch sử trong khoảng thời gian này.
        </div>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" stroke={axisColor} fontSize={10} minTickGap={40} />
                <YAxis stroke={axisColor} fontSize={10} domain={isPercent ? [0, 100] : ['auto', 'auto']} unit={isPercent ? '%' : ''} />
                <Tooltip contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }} />
                {series.map((s, i) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.description}
                    stroke={COLORS[i % COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="font-medium py-1 pr-2">Cảm biến</th>
                  <th className="font-medium py-1 px-2 text-right">Hiện tại</th>
                  <th className="font-medium py-1 px-2 text-right">Nhỏ nhất</th>
                  <th className="font-medium py-1 px-2 text-right">Lớn nhất</th>
                  <th className="font-medium py-1 pl-2 text-right">Trung bình</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.id} className="border-t border-slate-700/40">
                    <td className="py-1 pr-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />
                        <span className="text-slate-200 truncate max-w-[220px]" title={s.description}>{s.description}</span>
                      </span>
                    </td>
                    <td className="py-1 px-2 text-right text-slate-100">{fmtVal(s.now, s.unit)}</td>
                    <td className="py-1 px-2 text-right text-slate-400">{fmtVal(s.min, s.unit)}</td>
                    <td className="py-1 px-2 text-right text-amber-400">{fmtVal(s.max, s.unit)}</td>
                    <td className="py-1 pl-2 text-right text-slate-300">{fmtVal(s.avg, s.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
