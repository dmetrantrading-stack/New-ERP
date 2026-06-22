import React from 'react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { refTypeBadge } from '../../lib/accountingDocumentUtils';
import {
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  DateToolbar,
  MoneyCell,
  AccountNameCell,
  EmptyReportRow,
} from './AccountingReportLayout';

type LedgerLine = {
  entry_date: string;
  entry_number: string;
  account_code: string;
  account_name: string;
  debit?: number | string;
  credit?: number | string;
  description?: string;
  reference_type?: string;
};

type AccountOption = { id: number; account_code: string; account_name: string };

type Props = {
  lines: LedgerLine[];
  accounts: AccountOption[];
  from: string;
  to: string;
  accountFilter: string;
  businessName?: string;
  loading?: boolean;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onAccountFilterChange: (v: string) => void;
  onRefresh: () => void;
};

export default function GeneralLedgerReport({
  lines,
  accounts,
  from,
  to,
  accountFilter,
  businessName,
  loading,
  onFromChange,
  onToChange,
  onAccountFilterChange,
  onRefresh,
}: Props) {
  const totalDebit = lines.reduce((s, r) => s + parseFloat(String(r.debit || 0)), 0);
  const totalCredit = lines.reduce((s, r) => s + parseFloat(String(r.credit || 0)), 0);
  const selectedAccount = accounts.find((a) => String(a.id) === accountFilter);

  const subtitle = [
    from && to ? `${formatDate(from)} to ${formatDate(to)}` : 'All dates',
    selectedAccount ? `${selectedAccount.account_code} — ${selectedAccount.account_name}` : 'All accounts',
  ].join(' · ');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Account</label>
          <select value={accountFilter} onChange={(e) => onAccountFilterChange(e.target.value)} className="input-field text-sm min-w-[220px]">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
            ))}
          </select>
        </div>
        <DateToolbar
          from={from}
          to={to}
          loading={loading}
          onFromChange={onFromChange}
          onToChange={onToChange}
          onRefresh={onRefresh}
        />
      </div>

      <ReportShell
        footer={
          <ReportKpiGrid
            items={[
              { label: 'Lines', value: String(lines.length) },
              { label: 'Total Debits', value: formatCurrency(totalDebit), tone: 'blue' },
              { label: 'Total Credits', value: formatCurrency(totalCredit), tone: 'blue' },
              {
                label: 'Net movement',
                value: formatCurrency(totalDebit - totalCredit),
                hint: 'Debits minus credits in view',
              },
            ]}
          />
        }
      >
        <ReportHeader
          businessName={businessName}
          title="General Ledger"
          subtitle={subtitle}
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left w-28">Date</th>
                <th className="py-2.5 px-4 text-left w-28">Entry #</th>
                <th className="py-2.5 px-4 text-left">Account</th>
                <th className="py-2.5 px-4 text-right w-32">Debit</th>
                <th className="py-2.5 px-4 text-right w-32">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <EmptyReportRow colSpan={5} message="No ledger entries for the selected filters" />}
              {lines.map((row, i) => {
                const debit = parseFloat(String(row.debit || 0));
                const credit = parseFloat(String(row.credit || 0));
                return (
                  <tr key={`${row.entry_number}-${row.account_code}-${i}`} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-2 px-4 text-xs text-gray-600 whitespace-nowrap">{formatDate(row.entry_date)}</td>
                    <td className="py-2 px-4 font-mono text-[11px] text-blue-700">{row.entry_number}</td>
                    <AccountNameCell code={row.account_code} name={row.account_name} />
                    <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap font-medium ${debit <= 0 ? 'text-gray-300 font-normal' : ''}`}>
                      {debit > 0 ? formatCurrency(debit) : '—'}
                    </td>
                    <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap font-medium ${credit <= 0 ? 'text-gray-300 font-normal' : ''}`}>
                      {credit > 0 ? formatCurrency(credit) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="bg-slate-900 text-white print:bg-gray-100 print:text-black font-bold">
                  <td colSpan={3} className="py-3 px-4 text-sm uppercase tracking-wide">Totals</td>
                  <MoneyCell value={totalDebit} emphasize className="print:text-black" />
                  <MoneyCell value={totalCredit} emphasize className="print:text-black" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </ReportShell>
    </div>
  );
}

export function JeStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Posted: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    Void: 'bg-gray-100 text-gray-600 ring-gray-200',
    Draft: 'bg-amber-50 text-amber-800 ring-amber-100',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${styles[status] || 'bg-slate-50 text-slate-700 ring-slate-200'}`}>
      {status}
    </span>
  );
}

export function JeRefBadge({ refType }: { refType?: string }) {
  if (!refType) return <span className="text-gray-400 text-xs">Manual</span>;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${refTypeBadge(refType)}`}>
      {refType}
    </span>
  );
}
