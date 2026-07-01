import { getClient } from '../config/database';

/**
 * Set PC as the base UOM for every product.
 * Converts existing base rows to PC where possible to avoid duplicate barcode rows.
 */
async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const pcRes = await client.query(`SELECT id FROM uoms WHERE LOWER(TRIM(code)) = 'pc' LIMIT 1`);
    const pcId = Number(pcRes.rows[0]?.id);
    if (!pcId) throw new Error('PC UOM not found in catalog — run migrate first');

    const productsUpdated = await client.query(
      `UPDATE products SET
        base_uom_id = $1,
        default_purchase_uom_id = $1,
        default_sales_uom_id = $1,
        unit_of_measure = 'pc',
        updated_at = CURRENT_TIMESTAMP`,
      [pcId],
    );

    const convertedBase = await client.query(
      `UPDATE product_uom_conversions c
       SET uom_id = $1,
           is_default_purchase = true,
           is_default_sales = true,
           updated_at = CURRENT_TIMESTAMP
       FROM uoms u
       WHERE c.uom_id = u.id
         AND LOWER(TRIM(u.code)) <> 'pc'
         AND c.conversion_to_base = 1
         AND c.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM product_uom_conversions c2
           WHERE c2.product_id = c.product_id AND c2.uom_id = $1 AND c2.is_active = true
         )`,
      [pcId],
    );

    const inserted = await client.query(
      `INSERT INTO product_uom_conversions (
        id, product_id, uom_id, conversion_to_base, barcode,
        purchase_price, retail_price, wholesale_price, distributor_price,
        is_default_purchase, is_default_sales, is_active
      )
      SELECT uuid_generate_v4(), p.id, $1, 1, NULL,
        p.cost, p.retail_price, p.wholesale_price, p.distributor_price,
        true, true, true
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM product_uom_conversions c
        WHERE c.product_id = p.id AND c.uom_id = $1 AND c.is_active = true
      )`,
      [pcId],
    );

    await client.query(
      `UPDATE product_uom_conversions c
       SET conversion_to_base = 1,
           purchase_price = p.cost,
           retail_price = p.retail_price,
           wholesale_price = p.wholesale_price,
           distributor_price = p.distributor_price,
           is_default_purchase = true,
           is_default_sales = true,
           is_active = true,
           updated_at = CURRENT_TIMESTAMP
       FROM products p
       WHERE c.product_id = p.id AND c.uom_id = $1`,
      [pcId],
    );

    const demoted = await client.query(
      `UPDATE product_uom_conversions c
       SET conversion_to_base = 12,
           is_default_purchase = false,
           is_default_sales = false,
           updated_at = CURRENT_TIMESTAMP
       FROM uoms u
       WHERE c.uom_id = u.id
         AND LOWER(TRIM(u.code)) <> 'pc'
         AND c.conversion_to_base = 1
         AND c.is_active = true`,
    );

    const counts = await client.query(
      `SELECT
        COUNT(*)::int AS total_products,
        COUNT(*) FILTER (
          WHERE base_uom_id = $1 AND LOWER(TRIM(unit_of_measure)) = 'pc'
        )::int AS pc_base_products,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM product_uom_conversions c
            WHERE c.product_id = products.id AND c.uom_id = $1
              AND c.conversion_to_base = 1 AND c.is_active = true
          )
        )::int AS pc_conversion_rows
       FROM products`,
      [pcId],
    );

    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('products_base_uom_pc_backfill_v1', 'done')
       ON CONFLICT (setting_key) DO NOTHING`,
    );

    await client.query('COMMIT');

    console.log(`Products updated: ${productsUpdated.rowCount}`);
    console.log(`Base rows converted to PC: ${convertedBase.rowCount}`);
    console.log(`PC conversion rows inserted: ${inserted.rowCount}`);
    console.log(`Former base rows demoted to alternate (×12): ${demoted.rowCount}`);
    console.log(counts.rows[0]);
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
