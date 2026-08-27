import React, { useState } from 'react';
import { NetworkDevice, NetworkInterface } from '../types';
import { Cable, Search, Filter, ArrowDownLeft, ArrowUpRight, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';

interface InterfaceListProps {
  devices: NetworkDevice[];
  darkMode: boolean;
  onTogglePortAdminStatus?: (deviceId: string, portId: string) => void;
}

export const InterfaceList: React.FC<InterfaceListProps> = ({
  devices,
  darkMode,
  onTogglePortAdminStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [speedFilter, setSpeedFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [utilizationFilter, setUtilizationFilter] = useState('all');

  // Flatten all interfaces with parent device info
  const allInterfaces: { device: NetworkDevice; port: NetworkInterface }[] = [];
  devices.forEach((dev) => {
    dev.interfaces.forEach((port) => {
      allInterfaces.push({ device: dev, port });
    });
  });

  // Filter logic
  const filtered = allInterfaces.filter(({ device, port }) => {
    const matchesSearch =
      port.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      port.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      device.ip.includes(searchQuery) ||
      (port.macAddress && port.macAddress.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesSpeed = speedFilter === 'all' || port.speed.includes(speedFilter);
    const matchesStatus = statusFilter === 'all' || port.operStatus === statusFilter;
    const matchesUtil =
      utilizationFilter === 'all' ||
      (utilizationFilter === 'high' && port.utilization >= 75) ||
      (utilizationFilter === 'medium' && port.utilization >= 40 && port.utilization < 75) ||
      (utilizationFilter === 'low' && port.utilization < 40);

    return matchesSearch && matchesSpeed && matchesStatus && matchesUtil;
  });

  const totalPorts = allInterfaces.length;
  const upPorts = allInterfaces.filter((i) => i.port.operStatus === 'up').length;
  const downPorts = allInterfaces.filter((i) => i.port.operStatus === 'down').length;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`p-4 rounded-xl border flex items-center justify-between ${
          darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase font-mono">Tổng số Cổng SNMP</span>
            <p className="text-2xl font-black font-mono text-slate-100 mt-1">{totalPorts}</p>
          </div>
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
            <Cable className="w-6 h-6" />
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center justify-between ${
          darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase font-mono">Cổng Đang Hoạt động (UP)</span>
            <p className="text-2xl font-black font-mono text-emerald-400 mt-1">{upPorts}</p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center justify-between ${
          darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase font-mono">Cổng Mất Kết Nối (DOWN)</span>
            <p className="text-2xl font-black font-mono text-red-400 mt-1">{downPorts}</p>
          </div>
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 ${
        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm cổng (TenGigE, ge-0/0/0, eth0, VLAN, MAC)..."
              className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />
          </div>

          <select
            value={speedFilter}
            onChange={(e) => setSpeedFilter(e.target.value)}
            className={`text-xs py-1.5 px-3 rounded-lg border font-mono cursor-pointer ${
              darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="all">Băng thông: Tất cả</option>
            <option value="1 Gbps">1 Gbps</option>
            <option value="10 Gbps">10 Gbps</option>
            <option value="25 Gbps">25 Gbps</option>
            <option value="100 Gbps">100 Gbps</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`text-xs py-1.5 px-3 rounded-lg border font-mono cursor-pointer ${
              darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="all">Trạng thái cổng: Tất cả</option>
            <option value="up">● Cổng UP</option>
            <option value="down">■ Cổng DOWN</option>
          </select>

          <select
            value={utilizationFilter}
            onChange={(e) => setUtilizationFilter(e.target.value)}
            className={`text-xs py-1.5 px-3 rounded-lg border font-mono cursor-pointer ${
              darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="all">Mức tải cổng: Tất cả</option>
            <option value="high">Cao (&gt;75%)</option>
            <option value="medium">Trung bình (40% - 75%)</option>
            <option value="low">Thấp (&lt;40%)</option>
          </select>
        </div>
      </div>

      {/* Main Interfaces Table */}
      <div className={`p-4 rounded-xl border overflow-x-auto ${
        darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className={`border-b text-slate-400 ${darkMode ? 'border-slate-800 bg-slate-800/40' : 'border-slate-200 bg-slate-50'}`}>
              <th className="py-3 px-3">Thiết bị Nguồn</th>
              <th className="py-3 px-3">Tên Cổng</th>
              <th className="py-3 px-3">Mô tả Cổng (IfAlias)</th>
              <th className="py-3 px-3">VLAN</th>
              <th className="py-3 px-3">Băng thông</th>
              <th className="py-3 px-3 text-emerald-400">Rate In (Mbps)</th>
              <th className="py-3 px-3 text-cyan-400">Rate Out (Mbps)</th>
              <th className="py-3 px-3">Tải Cổng (%)</th>
              <th className="py-3 px-3">Discards / Errors</th>
              <th className="py-3 px-3 text-right">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filtered.map(({ device, port }) => {
              const inMbps = (port.inRateBps / 1e6).toFixed(1);
              const outMbps = (port.outRateBps / 1e6).toFixed(1);

              return (
                <tr key={`${device.id}-${port.id}`} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-3 font-semibold text-slate-200">
                    <div>{device.name}</div>
                    <div className="text-[10px] text-slate-500">{device.ip}</div>
                  </td>
                  <td className="py-3 px-3 font-bold text-emerald-400">{port.name}</td>
                  <td className="py-3 px-3 text-slate-300 max-w-xs truncate">{port.description || 'N/A'}</td>
                  <td className="py-3 px-3 text-slate-300">{port.vlan ?? '—'}</td>
                  <td className="py-3 px-3 text-slate-300">{port.speed}</td>
                  <td className="py-3 px-3 font-bold text-emerald-400">{inMbps} Mbps</td>
                  <td className="py-3 px-3 font-bold text-cyan-400">{outMbps} Mbps</td>
                  <td className="py-3 px-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-16 bg-slate-700 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            port.utilization > 75 ? 'bg-red-500' : port.utilization > 40 ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                          style={{ width: `${port.utilization}%` }}
                        ></div>
                      </div>
                      <span className="font-bold">{port.utilization}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-400">
                    <span className={port.inErrors > 0 || port.outErrors > 0 ? 'text-red-400 font-bold' : ''}>
                      {port.inDiscards}/{port.inErrors}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase ${
                      port.operStatus === 'up' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {port.adminStatus}/{port.operStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
};
