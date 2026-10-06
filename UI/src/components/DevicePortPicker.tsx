// Shared device/port picker UI — same look & feel as the "Thêm quy tắc" (Add alert rule)
// form so every place that needs to pick a device or a port behaves consistently.
import React, { useState, useEffect } from 'react';
import { NetworkDevice } from '../types';
import { api } from '../services/api';
import { Server, Search, X, Check, Boxes } from 'lucide-react';

// --- Device picker: single-select with a text search over name/IP/vendor ---
interface DevicePickerModalProps {
  devices: NetworkDevice[];
  darkMode: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const DevicePickerModal: React.FC<DevicePickerModalProps> = ({ devices, darkMode, selectedId, onSelect, onClose }) => {
  const [q, setQ] = useState('');
  const filtered = devices.filter(
    (d) =>
      (d.name ?? '').toLowerCase().includes(q.toLowerCase()) ||
      (d.ip ?? '').includes(q) ||
      (d.vendor ?? '').toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><Server className="w-4 h-4 text-emerald-400" /> Chọn thiết bị</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo tên, IP, hãng..."
              className={`w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`}
            />
          </div>
        </div>
        <div className="px-3 pb-3 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500 p-3 text-center">Không có thiết bị phù hợp.</p>
          ) : (
            filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-colors ${
                  selectedId === d.id
                    ? 'bg-emerald-500/10 border-emerald-500/40'
                    : darkMode
                    ? 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{d.name}</div>
                  <div className="text-[11px] text-slate-400 font-mono truncate">{d.ip}{d.vendor ? ` • ${d.vendor}` : ''}</div>
                </div>
                {selectedId === d.id && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// --- Port picker: single-select with text + status filters ---
interface SinglePortPickerModalProps {
  device: NetworkDevice;
  darkMode: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const SinglePortPickerModal: React.FC<SinglePortPickerModalProps> = ({ device, darkMode, selectedId, onSelect, onClose }) => {
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down'>('all');

  const filtered = device.interfaces.filter((i) => {
    const matchStatus = statusFilter === 'all' || i.operStatus === statusFilter;
    const text = q.toLowerCase();
    const matchText =
      !text ||
      (i.name ?? '').toLowerCase().includes(text) ||
      (i.alias ?? '').toLowerCase().includes(text) ||
      (i.description ?? '').toLowerCase().includes(text);
    return matchStatus && matchText;
  });

  const inputCls = `text-xs py-1.5 px-3 rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><Boxes className="w-4 h-4 text-cyan-400" /> Chọn cổng — {device.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-800">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Lọc theo tên / mô tả / alias..."
              className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`}
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'up' | 'down')} className={inputCls}>
            <option value="all">Trạng thái: Tất cả</option>
            <option value="up">🟢 Up</option>
            <option value="down">🔴 Down</option>
          </select>
        </div>

        <div className="p-3 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500 p-3 text-center">Không có cổng phù hợp bộ lọc.</p>
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => onSelect(i.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                  selectedId === i.id
                    ? 'bg-cyan-500/10 border-cyan-500/40'
                    : darkMode
                    ? 'bg-slate-800/50 border-slate-700/70 hover:bg-slate-800'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${i.operStatus === 'up' ? 'bg-emerald-400' : i.operStatus === 'down' ? 'bg-red-400' : 'bg-amber-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{i.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{i.alias || i.description || '—'} • {i.speed}</div>
                </div>
                {selectedId === i.id && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// --- Trigger buttons (same visual language as AlertConsole's "Thêm quy tắc" form) ---
export const DevicePickerButton: React.FC<{
  devices: NetworkDevice[];
  darkMode: boolean;
  value: string;
  onChange: (deviceId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ devices, darkMode, value, onChange, placeholder = 'Chọn thiết bị...', disabled }) => {
  const [open, setOpen] = useState(false);
  const selected = devices.find((d) => d.id === value);
  const inputCls = `w-full px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`${inputCls} flex items-center justify-between text-left disabled:opacity-50`}
      >
        <span className="flex items-center gap-2 truncate">
          <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{selected ? selected.name : placeholder}</span>
        </span>
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <DevicePickerModal
          devices={devices}
          darkMode={darkMode}
          selectedId={value}
          onSelect={(id) => { onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

interface MultiDevicePickerModalProps {
  devices: NetworkDevice[];
  darkMode: boolean;
  selectedIds: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}

const MultiDevicePickerModal: React.FC<MultiDevicePickerModalProps> = ({ devices, darkMode, selectedIds, onApply, onClose }) => {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedIds));

  const filtered = devices.filter(
    (d) =>
      (d.name ?? '').toLowerCase().includes(q.toLowerCase()) ||
      (d.ip ?? '').includes(q) ||
      (d.vendor ?? '').toLowerCase().includes(q.toLowerCase()),
  );

  const allFilteredPicked = filtered.length > 0 && filtered.every((d) => picked.has(d.id));

  const toggleOne = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allFilteredPicked) {
        for (const d of filtered) next.delete(d.id);
      } else {
        for (const d of filtered) next.add(d.id);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><Server className="w-4 h-4 text-emerald-400" /> Chọn thiết bị (nhiều)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3 space-y-2 border-b border-slate-800">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo tên, IP, hãng..."
              className={`w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Đã chọn {picked.size} thiết bị</span>
            <button
              type="button"
              onClick={toggleAllFiltered}
              className="px-2 py-1 rounded border border-slate-600 text-slate-200 hover:border-emerald-500"
            >
              {allFilteredPicked ? 'Bỏ chọn danh sách lọc' : 'Chọn danh sách lọc'}
            </button>
          </div>
        </div>
        <div className="px-3 py-2 overflow-y-auto space-y-1 flex-1 min-h-0">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500 p-3 text-center">Không có thiết bị phù hợp.</p>
          ) : (
            filtered.map((d) => {
              const checked = picked.has(d.id);
              return (
                <label
                  key={d.id}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                    checked
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : darkMode
                      ? 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{d.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">{d.ip}{d.vendor ? ` • ${d.vendor}` : ''}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(d.id)}
                    className="accent-emerald-500 w-4 h-4 shrink-0"
                  />
                </label>
              );
            })
          )}
        </div>
        <div className="p-3 border-t border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300"
          >
            Huy
          </button>
          <button
            type="button"
            onClick={() => onApply(Array.from(picked))}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  );
};

export const MultiDevicePickerButton: React.FC<{
  devices: NetworkDevice[];
  darkMode: boolean;
  values: string[];
  onChange: (deviceIds: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ devices, darkMode, values, onChange, placeholder = 'Chọn thiết bị...', disabled }) => {
  const [open, setOpen] = useState(false);
  const inputCls = `w-full px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`${inputCls} flex items-center justify-between text-left disabled:opacity-50`}
      >
        <span className="flex items-center gap-2 truncate">
          <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{values.length > 0 ? `${values.length} thiết bị đã chọn` : placeholder}</span>
        </span>
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <MultiDevicePickerModal
          devices={devices}
          darkMode={darkMode}
          selectedIds={values}
          onApply={(ids) => {
            onChange(ids);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

export const PortPickerButton: React.FC<{
  device: NetworkDevice | undefined;
  darkMode: boolean;
  value: string;
  onChange: (portId: string) => void;
  placeholder?: string;
}> = ({ device, darkMode, value, onChange, placeholder }) => {
  const [open, setOpen] = useState(false);
  // Auto-fetch full device (with interfaces) when the lightweight list omits them
  const [fullDevice, setFullDevice] = useState<NetworkDevice | undefined>(undefined);
  useEffect(() => {
    if (!device || device.interfaces.length > 0) { setFullDevice(undefined); return; }
    let cancelled = false;
    api.devices.get(device.id).then((d) => { if (!cancelled) setFullDevice(d); });
    return () => { cancelled = true; };
  }, [device?.id, device?.interfaces.length]);
  const resolved = (fullDevice && fullDevice.id === device?.id) ? fullDevice : device;
  const selectedPort = resolved?.interfaces.find((i) => i.id === value);
  const inputCls = `w-full px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;

  return (
    <>
      <button
        type="button"
        onClick={() => device && setOpen(true)}
        disabled={!device}
        className={`${inputCls} flex items-center justify-between text-left disabled:opacity-50`}
      >
        <span className="flex items-center gap-2 truncate">
          <Boxes className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="truncate">
            {selectedPort ? `${selectedPort.name}${selectedPort.alias ? ` (${selectedPort.alias})` : ''}` : device ? placeholder ?? 'Chọn cổng...' : 'Chọn thiết bị trước'}
          </span>
        </span>
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && resolved && (
        <SinglePortPickerModal
          device={resolved}
          darkMode={darkMode}
          selectedId={value}
          onSelect={(id) => { onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
