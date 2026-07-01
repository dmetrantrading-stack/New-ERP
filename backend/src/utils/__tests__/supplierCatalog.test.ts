import { describe, expect, it } from 'vitest';
import {
  resolveCatalogPurchaseUom,
  resolveCatalogUnitCost,
  enrichCatalogRow,
} from '../supplierCatalog';
import type { ProductUomRow } from '../uom';

const baseRow = (overrides: Partial<ProductUomRow> = {}): ProductUomRow => ({
  id: '1',
  product_id: 'p1',
  uom_id: 1,
  uom_code: 'pc',
  uom_name: 'Piece',
  conversion_to_base: 1,
  purchase_price: 20,
  retail_price: 0,
  wholesale_price: 0,
  distributor_price: 0,
  is_default_purchase: true,
  is_default_sales: true,
  is_active: true,
  ...overrides,
});

const uomRows: ProductUomRow[] = [
  baseRow(),
  baseRow({
    id: '2',
    uom_id: 6,
    uom_code: 'box',
    uom_name: 'Box',
    conversion_to_base: 48,
    purchase_price: 960,
    is_default_purchase: false,
    is_default_sales: false,
  }),
];

describe('resolveCatalogPurchaseUom', () => {
  it('prefers supplier last-received UOM code', () => {
    const uom = resolveCatalogPurchaseUom(uomRows, 'box', 1);
    expect(uom?.uom_code).toBe('box');
  });

  it('falls back to default purchase UOM', () => {
    const uom = resolveCatalogPurchaseUom(uomRows, null, 1);
    expect(uom?.uom_code).toBe('pc');
  });
});

describe('resolveCatalogUnitCost', () => {
  it('uses supplier history cost when present', () => {
    const cost = resolveCatalogUnitCost({ unit_cost: 984, has_supplier_price: true }, uomRows[1]);
    expect(cost).toBe(984);
  });

  it('falls back to UOM purchase price without supplier history', () => {
    const cost = resolveCatalogUnitCost({ unit_cost: 20, has_supplier_price: false }, uomRows[1]);
    expect(cost).toBe(960);
  });
});

describe('enrichCatalogRow', () => {
  it('exposes supplier UOM and has_supplier_price flag', () => {
    const row = enrichCatalogRow({
      catalog_item_id: 'c1',
      supplier_id: 3,
      product_id: 'p1',
      order_qty_multiplier: 1,
      fixed_order_qty: null,
      sort_order: 0,
      sku: 'SKU',
      name: 'Item',
      unit_of_measure: 'pc',
      reorder_level: 48,
      store_qty: 0,
      warehouse_qty: 0,
      total_qty: 0,
      cost: 20,
      tax_type: 'VAT',
      last_supplier_cost: 984,
      last_supplier_uom: 'box',
    });
    expect(row.unit_cost).toBe(984);
    expect(row.unit_cost_uom).toBe('box');
    expect(row.has_supplier_price).toBe(true);
  });
});
