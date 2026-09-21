import React, { useState, useEffect, useMemo } from 'react';
import { NetworkDevice, DeviceGroup, SiteInfo } from '../types';
import { X, Server, Check, Sparkles } from 'lucide-react';
import { api } from '../services/api';

export interface NewDeviceExtra {
  groupId?: string;
  pingOnly?: boolean;
  siteId?: string | null;
}

interface AddDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddDevice: (device: NetworkDevice, extra?: NewDeviceExtra) => void;
  darkMode: boolean;
  sites?: SiteInfo[];
  selectedSiteId?: string | null;
}

export const AddDeviceModal: React.FC<AddDeviceModalProps> = ({
  isOpen,
  onClose,
  onAddDevice,
  darkMode,
  sites = [],
  selectedSiteId = null,
}) => {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [location, setLocation] = useState('Datacenter Hanoi - Rack 02');
  const [adminNote, setAdminNote] = useState('');
  const [snmpVersion, setSnmpVersion] = useState<'v1' | 'v2c' | 'v3'>('v2c');
  const [community, setCommunity] = useState('public_ro');
  const [pingOnly, setPingOnly] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [siteId, setSiteId] = useState<string>(selectedSiteId ?? '');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    api.deviceGroups.list(siteId || null).then(setGroups).catch(() => setGroups([]));
  }, [isOpen, siteId]);

  useEffect(() => {
    if (!isOpen) return;
    setSiteId(selectedSiteId ?? '');
    setGroupId('');
  }, [isOpen, selectedSiteId]);

  const groupOptions = useMemo(() => {
    const childrenByParent = new Map<string, DeviceGroup[]>();
    for (const g of groups) {
      const key = g.parentId ?? '__root__';
      const list = childrenByParent.get(key) ?? [];
      list.push(g);
      childrenByParent.set(key, list);
    }
    for (const list of childrenByParent.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    const out: Array<{ id: string; label: string }> = [];
    const walk = (parentId: string, depth: number) => {
      const list = childrenByParent.get(parentId) ?? [];
      for (const g of list) {
        out.push({ id: g.id, label: `${depth > 0 ? `${'  '.repeat(depth)}↳ ` : ''}${g.name}` });
        walk(g.id, depth + 1);
      }
    };
    walk('__root__', 0);
    return out;
  }, [groups]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !ip) return;

    const newDevice: NetworkDevice = {
      id: `dev-${Date.now()}`,
      name,
      hostname: `${name.toLowerCase().replace(/\s+/g, '-')}.net`,
      ip,
      type: 'server',
      vendor: 'Đang nhận diện...',
      model: 'Đang nhận diện...',
      os: 'Đang nhận diện...',
      sysObjectID: '.1.3.6.1.4.1.9.1.1001',
      location,
      adminNote,
      rack: 'Rack 02B (U15)',
      status: 'up',
      uptime: '0 ngày, 00:01:00',
      uptimeSeconds: 60,
      snmpVersion,
      community,
      cpuUsage: Math.floor(15 + Math.random() * 30),
      memoryUsage: Math.floor(30 + Math.random() * 30),
      temperature: 33,
      pingLatencyMs: Number((0.8 + Math.random() * 2).toFixed(1)),
      packetLoss: 0,
      interfacesCount: 4,
      lastPolled: 'Vừa thêm',
      interfaces: [
        {
          id: `if-${Date.now()}-1`,
          name: 'GigabitEthernet0/0/1',
          description: 'Uplink Core Interface',
          type: 'ethernetCsmacd',
          speed: '1 Gbps',
          speedBps: 1000000000,
          adminStatus: 'up',
          operStatus: 'up',
          macAddress: '00:1c:58:11:22:33',
          ipAddress: ip,
          inRateBps: 120000000,
          outRateBps: 89000000,
          inErrors: 0,
          outErrors: 0,
          inDiscards: 0,
          outDiscards: 0,
          utilization: 24,
          history: Array.from({ length: 12 }, () => ({ time: '0m', inRateKbps: 120000, outRateKbps: 89000 })),
        },
      ],
    };

    onAddDevice(newDevice, {
      groupId: groupId || undefined,
      pingOnly,
      siteId: siteId || null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full max-w-lg p-6 rounded-2xl border font-mono shadow-2xl ${
        darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-emerald-400 flex items-center space-x-2">
            <Server className="w-5 h-5" />
            <span>Thêm Thiết Bị SNMP Polling Mới</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Tên Thiết Bị (Hostname / Tag):</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Core-Switch-HCM-02"
              className={`w-full p-2.5 rounded-lg border focus:ring-1 focus:ring-emerald-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Địa chỉ IP Management:</label>
            <input
              type="text"
              required
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="10.200.1.20"
              className={`w-full p-2.5 rounded-lg border focus:ring-1 focus:ring-emerald-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            />
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-emerald-700/40 bg-emerald-900/20 text-[11px] text-emerald-300">
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Loại thiết bị và hãng sản xuất sẽ được <b>tự động nhận diện</b> qua SNMP (sysDescr / sysObjectID / ENTITY-MIB / UPS-MIB) ngay sau khi thêm. Nếu thiết bị chưa bật SNMP, có thể chọn chế độ Ping-only bên dưới.
            </span>
          </div>

          <label className="flex items-center gap-2 text-slate-300">
            <input
              type="checkbox"
              checked={pingOnly}
              onChange={(e) => setPingOnly(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>Monitor Ping-only (không dùng SNMP)</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">SNMP Version:</label>
              <select
                value={snmpVersion}
                onChange={(e) => setSnmpVersion(e.target.value as 'v1' | 'v2c' | 'v3')}
                disabled={pingOnly}
                className={`w-full p-2 rounded-lg border ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                }`}
              >
                <option value="v2c">SNMP v2c (Community)</option>
                <option value="v1">SNMP v1 (Community)</option>
                <option value="v3">SNMP v3 (USM Security)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Community String:</label>
              <input
                type="text"
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                disabled={pingOnly}
                className={`w-full p-2 rounded-lg border ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Vị trí Lắp đặt / Datacenter:</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={`w-full p-2 rounded-lg border ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Ghi chú quản trị (địa chỉ truy cập, tài khoản, lưu ý):</label>
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={3}
              placeholder="Ví dụ: https://10.0.0.10:8443 | user: noc-admin | liên hệ: ca trực NOC"
              className={`w-full p-2 rounded-lg border resize-y ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Trụ sở:</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className={`w-full p-2 rounded-lg border ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            >
              <option value="">(Chưa gán trụ sở)</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Nhóm thiết bị:</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className={`w-full p-2 rounded-lg border ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            >
              <option value="">(Không thuộc nhóm)</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              {pingOnly ? 'Lưu & Bắt đầu Ping Monitor' : 'Lưu & Bắt đầu SNMP Poll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
