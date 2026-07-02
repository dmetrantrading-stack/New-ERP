/**
 * Canonical permission catalog for the permission editor and role presets.
 * Keep in sync with backend route checks (hasUserPerm).
 */

export type ActionGroupId = 'access' | 'entry' | 'change' | 'approve' | 'output' | 'admin' | 'special';

export const ACTION_GROUP_ORDER: ActionGroupId[] = [
  'access', 'entry', 'change', 'approve', 'output', 'admin', 'special',
];

export const ACTION_GROUP_LABELS: Record<ActionGroupId, string> = {
  access: 'Access',
  entry: 'Data entry',
  change: 'Change / void / pay',
  approve: 'Approval & post',
  output: 'Print & export',
  admin: 'Admin & import',
  special: 'Other',
};

export type CatalogAction = {
  action: string;
  label?: string;
  hint?: string;
  group?: ActionGroupId;
};

export type CatalogSubmodule = {
  name: string;
  key: string;
  actions: CatalogAction[];
  note?: string;
};

export type CatalogModule = {
  module: string;
  submodules: CatalogSubmodule[];
};

const A = (
  action: string,
  opts?: Partial<Omit<CatalogAction, 'action'>>,
): CatalogAction => ({ action, ...opts });

const STD_DOC = ['view', 'create', 'edit', 'delete', 'print', 'approve', 'export'] as const;

function docActions(key: string, extras?: CatalogAction[]): CatalogAction[] {
  return [
    A('view', { group: 'access', hint: 'Open list and view details' }),
    A('create', { group: 'entry', hint: 'Create new records' }),
    A('edit', { group: 'change', hint: editHint(key) }),
    A('delete', { group: 'admin', hint: deleteHint(key) }),
    A('print', { group: 'output' }),
    A('approve', { group: 'approve', hint: approveHint(key) }),
    A('export', { group: 'output' }),
    ...(extras || []),
  ];
}

function editHint(key: string): string {
  const hints: Record<string, string> = {
    'finance.expenses': 'Edit, pay, cancel expenses; manage categories',
    'finance.bank-cash': 'Edit accounts, void/reverse transactions, starting balance',
    'finance.petty-cash': 'Edit unreplenished vouchers',
    'sales.sales-invoice': 'Edit drafts and void posted invoices',
    'sales.collections': 'Record and adjust collections (create also required)',
    'purchases.apv': 'Draft AP vouchers use Create; Edit reserved for future use',
    'purchases.purchase-order': 'Includes purchase requisitions (same permissions)',
    'inventory.inventory': 'Includes product categories and brands',
    'system.settings': 'Change company and module settings',
  };
  return hints[key] || 'Modify existing records';
}

function deleteHint(key: string): string {
  if (key === 'finance.expenses') return 'Not used — cancel uses Edit';
  if (key === 'purchases.apv') return 'Cancel draft APV';
  return 'Remove or cancel records where allowed';
}

function approveHint(key: string): string {
  const hints: Record<string, string> = {
    'inventory.counts': 'Post inventory count',
    'inventory.production': 'Complete production order',
    'purchases.apv': 'Post AP voucher to GL',
    'hr.payroll': 'Approve payroll run',
  };
  return hints[key] || 'Approve or post documents';
}

function masterDataActions(): CatalogAction[] {
  return [
    A('view', { group: 'access' }),
    A('create', { group: 'entry' }),
    A('edit', { group: 'change', hint: 'Edit and delete records' }),
    A('delete', { group: 'admin', hint: 'Same as Edit for most master data' }),
  ];
}

export const PERMISSION_MODULE_TREE: CatalogModule[] = [
  {
    module: 'Dashboard',
    submodules: [
      { name: 'Dashboard', key: 'dashboard', actions: [A('view', { group: 'access', hint: 'Executive KPIs — management only' })] },
    ],
  },
  {
    module: 'Sales',
    submodules: [
      { name: 'Sales Invoice', key: 'sales.sales-invoice', actions: docActions('sales.sales-invoice') },
      { name: 'Sales Quotation', key: 'sales.sales-quotation', actions: docActions('sales.sales-quotation').filter((a) => a.action !== 'export') },
      { name: 'Sales Order', key: 'sales.sales-order', actions: docActions('sales.sales-order').filter((a) => a.action !== 'export') },
      { name: 'Delivery Receipt', key: 'sales.delivery-receipt', actions: docActions('sales.delivery-receipt') },
      {
        name: 'Collections & AR',
        key: 'sales.collections',
        actions: [
          A('view', { group: 'access', hint: 'AR aging, statements, collection list' }),
          A('create', { group: 'entry', hint: 'Record customer payments' }),
          A('print', { group: 'output', hint: 'Print collection receipts' }),
          A('export', { group: 'output' }),
        ],
        note: 'Collection receipt printing uses sales.collection-receipt.print if assigned separately (legacy).',
      },
      { name: 'Customers', key: 'sales.customers', actions: masterDataActions() },
    ],
  },
  {
    module: 'Purchases',
    submodules: [
      {
        name: 'Purchase Order',
        key: 'purchases.purchase-order',
        actions: docActions('purchases.purchase-order'),
        note: 'Purchase Requisitions use the same permissions as Purchase Order.',
      },
      { name: 'Receiving Report', key: 'purchases.receiving-report', actions: docActions('purchases.receiving-report') },
      {
        name: 'AP Voucher',
        key: 'purchases.apv',
        actions: docActions('purchases.apv'),
        note: 'Creating and editing draft APVs uses Create. Posting uses Approve.',
      },
      { name: 'Payment Voucher', key: 'purchases.payment-voucher', actions: docActions('purchases.payment-voucher') },
      { name: 'Suppliers', key: 'purchases.suppliers', actions: masterDataActions() },
    ],
  },
  {
    module: 'Inventory',
    submodules: [
      {
        name: 'Products & Catalog',
        key: 'inventory.inventory',
        actions: docActions('inventory.inventory'),
        note: 'Categories and brands use inventory.inventory.edit for add/change/delete.',
      },
      { name: 'Production', key: 'inventory.production', actions: docActions('inventory.production') },
      { name: 'Inventory Counts', key: 'inventory.counts', actions: docActions('inventory.counts') },
      { name: 'Stock Transfers', key: 'inventory.stock-transfer', actions: docActions('inventory.stock-transfer') },
    ],
  },
  {
    module: 'Finance',
    submodules: [
      { name: 'Accounting', key: 'finance.accounting', actions: docActions('finance.accounting') },
      { name: 'Bank & Cash', key: 'finance.bank-cash', actions: docActions('finance.bank-cash') },
      {
        name: 'Expenses',
        key: 'finance.expenses',
        actions: [
          A('view', { group: 'access' }),
          A('create', { group: 'entry', hint: 'Add new expenses' }),
          A('edit', { group: 'change', hint: 'Edit, pay, cancel; add expense categories' }),
          A('print', { group: 'output' }),
          A('export', { group: 'output' }),
        ],
        note: 'Delete is not used — cancelling an expense requires Edit.',
      },
      {
        name: 'Petty Cash',
        key: 'finance.petty-cash',
        actions: [
          ...docActions('finance.petty-cash'),
          A('replenish', { group: 'special', hint: 'Replenish petty cash fund' }),
        ],
      },
      { name: 'Loans Payable', key: 'finance.loans', actions: docActions('finance.loans') },
    ],
  },
  {
    module: 'HR & Payroll',
    submodules: [
      {
        name: 'Employees',
        key: 'hr.employees',
        actions: [...masterDataActions(), A('print', { group: 'output' }), A('export', { group: 'output' }), A('import', { group: 'admin' })],
      },
      { name: 'Attendance', key: 'hr.attendance', actions: docActions('hr.attendance') },
      {
        name: 'Payroll & Payslip',
        key: 'hr.payroll',
        actions: docActions('hr.payroll'),
        note: 'Legacy hr.payslip.* keys still work as aliases.',
      },
      { name: 'Cash Advances', key: 'hr.cash-advances', actions: docActions('hr.cash-advances') },
    ],
  },
  {
    module: 'POS',
    submodules: [
      {
        name: 'POS',
        key: 'pos',
        actions: [
          A('view', { group: 'access', hint: 'View shifts and transactions' }),
          A('write', { group: 'entry', hint: 'Cashier checkout and shift operations' }),
        ],
        note: 'Write includes view access at POS.',
      },
    ],
  },
  {
    module: 'Reports',
    submodules: [
      {
        name: 'Reports',
        key: 'reports',
        actions: [
          A('view', { group: 'access' }),
          A('daily-payables', { group: 'access', label: 'Daily payables' }),
          A('daily-receivables', { group: 'access', label: 'Daily receivables' }),
        ],
      },
    ],
  },
  {
    module: 'System',
    submodules: [
      { name: 'Users', key: 'system.users', actions: masterDataActions() },
      {
        name: 'Business Details',
        key: 'system.settings',
        actions: [
          A('view', { group: 'access' }),
          A('edit', { group: 'change', hint: 'Company profile, POS, sales, data tools' }),
        ],
      },
      { name: 'Audit Trail', key: 'system.audit', actions: [A('view', { group: 'access' })] },
    ],
  },
];

export function catalogPermissionKeys(): string[] {
  return PERMISSION_MODULE_TREE.flatMap((mod) =>
    mod.submodules.flatMap((sm) => sm.actions.map((a) => `${sm.key}.${a.action}`)),
  );
}

export function actionGroupFor(action: string, explicit?: ActionGroupId): ActionGroupId {
  if (explicit) return explicit;
  const map: Record<string, ActionGroupId> = {
    view: 'access',
    create: 'entry',
    write: 'entry',
    edit: 'change',
    approve: 'approve',
    print: 'output',
    export: 'output',
    delete: 'admin',
    import: 'admin',
    replenish: 'special',
    'daily-payables': 'access',
    'daily-receivables': 'access',
  };
  return map[action] || 'special';
}

/** Actions that imply view access on the same module prefix. */
const IMPLIES_VIEW = new Set(['create', 'edit', 'approve', 'write', 'replenish', 'import', 'delete', 'print', 'export']);

/**
 * Ensure view (and pos.view for pos.write) is granted when transactional perms are set.
 * Preserves unknown/legacy keys already assigned to the user.
 */
export function normalizePermissionKeys(permissions: string[]): string[] {
  const set = new Set(permissions.filter(Boolean));
  for (const key of [...set]) {
    const dot = key.lastIndexOf('.');
    if (dot <= 0) continue;
    const prefix = key.slice(0, dot);
    const action = key.slice(dot + 1);
    if (IMPLIES_VIEW.has(action)) {
      set.add(`${prefix}.view`);
    }
    if (action === 'write' && prefix === 'pos') {
      set.add('pos.view');
    }
    if (action === 'edit' && prefix === 'system.settings') {
      set.add('system.settings.view');
    }
  }
  return [...set].sort();
}

export type RolePreset = {
  id: string;
  label: string;
  description: string;
  permissions: string[];
};

function keysMatching(fn: (key: string) => boolean): string[] {
  return catalogPermissionKeys().filter(fn);
}

function keysForPrefixes(prefixes: string[], actions: string[]): string[] {
  return catalogPermissionKeys().filter((k) => {
    const dot = k.lastIndexOf('.');
    const prefix = k.slice(0, dot);
    const action = k.slice(dot + 1);
    return prefixes.some((p) => prefix === p || prefix.startsWith(`${p}.`)) && actions.includes(action);
  });
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'full_access',
    label: 'Full access (all modules)',
    description: 'Every permission in the catalog — for Owner or system administrator.',
    permissions: catalogPermissionKeys(),
  },
  {
    id: 'manager',
    label: 'General Manager',
    description: 'Dashboard plus view, create, edit, and approve across operations (no user admin).',
    permissions: normalizePermissionKeys([
      'dashboard.view',
      ...keysForPrefixes(
        ['sales', 'purchases', 'inventory', 'finance', 'pos', 'reports', 'hr'],
        ['view', 'create', 'edit', 'approve', 'print', 'export', 'write', 'replenish'],
      ),
      'system.settings.view',
    ]),
  },
  {
    id: 'accountant',
    label: 'Accountant / Finance',
    description: 'Finance modules, accounting, reports, dashboard — no POS or HR payroll approve.',
    permissions: normalizePermissionKeys([
      'dashboard.view',
      ...keysForPrefixes(['finance', 'reports'], ['view', 'create', 'edit', 'print', 'export', 'approve', 'replenish']),
      'sales.collections.view',
      'sales.collections.create',
      'sales.collections.print',
      'purchases.apv.view',
      'purchases.payment-voucher.view',
      'purchases.suppliers.view',
    ]),
  },
  {
    id: 'expenses_clerk',
    label: 'Expenses Clerk (view + add only)',
    description: 'Record expenses but cannot edit, pay, or cancel — e.g. Sebastian view-only workflow with data entry.',
    permissions: ['finance.expenses.view', 'finance.expenses.create'],
  },
  {
    id: 'expenses_supervisor',
    label: 'Expenses Supervisor',
    description: 'Full expense module including pay and cancel.',
    permissions: normalizePermissionKeys([
      'finance.expenses.view',
      'finance.expenses.create',
      'finance.expenses.edit',
      'finance.expenses.print',
      'finance.expenses.export',
    ]),
  },
  {
    id: 'ap_clerk',
    label: 'Accounts Payable Clerk',
    description: 'Suppliers, AP vouchers, payment vouchers, goods receipts.',
    permissions: normalizePermissionKeys([
      'purchases.suppliers.view',
      'purchases.suppliers.create',
      'purchases.suppliers.edit',
      'purchases.apv.view',
      'purchases.apv.create',
      'purchases.apv.print',
      'purchases.payment-voucher.view',
      'purchases.payment-voucher.create',
      'purchases.receiving-report.view',
      'purchases.purchase-order.view',
    ]),
  },
  {
    id: 'cashier',
    label: 'POS Cashier',
    description: 'Point of sale only.',
    permissions: ['pos.write'],
  },
  {
    id: 'sales_staff',
    label: 'Sales Staff',
    description: 'Quotations, orders, invoices, delivery, collections; customers view/create.',
    permissions: normalizePermissionKeys([
      'sales.sales-quotation.view',
      'sales.sales-quotation.create',
      'sales.sales-quotation.edit',
      'sales.sales-order.view',
      'sales.sales-order.create',
      'sales.sales-order.edit',
      'sales.sales-invoice.view',
      'sales.sales-invoice.create',
      'sales.sales-invoice.print',
      'sales.delivery-receipt.view',
      'sales.delivery-receipt.create',
      'sales.collections.view',
      'sales.collections.create',
      'sales.collections.print',
      'sales.customers.view',
      'sales.customers.create',
      'sales.customers.edit',
    ]),
  },
  {
    id: 'warehouse',
    label: 'Warehouse / Inventory',
    description: 'Products, stock, receiving, counts, transfers; no finance.',
    permissions: normalizePermissionKeys([
      'inventory.inventory.view',
      'inventory.inventory.create',
      'inventory.inventory.edit',
      'inventory.counts.view',
      'inventory.counts.create',
      'inventory.counts.edit',
      'inventory.counts.approve',
      'inventory.stock-transfer.view',
      'inventory.stock-transfer.create',
      'inventory.stock-transfer.edit',
      'inventory.production.view',
      'purchases.receiving-report.view',
      'purchases.receiving-report.create',
      'purchases.purchase-order.view',
    ]),
  },
  {
    id: 'hr_officer',
    label: 'HR Officer',
    description: 'Employees, attendance, payroll view/create/edit; no system admin.',
    permissions: normalizePermissionKeys(
      keysForPrefixes(['hr'], ['view', 'create', 'edit', 'print', 'export', 'import']),
    ),
  },
  {
    id: 'read_only',
    label: 'Read-only (view all)',
    description: 'View access to every module — auditor or trainee.',
    permissions: keysMatching((k) => k.endsWith('.view') || k === 'reports.daily-payables' || k === 'reports.daily-receivables'),
  },
];
