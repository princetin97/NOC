import React, { useEffect, useState } from 'react';
import { Bell, Mail, Send, Webhook, Hash, Plus, Pencil, Trash2, CheckCircle, AlertTriangle, Loader2, KeyRound, Users, Activity } from 'lucide-react';
import { api } from '../services/api';
import { NotificationChannel, NotificationChannelType, AlertSeverity, AppUser, AlertRenotifySettings, SiteInfo } from '../types';

interface SettingsPanelProps {
  darkMode: boolean;
  trafficChartMode: 'stacked' | 'mirrored';
  onChangeTrafficChartMode: (mode: 'stacked' | 'mirrored') => void;
  currentUserRole: string;
  currentUserSiteIds?: string[];
  currentUserIsSystemAdmin?: boolean;
  sites?: SiteInfo[];
  selectedSiteId?: string | null;
}

const CHANNEL_META: Record<NotificationChannelType, { label: string; icon: React.ComponentType<{ className?: string }>; fields: { key: string; label: string; type?: string; placeholder?: string }[] }> = {
  email: {
    label: 'Email (SMTP)',
    icon: Mail,
    fields: [
      { key: 'host', label: 'SMTP Host', placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
      { key: 'user', label: 'Username', placeholder: 'you@gmail.com' },
      { key: 'pass', label: 'Password / App Password', type: 'password' },
      { key: 'from', label: 'From', placeholder: 'monitor@company.com' },
      { key: 'to', label: 'To (nhận cảnh báo)', placeholder: 'noc@company.com' },
    ],
  },
  telegram: {
    label: 'Telegram',
    icon: Send,
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...' },
      { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890' },
      { key: 'messageThreadId', label: 'Topic/Thread ID (tùy chọn)', placeholder: 'VD: 45' },
    ],
  },
  webhook: {
    label: 'Webhook',
    icon: Webhook,
    fields: [{ key: 'url', label: 'URL', placeholder: 'https://example.com/hook' }],
  },
  slack: {
    label: 'Slack',
    icon: Hash,
    fields: [{ key: 'webhookUrl', label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/services/...' }],
  },
};

const SEVERITIES: AlertSeverity[] = ['low', 'medium', 'high', 'critical'];
const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

// Alert categories a channel can be restricted to (must match backend's alertCategory()
// in poller/alerting.ts). Empty selection = channel receives every category (default).
const ALERT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'device_status', label: 'Thiết bị Up/Down' },
  { value: 'interface', label: 'Cổng mạng (Interface)' },
  { value: 'service', label: 'Dịch vụ (Service)' },
  { value: 'temperature', label: 'Nhiệt độ' },
  { value: 'cpu', label: 'CPU' },
  { value: 'memory', label: 'Bộ nhớ (RAM)' },
  { value: 'fan', label: 'Quạt' },
  { value: 'power', label: 'Nguồn điện (PSU)' },
  { value: 'voltage', label: 'Điện áp' },
  { value: 'disk', label: 'Ổ đĩa' },
  { value: 'humidity', label: 'Độ ẩm' },
  { value: 'bgp', label: 'BGP' },
  { value: 'other', label: 'Khác' },
];

type SettingsSection = 'display' | 'notifications' | 'account' | 'users' | 'sites';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  darkMode,
  trafficChartMode,
  onChangeTrafficChartMode,
  currentUserRole,
  currentUserSiteIds = [],
  currentUserIsSystemAdmin,
  sites = [],
  selectedSiteId = null,
}) => {
  const [section, setSection] = useState<SettingsSection>('display');

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<NotificationChannelType>('telegram');
  const [name, setName] = useState('');
  const [minSeverity, setMinSeverity] = useState<AlertSeverity>('medium');
  const [channelSiteId, setChannelSiteId] = useState<string>(selectedSiteId ?? '');
  const [channelCategories, setChannelCategories] = useState<string[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [renotifySettings, setRenotifySettings] = useState<AlertRenotifySettings | null>(null);
  const [renotifySaving, setRenotifySaving] = useState(false);
  const [renotifyMessage, setRenotifyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('operator');
  const [newUserAdminScope, setNewUserAdminScope] = useState<'system' | 'site'>(selectedSiteId ? 'site' : 'system');
  const [newUserSiteIds, setNewUserSiteIds] = useState<string[]>(selectedSiteId ? [selectedSiteId] : []);
  const [userMessage, setUserMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [usersUnavailable, setUsersUnavailable] = useState(false);
  const [userSiteDraft, setUserSiteDraft] = useState<Record<string, string[]>>({});
  const [userRoleDraft, setUserRoleDraft] = useState<Record<string, string>>({});
  const [userAdminScopeDraft, setUserAdminScopeDraft] = useState<Record<string, 'system' | 'site'>>({});
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [managedSites, setManagedSites] = useState<SiteInfo[]>(sites);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteCode, setNewSiteCode] = useState('');
  const [siteMessage, setSiteMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const card = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const input = darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900';
  const isViewer = currentUserRole === 'viewer';
  const isAdmin = currentUserRole === 'admin';
  const isSystemAdmin = currentUserIsSystemAdmin ?? (isAdmin && currentUserSiteIds.length === 0);
  const canManageNotificationChannels = isAdmin;
  const canManageRenotifyDefaults = isSystemAdmin;

  useEffect(() => {
    setManagedSites(sites);
  }, [sites]);

  useEffect(() => {
    setChannelSiteId(selectedSiteId ?? '');
  }, [selectedSiteId]);

  const loadChannels = async () => {
    setLoading(true);
    try {
      setChannels(await api.notificationChannels.list());
      setError(null);
    } catch {
      setError('Không tải được danh sách kênh thông báo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    api.renotifySettings.get().then(setRenotifySettings).catch(() => setRenotifySettings(null));
  }, []);

  const buildConfig = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const field of CHANNEL_META[type].fields) {
      const value = config[field.key];
      if (value === undefined || value === '') continue;
      out[field.key] = field.type === 'number' ? Number(value) : value;
    }
    return out;
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName('');
    setType('telegram');
    setMinSeverity('medium');
    setChannelSiteId(selectedSiteId ?? '');
    setChannelCategories([]);
    setConfig({});
    setTestResult(null);
  };

  const startEdit = (channel: NotificationChannel) => {
    setError(null);
    setTestResult(null);
    setEditingId(channel.id);
    setName(channel.name);
    setType(channel.type);
    setMinSeverity(channel.minSeverity);
    setChannelSiteId(channel.siteId ?? '');
    setChannelCategories(channel.categories ?? []);

    const nextConfig: Record<string, string> = {};
    for (const field of CHANNEL_META[channel.type].fields) {
      if (field.type === 'password') continue;
      const value = channel.config[field.key];
      if (value !== undefined && value !== null) nextConfig[field.key] = String(value);
    }
    setConfig(nextConfig);
  };

  const toggleChannelCategory = (value: string) => {
    setChannelCategories((cur) => (cur.includes(value) ? cur.filter((c) => c !== value) : [...cur, value]));
  };

  const handleCreate = async () => {
    if (isViewer) return;
    setError(null);
    setSaving(true);
    try {
      const payload = { name, type, minSeverity, siteId: channelSiteId || null, categories: channelCategories, config: buildConfig() };
      if (editingId) {
        await api.notificationChannels.update(editingId, payload);
      } else {
        await api.notificationChannels.create(payload);
      }
      cancelEdit();
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu kênh thất bại (kiểm tra lại cấu hình).');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (isViewer) return;
    setTestResult(null);
    setSaving(true);
    try {
      setTestResult(await api.notificationChannels.test(type, buildConfig()));
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Gửi thử thất bại' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (channel: NotificationChannel) => {
    if (isViewer) return;
    await api.notificationChannels.update(channel.id, { enabled: !channel.enabled });
    await loadChannels();
  };

  const handleDelete = async (id: string) => {
    if (isViewer) return;
    await api.notificationChannels.remove(id);
    if (editingId === id) cancelEdit();
    await loadChannels();
  };

  const handleSaveRenotifySettings = async () => {
    if (isViewer || !renotifySettings) return;
    setRenotifySaving(true);
    setRenotifyMessage(null);
    try {
      setRenotifySettings(await api.renotifySettings.update(renotifySettings));
      setRenotifyMessage({ ok: true, text: 'Đã lưu tần suất gửi lại.' });
    } catch (err) {
      setRenotifyMessage({ ok: false, text: err instanceof Error ? err.message : 'Lưu thất bại.' });
    } finally {
      setRenotifySaving(false);
    }
  };

  const loadUsers = async () => {
    try {
      const list = await api.users.list();
      setUsers(list);
      setUserSiteDraft(Object.fromEntries(list.map((u) => [u.id, u.siteIds ?? []])));
      setUserRoleDraft(Object.fromEntries(list.map((u) => [u.id, u.role])));
      setUserAdminScopeDraft(
        Object.fromEntries(
          list.map((u) => [u.id, u.role === 'admin' && (u.siteIds?.length ?? 0) > 0 ? 'site' : 'system']),
        ),
      );
      setUsersUnavailable(false);
    } catch {
      setUsersUnavailable(true);
    }
  };

  useEffect(() => {
    if (section !== 'users' || !isSystemAdmin) return;
    void loadUsers();
  }, [section, isSystemAdmin]);

  useEffect(() => {
    if (!isSystemAdmin && (section === 'users' || section === 'sites')) setSection('account');
  }, [isSystemAdmin, section]);

  const handleChangePassword = async () => {
    setPwMessage(null);
    try {
      await api.account.changePassword(currentPassword, newPassword);
      setPwMessage({ ok: true, text: 'Đổi mật khẩu thành công.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwMessage({ ok: false, text: err instanceof Error ? err.message : 'Đổi mật khẩu thất bại.' });
    }
  };

  const handleCreateUser = async () => {
    setUserMessage(null);
    try {
      await api.users.create({
        username: newUsername,
        password: newUserPassword,
        role: newUserRole,
        siteIds:
          newUserRole === 'admin'
            ? newUserAdminScope === 'system'
              ? []
              : newUserSiteIds
            : newUserSiteIds,
      });
      setUserMessage({ ok: true, text: 'Đã tạo người dùng.' });
      setNewUsername('');
      setNewUserPassword('');
      setNewUserRole('operator');
      setNewUserAdminScope(selectedSiteId ? 'site' : 'system');
      setNewUserSiteIds(selectedSiteId ? [selectedSiteId] : []);
      await loadUsers();
    } catch (err) {
      setUserMessage({ ok: false, text: err instanceof Error ? err.message : 'Tạo người dùng thất bại.' });
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await api.users.remove(id);
      await loadUsers();
    } catch (err) {
      setUserMessage({ ok: false, text: err instanceof Error ? err.message : 'Xóa người dùng thất bại.' });
    }
  };

  const handleSaveUserAccess = async (id: string) => {
    try {
      const nextRole = userRoleDraft[id];
      const nextSiteIds = nextRole === 'admin' && userAdminScopeDraft[id] === 'system' ? [] : userSiteDraft[id] ?? [];
      await api.users.update(id, {
        role: nextRole,
        siteIds: nextSiteIds,
      });
      await loadUsers();
      setEditingUserId(null);
      setUserMessage({ ok: true, text: 'Đã cập nhật phân quyền trụ sở cho người dùng.' });
    } catch (err) {
      setUserMessage({ ok: false, text: err instanceof Error ? err.message : 'Cập nhật trụ sở cho người dùng thất bại.' });
    }
  };

  const startEditUser = (user: AppUser) => {
    setEditingUserId(user.id);
    setUserRoleDraft((prev) => ({ ...prev, [user.id]: user.role }));
    setUserSiteDraft((prev) => ({ ...prev, [user.id]: user.siteIds ?? [] }));
    setUserAdminScopeDraft((prev) => ({
      ...prev,
      [user.id]: user.role === 'admin' && (user.siteIds?.length ?? 0) > 0 ? 'site' : 'system',
    }));
  };

  const handleCreateSite = async () => {
    setSiteMessage(null);
    if (!newSiteName.trim()) return;
    try {
      const created = await api.sites.create({ name: newSiteName.trim(), code: newSiteCode.trim() || undefined });
      setManagedSites((prev) => [...prev, created]);
      setNewSiteName('');
      setNewSiteCode('');
      setSiteMessage({ ok: true, text: 'Đã tạo trụ sở.' });
    } catch (err) {
      setSiteMessage({ ok: false, text: err instanceof Error ? err.message : 'Tạo trụ sở thất bại.' });
    }
  };

  const handleDeleteSite = async (id: string) => {
    try {
      await api.sites.remove(id);
      setManagedSites((prev) => prev.filter((s) => s.id !== id));
      setSiteMessage({ ok: true, text: 'Đã xóa trụ sở.' });
    } catch (err) {
      setSiteMessage({ ok: false, text: err instanceof Error ? err.message : 'Xóa trụ sở thất bại.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {([
          { id: 'display', label: 'Hiển thị', icon: Activity },
          { id: 'notifications', label: 'Thông báo', icon: Bell },
          { id: 'account', label: 'Tài khoản', icon: KeyRound },
          ...(isSystemAdmin ? ([{ id: 'sites', label: 'Trụ sở', icon: Activity }] as const) : []),
          ...(isSystemAdmin ? ([{ id: 'users', label: 'Người dùng', icon: Users }] as const) : []),
        ] as const).map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                active ? 'bg-emerald-500 text-white' : darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" /> {s.label}
            </button>
          );
        })}
      </div>

      {isViewer && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${darkMode ? 'bg-slate-900 border-slate-800 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
          Tài khoản viewer đang ở chế độ chỉ xem. Các thao tác thay đổi cấu hình hệ thống sẽ bị khóa.
        </div>
      )}

      {section === 'display' && (
        <div className={`rounded-xl border ${card} p-4 space-y-3`}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
            <Activity className="w-4 h-4 text-cyan-400" />
            Kiểu hiển thị biểu đồ traffic (theo user)
          </div>
          <p className="text-sm text-slate-400">Cài đặt này áp dụng toàn bộ biểu đồ traffic trong hệ thống cho tài khoản hiện tại.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onChangeTrafficChartMode('mirrored')}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                trafficChartMode === 'mirrored'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                  : darkMode
                    ? 'text-slate-300 border-slate-700 hover:bg-slate-800'
                    : 'text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              Mirrored (In lên / Out xuống)
            </button>
            <button
              onClick={() => onChangeTrafficChartMode('stacked')}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                trafficChartMode === 'stacked'
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                  : darkMode
                    ? 'text-slate-300 border-slate-700 hover:bg-slate-800'
                    : 'text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              Stacked (In/Out cùng hướng lên)
            </button>
          </div>
        </div>
      )}

      {section === 'notifications' && (
        <>
          <div className="flex items-center gap-3">
            <Bell className="w-6 h-6 text-emerald-400" />
            <div>
              <h2 className={`text-xl font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>Kênh Thông báo Cảnh báo</h2>
              <p className="text-sm text-slate-400">Gửi cảnh báo ra Email, Telegram, Slack hoặc Webhook khi có sự cố.</p>
            </div>
          </div>

          <div className={`rounded-xl border ${card}`}>
            <div className="p-4 border-b border-inherit font-semibold text-sm uppercase tracking-wider text-slate-400">Kênh đã cấu hình ({channels.length})</div>
            {loading ? (
              <div className="p-6 flex items-center justify-center text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
              </div>
            ) : channels.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">Chưa có kênh nào. Thêm kênh bên dưới.</div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {channels.map((ch) => {
                  const Icon = CHANNEL_META[ch.type].icon;
                  return (
                    <div key={ch.id} className={`p-4 flex items-center gap-4 ${editingId === ch.id ? (darkMode ? 'bg-slate-800/60' : 'bg-slate-100') : ''}`}>
                      <Icon className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                          {ch.name} <span className="text-xs text-slate-400">({CHANNEL_META[ch.type].label})</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          Site: {managedSites.find((s) => s.id === (ch.siteId ?? null))?.name ?? 'Global'} • Mức tối thiểu:{' '}
                          <span className="uppercase">{ch.minSeverity}</span>
                          {ch.categories?.length > 0 && (
                            <span>
                              {' '}
                              • Loại: {ch.categories.map((c) => ALERT_CATEGORIES.find((a) => a.value === c)?.label ?? c).join(', ')}
                            </span>
                          )}
                          {ch.lastError && <span className="text-red-400"> • Lỗi: {ch.lastError}</span>}
                          {ch.lastSentAt && !ch.lastError && (
                            <span className="text-emerald-400"> • Gửi gần nhất: {new Date(ch.lastSentAt).toLocaleString('vi-VN')}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggle(ch)}
                        disabled={!canManageNotificationChannels}
                        className={`px-3 py-1 rounded-lg text-xs font-medium ${ch.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400'}`}
                      >
                        {ch.enabled ? 'Đang bật' : 'Đang tắt'}
                      </button>
                      {canManageNotificationChannels && (
                        <>
                          <button onClick={() => startEdit(ch)} className="p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(ch.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`rounded-xl border ${card} p-4 space-y-4`}>
            <div className="font-semibold text-sm uppercase tracking-wider text-slate-400">Tần suất gửi lại theo mức độ</div>
            <p className="text-sm text-slate-400">
              Nếu cảnh báo chưa được giải quyết, hệ thống sẽ gửi lại thông báo Telegram/Slack theo chu kỳ dưới đây cho từng mức độ nghiêm trọng (0 = không gửi lại).
            </p>
            {renotifySettings ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
                    <label key={sev} className="text-sm">
                      <span className="block mb-1 text-slate-400">{SEVERITY_LABEL[sev]} (phút)</span>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        disabled={!canManageRenotifyDefaults}
                        value={renotifySettings[sev]}
                        onChange={(e) => setRenotifySettings({ ...renotifySettings, [sev]: Number(e.target.value) })}
                        className={`w-full rounded-lg border px-3 py-2 ${input}`}
                      />
                    </label>
                  ))}
                </div>
                {renotifyMessage && (
                  <div className={`text-sm flex items-center gap-2 ${renotifyMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {renotifyMessage.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {renotifyMessage.text}
                  </div>
                )}
                <button
                  onClick={handleSaveRenotifySettings}
                  disabled={renotifySaving || !canManageRenotifyDefaults}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {renotifySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Lưu tần suất
                </button>
                {!canManageRenotifyDefaults && (
                  <div className="text-xs text-amber-400">Chỉ admin hệ thống mới được chỉnh tần suất gửi lại mặc định toàn hệ thống.</div>
                )}
              </>
            ) : (
              <div className="text-sm text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Đang tải...
              </div>
            )}
          </div>

          {!canManageNotificationChannels ? (
            <div className={`rounded-xl border ${card} p-4 text-sm text-slate-400`}>
              Chỉ tài khoản admin mới có quyền thêm/sửa/xóa kênh thông báo.
            </div>
          ) : (
            <div className={`rounded-xl border ${card} p-4 space-y-4`}>
              <div className="font-semibold text-sm uppercase tracking-wider text-slate-400">{editingId ? 'Sửa kênh' : 'Thêm kênh mới'}</div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="text-sm">
                  <span className="block mb-1 text-slate-400">Loại kênh</span>
                  <select
                    value={type}
                    disabled={!!editingId}
                    onChange={(e) => {
                      setType(e.target.value as NotificationChannelType);
                      setConfig({});
                      setTestResult(null);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 ${input} disabled:opacity-60`}
                  >
                    {(Object.keys(CHANNEL_META) as NotificationChannelType[]).map((t) => (
                      <option key={t} value={t}>
                        {CHANNEL_META[t].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block mb-1 text-slate-400">Tên hiển thị</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: NOC Telegram" className={`w-full rounded-lg border px-3 py-2 ${input}`} />
                </label>
                <label className="text-sm">
                  <span className="block mb-1 text-slate-400">Mức nghiêm trọng tối thiểu</span>
                  <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as AlertSeverity)} className={`w-full rounded-lg border px-3 py-2 ${input}`}>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block mb-1 text-slate-400">Trụ sở áp dụng</span>
                  <select value={channelSiteId} onChange={(e) => setChannelSiteId(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`}>
                    <option value="">Global (mọi trụ sở)</option>
                    {managedSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {CHANNEL_META[type].fields.map((field) => (
                  <label key={field.key} className="text-sm">
                    <span className="block mb-1 text-slate-400">{field.label}</span>
                    <input
                      type={field.type ?? 'text'}
                      value={config[field.key] ?? ''}
                      onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
                      placeholder={editingId && field.type === 'password' ? '(giữ nguyên, để trống nếu không đổi)' : field.placeholder}
                      className={`w-full rounded-lg border px-3 py-2 ${input}`}
                    />
                  </label>
                ))}
              </div>

              <div className={`rounded-lg border ${input} border-slate-700 p-3 space-y-2`}>
                <span className="block text-xs text-slate-400">
                  Loại cảnh báo nhận (để trống = nhận tất cả). Dùng để bắn từng loại sang topic/kênh riêng, ví dụ tạo nhiều kênh Telegram cùng Chat ID nhưng khác Topic/Thread ID.
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ALERT_CATEGORIES.map((cat) => (
                    <button
                      type="button"
                      key={cat.value}
                      onClick={() => toggleChannelCategory(cat.value)}
                      className={`px-2.5 py-1 rounded-full border text-xs whitespace-nowrap ${
                        channelCategories.includes(cat.value)
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                          : `${input} border-slate-600`
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-sm text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </div>
              )}
              {testResult && (
                <div className={`text-sm flex items-center gap-2 ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {testResult.ok ? 'Gửi thử thành công!' : `Gửi thử thất bại: ${testResult.error}`}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleTest}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Gửi thử
                </button>
                {editingId && (
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    Hủy sửa
                  </button>
                )}
                <button
                  onClick={handleCreate}
                  disabled={saving || !name}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> {editingId ? 'Lưu thay đổi' : 'Lưu kênh'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {section === 'account' && (
        <div className={`rounded-xl border ${card} p-4 space-y-4 max-w-lg`}>
          <div className="flex items-center gap-3">
            <KeyRound className="w-6 h-6 text-emerald-400" />
            <h2 className={`text-xl font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>Đổi mật khẩu</h2>
          </div>
          <label className="text-sm block">
            <span className="block mb-1 text-slate-400">Mật khẩu hiện tại</span>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`} />
          </label>
          <label className="text-sm block">
            <span className="block mb-1 text-slate-400">Mật khẩu mới (tối thiểu 6 ký tự)</span>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`} />
          </label>
          {pwMessage && (
            <div className={`text-sm flex items-center gap-2 ${pwMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {pwMessage.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {pwMessage.text}
            </div>
          )}
          <button
            onClick={handleChangePassword}
            disabled={!currentPassword || newPassword.length < 6}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Cập nhật mật khẩu
          </button>
        </div>
      )}

      {section === 'sites' && (
        <div className="space-y-6">
          <div className={`rounded-xl border ${card}`}>
            <div className="p-4 border-b border-inherit font-semibold text-sm uppercase tracking-wider text-slate-400">Trụ sở ({managedSites.length})</div>
            <div className="divide-y divide-slate-800/50">
              {managedSites.map((s) => (
                <div key={s.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className={`font-medium ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{s.name}</div>
                    <div className="text-xs text-slate-400">Mã: {s.code || '-'}</div>
                  </div>
                  <button onClick={() => handleDeleteSite(s.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-xl border ${card} p-4 space-y-4`}>
            <div className="font-semibold text-sm uppercase tracking-wider text-slate-400">Thêm trụ sở</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 text-slate-400">Tên trụ sở</span>
                <input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`} />
              </label>
              <label className="text-sm">
                <span className="block mb-1 text-slate-400">Mã (tùy chọn)</span>
                <input value={newSiteCode} onChange={(e) => setNewSiteCode(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`} />
              </label>
            </div>
            {siteMessage && (
              <div className={`text-sm flex items-center gap-2 ${siteMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {siteMessage.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {siteMessage.text}
              </div>
            )}
            <button
              onClick={handleCreateSite}
              disabled={!newSiteName.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Tạo trụ sở
            </button>
          </div>
        </div>
      )}

      {section === 'users' && (
        <div className="space-y-6">
          {usersUnavailable ? (
            <div className={`rounded-xl border ${card} p-6 text-center text-slate-400`}>
              Chỉ admin hệ thống mới quản lý được người dùng.
            </div>
          ) : (
            <>
              <div className={`rounded-xl border ${card}`}>
                <div className="p-4 border-b border-inherit font-semibold text-sm uppercase tracking-wider text-slate-400">Người dùng ({users.length})</div>
                <div className="divide-y divide-slate-800/50">
                  {users.map((u) => (
                    <div key={u.id} className="p-3 sm:p-4">
                      <div className="flex items-center gap-3">
                        <Users className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium truncate ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{u.username}</div>
                          <div className="text-xs text-slate-400">
                            Vai trò: {u.role === 'admin' ? ((u.siteIds?.length ?? 0) > 0 ? 'admin (theo trụ sở)' : 'admin (hệ thống)') : u.role}
                            {' • '}Trụ sở: {(u.siteIds ?? []).map((id) => managedSites.find((s) => s.id === id)?.name ?? id).join(', ') || 'Chưa gán'}
                          </div>
                          <div className="text-[11px] text-slate-500">Tạo: {new Date(u.createdAt).toLocaleDateString('vi-VN')}</div>
                        </div>
                        <button onClick={() => startEditUser(u)} className="p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10" title="Chỉnh sửa người dùng">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteUser(u.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" title="Xóa người dùng">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {editingUserId === u.id && (
                        <div className="mt-3 rounded-lg border border-slate-700/70 p-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <label className="text-xs">
                              <span className="block mb-1 text-slate-400">Vai trò</span>
                              <select
                                value={userRoleDraft[u.id] ?? u.role}
                                onChange={(e) => {
                                  const role = e.target.value;
                                  setUserRoleDraft((prev) => ({ ...prev, [u.id]: role }));
                                  if (role !== 'admin') {
                                    setUserAdminScopeDraft((prev) => ({ ...prev, [u.id]: 'site' }));
                                  }
                                }}
                                className={`w-full rounded-lg border px-2.5 py-2 ${input}`}
                              >
                                <option value="admin">admin</option>
                                <option value="operator">operator</option>
                                <option value="viewer">viewer</option>
                              </select>
                            </label>

                            {(userRoleDraft[u.id] ?? u.role) === 'admin' && (
                              <label className="text-xs">
                                <span className="block mb-1 text-slate-400">Phạm vi quản trị</span>
                                <select
                                  value={userAdminScopeDraft[u.id] ?? 'system'}
                                  onChange={(e) => {
                                    const scope = e.target.value as 'system' | 'site';
                                    setUserAdminScopeDraft((prev) => ({ ...prev, [u.id]: scope }));
                                    if (scope === 'system') {
                                      setUserSiteDraft((prev) => ({ ...prev, [u.id]: [] }));
                                    }
                                  }}
                                  className={`w-full rounded-lg border px-2.5 py-2 ${input}`}
                                >
                                  <option value="system">Admin hệ thống (toàn quyền)</option>
                                  <option value="site">Admin theo trụ sở</option>
                                </select>
                              </label>
                            )}

                            <label className="text-xs md:col-span-2">
                              <span className="block mb-1 text-slate-400">Trụ sở (giữ Ctrl để chọn nhiều)</span>
                              <select
                                multiple
                                value={userSiteDraft[u.id] ?? []}
                                disabled={(userRoleDraft[u.id] ?? u.role) === 'admin' && (userAdminScopeDraft[u.id] ?? 'system') === 'system'}
                                onChange={(e) => {
                                  const values = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                                  setUserSiteDraft((prev) => ({ ...prev, [u.id]: values }));
                                }}
                                className={`w-full min-h-[92px] rounded-lg border px-2 py-1 text-xs ${input} disabled:opacity-60`}
                              >
                                {managedSites.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="mt-3 flex gap-2">
                            <button onClick={() => handleSaveUserAccess(u.id)} className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs hover:bg-cyan-500">
                              Lưu thay đổi
                            </button>
                            <button onClick={() => setEditingUserId(null)} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800">
                              Hủy
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className={`rounded-xl border ${card} p-4 space-y-4`}>
                <div className="font-semibold text-sm uppercase tracking-wider text-slate-400">Thêm người dùng</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-sm">
                    <span className="block mb-1 text-slate-400">Tên đăng nhập</span>
                    <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`} />
                  </label>
                  <label className="text-sm">
                    <span className="block mb-1 text-slate-400">Mật khẩu</span>
                    <input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} className={`w-full rounded-lg border px-3 py-2 ${input}`} />
                  </label>
                  <label className="text-sm">
                    <span className="block mb-1 text-slate-400">Vai trò</span>
                    <select
                      value={newUserRole}
                      onChange={(e) => {
                        const role = e.target.value;
                        setNewUserRole(role);
                        if (role !== 'admin') setNewUserAdminScope('site');
                      }}
                      className={`w-full rounded-lg border px-3 py-2 ${input}`}
                    >
                      <option value="admin">admin</option>
                      <option value="operator">operator</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {newUserRole === 'admin' && (
                    <label className="text-sm">
                      <span className="block mb-1 text-slate-400">Phạm vi quản trị</span>
                      <select
                        value={newUserAdminScope}
                        onChange={(e) => {
                          const scope = e.target.value as 'system' | 'site';
                          setNewUserAdminScope(scope);
                          if (scope === 'system') setNewUserSiteIds([]);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 ${input}`}
                      >
                        <option value="system">Admin hệ thống (toàn quyền)</option>
                        <option value="site">Admin theo trụ sở</option>
                      </select>
                    </label>
                  )}

                  <label className="text-sm sm:col-span-1">
                    <span className="block mb-1 text-slate-400">Trụ sở (có thể chọn/bỏ chọn nhiều)</span>
                    <select
                      multiple
                      value={newUserSiteIds}
                      disabled={newUserRole === 'admin' && newUserAdminScope === 'system'}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                        setNewUserSiteIds(values);
                      }}
                      className={`w-full min-h-[92px] rounded-lg border px-2 py-1 text-xs ${input} disabled:opacity-60`}
                    >
                      {managedSites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {userMessage && (
                  <div className={`text-sm flex items-center gap-2 ${userMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {userMessage.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {userMessage.text}
                  </div>
                )}
                <button
                  onClick={handleCreateUser}
                  disabled={!newUsername || newUserPassword.length < 6}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Tạo người dùng
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
