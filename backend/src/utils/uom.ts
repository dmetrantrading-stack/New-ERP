export type PriceTier = 'Retail' | 'Wholesale' | 'Distributor';

export interface ProductUomRow {
  id: string;
  product_id: string;
  uom_id: number;
  uom_code: string;
  uom_name: string;
  conversion_to_base: number;
  barcode?: string | null;
  purchase_price: number;
  retail_price: number;
  wholesale_price: number;
  distributor_price: number;
  is_default_purchase: boolean;
  is_default_sales: boolean;
  is_active: boolean;
}

export function convertToBaseQty(qty: number, conversionToBase: number): number {
  const q = parseFloat(String(qty)) || 0;
  const factor = parseFloat(String(conversionToBase)) || 1;
  return Math.round(q * factor * 10000) / 10000;
}

export function calculateBaseUnitCost(
  totalCostOrUnitCost: number,
  qty: number,
  conversionToBase: number,
  opts?: { totalCost?: boolean },
): number {
  const factor = parseFloat(String(conversionToBase)) || 1;
  if (factor <= 0) return 0;
  if (opts?.totalCost) {
    const baseQty = convertToBaseQty(qty, factor);
    if (baseQty <= 0) return 0;
    return Math.round((totalCostOrUnitCost / baseQty) * 10000) / 10000;
  }
  return Math.round((totalCostOrUnitCost / factor) * 10000) / 10000;
}

export function getUomPrice(
  uom: Pick<ProductUomRow, 'retail_price' | 'wholesale_price' | 'distributor_price'>,
  priceTier: PriceTier | string,
): number {
  const tier = String(priceTier || 'Retail');
  if (tier === 'Wholesale') return parseFloat(String(uom.wholesale_price)) || 0;
  if (tier === 'Distributor') return parseFloat(String(uom.distributor_price)) || 0;
  return parseFloat(String(uom.retail_price)) || 0;
}

export interface EquivalentUomInput {
  uom_code: string;
  conversion_to_base: number;
}

export function getEquivalentUomDisplay(
  baseQty: number,
  conversions: EquivalentUomInput[],
  baseUomCode = 'pc',
): string {
  const base = Math.floor(parseFloat(String(baseQty)) || 0);
  const baseCode = (baseUomCode || 'pc').toUpperCase();
  const alternates = conversions
    .filter((c) => (parseFloat(String(c.conversion_to_base)) || 0) > 1)
    .sort((a, b) => (parseFloat(String(b.conversion_to_base)) || 0) - (parseFloat(String(a.conversion_to_base)) || 0));

  if (alternates.length === 0) return `${base} ${baseCode}`;

  const primary = alternates[0];
  const factor = Math.floor(parseFloat(String(primary.conversion_to_base)) || 1);
  if (factor <= 1) return `${base} ${baseCode}`;

  const whole = Math.floor(base / factor);
  const remainder = base % factor;
  const altCode = (primary.uom_code || '').toUpperCase();

  if (whole > 0 && remainder > 0) return `${base} ${baseCode} (${whole} ${altCode} + ${remainder} ${baseCode})`;
  if (whole > 0) return `${base} ${baseCode} (${whole} ${altCode})`;
  return `${base} ${baseCode}`;
}

export function formatInsufficientStockMessage(availableBase: number, requiredBase: number, baseUomCode = 'pc'): string {
  const avail = Math.round((parseFloat(String(availableBase)) || 0) * 100) / 100;
  const req = Math.round((parseFloat(String(requiredBase)) || 0) * 100) / 100;
  return `Insufficient stock. Available: ${avail} ${baseUomCode.toUpperCase()}, required: ${req} ${baseUomCode.toUpperCase()}.`;
}

export function resolveLineUom(
  uomRows: ProductUomRow[],
  uomId?: number | null,
  defaultUomId?: number | null,
): ProductUomRow | null {
  if (!uomRows.length) return null;
  if (uomId) {
    const found = uomRows.find((r) => r.uom_id === Number(uomId));
    if (found) return found;
  }
  const defPurchase = uomRows.find((r) => r.is_default_purchase);
  if (defPurchase) return defPurchase;
  if (defaultUomId) {
    const found = uomRows.find((r) => r.uom_id === Number(defaultUomId));
    if (found) return found;
  }
  return uomRows.find((r) => r.conversion_to_base === 1) || uomRows[0];
}

export function resolveReceiveLineUomFromPo(
  uomRows: ProductUomRow[],
  itemUomId?: number | null,
  poItem?: {
    uom_id?: number | null;
    conversion_to_base?: number | null;
    unit_cost?: number | null;
    net_unit_cost?: number | null;
  } | null,
  defaultUomId?: number | null,
): ProductUomRow | null {
  if (!uomRows.length) return null;

  const poUomId = poItem?.uom_id ?? itemUomId;
  if (poUomId != null) {
    const found = uomRows.find((r) => r.uom_id === Number(poUomId));
    if (found) return found;
  }

  const conv = parseFloat(String(poItem?.conversion_to_base)) || 0;
  if (conv > 1) {
    const byConv = uomRows.find((r) => parseFloat(String(r.conversion_to_base)) === conv);
    if (byConv) return byConv;
  }

  const poCost = parseFloat(String(poItem?.net_unit_cost ?? poItem?.unit_cost)) || 0;
  if (poCost > 0) {
    const byPrice = uomRows
      .filter((r) => (parseFloat(String(r.conversion_to_base)) || 0) > 1)
      .find((r) => {
        const pp = parseFloat(String(r.purchase_price)) || 0;
        return pp > 0 && Math.abs(pp - poCost) < 0.02;
      });
    if (byPrice) return byPrice;
  }

  return resolveLineUom(uomRows, itemUomId, defaultUomId);
}

export function resolveSalesLineUom(
  uomRows: ProductUomRow[],
  uomId?: number | null,
  defaultUomId?: number | null,
): ProductUomRow | null {
  if (!uomRows.length) return null;
  if (uomId != null) {
    const found = uomRows.find((r) => r.uom_id === Number(uomId));
    if (found) return found;
  }
  if (defaultUomId != null) {
    const found = uomRows.find((r) => r.uom_id === Number(defaultUomId));
    if (found) return found;
  }
  const defSales = uomRows.find((r) => r.is_default_sales);
  if (defSales) return defSales;
  return uomRows.find((r) => r.conversion_to_base === 1) || uomRows[0];
}

export function resolveSalesLineUomFromRaw(
  uomRows: ProductUomRow[],
  raw: {
    uom_id?: number | null;
    conversion_to_base?: number | string | null;
    entered_qty?: number | string | null;
    quantity?: number | string | null;
    base_qty?: number | string | null;
    uom?: string | null;
    unit_of_measure?: string | null;
    unit_price?: number | string | null;
  },
  defaultUomId?: number | null,
): ProductUomRow | null {
  if (!uomRows.length) return null;
  if (raw.uom_id != null) {
    const found = uomRows.find((r) => r.uom_id === Number(raw.uom_id));
    if (found) return found;
  }
  const code = String(raw.uom || raw.unit_of_measure || '').trim().toLowerCase();
  if (code && code !== 'pc' && code !== 'pcs' && code !== 'piece' && code !== 'pieces') {
    const byCode = uomRows.find((r) => String(r.uom_code || '').trim().toLowerCase() === code);
    if (byCode) return byCode;
  }
  const entered = parseFloat(String(raw.entered_qty ?? raw.quantity)) || 0;
  const storedBase = parseFloat(String(raw.base_qty)) || 0;
  if (entered > 0 && storedBase > 0) {
    const inferredConv = Math.round((storedBase / entered) * 10000) / 10000;
    if (inferredConv > 1) {
      const byInferred = uomRows.find((r) => Math.abs(parseFloat(String(r.conversion_to_base)) - inferredConv) < 0.0001);
      if (byInferred) return byInferred;
    }
  }
  const conv = parseFloat(String(raw.conversion_to_base)) || 0;
  if (conv > 1) {
    const byConv = uomRows.find((r) => parseFloat(String(r.conversion_to_base)) === conv);
    if (byConv) return byConv;
  }
  const linePrice = parseFloat(String(raw.unit_price)) || 0;
  if (linePrice > 0) {
    const byPrice = matchSalesUomByLinePrice(uomRows, linePrice);
    if (byPrice) return byPrice;
  }
  return resolveSalesLineUom(uomRows, null, defaultUomId);
}

function matchSalesUomByLinePrice(uomRows: ProductUomRow[], linePrice: number): ProductUomRow | null {
  const alternates = uomRows.filter((r) => (parseFloat(String(r.conversion_to_base)) || 0) > 1);
  const tolerance = Math.max(1, linePrice * 0.03);

  for (const alt of alternates) {
    const tierPrices = [alt.retail_price, alt.wholesale_price, alt.distributor_price];
    if (tierPrices.some((p) => {
      const pp = parseFloat(String(p)) || 0;
      return pp > 0 && Math.abs(pp - linePrice) <= tolerance;
    })) {
      return alt;
    }
  }

  const baseRow = uomRows.find((r) => parseFloat(String(r.conversion_to_base)) === 1) || uomRows[0];
  const basePrices = [baseRow.retail_price, baseRow.wholesale_price, baseRow.distributor_price]
    .map((p) => parseFloat(String(p)) || 0)
    .filter((p) => p > 0);
  if (!basePrices.length) return null;

  for (const basePrice of basePrices) {
    if (linePrice <= basePrice * 1.25) continue;
    const impliedConv = Math.round((linePrice / basePrice) * 100) / 100;
    const byRatio = alternates.find((r) => Math.abs(parseFloat(String(r.conversion_to_base)) - impliedConv) < 0.75);
    if (byRatio) return byRatio;
  }
  return null;
}

export function lineItemBaseQty(item: {
  base_qty?: number | string | null;
  quantity?: number | string | null;
  entered_qty?: number | string | null;
  conversion_to_base?: number | string | null;
}): number {
  if (item.base_qty != null && item.base_qty !== '') {
    return parseFloat(String(item.base_qty)) || 0;
  }
  const entered = parseFloat(String(item.entered_qty ?? item.quantity)) || 0;
  const conv = parseFloat(String(item.conversion_to_base)) || 1;
  return convertToBaseQty(entered, conv);
}

export interface SalesDocLineUomFields {
  enteredQty: number;
  uom_id: number | null;
  conversion_to_base: number;
  base_qty: number;
  uom_code?: string;
}

export async function resolveSalesDocLineUomFields(
  db: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  productId: string,
  raw: Record<string, any>,
  qtyFallback: number,
  loadUoms: (db: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }, id: string) => Promise<ProductUomRow[]>,
): Promise<SalesDocLineUomFields> {
  const prod = await db.query('SELECT default_sales_uom_id FROM products WHERE id = $1', [productId]);
  const uomRows = await loadUoms(db, productId);
  const uom = resolveSalesLineUomFromRaw(
    uomRows,
    {
      uom_id: raw.uom_id,
      conversion_to_base: raw.conversion_to_base,
      entered_qty: raw.entered_qty,
      quantity: raw.quantity,
      base_qty: raw.base_qty,
      uom: raw.uom ?? raw.uom_code,
      unit_of_measure: raw.unit_of_measure,
      unit_price: raw.unit_price,
    },
    prod.rows[0]?.default_sales_uom_id,
  );
  const enteredQty = parseFloat(String(raw.entered_qty ?? raw.quantity ?? qtyFallback)) || 0;
  const conversionToBase = parseFloat(String(uom?.conversion_to_base ?? raw.conversion_to_base)) || 1;
  const baseQty = raw.base_qty != null
    ? parseFloat(String(raw.base_qty)) || 0
    : convertToBaseQty(enteredQty, conversionToBase);
  return {
    enteredQty,
    uom_id: uom?.uom_id ?? (raw.uom_id != null ? Number(raw.uom_id) : null),
    conversion_to_base: conversionToBase,
    base_qty: baseQty,
    uom_code: uom?.uom_code,
  };
}

export function resolvePurchaseLineUomFromRaw(
  uomRows: ProductUomRow[],
  raw: {
    uom_id?: number | null;
    conversion_to_base?: number | string | null;
    entered_qty?: number | string | null;
    quantity?: number | string | null;
    base_qty?: number | string | null;
    uom?: string | null;
    unit_of_measure?: string | null;
    unit_cost?: number | string | null;
    net_unit_cost?: number | string | null;
    estimated_cost?: number | string | null;
  },
  defaultUomId?: number | null,
): ProductUomRow | null {
  if (!uomRows.length) return null;
  if (raw.uom_id != null) {
    const found = uomRows.find((r) => r.uom_id === Number(raw.uom_id));
    if (found) return found;
  }
  const code = String(raw.uom || raw.unit_of_measure || '').trim().toLowerCase();
  if (code && code !== 'pc' && code !== 'pcs' && code !== 'piece' && code !== 'pieces') {
    const byCode = uomRows.find((r) => String(r.uom_code || '').trim().toLowerCase() === code);
    if (byCode) return byCode;
  }
  const entered = parseFloat(String(raw.entered_qty ?? raw.quantity)) || 0;
  const storedBase = parseFloat(String(raw.base_qty)) || 0;
  if (entered > 0 && storedBase > 0) {
    const inferredConv = Math.round((storedBase / entered) * 10000) / 10000;
    if (inferredConv > 1) {
      const byInferred = uomRows.find((r) => Math.abs(parseFloat(String(r.conversion_to_base)) - inferredConv) < 0.0001);
      if (byInferred) return byInferred;
    }
  }
  const conv = parseFloat(String(raw.conversion_to_base)) || 0;
  if (conv > 1) {
    const byConv = uomRows.find((r) => parseFloat(String(r.conversion_to_base)) === conv);
    if (byConv) return byConv;
  }
  const lineCost = parseFloat(String(raw.net_unit_cost ?? raw.unit_cost ?? raw.estimated_cost)) || 0;
  if (lineCost > 0) {
    const byCost = matchPurchaseUomByLineCost(uomRows, lineCost);
    if (byCost) return byCost;
  }
  return resolveLineUom(uomRows, null, defaultUomId);
}

function matchPurchaseUomByLineCost(uomRows: ProductUomRow[], lineCost: number): ProductUomRow | null {
  const alternates = uomRows.filter((r) => (parseFloat(String(r.conversion_to_base)) || 0) > 1);
  const tolerance = Math.max(1, lineCost * 0.03);

  for (const alt of alternates) {
    const pp = parseFloat(String(alt.purchase_price)) || 0;
    if (pp > 0 && Math.abs(pp - lineCost) <= tolerance) return alt;
  }

  const baseRow = uomRows.find((r) => parseFloat(String(r.conversion_to_base)) === 1) || uomRows[0];
  const baseCost = parseFloat(String(baseRow.purchase_price)) || 0;
  if (baseCost <= 0) return null;

  if (lineCost > baseCost * 1.25) {
    const impliedConv = Math.round((lineCost / baseCost) * 100) / 100;
    const byRatio = alternates.find((r) => Math.abs(parseFloat(String(r.conversion_to_base)) - impliedConv) < 0.75);
    if (byRatio) return byRatio;
  }
  return null;
}

export interface PurchaseDocLineUomFields {
  enteredQty: number;
  uom_id: number | null;
  conversion_to_base: number;
  base_qty: number;
  uom_code?: string;
}

export async function resolvePurchaseDocLineUomFields(
  db: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  productId: string,
  raw: Record<string, any>,
  qtyFallback: number,
  loadUoms: (db: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }, id: string) => Promise<ProductUomRow[]>,
): Promise<PurchaseDocLineUomFields> {
  const prod = await db.query('SELECT default_purchase_uom_id FROM products WHERE id = $1', [productId]);
  const uomRows = await loadUoms(db, productId);
  const uom = resolvePurchaseLineUomFromRaw(
    uomRows,
    {
      uom_id: raw.uom_id,
      conversion_to_base: raw.conversion_to_base,
      entered_qty: raw.entered_qty,
      quantity: raw.quantity,
      base_qty: raw.base_qty,
      uom: raw.uom ?? raw.uom_code,
      unit_of_measure: raw.unit_of_measure,
      unit_cost: raw.unit_cost,
      net_unit_cost: raw.net_unit_cost,
      estimated_cost: raw.estimated_cost,
    },
    prod.rows[0]?.default_purchase_uom_id,
  );
  const enteredQty = parseFloat(String(raw.entered_qty ?? raw.quantity ?? qtyFallback)) || 0;
  const conversionToBase = parseFloat(String(uom?.conversion_to_base ?? raw.conversion_to_base)) || 1;
  const baseQty = convertToBaseQty(enteredQty, conversionToBase);
  return {
    enteredQty,
    uom_id: uom?.uom_id ?? (raw.uom_id != null ? Number(raw.uom_id) : null),
    conversion_to_base: conversionToBase,
    base_qty: baseQty,
    uom_code: uom?.uom_code,
  };
}

/** Convert a piece shortage (inventory is always in base) into purchase line qty/UOM. */
export function purchaseQtyFromPiecesNeeded(
  piecesNeeded: number,
  uom: ProductUomRow | null,
): { enteredQty: number; conversion_to_base: number; base_qty: number; uom_id: number | null; uom_code?: string } {
  const conv = parseFloat(String(uom?.conversion_to_base)) || 1;
  const pieces = Math.ceil(Math.max(piecesNeeded, 0));
  if (pieces <= 0) {
    return { enteredQty: 0, conversion_to_base: conv, base_qty: 0, uom_id: uom?.uom_id ?? null, uom_code: uom?.uom_code };
  }
  if (conv <= 1) {
    return { enteredQty: pieces, conversion_to_base: 1, base_qty: pieces, uom_id: uom?.uom_id ?? null, uom_code: uom?.uom_code };
  }
  const enteredQty = Math.ceil(pieces / conv);
  return {
    enteredQty,
    conversion_to_base: conv,
    base_qty: convertToBaseQty(enteredQty, conv),
    uom_id: uom?.uom_id ?? null,
    uom_code: uom?.uom_code,
  };
}

export async function resolvePurchaseRequestItems(
  db: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  rawItems: any[],
  loadUoms: (db: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }, id: string) => Promise<ProductUomRow[]>,
): Promise<any[]> {
  return Promise.all((rawItems || []).map(async (item) => {
    if (!item?.product_id) return item;
    const qty = parseFloat(String(item.entered_qty ?? item.quantity)) || 0;
    const uomFields = await resolvePurchaseDocLineUomFields(db, item.product_id, item, qty, loadUoms);
    return {
      ...item,
      quantity: uomFields.enteredQty,
      entered_qty: uomFields.enteredQty,
      uom_id: uomFields.uom_id,
      conversion_to_base: uomFields.conversion_to_base,
      base_qty: uomFields.base_qty,
    };
  }));
}

export function lineItemCogsGross(item: {
  base_qty?: number | string | null;
  quantity?: number | string | null;
  entered_qty?: number | string | null;
  conversion_to_base?: number | string | null;
  cost?: number | string | null;
}): number {
  const baseQty = lineItemBaseQty(item);
  const cost = parseFloat(String(item.cost)) || 0;
  return Math.round(baseQty * cost * 100) / 100;
}
