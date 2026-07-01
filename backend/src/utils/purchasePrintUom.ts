import { loadProductUomsBulk } from './productUomDb';
import { resolvePurchaseLineUomFromRaw } from './uom';

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Resolve line UOM for purchase print/PDF — uses saved uom_id + conversion, not product default pc. */
export async function enrichPurchasePrintLineUoms(db: Db, items: any[]): Promise<any[]> {
  if (!items.length) return items;
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];
  const uomMap = productIds.length ? await loadProductUomsBulk(db, productIds) : {};
  const defaultUomByProduct: Record<string, number | null> = {};
  if (productIds.length) {
    const prodRows = await db.query(
      'SELECT id, default_purchase_uom_id FROM products WHERE id = ANY($1::uuid[])',
      [productIds],
    );
    for (const row of prodRows.rows) {
      defaultUomByProduct[String(row.id)] = row.default_purchase_uom_id != null
        ? Number(row.default_purchase_uom_id)
        : null;
    }
  }
  return items.map((row) => {
    const resolved = resolvePurchaseLineUomFromRaw(uomMap[row.product_id] || [], {
      uom_id: row.uom_id,
      conversion_to_base: row.conversion_to_base,
      entered_qty: row.entered_qty,
      quantity: row.quantity,
      base_qty: row.base_qty,
      uom: row.uom_code,
      unit_of_measure: row.unit_of_measure,
      unit_cost: row.unit_cost,
      net_unit_cost: row.net_unit_cost,
      estimated_cost: row.estimated_cost,
    }, defaultUomByProduct[row.product_id] ?? null);
    const code = resolved?.uom_code || row.uom_code || row.unit_of_measure || 'pc';
    return {
      ...row,
      display_uom: String(code).trim().toUpperCase() || 'PC',
    };
  });
}
