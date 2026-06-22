import React from 'react';
import { Eye } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  DateToolbar,
  MoneyCell,
  EmptyReportRow,
} from './AccountingReportLayout';
import { JeRefBadge, JeStatusBadge } from './GeneralLedgerReport';
import Pagination from '../Pagination';

type JournalEntry = {
  id: string;
  entry_number: string;
  entry_date: string;
  description?: string;
  total_debit: number | string;
  total_credit: number | string;
  status: string;
  reference_type?: string;
  created_by_name?: string;
};

type Props = {
  entries: JournalEntry[];
  from: string;
  to: string;
  businessName?: string;
  loading?: boolean;
  page: number;
  total: number;
  limit?: number;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onRefresh: () => void;
  onPageChange: (p: number) => void;
  onView: (id: string) => void;
};

export default function JournalEntriesReport({
  entries,
  from,
  to,
  businessName,
  loading,
  page,
  total,
  limit = 20,
  onFromChange,
  onToChange,
  onRefresh,
  onPageChange,
  onView,
}: Props) {
  const totalDebit = entries.reduce((s, e) => s + parseFloat(String(e.total_debit || 0)), 0);
  const totalCredit = entries.reduce((s, e) => s + parseFloat(String(e.total_credit || 0)), 0);
  const postedCount = entries.filter((e) => e.status === 'Posted').length;

  const subtitle = from && to
    ? `For the period ${formatDate(from)} to ${formatDate(to)}`
    : 'All journal entries';

  return (
    <div className="space-y-4">
      <DateToolbar
        from={from}
        to={to}
        loading={loading}
        onFromChange={onFromChange}
        onToChange={onToChange}
        onRefresh={onRefresh}
      />

      <ReportShell
        footer={
          <ReportKpiGrid
            items={[
              { label: 'Entries (page)', value: String(entries.length), hint: `${total} total matching filters` },
              { label: 'Posted', value: String(postedCount), tone: 'green' },
              { label: 'Page debits', value: formatCurrency(totalDebit) },
              { label: 'Page credits', value: formatCurrency(totalCredit) },
            ]}
          />
        }
      >
        <ReportHeader
          businessName={businessName}
          title="Journal Entries"
          subtitle={subtitle}
          footnote="System-generated from sales, purchases, collections, and other modules"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left w-28">Entry #</th>
                <th className="py-2.5 px-4 text-left w-28">Date</th>
                <th className="py-2.5 px-4 text-left">Description</th>
                <th className="py-2.5 px-4 text-left w-32">Source</th>
                <th className="py-2.5 px-4 text-right w-28">Debit</th>
                <th className="py-2.5 px-4 text-right w-28">Credit</th>
                <th className="py-2.5 px-4 text-center w-24">Status</th>
                <th className="py-2.5 px-3 w-16 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && <EmptyReportRow colSpan={8} message="No journal entries for the selected period" />}
              {entries.map((je) => (
                <tr key={je.id} className="border-b border-slate-50 hover:bg-blue-50/40 transition-colors">
                  <td className="py-2 px-4 font-mono text-[11px] font-semibold text-blue-700">{je.entry_number}</td>
                  <td className="py-2 px-4 text-xs text-gray-600 whitespace-nowrap">{formatDate(je.entry_date)}</td>
                  <td className="py-2 px-4 text-sm text-gray-700 max-w-[280px] truncate" title={je.description}>{je.description || '—'}</td>
                  <td className="py-2 px-4"><JeRefBadge refType={je.reference_type} /></td>
                  <MoneyCell value={parseFloat(String(je.total_debit || 0))} />
                  <MoneyCell value={parseFloat(String(je.total_credit || 0))} />
                  <td className="py-2 px-4 text-center"><JeStatusBadge status={je.status} /></td>
                  <td className="py-2 px-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => onView(je.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded"
                    >
                      <Eye size={13} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 print:hidden">
          <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={onPageChange} />
        </div>
      </ReportShell>
    </div>
  );
}
