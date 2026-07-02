export const RESET_TOOLS = [
  {
    id: 'transactions' as const,
    title: 'Reset all transactions',
    description: 'Clears sales, purchases, POS, payroll, petty cash, journal entries, and related transactional data. Keeps products, customers, suppliers (including balances), COA, and settings.',
    confirmDetail: 'All invoices, POs, journal entries, POS shifts, collections, payroll, petty cash vouchers, and audit logs will be deleted. Customer and supplier master data and balances are not changed.',
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
