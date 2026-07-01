import { AuthRequest } from '../middleware/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value);
}

const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'current_password', 'new_password', 'token', 'secret',
]);

/** Maps audit reference_type → frontend path prefix (append reference_id where applicable). */
export const AUDIT_DOCUMENT_ROUTES: Record<string, string> = {
  'Sales Invoice': '/sales',
  'Sales Order': '/sales-orders',
  'Sales Quotation': '/sales-quotations',
  'Delivery Receipt': '/delivery-receipts',
  'Collection Receipt': '/collections',
  'Sales Return': '/sales-returns',
  'Purchase Order': '/purchases',
  'Goods Receipt': '/goods-receipts',
  'AP Voucher': '/payables?tab=apv',
  'Payment Voucher': '/payables?tab=payments',
  'Product': '/products',
  'Customer': '/customers',
  'Supplier': '/suppliers',
  'User': '/settings?tab=users',
  'Chart of Account': '/accounting',
  'Bank Account': '/bank-cash',
  'Inventory Count': '/stock-ops?tab=counts',
  'Employee': '/hr?tab=employees',
  'POS Transaction': '/pos',
  'Petty Cash': '/petty-cash',
};

/** Infer document reference type from module + action labels. */
export function resolveAuditReferenceType(module: string, action: string, explicit?: string): string | null {
  if (explicit) return explicit;
  const actionMap: Record<string, string> = {
    'Create Invoice': 'Sales Invoice',
    'Edit Invoice': 'Sales Invoice',
    'Void Invoice': 'Sales Invoice',
    'Create Collection': 'Collection Receipt',
    'Create Sales Return': 'Sales Return',
    'Create Order': 'Sales Order',
    'Edit Order': 'Sales Order',
    'Confirm Order': 'Sales Order',
    'Cancel Order': 'Sales Order',
    'Close Order': 'Sales Order',
    'Create Quotation': 'Sales Quotation',
    'Edit Quotation': 'Sales Quotation',
    'Change SQ Status': 'Sales Quotation',
    'Create DR': 'Delivery Receipt',
    'Edit DR': 'Delivery Receipt',
    'Post DR': 'Delivery Receipt',
    'Cancel DR': 'Delivery Receipt',
    'Create PO': 'Purchase Order',
    'Update PO': 'Purchase Order',
    'Goods Receipt': 'Goods Receipt',
    'Create APV': 'AP Voucher',
    'Post APV': 'AP Voucher',
    'Create Voucher': 'Payment Voucher',
    'Create PCV': 'Petty Cash',
    'Edit PCV': 'Petty Cash',
    'Replenish PCV': 'Petty Cash',
    'Toggle Status': 'Product',
    'Delete': 'Product',
  };
  if (actionMap[action]) return actionMap[action];
  if (module === 'Customers') return 'Customer';
  if (module === 'Suppliers') return 'Supplier';
  if (module === 'Users') return 'User';
  if (module === 'Accounting') return 'Chart of Account';
  if (module === 'Bank & Cash' && action.includes('Account')) return 'Bank Account';
  if (module === 'Inventory Count') return 'Inventory Count';
  if (module === 'HR' && action.includes('Employee')) return 'Employee';
  if (module === 'Products') return 'Product';
  if (module === 'POS' && (action === 'Sale' || action === 'Void')) return 'POS Transaction';
  return null;
}

export const AUDIT_FIELDS = {
  salesInvoice: [
    'id', 'invoice_number', 'status', 'customer_id', 'customer_name', 'total', 'subtotal',
    'discount', 'vat_amount', 'withholding_tax', 'ewt_rate', 'lgu_final_tax', 'amount_paid', 'balance',
    'payment_method', 'payment_terms', 'due_date', 'tax_type',
  ],
  salesOrder: [
    'id', 'so_number', 'status', 'customer_id', 'subtotal', 'tax', 'total', 'payment_terms',
    'delivery_date', 'total_ordered_qty', 'total_reserved_qty', 'total_remaining_qty',
  ],
  salesQuotation: ['id', 'sq_number', 'status', 'customer_id', 'subtotal', 'tax', 'total'],
  deliveryReceipt: ['id', 'dr_number', 'status', 'so_id', 'delivery_date', 'total'],
  purchaseOrder: [
    'id', 'po_number', 'status', 'supplier_id', 'subtotal', 'discount', 'tax', 'vat_amount', 'total', 'vat_mode',
  ],
  goodsReceipt: ['id', 'gr_number', 'po_id', 'supplier_id', 'status', 'total'],
  product: ['id', 'sku', 'name', 'cost', 'price', 'tax_type', 'is_active', 'category_id', 'brand_id'],
  customer: ['id', 'customer_code', 'customer_name', 'customer_type', 'tin', 'credit_limit', 'payment_terms', 'is_active'],
  supplier: ['id', 'supplier_code', 'supplier_name', 'entity_type', 'tin', 'payment_terms', 'is_active'],
  user: ['id', 'username', 'full_name', 'email', 'role_id', 'is_active'],
  chartAccount: ['id', 'account_code', 'account_name', 'account_type', 'is_active'],
  bankAccount: ['id', 'account_name', 'account_number', 'bank_name', 'balance', 'is_active'],
  genericStatus: ['id', 'status'],
};

export function auditSnapshot(row: Record<string, any> | null | undefined, fields?: string[]): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  const keys = fields || Object.keys(row);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (row[key] !== undefined) out[key] = row[key];
  }
  return Object.keys(out).length ? out : null;
}

export function auditBefore(req: AuthRequest, values: Record<string, unknown> | null) {
  if (values) (req as any).oldValues = values;
}

export function auditAfter(req: AuthRequest, values: Record<string, unknown> | null) {
  if (values) (req as any).newValues = values;
}

export function auditReference(req: AuthRequest, referenceType: string, referenceId?: string | null) {
  (req as any).auditReferenceType = referenceType;
  if (referenceId) (req as any).auditReferenceId = referenceId;
}

/** Extract document id from URL params or JSON response body (UUID only for reference_id column). */
export function resolveAuditReferenceId(req: AuthRequest, body: unknown): string | null {
  const explicit = (req as any).auditReferenceId;
  if (explicit) {
    const id = String(explicit);
    return isValidUuid(id) ? id : null;
  }
  if (req.params?.id) {
    const id = String(req.params.id);
    return isValidUuid(id) ? id : null;
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.id) {
      const id = String(b.id);
      if (isValidUuid(id)) return id;
    }
    if (b.invoice_id) return String(b.invoice_id);
    if (b.receipt_id) return String(b.receipt_id);
  }
  return null;
}

/** Build new_values for creates when handler returns id + document number fields. */
export function auditCreatePayload(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const keys = [
    'id', 'invoice_number', 'so_number', 'sq_number', 'dr_number', 'po_number', 'gr_number',
    'apv_number', 'voucher_number', 'receipt_number', 'return_number', 'entry_number',
    'message', 'status', 'total', 'margin_pct',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (b[k] !== undefined && b[k] !== null) out[k] = b[k];
  }
  return Object.keys(out).length ? out : null;
}

/** Status transition helper for patch/post actions. */
export function auditStatusChange(
  req: AuthRequest,
  before: { id: string; status: string; document_number?: string },
  after: Record<string, unknown>
) {
  auditBefore(req, { id: before.id, status: before.status, ...(before.document_number ? { document_number: before.document_number } : {}) });
  auditAfter(req, { id: before.id, ...after });
}
