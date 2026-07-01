import { PRIMARY, FINANCE_FONT, financeTabClass } from './financeUtils';
import { POS_SALES_NO_VAT } from './retailTaxPolicy';

export { PRIMARY, FINANCE_FONT, financeTabClass };

export const POS_TABS = [
  { key: 'register', label: 'Register' },
  { key: 'sales', label: 'Shift Sales' },
  { key: 'history', label: 'History' },
  { key: 'advanced', label: 'Advanced' },
] as const;

export type PosTabKey = (typeof POS_TABS)[number]['key'];

/** Local bridge for ESC/POS thermal printers (Bluetooth/COM). Runs on each cashier PC — not on the cloud server. */
export const THERMAL_PRINT_SERVER =
  (import.meta.env.VITE_THERMAL_PRINT_SERVER as string | undefined)?.trim() || 'http://localhost:9999';

/** Screen preview / browser print use Unicode ₱; thermal server converts to CP850 peso byte before printing. */

export const THERMAL_PRINT_START_HINT =
  'Thermal print bridge is not running on this PC. Double-click start-print-server.bat, or run install-print-server-autostart.bat once so it starts automatically at Windows login. Logs: logs\\print-server.log';

export const PAYMENT_METHODS_UI = [
  { label: 'Cash', value: 'Cash' },
  { label: 'GCash', value: 'GCash' },
  { label: 'Maya', value: 'Maya' },
  { label: 'Card', value: 'Credit Card' },
  { label: 'Check', value: 'Check' },
  { label: 'Charge', value: 'Charge' },
  { label: 'Salary Ded.', value: 'Salary Deduction' },
] as const;

export function paperChars(paperSize?: number): number {
  return paperSize === 80 ? 48 : 32;
}

export function centerText(text: string, width: number) {
  const trimmed = text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - trimmed.length) / 2));
  return ' '.repeat(pad) + trimmed;
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + '…';
}

export function leftRightText(left: string, right: string, width: number) {
  const rightPart = right.slice(0, width);
  const maxLeft = Math.max(1, width - rightPart.length - 1);
  const leftPart = truncateText(left, maxLeft);
  const gap = width - leftPart.length - rightPart.length;
  return leftPart + (gap > 0 ? ' '.repeat(gap) : ' ') + rightPart;
}

export function wrapText(text: string, maxLen: number): string[] {
  const clean = (text || '').trim();
  if (!clean) return [''];
  if (clean.length <= maxLen) return [clean];

  const lines: string[] = [];
  let remaining = clean;
  while (remaining.length > maxLen) {
    let breakAt = remaining.lastIndexOf(' ', maxLen);
    if (breakAt <= 0) breakAt = maxLen;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  return lines.length ? lines : [''];
}

export function centerBlock(text: string, width: number): string {
  return wrapText(text, width).map((line) => centerText(line, width)).join('\n');
}

function formatReceiptAmount(v: number): string {
  const num = v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₱${num}`;
}

function formatReceiptQty(qty: number): string {
  const n = parseFloat(String(qty));
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function getReceiptColumns(width: number) {
  const amountCol = width >= 48 ? 12 : 10;
  const qtyCol = width >= 48 ? 5 : 4;
  const nameCol = Math.max(8, width - qtyCol - amountCol);
  return { nameCol, qtyCol, amountCol };
}

function formatItemLines(name: string, qty: number, amount: string, width: number): string[] {
  const { nameCol, qtyCol, amountCol } = getReceiptColumns(width);
  const amountText = amount.padStart(amountCol);
  const qtyText = formatReceiptQty(qty).padStart(qtyCol);
  const nameLines = wrapText(name, nameCol);
  const lines: string[] = [
    truncateText(nameLines[0], nameCol).padEnd(nameCol) + qtyText + amountText,
  ];
  for (let i = 1; i < nameLines.length; i += 1) {
    lines.push(truncateText(nameLines[i], nameCol).padEnd(nameCol));
  }
  return lines;
}

export type ReceiptData = {
  transaction_number: string;
  date: Date;
  items: any[];
  subtotal: number;
  totalDiscount: number;
  vat: number;
  netTotal: number;
  paymentMethod: string;
  tendered: number;
  change: number;
  customerName?: string;
  priceMode?: string;
};

export type ReceiptPrintOpts = {
  businessName?: string;
  businessAddress?: string;
  tin?: string;
  cashierName?: string;
  reprint?: boolean;
  paperSize?: number;
};

/** Map a POS transaction API payload to printable receipt data. */
export function txnToReceiptData(txn: any, opts?: { cashierName?: string }): ReceiptData {
  const items = (txn.items || []).map((i: any) => ({
    name: i.description || i.name || 'Item',
    quantity: parseFloat(i.sold_entered_qty ?? i.entered_qty ?? i.quantity) || 0,
    unit_price: parseFloat(i.unit_price) || 0,
    discount: parseFloat(i.discount || 0),
    total: parseFloat(i.total) || 0,
  }));
  return {
    transaction_number: txn.transaction_number,
    date: new Date(txn.created_at),
    items,
    subtotal: parseFloat(txn.subtotal || 0),
    totalDiscount: parseFloat(txn.discount_total || 0),
    vat: parseFloat(txn.tax_total || 0),
    netTotal: parseFloat(txn.total || 0),
    paymentMethod: txn.payment_method || 'Cash',
    tendered: parseFloat(txn.amount_tendered ?? txn.total ?? 0),
    change: parseFloat(txn.change_amount || 0),
    customerName: txn.customer_name || 'Walk-in',
    priceMode: txn.price_mode,
  };
}

export function buildReceiptText(r: ReceiptData, opts: ReceiptPrintOpts) {
  const W = paperChars(opts.paperSize);
  const ft = (v: number) => formatReceiptAmount(v);
  const line = '='.repeat(W);
  const dash = '-'.repeat(W);
  const { nameCol, qtyCol, amountCol } = getReceiptColumns(W);
  let text = '';

  text += centerBlock(opts.businessName || 'D METRAN TRADING', W) + '\n';
  text += centerBlock('DMT POS', W) + '\n';
  if (opts.businessAddress) text += centerBlock(opts.businessAddress, W) + '\n';
  if (opts.tin) text += centerBlock(`TIN: ${opts.tin}`, W) + '\n';
  text += line + '\n';
  if (opts.reprint) text += centerBlock('*** REPRINT COPY ***', W) + '\n';
  text += leftRightText('Receipt #:', r.transaction_number, W) + '\n';
  text += leftRightText('Date:', r.date.toLocaleString('en-PH'), W) + '\n';
  text += leftRightText('Cashier:', opts.cashierName || '—', W) + '\n';
  text += leftRightText('Customer:', r.customerName || 'Walk-in', W) + '\n';
  if (r.priceMode) text += leftRightText('Price Mode:', r.priceMode, W) + '\n';
  text += dash + '\n';
  text += 'ITEM'.padEnd(nameCol) + 'QTY'.padStart(qtyCol) + 'AMOUNT'.padStart(amountCol) + '\n';
  text += dash + '\n';

  for (const item of r.items) {
    const itemTotal = ft(item.total || item.quantity * item.unit_price * (1 - (item.discount || 0) / 100));
    const itemLines = formatItemLines(item.name || '', item.quantity, itemTotal, W);
    text += itemLines.join('\n') + '\n';
    if (item.discount > 0) text += `  Disc: ${item.discount}%\n`;
  }

  text += dash + '\n';
  text += leftRightText('Subtotal:', ft(r.subtotal), W) + '\n';
  if (r.totalDiscount > 0) text += leftRightText('Discount:', ft(r.totalDiscount), W) + '\n';
  if (!POS_SALES_NO_VAT) {
    const vatableSales = r.netTotal - r.vat;
    text += leftRightText('VATable Sales:', ft(vatableSales), W) + '\n';
    text += leftRightText('VAT 12%:', ft(r.vat), W) + '\n';
  }
  text += dash + '\n';
  text += leftRightText('TOTAL:', ft(r.netTotal), W) + '\n';
  text += leftRightText(`${r.paymentMethod}:`, ft(r.tendered), W) + '\n';
  if (r.change > 0) text += leftRightText('Change:', ft(r.change), W) + '\n';
  text += line + '\n';
  text += centerBlock('THANK YOU!', W) + '\n';
  text += centerBlock('Please come again', W) + '\n';
  text += line + '\n\n';
  return text;
}

export function buildThermalPrintHtml(text: string, paperSize = 58): string {
  const widthMm = paperSize === 80 ? 80 : 58;
  const fontSize = paperSize === 80 ? '9px' : '8px';
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt</title>
<style>
@page { size: ${widthMm}mm auto; margin: 2mm; }
body { font-family: 'Courier New', monospace; font-size: ${fontSize}; width: ${widthMm}mm; max-width: ${widthMm}mm; padding: 1mm; margin: 0 auto; white-space: pre; line-height: 1.25; }
</style></head><body>${safe}</body></html>`;
}

const PRINT_FRAME_ID = 'pos-thermal-print-frame';

/** Print HTML via hidden iframe — avoids popup blockers after async thermal attempts. */
export function printHtmlToBrowser(html: string): boolean {
  let frame = document.getElementById(PRINT_FRAME_ID) as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = PRINT_FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
  }
  const win = frame.contentWindow;
  const doc = frame.contentDocument || win?.document;
  if (!doc || !win) return false;
  doc.open();
  doc.write(html);
  doc.close();
  win.focus();
  win.print();
  return true;
}

export function buildXReadingText(
  s: any,
  txs: any[],
  opts: { businessName?: string; cashierName?: string; paperSize?: number },
) {
  const W = paperChars(opts.paperSize);
  const fc = (v: number) => v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
  const line = '='.repeat(W);
  const dash = '-'.repeat(W);
  const totalTx = txs.filter((t) => t.status === 'Completed').length;
  const totalVoid = txs.filter((t) => t.status === 'Void').length;
  let text = '';
  text += centerBlock(opts.businessName || 'D METRAN TRADING', W) + '\n';
  text += centerBlock('X READING', W) + '\n';
  text += centerBlock('(Mid-Shift Report)', W) + '\n';
  text += line + '\n';
  text += leftRightText('Shift #:', s.shift_number || '', W) + '\n';
  text += leftRightText('Cashier:', opts.cashierName || s.user_name || '', W) + '\n';
  text += leftRightText('Open:', new Date(s.opening_date || s.created_at).toLocaleString('en-PH'), W) + '\n';
  text += 'Status: OPEN\n';
  text += dash + '\n';
  text += leftRightText('Cash Sales:', fc(parseFloat(s.cash_sales) || 0), W) + '\n';
  text += leftRightText('GCash:', fc(parseFloat(s.gcash_sales) || 0), W) + '\n';
  text += leftRightText('Maya:', fc(parseFloat(s.maya_sales) || 0), W) + '\n';
  text += leftRightText('Card:', fc(parseFloat(s.card_sales) || 0), W) + '\n';
  text += leftRightText('Bank Transfer:', fc(parseFloat(s.bank_transfer_sales) || 0), W) + '\n';
  text += leftRightText('Charge:', fc(parseFloat(s.charge_sales) || 0), W) + '\n';
  text += dash + '\n';
  text += leftRightText('Total Sales:', fc(parseFloat(s.total_sales) || 0), W) + '\n';
  text += leftRightText('Discounts:', fc(parseFloat(s.discount_total) || 0), W) + '\n';
  text += leftRightText('Net Sales:', fc(parseFloat(s.net_sales) || 0), W) + '\n';
  text += leftRightText('Voids:', fc(parseFloat(s.void_total) || 0), W) + '\n';
  text += leftRightText('Returns:', fc(parseFloat(s.return_total) || 0), W) + '\n';
  text += dash + '\n';
  text += leftRightText('Transactions:', String(totalTx), W) + '\n';
  text += leftRightText('Voids:', String(totalVoid), W) + '\n';
  text += line + '\n';
  text += centerBlock(new Date().toLocaleString('en-PH'), W) + '\n\n';
  return text;
}

export function buildZReadingText(
  s: any,
  txs: any[],
  opts: { businessName?: string; paperSize?: number },
) {
  const W = paperChars(opts.paperSize);
  const fc = (v: number) => v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
  const line = '='.repeat(W);
  const dash = '-'.repeat(W);
  const totalTx = txs.filter((t) => t.status === 'Completed').length;
  const totalVoid = txs.filter((t) => t.status === 'Void').length;
  let text = '';
  text += centerBlock(opts.businessName || 'D METRAN TRADING', W) + '\n';
  text += centerBlock('Z READING', W) + '\n';
  text += centerBlock('(End-of-Shift Report)', W) + '\n';
  text += line + '\n';
  text += leftRightText('Shift #:', s.shift_number || '', W) + '\n';
  text += leftRightText('Cashier:', s.user_name || '', W) + '\n';
  text += leftRightText('Open:', new Date(s.opening_date || s.created_at).toLocaleString('en-PH'), W) + '\n';
  text += leftRightText('Close:', new Date(s.closing_date).toLocaleString('en-PH'), W) + '\n';
  text += 'Status: CLOSED\n';
  text += dash + '\n';
  text += leftRightText('Cash Sales:', fc(parseFloat(s.cash_sales) || 0), W) + '\n';
  text += leftRightText('GCash:', fc(parseFloat(s.gcash_sales) || 0), W) + '\n';
  text += leftRightText('Maya:', fc(parseFloat(s.maya_sales) || 0), W) + '\n';
  text += leftRightText('Card:', fc(parseFloat(s.card_sales) || 0), W) + '\n';
  text += leftRightText('Bank Transfer:', fc(parseFloat(s.bank_transfer_sales) || 0), W) + '\n';
  text += leftRightText('Charge:', fc(parseFloat(s.charge_sales) || 0), W) + '\n';
  text += dash + '\n';
  text += leftRightText('Total Sales:', fc(parseFloat(s.total_sales) || 0), W) + '\n';
  text += leftRightText('Discounts:', fc(parseFloat(s.discount_total) || 0), W) + '\n';
  text += leftRightText('Net Sales:', fc(parseFloat(s.net_sales) || 0), W) + '\n';
  text += leftRightText('Voids:', fc(parseFloat(s.void_total) || 0), W) + '\n';
  text += dash + '\n';
  text += leftRightText('Opening Cash:', fc(parseFloat(s.opening_cash) || 0), W) + '\n';
  text += leftRightText('Closing Cash:', fc(parseFloat(s.closing_cash) || 0), W) + '\n';
  const variance = parseFloat(s.closing_cash || '0') - parseFloat(s.expected_cash || '0');
  text += leftRightText('Variance:', fc(variance), W) + '\n';
  text += dash + '\n';
  text += leftRightText('Transactions:', String(totalTx), W) + '\n';
  text += leftRightText('Voids:', String(totalVoid), W) + '\n';
  text += line + '\n';
  text += centerBlock(new Date().toLocaleString('en-PH'), W) + '\n\n';
  return text;
}

export const RECENT_PRODUCTS_KEY = 'pos_recent_products';

export type RecentProductRecord = {
  id: string;
  name: string;
  sku?: string;
  unit_price?: number;
  uom_code?: string;
  stock?: number;
  price_mode?: string;
};

export function pushRecentProduct(product: RecentProductRecord) {
  try {
    const raw = localStorage.getItem(RECENT_PRODUCTS_KEY);
    const list: RecentProductRecord[] = raw ? JSON.parse(raw) : [];
    const next = [product, ...list.filter((p) => p.id !== product.id)].slice(0, 8);
    localStorage.setItem(RECENT_PRODUCTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export function loadRecentProducts(): RecentProductRecord[] {
  try {
    const raw = localStorage.getItem(RECENT_PRODUCTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
