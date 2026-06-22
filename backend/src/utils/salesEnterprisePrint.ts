import {
  buildPrintDocument,
  fmtCurrency,
  renderEnterpriseHeader,
  renderEnterpriseMetaSections,
  renderEnterpriseItemsTable,
  renderEnterpriseBottom,
  renderEnterpriseNotesBlock,
  renderEnterpriseSignatures,
  renderEnterpriseFooter,
  renderEnterpriseAmountInWords,
  EnterpriseDocMeta,
  TableHeader,
} from './printLayout';

export type SalesSummaryRow = { label: string; value: string; total?: boolean };

export const SALES_LINE_ITEM_HEADERS: TableHeader[] = [
  { text: '#', align: 'center', width: '28px' },
  { text: 'Item Code', align: 'left', width: '72px' },
  { text: 'Description', align: 'left' },
  { text: 'Qty', align: 'center', width: '44px' },
  { text: 'UOM', align: 'center', width: '40px' },
  { text: 'Unit Price', align: 'right', width: '76px' },
  { text: 'Amount', align: 'right', width: '80px' },
];

export function isDraftStatus(status?: string): boolean {
  const s = String(status || '').toLowerCase();
  return ['draft', 'pending'].includes(s);
}

export function buildEnterpriseSignatures(b: Record<string, unknown>) {
  return [
    {
      label: 'Prepared By',
      name: b.prepared_by ? String(b.prepared_by) : undefined,
      imageUrl: b.prepared_by_signature_url ? '/api/settings/signature/prepared' : undefined,
    },
    'Checked By',
    {
      label: 'Approved By',
      name: b.approved_by ? String(b.approved_by) : undefined,
      imageUrl: b.approved_by_signature_url ? '/api/settings/signature/approved' : undefined,
    },
    'Received By',
  ] as (string | { label: string; name?: string; imageUrl?: string })[];
}

export function buildEnterpriseTwoPartySignatures(b: Record<string, unknown>) {
  return [
    {
      label: 'Prepared By',
      name: b.prepared_by ? String(b.prepared_by) : undefined,
      imageUrl: b.prepared_by_signature_url ? '/api/settings/signature/prepared' : undefined,
    },
    'Received By',
  ] as (string | { label: string; name?: string; imageUrl?: string })[];
}

/** Prepared By, Approved By, Received By — for billing / statement of account. */
export function buildBillingStatementSignatures(b: Record<string, unknown>) {
  return [
    {
      label: 'Prepared By',
      name: b.prepared_by ? String(b.prepared_by) : undefined,
      imageUrl: b.prepared_by_signature_url ? '/api/settings/signature/prepared' : undefined,
    },
    {
      label: 'Approved By',
      name: b.approved_by ? String(b.approved_by) : undefined,
      imageUrl: b.approved_by_signature_url ? '/api/settings/signature/approved' : undefined,
    },
    'Received By',
  ] as (string | { label: string; name?: string; imageUrl?: string })[];
}

export interface BillingStatementTotals {
  totalExcVat: number;
  vatAmount: number;
  totalIncVat: number;
  totalWht: number;
  totalLgu: number;
  netAmount: number;
}

export function computeBillingStatementTotals(
  invoices: Array<{
    vatable_sales?: number | string | null;
    vat_exempt_sales?: number | string | null;
    zero_rated_sales?: number | string | null;
    vat_amount?: number | string | null;
    tax?: number | string | null;
    total?: number | string | null;
    withholding_tax?: number | string | null;
    lgu_final_tax?: number | string | null;
  }>,
): BillingStatementTotals {
  let totalExcVat = 0;
  let vatAmount = 0;
  let totalIncVat = 0;
  let totalWht = 0;
  let totalLgu = 0;

  for (const inv of invoices) {
    totalExcVat += parseFloat(String(inv.vatable_sales ?? 0)) || 0;
    totalExcVat += parseFloat(String(inv.vat_exempt_sales ?? 0)) || 0;
    totalExcVat += parseFloat(String(inv.zero_rated_sales ?? 0)) || 0;
    vatAmount += parseFloat(String(inv.vat_amount ?? inv.tax ?? 0)) || 0;
    totalIncVat += parseFloat(String(inv.total ?? 0)) || 0;
    totalWht += parseFloat(String(inv.withholding_tax ?? 0)) || 0;
    totalLgu += parseFloat(String(inv.lgu_final_tax ?? 0)) || 0;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  totalExcVat = round(totalExcVat);
  vatAmount = round(vatAmount);
  totalIncVat = round(totalIncVat);
  totalWht = round(totalWht);
  totalLgu = round(totalLgu);

  return {
    totalExcVat,
    vatAmount,
    totalIncVat,
    totalWht,
    totalLgu,
    netAmount: round(totalIncVat - totalWht - totalLgu),
  };
}

export function buildBillingStatementSummaryRows(totals: BillingStatementTotals): SalesSummaryRow[] {
  const rows: SalesSummaryRow[] = [
    { label: 'Total Php Exc. VAT', value: fmtCurrency(totals.totalExcVat) },
    { label: 'VAT Amount', value: fmtCurrency(totals.vatAmount) },
    { label: 'Total Php Inc. VAT', value: fmtCurrency(totals.totalIncVat) },
  ];
  if (totals.totalWht > 0) {
    rows.push({ label: 'Total WHT', value: fmtCurrency(totals.totalWht) });
  }
  if (totals.totalLgu > 0) {
    rows.push({ label: 'Total LGU Final VAT', value: fmtCurrency(totals.totalLgu) });
  }
  rows.push({ label: 'Total Net Amount', value: fmtCurrency(totals.netAmount), total: true });
  return rows;
}

export function buildCustomerMetaRows(fields: {
  name?: string | null;
  address?: string | null;
  tin?: string | null;
  phone?: string | null;
  code?: string | null;
}): { label: string; value: string }[] {
  return [
    { label: 'Customer Name', value: fields.name || '—' },
    ...(fields.address ? [{ label: 'Address', value: fields.address }] : []),
    ...(fields.tin ? [{ label: 'TIN', value: fields.tin }] : []),
    ...(fields.phone ? [{ label: 'Phone', value: fields.phone }] : []),
    ...(fields.code ? [{ label: 'Customer Code', value: fields.code }] : []),
  ];
}

export function buildSupplierMetaRows(fields: {
  name?: string | null;
  address?: string | null;
  tin?: string | null;
  phone?: string | null;
  code?: string | null;
  contact?: string | null;
}): { label: string; value: string }[] {
  return [
    { label: 'Supplier Name', value: fields.name || '—' },
    ...(fields.code ? [{ label: 'Supplier Code', value: fields.code }] : []),
    ...(fields.address ? [{ label: 'Address', value: fields.address }] : []),
    ...(fields.tin ? [{ label: 'TIN', value: fields.tin }] : []),
    ...(fields.contact ? [{ label: 'Contact Person', value: fields.contact }] : []),
    ...(fields.phone ? [{ label: 'Phone', value: fields.phone }] : []),
  ];
}

export function buildEmployeeMetaRows(fields: {
  name?: string | null;
  code?: string | null;
  department?: string | null;
  position?: string | null;
}): { label: string; value: string }[] {
  return [
    { label: 'Employee Name', value: fields.name || '—' },
    ...(fields.code ? [{ label: 'Employee Code', value: fields.code }] : []),
    ...(fields.department ? [{ label: 'Department', value: fields.department }] : []),
    ...(fields.position ? [{ label: 'Position', value: fields.position }] : []),
  ];
}

export function formatTaxLabel(taxType?: string | null): string {
  return (taxType || 'VAT')
    .replace('VAT Exempt', 'Exempt')
    .replace('Zero Rated', 'Zero')
    .replace('LGU 5% Final VAT', 'LGU 5%');
}

export const PURCHASE_REQUISITION_HEADERS: TableHeader[] = [
  { text: '#', align: 'center', width: '28px' },
  { text: 'Item Code', align: 'left', width: '72px' },
  { text: 'Description', align: 'left' },
  { text: 'Qty', align: 'center', width: '44px' },
  { text: 'UOM', align: 'center', width: '40px' },
  { text: 'Est. Cost', align: 'right', width: '76px' },
  { text: 'Tax', align: 'center', width: '44px' },
  { text: 'Amount', align: 'right', width: '80px' },
];

export const PURCHASE_ORDER_HEADERS: TableHeader[] = [
  { text: 'Description', align: 'left' },
  { text: 'Qty', align: 'center', width: '44px' },
  { text: 'UOM', align: 'center', width: '40px' },
  { text: 'Unit Cost', align: 'right', width: '76px' },
  { text: 'Tax', align: 'center', width: '44px' },
  { text: 'Discount', align: 'right', width: '68px' },
  { text: 'Amount', align: 'right', width: '80px' },
];

export const GOODS_RECEIPT_HEADERS: TableHeader[] = [
  { text: '#', align: 'center', width: '28px' },
  { text: 'Description', align: 'left' },
  { text: 'Qty', align: 'center', width: '44px' },
  { text: 'UOM', align: 'center', width: '40px' },
  { text: 'Batch', align: 'center', width: '64px' },
  { text: 'Expiry', align: 'center', width: '64px' },
  { text: 'Net Cost', align: 'right', width: '76px' },
  { text: 'Amount', align: 'right', width: '80px' },
];

export function buildVatInclusiveSummaryRows(opts: {
  lineCount?: number;
  qtyTotal?: number;
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  totalLabel?: string;
  extra?: SalesSummaryRow[];
}): SalesSummaryRow[] {
  const tax = opts.tax ?? 0;
  const vatable = Math.max(opts.subtotal - tax, 0);
  const rows: SalesSummaryRow[] = [];

  if (opts.lineCount != null) rows.push({ label: 'No. of Line Items', value: String(opts.lineCount) });
  if (opts.qtyTotal != null) rows.push({ label: 'Total Quantity', value: String(opts.qtyTotal) });
  rows.push({ label: 'Subtotal (VAT Incl.)', value: fmtCurrency(opts.subtotal) });

  if ((opts.discount ?? 0) > 0) {
    rows.push({ label: 'Less Discount', value: fmtCurrency(opts.discount!) });
  }
  if (tax > 0.01) {
    rows.push({ label: 'VATable Sales', value: fmtCurrency(vatable) });
    rows.push({ label: 'VAT Amount (12%)', value: fmtCurrency(tax) });
  }
  if (opts.extra?.length) rows.push(...opts.extra);
  rows.push({ label: opts.totalLabel || 'TOTAL AMOUNT DUE', value: fmtCurrency(opts.total), total: true });
  return rows;
}

export interface SalesEnterprisePrintConfig {
  pageTitle: string;
  docTitle: string;
  docMetaRows: EnterpriseDocMeta[];
  /** First meta column — defaults to "Customer Information". */
  customerRows: { label: string; value: string }[];
  partySectionTitle?: string;
  detailsTitle?: string;
  detailsRows: { label: string; value: string }[];
  itemHeaders?: TableHeader[];
  itemRows?: string;
  summaryRows: SalesSummaryRow[];
  notes?: { label: string; content: string }[];
  bottomLeftHtml?: string;
  beforeItemsHtml?: string;
  afterSummaryHtml?: string;
  skipItemsTable?: boolean;
  skipBottom?: boolean;
  footerNote?: string;
  status?: string;
  biz: Record<string, unknown>;
  signatures?: (string | { label: string; name?: string; imageUrl?: string })[];
  signatureCols?: 2 | 3 | 4;
  /** Explicit total for amount-in-words; defaults to the summary row marked `total`. */
  amountInWords?: number;
  /** Set false to hide amount in words even when a total exists. */
  showAmountInWords?: boolean;
  landscape?: boolean;
  skipSignatures?: boolean;
}

function parseSummaryTotal(rows: SalesSummaryRow[]): number | null {
  const totalRow = [...rows].reverse().find((r) => r.total);
  if (!totalRow) return null;
  const parsed = parseFloat(String(totalRow.value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveAmountInWords(config: SalesEnterprisePrintConfig): number | null {
  if (config.showAmountInWords === false) return null;
  if (config.amountInWords != null) return config.amountInWords;
  return parseSummaryTotal(config.summaryRows);
}

export function buildSalesEnterpriseDocument(config: SalesEnterprisePrintConfig): string {
  const notesHtml = (config.notes || []).map((n) => renderEnterpriseNotesBlock(n.label, n.content)).join('');
  const leftBottom = config.bottomLeftHtml ?? notesHtml;
  const wordAmount = resolveAmountInWords(config);
  const wordsHtml = wordAmount != null && wordAmount >= 0 ? renderEnterpriseAmountInWords(wordAmount) : '';

  const bodyParts = [
    renderEnterpriseHeader(config.biz, config.docTitle, config.docMetaRows),
    renderEnterpriseMetaSections([
      { title: config.partySectionTitle || 'Customer Information', rows: config.customerRows },
      { title: config.detailsTitle || 'Document Details', rows: config.detailsRows },
    ]),
    config.beforeItemsHtml || '',
  ];

  if (!config.skipItemsTable && config.itemRows != null) {
    bodyParts.push(renderEnterpriseItemsTable(config.itemHeaders || SALES_LINE_ITEM_HEADERS, config.itemRows));
  }

  if (!config.skipBottom) {
    bodyParts.push(renderEnterpriseBottom(leftBottom, config.summaryRows));
    if (wordsHtml) bodyParts.push(wordsHtml);
  }

  bodyParts.push(
    config.afterSummaryHtml || '',
    ...(config.skipBottom && wordsHtml ? [wordsHtml] : []),
    ...(config.skipSignatures ? [] : [
      renderEnterpriseSignatures(
        config.signatures || buildEnterpriseSignatures(config.biz),
        config.signatureCols,
      ),
    ]),
    renderEnterpriseFooter(config.footerNote),
  );

  return buildPrintDocument(config.pageTitle, bodyParts.filter(Boolean).join(''), {
    theme: 'enterprise',
    draftWatermark: isDraftStatus(config.status),
    landscape: config.landscape,
  });
}
