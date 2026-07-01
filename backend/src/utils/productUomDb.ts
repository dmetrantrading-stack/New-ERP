import { v4 as uuidv4 } from 'uuid';
import type { ProductUomRow } from './uom';

type DbClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function uomCodeExprs(db: DbClient): Promise<{ join: string; plain: string }> {
  const col = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'abbreviation'
     LIMIT 1`,
  );
  if (col.rows.length > 0) {
    return {
      join: `LOWER(TRIM(COALESCE(NULLIF(TRIM(u.code), ''), NULLIF(TRIM(u.abbreviation), ''),
        CASE WHEN LOWER(TRIM(u.name)) IN ('piece', 'pieces', 'pc') THEN 'pc'
        ELSE LOWER(REGEXP_REPLACE(TRIM(u.name), '[^a-zA-Z0-9]', '', 'g')) END)))`,
      plain: `LOWER(TRIM(COALESCE(NULLIF(TRIM(code), ''), NULLIF(TRIM(abbreviation), ''),
        CASE WHEN LOWER(TRIM(name)) IN ('piece', 'pieces', 'pc') THEN 'pc'
        ELSE LOWER(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]', '', 'g')) END)))`,
    };
  }
  return {
    join: `LOWER(TRIM(COALESCE(NULLIF(TRIM(u.code), ''),
      CASE WHEN LOWER(TRIM(u.name)) IN ('piece', 'pieces', 'pc') THEN 'pc'
      ELSE LOWER(REGEXP_REPLACE(TRIM(u.name), '[^a-zA-Z0-9]', '', 'g')) END)))`,
    plain: `LOWER(TRIM(COALESCE(NULLIF(TRIM(code), ''),
      CASE WHEN LOWER(TRIM(name)) IN ('piece', 'pieces', 'pc') THEN 'pc'
      ELSE LOWER(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]', '', 'g')) END)))`,
  };
}

function mapUomRow(row: Record<string, unknown>): ProductUomRow {
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    uom_id: Number(row.uom_id),
    uom_code: String(row.uom_code || ''),
    uom_name: String(row.uom_name || ''),
    conversion_to_base: parseFloat(String(row.conversion_to_base)) || 1,
    barcode: row.barcode as string | null,
    purchase_price: parseFloat(String(row.purchase_price)) || 0,
    retail_price: parseFloat(String(row.retail_price)) || 0,
    wholesale_price: parseFloat(String(row.wholesale_price)) || 0,
    distributor_price: parseFloat(String(row.distributor_price)) || 0,
    is_default_purchase: Boolean(row.is_default_purchase),
    is_default_sales: Boolean(row.is_default_sales),
    is_active: Boolean(row.is_active),
  };
}

export async function loadProductUoms(db: DbClient, productId: string): Promise<ProductUomRow[]> {
  const codeExpr = await uomCodeExprs(db);
  const r = await db.query(
    `SELECT c.*, ${codeExpr.join} AS uom_code, u.name AS uom_name
     FROM product_uom_conversions c
     JOIN uoms u ON u.id = c.uom_id
     WHERE c.product_id = $1 AND c.is_active = true
     ORDER BY c.conversion_to_base ASC, uom_code ASC`,
    [productId],
  );
  return r.rows.map(mapUomRow);
}

export async function loadProductUomsBulk(db: DbClient, productIds: string[]): Promise<Record<string, ProductUomRow[]>> {
  if (!productIds.length) return {};
  const codeExpr = await uomCodeExprs(db);
  const r = await db.query(
    `SELECT c.*, ${codeExpr.join} AS uom_code, u.name AS uom_name
     FROM product_uom_conversions c
     JOIN uoms u ON u.id = c.uom_id
     WHERE c.product_id = ANY($1::uuid[]) AND c.is_active = true
     ORDER BY c.conversion_to_base ASC, uom_code ASC`,
    [productIds],
  );
  const out: Record<string, ProductUomRow[]> = {};
  for (const row of r.rows) {
    const mapped = mapUomRow(row);
    if (!out[mapped.product_id]) out[mapped.product_id] = [];
    out[mapped.product_id].push(mapped);
  }
  return out;
}

export async function lookupBarcodeUom(
  db: DbClient,
  barcode: string,
): Promise<{ product_id: string; uom: ProductUomRow } | null> {
  const bc = String(barcode || '').trim();
  if (!bc) return null;

  const codeExpr = await uomCodeExprs(db);
  const r = await db.query(
    `SELECT c.*, ${codeExpr.join} AS uom_code, u.name AS uom_name
     FROM product_uom_conversions c
     JOIN uoms u ON u.id = c.uom_id
     WHERE c.is_active = true AND LOWER(TRIM(c.barcode)) = LOWER($1)
     LIMIT 1`,
    [bc],
  );
  if (r.rows.length > 0) {
    const uom = mapUomRow(r.rows[0]);
    return { product_id: uom.product_id, uom };
  }

  const prod = await db.query(
    `SELECT id FROM products
     WHERE is_active = true AND barcode IS NOT NULL AND LOWER(TRIM(barcode)) = LOWER($1)
     LIMIT 1`,
    [bc],
  );
  if (prod.rows.length === 0) return null;

  const productId = String(prod.rows[0].id);
  const uoms = await loadProductUoms(db, productId);
  const base = uoms.find((u) => u.conversion_to_base === 1) || uoms[0];
  if (!base) return null;
  return { product_id: productId, uom: base };
}

export interface UomConversionInput {
  uom_id: number;
  conversion_to_base: number;
  barcode?: string;
  purchase_price?: number;
  retail_price?: number;
  wholesale_price?: number;
  distributor_price?: number;
  is_default_purchase?: boolean;
  is_default_sales?: boolean;
}

export async function syncProductUomConversions(
  db: DbClient,
  productId: string,
  conversions: UomConversionInput[],
  productDefaults: {
    cost: number;
    retail_price: number;
    wholesale_price: number;
    distributor_price: number;
    barcode?: string;
    base_uom_id?: number;
    allow_multiple_uom?: boolean;
  },
): Promise<void> {
  const baseUomId = productDefaults.base_uom_id;
  let rows = conversions
    .map((c) => ({ ...c, uom_id: Number(c.uom_id) }))
    .filter((c) => Number.isFinite(c.uom_id) && c.uom_id > 0 && (c.conversion_to_base || 0) > 0);

  if (rows.length === 0 && baseUomId) {
    rows = [{
      uom_id: baseUomId,
      conversion_to_base: 1,
      barcode: productDefaults.barcode,
      purchase_price: productDefaults.cost,
      retail_price: productDefaults.retail_price,
      wholesale_price: productDefaults.wholesale_price,
      distributor_price: productDefaults.distributor_price,
      is_default_purchase: true,
      is_default_sales: true,
    }];
  }

  const existing = await db.query(
    `SELECT id, uom_id FROM product_uom_conversions WHERE product_id = $1`,
    [productId],
  );
  const existingByUom = new Map(existing.rows.map((r) => [Number(r.uom_id), String(r.id)]));

  const seenUoms = new Set<number>();
  for (const row of rows) {
    if (seenUoms.has(row.uom_id)) continue;
    seenUoms.add(row.uom_id);

    const barcode = String(row.barcode || '').trim() || null;
    const params = [
      row.conversion_to_base,
      barcode,
      row.purchase_price ?? productDefaults.cost,
      row.retail_price ?? productDefaults.retail_price,
      row.wholesale_price ?? productDefaults.wholesale_price,
      row.distributor_price ?? productDefaults.distributor_price,
      Boolean(row.is_default_purchase),
      Boolean(row.is_default_sales),
    ];

    const existingId = existingByUom.get(row.uom_id);
    if (existingId) {
      await db.query(
        `UPDATE product_uom_conversions SET
          conversion_to_base = $1, barcode = $2,
          purchase_price = $3, retail_price = $4, wholesale_price = $5, distributor_price = $6,
          is_default_purchase = $7, is_default_sales = $8, is_active = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [...params, existingId],
      );
    } else {
      await db.query(
        `INSERT INTO product_uom_conversions (
          id, product_id, uom_id, conversion_to_base, barcode,
          purchase_price, retail_price, wholesale_price, distributor_price,
          is_default_purchase, is_default_sales, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
        [uuidv4(), productId, row.uom_id, ...params],
      );
    }
  }

  if (productDefaults.allow_multiple_uom && seenUoms.size > 0) {
    await db.query(
      `UPDATE product_uom_conversions SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $1 AND uom_id != ALL($2::int[])`,
      [productId, Array.from(seenUoms)],
    );
  }
}

export async function ensureProductBaseUomOnCreate(
  db: DbClient,
  productId: string,
  _unitOfMeasure: string,
  prices: { cost: number; retail: number; wholesale: number; distributor: number; barcode?: string },
): Promise<{ base_uom_id: number; default_purchase_uom_id: number; default_sales_uom_id: number }> {
  const codeExpr = await uomCodeExprs(db);
  const uomRes = await db.query(`SELECT id FROM uoms WHERE ${codeExpr.plain} = 'pc' LIMIT 1`);
  const uomId = Number(uomRes.rows[0]?.id);

  await db.query(
    `UPDATE products SET base_uom_id = $1, default_purchase_uom_id = $1, default_sales_uom_id = $1 WHERE id = $2`,
    [uomId, productId],
  );

  await syncProductUomConversions(db, productId, [{
    uom_id: uomId,
    conversion_to_base: 1,
    barcode: prices.barcode,
    purchase_price: prices.cost,
    retail_price: prices.retail,
    wholesale_price: prices.wholesale,
    distributor_price: prices.distributor,
    is_default_purchase: true,
    is_default_sales: true,
  }], {
    cost: prices.cost,
    retail_price: prices.retail,
    wholesale_price: prices.wholesale,
    distributor_price: prices.distributor,
    barcode: prices.barcode,
    base_uom_id: uomId,
  });

  return { base_uom_id: uomId, default_purchase_uom_id: uomId, default_sales_uom_id: uomId };
}
