import React from 'react';
import { LayoutDashboard, Server, ShieldAlert, GitFork, Cpu, Settings, ScrollText, Cloud } from 'lucide-react';

export type TabType = 'overview' | 'devices' | 'alerts' | 'syslog' | 'topology' | 'services' | 'virtualization' | 'settings';

interface NavigationProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  darkMode: boolean;
  deviceCount: number;
  activeAlertCount: number;
  criticalAlertCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  darkMode,
  deviceCount,
  activeAlertCount,
  criticalAlertCount,
}) => {
  const tabs = [
    {
      id: 'overview' as TabType,
      label: 'Bảng điều khiển NOC',
      icon: LayoutDashboard,
    },
    {
      id: 'devices' as TabType,
      label: 'Thiết bị',
      icon: Server,
      badge: deviceCount,
    },
    {
      id: 'alerts' as TabType,
      label: 'Trung tâm Cảnh báo',
      icon: ShieldAlert,
      badge: activeAlertCount,
      isCritical: criticalAlertCount > 0,
    },
    {
      id: 'syslog' as TabType,
      label: 'SNMP Trap',
      icon: ScrollText,
    },
    {
      id: 'topology' as TabType,
      label: 'Sơ đồ Mạng & Rack',
      icon: GitFork,
    },
    {
      id: 'services' as TabType,
      label: 'Giám sát Dịch vụ',
      icon: Cpu,
    },
    {
      id: 'virtualization' as TabType,
      label: 'VMware vCenter',
      icon: Cloud,
    },
    {
      id: 'settings' as TabType,
      label: 'Cài đặt hệ thống chung',
      icon: Settings,
    },
  ];

  return (
    <nav className={`border-b transition-colors overflow-x-auto scrollbar-none ${
      darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50 border-slate-200'
    }`}>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-1 sm:space-x-2 py-2 min-w-max">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                  isActive
                    ? darkMode
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'bg-emerald-600 text-white shadow-sm'
                    : darkMode
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                } ${tab.highlight && !isActive ? 'text-amber-400 border border-amber-500/30 bg-amber-500/5' : ''}`}
              >
                <Icon className={`w-4 h-4 ${tab.highlight && !isActive ? 'text-amber-400 animate-pulse' : ''}`} />
                <span>{tab.label}</span>

                {tab.badge !== undefined && (
                  <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                    tab.isCritical
                      ? 'bg-red-500 text-white animate-pulse'
                      : isActive
                      ? darkMode ? 'bg-emerald-500/40 text-emerald-200' : 'bg-white/30 text-white'
                      : darkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
