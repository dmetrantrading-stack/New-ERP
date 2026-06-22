import { getClient } from '../src/config/database';
import { repairDuplicateInvoiceCogs } from '../src/utils/glIntegrity';

/** CLI: repair duplicate COGS for one invoice by invoice_number */
async function main() {
  const invoiceNumber = process.argv[2] || 'SI-2026-000001';
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const inv = await client.query(
      `SELECT id FROM sales_invoices WHERE invoice_number = $1`,
      [invoiceNumber],
    );
    if (!inv.rows.length) {
      console.log('Invoice not found:', invoiceNumber);
      await client.query('ROLLBACK');
      return;
    }
    const result = await repairDuplicateInvoiceCogs(client, inv.rows[0].id);
    await client.query('COMMIT');
    console.log('Repair complete:', invoiceNumber, result);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
