export type PriceTier = 'Retail' | 'Wholesale' | 'Distributor';

export function normalizeUomCode(code?: string | null): string {
  return String(code || '').trim().toLowerCase();
}

export function isBaseUomCode(code?: string | null): boolean {
  const c = normalizeUomCode(code);
  return !c || c === 'pc' || c === 'pcs' || c === 'piece' || c === 'pieces';
}

export function findBaseUomFromCatalog(catalog: { id: number; code?: string | null }[]) {
  return catalog.find((u) => isBaseUomCode(u.code)) || catalog[0];
}

/** Index of the single base UOM row (= base qty 1). */
export function findProductBaseRowIndex(
  rows: { uom_id?: number | string; conversion_to_base?: number | string }[],
  baseUomId?: number | string | null,
): number {
  if (!rows.length) return -1;
  if (baseUomId != null && String(baseUomId) !== '') {
    const byId = rows.findIndex((r) => Number(r.uom_id) === Number(baseUomId));
    if (byId >= 0) return byId;
  }
  const byConv = rows.findIndex((r) => parseFloat(String(r.conversion_to_base)) === 1);
  return byConv >= 0 ? byConv : 0;
}

export function getProductBaseUomId(
  rows: { uom_id?: number | string; conversion_to_base?: number | string }[],
  baseUomId?: number | string | null,
): number | null {
  const idx = findProductBaseRowIndex(rows, baseUomId);
  if (idx < 0) return null;
  const id = Number(rows[idx]?.uom_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Keep one base row (=1); drop duplicate base rows (e.g. PC + KG both at 1). */
export function normalizeProductUomRows<T extends { uom_id?: number | string; conversion_to_base?: number | string; uom_code?: string }>(
  rows: T[],
  baseUomId?: number | string | null,
): T[] {
  if (!rows.length) return rows;
  const baseIdx = findProductBaseRowIndex(rows, baseUomId);
  const baseId = Number(rows[baseIdx]?.uom_id);
  return rows
    .filter((r, i) => {
      const conv = parseFloat(String(r.conversion_to_base)) || 1;
      if (conv === 1 && Number(r.uom_id) !== baseId) return false;
      if (i !== baseIdx && Number(r.uom_id) === baseId) return false;
      return true;
    })
    .map((r) => {
      if (Number(r.uom_id) === baseId) {
        return { ...r, conversion_to_base: 1 };
      }
      const conv = parseFloat(String(r.conversion_to_base)) || 1;
      return { ...r, conversion_to_base: conv <= 1 ? 12 : conv };
    });
}

export function isProductBaseRow(
  row: { uom_id?: number | string; conversion_to_base?: number | string },
  rows: { uom_id?: number | string; conversion_to_base?: number | string }[],
  baseUomId?: number | string | null,
): boolean {
  const idx = rows.indexOf(row);
  const baseIdx = findProductBaseRowIndex(rows, baseUomId);
  if (baseIdx >= 0) return idx === baseIdx;
  return parseFloat(String(row.conversion_to_base)) === 1;
}

/** UOMs shown on POS/search — hides orphan PC when base is KG, etc. */
export function sellableProductUoms(
  uoms: any[],
  baseUomId?: number | string | null,
): any[] {
  if (!uoms.length) return uoms;
  const baseId = getProductBaseUomId(uoms, baseUomId);
  return uoms.filter((u) => {
    const conv = parseFloat(String(u.conversion_to_base)) || 1;
    if (conv === 1) {
      return baseId ? Number(u.uom_id) === baseId : true;
    }
    return conv > 1;
  });
}

export interface UomConversionFormRow {
  uom_id: number;
  uom_code?: string;
  conversion_to_base: number;
  barcode?: string;
  purchase_price?: number;
  retail_price?: number;
  wholesale_price?: number;
  distributor_price?: number;
  is_default_purchase?: boolean;
  is_default_sales?: boolean;
}

export function convertToBaseQty(qty: number, conversionToBase: number): number {
  const q = parseFloat(String(qty)) || 0;
  const factor = parseFloat(String(conversionToBase)) || 1;
  return Math.round(q * factor * 10000) / 10000;
}

export function getUomPrice(
  uom: { retail_price?: number; wholesale_price?: number; distributor_price?: number },
  priceTier: PriceTier | string,
): number {
  const tier = String(priceTier || 'Retail');
  if (tier === 'Wholesale') return parseFloat(String(uom.wholesale_price)) || 0;
  if (tier === 'Distributor') return parseFloat(String(uom.distributor_price)) || 0;
  return parseFloat(String(uom.retail_price)) || 0;
}

export function getEquivalentUomDisplay(
  baseQty: number,
  conversions: { uom_code: string; conversion_to_base: number }[],
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

export function resolvePurchaseUom(
  uoms: any[],
  uomId?: number | null,
  defaultPurchaseUomId?: number | null,
) {
  if (uomId != null && String(uomId) !== '') {
    const id = Number(uomId);
    const found = uoms.find((u) => Number(u.uom_id) === id);
    if (found) return found;
  }
  return uoms.find((u) => u.is_default_purchase)
    || uoms.find((u) => Number(u.uom_id) === Number(defaultPurchaseUomId))
    || uoms.find((u) => parseFloat(String(u.conversion_to_base)) === 1)
    || uoms[0];
}

/** Match PO line to product UOM when receiving — avoids defaulting to PC when PO was ordered in BOX. */
export function resolveReceiveUomFromPoLine(
  uoms: any[],
  poLine: {
    uom_id?: number | string | null;
    conversion_to_base?: number | string | null;
    unit_cost?: number | string | null;
    net_unit_cost?: number | string | null;
    unit_of_measure?: string | null;
  },
) {
  if (!uoms.length) return null;

  if (poLine.uom_id != null && String(poLine.uom_id) !== '') {
    const byId = uoms.find((u) => Number(u.uom_id) === Number(poLine.uom_id));
    if (byId) return byId;
  }

  const uomCode = String(poLine.unit_of_measure || '').trim().toLowerCase();
  if (uomCode && !isBaseUomCode(uomCode)) {
    const byCode = uoms.find((u) => normalizeUomCode(u.uom_code) === uomCode);
    if (byCode) return byCode;
  }

  const conv = parseFloat(String(poLine.conversion_to_base)) || 0;
  if (conv > 1) {
    const byConv = uoms.find((u) => parseFloat(String(u.conversion_to_base)) === conv);
    if (byConv) return byConv;
  }

  const poCost = parseFloat(String(poLine.net_unit_cost ?? poLine.unit_cost)) || 0;
  if (poCost > 0) {
    const alternates = uoms.filter((u) => (parseFloat(String(u.conversion_to_base)) || 0) > 1);
    const byPrice = alternates.find((u) => {
      const pp = parseFloat(String(u.purchase_price)) || 0;
      return pp > 0 && Math.abs(pp - poCost) < 0.02;
    });
    if (byPrice) return byPrice;
  }

  return resolvePurchaseUom(uoms, null, null);
}

/** Match saved/copied purchase line to catalog UOM — keeps BOX when ordered in BOX. */
export function resolvePurchaseUomFromLine(
  uoms: any[],
  line: {
    uom_id?: number | string | null;
    conversion_to_base?: number | string | null;
    uom?: string | null;
    unit_of_measure?: string | null;
    unit_cost?: number | string | null;
    net_unit_cost?: number | string | null;
    estimated_cost?: number | string | null;
  },
  defaultPurchaseUomId?: number | null,
) {
  if (!uoms.length) return null;

  if (line.uom_id != null && String(line.uom_id) !== '') {
    const byId = uoms.find((u) => Number(u.uom_id) === Number(line.uom_id));
    if (byId) return byId;
  }

  const uomCode = String(line.uom || line.unit_of_measure || '').trim().toLowerCase();
  if (uomCode && !isBaseUomCode(uomCode)) {
    const byCode = uoms.find((u) => normalizeUomCode(u.uom_code) === uomCode);
    if (byCode) return byCode;
  }

  const conv = parseFloat(String(line.conversion_to_base)) || 0;
  if (conv > 1) {
    const byConv = uoms.find((u) => parseFloat(String(u.conversion_to_base)) === conv);
    if (byConv) return byConv;
  }

  const lineCost = parseFloat(String(line.net_unit_cost ?? line.unit_cost ?? line.estimated_cost)) || 0;
  if (lineCost > 0) {
    const byCost = uoms
      .filter((u) => (parseFloat(String(u.conversion_to_base)) || 0) > 1)
      .find((u) => {
        const pp = parseFloat(String(u.purchase_price)) || 0;
        return pp > 0 && Math.abs(pp - lineCost) < 0.02;
      });
    if (byCost) return byCost;
  }

  return resolvePurchaseUom(uoms, null, defaultPurchaseUomId);
}

export function getBaseUnitCostFromUoms(uoms: any[], fallbackCost = 0): number {
  const base = uoms.find((u) => isBaseUomCode(u.uom_code) || parseFloat(String(u.conversion_to_base)) === 1);
  const fromBase = parseFloat(String(base?.purchase_price));
  if (Number.isFinite(fromBase) && fromBase > 0) return fromBase;
  return parseFloat(String(fallbackCost)) || 0;
}

export function resolveSalesUom(
  uoms: any[],
  uomId?: number | null,
  defaultSalesUomId?: number | null,
  selectedUom?: any,
) {
  if (selectedUom) return selectedUom;
  if (uomId != null && String(uomId) !== '') {
    const id = Number(uomId);
    const found = uoms.find((u) => Number(u.uom_id) === id);
    if (found) return found;
  }
  if (defaultSalesUomId != null && String(defaultSalesUomId) !== '') {
    const found = uoms.find((u) => Number(u.uom_id) === Number(defaultSalesUomId));
    if (found) return found;
  }
  return uoms.find((u) => u.is_default_sales)
    || uoms.find((u) => parseFloat(String(u.conversion_to_base)) === 1)
    || uoms[0];
}

/** Match saved/copied line to catalog UOM — keeps BOX on the line when ordered in BOX. */
export function resolveSalesUomFromLine(
  uoms: any[],
  line: {
    uom_id?: number | string | null;
    conversion_to_base?: number | string | null;
    uom?: string | null;
    unit_of_measure?: string | null;
    unit_price?: number | string | null;
  },
  defaultSalesUomId?: number | null,
) {
  if (!uoms.length) return null;

  if (line.uom_id != null && String(line.uom_id) !== '') {
    const byId = uoms.find((u) => Number(u.uom_id) === Number(line.uom_id));
    if (byId) return byId;
  }

  const uomCode = String(line.uom || line.unit_of_measure || '').trim().toLowerCase();
  if (uomCode && !isBaseUomCode(uomCode)) {
    const byCode = uoms.find((u) => normalizeUomCode(u.uom_code) === uomCode);
    if (byCode) return byCode;
  }

  const conv = parseFloat(String(line.conversion_to_base)) || 0;
  if (conv > 1) {
    const byConv = uoms.find((u) => parseFloat(String(u.conversion_to_base)) === conv);
    if (byConv) return byConv;
  }

  const linePrice = parseFloat(String(line.unit_price)) || 0;
  if (linePrice > 0) {
    const byPrice = uoms
      .filter((u) => (parseFloat(String(u.conversion_to_base)) || 0) > 1)
      .find((u) => {
        const prices = [u.retail_price, u.wholesale_price, u.distributor_price];
        return prices.some((p) => {
          const pp = parseFloat(String(p)) || 0;
          return pp > 0 && Math.abs(pp - linePrice) < 0.02;
        });
      });
    if (byPrice) return byPrice;
  }

  return resolveSalesUom(uoms, null, defaultSalesUomId);
}

export function calculateBaseUnitCost(unitCostPerUom: number, conversionToBase: number): number {
  const factor = parseFloat(String(conversionToBase)) || 1;
  if (factor <= 0) return 0;
  return Math.round((unitCostPerUom / factor) * 10000) / 10000;
}

/** Convert a per-UOM purchase cost when the user switches line UOM (e.g. BOX 984 → PC 20.5). */
export function convertUnitCostToUom(
  unitCost: number,
  fromConversionToBase: number,
  toConversionToBase: number,
): number {
  const base = calculateBaseUnitCost(unitCost, fromConversionToBase);
  const toConv = parseFloat(String(toConversionToBase)) || 1;
  if (toConv <= 0) return base;
  return Math.round(base * toConv * 10000) / 10000;
}
