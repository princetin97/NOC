import React, { useEffect, useState } from 'react';
import { Activity, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { PollerHealth as PollerHealthData } from '../types';

interface PollerHealthProps {
  darkMode: boolean;
}

export const PollerHealth: React.FC<PollerHealthProps> = ({ darkMode }) => {
  const [data, setData] = useState<PollerHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = () => {
      api.pollerHealth
        .get()
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const card = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const totalFailed = data?.queues.reduce((sum, q) => sum + q.failed, 0) ?? 0;
  const totalWaiting = data?.queues.reduce((sum, q) => sum + q.waiting, 0) ?? 0;
  const healthy = data && data.devices.stale === 0 && totalFailed === 0;

  return (
    <div className={`rounded-xl border ${card} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" /> Sức khỏe Hệ thống Polling
        </h3>
        {!loading && !error && (
          healthy ? (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Bình thường
            </span>
          ) : (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Cần chú ý
            </span>
          )
        )}
      </div>

      {loading ? (
        <div className="h-20 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : error || !data ? (
        <div className="text-sm text-red-400">Không lấy được trạng thái poller.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Thiết bị" value={data.devices.total} darkMode={darkMode} />
            <Stat label="Đang chờ poll" value={totalWaiting} darkMode={darkMode} />
            <Stat label="Job lỗi" value={totalFailed} danger={totalFailed > 0} darkMode={darkMode} />
            <Stat label="Poll trễ (>5p)" value={data.devices.stale} danger={data.devices.stale > 0} darkMode={darkMode} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="py-1.5 pr-3">Hàng đợi</th>
                  <th className="py-1.5 px-2 text-center">Chờ</th>
                  <th className="py-1.5 px-2 text-center">Đang chạy</th>
                  <th className="py-1.5 px-2 text-center">Hoàn tất</th>
                  <th className="py-1.5 px-2 text-center">Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {data.queues.map((q) => (
                  <tr key={q.name} className="border-b border-slate-800/50">
                    <td className="py-1.5 pr-3 font-mono text-slate-300">{q.name}</td>
                    <td className="py-1.5 px-2 text-center">{q.waiting}</td>
                    <td className="py-1.5 px-2 text-center text-cyan-400">{q.active}</td>
                    <td className="py-1.5 px-2 text-center text-emerald-400">{q.completed}</td>
                    <td className={`py-1.5 px-2 text-center ${q.failed > 0 ? 'text-red-400 font-bold' : ''}`}>{q.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.devices.lastPolledAt && (
            <p className="text-[11px] text-slate-500 mt-2">
              Lần poll gần nhất: {new Date(data.devices.lastPolledAt).toLocaleString('vi-VN')}
            </p>
          )}
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; danger?: boolean; darkMode: boolean }> = ({ label, value, danger }) => (
  <div className="p-3 rounded-lg border bg-slate-800/40 border-slate-700/60 text-center">
    <p className={`text-2xl font-black ${danger ? 'text-red-400' : 'text-emerald-400'}`}>{value}</p>
    <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">{label}</p>
  </div>
);
