import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import {
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  AsOfToolbar,
  asOfSubtitle,
  MoneyCell,
  AccountNameCell,
  TableSectionHeader,
} from './AccountingReportLayout';

type BsAccount = {
  id: number;
  account_code: string;
  account_name: string;
  balance: number | string;
};

type BalanceSheetData = {
  assets?: BsAccount[];
  liabilities?: BsAccount[];
  equity?: BsAccount[];
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  retained_earnings?: number;
  total_liabilities_equity?: number;
};

type Props = {
  data: BalanceSheetData;
  asOf: string;
  businessName?: string;
  loading?: boolean;
  onAsOfChange: (v: string) => void;
  onRefresh: () => void;
  onAccountClick?: (account: BsAccount) => void;
};

function filterNonZero(lines: BsAccount[]) {
  return (lines || []).filter((a) => Math.abs(parseFloat(String(a.balance || 0))) > 0.009);
}

function SectionLines({
  lines,
  onAccountClick,
}: {
  lines: BsAccount[];
  onAccountClick?: (a: BsAccount) => void;
}) {
  if (!lines.length) {
    return (
      <tr>
        <td colSpan={2} className="py-2 pl-8 pr-4 text-sm text-gray-400 italic">No balance</td>
      </tr>
    );
  }
  return (
    <>
      {lines.map((a) => (
        <tr
          key={a.id}
          onClick={() => onAccountClick?.(a)}
          className={onAccountClick ? 'cursor-pointer hover:bg-blue-50/60' : undefined}
        >
          <AccountNameCell code={a.account_code} name={a.account_name} indent onClick={() => onAccountClick?.(a)} />
          <MoneyCell value={parseFloat(String(a.balance || 0))} />
        </tr>
      ))}
    </>
  );
}

export default function BalanceSheetReport({
  data,
  asOf,
  businessName,
  loading,
  onAsOfChange,
  onRefresh,
  onAccountClick,
}: Props) {
  const assets = filterNonZero(data.assets || []);
  const liabilities = filterNonZero(data.liabilities || []);
  const equity = filterNonZero(data.equity || []);
  const retained = parseFloat(String(data.retained_earnings || 0));
  const totalLE = data.total_liabilities_equity ?? data.total_liabilities + data.total_equity;
  const isBalanced = Math.abs(data.total_assets - totalLE) < 0.01;

  return (
    <div className="space-y-4">
      <AsOfToolbar asOf={asOf} loading={loading} onAsOfChange={onAsOfChange} onRefresh={onRefresh} />

      <ReportShell
        footer={
          <ReportKpiGrid
            items={[
              { label: 'Total Assets', value: formatCurrency(data.total_assets), tone: 'green' },
              { label: 'Total Liabilities', value: formatCurrency(data.total_liabilities), tone: 'blue' },
              { label: 'Total Equity', value: formatCurrency(data.total_equity), tone: 'default' },
              {
                label: 'Balance check',
                value: isBalanced ? 'Balanced' : 'Mismatch',
                hint: `L + E = ${formatCurrency(totalLE)}`,
                tone: isBalanced ? 'green' : 'red',
              },
            ]}
          />
        }
      >
        <ReportHeader
          businessName={businessName}
          title="Statement of Financial Position"
          subtitle={asOfSubtitle(asOf)}
        />

        <div className={`mx-6 mt-4 mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm print:hidden ${isBalanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {isBalanced ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span className="font-medium">
            Assets {formatCurrency(data.total_assets)} = Liabilities + Equity {formatCurrency(totalLE)}
            {Math.abs(retained) > 0.009 && ` (includes current-year earnings ${formatCurrency(retained)})`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left w-[55%]">Account</th>
                <th className="py-2.5 px-4 text-right w-[45%]">Amount</th>
              </tr>
            </thead>
            <tbody>
              <TableSectionHeader label="Assets" tone="emerald" />
              <SectionLines lines={assets} onAccountClick={onAccountClick} />
              <tr className="bg-slate-50 border-y border-slate-200 font-bold">
                <td className="py-2.5 px-4 text-sm text-slate-800">Total Assets</td>
                <MoneyCell value={data.total_assets} emphasize />
              </tr>

              <TableSectionHeader label="Liabilities" tone="blue" />
              <SectionLines lines={liabilities} onAccountClick={onAccountClick} />
              <tr className="border-t border-slate-200 font-semibold">
                <td className="py-2 px-4 pl-8 text-sm text-slate-700">Total Liabilities</td>
                <MoneyCell value={data.total_liabilities} emphasize />
              </tr>

              <TableSectionHeader label="Equity" tone="violet" />
              <SectionLines lines={equity} onAccountClick={onAccountClick} />
              {Math.abs(retained) > 0.009 && (
                <tr>
                  <td className="py-1.5 pl-8 pr-4 text-sm text-gray-700 italic">Current year earnings (retained)</td>
                  <MoneyCell value={retained} />
                </tr>
              )}
              <tr className="border-t border-slate-200 font-semibold">
                <td className="py-2 px-4 pl-8 text-sm text-slate-700">Total Equity</td>
                <MoneyCell value={data.total_equity} emphasize />
              </tr>

              <tr className="bg-slate-900 text-white print:bg-gray-100 print:text-black font-bold">
                <td className="py-3 px-4 text-sm uppercase tracking-wide">Total Liabilities &amp; Equity</td>
                <MoneyCell value={totalLE} emphasize className="print:text-black" />
              </tr>
            </tbody>
          </table>
        </div>
      </ReportShell>
    </div>
  );
}
