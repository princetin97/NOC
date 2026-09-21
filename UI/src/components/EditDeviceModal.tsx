import React, { useEffect, useMemo, useState } from 'react';
import { X, Pencil } from 'lucide-react';
import { NetworkDevice, DeviceGroup, SiteInfo } from '../types';
import { api, CreateDeviceInput } from '../services/api';

interface EditDeviceModalProps {
  device: NetworkDevice | null;
  darkMode: boolean;
  sites?: SiteInfo[];
  onClose: () => void;
  onSave: (id: string, patch: Partial<CreateDeviceInput>) => void;
}

export const EditDeviceModal: React.FC<EditDeviceModalProps> = ({ device, darkMode, sites = [], onClose, onSave }) => {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [location, setLocation] = useState('');
  const [rack, setRack] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [snmpVersion, setSnmpVersion] = useState<'v1' | 'v2c' | 'v3'>('v2c');
  const [community, setCommunity] = useState('');
  const [groupId, setGroupId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);

  useEffect(() => {
    if (device) {
      setName(device.name);
      setIp(device.ip);
      setLocation(device.location ?? '');
      setRack(device.rack ?? '');
      setAdminNote(device.adminNote ?? '');
      setSnmpVersion(device.snmpVersion);
      setCommunity(device.community ?? '');
      setGroupId(device.groupId ?? '');
      setSiteId(device.siteId ?? '');
    }
  }, [device]);

  useEffect(() => {
    if (!device) return;
    api.deviceGroups.list(siteId || null).then(setGroups).catch(() => setGroups([]));
  }, [device, siteId]);

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

  if (!device) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(device.id, {
      name,
      ip,
      location: location || undefined,
      rack: rack || undefined,
      adminNote: adminNote.trim() ? adminNote : null,
      siteId: siteId || null,
      snmpVersion,
      snmpCommunity: community || undefined,
      groupId: groupId || null,
    });
    onClose();
  };

  const inputCls = `w-full p-2 rounded-lg border text-sm ${
    darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
  }`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-lg p-6 rounded-2xl border font-mono shadow-2xl ${
          darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-cyan-400 flex items-center space-x-2">
            <Pencil className="w-4 h-4" /> <span>Sửa Thiết Bị</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs mt-4">
          <div>
            <label className="block text-slate-400 mb-1">Tên thiết bị:</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Địa chỉ IP:</label>
              <input type="text" value={ip} onChange={(e) => setIp(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Loại / Hãng (tự nhận diện):</label>
              <div className={`${inputCls} flex items-center gap-2 text-slate-300`} title="Nhận diện tự động qua SNMP">
                <span className="uppercase text-emerald-400">{device.type || '—'}</span>
                <span className="text-slate-500">/</span>
                <span className="truncate">{device.vendor || '—'}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Vị trí:</label>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Rack:</label>
              <input type="text" value={rack} onChange={(e) => setRack(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Ghi chú quản trị:</label>
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={3}
              placeholder="Địa chỉ truy cập, tài khoản quản trị, lưu ý vận hành..."
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Trụ sở:</label>
              <select
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  setGroupId('');
                }}
                className={inputCls}
              >
                <option value="">(Chưa gán trụ sở)</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Phiên bản SNMP:</label>
              <select value={snmpVersion} onChange={(e) => setSnmpVersion(e.target.value as 'v1' | 'v2c' | 'v3')} className={inputCls}>
                <option value="v1">v1</option>
                <option value="v2c">v2c</option>
                <option value="v3">v3</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Community:</label>
              <input type="text" value={community} onChange={(e) => setCommunity(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Nhóm:</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputCls}>
              <option value="">(Không thuộc nhóm)</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300">
              Hủy
            </button>
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold">
              Lưu thay đổi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
