import React from 'react';
import { formatCurrency } from '../../lib/utils';
import {
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  DateToolbar,
} from './AccountingReportLayout';

type CashFlowData = {
  cash_inflows: number;
  cash_outflows: number;
  bank_inflows: number;
  bank_outflows: number;
  net_cash_flow: number;
  net_bank_flow: number;
  total_net_flow: number;
};

type Props = {
  data: CashFlowData;
  from: string;
  to: string;
  businessName?: string;
  loading?: boolean;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onRefresh: () => void;
};

function FlowRow({
  label,
  value,
  tone,
  emphasize,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'red' | 'blue' | 'orange' | 'default';
  emphasize?: boolean;
}) {
  const colors = {
    green: 'text-emerald-700',
    red: 'text-red-700',
    blue: 'text-blue-700',
    orange: 'text-orange-700',
    default: 'text-slate-800',
  };
  return (
    <tr className={emphasize ? 'bg-slate-50 border-y border-slate-200 font-bold' : 'border-b border-slate-50'}>
      <td className={`py-2.5 px-4 text-sm ${emphasize ? 'text-slate-900' : 'text-slate-700'}`}>{label}</td>
      <td className={`py-2.5 px-4 text-right tabular-nums font-semibold ${colors[tone || 'default']}`}>
        {formatCurrency(value)}
      </td>
    </tr>
  );
}

export default function CashFlowReport({
  data,
  from,
  to,
  businessName,
  loading,
  onFromChange,
  onToChange,
  onRefresh,
}: Props) {
  const subtitle = from && to ? `${from} to ${to}` : 'All dates';

  return (
    <div className="space-y-4 max-w-3xl">
      <DateToolbar from={from} to={to} loading={loading} onFromChange={onFromChange} onToChange={onToChange} onRefresh={onRefresh} />

      <ReportShell
        footer={
          <ReportKpiGrid
            items={[
              { label: 'Net Cash', value: formatCurrency(data.net_cash_flow), tone: data.net_cash_flow >= 0 ? 'green' : 'red' },
              { label: 'Net Bank', value: formatCurrency(data.net_bank_flow), tone: data.net_bank_flow >= 0 ? 'green' : 'red' },
              { label: 'Total Net Flow', value: formatCurrency(data.total_net_flow), tone: data.total_net_flow >= 0 ? 'green' : 'red' },
              { label: 'Cash In − Out', value: formatCurrency(data.cash_inflows - data.cash_outflows) },
            ]}
          />
        }
      >
        <ReportHeader
          businessName={businessName}
          title="Cash Flow Summary"
          subtitle={subtitle}
          footnote="Based on posted cash and bank transactions"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left">Category</th>
                <th className="py-2.5 px-4 text-right w-40">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={2} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Cash on Hand</td></tr>
              <FlowRow label="Cash Inflows" value={data.cash_inflows} tone="green" />
              <FlowRow label="Cash Outflows" value={data.cash_outflows} tone="red" />
              <FlowRow label="Net Cash Flow" value={data.net_cash_flow} tone={data.net_cash_flow >= 0 ? 'green' : 'red'} emphasize />

              <tr><td colSpan={2} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-blue-700 pt-4">Bank Accounts</td></tr>
              <FlowRow label="Bank Inflows" value={data.bank_inflows} tone="blue" />
              <FlowRow label="Bank Outflows" value={data.bank_outflows} tone="orange" />
              <FlowRow label="Net Bank Flow" value={data.net_bank_flow} tone={data.net_bank_flow >= 0 ? 'green' : 'red'} emphasize />

              <tr className="bg-slate-900 text-white print:bg-gray-100 print:text-black">
                <td className="py-3 px-4 text-sm font-bold uppercase tracking-wide">Total Net Flow</td>
                <td className={`py-3 px-4 text-right tabular-nums font-bold text-base print:text-black ${data.total_net_flow >= 0 ? 'print:text-emerald-800' : 'print:text-red-800'}`}>
                  {formatCurrency(data.total_net_flow)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportShell>
    </div>
  );
}
