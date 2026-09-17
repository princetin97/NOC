import React from 'react';
import { NetworkDevice, NetworkAlert } from '../types';
import { X, Download, FileText, FileSpreadsheet, Check } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: NetworkDevice[];
  alerts: NetworkAlert[];
  darkMode: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  devices,
  alerts,
  darkMode,
}) => {
  if (!isOpen) return null;

  const downloadJSON = () => {
    const data = {
      exportTime: new Date().toISOString(),
      system: 'NOC Network Monitoring',
      totalDevices: devices.length,
      devices,
      alerts,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NOC_Report_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    let csv = 'Device Name,IP Address,Vendor,Model,Status,CPU %,RAM %,Ping ms,Uptime\n';
    devices.forEach((d) => {
      csv += `"${d.name}","${d.ip}","${d.vendor}","${d.model}","${d.status}",${d.cpuUsage},${d.memoryUsage},${d.pingLatencyMs},"${d.uptime}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NOC_Devices_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full max-w-md p-6 rounded-2xl border font-mono shadow-2xl ${
        darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-emerald-400 flex items-center space-x-2">
            <Download className="w-5 h-5" />
            <span>Xuất Báo Cáo Hạ Tầng Mạng</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          <p className="text-slate-300">
            Tải dữ liệu giám sát NOC bao gồm danh sách {devices.length} thiết bị, thông số băng thông SNMP và {alerts.length} lịch sử cảnh báo.
          </p>

          <div className="space-y-2">
            <button
              onClick={downloadCSV}
              className="w-full p-3 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold flex items-center justify-between transition-colors"
            >
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <span>Xuất file Excel / CSV (.csv)</span>
              </div>
              <span className="text-[10px] text-slate-400">Danh sách thiết bị</span>
            </button>

            <button
              onClick={downloadJSON}
              className="w-full p-3 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold flex items-center justify-between transition-colors"
            >
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-cyan-400" />
                <span>Xuất file Cấu hình JSON (.json)</span>
              </div>
              <span className="text-[10px] text-slate-400">Đầy đủ telemetry & alert</span>
            </button>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-700 text-slate-300"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
