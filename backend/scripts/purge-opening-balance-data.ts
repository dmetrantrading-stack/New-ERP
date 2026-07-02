/**
 * Permanently remove all data from Settings → Opening balances imports.
 * Does NOT touch bank/cash starting balances.
 *
 * Run: npx ts-node scripts/purge-opening-balance-data.ts
 */
import { getClient } from '../src/config/database';

const OPENING_INVOICE_FILTER = `
  si.notes ILIKE '%Opening A/R migrated%'
  OR EXISTS (
    SELECT 1 FROM sales_invoice_items sii
    WHERE sii.invoice_id = si.id
      AND sii.description ILIKE 'Opening balance — legacy%'
  )
`;

const OPENING_JE_FILTER = `
  reference_type = 'Opening Balance'
  AND (
    description = 'Opening balance import'
    OR description ILIKE 'Opening A/R —%'
  )
`;

async function purgeOpeningBalanceData() {
  const client = await getClient();
  const summary = {
    ar_invoices_voided: 0,
    ar_invoices_deleted: 0,
    journal_entries_voided: 0,
    journal_entries_deleted: 0,
    inventory_lines_reversed: 0,
    customers_rebalanced: 0,
    suppliers_rebalanced: 0,
    placeholder_customers_deleted: 0,
  };

  try {
    await client.query('BEGIN');

    // 1. Void any still-active opening AR invoices
    const activeInv = await client.query(
      `SELECT si.id, si.customer_id, si.balance
       FROM sales_invoices si
       WHERE si.status NOT IN ('Void', 'Cancelled') AND (${OPENING_INVOICE_FILTER})`,
    );
    for (const inv of activeInv.rows) {
      const bal = parseFloat(inv.balance) || 0;
      await client.query(
        `UPDATE sales_invoices SET status = 'Void', balance = 0, amount_paid = total, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [inv.id],
      );
      if (inv.customer_id && bal > 0) {
        await client.query(
          'UPDATE customers SET balance = GREATEST(balance - $1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [bal, inv.customer_id],
        );
      }
      summary.ar_invoices_voided++;
    }

    // 2. Void any still-posted opening JEs
    const voidJes = await client.query(
      `UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'Posted' AND ${OPENING_JE_FILTER}
       RETURNING id`,
    );
    summary.journal_entries_voided = voidJes.rowCount || 0;

    // 3. Reverse inventory opening balance import lines
    const invLedger = await client.query(
      `SELECT id, product_id, location_id, quantity
       FROM inventory_ledger
       WHERE reference_type = 'Opening Balance' AND notes = 'Opening balance import'`,
    );
    for (const row of invLedger.rows) {
      const qty = parseFloat(row.quantity) || 0;
      await client.query(
        `UPDATE inventory SET quantity = GREATEST(quantity - $1, 0), updated_at = CURRENT_TIMESTAMP
         WHERE product_id = $2 AND location_id = $3`,
        [qty, row.product_id, row.location_id],
      );
      await client.query('DELETE FROM inventory_ledger WHERE id = $1', [row.id]);
      summary.inventory_lines_reversed++;
    }

    // 4. Hard-delete opening AR invoices and linked records
    const openingInvIds = await client.query(
      `SELECT si.id FROM sales_invoices si WHERE ${OPENING_INVOICE_FILTER}`,
    );
    const invoiceIds = openingInvIds.rows.map((r: { id: string }) => r.id);

    if (invoiceIds.length > 0) {
      await client.query(
        'DELETE FROM collection_receipt_allocations WHERE invoice_id = ANY($1::uuid[])',
        [invoiceIds],
      );
      await client.query(
        'DELETE FROM collection_receipts WHERE invoice_id = ANY($1::uuid[])',
        [invoiceIds],
      );
      await client.query(
        'DELETE FROM sales_returns WHERE invoice_id = ANY($1::uuid[])',
        [invoiceIds],
      );
      await client.query(
        'DELETE FROM sales_memos WHERE invoice_id = ANY($1::uuid[])',
        [invoiceIds],
      );
      await client.query(
        `DELETE FROM journal_entry_lines WHERE entry_id IN (
           SELECT id FROM journal_entries
           WHERE reference_id = ANY($1::uuid[]) AND reference_type IN ('Sales Invoice', 'Opening Balance')
         )`,
        [invoiceIds],
      );
      await client.query(
        `DELETE FROM journal_entries
         WHERE reference_id = ANY($1::uuid[]) AND reference_type IN ('Sales Invoice', 'Opening Balance')`,
        [invoiceIds],
      );
      const delInv = await client.query(
        'DELETE FROM sales_invoices WHERE id = ANY($1::uuid[])',
        [invoiceIds],
      );
      summary.ar_invoices_deleted = delInv.rowCount || 0;
    }

    // 5. Hard-delete remaining opening balance JEs (including voided)
    const jeIds = await client.query(`SELECT id FROM journal_entries WHERE ${OPENING_JE_FILTER}`);
    const entryIds = jeIds.rows.map((r: { id: string }) => r.id);
    if (entryIds.length > 0) {
      await client.query('DELETE FROM journal_entry_lines WHERE entry_id = ANY($1::uuid[])', [entryIds]);
      const delJe = await client.query('DELETE FROM journal_entries WHERE id = ANY($1::uuid[])', [entryIds]);
      summary.journal_entries_deleted = delJe.rowCount || 0;
    }

    // 6. Rebalance customer/supplier balances from real open documents
    const custBal = await client.query(
      `UPDATE customers c SET balance = COALESCE((
         SELECT SUM(si.balance) FROM sales_invoices si
         WHERE si.customer_id = c.id
           AND si.status IN ('Posted', 'Partial', 'Overdue')
           AND si.balance > 0
       ), 0), updated_at = CURRENT_TIMESTAMP`,
    );
    summary.customers_rebalanced = custBal.rowCount || 0;

    const supBal = await client.query(
      `UPDATE suppliers s SET balance = COALESCE((
         SELECT SUM(a.total_amount - COALESCE(a.amount_paid, 0))
         FROM ap_vouchers a
         WHERE a.supplier_id = s.id
           AND a.status IN ('Posted', 'Partially Paid')
           AND a.total_amount > COALESCE(a.amount_paid, 0)
       ), 0), updated_at = CURRENT_TIMESTAMP`,
    );
    summary.suppliers_rebalanced = supBal.rowCount || 0;

    // 7. Remove imported DMC-/BDA- customers with no activity (opening balance / bulk CSV)
    const delCust = await client.query(
      `DELETE FROM customers c
       WHERE (c.customer_code ~ '^BDA-' OR c.customer_code ~ '^DMC-')
         AND c.is_active = false
         AND COALESCE(c.balance, 0) <= 0.009
         AND NOT EXISTS (SELECT 1 FROM sales_invoices si WHERE si.customer_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.customer_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM sales_quotations sq WHERE sq.customer_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM collection_receipts cr WHERE cr.customer_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM pos_transactions pt WHERE pt.customer_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM sales_memos sm WHERE sm.customer_id = c.id)
       RETURNING c.customer_code`,
    );
    summary.placeholder_customers_deleted = delCust.rowCount || 0;

    // 8. Clear tracked customer import undo metadata
    await client.query(
      `DELETE FROM system_settings WHERE setting_key = 'last_customer_import_undo'`,
    );

    await client.query('COMMIT');
    return summary;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

purgeOpeningBalanceData()
  .then((r) => {
    console.log('Opening balance data purged:', r);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
