import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, Cpu } from 'lucide-react';
import { api } from '../services/api';
import { ProcessorSeries } from '../types';

interface ProcessorsPanelProps {
  deviceId: string;
  darkMode: boolean;
}

const RANGES = [
  { label: '1 giờ', hours: 1 },
  { label: '6 giờ', hours: 6 },
  { label: '24 giờ', hours: 24 },
  { label: '7 ngày', hours: 168 },
];

// Distinct line colours per processor (LibreNMS-style multi-CPU graph).
const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6'];

const fmtPct = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? 'N/A' : `${Math.round(v * 100) / 100}%`;

export const ProcessorsPanel: React.FC<ProcessorsPanelProps> = ({ deviceId, darkMode }) => {
  const [hours, setHours] = useState(6);
  const [series, setSeries] = useState<ProcessorSeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.devices
      .processorMetrics(deviceId, hours)
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
  }, [deviceId, hours]);

  // Merge all processors' samples onto a shared time axis (they share poll timestamps).
  // Keyed by actual epoch ms (not the formatted label) and sorted afterwards, since
  // looping per-processor then per-sample only preserves insertion order within each
  // processor — concatenating processors with different time coverage otherwise makes
  // the merged array jump backwards in time wherever one processor's history begins.
  const chartData = useMemo(() => {
    const byTime = new Map<number, Record<string, number | string>>();
    for (const p of series) {
      for (const m of p.metrics) {
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
        row[p.id] = Math.round(m.usage);
        byTime.set(ts, row);
      }
    }
    return Array.from(byTime.entries())
      .sort(([a], [b]) => a - b)
      .map(([, row]) => row);
  }, [series]);

  // Now / Min / Max / Avg per processor for the legend table.
  const stats = useMemo(
    () =>
      series.map((p, i) => {
        const values = p.metrics.map((m) => m.usage);
        const now = values.length ? values[values.length - 1] : p.usage;
        const min = values.length ? Math.min(...values) : null;
        const max = values.length ? Math.max(...values) : null;
        const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        return { id: p.id, description: p.description, color: COLORS[i % COLORS.length], now, min, max, avg };
      }),
    [series],
  );

  const gridColor = darkMode ? '#1e293b' : '#e2e8f0';
  const axisColor = darkMode ? '#64748b' : '#94a3b8';

  return (
    <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2 text-slate-200">
          <Cpu className="w-4 h-4 text-emerald-400" /> Bộ xử lý (Processor){series.length > 0 ? ` — ${series.length}` : ''}
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
      ) : series.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-slate-500 text-sm text-center px-4">
          Chưa phát hiện bộ xử lý qua SNMP. Nhấn "Quét SNMP" và chờ một chu kỳ thu thập.
        </div>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" stroke={axisColor} fontSize={10} minTickGap={40} />
                <YAxis stroke={axisColor} fontSize={10} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }} />
                {series.map((p, i) => (
                  <Line
                    key={p.id}
                    type="monotone"
                    dataKey={p.id}
                    name={p.description}
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

          {/* Now / Min / Max / Avg legend table (LibreNMS parity). */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="font-medium py-1 pr-2">Tải %</th>
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
                    <td className="py-1 px-2 text-right text-slate-100">{fmtPct(s.now)}</td>
                    <td className="py-1 px-2 text-right text-slate-400">{fmtPct(s.min)}</td>
                    <td className="py-1 px-2 text-right text-amber-400">{fmtPct(s.max)}</td>
                    <td className="py-1 pl-2 text-right text-slate-300">{fmtPct(s.avg)}</td>
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
