import { query } from '../config/database';

async function main() {
  const updated = await query(`
    UPDATE products SET
      allow_multiple_uom = true,
      track_batch = true,
      track_expiry = true
  `);
  const counts = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE allow_multiple_uom AND track_batch AND track_expiry)::int AS all_on
    FROM products
  `);
  await query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES ('products_tracking_flags_backfill_v1', 'done')
     ON CONFLICT (setting_key) DO NOTHING`,
  );
  console.log(`Updated ${updated.rowCount} products`);
  console.log(counts.rows[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
