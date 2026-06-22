export interface InvoiceLineInput {
  quantity: number | string;
  unit_price: number | string;
  discount?: number | string;
  tax_type?: string;
}

export interface InvoiceLinePreview {
  gross: number;
  discountAmt: number;
  netAfterDisc: number;
  vatAmount: number;
  lguTax: number;
  whtAmount: number;
  vatableSales: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  total: number;
}

export function computeInvoiceLine(
  item: InvoiceLineInput,
  invoiceTaxType: string,
  ewtRate: number | string
): InvoiceLinePreview {
  const qty = parseFloat(String(item.quantity)) || 0;
  const price = parseFloat(String(item.unit_price)) || 0;
  const disc = parseFloat(String(item.discount ?? 0)) || 0;
  const gross = qty * price;
  const discountAmt = gross * (disc / 100);
  const netAfterDisc = gross - discountAmt;
  const taxType = item.tax_type || invoiceTaxType;
  const ewtPercent = parseFloat(String(ewtRate)) || 0;

  let vatAmount = 0;
  let lguTax = 0;
  let whtAmount = 0;
  let vatableSales = 0;
  let vatExemptSales = 0;
  let zeroRatedSales = 0;

  if (taxType === 'VATable' || taxType === 'VAT') {
    vatableSales = netAfterDisc / 1.12;
    vatAmount = netAfterDisc - vatableSales;
    if (ewtPercent > 0) whtAmount = vatableSales * (ewtPercent / 100);
  } else if (taxType === 'VAT Exempt') {
    vatExemptSales = netAfterDisc;
    if (ewtPercent > 0) whtAmount = netAfterDisc * (ewtPercent / 100);
  } else if (taxType === 'Zero Rated') {
    zeroRatedSales = netAfterDisc;
    if (ewtPercent > 0) whtAmount = netAfterDisc * (ewtPercent / 100);
  } else if (taxType === 'LGU 5% Final VAT' || taxType === 'LGU') {
    const netOfVat = netAfterDisc / 1.12;
    vatAmount = netAfterDisc - netOfVat;
    lguTax = netOfVat * 0.05;
    whtAmount = netOfVat * 0.01;
    vatableSales = netOfVat;
  }

  return {
    gross,
    discountAmt,
    netAfterDisc,
    vatAmount,
    lguTax,
    whtAmount,
    vatableSales,
    vatExemptSales,
    zeroRatedSales,
    total: netAfterDisc,
  };
}

/** SQ/SO: fixed peso discount per line, VAT-inclusive unit prices. */
export interface SalesDocLineInput {
  quantity: number | string;
  unit_price: number | string;
  discount?: number | string;
  tax_type?: string;
}

function applySalesDocTax(netAfterDisc: number, taxType: string) {
  let vatAmount = 0;
  let vatableSales = 0;
  let lguTax = 0;
  let vatExempt = 0;
  let zeroRated = 0;

  if (taxType === 'VATable' || taxType === 'VAT') {
    vatableSales = netAfterDisc / 1.12;
    vatAmount = netAfterDisc - vatableSales;
  } else if (taxType === 'VAT Exempt') {
    vatExempt = netAfterDisc;
  } else if (taxType === 'Zero Rated') {
    zeroRated = netAfterDisc;
  } else if (taxType === 'LGU 5% Final VAT' || taxType === 'LGU') {
    const netOfVat = netAfterDisc / 1.12;
    vatAmount = netAfterDisc - netOfVat;
    lguTax = netOfVat * 0.05;
    vatableSales = netOfVat;
  }

  return { vatAmount, vatableSales, lguTax, vatExempt, zeroRated };
}

export function computeSalesDocLine(item: SalesDocLineInput, defaultTaxType = 'VAT') {
  const qty = parseFloat(String(item.quantity)) || 0;
  const price = parseFloat(String(item.unit_price)) || 0;
  const discountAmt = parseFloat(String(item.discount ?? 0)) || 0;
  const taxType = item.tax_type || defaultTaxType;
  const gross = qty * price;
  const netAfterDisc = Math.max(0, gross - discountAmt);
  const tax = applySalesDocTax(netAfterDisc, taxType);

  return {
    gross,
    discountAmt,
    netAfterDisc,
    tax_type: taxType,
    vat_amount: Math.round(tax.vatAmount * 100) / 100,
    ...tax,
    total: netAfterDisc,
  };
}

export function computeSalesDocTotals(items: SalesDocLineInput[], defaultTaxType = 'VAT') {
  const lines = (items || []).map((item) => computeSalesDocLine(item, defaultTaxType));

  return lines.reduce(
    (acc, line) => ({
      grossSubtotal: acc.grossSubtotal + line.gross,
      totalDiscount: acc.totalDiscount + line.discountAmt,
      lineFinalTotal: acc.lineFinalTotal + line.total,
      totalVatableSales: acc.totalVatableSales + line.vatableSales,
      totalVatExemptSales: acc.totalVatExemptSales + line.vatExempt,
      totalZeroRatedSales: acc.totalZeroRatedSales + line.zeroRated,
      totalVat: acc.totalVat + line.vatAmount,
      totalLguTax: acc.totalLguTax + line.lguTax,
    }),
    {
      grossSubtotal: 0,
      totalDiscount: 0,
      lineFinalTotal: 0,
      totalVatableSales: 0,
      totalVatExemptSales: 0,
      totalZeroRatedSales: 0,
      totalVat: 0,
      totalLguTax: 0,
    },
  );
}

export function computeInvoiceEwtTotal(
  items: InvoiceLineInput[],
  ewtRate: number | string,
  defaultTaxType = 'VATable'
): number {
  const total = (items || []).reduce(
    (sum, item) => sum + computeInvoiceLine(item, defaultTaxType, ewtRate).whtAmount,
    0
  );
  return Math.round(total * 100) / 100;
}

/** EWT on partial or full collection — proportional to applied vs net collectible (total − LGU). */
export function computeEwtForAppliedAmount(
  items: InvoiceLineInput[],
  ewtRate: number | string,
  defaultTaxType: string,
  appliedAmount: number,
  invoiceTotal: number,
  lguAmount: number
): number {
  const fullEwt = computeInvoiceEwtTotal(items, ewtRate, defaultTaxType);
  const netCollectible = Math.max(0, invoiceTotal - lguAmount);
  if (fullEwt <= 0 || netCollectible <= 0 || appliedAmount <= 0) return 0;
  if (appliedAmount >= netCollectible - 0.01) return fullEwt;
  return Math.round(fullEwt * (appliedAmount / netCollectible) * 100) / 100;
}

export function resolveInvoiceEwtRate(
  storedRate: number | string | null | undefined,
  items: InvoiceLineInput[],
  withholdingTax: number | string | null | undefined,
  defaultTaxType = 'VATable'
): string {
  const stored = parseFloat(String(storedRate ?? ''));
  if (!Number.isNaN(stored) && stored >= 0 && (stored === 0 || stored === 1 || stored === 2)) {
    return String(stored);
  }
  const wht = parseFloat(String(withholdingTax ?? '0')) || 0;
  if (wht <= 0 || !items?.length) return '0';
  for (const rate of [1, 2]) {
    const computed = computeInvoiceEwtTotal(items, rate, defaultTaxType);
    if (Math.abs(computed - wht) < 0.02) return String(rate);
  }
  return '0';
}
