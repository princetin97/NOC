import React, { useEffect, useState } from 'react';
import { FileText, Loader2, Download, Save, X, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { ConfigBackupMeta } from '../types';

interface DeviceConfigBackupProps {
  deviceId: string;
  deviceName: string;
  darkMode: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DeviceConfigBackup: React.FC<DeviceConfigBackupProps> = ({ deviceId, deviceName }) => {
  const [backups, setBackups] = useState<ConfigBackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; content: string } | null>(null);

  const load = () => {
    setLoading(true);
    api.configBackups
      .list(deviceId)
      .then(setBackups)
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [deviceId]);

  const runBackup = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.configBackups.create(deviceId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sao lưu thất bại');
    } finally {
      setRunning(false);
    }
  };

  const viewBackup = async (id: string) => {
    const full = await api.configBackups.get(deviceId, id);
    setViewing({ id, content: full.content });
  };

  const downloadBackup = async (id: string, createdAt: string) => {
    const full = await api.configBackups.get(deviceId, id);
    const blob = new Blob([full.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deviceName}-${createdAt.slice(0, 19).replace(/[:T]/g, '-')}.cfg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-400" /> Sao lưu Cấu hình (SSH)
        </h3>
        <button
          onClick={runBackup}
          disabled={running}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50 flex items-center gap-1.5"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Sao lưu ngay
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading ? (
        <div className="h-16 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : backups.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có bản sao lưu nào. Cần cấu hình thông tin SSH cho thiết bị.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-1.5 pr-3">Thời gian</th>
                <th className="py-1.5 px-2 text-center">Trạng thái</th>
                <th className="py-1.5 px-2 text-right">Kích thước</th>
                <th className="py-1.5 px-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3 text-slate-300">{new Date(b.createdAt).toLocaleString('vi-VN')}</td>
                  <td className="py-1.5 px-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        b.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {b.status === 'success' ? 'Thành công' : 'Lỗi'}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-slate-400">{formatBytes(b.sizeBytes)}</td>
                  <td className="py-1.5 px-2 text-right">
                    {b.status === 'success' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => viewBackup(b.id)} className="text-cyan-400 hover:underline">Xem</button>
                        <button onClick={() => downloadBackup(b.id, b.createdAt)} className="text-slate-400 hover:text-slate-200" title="Tải xuống">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-red-400/70" title={b.errorMessage ?? ''}>{b.errorMessage?.slice(0, 30)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setViewing(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-slate-800">
              <h4 className="font-bold text-sm">Cấu hình thiết bị {deviceName}</h4>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="p-4 overflow-auto text-xs font-mono text-slate-300 whitespace-pre">{viewing.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
