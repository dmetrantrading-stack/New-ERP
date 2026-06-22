import React from 'react';
import { Search, Download } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { refTypeBadge } from '../../lib/accountingDocumentUtils';

interface Props {
  account: any;
  data: any[];
  loading: boolean;
  totals: { debit: number; credit: number; net: number };
  search: string;
  refTypeFilter: string;
  refTypes: string[];
  page: number;
  totalPages: number;
  total: number;
  onSearchChange: (v: string) => void;
  onRefTypeChange: (v: string) => void;
  onPageChange: (p: number) => void;
  onExport: () => void;
  onOpenJournal: (entryId: string) => void;
  onOpenSource: (refType: string, refId: string) => void;
}

export default function AccountLedgerView({
  account,
  data,
  loading,
  totals,
  search,
  refTypeFilter,
  refTypes,
  page,
  totalPages,
  total,
  onSearchChange,
  onRefTypeChange,
  onPageChange,
  onExport,
  onOpenJournal,
  onOpenSource,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-[420px]">
      <div className="flex-shrink-0 px-5 py-3 bg-white border-b grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Account Type" value={account.account_type} />
        <Stat label="Total Debit" value={formatCurrency(totals.debit)} />
        <Stat label="Total Credit" value={formatCurrency(totals.credit)} />
        <Stat label="Net Balance" value={formatCurrency(totals.net)} highlight={totals.net >= 0 ? 'green' : 'red'} />
      </div>

      <div className="flex-shrink-0 px-5 py-2 bg-white border-b flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search doc #, party, type, description…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <select
          value={refTypeFilter}
          onChange={(e) => onRefTypeChange(e.target.value)}
          className="input-field text-sm min-w-[160px]"
        >
          <option value="">All source types</option>
          {refTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button type="button" onClick={onExport} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-blue-700 hover:bg-blue-50">
          <Download size={13} /> Export
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        <table className="data-table text-xs">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th>Date</th>
              <th>Entry #</th>
              <th>Source</th>
              <th>Document</th>
              <th>Party</th>
              <th>Description</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading transactions…</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">No transactions found</td></tr>
            ) : (
              data.map((d) => (
                <tr key={d.line_id} className="hover:bg-blue-50/50">
                  <td className="whitespace-nowrap text-gray-600">{formatDate(d.entry_date)}</td>
                  <td>
                    <button type="button" onClick={() => onOpenJournal(d.entry_id)} className="font-mono text-blue-700 hover:underline">
                      {d.entry_number}
                    </button>
                  </td>
                  <td>
                    {d.reference_type ? (
                      <button
                        type="button"
                        onClick={() => onOpenSource(d.reference_type, d.reference_id)}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${refTypeBadge(d.reference_type)} hover:opacity-90`}
                      >
                        {d.reference_type}
                      </button>
                    ) : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => d.reference_type && d.reference_id && onOpenSource(d.reference_type, d.reference_id)}
                      className="font-mono text-blue-700 hover:underline text-left"
                    >
                      {d.document_number || '—'}
                    </button>
                  </td>
                  <td className="max-w-[130px] truncate" title={d.party_name}>{d.party_name || '—'}</td>
                  <td className="max-w-[160px] truncate text-gray-600" title={d.line_description || d.je_description}>
                    {d.line_description || d.je_description || '—'}
                  </td>
                  <td className="text-right font-medium">{parseFloat(d.debit) > 0 ? formatCurrency(d.debit) : '—'}</td>
                  <td className="text-right font-medium">{parseFloat(d.credit) > 0 ? formatCurrency(d.credit) : '—'}</td>
                  <td className="text-right font-semibold text-gray-900">
                    {d.running_balance != null ? formatCurrency(d.running_balance) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex-shrink-0 px-5 py-2 border-t bg-white flex items-center justify-between text-xs text-gray-600">
          <span>{total} line(s)</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="px-3 py-1 border rounded disabled:opacity-30">Prev</button>
            <span className="px-2 py-1">Page {page} of {totalPages}</span>
            <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="px-3 py-1 border rounded disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  const color = highlight === 'green' ? 'text-green-700' : highlight === 'red' ? 'text-red-700' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-bold truncate ${color}`}>{value}</div>
    </div>
  );
}
