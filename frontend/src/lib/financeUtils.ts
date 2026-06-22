export const PRIMARY = '#1E40AF';

export const FINANCE_FONT = 'Inter, system-ui, sans-serif';

export function financeTabClass(active: boolean) {
  return `px-3 py-1 text-xs font-semibold rounded-md whitespace-nowrap ${
    active ? 'bg-white text-blue-900' : 'text-white/80 hover:text-white'
  }`;
}

export const ACCOUNTING_TABS = [
  { id: 'chart-of-accounts', label: 'Chart of Accounts' },
  { id: 'journal-entries', label: 'Journal Entries' },
  { id: 'transaction-audit', label: 'Transaction Audit' },
  { id: 'gl-integrity', label: 'GL Integrity' },
  { id: 'general-ledger', label: 'General Ledger' },
  { id: 'trial-balance', label: 'Trial Balance' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'income-statement', label: 'Income Statement' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'ar-aging', label: 'AR Aging' },
  { id: 'ap-aging', label: 'AP Aging' },
] as const;

export { AGING_LABELS } from './payablesUtils';
