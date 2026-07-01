import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';
import ComparativeIncomeStatementReport, {
  ComparativeColumn,
  ComparativeIncomeStatementData,
  ComparativeIncomeStatementToolbar,
  createColumnId,
  defaultComparativeColumns,
} from '../../components/accounting/ComparativeIncomeStatementReport';

export type ProfitLossReportConfig = {
  id: string;
  title: string;
  description: string;
  basis: 'accrual' | 'cash';
  columns: Array<{ from: string; to: string; label: string }>;
  options: {
    exclude_zero: boolean;
    show_account_codes: boolean;
    footer: string;
  };
  period_from: string | null;
  period_to: string | null;
  created_at?: string;
  updated_at?: string;
  created_by_name?: string | null;
};

type ViewMode = 'list' | 'builder' | 'report';

type Props = {
  businessName?: string;
  canEdit?: boolean;
};

function columnsToState(columns: Array<{ from: string; to: string; label?: string }>): ComparativeColumn[] {
  if (!columns.length) return defaultComparativeColumns();
  return columns.map((c) => ({
    id: createColumnId(),
    from: c.from,
    to: c.to,
    label: c.label || '',
  }));
}

function basisLabel(basis: string) {
  return basis === 'cash' ? 'Cash basis' : 'Accrual basis';
}

export default function ProfitLossReportTab({
  businessName,
  canEdit = false,
}: Props) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [savedReports, setSavedReports] = useState<ProfitLossReportConfig[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('Profit and Loss Statement');
  const [description, setDescription] = useState('');
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const [columns, setColumns] = useState<ComparativeColumn[]>(() => defaultComparativeColumns());
  const [excludeZero, setExcludeZero] = useState(true);
  const [showAccountCodes, setShowAccountCodes] = useState(true);
  const [footer, setFooter] = useState('');
  const [saving, setSaving] = useState(false);

  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<ComparativeIncomeStatementData | null>(null);
  const [activeConfig, setActiveConfig] = useState<ProfitLossReportConfig | null>(null);

  const loadSavedReports = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await api.get('/accounting/profit-loss-reports', {
        params: search.trim() ? { search: search.trim() } : undefined,
      });
      setSavedReports(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load saved reports');
    } finally {
      setListLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (mode === 'list') loadSavedReports();
  }, [mode, loadSavedReports]);

  const resetBuilder = () => {
    setEditingId(null);
    setTitle('Profit and Loss Statement');
    setDescription('');
    setBasis('accrual');
    setColumns(defaultComparativeColumns());
    setExcludeZero(true);
    setShowAccountCodes(true);
    setFooter('');
    setReportData(null);
    setActiveConfig(null);
  };

  const openNew = () => {
    resetBuilder();
    setMode('builder');
  };

  const openEdit = (config: ProfitLossReportConfig) => {
    setEditingId(config.id);
    setTitle(config.title);
    setDescription(config.description || '');
    setBasis(config.basis);
    setColumns(columnsToState(config.columns));
    setExcludeZero(config.options.exclude_zero);
    setShowAccountCodes(config.options.show_account_codes);
    setFooter(config.options.footer || '');
    setActiveConfig(config);
    setReportData(null);
    setMode('builder');
  };

  const buildPayload = () => ({
    title,
    description,
    basis,
    columns: columns.map(({ from, to, label }) => ({
      from,
      to,
      label: label.trim() || undefined,
    })),
    options: {
      exclude_zero: excludeZero,
      show_account_codes: showAccountCodes,
      footer,
    },
  });

  const runReport = async (configId?: string) => {
    setReportLoading(true);
    try {
      if (configId) {
        const res = await api.get(`/accounting/profit-loss-reports/${configId}/run`);
        setActiveConfig(res.data.config);
        setReportData(res.data.report);
      } else {
        const res = await api.post('/accounting/income-statement/comparative', {
          ...buildPayload(),
          exclude_zero: excludeZero,
        });
        setReportData(res.data);
      }
      setMode('report');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to run report');
    } finally {
      setReportLoading(false);
    }
  };

  const saveReport = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingId) {
        const res = await api.put(`/accounting/profit-loss-reports/${editingId}`, payload);
        setActiveConfig(res.data);
        toast.success('Report updated');
      } else {
        const res = await api.post('/accounting/profit-loss-reports', payload);
        setEditingId(res.data.id);
        setActiveConfig(res.data);
        toast.success('Report saved');
      }
      await loadSavedReports();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save report');
    } finally {
      setSaving(false);
    }
  };

  const deleteReport = async (id: string) => {
    if (!canEdit) return;
    if (!window.confirm('Delete this saved report?')) return;
    try {
      await api.delete(`/accounting/profit-loss-reports/${id}`);
      toast.success('Report deleted');
      if (editingId === id) {
        resetBuilder();
        setMode('list');
      } else if (activeConfig?.id === id) {
        setActiveConfig(null);
        setReportData(null);
        setMode('list');
      }
      await loadSavedReports();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete report');
    }
  };

  if (mode === 'report' && reportData) {
    return (
      <div className="space-y-4 max-w-full">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <button
            type="button"
            onClick={() => setMode(activeConfig ? 'list' : 'builder')}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 truncate">
              {activeConfig?.title || title}
            </h3>
            {activeConfig?.description && (
              <p className="text-xs text-gray-500 truncate">{activeConfig.description}</p>
            )}
          </div>
          {activeConfig && canEdit && (
            <button
              type="button"
              onClick={() => openEdit(activeConfig)}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              <Pencil size={14} />
              Edit
            </button>
          )}
        </div>
        <ComparativeIncomeStatementReport
          data={reportData}
          businessName={businessName}
          title={activeConfig?.title || title}
          footer={activeConfig?.options?.footer || footer}
          showAccountCodes={activeConfig?.options?.show_account_codes ?? showAccountCodes}
        />
      </div>
    );
  }

  if (mode === 'builder') {
    return (
      <div className="space-y-4 max-w-full">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              resetBuilder();
              setMode('list');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to list
          </button>
          <h3 className="text-sm font-semibold text-slate-800">
            {editingId ? 'Edit report' : 'New comparative report'}
          </h3>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="input-field text-sm w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Accounting method</label>
              <select
                value={basis}
                onChange={(e) => setBasis(e.target.value as 'accrual' | 'cash')}
                className="input-field text-sm w-full"
              >
                <option value="accrual">Accrual basis</option>
                <option value="cash">Cash basis</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Footer</label>
              <input
                type="text"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Optional notes on printed report"
                className="input-field text-sm w-full"
              />
            </div>
          </div>
        </div>

        <ComparativeIncomeStatementToolbar
          columns={columns}
          loading={reportLoading}
          excludeZero={excludeZero}
          showAccountCodes={showAccountCodes}
          onColumnsChange={setColumns}
          onExcludeZeroChange={setExcludeZero}
          onShowAccountCodesChange={setShowAccountCodes}
          onRefresh={() => runReport()}
          runLabel="Preview report"
        />

        <div className="flex flex-wrap gap-2 print:hidden">
          {canEdit && (
            <button
              type="button"
              onClick={saveReport}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save report'}
            </button>
          )}
          {editingId && canEdit && (
            <button
              type="button"
              onClick={() => deleteReport(editingId)}
              className="inline-flex items-center gap-1 px-4 py-2 border border-red-200 text-red-700 rounded-lg text-sm hover:bg-red-50"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Comparative Profit and Loss</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Build multi-period P&amp;L layouts with saved column setups. For a single-period statement, use Accounting → Profit and Loss.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            <Plus size={16} />
            New report
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadSavedReports()}
            placeholder="Search reports…"
            className="input-field text-sm w-full pl-9"
          />
        </div>
        <button
          type="button"
          onClick={loadSavedReports}
          disabled={listLoading}
          className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {listLoading ? 'Loading…' : 'Search'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left">Actions</th>
                <th className="py-2.5 px-4 text-left">Title</th>
                <th className="py-2.5 px-4 text-left">From</th>
                <th className="py-2.5 px-4 text-left">To</th>
                <th className="py-2.5 px-4 text-left">Accounting method</th>
                <th className="py-2.5 px-4 text-left">Description</th>
              </tr>
            </thead>
            <tbody>
              {savedReports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    {listLoading ? 'Loading reports…' : 'No saved reports yet. Create one to compare monthly P&L columns.'}
                  </td>
                </tr>
              ) : (
                savedReports.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="text-xs font-medium text-blue-700 hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => runReport(row.id)}
                          disabled={reportLoading}
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                        >
                          <Eye size={12} />
                          View
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => deleteReport(row.id)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{row.title}</td>
                    <td className="py-2.5 px-4 text-gray-600">
                      {row.period_from ? formatDate(row.period_from) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600">
                      {row.period_to ? formatDate(row.period_to) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600">{basisLabel(row.basis)}</td>
                    <td className="py-2.5 px-4 text-gray-500 max-w-xs truncate">{row.description || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
