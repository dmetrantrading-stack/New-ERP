import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Search } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import {
  AccountTypeBadge,
  ReportHeader,
  ReportKpiGrid,
  ReportShell,
  TableSectionHeader,
  EmptyReportRow,
  MoneyCell,
  AccountNameCell,
} from './AccountingReportLayout';

const TYPE_ORDER = ['Asset', 'Liability', 'Equity', 'Income', 'Cost of Goods Sold', 'Expense'];

type Account = {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  balance?: number | string;
  is_active?: boolean;
  parent_id?: number | null;
};

type Props = {
  accounts: Account[];
  businessName?: string;
  highlightAccountCode?: string | null;
  onHighlightCleared?: () => void;
  onAccountClick?: (account: Account) => void;
  onEdit?: (account: Account) => void;
  onCreate?: () => void;
  canEdit?: boolean;
};

export default function ChartOfAccountsReport({
  accounts,
  businessName,
  highlightAccountCode,
  onHighlightCleared,
  onAccountClick,
  onEdit,
  onCreate,
  canEdit,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    if (!highlightAccountCode) return;
    setTypeFilter('');
    setSearch(highlightAccountCode);
  }, [highlightAccountCode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (typeFilter && a.account_type !== typeFilter) return false;
      if (!q) return true;
      return a.account_code?.toLowerCase().includes(q) || a.account_name?.toLowerCase().includes(q);
    });
  }, [accounts, search, typeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const a of filtered) {
      const list = map.get(a.account_type) || [];
      list.push(a);
      map.set(a.account_type, list);
    }
    const sortByCode = (items: Account[]) =>
      [...items].sort((x, y) => x.account_code.localeCompare(y.account_code, undefined, { numeric: true }));
    const known = TYPE_ORDER
      .map((type) => ({ type, items: sortByCode(map.get(type) || []) }))
      .filter((g) => g.items.length > 0);
    const extraTypes = [...map.keys()]
      .filter((type) => !TYPE_ORDER.includes(type) && (map.get(type)?.length ?? 0) > 0)
      .sort()
      .map((type) => ({ type, items: sortByCode(map.get(type) || []) }));
    return [...known, ...extraTypes];
  }, [filtered]);

  useEffect(() => {
    if (!highlightAccountCode) return;
    const row = document.getElementById(`coa-row-${highlightAccountCode}`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    onHighlightCleared?.();
  }, [highlightAccountCode, grouped, onHighlightCleared]);

  const totalBalance = filtered.reduce((s, a) => s + parseFloat(String(a.balance || 0)), 0);
  const activeCount = filtered.filter((a) => a.is_active !== false).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3 flex-1">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name…"
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-field text-sm min-w-[160px]"
          >
            <option value="">All types</option>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {canEdit && onCreate && (
          <button type="button" onClick={onCreate} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            <Plus size={15} /> New account
          </button>
        )}
      </div>

      <ReportShell
        footer={
          <ReportKpiGrid
            items={[
              { label: 'Accounts shown', value: String(filtered.length), hint: `${accounts.length} total in chart` },
              { label: 'Active', value: String(activeCount) },
              { label: 'Account types', value: String(grouped.length) },
              { label: 'Net balance (shown)', value: formatCurrency(totalBalance), hint: 'Sum of displayed balances' },
            ]}
          />
        }
      >
        <ReportHeader
          businessName={businessName}
          title="Chart of Accounts"
          subtitle="Master list of general ledger accounts"
          footnote="Click a row to open account ledger drill-down"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left">Account</th>
                <th className="py-2.5 px-4 text-left w-36">Type</th>
                <th className="py-2.5 px-4 text-right w-36">Balance</th>
                <th className="py-2.5 px-4 text-center w-20 print:hidden">Status</th>
                {canEdit && <th className="py-2.5 px-3 w-10 print:hidden" />}
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 && <EmptyReportRow colSpan={canEdit ? 5 : 4} message="No accounts match your filters" />}
              {grouped.map(({ type, items }) => (
                <React.Fragment key={type}>
                  <TableSectionHeader label={type} tone={type === 'Asset' ? 'emerald' : type === 'Liability' ? 'blue' : type === 'Equity' ? 'violet' : 'slate'} />
                  {items.map((a) => {
                    const bal = parseFloat(String(a.balance || 0));
                    const isHighlighted = highlightAccountCode === a.account_code;
                    return (
                      <tr
                        key={a.id}
                        id={`coa-row-${a.account_code}`}
                        onClick={() => onAccountClick?.(a)}
                        className={`border-b border-slate-50 ${onAccountClick ? 'cursor-pointer hover:bg-blue-50/60' : ''} ${a.is_active === false ? 'opacity-60' : ''} ${isHighlighted ? 'bg-amber-50/80 ring-1 ring-inset ring-amber-200' : ''}`}
                      >
                        <AccountNameCell code={a.account_code} name={a.account_name} indent />
                        <td className="py-2 px-4"><AccountTypeBadge type={a.account_type} /></td>
                        <MoneyCell value={bal} className={bal < 0 ? 'text-red-600' : ''} />
                        <td className="py-2 px-4 text-center print:hidden">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${a.is_active === false ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'}`}>
                            {a.is_active === false ? 'Inactive' : 'Active'}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="py-2 px-2 print:hidden">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onEdit?.(a); }}
                              className="p-1.5 hover:bg-blue-50 rounded text-blue-600"
                              title="Edit account"
                            >
                              <Edit2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </ReportShell>

      <p className="text-xs text-gray-400 print:hidden">
        Revenue, COGS, and expense lines include all active chart accounts (zero-balance accounts show ₱0.00 until posted).
      </p>
    </div>
  );
}
