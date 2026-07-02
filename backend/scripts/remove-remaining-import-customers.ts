/**
 * Remove the last 6 active DMC-/BDA- customers from bulk/opening imports.
 * Run: npx ts-node scripts/remove-remaining-import-customers.ts
 */
import { getClient } from '../src/config/database';

const CODES = ['BDA-050', 'DMC-00077', 'DMC-00078', 'DMC-00079', 'DMC-00080', 'DMC-00081'];

async function main() {
  const client = await getClient();
  const summary: Record<string, string> = {};

  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, customer_code, customer_name, balance, is_active
       FROM customers WHERE customer_code = ANY($1::text[])`,
      [CODES],
    );

    if (found.rows.length === 0) {
      console.log('No matching customers found.');
      await client.query('ROLLBACK');
      return;
    }

    const ids = found.rows.map((r: { id: number }) => r.id);

    // Void any remaining open invoices
    const voided = await client.query(
      `UPDATE sales_invoices SET status = 'Void', balance = 0, amount_paid = total, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ANY($1::int[]) AND status NOT IN ('Void', 'Cancelled')
       RETURNING invoice_number`,
      [ids],
    );
    summary.invoices_voided = String(voided.rowCount || 0);

    // Delete void invoices for these customers (including any leftovers)
    const invIds = await client.query(
      `SELECT id FROM sales_invoices WHERE customer_id = ANY($1::int[])`,
      [ids],
    );
    const invoiceIds = invIds.rows.map((r: { id: string }) => r.id);
    if (invoiceIds.length > 0) {
      await client.query('DELETE FROM collection_receipt_allocations WHERE invoice_id = ANY($1::uuid[])', [invoiceIds]);
      await client.query('DELETE FROM collection_receipts WHERE invoice_id = ANY($1::uuid[])', [invoiceIds]);
      await client.query('DELETE FROM sales_returns WHERE invoice_id = ANY($1::uuid[])', [invoiceIds]);
      await client.query('DELETE FROM sales_memos WHERE invoice_id = ANY($1::uuid[])', [invoiceIds]);
      await client.query(
        `DELETE FROM journal_entry_lines WHERE entry_id IN (
           SELECT id FROM journal_entries WHERE reference_id = ANY($1::uuid[])
         )`,
        [invoiceIds],
      );
      await client.query('DELETE FROM journal_entries WHERE reference_id = ANY($1::uuid[])', [invoiceIds]);
      const delInv = await client.query('DELETE FROM sales_invoices WHERE id = ANY($1::uuid[])', [invoiceIds]);
      summary.invoices_deleted = String(delInv.rowCount || 0);
    }

    const del = await client.query(
      `DELETE FROM customers WHERE id = ANY($1::int[]) RETURNING customer_code, customer_name`,
      [ids],
    );
    summary.customers_deleted = String(del.rowCount || 0);

    await client.query('COMMIT');

    console.log('Removed customers:', summary);
    if (del.rows.length) {
      console.table(del.rows);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
