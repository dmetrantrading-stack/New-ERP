import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Search, Filter } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<string[]>([]);
  const [filters, setFilters] = useState({ module: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.get('/audit/modules').then((res) => setModules(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString(), limit: '50', ...filters });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    api.get(`/audit?${params}`).then((res) => { setLogs(res.data.data); setTotal(res.data.total); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false));
  }, [page, filters]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filters.module} onChange={(e) => { setFilters({ ...filters, module: e.target.value }); setPage(1); }}
          className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="">All Modules</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input type="date" value={filters.from} onChange={(e) => { setFilters({ ...filters, from: e.target.value }); setPage(1); }}
          className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="From" />
        <input type="date" value={filters.to} onChange={(e) => { setFilters({ ...filters, to: e.target.value }); setPage(1); }}
          className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="To" />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Date/Time</th><th>User</th><th>Module</th><th>Action</th><th>Reference</th><th>Old Value</th><th>New Value</th><th>Device</th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="text-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="text-sm">{log.username}</td>
                  <td><span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">{log.module}</span></td>
                  <td className="text-sm">{log.action}</td>
                  <td className="text-xs font-mono">{log.reference_id ? log.reference_id.substring(0, 8) + '...' : '-'}</td>
                  <td className="text-xs max-w-xs truncate">{log.old_values ? JSON.stringify(log.old_values).substring(0, 50) : '-'}</td>
                  <td className="text-xs max-w-xs truncate">{log.new_values ? JSON.stringify(log.new_values).substring(0, 50) : '-'}</td>
                  <td className="text-xs text-gray-400">{log.device_info?.substring(0, 30) || '-'}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">No audit logs found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 50)} total={total} onPageChange={setPage} />
    </div>
  );
}
