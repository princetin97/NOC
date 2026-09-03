import React, { useState, useEffect, useMemo, useRef } from 'react';
import { NetworkAlert, AlertRule, EventLog, AlertSeverity, NetworkDevice, AlertRuleInput, AlertMetric, DeviceGroup, DeviceSensor, ServiceCheck, SiteInfo, AlertRuleApplySitesInput, AlertRuleApplySitesResult } from '../types';
import { ShieldAlert, AlertTriangle, CheckCircle, Clock, Volume2, Plus, Filter, Search, Check, CheckCheck, RefreshCw, Trash2, Pencil, Copy, Server, Boxes, X } from 'lucide-react';
import { api } from '../services/api';
import { SyslogConsole } from './SyslogConsole';
import { DevicePickerButton } from './DevicePortPicker';

interface AlertConsoleProps {
  alerts: NetworkAlert[];
  alertRules: AlertRule[];
  eventLogs: EventLog[];
  devices: NetworkDevice[];
  services: ServiceCheck[];
  sites?: SiteInfo[];
  selectedSiteId?: string | null;
  darkMode: boolean;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll: () => void;
  onResolve: (id: string) => void;
  onResolveAllAcknowledged: () => void;
  onToggleRule: (id: string) => void;
  onCreateRule: (input: AlertRuleInput) => void;
  onUpdateRule: (id: string, input: AlertRuleInput) => void;
  onDeleteRule: (id: string) => void;
  onApplyRuleSites: (id: string, input: AlertRuleApplySitesInput) => Promise<AlertRuleApplySitesResult>;
  canApplyRulesAcrossSites?: boolean;
  quickSeverityFilter?: AlertSeverity | null;
  quickAlertTab?: 'alerts' | 'acknowledged' | null;
  quickSeverityRequestKey?: number;
}

export const AlertConsole: React.FC<AlertConsoleProps> = ({
  alerts,
  alertRules,
  eventLogs,
  devices,
  services,
  sites = [],
  selectedSiteId = null,
  darkMode,
  onAcknowledge,
  onAcknowledgeAll,
  onResolve,
  onResolveAllAcknowledged,
  onToggleRule,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onApplyRuleSites,
  canApplyRulesAcrossSites = false,
  quickSeverityFilter,
  quickAlertTab,
  quickSeverityRequestKey,
}) => {
  const [activeTab, setActiveTab] = useState<'alerts' | 'acknowledged' | 'rules' | 'syslog'>('alerts');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [ruleSeverityFilter, setRuleSeverityFilter] = useState<string>('all');
  const [ruleSearchQuery, setRuleSearchQuery] = useState('');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [applyingRule, setApplyingRule] = useState<AlertRule | null>(null);
  const [applySiteIds, setApplySiteIds] = useState<string[]>([]);
  const [applyIncludeTargets, setApplyIncludeTargets] = useState(false);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const applySubmittingRef = useRef(false);
  const [quickApplyRuleId, setQuickApplyRuleId] = useState<string | null>(null);

  const siteNameById = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);
  const allSiteIds = useMemo(() => [...new Set(sites.map((s) => s.id))], [sites]);

  useEffect(() => {
    if (!quickSeverityRequestKey) return;
    if (quickAlertTab) setActiveTab(quickAlertTab);
    if (quickAlertTab === 'alerts' && quickSeverityFilter) {
      setSeverityFilter(quickSeverityFilter);
    }
    setSearchQuery('');
  }, [quickSeverityFilter, quickAlertTab, quickSeverityRequestKey]);

  // Realtime tab excludes acknowledged alerts; those live in their own tab.
  const filteredAlerts = alerts.filter((alt) => {
    if (alt.status !== 'active') return false;
    const matchesSev = severityFilter === 'all' || alt.severity === severityFilter;
    const matchesSearch =
      alt.deviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alt.deviceIp.includes(searchQuery) ||
      alt.ruleName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alt.message.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSev && matchesSearch;
  });

  const acknowledgedAlerts = alerts.filter((alt) => alt.status === 'acknowledged');

  const ruleSignature = (rule: AlertRule): string =>
    [
      rule.name,
      rule.metric,
      rule.condition,
      String(rule.threshold),
      rule.unit ?? '',
      rule.scope ?? 'device',
      rule.deviceId ?? '',
      (rule.deviceIds ?? []).join(','),
      rule.groupId ?? '',
      (rule.groupIds ?? []).join(','),
      rule.portId ?? '',
      (rule.portIds ?? []).join(','),
      rule.serviceId ?? '',
      (rule.serviceIds ?? []).join(','),
      rule.sensorId ?? '',
      (rule.sensorIds ?? []).join(','),
      rule.sensorType ?? '',
      rule.osFilter ?? '',
    ].join('::');

  const ruleRows = useMemo(() => {
    const base = alertRules.filter((rule) => ruleSeverityFilter === 'all' || rule.severity === ruleSeverityFilter);
    const bySig = new Map<string, AlertRule[]>();
    for (const rule of base) {
      const sig = ruleSignature(rule);
      const arr = bySig.get(sig) ?? [];
      arr.push(rule);
      bySig.set(sig, arr);
    }

    const rows: Array<{ rule: AlertRule; appliedSiteIds: string[] }> = [];
    for (const rules of bySig.values()) {
      const appliedSiteIds = rules
        .map((r) => r.siteId ?? null)
        .filter((id): id is string => !!id);

      if (selectedSiteId === null) {
        const template = rules.find((r) => !r.siteId);
        if (template) {
          rows.push({ rule: template, appliedSiteIds });
          continue;
        }
      }

      for (const rule of rules) {
        rows.push({ rule, appliedSiteIds: rule.siteId ? [rule.siteId] : appliedSiteIds });
      }
    }

    return rows;
  }, [alertRules, ruleSeverityFilter, selectedSiteId]);

  const filteredRuleRows = useMemo(() => {
    const q = ruleSearchQuery.trim().toLowerCase();
    if (!q) return ruleRows;
    return ruleRows.filter(({ rule, appliedSiteIds }) => {
      const siteLabels = appliedSiteIds.map((id) => siteNameById.get(id) ?? id).join(' ');
      const haystack = [
        rule.name,
        rule.description ?? '',
        rule.metric,
        rule.scope ?? 'device',
        rule.groupName ?? '',
        (rule.groupNames ?? []).join(' '),
        rule.deviceName ?? '',
        rule.serviceName ?? '',
        rule.serviceTarget ?? '',
        rule.portName ?? '',
        rule.sensorLabel ?? '',
        rule.sensorType ?? '',
        rule.osFilter ?? '',
        String(rule.threshold),
        rule.unit ?? '',
        siteLabels,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [ruleRows, ruleSearchQuery, siteNameById]);

  const openApplyDialog = (rule: AlertRule) => {
    if (!canApplyRulesAcrossSites) return;
    const sig = ruleSignature(rule);
    const existingSiteIds = alertRules
      .filter((r) => ruleSignature(r) === sig)
      .map((r) => r.siteId ?? null)
      .filter((id): id is string => !!id);

    const uniqueSiteIds = [...new Set(existingSiteIds)];
    setApplyingRule(rule);
    setApplySiteIds(uniqueSiteIds);
    setApplyIncludeTargets(false);
  };

  const toggleApplySite = (siteId: string) => {
    setApplySiteIds((prev) => (prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]));
  };

  const submitApplySites = async () => {
    if (!applyingRule || applySubmittingRef.current) return;
    try {
      applySubmittingRef.current = true;
      setApplySubmitting(true);
      const result = await onApplyRuleSites(applyingRule.id, {
        siteIds: applySiteIds,
        copyTargets: applyIncludeTargets,
      });
      window.alert(
        `Đã cập nhật trụ sở áp dụng: ${result.appliedSiteIds.length} trụ sở. Tạo mới ${result.created}, cập nhật ${result.updated}, dọn trùng ${result.deduplicated}, gỡ áp dụng ${result.removed}.`,
      );
      setApplyingRule(null);
      setApplySiteIds([]);
    } catch (err) {
      console.error('Failed to apply rule sites', err);
      window.alert('Không thể cập nhật trụ sở áp dụng cho quy tắc này.');
    } finally {
      applySubmittingRef.current = false;
      setApplySubmitting(false);
    }
  };

  const applyRuleToAllSitesQuick = async (rule: AlertRule) => {
    if (!canApplyRulesAcrossSites) return;
    if (allSiteIds.length === 0) {
      window.alert('Hiện chưa có trụ sở nào để áp dụng.');
      return;
    }
    if (quickApplyRuleId) return;

    const ok = window.confirm(`Áp dụng rule "${rule.name}" cho tất cả ${allSiteIds.length} trụ sở?`);
    if (!ok) return;

    try {
      setQuickApplyRuleId(rule.id);
      const result = await onApplyRuleSites(rule.id, { siteIds: allSiteIds, copyTargets: false });
      window.alert(
        `Đã áp dụng cho tất cả trụ sở. Tạo mới ${result.created}, cập nhật ${result.updated}, dọn trùng ${result.deduplicated}, gỡ áp dụng ${result.removed}.`,
      );
    } catch (err) {
      console.error('Failed to apply rule to all sites', err);
      window.alert('Không thể áp dụng rule cho tất cả trụ sở.');
    } finally {
      setQuickApplyRuleId(null);
    }
  };

  const getSeverityBadge = (sev: AlertSeverity) => {
    switch (sev) {
      case 'critical':
        return <span className="px-2 py-0.5 rounded text-xs font-bold uppercase font-mono bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">🔴 CRITICAL</span>;
      case 'high':
        return <span className="px-2 py-0.5 rounded text-xs font-bold uppercase font-mono bg-orange-500/20 text-orange-400 border border-orange-500/40">🟠 HIGH</span>;
      case 'medium':
        return <span className="px-2 py-0.5 rounded text-xs font-bold uppercase font-mono bg-amber-500/20 text-amber-400 border border-amber-500/40">🟡 MEDIUM</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-bold uppercase font-mono bg-sky-500/20 text-sky-400 border border-sky-500/40">🔵 LOW</span>;
    }
  };

  const renderAlertCard = (alt: NetworkAlert) => (
    <div
      key={alt.id}
      className={`p-4 rounded-xl border transition-all ${
        alt.severity === 'critical'
          ? 'bg-red-950/20 border-red-500/40 text-slate-100'
          : alt.severity === 'high'
          ? 'bg-orange-950/20 border-orange-500/40 text-slate-100'
          : darkMode
          ? 'bg-slate-900 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start space-x-3">
          <div className="mt-0.5">{getSeverityBadge(alt.severity)}</div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="font-bold text-sm font-mono text-slate-100">{alt.deviceName}</h4>
              <span className="text-xs font-mono text-emerald-400">({alt.deviceIp})</span>
              {alt.interfaceName && (
                <span className="text-xs font-mono text-slate-300">• Đối tượng: {alt.interfaceName}</span>
              )}
            </div>
            <p className="text-xs font-semibold text-amber-400 mt-0.5">{alt.ruleName}</p>
            <p className="text-xs text-slate-300 mt-1">{alt.message}</p>
            <div className="flex items-center space-x-4 mt-2 text-xs font-mono text-slate-400">
              <span>⏱ Xuất hiện: {alt.timestamp}</span>
              {alt.metricValue && <span>Giá trị: {alt.metricValue}</span>}
              {alt.acknowledgedBy && (
                <span className="text-emerald-400">✓ Đã xác nhận bởi: {alt.acknowledgedBy} ({alt.acknowledgedAt})</span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-2 self-end sm:self-center">
          {alt.status === 'active' && (
            <button
              onClick={() => onAcknowledge(alt.id)}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Xác nhận</span>
            </button>
          )}

          {alt.status !== 'resolved' && (
            <button
              onClick={() => onResolve(alt.id)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700"
            >
              Giải quyết
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header & Sub-Tabs */}
      <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-center space-x-2 font-mono text-xs">
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'alerts'
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'text-slate-300 hover:text-slate-200'
            }`}
          >
            🚨 Cảnh báo Thời gian thực ({alerts.filter((a) => a.status === 'active').length})
          </button>
          <button
            onClick={() => setActiveTab('acknowledged')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'acknowledged'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-slate-300 hover:text-slate-200'
            }`}
          >
            ✅ Đã xác nhận ({acknowledgedAlerts.length})
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'rules'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-300 hover:text-slate-200'
            }`}
          >
            ⚙️ Quy tắc Cảnh báo ({alertRules.length})
          </button>
          <button
            onClick={() => setActiveTab('syslog')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'syslog'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'text-slate-300 hover:text-slate-200'
            }`}
          >
            📜 Nhật ký Syslog & SNMP Trap ({eventLogs.length})
          </button>
        </div>
      </div>

      {/* Tab 1: Active Alerts Console */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          
          {/* Filters Toolbar */}
          <div className={`p-4 rounded-xl border flex flex-wrap items-center gap-3 ${
            darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="relative min-w-[200px] flex-1">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-300" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Lọc thiết bị, quy tắc, nội dung cảnh báo..."
                className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className={`text-xs py-1.5 px-3 rounded-lg border font-mono cursor-pointer ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              <option value="all">Mức độ: Tất cả</option>
              <option value="critical">🔴 Critical (Nguy hiểm)</option>
              <option value="high">🟠 High (Cao)</option>
              <option value="medium">🟡 Medium (Trung bình)</option>
              <option value="low">🔵 Low (Thấp)</option>
            </select>

            <button
              onClick={onAcknowledgeAll}
              disabled={alerts.filter((a) => a.status === 'active').length === 0}
              className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Xác nhận tất cả ({alerts.filter((a) => a.status === 'active').length})</span>
            </button>
          </div>

          {/* Alerts List */}
          <div className="space-y-3">
            {filteredAlerts.length === 0 ? (
              <div className={`p-8 rounded-xl border text-center ${
                darkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <CheckCircle className="w-8 h-8 mx-auto text-emerald-400 mb-2" />
                <p className="font-bold text-sm">Không có cảnh báo nào thuộc bộ lọc này.</p>
                <p className="text-xs mt-1">Hệ thống hoạt động bình thường.</p>
              </div>
            ) : (
              filteredAlerts.map((alt) => (
                <div
                  key={alt.id}
                  className={`p-4 rounded-xl border transition-all ${
                    alt.severity === 'critical'
                      ? 'bg-red-950/20 border-red-500/40 text-slate-100'
                      : alt.severity === 'high'
                      ? 'bg-orange-950/20 border-orange-500/40 text-slate-100'
                      : darkMode
                      ? 'bg-slate-900 border-slate-800 text-slate-100'
                      : 'bg-white border-slate-200 text-slate-900'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start space-x-3">
                      <div className="mt-0.5">{getSeverityBadge(alt.severity)}</div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="font-bold text-sm font-mono text-slate-100">{alt.deviceName}</h4>
                          <span className="text-xs font-mono text-emerald-400">({alt.deviceIp})</span>
                          {alt.interfaceName && (
                            <span className="text-xs font-mono text-slate-300">• Đối tượng: {alt.interfaceName}</span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-amber-400 mt-0.5">{alt.ruleName}</p>
                        <p className="text-xs text-slate-300 mt-1">{alt.message}</p>
                        <div className="flex items-center space-x-4 mt-2 text-xs font-mono text-slate-400">
                          <span>⏱ Xuất hiện: {alt.timestamp}</span>
                          {alt.metricValue && <span>Giá trị: {alt.metricValue}</span>}
                          {alt.acknowledgedBy && (
                            <span className="text-emerald-400">✓ Đã xác nhận bởi: {alt.acknowledgedBy} ({alt.acknowledgedAt})</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center space-x-2 self-end sm:self-center">
                      {alt.status === 'active' && (
                        <button
                          onClick={() => onAcknowledge(alt.id)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Xác nhận</span>
                        </button>
                      )}

                      {alt.status !== 'resolved' && (
                        <button
                          onClick={() => onResolve(alt.id)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700"
                        >
                          Giải quyết
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab: Acknowledged Alerts */}
      {activeTab === 'acknowledged' && (
        <div className="space-y-4">
          <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            darkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
          }`}>
            <p className="text-xs">
              Các cảnh báo đã xác nhận vẫn đang được theo dõi. Chúng chỉ biến mất khi sự cố được khắc phục hoặc khi quy tắc cảnh báo bị tắt.
            </p>
            <button
              onClick={onResolveAllAcknowledged}
              disabled={acknowledgedAlerts.length === 0}
              className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Giải quyết tất cả ({acknowledgedAlerts.length})</span>
            </button>
          </div>

          <div className="space-y-3">
            {acknowledgedAlerts.length === 0 ? (
              <div className={`p-8 rounded-xl border text-center ${
                darkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <CheckCircle className="w-8 h-8 mx-auto text-emerald-400 mb-2" />
                <p className="font-bold text-sm">Chưa có cảnh báo nào được xác nhận.</p>
              </div>
            ) : (
              acknowledgedAlerts.map(renderAlertCard)
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Alert Rules */}
      {activeTab === 'rules' && (
        <div className={`p-5 rounded-xl border ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        }`}>
          <div className="mb-4 space-y-3">
            <div>
              <h3 className="font-bold text-sm tracking-wide">Cấu hình Quy tắc Cảnh báo LibreNMS</h3>
              <p className="text-xs text-slate-300">Quản lý ngưỡng kích hoạt cảnh báo SNMP Polling và ICMP Health Checks</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px_auto] gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-300" />
                <input
                  value={ruleSearchQuery}
                  onChange={(e) => setRuleSearchQuery(e.target.value)}
                  placeholder="Tìm rule theo tên, metric, thiết bị, nhóm, trụ sở..."
                  className={`w-full rounded-lg border pl-9 pr-3 py-2 text-xs font-mono ${
                    darkMode ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-400' : 'bg-slate-50 border-slate-300 text-slate-700 placeholder:text-slate-300'
                  }`}
                />
              </div>
              <select
                value={ruleSeverityFilter}
                onChange={(e) => setRuleSeverityFilter(e.target.value)}
                className={`text-xs py-2 px-3 rounded-lg border font-mono cursor-pointer ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-700'
                }`}
              >
                <option value="all">Mức độ: Tất cả</option>
                <option value="critical">🔴 Critical (Nguy hiểm)</option>
                <option value="high">🟠 High (Cao)</option>
                <option value="medium">🟡 Medium (Trung bình)</option>
                <option value="low">🔵 Low (Thấp)</option>
              </select>
              <button
                onClick={() => { setEditingRule(null); setShowRuleForm(true); }}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm quy tắc
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {alertRules.length === 0 ? (
              <div className={`p-8 rounded-xl border text-center ${
                darkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <ShieldAlert className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-bold text-sm">Chưa có quy tắc cảnh báo nào.</p>
              </div>
            ) : ruleRows.length === 0 ? (
              <div className={`p-8 rounded-xl border text-center ${
                darkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <Filter className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-bold text-sm">Không có quy tắc nào ở mức độ này.</p>
              </div>
            ) : filteredRuleRows.length === 0 ? (
              <div className={`p-8 rounded-xl border text-center ${
                darkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <Search className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-bold text-sm">Không tìm thấy quy tắc phù hợp với từ khóa.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3">
                {filteredRuleRows.map(({ rule, appliedSiteIds }) => (
                  <div
                    key={rule.id}
                    className={`p-4 rounded-xl border font-mono ${
                      darkMode ? 'bg-slate-800/60 border-slate-700/80' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-xs text-slate-200 leading-5">{rule.name}</h4>
                        <p className="text-xs text-slate-300 mt-1 leading-4 max-h-8 overflow-hidden">{rule.description || 'Không có mô tả'}</p>
                      </div>
                      <div className="shrink-0">{getSeverityBadge(rule.severity)}</div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rule.scope === 'interface' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-cyan-500/20 text-cyan-400">Theo cổng</span>
                      )}
                      {rule.scope === 'sensor' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-violet-500/20 text-violet-400">Theo đối tượng</span>
                      )}
                      {rule.scope === 'service' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-fuchsia-500/20 text-fuchsia-300">Theo dịch vụ</span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${rule.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-300'}`}>
                        {rule.enabled ? 'Đang bật' : 'Đã tắt'}
                      </span>
                    </div>

                    <div className="mt-2 space-y-1.5 text-xs">
                      <p className="text-emerald-400 leading-4">
                        Ngưỡng: {rule.scope === 'sensor'
                          ? `Đối tượng [${rule.sensorType ? `${sensorTypeLabel(rule.sensorType)} (toàn bộ)` : rule.sensorIds && rule.sensorIds.length > 1 ? `${rule.sensorIds.length} đối tượng` : rule.sensorLabel ?? '—'}]`
                          : `Metric [${rule.metric}]`} {rule.condition} {rule.threshold} {rule.unit}
                      </p>
                      <p className="text-slate-400 leading-4">
                        Áp dụng: {rule.sensorType
                          ? rule.osFilter
                            ? `Máy chủ ${rule.osFilter}`
                            : 'Mọi thiết bị'
                          : rule.scope === 'service'
                          ? rule.serviceName
                            ? `${rule.serviceName}${rule.serviceTarget ? ` (${rule.serviceTarget})` : ''}`
                            : 'Mọi dịch vụ'
                          : rule.groupNames && rule.groupNames.length > 0
                          ? `Nhóm ${rule.groupNames.join(', ')}`
                          : rule.groupName
                          ? `Nhóm ${rule.groupName}`
                          : rule.deviceName ?? 'Mọi thiết bị'}
                        {rule.scope === 'interface' && (rule.portIds && rule.portIds.length > 0
                          ? ` / ${rule.portIds.length} cổng`
                          : rule.portName
                          ? ` / ${rule.portName}`
                          : ' / Mọi cổng')}
                      </p>
                      <p className="text-cyan-300 leading-4">
                        Trụ sở áp dụng: {appliedSiteIds.length > 0
                          ? appliedSiteIds.map((id) => siteNameById.get(id) ?? id).join(', ')
                          : 'Chưa áp dụng trụ sở nào'}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-700/70 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => onToggleRule(rule.id)}
                          className="w-4 h-4 accent-emerald-500 cursor-pointer"
                        />
                        Bật rule
                      </label>
                      <div className="flex items-center gap-2">
                        {canApplyRulesAcrossSites && (
                          <>
                            <button
                              onClick={() => applyRuleToAllSitesQuick(rule)}
                              disabled={!!quickApplyRuleId}
                              className="text-slate-400 hover:text-amber-300 disabled:opacity-50 text-xs"
                              title="Áp dụng nhanh cho tất cả trụ sở"
                            >
                              ALL
                            </button>
                            <button
                              onClick={() => openApplyDialog(rule)}
                              className="text-slate-400 hover:text-emerald-400"
                              title="Chọn trụ sở áp dụng"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setEditingRule(rule); setShowRuleForm(true); }}
                          className="text-slate-400 hover:text-sky-400"
                          title="Sửa quy tắc"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteRule(rule.id)}
                          className="text-slate-400 hover:text-red-400"
                          title="Xóa quy tắc"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Syslog & Event Logs (device-scoped view with filters + pagination) */}
      {activeTab === 'syslog' && (
        <SyslogConsole eventLogs={eventLogs} devices={devices} darkMode={darkMode} />
      )}

      {showRuleForm && (
        <AlertRuleForm
          devices={devices}
          services={services}
          sites={sites}
          defaultSiteId={selectedSiteId}
          darkMode={darkMode}
          existingRule={editingRule}
          onClose={() => { setShowRuleForm(false); setEditingRule(null); }}
          onCreate={(input) => {
            onCreateRule(input);
            setShowRuleForm(false);
            setEditingRule(null);
          }}
          onUpdate={(id, input) => {
            onUpdateRule(id, input);
            setShowRuleForm(false);
            setEditingRule(null);
          }}
        />
      )}

      {applyingRule && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !applySubmitting && setApplyingRule(null)}>
          <div
            className={`w-full max-w-xl max-h-[90vh] flex flex-col p-6 rounded-2xl border font-mono shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                <Copy className="w-4 h-4" />
                Chọn trụ sở áp dụng cho quy tắc
              </h3>
              <button onClick={() => !applySubmitting && setApplyingRule(null)} className="text-slate-300 hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>

            <div className="mt-4 text-xs space-y-3 overflow-y-auto">
              <div className={`p-3 rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <p className="text-slate-300">Quy tắc: <span className="text-emerald-400 font-bold">{applyingRule.name}</span></p>
                <p className="text-slate-300 mt-1">Metric: {applyingRule.metric} • Scope: {applyingRule.scope ?? 'device'} • Template quản lý: {(applyingRule.siteId ?? null) ? (siteNameById.get(applyingRule.siteId as string) ?? applyingRule.siteId) : 'toàn cục'}</p>
              </div>

              <div>
                <p className="text-slate-300 mb-2">Chọn các trụ sở cần áp dụng rule:</p>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setApplySiteIds(allSiteIds)}
                    className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() => setApplySiteIds([])}
                    className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Bỏ chọn tất cả
                  </button>
                </div>
                <div className={`max-h-48 overflow-y-auto rounded-lg border p-2 space-y-2 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  {sites.length === 0 ? (
                    <p className="text-slate-400 px-1 py-2">Không có trụ sở đích hợp lệ.</p>
                  ) : (
                    sites
                      .map((site) => (
                        <label key={site.id} className="flex items-center gap-2 px-1 py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={applySiteIds.includes(site.id)}
                            onChange={() => toggleApplySite(site.id)}
                            className="w-4 h-4 accent-emerald-500"
                          />
                          <span>{site.name}</span>
                        </label>
                      ))
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={applyIncludeTargets}
                  onChange={(e) => setApplyIncludeTargets(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                Đồng bộ cả target cụ thể (thiết bị/cổng/nhóm/service/sensor)
              </label>

              {!applyIncludeTargets && (
                <p className="text-xs text-amber-400">
                  Khuyến nghị: chỉ bật khi các trụ sở có cùng đối tượng target. Nếu không, rule sẽ áp dụng theo ngưỡng chung.
                </p>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setApplyingRule(null)}
                disabled={applySubmitting}
                className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={submitApplySites}
                disabled={applySubmitting}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50"
              >
                {applySubmitting ? 'Đang cập nhật...' : 'Lưu trụ sở áp dụng'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// --- Alert rule creation/edit modal (device/group targeting + multi-port) ---
interface AlertRuleFormProps {
  devices: NetworkDevice[];
  services: ServiceCheck[];
  sites?: SiteInfo[];
  defaultSiteId?: string | null;
  darkMode: boolean;
  existingRule?: AlertRule | null;
  prefillDeviceId?: string;
  prefillMetric?: AlertMetric;
  onClose: () => void;
  onCreate: (input: AlertRuleInput) => void;
  onUpdate: (id: string, input: AlertRuleInput) => void;
}

type Operator = '>' | '<' | '==' | '!=';

interface MetricState {
  label: string;
  condition: Operator;
  threshold: number;
}

interface MetricConfig {
  label: string;
  unit: string;
  interface: boolean;
  service?: boolean;
  // 'object' rules target one specific discovered sensor/component of a device.
  object?: boolean;
  // 'threshold' shows operator + numeric input; 'state' shows a state picker.
  kind: 'threshold' | 'state';
  operators?: Operator[];
  defaultCondition?: Operator;
  defaultThreshold?: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  states?: MetricState[];
}

const METRIC_CONFIG: Record<AlertMetric, MetricConfig> = {
  cpu: { label: 'CPU (%)', unit: '%', interface: false, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 85, min: 0, max: 100, step: 1, hint: 'Cảnh báo khi CPU vượt ngưỡng %.' },
  memory: { label: 'RAM (%)', unit: '%', interface: false, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 80, min: 0, max: 100, step: 1, hint: 'Cảnh báo khi RAM vượt ngưỡng %.' },
  ping: { label: 'Ping (ms)', unit: 'ms', interface: false, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 100, min: 0, step: 1, hint: 'Cảnh báo khi độ trễ ping cao.' },
  temperature: { label: 'Nhiệt độ (°C)', unit: '°C', interface: false, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 65, min: 0, step: 1, hint: 'Cảnh báo khi nhiệt độ vượt ngưỡng.' },
  packet_loss: { label: 'Mất gói ping (%)', unit: '%', interface: false, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 5, min: 0, max: 100, step: 1, hint: 'Cảnh báo khi tỉ lệ mất gói vượt ngưỡng.' },
  uptime: { label: 'Uptime (giây)', unit: 's', interface: false, kind: 'threshold', operators: ['<', '>'], defaultCondition: '<', defaultThreshold: 600, min: 0, step: 1, hint: 'Uptime < 600s: phát hiện thiết bị vừa khởi động lại.' },
  device_status: {
    label: 'Trạng thái thiết bị', unit: '', interface: false, kind: 'state',
    states: [
      { label: 'Thiết bị Down (mất kết nối)', condition: '>', threshold: 0 },
      { label: 'Thiết bị Up (khôi phục)', condition: '==', threshold: 0 },
    ],
  },
  bgp_session: {
    label: 'BGP session', unit: '', interface: false, kind: 'state',
    states: [{ label: 'BGP session Down', condition: '>', threshold: 0 }],
  },
  interface_traffic_in: { label: 'Traffic vào cổng (Mbps)', unit: 'Mbps', interface: true, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 800, min: 0, step: 1, hint: 'Cảnh báo khi lưu lượng vào vượt ngưỡng Mbps.' },
  interface_traffic_out: { label: 'Traffic ra cổng (Mbps)', unit: 'Mbps', interface: true, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 800, min: 0, step: 1, hint: 'Cảnh báo khi lưu lượng ra vượt ngưỡng Mbps.' },
  interface_traffic: { label: 'Traffic cổng (Mbps)', unit: 'Mbps', interface: true, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 800, min: 0, step: 1 },
  interface_utilization: { label: 'Mức sử dụng cổng (%)', unit: '%', interface: true, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 90, min: 0, max: 100, step: 1, hint: 'Cảnh báo khi mức sử dụng cổng vượt ngưỡng %.' },
  interface_status: {
    label: 'Trạng thái cổng', unit: '', interface: true, kind: 'state',
    states: [
      { label: 'Cổng Down', condition: '>', threshold: 0 },
      { label: 'Cổng Up (khôi phục)', condition: '==', threshold: 0 },
    ],
  },
  interface_errors: { label: 'Lỗi cổng / lần quét', unit: 'lỗi', interface: true, kind: 'threshold', operators: ['>'], defaultCondition: '>', defaultThreshold: 100, min: 0, step: 1, hint: 'Số lỗi tăng thêm giữa 2 lần quét vượt ngưỡng.' },
  interface_discards: { label: 'Gói loại bỏ / lần quét', unit: 'gói', interface: true, kind: 'threshold', operators: ['>'], defaultCondition: '>', defaultThreshold: 100, min: 0, step: 1, hint: 'Số gói bị loại bỏ tăng thêm giữa 2 lần quét (nghẽn).' },
  sensor_value: { label: 'Ngưỡng đối tượng/cảm biến', unit: '', interface: false, object: true, kind: 'threshold', operators: ['>', '<', '==', '!='], defaultCondition: '>', defaultThreshold: 0, step: 0.1, hint: 'Chọn một hoặc nhiều đối tượng cùng đơn vị của thiết bị (vd: tất cả ổ đĩa %). Ngưỡng gợi ý tự điền theo loại.' },
  service_status: {
    label: 'Trạng thái dịch vụ', unit: '', interface: false, service: true, kind: 'state',
    states: [
      { label: 'Dịch vụ Down (lỗi kết nối)', condition: '>', threshold: 0 },
      { label: 'Dịch vụ Up (khôi phục)', condition: '==', threshold: 0 },
    ],
  },
  service_response_time: {
    label: 'Thời gian phản hồi dịch vụ (ms)', unit: 'ms', interface: false, service: true, kind: 'threshold', operators: ['>', '<'], defaultCondition: '>', defaultThreshold: 1000, min: 0, step: 1,
    hint: 'Cảnh báo khi dịch vụ phản hồi chậm vượt ngưỡng.',
  },
  service_uptime: {
    label: 'Uptime dịch vụ (%)', unit: '%', interface: false, service: true, kind: 'threshold', operators: ['<', '>'], defaultCondition: '<', defaultThreshold: 99, min: 0, max: 100, step: 0.1,
    hint: 'Cảnh báo khi độ sẵn sàng dịch vụ thấp hơn ngưỡng.',
  },
  port_security_trap: {
    label: 'Port Security (SNMP Trap)',
    unit: '',
    interface: true,
    kind: 'state',
    states: [{ label: 'Port-security violation', condition: '==', threshold: 1 }],
  },
};

// Friendly Vietnamese labels + suggested threshold/condition per discovered sensor type.
// Drives the auto-suggested options for object rules (disk full, UPS battery low, ...).
const SENSOR_TYPE_META: Record<string, { label: string; unit?: string; condition?: Operator; threshold?: number }> = {
  disk: { label: 'Ổ đĩa (%)', unit: '%', condition: '>', threshold: 85 },
  memory: { label: 'Bộ nhớ / Swap (%)', unit: '%', condition: '>', threshold: 90 },
  cpu: { label: 'CPU (%)', unit: '%', condition: '>', threshold: 85 },
  battery: { label: 'Pin UPS (%)', unit: '%', condition: '<', threshold: 20 },
  runtime: { label: 'Thời gian chạy pin', unit: 'phút', condition: '<', threshold: 15 },
  load: { label: 'Tải (%)', unit: '%', condition: '>', threshold: 90 },
  temperature: { label: 'Nhiệt độ (°C)', unit: '°C', condition: '>', threshold: 65 },
  humidity: { label: 'Độ ẩm (%)', unit: '%', condition: '>', threshold: 70 },
  fan: { label: 'Quạt (rpm)', unit: 'rpm', condition: '<', threshold: 500 },
  voltage: { label: 'Điện áp (V)', unit: 'V' },
  current: { label: 'Dòng điện (A)', unit: 'A' },
  power: { label: 'Công suất (W)', unit: 'W' },
  frequency: { label: 'Tần số (Hz)', unit: 'Hz' },
  airflow: { label: 'Luồng khí' },
  state: { label: 'Trạng thái', condition: '==', threshold: 1 },
};

const sensorTypeLabel = (type: string): string => SENSOR_TYPE_META[type]?.label ?? type;

const OPERATOR_LABEL: Record<Operator, string> = {
  '>': '> Lớn hơn',
  '<': '< Nhỏ hơn',
  '==': '== Bằng',
  '!=': '!= Khác',
};

export const AlertRuleForm: React.FC<AlertRuleFormProps> = ({ devices, services, sites = [], defaultSiteId = null, darkMode, existingRule, prefillDeviceId, prefillMetric, onClose, onCreate, onUpdate }) => {
  const editing = !!existingRule;
  const initMetric = (existingRule?.metric as AlertMetric) ?? prefillMetric ?? 'interface_traffic_in';
  const initCfg = METRIC_CONFIG[initMetric];

  const [name, setName] = useState(existingRule?.name ?? '');
  const [metric, setMetric] = useState<AlertMetric>(initMetric);
  const [condition, setCondition] = useState<Operator>((existingRule?.condition as Operator) ?? initCfg.defaultCondition ?? '>');
  const [threshold, setThreshold] = useState<number>(existingRule?.threshold ?? initCfg.defaultThreshold ?? 800);
  const [stateIndex, setStateIndex] = useState<number>(() => {
    if (existingRule && initCfg.kind === 'state' && initCfg.states) {
      const i = initCfg.states.findIndex((s) => s.condition === existingRule.condition && s.threshold === existingRule.threshold);
      return i >= 0 ? i : 0;
    }
    return 0;
  });
  const [severity, setSeverity] = useState<AlertSeverity>(existingRule?.severity ?? 'high');
  const [description, setDescription] = useState(existingRule?.description ?? '');
  const [siteId, setSiteId] = useState<string>(existingRule?.siteId ?? defaultSiteId ?? '');

  // Targeting: all devices, a group, or one specific device (with optional ports).
  const [targetKind, setTargetKind] = useState<'all' | 'group' | 'device'>(
    existingRule?.groupId || (existingRule?.groupIds && existingRule.groupIds.length > 0)
      ? 'group'
      : existingRule?.deviceId || prefillDeviceId
      ? 'device'
      : 'all',
  );
  const [deviceId, setDeviceId] = useState(existingRule?.deviceId ?? prefillDeviceId ?? '');
  const [groupIds, setGroupIds] = useState<string[]>(
    existingRule?.groupIds && existingRule.groupIds.length > 0
      ? existingRule.groupIds
      : existingRule?.groupId
      ? [existingRule.groupId]
      : [],
  );
  const [serviceTargetKind, setServiceTargetKind] = useState<'all' | 'service'>(existingRule?.serviceId ? 'service' : 'all');
  const [serviceId, setServiceId] = useState(existingRule?.serviceId ?? '');
  const [portIds, setPortIds] = useState<string[]>(
    existingRule?.portIds && existingRule.portIds.length > 0
      ? existingRule.portIds
      : existingRule?.portId
      ? [existingRule.portId]
      : [],
  );

  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [showPortPicker, setShowPortPicker] = useState(false);
  // Object rule targeting: 'device' = one specific device, 'group' = all devices in a group.
  const [objectTargetKind, setObjectTargetKind] = useState<'device' | 'group'>(
    existingRule?.groupId || (existingRule?.groupIds && existingRule.groupIds.length > 0) ? 'group' : 'device',
  );
  // Per-object (sensor) targeting: several same-unit sensors + the device's sensor list.
  const [sensorIds, setSensorIds] = useState<string[]>(
    existingRule?.sensorIds && existingRule.sensorIds.length > 0
      ? existingRule.sensorIds
      : existingRule?.sensorId
      ? [existingRule.sensorId]
      : [],
  );
  const [deviceSensors, setDeviceSensors] = useState<DeviceSensor[]>([]);
  // Object rules have two targeting modes:
  //  - 'specific': pick concrete objects on ONE device (existing behaviour)
  //  - 'fleet'   : match EVERY object of a type across all devices, filtered by OS
  //                (e.g. "disk" on all Windows servers). Uses sensorType + osFilter.
  const [objectMode, setObjectMode] = useState<'specific' | 'fleet'>(existingRule?.sensorType ? 'fleet' : 'specific');
  const [sensorType, setSensorType] = useState<string>(existingRule?.sensorType ?? 'disk');
  const [osFilter, setOsFilter] = useState<string>(existingRule?.osFilter ?? '');

  // Distinct OS families discovered across devices, to offer as fleet filters.
  const osOptions = Array.from(new Set(devices.map((d) => d.os).filter((o): o is string => !!o))).sort();

  useEffect(() => {
    api.deviceGroups.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  const config = METRIC_CONFIG[metric];
  const isInterface = config.interface;
  const isService = !!config.service;
  const isObject = !!config.object;
  const isState = config.kind === 'state';
  const lightDevice = devices.find((d) => d.id === deviceId);
  // Fetch full device (with interfaces) for port picker when lightweight list omits them.
  const [fullDevice, setFullDevice] = useState<NetworkDevice | undefined>(undefined);
  useEffect(() => {
    if (!deviceId) { setFullDevice(undefined); return; }
    const cached = devices.find((d) => d.id === deviceId);
    if (cached && cached.interfaces.length > 0) { setFullDevice(cached); return; }
    let cancelled = false;
    api.devices.get(deviceId).then((d) => { if (!cancelled) setFullDevice(d); });
    return () => { cancelled = true; };
  }, [deviceId, devices]);
  const selectedDevice = (fullDevice?.id === deviceId ? fullDevice : undefined) ?? lightDevice;
  // Object rules may target multiple sensors, but ALL must share one unit (one threshold).
  const selectedUnit = sensorIds.length > 0 ? deviceSensors.find((s) => s.id === sensorIds[0])?.unit ?? null : null;
  // Fleet mode = one dynamic rule spanning many devices (by OS), no single device picked.
  const isFleet = isObject && objectMode === 'fleet';

  // Toggle a sensor in/out of the object-rule selection. Enforces same-unit selection and
  // auto-fills the suggested condition/threshold from the first-picked sensor's type.
  const toggleSensor = (s: DeviceSensor) => {
    if (sensorIds.includes(s.id)) {
      setSensorIds(sensorIds.filter((x) => x !== s.id));
      return;
    }
    if (selectedUnit !== null && selectedUnit !== s.unit) return;
    if (sensorIds.length === 0) {
      const meta = SENSOR_TYPE_META[s.type];
      if (meta?.condition) setCondition(meta.condition);
      if (meta?.threshold !== undefined) setThreshold(meta.threshold);
    }
    setSensorIds([...sensorIds, s.id]);
  };

  // Toggle a group in/out of the multi-group selection.
  const toggleGroup = (id: string) => {
    setGroupIds(groupIds.includes(id) ? groupIds.filter((x) => x !== id) : [...groupIds, id]);
  };

  // Apply a sensor type's suggested condition/threshold (used by the fleet-by-OS mode).
  const applyTypePreset = (t: string) => {
    const meta = SENSOR_TYPE_META[t];
    if (meta?.condition) setCondition(meta.condition);
    if (meta?.threshold !== undefined) setThreshold(meta.threshold);
  };
  const handleFleetTypeChange = (t: string) => {
    setSensorType(t);
    applyTypePreset(t);
  };
  const handleObjectModeChange = (m: 'specific' | 'fleet') => {
    setObjectMode(m);
    if (m === 'fleet') applyTypePreset(sensorType);
  };

  // Load the selected device's discovered sensors so an object rule can target one.
  const objectPrimaryDeviceId = deviceId;
  useEffect(() => {
    if (!isObject || !objectPrimaryDeviceId) {
      setDeviceSensors([]);
      return;
    }
    let cancelled = false;
    api.devices
      .get(objectPrimaryDeviceId)
      .then((d) => {
        if (!cancelled) setDeviceSensors(d.sensors ?? []);
      })
      .catch(() => {
        if (!cancelled) setDeviceSensors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isObject, objectPrimaryDeviceId]);

  const inputCls = `w-full p-2 rounded-lg border text-sm ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'}`;

  // Reset condition/threshold to the newly-selected metric's sensible defaults.
  const handleMetricChange = (m: AlertMetric) => {
    const cfg = METRIC_CONFIG[m];
    setMetric(m);
    setStateIndex(0);
    // Object rules always target one specific device (the sensor's owner).
    if (cfg.object) setTargetKind('device');
    if (cfg.service) setTargetKind('all');
    if (cfg.kind === 'state' && cfg.states) {
      setCondition(cfg.states[0].condition);
      setThreshold(cfg.states[0].threshold);
    } else {
      setCondition(cfg.defaultCondition ?? '>');
      setThreshold(cfg.defaultThreshold ?? 0);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    if (isService && serviceTargetKind === 'service' && !serviceId) return;
    if (isObject && objectMode === 'specific' && objectTargetKind === 'device' && (!deviceId || sensorIds.length === 0)) return;
    if (isObject && objectMode === 'specific' && objectTargetKind === 'group' && (groupIds.length === 0 || sensorIds.length === 0)) return;
    if (isObject && objectMode === 'fleet' && !sensorType) return;
    const effCondition = isState && config.states ? config.states[stateIndex].condition : condition;
    const effThreshold = isState && config.states ? config.states[stateIndex].threshold : threshold;
    const input: AlertRuleInput = {
      name,
      metric,
      condition: effCondition,
      threshold: effThreshold,
      unit: isObject
        ? isFleet
          ? SENSOR_TYPE_META[sensorType]?.unit ?? ''
          : selectedUnit ?? ''
        : config.unit,
      severity,
      scope: isService ? 'service' : isObject ? 'sensor' : isInterface ? 'interface' : 'device',
      deviceId: isService ? null : isFleet ? null : isObject ? (objectTargetKind === 'device' ? deviceId || null : null) : targetKind === 'device' ? deviceId || null : null,
      deviceIds: [],
      groupId: isService ? null : isFleet ? null : isObject ? (objectTargetKind === 'group' ? groupIds[0] || null : null) : (!isObject && targetKind === 'group' ? groupIds[0] || null : null),
      groupIds: isService ? [] : isFleet ? [] : isObject ? (objectTargetKind === 'group' ? groupIds : []) : (!isObject && targetKind === 'group' ? groupIds : []),
      siteId: siteId || null,
      serviceId: isService && serviceTargetKind === 'service' ? serviceId || null : null,
      serviceIds: [],
      portId: isService ? null : null,
      portIds: !isService && isInterface && targetKind === 'device' ? portIds : [],
      sensorId: !isService && isObject && !isFleet ? sensorIds[0] ?? null : null,
      sensorIds: !isService && isObject && !isFleet ? sensorIds : [],
      sensorType: !isService && isFleet ? sensorType : null,
      osFilter: !isService && isFleet ? osFilter || null : null,
      // Always follow the global per-severity re-notify default (Cài đặt > Kênh Thông báo).
      renotifyMinutes: 0,
      description: description || undefined,
    };
    if (editing && existingRule) onUpdate(existingRule.id, input);
    else onCreate(input);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[90vh] flex flex-col p-6 rounded-2xl border font-mono shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
            {editing ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {editing ? 'Sửa quy tắc cảnh báo' : 'Thêm quy tắc cảnh báo'}
          </h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="block text-slate-300 mb-1">Tên quy tắc:</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="VD: Cảnh báo traffic uplink > 800 Mbps" required />
          </div>

          <div>
            <label className="block text-slate-300 mb-1">Chỉ số (metric):</label>
            <select value={metric} onChange={(e) => handleMetricChange(e.target.value as AlertMetric)} className={inputCls}>
              <optgroup label="Theo thiết bị">
                <option value="cpu">CPU (%)</option>
                <option value="memory">RAM (%)</option>
                <option value="ping">Ping (ms)</option>
                <option value="temperature">Nhiệt độ (°C)</option>
                <option value="packet_loss">Mất gói ping (%)</option>
                <option value="uptime">Uptime (giây)</option>
                <option value="device_status">Trạng thái thiết bị</option>
              </optgroup>
              <optgroup label="Theo cổng (interface)">
                <option value="interface_traffic_in">Traffic vào cổng (Mbps)</option>
                <option value="interface_traffic_out">Traffic ra cổng (Mbps)</option>
                <option value="interface_utilization">Mức sử dụng cổng (%)</option>
                <option value="interface_status">Cổng down</option>
                <option value="interface_errors">Lỗi cổng / lần quét</option>
                <option value="interface_discards">Gói loại bỏ / lần quét</option>
                <option value="port_security_trap">Port Security (SNMP Trap)</option>
              </optgroup>
              <optgroup label="Theo đối tượng cụ thể">
                <option value="sensor_value">Đối tượng đã phát hiện (ổ đĩa, pin UPS, nhiệt độ, tải...)</option>
              </optgroup>
              <optgroup label="Theo dịch vụ mạng">
                <option value="service_status">Trạng thái dịch vụ (up/down)</option>
                <option value="service_response_time">Thời gian phản hồi dịch vụ (ms)</option>
                <option value="service_uptime">Uptime dịch vụ (%)</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 mb-1">Trụ sở áp dụng:</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputCls}>
              <option value="">Toàn cục / Không gán</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {isState ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">Điều kiện kích hoạt:</label>
                <select value={stateIndex} onChange={(e) => setStateIndex(Number(e.target.value))} className={inputCls}>
                  {config.states!.map((s, idx) => (
                    <option key={idx} value={idx}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Mức độ:</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)} className={inputCls}>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">Điều kiện:</label>
                <select value={condition} onChange={(e) => setCondition(e.target.value as Operator)} className={inputCls}>
                  {(config.operators ?? ['>', '<', '==', '!=']).map((op) => (
                    <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Ngưỡng ({(isObject ? (objectMode === 'fleet' ? SENSOR_TYPE_META[sensorType]?.unit : selectedUnit) : config.unit) || 'giá trị'}):</label>
                <input
                  type="number"
                  step={config.step ?? 'any'}
                  min={config.min}
                  max={config.max}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Mức độ:</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)} className={inputCls}>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
          )}

          {config.hint && <p className="text-xs text-slate-400 -mt-1">💡 {config.hint}</p>}

          {/* Targeting: all / group / specific device (object rules are always device-specific) */}
          {!isObject && !isService && (
            <div>
              <label className="block text-slate-300 mb-1">Phạm vi áp dụng:</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { k: 'all', label: 'Mọi thiết bị' },
                  { k: 'group', label: 'Theo nhóm' },
                  { k: 'device', label: 'Theo thiết bị' },
                ] as const).map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => setTargetKind(opt.k)}
                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      targetKind === opt.k
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : darkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isService && (
            <div className="space-y-2">
              <label className="block text-slate-300 mb-1">Phạm vi dịch vụ:</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { k: 'all', label: 'Mọi dịch vụ' },
                  { k: 'service', label: 'Dịch vụ cụ thể' },
                ] as const).map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => setServiceTargetKind(opt.k)}
                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      serviceTargetKind === opt.k
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : darkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {serviceTargetKind === 'service' && (
                <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputCls} required>
                  <option value="">Chọn dịch vụ...</option>
                  {services.map((svc) => (
                    <option key={svc.id} value={svc.id}>{svc.name} ({svc.type} - {svc.target}{svc.port ? `:${svc.port}` : ''})</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {targetKind === 'group' && (
            <div>
              <label className="block text-slate-300 mb-1">Nhóm thiết bị (chọn nhiều nhóm):</label>
              {groups.length === 0 ? (
                <p className="text-xs text-amber-400">Chưa có nhóm thiết bị nào.</p>
              ) : (
                <div className={`max-h-40 overflow-y-auto rounded-lg border divide-y p-2 space-y-1 ${darkMode ? 'border-slate-700 divide-slate-800' : 'border-slate-300 divide-slate-200'}`}>
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-2 text-xs px-1 py-0.5 rounded cursor-pointer hover:bg-slate-700/30"
                    >
                      <input
                        type="checkbox"
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        className="accent-emerald-500 shrink-0"
                      />
                      <span className="truncate flex-1">{g.name} ({g.deviceCount ?? 0} thiết bị)</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {targetKind === 'device' && !isFleet && !isObject && (
            <div className={`grid ${isInterface ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
              <div>
                <label className="block text-slate-300 mb-1">Thiết bị:</label>
                <DevicePickerButton
                  devices={devices}
                  darkMode={darkMode}
                  value={deviceId}
                  onChange={(id) => { setDeviceId(id); setPortIds([]); setSensorIds([]); }}
                />
              </div>
              {isInterface && (
                <div>
                  <label className="block text-slate-300 mb-1">Cổng áp dụng:</label>
                  <button
                    type="button"
                    onClick={() => selectedDevice && setShowPortPicker(true)}
                    disabled={!selectedDevice}
                    className={`${inputCls} flex items-center justify-between text-left disabled:opacity-50`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Boxes className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{portIds.length === 0 ? 'Mọi cổng của thiết bị' : `${portIds.length} cổng đã chọn`}</span>
                    </span>
                    <Search className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Object rule: specific objects on one device, or a fleet-wide rule by OS */}
          {isObject && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {([
                  { k: 'specific', label: 'Đối tượng cụ thể' },
                  { k: 'fleet', label: 'Tất cả máy chủ theo HĐH' },
                ] as const).map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => handleObjectModeChange(opt.k)}
                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      objectMode === opt.k
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : darkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {objectMode === 'fleet' ? (
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-300 mb-1">Loại đối tượng:</label>
                    <select value={sensorType} onChange={(e) => handleFleetTypeChange(e.target.value)} className={inputCls}>
                      {Object.keys(SENSOR_TYPE_META).map((t) => (
                        <option key={t} value={t}>{SENSOR_TYPE_META[t].label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Hệ điều hành áp dụng:</label>
                    <select value={osFilter} onChange={(e) => setOsFilter(e.target.value)} className={inputCls}>
                      <option value="">Tất cả hệ điều hành</option>
                      {osOptions.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-slate-400">
                    Quy tắc tự áp cho <span className="text-slate-300">mọi {SENSOR_TYPE_META[sensorType]?.label ?? sensorType}</span>{' '}
                    trên {osFilter ? <>các máy chủ <span className="text-slate-300">{osFilter}</span></> : 'tất cả thiết bị'}. Không cần chọn từng đối tượng.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-300 mb-1">Phạm vi áp dụng:</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { k: 'device', label: 'Theo thiết bị' },
                        { k: 'group', label: 'Theo nhóm' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => { setObjectTargetKind(opt.k); setSensorIds([]); }}
                          className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                            objectTargetKind === opt.k
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : darkMode
                              ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                              : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {objectTargetKind === 'device' ? (
                    <div>
                      <label className="block text-slate-300 mb-1">Thiết bị:</label>
                      <DevicePickerButton
                        devices={devices}
                        darkMode={darkMode}
                        value={deviceId}
                        onChange={(id) => { setDeviceId(id); setSensorIds([]); }}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-slate-300 mb-1">Nhóm thiết bị (chọn nhiều nhóm):</label>
                      {groups.length === 0 ? (
                        <p className="text-xs text-amber-400">Chưa có nhóm thiết bị nào.</p>
                      ) : (
                        <div className={`max-h-40 overflow-y-auto rounded-lg border divide-y p-2 space-y-1 ${darkMode ? 'border-slate-700 divide-slate-800' : 'border-slate-300 divide-slate-200'}`}>
                          {groups.map((g) => (
                            <label
                              key={g.id}
                              className="flex items-center gap-2 text-xs px-1 py-0.5 rounded cursor-pointer hover:bg-slate-700/30"
                            >
                              <input
                                type="checkbox"
                                checked={groupIds.includes(g.id)}
                                onChange={() => { toggleGroup(g.id); setSensorIds([]); }}
                                className="accent-emerald-500 shrink-0"
                              />
                              <span className="truncate flex-1">{g.name} ({g.deviceCount ?? 0} thiết bị)</span>
                            </label>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-slate-400 mt-1">Quy tắc áp dụng cho tất cả thiết bị trong nhóm có cùng loại đối tượng.</p>
                    </div>
                  )}
                  <div>
                  <label className="block text-slate-300 mb-1">Đối tượng / cảm biến (chọn nhiều cùng đơn vị):</label>
                  {!deviceId && objectTargetKind === 'device' ? (
                <p className="text-xs text-slate-400">Hãy chọn thiết bị ở trên trước.</p>
              ) : !deviceId && objectTargetKind === 'group' ? (
                <div className="space-y-1">
                  <p className="text-xs text-slate-400">Chọn 1 thiết bị đại diện nhóm để xem đối tượng khả dụng:</p>
                  <DevicePickerButton
                    devices={devices}
                    darkMode={darkMode}
                    value={deviceId}
                    onChange={(id) => { setDeviceId(id); setSensorIds([]); }}
                  />
                </div>
              ) : deviceSensors.length === 0 ? (
                <p className="text-xs text-amber-400">Thiết bị chưa có cảm biến/đối tượng nào. Nhấn "Quét SNMP" và chờ một chu kỳ thu thập.</p>
              ) : (
                <>
                  <div className={`max-h-40 overflow-y-auto rounded-lg border divide-y ${darkMode ? 'border-slate-700 divide-slate-800' : 'border-slate-300 divide-slate-200'}`}>
                    {Array.from(new Set(deviceSensors.map((s) => s.type))).map((t: string) => (
                      <div key={t} className="p-2">
                        <p className="text-xs font-semibold text-emerald-400 mb-1">{sensorTypeLabel(t)}</p>
                        <div className="space-y-1">
                          {deviceSensors
                            .filter((s) => s.type === t)
                            .map((s) => {
                              const checked = sensorIds.includes(s.id);
                              const disabled = !checked && selectedUnit !== null && selectedUnit !== s.unit;
                              return (
                                <label
                                  key={s.id}
                                  className={`flex items-center gap-2 text-xs px-1 py-0.5 rounded ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-700/30'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={() => toggleSensor(s)}
                                    className="accent-emerald-500 shrink-0"
                                  />
                                  <span className="truncate flex-1">{s.description}</span>
                                  {s.value !== null && s.value !== undefined && (
                                    <span className="text-slate-400 shrink-0">{s.value}{s.unit}</span>
                                  )}
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {sensorIds.length > 0
                      ? <>Đã chọn <span className="text-slate-300">{sensorIds.length}</span> đối tượng (đơn vị <span className="text-slate-300">{selectedUnit || '—'}</span>). Chỉ chọn được đối tượng cùng đơn vị.</>
                      : 'Chỉ có thể chọn các đối tượng cùng đơn vị trong một quy tắc (vd: đều là %).'}
                  </p>
                </>
              )}
                </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-slate-300 mb-1">Mô tả (tùy chọn):</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300">Hủy</button>
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
              {editing ? 'Lưu thay đổi' : 'Tạo quy tắc'}
            </button>
          </div>
        </form>
      </div>

      {showPortPicker && selectedDevice && (
        <PortPickerModal
          device={selectedDevice}
          darkMode={darkMode}
          selectedIds={portIds}
          onApply={(ids) => { setPortIds(ids); setShowPortPicker(false); }}
          onClose={() => setShowPortPicker(false)}
        />
      )}
    </div>
  );
};

// --- Port picker: multi-select with status/text filters and select-all ---
interface PortPickerModalProps {
  device: NetworkDevice;
  darkMode: boolean;
  selectedIds: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}

const PortPickerModal: React.FC<PortPickerModalProps> = ({ device, darkMode, selectedIds, onApply, onClose }) => {
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedIds));

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

  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => picked.has(i.id));

  const toggle = (id: string) => {
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
      if (allFilteredSelected) filtered.forEach((i) => next.delete(i.id));
      else filtered.forEach((i) => next.add(i.id));
      return next;
    });
  };

  const inputCls = `text-xs py-1.5 px-3 rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'}`;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><Boxes className="w-4 h-4 text-cyan-400" /> Chọn cổng — {device.name}</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-800">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 absolute left-3 top-2 text-slate-300" />
            <input
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
          <button type="button" onClick={toggleAllFiltered} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">
            {allFilteredSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
        </div>

        <div className="p-3 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-400 p-3 text-center">Không có cổng phù hợp bộ lọc.</p>
          ) : (
            filtered.map((i) => (
              <label
                key={i.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  picked.has(i.id)
                    ? 'bg-cyan-500/10 border-cyan-500/40'
                    : darkMode
                    ? 'bg-slate-800/50 border-slate-700/70 hover:bg-slate-800'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} className="w-4 h-4 accent-cyan-500" />
                <span className={`w-2 h-2 rounded-full shrink-0 ${i.operStatus === 'up' ? 'bg-emerald-400' : i.operStatus === 'down' ? 'bg-red-400' : 'bg-amber-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{i.name}</div>
                  <div className="text-xs text-slate-300 truncate">{i.alias || i.description || '—'} • {i.speed}</div>
                </div>
                <span className="text-xs font-mono uppercase text-slate-400 shrink-0">{i.operStatus}</span>
              </label>
            ))
          )}
        </div>

        <div className="p-3 border-t border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-300">Đã chọn: {picked.size} cổng {picked.size === 0 ? '(→ áp dụng mọi cổng)' : ''}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onApply([])} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs">Mọi cổng</button>
            <button type="button" onClick={() => onApply(Array.from(picked))} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold">Áp dụng</button>
          </div>
        </div>
      </div>
    </div>
  );
};
