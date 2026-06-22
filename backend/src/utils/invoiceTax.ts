export interface InvoiceLineInput {
  quantity: number | string;
  unit_price: number | string;
  discount?: number | string;
  tax_type?: string;
  [key: string]: any;
}

export interface CalculatedInvoiceLine extends InvoiceLineInput {
  quantity: number;
  unit_price: number;
  discount: number;
  tax_type: string;
  gross: number;
  discountAmt: number;
  netAfterDisc: number;
  tax_amount: number;
  total: number;
  vatable: number;
  vat: number;
  lgu: number;
  wht: number;
  zeroRated: number;
  vatExempt: number;
}

export interface InvoiceTaxTotals {
  subtotal: number;
  totalDiscount: number;
  totalVat: number;
  totalLguTax: number;
  totalWht: number;
  totalVatableSales: number;
  totalVatExemptSales: number;
  totalZeroRatedSales: number;
  lineFinalTotal: number;
  netRevenue: number;
}

export function calculateInvoiceLine(
  item: InvoiceLineInput,
  ewtPercent = 0,
  defaultTaxType = 'VAT'
): CalculatedInvoiceLine {
  const qty = parseFloat(String(item.quantity)) || 0;
  const price = parseFloat(String(item.unit_price)) || 0;
  const disc = parseFloat(String(item.discount ?? 0)) || 0;
  const taxType = item.tax_type || defaultTaxType;
  const gross = qty * price;
  const discountAmt = gross * (disc / 100);
  const netAfterDisc = gross - discountAmt;

  let tax_amount = 0;
  let total = netAfterDisc;
  let vatable = 0;
  let vat = 0;
  let lgu = 0;
  let wht = 0;
  let zeroRated = 0;
  let vatExempt = 0;

  if (taxType === 'VAT' || taxType === 'VATable') {
    vatable = netAfterDisc / 1.12;
    tax_amount = netAfterDisc - vatable;
    vat = tax_amount;
    if (ewtPercent > 0) wht = vatable * (ewtPercent / 100);
  } else if (taxType === 'VAT Exempt') {
    vatExempt = netAfterDisc;
    if (ewtPercent > 0) wht = netAfterDisc * (ewtPercent / 100);
  } else if (taxType === 'Zero Rated') {
    zeroRated = netAfterDisc;
    if (ewtPercent > 0) wht = netAfterDisc * (ewtPercent / 100);
  } else if (taxType === 'LGU' || taxType === 'LGU 5% Final VAT') {
    const netOfVat = netAfterDisc / 1.12;
    tax_amount = netAfterDisc - netOfVat;
    vat = tax_amount;
    lgu = netOfVat * 0.05;
    wht = netOfVat * 0.01;
    vatable = netOfVat;
  }

  return {
    ...item,
    quantity: qty,
    unit_price: price,
    discount: disc,
    tax_type: taxType,
    gross,
    discountAmt,
    netAfterDisc,
    tax_amount,
    total,
    vatable,
    vat,
    lgu,
    wht,
    zeroRated,
    vatExempt,
  };
}

export function calculateInvoiceItems(
  items: InvoiceLineInput[],
  ewtPercent = 0,
  defaultTaxType = 'VAT'
): { lines: CalculatedInvoiceLine[]; totals: InvoiceTaxTotals } {
  const lines = (items || []).map((item) => calculateInvoiceLine(item, ewtPercent, defaultTaxType));

  let totalVatableSales = 0;
  let totalVatExemptSales = 0;
  let totalZeroRatedSales = 0;
  let totalVat = 0;
  let totalLguTax = 0;
  let totalWht = 0;
  let subtotal = 0;
  let totalDiscount = 0;
  let lineFinalTotal = 0;

  for (const line of lines) {
    subtotal += line.gross;
    totalDiscount += line.discountAmt;
    lineFinalTotal += line.total;
    totalVatableSales += line.vatable;
    totalVatExemptSales += line.vatExempt;
    totalZeroRatedSales += line.zeroRated;
    totalVat += line.vat;
    totalLguTax += line.lgu;
    totalWht += line.wht;
  }

  return {
    lines,
    totals: {
      subtotal,
      totalDiscount,
      totalVat,
      totalLguTax,
      totalWht,
      totalVatableSales,
      totalVatExemptSales,
      totalZeroRatedSales,
      lineFinalTotal,
      netRevenue: totalVatableSales + totalVatExemptSales + totalZeroRatedSales,
    },
  };
}

/** SQ/SO lines use a fixed peso discount (not %). Prices are VAT-inclusive. */
export interface SalesDocLineInput {
  quantity: number | string;
  unit_price: number | string;
  discount?: number | string;
  tax_type?: string;
}

function applySalesTax(netAfterDisc: number, taxType: string) {
  let tax_amount = 0;
  let vatable = 0;
  let vat = 0;
  let lgu = 0;
  let zeroRated = 0;
  let vatExempt = 0;

  if (taxType === 'VAT' || taxType === 'VATable') {
    vatable = netAfterDisc / 1.12;
    tax_amount = netAfterDisc - vatable;
    vat = tax_amount;
  } else if (taxType === 'VAT Exempt') {
    vatExempt = netAfterDisc;
  } else if (taxType === 'Zero Rated') {
    zeroRated = netAfterDisc;
  } else if (taxType === 'LGU' || taxType === 'LGU 5% Final VAT') {
    const netOfVat = netAfterDisc / 1.12;
    tax_amount = netAfterDisc - netOfVat;
    vat = tax_amount;
    lgu = netOfVat * 0.05;
    vatable = netOfVat;
  }

  return { tax_amount, vatable, vat, lgu, zeroRated, vatExempt };
}

export function calculateSalesDocLine(item: SalesDocLineInput, defaultTaxType = 'VAT') {
  const qty = parseFloat(String(item.quantity)) || 0;
  const price = parseFloat(String(item.unit_price)) || 0;
  const discountAmt = parseFloat(String(item.discount ?? 0)) || 0;
  const taxType = item.tax_type || defaultTaxType;
  const gross = qty * price;
  const netAfterDisc = Math.max(0, gross - discountAmt);
  const tax = applySalesTax(netAfterDisc, taxType);

  return {
    quantity: qty,
    unit_price: price,
    discount: discountAmt,
    tax_type: taxType,
    gross,
    discountAmt,
    netAfterDisc,
    ...tax,
    total: netAfterDisc,
  };
}

export function calculateSalesDocItems(items: SalesDocLineInput[], defaultTaxType = 'VAT') {
  const lines = (items || []).map((item) => calculateSalesDocLine(item, defaultTaxType));

  let totalVatableSales = 0;
  let totalVatExemptSales = 0;
  let totalZeroRatedSales = 0;
  let totalVat = 0;
  let totalLguTax = 0;
  let grossSubtotal = 0;
  let totalDiscount = 0;
  let lineFinalTotal = 0;

  for (const line of lines) {
    grossSubtotal += line.gross;
    totalDiscount += line.discountAmt;
    lineFinalTotal += line.total;
    totalVatableSales += line.vatable;
    totalVatExemptSales += line.vatExempt;
    totalZeroRatedSales += line.zeroRated;
    totalVat += line.vat;
    totalLguTax += line.lgu;
  }

  return {
    lines,
    totals: {
      grossSubtotal,
      totalDiscount,
      totalVat,
      totalLguTax,
      totalVatableSales,
      totalVatExemptSales,
      totalZeroRatedSales,
      lineFinalTotal,
    },
  };
}

/** Resolve EWT rate from stored column or by matching line totals (legacy invoices). */
export function resolveInvoiceEwtRate(
  storedRate: number | string | null | undefined,
  items: InvoiceLineInput[],
  withholdingTax: number | string | null | undefined,
  defaultTaxType = 'VAT'
): string {
  const stored = parseFloat(String(storedRate ?? ''));
  if (!Number.isNaN(stored) && stored >= 0 && (stored === 0 || stored === 1 || stored === 2)) {
    return String(stored);
  }
  const wht = parseFloat(String(withholdingTax ?? '0')) || 0;
  if (wht <= 0 || !items?.length) return '0';
  for (const rate of [1, 2]) {
    const { totals } = calculateInvoiceItems(items, rate, defaultTaxType);
    if (Math.abs(totals.totalWht - wht) < 0.02) return String(rate);
  }
  return '0';
}
