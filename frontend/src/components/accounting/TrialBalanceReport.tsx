import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import {
  AccountTypeBadge,
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  AsOfToolbar,
  asOfSubtitle,
  MoneyCell,
  AccountNameCell,
  EmptyReportRow,
} from './AccountingReportLayout';

type TrialBalanceLine = {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number | string;
  total_credit: number | string;
};

type Props = {
  data: TrialBalanceLine[];
  asOf: string;
  businessName?: string;
  loading?: boolean;
  onAsOfChange: (v: string) => void;
  onRefresh: () => void;
  onAccountClick?: (account: TrialBalanceLine) => void;
};

export default function TrialBalanceReport({
  data,
  asOf,
  businessName,
  loading,
  onAsOfChange,
  onRefresh,
  onAccountClick,
}: Props) {
  const totalDebit = data.reduce((s, r) => s + parseFloat(String(r.total_debit || 0)), 0);
  const totalCredit = data.reduce((s, r) => s + parseFloat(String(r.total_credit || 0)), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-4">
      <AsOfToolbar asOf={asOf} loading={loading} onAsOfChange={onAsOfChange} onRefresh={onRefresh} />

      <ReportShell
        footer={
          <ReportKpiGrid
            items={[
              { label: 'Accounts', value: String(data.length) },
              { label: 'Total Debits', value: formatCurrency(totalDebit), tone: 'blue' },
              { label: 'Total Credits', value: formatCurrency(totalCredit), tone: 'blue' },
              {
                label: 'Trial Balance',
                value: isBalanced ? 'Balanced' : 'Out of balance',
                hint: isBalanced ? 'Debits equal credits' : `Difference ${formatCurrency(Math.abs(totalDebit - totalCredit))}`,
                tone: isBalanced ? 'green' : 'red',
              },
            ]}
          />
        }
      >
        <ReportHeader
          businessName={businessName}
          title="Trial Balance"
          subtitle={asOfSubtitle(asOf)}
        />

        <div className={`mx-6 mt-4 mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm print:hidden ${isBalanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {isBalanced ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span className="font-medium">
            {isBalanced ? 'Trial balance is in balance.' : `Trial balance is out of balance by ${formatCurrency(Math.abs(totalDebit - totalCredit))}.`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left">Account</th>
                <th className="py-2.5 px-4 text-left w-32">Type</th>
                <th className="py-2.5 px-4 text-right w-36">Debit</th>
                <th className="py-2.5 px-4 text-right w-36">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && <EmptyReportRow colSpan={4} message="No trial balance activity as of this date" />}
              {data.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onAccountClick?.(row)}
                  className={onAccountClick ? 'cursor-pointer hover:bg-blue-50/60 border-b border-slate-50' : 'border-b border-slate-50'}
                >
                  <AccountNameCell code={row.account_code} name={row.account_name} indent />
                  <td className="py-2 px-4"><AccountTypeBadge type={row.account_type} /></td>
                  <MoneyCell value={parseFloat(String(row.total_debit || 0))} />
                  <MoneyCell value={parseFloat(String(row.total_credit || 0))} />
                </tr>
              ))}
            </tbody>
            {data.length > 0 && (
              <tfoot>
                <tr className="bg-slate-900 text-white print:bg-gray-100 print:text-black font-bold">
                  <td colSpan={2} className="py-3 px-4 text-sm uppercase tracking-wide">Totals</td>
                  <MoneyCell value={totalDebit} emphasize className="print:text-black" />
                  <MoneyCell value={totalCredit} emphasize className="print:text-black" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </ReportShell>

      <p className="text-xs text-gray-400 print:hidden">Click any account row to open the ledger drill-down with source documents.</p>
    </div>
  );
}
