import React, { useEffect, useMemo, useState } from 'react';
import { X, Radar, Loader2, Check } from 'lucide-react';
import { api } from '../services/api';
import { DeviceGroup, SiteInfo, SubnetScanResult } from '../types';

interface ScanSubnetModalProps {
  isOpen: boolean;
  darkMode: boolean;
  sites: SiteInfo[];
  defaultSiteId?: string | null;
  allowAllSitesOption?: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export const ScanSubnetModal: React.FC<ScanSubnetModalProps> = ({
  isOpen,
  darkMode,
  sites,
  defaultSiteId = null,
  allowAllSitesOption = true,
  onClose,
  onAdded,
}) => {
  const [subnet, setSubnet] = useState('192.168.1.0/24');
  const [snmpVersion, setSnmpVersion] = useState<'v1' | 'v2c' | 'v3'>('v2c');
  const [community, setCommunity] = useState('public');
  const [siteId, setSiteId] = useState<string>(defaultSiteId ?? '');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SubnetScanResult[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen) return;
    setSiteId(defaultSiteId ?? '');
    setGroupId('');
  }, [isOpen, defaultSiteId]);

  useEffect(() => {
    if (!isOpen) return;
    api.deviceGroups.list(siteId || null).then(setGroups).catch(() => setGroups([]));
  }, [isOpen, siteId]);

  useEffect(() => {
    if (!groupId) return;
    if (!groups.some((g) => g.id === groupId)) setGroupId('');
  }, [groups, groupId]);

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

  const inputCls = `w-full p-2 rounded-lg border text-sm ${
    darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
  }`;

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setResults(null);
    setSelected({});
    try {
      const found = await api.devices.scanSubnet({ subnet, snmpVersion, snmpCommunity: community });
      setResults(found);
      const preselect: Record<string, boolean> = {};
      found.forEach((r) => {
        if (!r.alreadyAdded) preselect[r.ip] = true;
      });
      setSelected(preselect);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = (err as Error).message || 'Quét thất bại';
      if (status === 502 || status === 504) {
        setError(`${message} (máy chủ quét không phản hồi ổn định). Hãy thử dải nhỏ hơn, ví dụ /28 hoặc /29.`);
      } else {
        setError(message);
      }
    } finally {
      setScanning(false);
    }
  };

  const handleAddSelected = async () => {
    if (!results) return;
    const toAdd = results
      .filter((r) => selected[r.ip] && !r.alreadyAdded)
      .map((r) => ({
        name: r.sysName || r.ip,
        ip: r.ip,
        siteId: siteId || null,
        groupId: groupId || null,
        snmpVersion,
        snmpCommunity: community,
        pingOnly: !r.snmpAlive,
      }));
    if (toAdd.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      await api.devices.bulkAdd(toAdd);
      onAdded();
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Thêm thiết bị thất bại');
    } finally {
      setAdding(false);
    }
  };

  const selectedCount = results ? results.filter((r) => selected[r.ip] && !r.alreadyAdded).length : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6 rounded-2xl border font-mono shadow-2xl ${
          darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-emerald-400 flex items-center space-x-2">
            <Radar className="w-4 h-4" /> <span>Quét Dải Mạng (Subnet Scan)</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-slate-400 mb-1">Dải mạng (CIDR):</label>
              <input type="text" value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.1.0/24" className={inputCls} />
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
            <div>
              <label className="block text-slate-400 mb-1">Trụ sở gán cho thiết bị quét:</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputCls}>
                {allowAllSitesOption && <option value="">(Chưa gán trụ sở)</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Nhóm gán cho thiết bị quét:</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputCls}>
                <option value="">(Không thuộc nhóm)</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleScan}
            disabled={scanning}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-2"
          >
            {scanning ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang quét...</> : <><Radar className="w-4 h-4" /> Bắt đầu quét</>}
          </button>

          {error && <p className="text-red-400 text-xs">{error}</p>}
          {scanning && <p className="text-slate-400 text-[11px]">Đang quét theo ping + SNMP trong dải mạng, vui lòng chờ...</p>}

          {results && (
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 font-bold">Tìm thấy {results.length} host phản hồi (ping hoặc SNMP)</span>
                <span className="text-emerald-400">Đã chọn: {selectedCount}</span>
              </div>

              {results.length === 0 ? (
                <p className="text-slate-500 text-center py-6">Không có host nào phản hồi. Kiểm tra lại dải mạng/kết nối.</p>
              ) : (
                <div className="border rounded-xl border-slate-800 overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-800/80 text-slate-400 sticky top-0">
                      <tr>
                        <th className="py-2 px-3 w-8"></th>
                        <th className="py-2 px-3">IP</th>
                        <th className="py-2 px-3">Phát hiện</th>
                        <th className="py-2 px-3">Tên hệ thống (sysName)</th>
                        <th className="py-2 px-3">Mô tả (sysDescr)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {results.map((r) => (
                        <tr key={r.ip} className={r.alreadyAdded ? 'opacity-40' : 'hover:bg-slate-800/50'}>
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              disabled={r.alreadyAdded}
                              checked={!!selected[r.ip] && !r.alreadyAdded}
                              onChange={(e) => setSelected((s) => ({ ...s, [r.ip]: e.target.checked }))}
                              className="w-4 h-4 accent-emerald-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3 text-emerald-400 font-bold">{r.ip}</td>
                          <td className="py-2 px-3 text-slate-300">
                            {r.snmpAlive ? (
                              <span className="text-cyan-400">SNMP</span>
                            ) : (
                              <span className="text-amber-400">Ping-only</span>
                            )}
                            {r.pingAlive && (
                              <span className="ml-1 text-[10px] text-slate-500">({r.pingLatencyMs ?? '—'} ms)</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-200">
                            {r.sysName || '—'}
                            {r.alreadyAdded && <span className="ml-2 text-[9px] text-amber-400">(đã có)</span>}
                          </td>
                          <td className="py-2 px-3 text-slate-400 truncate max-w-[220px]" title={r.sysDescr || ''}>{r.sysDescr || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {results.length > 0 && (
                <button
                  onClick={handleAddSelected}
                  disabled={adding || selectedCount === 0}
                  className="mt-3 w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2"
                >
                  {adding ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang thêm...</> : <><Check className="w-4 h-4" /> Thêm {selectedCount} thiết bị đã chọn</>}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
