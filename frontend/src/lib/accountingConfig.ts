export type AccountingSectionKey = 'setup' | 'ledger' | 'statements' | 'receivables' | 'audit';

export type AccountingTabKey =
  | 'chart-of-accounts'
  | 'journal-entries'
  | 'general-ledger'
  | 'trial-balance'
  | 'balance-sheet'
  | 'income-statement'
  | 'cash-flow'
  | 'ar-aging'
  | 'ap-aging'
  | 'transaction-audit'
  | 'gl-integrity';

export type AccountingTabDef = {
  id: AccountingTabKey;
  label: string;
  section: AccountingSectionKey;
  description: string;
};

export const ACCOUNTING_SECTIONS: {
  key: AccountingSectionKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'setup',
    label: 'Setup',
    description: 'Chart of accounts and account structure',
  },
  {
    key: 'ledger',
    label: 'Ledger & Journals',
    description: 'Journal entries and general ledger detail',
  },
  {
    key: 'statements',
    label: 'Financial Statements',
    description: 'Trial balance, balance sheet, P&L, and cash flow',
  },
  {
    key: 'receivables',
    label: 'Receivables & Payables',
    description: 'AR and AP aging summaries',
  },
  {
    key: 'audit',
    label: 'Audit & Integrity',
    description: 'Transaction audit and GL integrity checks',
  },
];

export const ACCOUNTING_TABS: AccountingTabDef[] = [
  {
    id: 'chart-of-accounts',
    label: 'Chart of Accounts',
    section: 'setup',
    description: 'Browse and maintain the chart of accounts',
  },
  {
    id: 'journal-entries',
    label: 'Journal Entries',
    section: 'ledger',
    description: 'Posted journal entries by date range',
  },
  {
    id: 'general-ledger',
    label: 'General Ledger',
    section: 'ledger',
    description: 'Account-level ledger activity',
  },
  {
    id: 'trial-balance',
    label: 'Trial Balance',
    section: 'statements',
    description: 'Debit and credit balances as of a date',
  },
  {
    id: 'balance-sheet',
    label: 'Balance Sheet',
    section: 'statements',
    description: 'Assets, liabilities, and equity as of a date',
  },
  {
    id: 'income-statement',
    label: 'Profit and Loss',
    section: 'statements',
    description: 'Statement of profit and loss for a date range',
  },
  {
    id: 'cash-flow',
    label: 'Cash Flow',
    section: 'statements',
    description: 'Cash and bank inflows and outflows',
  },
  {
    id: 'ar-aging',
    label: 'AR Aging',
    section: 'receivables',
    description: 'Outstanding customer receivables by age bucket',
  },
  {
    id: 'ap-aging',
    label: 'AP Aging',
    section: 'receivables',
    description: 'Outstanding supplier payables by age bucket',
  },
  {
    id: 'transaction-audit',
    label: 'Transaction Audit',
    section: 'audit',
    description: 'Documents missing or unbalanced journal entries',
  },
  {
    id: 'gl-integrity',
    label: 'GL Integrity',
    section: 'audit',
    description: 'Duplicate COGS, category GL mapping, and other integrity issues',
  },
];

const TAB_IDS = new Set<string>(ACCOUNTING_TABS.map((t) => t.id));

export function parseAccountingTab(value: string | null): AccountingTabKey | null {
  if (value && TAB_IDS.has(value)) return value as AccountingTabKey;
  return null;
}

export function sectionForTab(tab: AccountingTabKey): AccountingSectionKey {
  return ACCOUNTING_TABS.find((t) => t.id === tab)?.section ?? 'setup';
}

export function tabsForSection(section: AccountingSectionKey): AccountingTabDef[] {
  return ACCOUNTING_TABS.filter((t) => t.section === section);
}

export function tabDef(tab: AccountingTabKey): AccountingTabDef | undefined {
  return ACCOUNTING_TABS.find((t) => t.id === tab);
}
