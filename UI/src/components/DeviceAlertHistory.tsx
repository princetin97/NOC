import React, { useEffect, useState } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { NetworkAlert, AlertSeverity, AlertStatus } from '../types';

interface DeviceAlertHistoryProps {
  deviceId: string;
  darkMode: boolean;
}

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/40',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
  medium: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
  low: 'bg-sky-500/20 text-sky-400 border border-sky-500/40',
};

const STATUS_LABEL: Record<AlertStatus, string> = {
  active: 'Đang hoạt động',
  acknowledged: 'Đã xác nhận',
  resolved: 'Đã khắc phục',
};

export const DeviceAlertHistory: React.FC<DeviceAlertHistoryProps> = ({ deviceId }) => {
  const [alerts, setAlerts] = useState<NetworkAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.devices
      .alertHistory(deviceId)
      .then(setAlerts)
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [deviceId]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-rose-400" /> Lịch sử cảnh báo (30 ngày gần nhất)
        </h3>
        <button onClick={load} className="text-slate-400 hover:text-slate-200" title="Làm mới">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="h-16 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-slate-500">Không có cảnh báo nào trong 30 ngày gần nhất.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-1.5 pr-3">Thời điểm</th>
                <th className="py-1.5 px-2">Mức độ</th>
                <th className="py-1.5 px-2">Nội dung</th>
                <th className="py-1.5 px-2">Quy tắc</th>
                <th className="py-1.5 px-2">Trạng thái</th>
                <th className="py-1.5 px-2">Khắc phục lúc</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3 font-mono text-slate-300 whitespace-nowrap">{a.timestamp}</td>
                  <td className="py-1.5 px-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${SEVERITY_BADGE[a.severity]}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-slate-200">
                    {a.message}
                    {a.interfaceName && <span className="text-slate-500"> ({a.interfaceName})</span>}
                  </td>
                  <td className="py-1.5 px-2 text-slate-400">{a.ruleName}</td>
                  <td className="py-1.5 px-2 text-slate-300">{STATUS_LABEL[a.status]}</td>
                  <td className="py-1.5 px-2 font-mono text-slate-400 whitespace-nowrap">{a.resolvedAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
