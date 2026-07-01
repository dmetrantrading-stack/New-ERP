import { query } from '../config/database';
import { ProductUomRow, resolveLineUom } from './uom';

export const SUPPLIER_CATALOG_STOCK_SQL = `
  SELECT
    sci.id AS catalog_item_id,
    sci.supplier_id,
    sci.product_id,
    sci.order_qty_multiplier,
    sci.fixed_order_qty,
    sci.sort_order,
    p.sku,
    p.name,
    p.unit_of_measure,
    p.reorder_level,
    p.cost,
    p.tax_type,
    COALESCE(s_store.quantity, 0) AS store_qty,
    COALESCE(s_warehouse.quantity, 0) AS warehouse_qty,
    COALESCE(s_store.quantity, 0) + COALESCE(s_warehouse.quantity, 0) AS total_qty,
    (
      SELECT sph.unit_cost
      FROM supplier_price_history sph
      WHERE sph.product_id = p.id AND sph.supplier_id = sci.supplier_id
      ORDER BY sph.received_date DESC, sph.created_at DESC
      LIMIT 1
    ) AS last_supplier_cost,
    (
      SELECT sph.uom
      FROM supplier_price_history sph
      WHERE sph.product_id = p.id AND sph.supplier_id = sci.supplier_id
      ORDER BY sph.received_date DESC, sph.created_at DESC
      LIMIT 1
    ) AS last_supplier_uom
  FROM supplier_catalog_items sci
  JOIN products p ON sci.product_id = p.id AND p.is_active = true
  LEFT JOIN inventory s_store ON p.id = s_store.product_id AND s_store.location_id = 1
  LEFT JOIN inventory s_warehouse ON p.id = s_warehouse.product_id AND s_warehouse.location_id = 2
  WHERE sci.supplier_id = $1 AND sci.is_active = true
  ORDER BY sci.sort_order ASC, p.name ASC
`;

export function computeStandardOrderQty(
  reorderLevel: number,
  orderQtyMultiplier: number,
  fixedOrderQty: number | null | undefined,
): number | null {
  if (fixedOrderQty != null && parseFloat(String(fixedOrderQty)) > 0) {
    return parseFloat(String(fixedOrderQty));
  }
  if (reorderLevel <= 0) return null;
  const multiplier = orderQtyMultiplier > 0 ? orderQtyMultiplier : 1;
  return reorderLevel * multiplier;
}

export function computeSuggestedOrderQty(
  totalQty: number,
  reorderLevel: number,
  orderQtyMultiplier: number,
  fixedOrderQty: number | null | undefined,
): number | null {
  if (reorderLevel <= 0) return null;
  if (totalQty > reorderLevel) return null;
  return computeStandardOrderQty(reorderLevel, orderQtyMultiplier, fixedOrderQty);
}

export function enrichCatalogRow(row: any) {
  const totalQty = parseFloat(row.total_qty ?? 0);
  const reorderLevel = parseFloat(row.reorder_level ?? 0);
  const multiplier = parseFloat(row.order_qty_multiplier ?? 1);
  const fixedOrderQty = row.fixed_order_qty != null ? parseFloat(row.fixed_order_qty) : null;
  const isLowStock = reorderLevel > 0 && totalQty <= reorderLevel;
  const standardOrderQty = computeStandardOrderQty(reorderLevel, multiplier, fixedOrderQty);
  const suggestedOrderQty = isLowStock ? standardOrderQty : null;
  const lastSupplierCost = row.last_supplier_cost != null && row.last_supplier_cost !== ''
    ? parseFloat(String(row.last_supplier_cost))
    : null;
  const unitCost = lastSupplierCost ?? parseFloat(row.cost ?? 0);

  return {
    catalog_item_id: row.catalog_item_id,
    supplier_id: row.supplier_id,
    product_id: row.product_id,
    sku: row.sku,
    name: row.name,
    unit_of_measure: row.unit_of_measure || 'pc',
    reorder_level: reorderLevel,
    store_qty: parseFloat(row.store_qty ?? 0),
    warehouse_qty: parseFloat(row.warehouse_qty ?? 0),
    total_qty: totalQty,
    deficit: isLowStock ? Math.max(reorderLevel - totalQty, 0) : 0,
    is_low_stock: isLowStock,
    standard_order_qty: standardOrderQty,
    suggested_order_qty: suggestedOrderQty,
    order_qty_multiplier: multiplier,
    fixed_order_qty: fixedOrderQty,
    unit_cost: unitCost,
    unit_cost_uom: row.last_supplier_uom || 'pc',
    has_supplier_price: lastSupplierCost != null,
    tax_type: row.tax_type || 'VAT',
    sort_order: row.sort_order ?? 0,
  };
}

/** Pick purchase UOM for catalog copy — prefer supplier's last-received UOM when known. */
export function resolveCatalogPurchaseUom(
  uomRows: ProductUomRow[],
  supplierUomCode: string | null | undefined,
  defaultPurchaseUomId?: number | null,
): ProductUomRow | null {
  const code = String(supplierUomCode || '').trim().toLowerCase();
  if (code && uomRows.length) {
    const byCode = uomRows.find((r) => String(r.uom_code || '').trim().toLowerCase() === code);
    if (byCode) return byCode;
  }
  return resolveLineUom(uomRows, null, defaultPurchaseUomId ?? null);
}

/** Supplier-specific cost wins over product UOM purchase price when history exists. */
export function resolveCatalogUnitCost(
  catalogItem: { unit_cost?: number; has_supplier_price?: boolean },
  uom: ProductUomRow | null,
): number {
  if (catalogItem.has_supplier_price && parseFloat(String(catalogItem.unit_cost)) > 0) {
    return parseFloat(String(catalogItem.unit_cost));
  }
  const uomPrice = parseFloat(String(uom?.purchase_price)) || 0;
  if (uomPrice > 0) return uomPrice;
  return parseFloat(String(catalogItem.unit_cost)) || 0;
}

export async function fetchSupplierCatalogItems(supplierId: number, lowStockOnly = false) {
  const result = await query(SUPPLIER_CATALOG_STOCK_SQL, [supplierId]);
  let items = result.rows.map(enrichCatalogRow);
  if (lowStockOnly) items = items.filter((i) => i.is_low_stock);
  const all = result.rows.map(enrichCatalogRow);
  return {
    items,
    summary: {
      total_items: all.length,
      low_stock_count: all.filter((i) => i.is_low_stock).length,
    },
  };
}

export type CatalogInsertInput = {
  product_id: string;
  order_qty_multiplier?: number;
  fixed_order_qty?: number | null;
  sort_order?: number;
};

export type CatalogBulkResult = {
  added: number;
  reactivated: number;
  skipped: number;
  errors: { product_id?: string; sku?: string; name?: string; message: string }[];
};

export async function addProductsToSupplierCatalog(
  supplierId: number,
  inputs: CatalogInsertInput[],
): Promise<CatalogBulkResult> {
  const result: CatalogBulkResult = { added: 0, reactivated: 0, skipped: 0, errors: [] };
  const seen = new Set<string>();

  for (const input of inputs) {
    const productId = String(input.product_id || '').trim();
    if (!productId) {
      result.errors.push({ message: 'Product id is required' });
      continue;
    }
    if (seen.has(productId)) {
      result.skipped++;
      continue;
    }
    seen.add(productId);

    const product = await query('SELECT id, name, sku FROM products WHERE id = $1 AND is_active = true', [productId]);
    if (product.rows.length === 0) {
      result.errors.push({ product_id: productId, message: 'Product not found or inactive' });
      continue;
    }

    const multiplier = input.order_qty_multiplier != null ? parseFloat(String(input.order_qty_multiplier)) : 1;
    const fixedQty = input.fixed_order_qty != null && String(input.fixed_order_qty).trim() !== ''
      ? parseFloat(String(input.fixed_order_qty))
      : null;
    const sortOrder = input.sort_order != null ? parseInt(String(input.sort_order), 10) : 0;

    const existing = await query(
      'SELECT id, is_active FROM supplier_catalog_items WHERE supplier_id = $1 AND product_id = $2',
      [supplierId, productId],
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].is_active) {
        result.skipped++;
        continue;
      }
      await query(
        `UPDATE supplier_catalog_items SET
          is_active = true,
          order_qty_multiplier = $1,
          fixed_order_qty = $2,
          sort_order = $3,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [multiplier, fixedQty, sortOrder, existing.rows[0].id],
      );
      result.reactivated++;
      continue;
    }

    await query(
      `INSERT INTO supplier_catalog_items (id, supplier_id, product_id, order_qty_multiplier, fixed_order_qty, sort_order)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [supplierId, productId, multiplier, fixedQty, sortOrder],
    );
    result.added++;
  }

  return result;
}

export async function resolveProductIdBySkuOrName(
  sku: string,
  name: string,
  bySku: Map<string, { id: string; sku: string; name: string }>,
  byName: Map<string, { id: string; sku: string; name: string }>,
  bySkuLower?: Map<string, { id: string; sku: string; name: string }>,
): Promise<{ id: string; sku: string; name: string } | null> {
  const skuKey = sku.trim();
  const nameKey = name.trim().toLowerCase();
  if (skuKey) {
    const exact = bySku.get(skuKey);
    if (exact) return exact;
    const lower = bySkuLower?.get(skuKey.toLowerCase());
    if (lower) return lower;
  }
  if (nameKey) {
    const match = byName.get(nameKey);
    if (match) return match;
  }
  return null;
}
