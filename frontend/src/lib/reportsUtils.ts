import { PRIMARY, FINANCE_FONT, financeTabClass } from './financeUtils';

export { PRIMARY, FINANCE_FONT, financeTabClass };

export type ReportSectionKey = 'sales' | 'finance' | 'inventory';

export const REPORT_SECTIONS = [
  { key: 'sales' as const, label: 'Sales & POS', permAny: ['reports.view'] as string[] },
  { key: 'finance' as const, label: 'Finance', permAny: ['reports.view', 'reports.daily-payables', 'reports.daily-receivables'] as string[] },
  { key: 'inventory' as const, label: 'Inventory', permAny: ['reports.view'] as string[] },
];

export type ReportDef = {
  id: string;
  label: string;
  section: ReportSectionKey;
  perm: string;
  singleDate?: boolean;
  noDateRange?: boolean;
  exportable?: boolean;
};

export const ALL_REPORTS: ReportDef[] = [
  { id: 'daily-sales', label: 'Daily Sales', section: 'sales', perm: 'reports.view', singleDate: true },
  { id: 'sales-by-item', label: 'Sales by Item', section: 'sales', perm: 'reports.view' },
  { id: 'sales-by-cashier', label: 'Sales by Cashier', section: 'sales', perm: 'reports.view' },
  { id: 'pos-shifts', label: 'POS Shift Register', section: 'sales', perm: 'reports.view', exportable: true },
  { id: 'sales-by-customer', label: 'Credit Sales by Customer', section: 'sales', perm: 'reports.view' },
  { id: 'sales-invoice-register', label: 'Sales Invoice Register', section: 'sales', perm: 'reports.view', exportable: true },
  { id: 'consolidated-sales', label: 'Consolidated Sales & GP', section: 'sales', perm: 'reports.view', exportable: true },
  { id: 'category-margin', label: 'Category Sales & GP', section: 'sales', perm: 'reports.view', exportable: true },
  { id: 'delivery-fulfillment', label: 'Delivery Fulfillment', section: 'sales', perm: 'reports.view', exportable: true },
  { id: 'dispatch-list', label: 'Dispatch List', section: 'sales', perm: 'reports.view', exportable: true },
  { id: 'daily-payables', label: 'Daily Payables', section: 'finance', perm: 'reports.daily-payables', singleDate: true, exportable: true },
  { id: 'daily-receivables', label: 'Daily Receivables', section: 'finance', perm: 'reports.daily-receivables', singleDate: true, exportable: true },
  { id: 'purchase-register', label: 'Purchase Register', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'ar-aging', label: 'AR Aging', section: 'finance', perm: 'reports.view', noDateRange: true, exportable: true },
  { id: 'ap-aging', label: 'AP Aging', section: 'finance', perm: 'reports.view', noDateRange: true, exportable: true },
  { id: 'vat', label: 'VAT Report', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'bir-2550q', label: 'BIR 2550Q Worksheet', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'branch-summary', label: 'Branch / Location Summary', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'withholding-tax', label: 'Withholding Tax', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'slsp-sales', label: 'SLSP Sales', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'slsp-purchases', label: 'SLSP Purchases', section: 'finance', perm: 'reports.view', exportable: true },
  { id: 'inventory-valuation', label: 'Inventory Valuation', section: 'inventory', perm: 'reports.view', noDateRange: true },
  { id: 'stock-movement', label: 'Stock Movement', section: 'inventory', perm: 'reports.view', exportable: true },
  { id: 'slow-moving', label: 'Slow-Moving Items', section: 'inventory', perm: 'reports.view', noDateRange: true, exportable: true },
  { id: 'count-variance', label: 'Count Variance', section: 'inventory', perm: 'reports.view', exportable: true },
  { id: 'low-stock', label: 'Low Stock', section: 'inventory', perm: 'reports.view', noDateRange: true },
  { id: 'reorder-suggestions', label: 'Reorder Suggestions', section: 'inventory', perm: 'reports.view', noDateRange: true, exportable: true },
  { id: 'expiry', label: 'Expiry Report', section: 'inventory', perm: 'reports.view', noDateRange: true },
];

export function canAccessReportSection(
  hasAnyPerm: (keys: string[]) => boolean,
  sectionKey: ReportSectionKey,
): boolean {
  const section = REPORT_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return false;
  return hasAnyPerm([...section.permAny]);
}

export function filterReportsForUser(
  hasPerm: (p: string) => boolean,
  section?: ReportSectionKey,
): ReportDef[] {
  return ALL_REPORTS.filter((r) => {
    if (section && r.section !== section) return false;
    return hasPerm(r.perm);
  });
}

export function reportEndpoint(id: string, from: string, to: string): string {
  switch (id) {
    case 'daily-sales': return `/reports/daily-sales?date=${from}`;
    case 'sales-by-item': return `/reports/sales-by-item?from=${from}&to=${to}`;
    case 'sales-by-cashier': return `/reports/sales-by-cashier?from=${from}&to=${to}`;
    case 'pos-shifts': return `/reports/pos-shifts?from=${from}&to=${to}`;
    case 'sales-by-customer': return `/reports/sales-by-customer?from=${from}&to=${to}`;
    case 'sales-invoice-register': return `/reports/sales-invoice-register?from=${from}&to=${to}`;
    case 'consolidated-sales': return `/reports/consolidated-sales?from=${from}&to=${to}`;
    case 'category-margin': return `/reports/category-margin?from=${from}&to=${to}`;
    case 'delivery-fulfillment': return `/reports/delivery-fulfillment?from=${from}&to=${to}`;
    case 'dispatch-list': return `/reports/dispatch-list?from=${from}&to=${to}`;
    case 'purchase-register': return `/reports/purchases?from=${from}&to=${to}`;
    case 'ar-aging': return '/reports/ar-aging';
    case 'ap-aging': return '/reports/ap-aging';
    case 'daily-payables': return `/reports/daily-payables?date=${from}`;
    case 'daily-receivables': return `/reports/daily-receivables?date=${from}`;
    case 'inventory-valuation': return '/reports/inventory-valuation';
    case 'stock-movement': return `/reports/stock-movement?from=${from}&to=${to}`;
    case 'slow-moving': return '/reports/slow-moving?days=90';
    case 'count-variance': return `/reports/count-variance?from=${from}&to=${to}`;
    case 'low-stock': return '/reports/low-stock';
    case 'reorder-suggestions': return '/reports/reorder-suggestions';
    case 'expiry': return '/reports/expiry?days=30';
    case 'vat': return `/reports/vat?from=${from}&to=${to}`;
    case 'bir-2550q': return `/reports/bir-2550q?from=${from}&to=${to}`;
    case 'branch-summary': return `/reports/branch-summary?from=${from}&to=${to}`;
    case 'withholding-tax': return `/reports/withholding-tax?from=${from}&to=${to}`;
    case 'slsp-sales': return `/reports/slsp-sales?from=${from}&to=${to}`;
    case 'slsp-purchases': return `/reports/slsp-purchases?from=${from}&to=${to}`;
    default: return '';
  }
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportDailyPayables(data: any, date: string) {
  if (!data?.rows) return;
  downloadCsv(
    `daily-payables-${date}.csv`,
    ['Voucher #', 'Payment Date', 'Supplier', 'Method', 'Reference', 'Check Bank', 'Check Date', 'Amount', 'APV #', 'Prepared By'],
    data.rows.map((r: any) => [
      r.voucher_number, r.payment_date, r.supplier_name || '', r.payment_method,
      r.reference_number || '', r.check_bank || '', r.check_date || '',
      r.amount, r.apv_number || '', r.created_by_name || '',
    ]),
  );
}

export function exportDailyReceivables(data: any, date: string) {
  if (!data?.rows) return;
  downloadCsv(
    `daily-receivables-${date}.csv`,
    ['Receipt #', 'Payment Date', 'Customer', 'Method', 'Reference', 'Check Bank', 'Check Date', 'Amount Received', 'Prepared By'],
    data.rows.map((r: any) => [
      r.receipt_number, r.payment_date, r.customer_name || '', r.payment_method,
      r.reference_number || '', r.check_bank || '', r.check_date || '',
      r.amount_received, r.created_by_name || '',
    ]),
  );
}

export function exportPosShifts(data: any, from: string, to: string) {
  if (!Array.isArray(data) || data.length === 0) return;
  downloadCsv(
    `pos-shifts-${from}-to-${to}.csv`,
    ['Shift #', 'Cashier', 'Opened', 'Closed', 'Status', 'Net Sales', 'Cash Sales', 'Card', 'GCash', 'Maya', 'Charge', 'Opening Cash', 'Expected', 'Closing', 'Variance', 'Void Total'],
    data.map((s: any) => [
      s.shift_number, s.cashier_name || '', s.opening_date || '', s.closing_date || '', s.status,
      s.net_sales, s.cash_sales, s.card_sales, s.gcash_sales, s.maya_sales, s.charge_sales,
      s.opening_cash, s.expected_cash, s.closing_cash, s.cash_variance, s.void_total,
    ]),
  );
}

export const AGING_BUCKET_LABELS: Record<string, string> = {
  current: 'Current',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: 'Over 90 days',
  no_due: 'No due date',
};

export function exportPurchaseRegister(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `purchase-register-${from}-to-${to}.csv`,
    ['PO #', 'Order Date', 'Supplier', 'Status', 'VAT Mode', 'Subtotal', 'Discount', 'Tax', 'VAT', 'Total'],
    data.rows.map((r: any) => [
      r.po_number, r.order_date, r.supplier_name || '', r.status, r.vat_mode || '',
      r.subtotal, r.discount, r.tax, r.vat_amount, r.total,
    ]),
  );
}

export function exportSalesInvoiceRegister(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `sales-invoice-register-${from}-to-${to}.csv`,
    ['Invoice #', 'Invoice Date', 'Due Date', 'Customer', 'TIN', 'Status', 'Subtotal', 'Discount', 'VAT Sales', 'VAT', 'Total', 'Paid', 'Balance'],
    data.rows.map((r: any) => [
      r.invoice_number, r.invoice_date, r.due_date || '', r.customer_name || '', r.customer_tin || '',
      r.status, r.subtotal, r.discount, r.vatable_sales, r.vat_amount, r.total, r.amount_paid, r.balance,
    ]),
  );
}

export function exportArAging(data: any) {
  if (!data?.rows) return;
  const today = new Date().toISOString().split('T')[0];
  downloadCsv(
    `ar-aging-${today}.csv`,
    ['Invoice #', 'Customer', 'Invoice Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Aging', 'Status'],
    data.rows.map((r: any) => [
      r.invoice_number, r.customer_name || '', r.invoice_date, r.due_date || '',
      r.total, r.amount_paid, r.balance_due, AGING_BUCKET_LABELS[r.aging_bucket] || r.aging_bucket, r.status,
    ]),
  );
}

export function exportApAging(data: any) {
  if (!data?.rows) return;
  const today = new Date().toISOString().split('T')[0];
  downloadCsv(
    `ap-aging-${today}.csv`,
    ['APV #', 'Supplier', 'APV Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Aging', 'Status', 'PO #'],
    data.rows.map((r: any) => [
      r.apv_number, r.supplier_name || '', r.apv_date, r.due_date || '',
      r.total_amount, r.amount_paid, r.balance_due, AGING_BUCKET_LABELS[r.aging_bucket] || r.aging_bucket,
      r.status, r.po_number || '',
    ]),
  );
}

export function exportConsolidatedSales(data: any, from: string, to: string) {
  if (!data?.daily) return;
  downloadCsv(
    `consolidated-sales-${from}-to-${to}.csv`,
    ['Date', 'POS Txns', 'Credit Invoices', 'POS Sales', 'Credit Sales', 'Total Sales', 'Total Cost', 'Gross Profit', 'Margin %'],
    data.daily.map((r: any) => [
      r.sale_date, r.pos_count, r.credit_count, r.pos_sales, r.credit_sales,
      r.total_sales, r.total_cost, r.gross_profit, r.margin_pct,
    ]),
  );
}

export function exportCategoryMargin(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `category-margin-${from}-to-${to}.csv`,
    ['Category', 'Sales Account', 'COGS Account', 'Sales', 'COGS', 'Gross Profit', 'Margin %'],
    data.rows.map((r: any) => [
      r.category, r.revenue_code, r.cogs_code, r.sales, r.cogs, r.gross_profit, r.margin_pct,
    ]),
  );
}

export function exportDeliveryFulfillment(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `delivery-fulfillment-${from}-to-${to}.csv`,
    ['SO #', 'Order Date', 'Customer', 'Stage', 'SO Status', 'Ordered Qty', 'Delivered Qty', 'Remaining Qty', 'Delivery %', 'DRs', 'Invoices', 'Order Value', 'Invoiced', 'Uninvoiced'],
    data.rows.map((r: any) => [
      r.so_number, r.order_date, r.customer_name || '', r.fulfillment_stage, r.status,
      r.total_ordered_qty, r.total_delivered_qty, r.total_remaining_qty, r.delivery_pct,
      r.dr_posted_count, r.invoice_count, r.order_value, r.invoiced_amount, r.uninvoiced_amount,
    ]),
  );
}

export function exportDispatchList(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `dispatch-list-${from}-to-${to}.csv`,
    ['Date', 'DR #', 'Customer', 'SO #', 'Driver', 'Vehicle', 'Qty', 'Status', 'Address'],
    data.rows.map((r: any) => [
      r.delivery_date, r.dr_number, r.customer_name || '', r.so_number || '',
      r.driver_name || '', r.vehicle_plate || '', r.total_qty, r.status, r.delivery_address || '',
    ]),
  );
}

export function exportReorderSuggestions(data: any) {
  if (!data?.rows) return;
  downloadCsv(
    `reorder-suggestions-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Supplier', 'SKU', 'Product', 'On Hand', 'Reorder Level', 'Suggested Qty', 'Est. Unit Cost'],
    data.rows.map((r: any) => [
      r.supplier_name || 'No Supplier', r.sku, r.product_name, r.on_hand, r.reorder_level,
      r.suggested_qty, r.est_unit_cost,
    ]),
  );
}

export function exportBir2550q(data: any, from: string, to: string) {
  if (!data?.lines) return;
  downloadCsv(
    `bir-2550q-${from}-to-${to}.csv`,
    ['Line', 'Description', 'Amount', 'Source'],
    data.lines.map((r: any) => [r.line, r.description, r.amount, r.source || '']),
  );
}

export function exportBranchSummary(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `branch-summary-${from}-to-${to}.csv`,
    ['Location', 'Type', 'Inventory Value', 'Qty on Hand', 'Credit Sales', 'COGS', 'Gross Profit'],
    data.rows.map((r: any) => [
      r.location_name, r.location_type, r.inventory_value, r.total_qty,
      r.credit_sales, r.cogs, r.gross_profit,
    ]),
  );
}

export function exportWithholdingTax(data: any, from: string, to: string) {
  const invRows = (data?.invoice_rows || []).map((r: any) => [
    'Invoice', r.invoice_number, r.invoice_date, r.customer_name || '', r.customer_tin || '',
    r.ewt_amount, r.lgu_amount, r.total,
  ]);
  const colRows = (data?.collection_rows || []).map((r: any) => [
    'Collection', r.receipt_number, r.payment_date, r.customer_name || '', r.customer_tin || '',
    r.ewt_amount, r.lgu_amount, r.applied_amount,
  ]);
  if (invRows.length === 0 && colRows.length === 0) return;
  downloadCsv(
    `withholding-tax-${from}-to-${to}.csv`,
    ['Type', 'Doc #', 'Date', 'Customer', 'TIN', 'EWT', 'LGU', 'Amount'],
    [...invRows, ...colRows],
  );
}

export function exportSlspSales(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `slsp-sales-${from}-to-${to}.csv`,
    ['Doc #', 'Date', 'Source', 'Customer', 'TIN', 'Gross Sales', 'Exempt', 'Zero Rated', 'VATable', 'Output VAT'],
    data.rows.map((r: any) => [
      r.doc_number, r.doc_date, r.source, r.customer_name || '', r.customer_tin || '',
      r.gross_sales, r.exempt_sales, r.zero_rated_sales, r.vatable_sales, r.output_vat,
    ]),
  );
}

export function exportSlspPurchases(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `slsp-purchases-${from}-to-${to}.csv`,
    ['APV #', 'Date', 'Supplier Invoice #', 'Supplier', 'TIN', 'Gross', 'Exempt', 'VATable', 'Input VAT', 'Status'],
    data.rows.map((r: any) => [
      r.doc_number, r.doc_date, r.supplier_invoice_number || '', r.supplier_name || '', r.supplier_tin || '',
      r.gross_purchases, r.exempt_purchases, r.vatable_purchases, r.input_vat, r.status,
    ]),
  );
}

export function exportStockMovement(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `stock-movement-${from}-to-${to}.csv`,
    ['Date', 'SKU', 'Product', 'Location', 'Reference', 'Type', 'Qty', 'Signed Qty', 'Unit Cost', 'Total Cost', 'Running Qty'],
    data.rows.map((r: any) => [
      r.created_at, r.sku, r.product_name, r.location_name || '',
      r.reference_type, r.transaction_type, r.quantity, r.signed_qty,
      r.unit_cost, r.total_cost, r.running_quantity,
    ]),
  );
}

export function exportSlowMoving(data: any) {
  if (!data?.rows) return;
  downloadCsv(
    `slow-moving-${data?.summary?.days_threshold || 90}days.csv`,
    ['SKU', 'Product', 'Location', 'Qty', 'Unit Cost', 'Stock Value', 'Last Out Movement', 'Days Since Movement'],
    data.rows.map((r: any) => [
      r.sku, r.product_name, r.location_name || '', r.quantity, r.unit_cost, r.stock_value,
      r.last_movement_at || 'Never', r.days_since_movement ?? 'Never',
    ]),
  );
}

export function exportCountVariance(data: any, from: string, to: string) {
  if (!data?.rows) return;
  downloadCsv(
    `count-variance-${from}-to-${to}.csv`,
    ['Count #', 'Count Date', 'Location', 'SKU', 'Product', 'System Qty', 'Actual Qty', 'Variance', 'Unit Cost', 'Variance Value'],
    data.rows.map((r: any) => [
      r.count_number, r.count_date, r.location_name || '', r.sku, r.product_name,
      r.system_qty, r.actual_qty, r.variance, r.unit_cost, r.variance_value,
    ]),
  );
}
