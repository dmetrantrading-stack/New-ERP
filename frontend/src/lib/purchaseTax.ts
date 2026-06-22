export type PurchaseCostBasis = 'VAT Inclusive' | 'VAT Exclusive';

/** @deprecated Use PurchaseCostBasis */
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

const PURCHASE_TAX_TYPE_VALUES = new Set(PURCHASE_TAX_TYPE_OPTIONS.map((o) => o.value));

/** Default line tax from product master (same values as ProductList tax type). */
export function lineTaxTypeFromProduct(product: { tax_type?: string | null } | null | undefined): string {
  const raw = product?.tax_type?.trim();
  if (!raw || raw === 'VAT' || raw === 'VATable') return 'VAT';
  if (PURCHASE_TAX_TYPE_VALUES.has(raw as typeof PURCHASE_TAX_TYPE_OPTIONS[number]['value'])) return raw;
  return 'VAT';
}

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
