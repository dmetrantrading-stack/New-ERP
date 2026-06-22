export type PurchaseCostBasis = 'VAT Inclusive' | 'VAT Exclusive';

/** @deprecated Use PurchaseCostBasis — kept for backward compatibility */
export type PurchaseVatMode = PurchaseCostBasis;

export const PURCHASE_COST_BASIS_OPTIONS: PurchaseCostBasis[] = [
  'VAT Inclusive',
  'VAT Exclusive',
];

export const PURCHASE_VAT_MODES = PURCHASE_COST_BASIS_OPTIONS;

export const PURCHASE_TAX_TYPE_OPTIONS = [
  { value: 'VAT', label: 'VAT' },
  { value: 'VAT Exempt', label: 'Exempt' },
  { value: 'Zero Rated', label: 'Zero' },
  { value: 'LGU 5% Final VAT', label: 'LGU 5%' },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PurchaseLineInput {
  qty?: number | string;
  quantity?: number | string;
  unit_cost: number | string;
  discount_amount?: number | string;
  tax_type?: string;
}

export interface PurchaseTaxTotals {
  gross: number;
  discount: number;
  net: number;
  vatable: number;
  vat: number;
  vatExempt: number;
  zeroRated: number;
  total: number;
}

function lineQty(item: PurchaseLineInput) {
  return parseFloat(String(item.qty ?? item.quantity ?? 0)) || 0;
}

function isVatPurchaseLine(taxType: string) {
  return taxType === 'VAT' || taxType === 'VATable' || taxType === 'LGU' || taxType === 'LGU 5% Final VAT';
}

export function normalizePurchaseCostBasis(value: string | null | undefined): PurchaseCostBasis {
  if (value === 'VAT Exclusive') return 'VAT Exclusive';
  return 'VAT Inclusive';
}

export const normalizePurchaseVatMode = normalizePurchaseCostBasis;

export function calculatePurchaseLine(item: PurchaseLineInput, costBasis: PurchaseCostBasis = 'VAT Inclusive') {
  const qty = lineQty(item);
  const unitCost = parseFloat(String(item.unit_cost)) || 0;
  const disc = parseFloat(String(item.discount_amount ?? 0)) || 0;
  const taxType = item.tax_type || 'VAT';
  const lineGross = qty * unitCost;
  const lineNet = Math.max(0, lineGross - disc);

  let vatable = 0;
  let vat = 0;
  let vatExempt = 0;
  let zeroRated = 0;
  let lineTotal = lineNet;

  if (taxType === 'VAT Exempt') {
    vatExempt = lineNet;
  } else if (taxType === 'Zero Rated') {
    zeroRated = lineNet;
  } else if (isVatPurchaseLine(taxType)) {
    if (costBasis === 'VAT Inclusive') {
      vatable = lineNet / 1.12;
      vat = lineNet - vatable;
    } else {
      vatable = lineNet;
      vat = lineNet * 0.12;
      lineTotal = lineNet + vat;
    }
  }

  return {
    gross: lineGross,
    discount: disc,
    net: lineNet,
    vatable: round2(vatable),
    vat_amount: round2(vat),
    vatExempt: round2(vatExempt),
    zeroRated: round2(zeroRated),
    lineTotal: round2(lineTotal),
  };
}

export function calculatePurchaseTax(items: PurchaseLineInput[], costBasis: PurchaseCostBasis = 'VAT Inclusive'): PurchaseTaxTotals {
  let gross = 0;
  let discount = 0;
  let net = 0;
  let vatable = 0;
  let vat = 0;
  let vatExempt = 0;
  let zeroRated = 0;
  let total = 0;

  for (const item of items || []) {
    const line = calculatePurchaseLine(item, costBasis);
    gross += line.gross;
    discount += line.discount;
    net += line.net;
    vatable += line.vatable;
    vat += line.vat_amount;
    vatExempt += line.vatExempt;
    zeroRated += line.zeroRated;
    total += line.lineTotal;
  }

  return {
    gross: round2(gross),
    discount: round2(discount),
    net: round2(net),
    vatable: round2(vatable),
    vat: round2(vat),
    vatExempt: round2(vatExempt),
    zeroRated: round2(zeroRated),
    total: round2(total),
  };
}

/** Inventory / purchases debit (excludes input VAT) — matches goods receipt posting. */
export function purchaseInventoryDebitAmount(total: number, vat: number): number {
  return round2(Math.max(0, (parseFloat(String(total)) || 0) - (parseFloat(String(vat)) || 0)));
}

export function buildPurchaseOrderItemsFromRequest(rawItems: any[], costBasis: PurchaseCostBasis) {
  let subtotal = 0;
  let totalLineDiscount = 0;
  const taxInputs: PurchaseLineInput[] = [];

  const orderItems = (rawItems || []).map((item: any) => {
    const qty = parseFloat(item.quantity) || 0;
    const unitCost = parseFloat(item.unit_cost) || 0;
    const gross = qty * unitCost;
    const discType = item.discount_type || '%';
    const discVal = parseFloat(item.discount_value || '0');
    let discAmt = 0;
    if (discType === '%') discAmt = gross * (discVal / 100);
    else discAmt = discVal;
    if (discAmt > gross) discAmt = gross;
    const netLineTotal = gross - discAmt;
    const netUnitCost = qty > 0 ? netLineTotal / qty : unitCost;
    const taxType = item.tax_type || 'VAT';

    subtotal += gross;
    totalLineDiscount += discAmt;
    taxInputs.push({
      qty,
      unit_cost: unitCost,
      discount_amount: discAmt,
      tax_type: taxType,
    });

    return {
      product_id: item.product_id,
      location_id: item.location_id,
      quantity: qty,
      unit_cost: unitCost,
      discount_type: discType,
      discount_value: discVal,
      discount_amount: round2(discAmt),
      net_unit_cost: round2(netUnitCost),
      net_total: round2(netLineTotal),
      tax_type: taxType,
    };
  });

  const totals = calculatePurchaseTax(taxInputs, costBasis);

  return {
    orderItems,
    subtotal: round2(subtotal),
    totalLineDiscount: round2(totalLineDiscount),
    totals,
  };
}

export function calculateGrLineAccounting(
  lineAmount: number,
  taxType: string,
  costBasis: PurchaseCostBasis
) {
  const line = calculatePurchaseLine(
    { qty: 1, unit_cost: lineAmount, discount_amount: 0, tax_type: taxType || 'VAT' },
    costBasis
  );
  const inventoryDebit = line.vatable + line.vatExempt + line.zeroRated;
  return {
    inventoryDebit: round2(inventoryDebit),
    inputVat: line.vat_amount,
    apCredit: line.lineTotal,
  };
}
