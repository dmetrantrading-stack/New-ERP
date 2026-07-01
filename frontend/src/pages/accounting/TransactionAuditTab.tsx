import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function TransactionAuditTab() {
  const [auditReport, setAuditReport] = useState<any>(null);
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchTransactionAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params: Record<string, string> = {};
      if (auditFrom) params.from = auditFrom;
      if (auditTo) params.to = auditTo;
      const res = await api.get('/accounting/transaction-audit', { params });
      setAuditReport(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load transaction audit');
    } finally {
      setAuditLoading(false);
    }
  }, [auditFrom, auditTo]);

  useEffect(() => {
    fetchTransactionAudit();
  }, [fetchTransactionAudit]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} className="input-field text-sm" />
        </div>
        <button
          type="button"
          onClick={fetchTransactionAudit}
          disabled={auditLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {auditLoading ? 'Checking…' : 'Run Audit'}
        </button>
      </div>

      {auditReport && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Documents Checked', value: auditReport.summary?.total_documents || 0 },
              { label: 'With Journal', value: auditReport.summary?.with_journal || 0, ok: true },
              { label: 'Missing Journal', value: auditReport.summary?.missing_journal || 0, warn: (auditReport.summary?.missing_journal || 0) > 0 },
              { label: 'Unbalanced JEs', value: auditReport.summary?.unbalanced_entries || 0, warn: (auditReport.summary?.unbalanced_entries || 0) > 0 },
              { label: 'Orphaned JEs', value: auditReport.summary?.orphaned_journals || 0, warn: (auditReport.summary?.orphaned_journals || 0) > 0 },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-lg border p-3 ${card.warn ? 'border-amber-200 bg-amber-50' : card.ok ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
              >
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{card.label}</div>
                <div className={`text-xl font-bold ${card.warn ? 'text-amber-700' : card.ok ? 'text-green-700' : 'text-gray-800'}`}>{card.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b text-[10px] font-semibold text-gray-400 uppercase">By Transaction Type</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document Type</th>
                  <th>JE Reference</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">With JE</th>
                  <th className="text-right">Missing</th>
                </tr>
              </thead>
              <tbody>
                {(auditReport.by_type || []).map((row: any) => (
                  <tr key={row.document_type} className={row.missing_journal > 0 ? 'bg-amber-50/50' : ''}>
                    <td className="font-medium">{row.document_type}</td>
                    <td className="text-xs text-gray-500">{row.journal_reference_type}</td>
                    <td className="text-right">{row.total}</td>
                    <td className="text-right text-green-700">{row.with_journal}</td>
                    <td className={`text-right font-semibold ${row.missing_journal > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{row.missing_journal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(auditReport.by_type || []).some((r: any) => r.missing?.length > 0) && (
            <div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-amber-100 text-[10px] font-semibold text-amber-700 uppercase">Missing Journal Entries (sample)</div>
              {(auditReport.by_type || []).filter((r: any) => r.missing?.length > 0).map((row: any) => (
                <div key={row.document_type} className="border-b border-gray-100 last:border-0 p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">{row.document_type}</div>
                  <div className="space-y-1">
                    {row.missing.map((m: any) => (
                      <div key={m.id} className="flex justify-between text-xs text-gray-600">
                        <span className="font-mono">{m.document_number || m.id?.substring(0, 8)}</span>
                        <span>{m.document_date ? formatDate(m.document_date) : '—'}</span>
                        <span>{formatCurrency(m.amount || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {auditReport.notes?.length > 0 && (
            <div className="text-xs text-gray-500 space-y-1 bg-blue-50 border border-blue-100 rounded-lg p-3">
              {auditReport.notes.map((n: string) => <p key={n}>• {n}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
