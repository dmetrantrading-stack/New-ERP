/**
 * One-off: force deactivate customers by code (sets inactive + balance 0, voids open invoices).
 * Usage: npx ts-node scripts/force-deactivate-customers.ts
 */
import { query } from '../src/config/database';

const CODES = [
  'DMC-00086', 'DMC-00083', 'DMC-00087', 'DMC-00088', 'DMC-00082',
  'DMC-00084', 'DMC-00090', 'DMC-00089', 'DMC-00085',
  'BDA-001', 'BDA-002', 'BDA-003', 'BDA-004', 'BDA-005', 'BDA-006', 'BDA-007', 'BDA-008', 'BDA-009', 'BDA-010',
  'BDA-011', 'BDA-012', 'BDA-013', 'BDA-014', 'BDA-015', 'BDA-016', 'BDA-017', 'BDA-018', 'BDA-019', 'BDA-020',
  'BDA-021', 'BDA-022', 'BDA-023', 'BDA-024', 'BDA-025', 'BDA-026', 'BDA-027', 'BDA-028', 'BDA-029', 'BDA-030',
  'BDA-031', 'BDA-032', 'BDA-033', 'BDA-034', 'BDA-035', 'BDA-036', 'BDA-037', 'BDA-038', 'BDA-039', 'BDA-040',
  'BDA-041', 'BDA-042', 'BDA-043', 'BDA-044', 'BDA-045', 'BDA-046', 'BDA-047', 'BDA-048', 'BDA-049',
];

async function main() {
  const found = await query(
    `SELECT id, customer_code, customer_name, balance FROM customers WHERE customer_code = ANY($1)`,
    [CODES],
  );
  console.log(`Found ${found.rows.length} of ${CODES.length} codes`);
  for (const row of found.rows) {
    const inv = await query(
      `UPDATE sales_invoices SET status = 'Void', balance = 0, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $1 AND balance > 0 AND status NOT IN ('Cancelled', 'Void')
       RETURNING invoice_number`,
      [row.id],
    );
    await query(
      `UPDATE customers SET is_active = false, balance = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id],
    );
    console.log(`Removed ${row.customer_code} (${row.customer_name}) — voided ${inv.rowCount} invoice(s)`);
  }
  const missing = CODES.filter((c) => !found.rows.some((r: any) => r.customer_code === c));
  if (missing.length) console.log('Not found:', missing.join(', '));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
