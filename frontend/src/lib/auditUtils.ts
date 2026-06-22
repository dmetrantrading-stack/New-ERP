/** Maps backend reference_type to a frontend route (reference_id appended when present). */
const DOCUMENT_ROUTES: Record<string, (id?: string | null) => string | null> = {
  'Sales Invoice': () => '/sales',
  'Sales Order': () => '/sales-orders',
  'Sales Quotation': () => '/sales-quotations',
  'Delivery Receipt': () => '/delivery-receipts',
  'Collection Receipt': (id) => (id ? `/collections?invoice=${id}` : '/collections'),
  'Sales Return': () => '/sales-returns',
  'Purchase Order': () => '/purchases',
  'Goods Receipt': () => '/goods-receipts',
  'AP Voucher': () => '/payables?tab=apv',
  'Payment Voucher': () => '/payables?tab=payments',
  'Petty Cash': () => '/petty-cash',
  'Product': () => '/products',
  'Customer': () => '/customers',
  'Supplier': () => '/suppliers',
  'User': () => '/settings?tab=users',
  'Chart of Account': () => '/accounting',
  'Bank Account': () => '/bank-cash',
  'Inventory Count': () => '/stock-ops?tab=counts',
  'Employee': () => '/hr',
  'POS Transaction': () => '/pos',
};

const MODULE_COLORS: Record<string, string> = {
  Sales: 'bg-blue-100 text-blue-800',
  Purchases: 'bg-amber-100 text-amber-800',
  Payables: 'bg-orange-100 text-orange-800',
  'Bank & Cash': 'bg-emerald-100 text-emerald-800',
  'Petty Cash': 'bg-teal-100 text-teal-800',
  Accounting: 'bg-indigo-100 text-indigo-800',
  POS: 'bg-purple-100 text-purple-800',
  HR: 'bg-pink-100 text-pink-800',
  Inventory: 'bg-cyan-100 text-cyan-800',
  'Inventory Count': 'bg-cyan-100 text-cyan-800',
  Products: 'bg-slate-100 text-slate-800',
  Customers: 'bg-sky-100 text-sky-800',
  Suppliers: 'bg-yellow-100 text-yellow-900',
  Settings: 'bg-gray-100 text-gray-700',
  Users: 'bg-gray-100 text-gray-700',
  Expenses: 'bg-rose-100 text-rose-800',
};

export function auditModuleBadgeClass(module?: string | null): string {
  if (!module) return 'bg-gray-100 text-gray-600';
  return MODULE_COLORS[module] || 'bg-gray-100 text-gray-700';
}

export function auditActionBadgeClass(action?: string | null): string {
  if (!action) return 'text-gray-600';
  const a = action.toLowerCase();
  if (a.includes('void') || a.includes('cancel') || a.includes('delete')) return 'text-red-700';
  if (a.includes('approve') || a.includes('post') || a.includes('replenish')) return 'text-green-700';
  if (a.includes('create') || a.includes('open')) return 'text-blue-700';
  if (a.includes('edit') || a.includes('update')) return 'text-amber-700';
  return 'text-gray-700';
}

export function auditDocumentLink(referenceType?: string | null, referenceId?: string | null): string | null {
  if (!referenceType) return null;
  const builder = DOCUMENT_ROUTES[referenceType];
  if (!builder) return null;
  return builder(referenceId);
}

function parseAuditObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatAuditValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatAuditJson(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function computeAuditDiff(
  oldValues: unknown,
  newValues: unknown,
): Array<{ field: string; before: string; after: string }> {
  const oldObj = parseAuditObject(oldValues);
  const newObj = parseAuditObject(newValues);
  if (!oldObj && !newObj) return [];

  const keys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {}),
  ]);

  const rows: Array<{ field: string; before: string; after: string }> = [];
  for (const field of keys) {
    const before = oldObj?.[field];
    const after = newObj?.[field];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      rows.push({
        field,
        before: formatAuditValue(before),
        after: formatAuditValue(after),
      });
    }
  }
  return rows.sort((a, b) => a.field.localeCompare(b.field));
}

export function auditReferenceLabel(log: {
  reference_type?: string | null;
  reference_id?: string | null;
  new_values?: Record<string, unknown> | null;
}): string {
  const nv = log.new_values || {};
  const docNum =
    nv.invoice_number || nv.so_number || nv.sq_number || nv.dr_number || nv.po_number
    || nv.gr_number || nv.apv_number || nv.voucher_number || nv.receipt_number
    || nv.pcv_number || nv.transaction_number;
  if (docNum) return String(docNum);
  if (log.reference_type && log.reference_id) {
    return `${log.reference_type} · ${String(log.reference_id).slice(0, 8)}…`;
  }
  if (log.reference_id) return String(log.reference_id).slice(0, 8) + '…';
  return '—';
}
