import React from 'react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { refTypeBadge } from '../../lib/accountingDocumentUtils';

interface Props {
  entry: any;
  highlightAccountCode?: string;
}

export default function JournalEntryView({ entry, highlightAccountCode }: Props) {
  const totalDebit = entry.lines?.reduce((s: number, l: any) => s + parseFloat(l.debit || 0), 0) || 0;
  const totalCredit = entry.lines?.reduce((s: number, l: any) => s + parseFloat(l.credit || 0), 0) || 0;

  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoCard label="Entry Date" value={formatDate(entry.entry_date)} />
        <InfoCard label="Source Type" value={entry.reference_type || 'Manual Entry'} badge={entry.reference_type ? refTypeBadge(entry.reference_type) : undefined} />
        <InfoCard label="Total Debit" value={formatCurrency(totalDebit)} />
        <InfoCard label="Total Credit" value={formatCurrency(totalCredit)} />
      </div>

      {entry.description && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Description</span>
          {entry.description}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b bg-white">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Journal Lines</span>
        </div>
        <table className="data-table text-xs">
          <thead>
            <tr>
              <th>Account</th>
              <th>Line Description</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines?.map((l: any) => {
              const highlighted = highlightAccountCode && l.account_code === highlightAccountCode;
              return (
                <tr key={l.id} className={highlighted ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}>
                  <td>
                    <div className="font-mono text-[11px] text-gray-500">{l.account_code}</div>
                    <div className={`text-sm ${highlighted ? 'font-semibold text-blue-900' : 'font-medium'}`}>{l.account_name}</div>
                  </td>
                  <td className="text-gray-600 max-w-[220px]">{l.description || '—'}</td>
                  <td className="text-right font-medium">{parseFloat(l.debit) > 0 ? formatCurrency(l.debit) : '—'}</td>
                  <td className="text-right font-medium">{parseFloat(l.credit) > 0 ? formatCurrency(l.credit) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-gray-50">
              <td colSpan={2} className="text-right px-4 py-3 text-gray-600">Totals</td>
              <td className="text-right px-4 py-3">{formatCurrency(totalDebit)}</td>
              <td className="text-right px-4 py-3">{formatCurrency(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function InfoCard({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      {badge ? (
        <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${badge}`}>{value}</span>
      ) : (
        <div className="text-sm font-semibold text-gray-900 mt-0.5">{value}</div>
      )}
    </div>
  );
}
