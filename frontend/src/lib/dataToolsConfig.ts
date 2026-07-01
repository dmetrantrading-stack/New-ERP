export type OpeningImportType = 'customers' | 'suppliers' | 'inventory' | 'gl';

export type DataToolSectionId = 'accounting' | 'import' | 'backup' | 'danger';

export const DATA_TOOL_SECTIONS: {
  id: DataToolSectionId;
  title: string;
  description: string;
}[] = [
  {
    id: 'accounting',
    title: 'Accounting controls',
    description: 'Lock closed periods so new transactions cannot be posted on or before a date.',
  },
  {
    id: 'import',
    title: 'Opening balances',
    description: 'One-time CSV imports for go-live cutover — customer AR, supplier AP, stock, or GL opening entry.',
  },
  {
    id: 'backup',
    title: 'Database backup',
    description: 'Run backups from the server before major imports or resets.',
  },
  {
    id: 'danger',
    title: 'Danger zone',
    description: 'Permanent deletes. Master data like COA and users are preserved where noted.',
  },
];

export const OPENING_IMPORT_TYPES: {
  id: OpeningImportType;
  label: string;
  shortLabel: string;
  description: string;
  columns: string[];
  sampleHeader: string;
}[] = [
  {
    id: 'customers',
    label: 'Customer balances',
    shortLabel: 'Customers',
    description: 'Create or update customers and set opening A/R balance.',
    columns: ['customer_code', 'customer_name', 'balance', 'payment_terms (optional)', 'tin (optional)'],
    sampleHeader: 'customer_code,customer_name,balance,payment_terms,tin',
  },
  {
    id: 'suppliers',
    label: 'Supplier balances',
    shortLabel: 'Suppliers',
    description: 'Create or update suppliers and set opening A/P balance.',
    columns: ['supplier_code', 'supplier_name', 'balance'],
    sampleHeader: 'supplier_code,supplier_name,balance',
  },
  {
    id: 'inventory',
    label: 'Inventory quantities',
    shortLabel: 'Inventory',
    description: 'Set opening stock by SKU at the main store location.',
    columns: ['sku', 'quantity', 'unit_cost'],
    sampleHeader: 'sku,quantity,unit_cost',
  },
  {
    id: 'gl',
    label: 'GL opening entry',
    shortLabel: 'GL',
    description: 'Post a balanced opening journal entry by account code.',
    columns: ['account_code', 'debit', 'credit'],
    sampleHeader: 'account_code,debit,credit',
  },
];

export const RESET_TOOLS = [
  {
    id: 'transactions' as const,
    title: 'Reset all transactions',
    description: 'Clears sales, purchases, POS, payroll, petty cash, journal entries, and related transactional data. Keeps products, customers, suppliers, COA, and settings.',
    confirmDetail: 'All invoices, POs, journal entries, POS shifts, collections, payroll, petty cash vouchers, and audit logs will be deleted.',
    buttonLabel: 'Reset all transactions',
    tone: 'red' as const,
  },
  {
    id: 'products' as const,
    title: 'Reset products & inventory',
    description: 'Deletes all products, inventory quantities, batches, price history, and inventory ledger.',
    confirmDetail: 'All product master records and stock data will be permanently deleted.',
    buttonLabel: 'Reset products',
    tone: 'orange' as const,
  },
];

export const BACKUP_SCRIPT_HINT = 'scripts/backup-database.ps1';
