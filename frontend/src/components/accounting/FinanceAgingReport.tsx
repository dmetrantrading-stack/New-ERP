import React from 'react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { AGING_LABELS } from '../../lib/financeUtils';
import {
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  EmptyReportRow,
  MoneyCell,
} from './AccountingReportLayout';

type AgingRow = {
  id: string;
  invoice_number?: string;
  apv_number?: string;
  customer_name?: string;
  supplier_name?: string;
  due_date?: string;
  aging_bucket: string;
  balance_due: number | string;
};

type AgingData = {
  total_outstanding: number;
  count: number;
  buckets: Record<string, number>;
  rows: AgingRow[];
};

type Props = {
  data: AgingData;
  kind: 'ar' | 'ap';
  businessName?: string;
};

export default function FinanceAgingReport({ data, kind, businessName }: Props) {
  const docLabel = kind === 'ar' ? 'Invoice #' : 'APV #';
  const partyLabel = kind === 'ar' ? 'Customer' : 'Supplier';
  const title = kind === 'ar' ? 'Accounts Receivable Aging' : 'Accounts Payable Aging';

  return (
    <ReportShell
      footer={
        <ReportKpiGrid
          items={[
            { label: 'Total Outstanding', value: formatCurrency(data.total_outstanding || 0), tone: kind === 'ar' ? 'green' : 'red' },
            { label: 'Open Documents', value: String(data.count || 0) },
            { label: 'Current', value: formatCurrency(data.buckets?.current || 0), tone: 'blue' },
            { label: 'Over 90 Days', value: formatCurrency(data.buckets?.over_90 || 0), tone: 'amber' },
          ]}
        />
      }
    >
      <ReportHeader
        businessName={businessName}
        title={title}
        subtitle="Outstanding balances by aging bucket"
      />

      <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {(['current', '1_30', '31_60', '61_90', 'over_90'] as const).map((key) => (
          <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500">{AGING_LABELS[key]}</div>
            <div className="text-sm font-bold tabular-nums text-slate-800 mt-0.5">{formatCurrency(data.buckets?.[key] || 0)}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2.5 px-4 text-left">{docLabel}</th>
              <th className="py-2.5 px-4 text-left">{partyLabel}</th>
              <th className="py-2.5 px-4 text-left w-28">Due</th>
              <th className="py-2.5 px-4 text-left w-28">Aging</th>
              <th className="py-2.5 px-4 text-right w-32">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(data.rows || []).length === 0 && (
              <EmptyReportRow colSpan={5} message="No outstanding balances" />
            )}
            {(data.rows || []).map((row) => (
              <tr key={row.id} className="border-b border-slate-50 hover:bg-blue-50/40">
                <td className="py-2 px-4 font-mono text-[11px] font-semibold text-blue-700">
                  {kind === 'ar' ? row.invoice_number : row.apv_number}
                </td>
                <td className="py-2 px-4 text-slate-700">{kind === 'ar' ? row.customer_name : row.supplier_name}</td>
                <td className="py-2 px-4 text-xs text-slate-600">{row.due_date ? formatDate(row.due_date) : '—'}</td>
                <td className="py-2 px-4 text-xs text-slate-600">{AGING_LABELS[row.aging_bucket as keyof typeof AGING_LABELS] || row.aging_bucket}</td>
                <MoneyCell value={parseFloat(String(row.balance_due || 0))} />
              </tr>
            ))}
          </tbody>
          {(data.rows || []).length > 0 && (
            <tfoot>
              <tr className="bg-slate-900 text-white print:bg-gray-100 print:text-black font-bold">
                <td colSpan={4} className="py-3 px-4 text-sm uppercase tracking-wide">Total Outstanding</td>
                <MoneyCell value={parseFloat(String(data.total_outstanding || 0))} emphasize className="print:text-black" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </ReportShell>
  );
}
