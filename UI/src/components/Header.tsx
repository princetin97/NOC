import React from 'react';
import { Volume2, VolumeX, RefreshCw, LogOut } from 'lucide-react';
import { AlertSeverity } from '../types';

interface HeaderProps {
  darkMode: boolean;
  autoRefreshInterval: number; // in seconds, 0 = paused
  setAutoRefreshInterval: (val: number) => void;
  isSoundEnabled: boolean;
  setIsSoundEnabled: (val: boolean) => void;
  lastUpdatedTime: string;
  isPolling: boolean;
  onManualPoll: () => void;
  onLogout?: () => void;
  alertCountsBySeverity: Record<AlertSeverity, number>;
  onOpenAlertsBySeverity: (severity: AlertSeverity) => void;
  acknowledgedAlertCount: number;
  onOpenAcknowledgedAlerts: () => void;
  sites?: { id: string; name: string }[];
  selectedSiteId?: string | null;
  onChangeSite?: (siteId: string | null) => void;
  allowAllSitesOption?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  autoRefreshInterval,
  setAutoRefreshInterval,
  isSoundEnabled,
  setIsSoundEnabled,
  lastUpdatedTime,
  isPolling,
  onManualPoll,
  onLogout,
  alertCountsBySeverity,
  onOpenAlertsBySeverity,
  acknowledgedAlertCount,
  onOpenAcknowledgedAlerts,
  sites = [],
  selectedSiteId = null,
  onChangeSite,
  allowAllSitesOption = true,
}) => {
  const severityTiles: { key: AlertSeverity; label: string; className: string }[] = [
    { key: 'critical', label: 'C', className: 'bg-red-600 hover:bg-red-500' },
    { key: 'high', label: 'H', className: 'bg-orange-500 hover:bg-orange-400' },
    { key: 'medium', label: 'M', className: 'bg-amber-400 hover:bg-amber-300 text-slate-900' },
    { key: 'low', label: 'L', className: 'bg-blue-500 hover:bg-blue-400' },
  ];

  return (
    <header className={`border-b sticky top-0 z-40 transition-colors ${
      darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
    }`}>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Left logo and product title */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
              <img src="/logo-noc.png" alt="NOC logo" className="h-full w-full object-contain" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  NOC
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  v24.7
                </span>
              </div>
              <p className="text-xs text-slate-400">Hệ thống Giám sát Mạng & Hạ tầng Thời gian thực</p>
            </div>
            {/* Alert strip positioned next to brand block */}
            <div className="hidden xl:flex items-center ml-4">
              <div className="inline-flex items-center overflow-hidden rounded border border-slate-600/70 shadow-sm">
                {severityTiles.map((tile) => (
                  <button
                    key={tile.key}
                    onClick={() => onOpenAlertsBySeverity(tile.key)}
                    className={`px-3 py-1.5 text-xs font-bold font-mono text-white transition-colors border-r border-slate-900/40 ${tile.className}`}
                    title={`Mở cảnh báo mức ${tile.key}`}
                  >
                    {tile.label}: {alertCountsBySeverity[tile.key]}
                  </button>
                ))}
                <button
                  onClick={onOpenAcknowledgedAlerts}
                  className="px-3 py-1.5 text-xs font-bold font-mono text-white transition-colors bg-emerald-600 hover:bg-emerald-500"
                  title="Mở danh sách cảnh báo đã xác nhận"
                >
                  A: {acknowledgedAlertCount}
                </button>
              </div>
            </div>
          </div>

          {/* Right Controls & Status Pill */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            
            {/* Poller Status Indicator */}
            <div className={`hidden lg:flex items-center space-x-2 text-xs px-3 py-1 rounded-full border ${
              darkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`}></span>
              <span className="font-mono text-slate-300">SNMP Poller:</span>
              <span className="font-semibold text-emerald-400">{isPolling ? 'Đang quét...' : 'ONLINE'}</span>
              <span className="text-slate-500 text-[10px]">({lastUpdatedTime})</span>
              <button
                onClick={onManualPoll}
                title="Quét SNMP ngay lập tức"
                className="ml-1 text-slate-400 hover:text-emerald-400 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            </div>

            {/* Auto Refresh Select */}
            <div className="flex items-center space-x-1">
              {onChangeSite && (
                <select
                  value={selectedSiteId ?? ''}
                  onChange={(e) => onChangeSite(e.target.value || null)}
                  className={`text-xs py-1.5 px-2 rounded-lg border font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                    darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                  title="Lọc theo trụ sở"
                >
                  {allowAllSitesOption && <option value="">Tất cả trụ sở</option>}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className={`text-xs py-1.5 px-2 rounded-lg border font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'
                }`}
                title="Tần số tự động làm mới"
              >
                <option value={10}>Làm mới: 10s</option>
                <option value={30}>Làm mới: 30s</option>
                <option value={60}>Làm mới: 60s</option>
                <option value={300}>Làm mới: 5 phút</option>
                <option value={0}>Tạm dừng ⏸</option>
              </select>
            </div>

            {/* Sound Mute/Unmute */}
            <button
              onClick={() => setIsSoundEnabled(!isSoundEnabled)}
              title={isSoundEnabled ? 'Âm thanh cảnh báo: BẬT' : 'Âm thanh cảnh báo: TẮT'}
              className={`p-1.5 rounded-lg border transition-colors ${
                isSoundEnabled
                  ? darkMode
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : darkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-400'
                  : 'bg-slate-100 border-slate-300 text-slate-500'
              }`}
            >
              {isSoundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Logout */}
            {onLogout && (
              <button
                onClick={onLogout}
                title="Đăng xuất"
                className={`p-1.5 rounded-lg border transition-colors ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
