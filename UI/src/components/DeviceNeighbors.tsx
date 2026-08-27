import React, { useEffect, useState } from 'react';
import { Share2, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { DeviceNeighbor } from '../types';

interface DeviceNeighborsProps {
  deviceId: string;
  darkMode: boolean;
}

export const DeviceNeighbors: React.FC<DeviceNeighborsProps> = ({ deviceId }) => {
  const [neighbors, setNeighbors] = useState<DeviceNeighbor[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.deviceNeighbors
      .list(deviceId)
      .then(setNeighbors)
      .catch(() => setNeighbors([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [deviceId]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Share2 className="w-4 h-4 text-indigo-400" /> Thiết bị lân cận (LLDP/CDP)
        </h3>
        <button onClick={load} className="text-slate-400 hover:text-slate-200" title="Làm mới">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="h-16 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : neighbors.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa phát hiện thiết bị lân cận. Đảm bảo thiết bị bật LLDP/CDP.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-1.5 pr-3">Cổng local</th>
                <th className="py-1.5 px-2">Thiết bị lân cận</th>
                <th className="py-1.5 px-2">Cổng remote</th>
                <th className="py-1.5 px-2 text-center">Giao thức</th>
              </tr>
            </thead>
            <tbody>
              {neighbors.map((n) => (
                <tr key={n.id} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3 font-mono text-emerald-400">{n.localPortName}</td>
                  <td className="py-1.5 px-2 text-slate-200">
                    {n.remoteSysName || n.remoteChassisId || '—'}
                    {n.remotePortDescr && <span className="text-slate-500"> ({n.remotePortDescr})</span>}
                  </td>
                  <td className="py-1.5 px-2 font-mono text-slate-300">{n.remotePortId || '—'}</td>
                  <td className="py-1.5 px-2 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300">
                      {n.protocol}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
