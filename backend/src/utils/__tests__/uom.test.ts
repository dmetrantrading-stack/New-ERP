import { describe, it, expect } from 'vitest';
import {
  convertToBaseQty,
  calculateBaseUnitCost,
  getUomPrice,
  getEquivalentUomDisplay,
  lineItemBaseQty,
  lineItemCogsGross,
  purchaseQtyFromPiecesNeeded,
  resolveLineUom,
  resolveReceiveLineUomFromPo,
  resolveSalesLineUom,
  resolveSalesLineUomFromRaw,
  type ProductUomRow,
} from '../uom';

const baseRow = (overrides: Partial<ProductUomRow> = {}): ProductUomRow => ({
  id: '1',
  product_id: 'p1',
  uom_id: 1,
  uom_code: 'pc',
  uom_name: 'Piece',
  conversion_to_base: 1,
  purchase_price: 10,
  retail_price: 20,
  wholesale_price: 15,
  distributor_price: 12,
  is_default_purchase: true,
  is_default_sales: true,
  is_active: true,
  ...overrides,
});

describe('convertToBaseQty', () => {
  it('multiplies qty by conversion factor', () => {
    expect(convertToBaseQty(10, 12)).toBe(120);
    expect(convertToBaseQty(2.5, 4)).toBe(10);
  });

  it('defaults invalid values to safe numbers', () => {
    expect(convertToBaseQty(NaN, 12)).toBe(0);
    expect(convertToBaseQty(5, 0)).toBe(5);
  });
});

describe('calculateBaseUnitCost', () => {
  it('divides per-UOM cost by conversion factor', () => {
    expect(calculateBaseUnitCost(120, 1, 12)).toBe(10);
  });

  it('computes per-base cost from total line cost', () => {
    expect(calculateBaseUnitCost(1200, 10, 12, { totalCost: true })).toBe(10);
  });
});

describe('getUomPrice', () => {
  const uom = { retail_price: 20, wholesale_price: 15, distributor_price: 12 };
  it('returns tier-specific prices', () => {
    expect(getUomPrice(uom, 'Retail')).toBe(20);
    expect(getUomPrice(uom, 'Wholesale')).toBe(15);
    expect(getUomPrice(uom, 'Distributor')).toBe(12);
  });
});

describe('getEquivalentUomDisplay', () => {
  it('shows base only when no alternates', () => {
    expect(getEquivalentUomDisplay(50, [{ uom_code: 'pc', conversion_to_base: 1 }])).toBe('50 PC');
  });

  it('shows box breakdown with remainder', () => {
    expect(
      getEquivalentUomDisplay(26, [
        { uom_code: 'pc', conversion_to_base: 1 },
        { uom_code: 'box', conversion_to_base: 12 },
      ]),
    ).toBe('26 PC (2 BOX + 2 PC)');
  });
});

describe('resolveLineUom', () => {
  const rows = [
    baseRow({ uom_id: 1, uom_code: 'pc', conversion_to_base: 1 }),
    baseRow({ uom_id: 2, uom_code: 'box', conversion_to_base: 12, is_default_purchase: false, is_default_sales: false }),
  ];

  it('resolves by explicit uom_id', () => {
    const found = resolveLineUom(rows, 2);
    expect(found?.uom_code).toBe('box');
  });

  it('falls back to default purchase UOM', () => {
    const found = resolveLineUom(rows, null);
    expect(found?.uom_code).toBe('pc');
  });
});

describe('resolveReceiveLineUomFromPo', () => {
  const rows = [
    baseRow({ uom_id: 1, uom_code: 'pc', conversion_to_base: 1, purchase_price: 115.2 }),
    baseRow({ uom_id: 2, uom_code: 'box', conversion_to_base: 24, is_default_purchase: false, purchase_price: 2764.8 }),
  ];

  it('matches PO line by unit cost when uom_id missing', () => {
    const found = resolveReceiveLineUomFromPo(rows, null, {
      unit_cost: 2764.8,
      net_unit_cost: 2764.8,
      conversion_to_base: 1,
    });
    expect(found?.uom_code).toBe('box');
  });
});

describe('resolveSalesLineUom', () => {
  const rows = [
    baseRow({ uom_id: 1, uom_code: 'pc', conversion_to_base: 1, is_default_sales: false }),
    baseRow({ uom_id: 2, uom_code: 'box', conversion_to_base: 12, is_default_purchase: false, is_default_sales: true }),
  ];

  it('prefers default sales UOM', () => {
    expect(resolveSalesLineUom(rows, null)?.uom_code).toBe('box');
  });
});

describe('resolveSalesLineUomFromRaw', () => {
  const coffemateRows = [
    baseRow({ uom_id: 1, uom_code: 'pc', conversion_to_base: 1, retail_price: 120.96, wholesale_price: 115, distributor_price: 110 }),
    baseRow({ uom_id: 2, uom_code: 'box', conversion_to_base: 24, retail_price: 2903.04, wholesale_price: 2764.8, distributor_price: 2700 }),
  ];

  it('infers BOX from base_qty when uom_id missing', () => {
    expect(resolveSalesLineUomFromRaw(coffemateRows, { quantity: 1, base_qty: 24 })?.uom_code).toBe('box');
  });

  it('infers BOX from BOX unit price when uom_id missing', () => {
    expect(resolveSalesLineUomFromRaw(coffemateRows, { quantity: 1, unit_price: 2903.04 })?.uom_code).toBe('box');
  });

  it('infers BOX from price ratio vs PC when only line price is known', () => {
    expect(resolveSalesLineUomFromRaw(coffemateRows, { quantity: 1, unit_price: 2900 })?.uom_code).toBe('box');
  });
});

describe('lineItemBaseQty', () => {
  it('uses stored base_qty when present', () => {
    expect(lineItemBaseQty({ base_qty: 24, quantity: 2, conversion_to_base: 12 })).toBe(24);
  });

  it('derives from entered qty and conversion', () => {
    expect(lineItemBaseQty({ quantity: 2, conversion_to_base: 12 })).toBe(24);
  });
});

describe('lineItemCogsGross', () => {
  it('multiplies base qty by per-piece cost', () => {
    expect(lineItemCogsGross({ quantity: 1, conversion_to_base: 12, cost: 43 })).toBe(516);
  });
});

describe('purchaseQtyFromPiecesNeeded', () => {
  const boxUom = baseRow({ uom_id: 2, uom_code: 'box', conversion_to_base: 24, purchase_price: 2903 });

  it('keeps piece qty when UOM is base', () => {
    const pc = baseRow({ uom_id: 1, uom_code: 'pc', conversion_to_base: 1 });
    expect(purchaseQtyFromPiecesNeeded(50, pc)).toEqual({
      enteredQty: 50,
      conversion_to_base: 1,
      base_qty: 50,
      uom_id: 1,
      uom_code: 'pc',
    });
  });

  it('rounds up to whole BOX for piece shortage', () => {
    expect(purchaseQtyFromPiecesNeeded(50, boxUom)).toEqual({
      enteredQty: 3,
      conversion_to_base: 24,
      base_qty: 72,
      uom_id: 2,
      uom_code: 'box',
    });
  });
});
