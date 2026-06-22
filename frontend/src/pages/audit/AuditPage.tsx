import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
  ScrollText,
  Filter,
  X,
} from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { FINANCE_FONT, PRIMARY } from '../../lib/financeUtils';
import {
  auditDocumentLink,
  auditReferenceLabel,
  auditModuleBadgeClass,
  auditActionBadgeClass,
  computeAuditDiff,
  formatAuditJson,
} from '../../lib/auditUtils';

const HEADER_BG = PRIMARY;

type AuditSummary = {
  total: number;
  today: number;
  by_module: Array<{ module: string; count: number }>;
  top_actions: Array<{ action: string; count: number }>;
};

const EMPTY_FILTERS = { module: '', action: '', from: '', to: '', search: '' };

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<AuditSummary | null>(null);

  useEffect(() => {
    api.get('/audit/modules').then((r) => setModules(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const params = filters.module ? `?module=${encodeURIComponent(filters.module)}` : '';
    api.get(`/audit/actions${params}`)
      .then((r) => setActions(r.data || []))
      .catch(() => {});
  }, [filters.module]);

  const loadData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString(), limit: '50' });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

    Promise.all([
      api.get(`/audit?${params}`),
      api.get(`/audit/summary?${params}`),
    ])
      .then(([logRes, sumRes]) => {
        setLogs(logRes.data.data || []);
        setTotal(logRes.data.total || 0);
        setSummary(sumRes.data);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load audit logs'))
      .finally(() => setLoading(false));
  }, [page, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => {
      if (key === 'module') return { ...prev, module: value, action: '' };
      return { ...prev, [key]: value };
    });
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const hasFilters = Object.values(filters).some(Boolean);
  const selectedLog = logs.find((l) => l.id === expandedId) || null;
  const selectedDiff = selectedLog ? computeAuditDiff(selectedLog.old_values, selectedLog.new_values) : [];

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: HEADER_BG }}>
        <div className="flex items-center gap-3">
          <ScrollText size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Audit Trail</h1>
          {summary != null && (
            <span className="text-xs bg-white/15 text-white px-2 py-0.5 rounded-full">
              {summary.total.toLocaleString()} entries
            </span>
          )}
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-1.5 bg-white/10 text-white rounded text-xs font-semibold hover:bg-white/20"
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Filter size={12} /> 1 · Filters
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Search</label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilter('search', e.target.value)}
                    placeholder="User, action, document…"
                    className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Module</label>
                <select
                  value={filters.module}
                  onChange={(e) => setFilter('module', e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-xs min-w-[140px]"
                >
                  <option value="">All modules</option>
                  {modules.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Action</label>
                <select
                  value={filters.action}
                  onChange={(e) => setFilter('action', e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-xs min-w-[160px]"
                >
                  <option value="">All actions</option>
                  {actions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">From</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilter('from', e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">To</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilter('to', e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-xs"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              2 · Activity Log
            </div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading audit logs…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2 text-left">Date / Time</th>
                      <th className="px-3 py-2 text-left">User</th>
                      <th className="px-3 py-2 text-left">Module</th>
                      <th className="px-3 py-2 text-left">Action</th>
                      <th className="px-3 py-2 text-left">Document</th>
                      <th className="px-3 py-2 text-left">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.map((log) => {
                      const expanded = expandedId === log.id;
                      const docLink = auditDocumentLink(log.reference_type, log.reference_id);
                      const refLabel = auditReferenceLabel(log);
                      const diff = computeAuditDiff(log.old_values, log.new_values);
                      return (
                        <React.Fragment key={log.id}>
                          <tr
                            className={`hover:bg-gray-50 cursor-pointer ${expanded ? 'bg-slate-50' : ''}`}
                            onClick={() => setExpandedId(expanded ? null : log.id)}
                          >
                            <td className="px-3 py-2 text-gray-400">
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 font-medium">{log.username || '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${auditModuleBadgeClass(log.module)}`}>
                                {log.module}
                              </span>
                            </td>
                            <td className={`px-3 py-2 font-medium ${auditActionBadgeClass(log.action)}`}>
                              {log.action}
                            </td>
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              {docLink && log.reference_id ? (
                                <Link to={docLink} className="inline-flex items-center gap-1 text-blue-600 hover:underline font-mono">
                                  {refLabel}
                                  <ExternalLink size={11} />
                                </Link>
                              ) : (
                                <span className="text-gray-600 font-mono">{refLabel}</span>
                              )}
                              {log.reference_type && (
                                <div className="text-[10px] text-gray-400 mt-0.5">{log.reference_type}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-400 font-mono">{log.ip_address || '—'}</td>
                          </tr>
                          {expanded && (
                            <tr className="bg-slate-50/80">
                              <td colSpan={7} className="px-4 py-3">
                                {diff.length > 0 ? (
                                  <div className="mb-3">
                                    <div className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Changes</div>
                                    <table className="w-full text-[11px] border border-gray-200 rounded-lg overflow-hidden bg-white">
                                      <thead>
                                        <tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                                          <th className="px-3 py-1.5 text-left w-1/4">Field</th>
                                          <th className="px-3 py-1.5 text-left w-[37.5%]">Before</th>
                                          <th className="px-3 py-1.5 text-left w-[37.5%]">After</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {diff.map((row) => (
                                          <tr key={row.field}>
                                            <td className="px-3 py-1.5 font-mono text-gray-600">{row.field}</td>
                                            <td className="px-3 py-1.5 text-red-700 break-all">{row.before}</td>
                                            <td className="px-3 py-1.5 text-green-700 break-all">{row.after}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Before (raw)</div>
                                    <pre className="bg-white border border-gray-200 rounded-lg p-2 overflow-auto max-h-40 text-[10px] font-mono whitespace-pre-wrap">
                                      {formatAuditJson(log.old_values)}
                                    </pre>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">After (raw)</div>
                                    <pre className="bg-white border border-gray-200 rounded-lg p-2 overflow-auto max-h-40 text-[10px] font-mono whitespace-pre-wrap">
                                      {formatAuditJson(log.new_values)}
                                    </pre>
                                  </div>
                                </div>
                                {log.device_info && (
                                  <div className="mt-2 text-[10px] text-gray-400 truncate" title={log.device_info}>
                                    Device: {log.device_info}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                          No audit logs match your filters
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && total > 0 && (
              <div className="border-t border-gray-100 px-3 py-2">
                <Pagination
                  page={page}
                  totalPages={Math.ceil(total / 50) || 1}
                  total={total}
                  onPageChange={setPage}
                />
              </div>
            )}
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Overview</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase">Total</p>
                <p className="text-xl font-bold text-slate-800">{summary?.total?.toLocaleString() ?? '—'}</p>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase">Today</p>
                <p className="text-xl font-bold text-blue-900">{summary?.today?.toLocaleString() ?? '—'}</p>
              </div>
            </div>
          </div>

          {summary && summary.by_module.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">By Module</div>
              <div className="space-y-1.5">
                {summary.by_module.map((row) => (
                  <button
                    key={row.module}
                    type="button"
                    onClick={() => setFilter('module', row.module)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-50 text-left"
                  >
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${auditModuleBadgeClass(row.module)}`}>
                      {row.module}
                    </span>
                    <span className="text-xs font-mono text-gray-600">{row.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {summary && summary.top_actions.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Actions</div>
              <div className="space-y-1">
                {summary.top_actions.map((row) => (
                  <button
                    key={row.action}
                    type="button"
                    onClick={() => setFilter('action', row.action)}
                    className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-gray-50 text-left text-xs"
                  >
                    <span className={`truncate ${auditActionBadgeClass(row.action)}`}>{row.action}</span>
                    <span className="font-mono text-gray-500 ml-2 shrink-0">{row.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedLog && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Selected Entry</div>
              <div className="text-xs space-y-2 bg-gray-50 border border-gray-100 rounded-lg p-3">
                <div><span className="text-gray-400">User:</span> {selectedLog.username}</div>
                <div><span className="text-gray-400">Action:</span> {selectedLog.action}</div>
                <div><span className="text-gray-400">Time:</span> {new Date(selectedLog.created_at).toLocaleString()}</div>
                {selectedDiff.length > 0 && (
                  <div><span className="text-gray-400">Fields changed:</span> {selectedDiff.length}</div>
                )}
              </div>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[10px] text-slate-700 leading-relaxed">
            Click a row to expand before/after details. Use module or action chips in this panel as quick filters.
          </div>
        </div>
      </div>
    </div>
  );
}
