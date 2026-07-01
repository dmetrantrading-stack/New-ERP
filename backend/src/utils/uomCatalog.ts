import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function loadUomCatalogRows() {
  const abbrev = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'abbreviation'
     LIMIT 1`,
  );
  const codeExpr = abbrev.rows.length > 0
    ? `LOWER(TRIM(COALESCE(NULLIF(TRIM(code), ''), NULLIF(TRIM(abbreviation), ''),
        CASE WHEN LOWER(TRIM(name)) IN ('piece', 'pieces', 'pc') THEN 'pc'
        ELSE LOWER(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]', '', 'g')) END)))`
    : `LOWER(TRIM(COALESCE(NULLIF(TRIM(code), ''),
        CASE WHEN LOWER(TRIM(name)) IN ('piece', 'pieces', 'pc') THEN 'pc'
        ELSE LOWER(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]', '', 'g')) END)))`;
  const r = await query(
    `SELECT id, ${codeExpr} AS code, name FROM uoms WHERE COALESCE(is_active, true) = true ORDER BY 2`,
  );
  return r.rows;
}

export async function createUomCatalogEntry(rawCode: string, rawName?: string) {
  const trimmed = String(rawCode || '').trim();
  if (!trimmed) {
    throw new AppError('UOM code is required (e.g. 500g, kg, box)', 400);
  }
  const code = trimmed.toLowerCase().replace(/\s+/g, '');
  if (!/^[a-z0-9]{1,20}$/.test(code)) {
    throw new AppError('UOM code must be 1–20 letters or numbers (e.g. 500g, kg)', 400);
  }
  const name = String(rawName || '').trim() || code.toUpperCase();

  const abbrev = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'abbreviation'
     LIMIT 1`,
  );
  const legacyUoms = abbrev.rows.length > 0;

  if (legacyUoms) {
    const codeUpper = code.toUpperCase();
    const existing = await query(
      `SELECT id, COALESCE(is_active, true) AS is_active FROM uoms
       WHERE LOWER(TRIM(COALESCE(code, ''))) = $1::text
          OR UPPER(TRIM(COALESCE(abbreviation, ''))) = $2::text
       LIMIT 1`,
      [code, codeUpper],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].is_active) {
        throw new AppError(`UOM "${codeUpper}" already exists`, 409);
      }
      const reactivated = await query(
        `UPDATE uoms SET code = $1::varchar, name = $2::varchar, abbreviation = $3::varchar, is_active = true
         WHERE id = $4
         RETURNING id, LOWER(TRIM(code)) AS code, name`,
        [code, name, codeUpper, existing.rows[0].id],
      );
      return reactivated.rows[0];
    }
    const inserted = await query(
      `INSERT INTO uoms (code, name, abbreviation, is_active)
       VALUES ($1::varchar, $2::varchar, $3::varchar, true)
       RETURNING id, LOWER(TRIM(code)) AS code, name`,
      [code, name, codeUpper],
    );
    return inserted.rows[0];
  }

  const existing = await query(
    `SELECT id, COALESCE(is_active, true) AS is_active FROM uoms
     WHERE LOWER(TRIM(COALESCE(code, ''))) = $1::text LIMIT 1`,
    [code],
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].is_active) {
      throw new AppError(`UOM "${code.toUpperCase()}" already exists`, 409);
    }
    const reactivated = await query(
      `UPDATE uoms SET code = $1::varchar, name = $2::varchar, is_active = true
       WHERE id = $3
       RETURNING id, LOWER(TRIM(code)) AS code, name`,
      [code, name, existing.rows[0].id],
    );
    return reactivated.rows[0];
  }
  const inserted = await query(
    `INSERT INTO uoms (code, name, is_active)
     VALUES ($1, $2, true)
     RETURNING id, LOWER(TRIM(code)) AS code, name`,
    [code, name],
  );
  return inserted.rows[0];
}

function isProtectedBaseUomCode(code: string): boolean {
  const c = code.toLowerCase().trim();
  return !c || c === 'pc' || c === 'pcs' || c === 'piece' || c === 'pieces';
}

export async function deactivateUomCatalogEntry(uomId: number) {
  const id = Number(uomId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError('Invalid UOM id', 400);
  }

  const rowRes = await query(
    `SELECT id, LOWER(TRIM(COALESCE(code, ''))) AS code, name
     FROM uoms WHERE id = $1`,
    [id],
  );
  if (!rowRes.rows.length) {
    throw new AppError('UOM not found', 404);
  }
  const row = rowRes.rows[0];
  if (isProtectedBaseUomCode(row.code)) {
    throw new AppError('Cannot remove the base unit (Piece / PC)', 400);
  }

  const convUsage = await query(
    `SELECT COUNT(*)::int AS n FROM product_uom_conversions
     WHERE uom_id = $1 AND COALESCE(is_active, true) = true`,
    [id],
  );
  const convCount = convUsage.rows[0]?.n || 0;
  if (convCount > 0) {
    throw new AppError(
      `Cannot remove: used on ${convCount} product(s). Remove the UOM from those products first.`,
      409,
    );
  }

  const defaultUsage = await query(
    `SELECT COUNT(*)::int AS n FROM products
     WHERE base_uom_id = $1 OR default_purchase_uom_id = $1 OR default_sales_uom_id = $1`,
    [id],
  );
  const defaultCount = defaultUsage.rows[0]?.n || 0;
  if (defaultCount > 0) {
    throw new AppError(
      `Cannot remove: set as default UOM on ${defaultCount} product(s).`,
      409,
    );
  }

  await query(`UPDATE uoms SET is_active = false WHERE id = $1`, [id]);
  return { id: row.id, code: row.code, name: row.name };
}
