import { query } from '../config/database';

type DbClient = { query: typeof query };

export interface DuplicateCogsInvoiceRow {
  invoice_id: string;
  invoice_number: string;
  so_id: string | null;
  dn_id: string | null;
  dr_number: string | null;
  si_cogs: number;
  dr_cogs: number;
  duplicate_amount: number;
}

/** Invoices where both Delivery Receipt and Sales Invoice posted COGS (double-count). */
export async function findDuplicateCogsInvoices(db: DbClient = { query }): Promise<DuplicateCogsInvoiceRow[]> {
  const result = await db.query(`
    WITH si_cogs AS (
      SELECT je.reference_id AS invoice_id, ROUND(COALESCE(SUM(jel.debit), 0)::numeric, 2) AS si_cogs
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type = 'Cost of Goods Sold'
      WHERE je.reference_type = 'Sales Invoice' AND je.status = 'Posted'
      GROUP BY je.reference_id
      HAVING COALESCE(SUM(jel.debit), 0) > 0.009
    ),
    dr_cogs_by_so AS (
      SELECT dn.so_id, ROUND(COALESCE(SUM(jel.debit), 0)::numeric, 2) AS dr_cogs,
             MAX(dn.dr_number) AS dr_number
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type = 'Cost of Goods Sold'
      JOIN delivery_notes dn ON dn.id = je.reference_id
      WHERE je.reference_type = 'Delivery Receipt' AND je.status = 'Posted'
      GROUP BY dn.so_id
      HAVING COALESCE(SUM(jel.debit), 0) > 0.009
    ),
    dr_cogs_by_dn AS (
      SELECT dn.id AS dn_id, ROUND(COALESCE(SUM(jel.debit), 0)::numeric, 2) AS dr_cogs,
             MAX(dn.dr_number) AS dr_number
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type = 'Cost of Goods Sold'
      JOIN delivery_notes dn ON dn.id = je.reference_id
      WHERE je.reference_type = 'Delivery Receipt' AND je.status = 'Posted'
      GROUP BY dn.id
      HAVING COALESCE(SUM(jel.debit), 0) > 0.009
    )
    SELECT si.id AS invoice_id, si.invoice_number, si.so_id, si.dn_id,
           COALESCE(dcd.dr_number, dcs.dr_number) AS dr_number,
           sc.si_cogs,
           COALESCE(dcd.dr_cogs, dcs.dr_cogs, 0)::numeric AS dr_cogs,
           LEAST(sc.si_cogs, COALESCE(dcd.dr_cogs, dcs.dr_cogs, 0))::numeric AS duplicate_amount
    FROM sales_invoices si
    JOIN si_cogs sc ON sc.invoice_id = si.id
    LEFT JOIN dr_cogs_by_dn dcd ON dcd.dn_id = si.dn_id
    LEFT JOIN dr_cogs_by_so dcs ON dcs.so_id = si.so_id AND si.dn_id IS NULL
    WHERE COALESCE(dcd.dr_cogs, dcs.dr_cogs, 0) > 0.009
    ORDER BY si.invoice_date DESC, si.invoice_number DESC
  `);
  return result.rows.map((r: any) => ({
    invoice_id: r.invoice_id,
    invoice_number: r.invoice_number,
    so_id: r.so_id,
    dn_id: r.dn_id,
    dr_number: r.dr_number,
    si_cogs: parseFloat(r.si_cogs),
    dr_cogs: parseFloat(r.dr_cogs),
    duplicate_amount: parseFloat(r.duplicate_amount),
  }));
}

/** Remove duplicate SI COGS/inventory lines when DR already expensed COGS; restore wrongly deducted inventory. */
export async function repairDuplicateInvoiceCogs(
  db: DbClient,
  invoiceId: string,
): Promise<{ removed_lines: number; restored_inventory_rows: number }> {
  const dupes = await findDuplicateCogsInvoices(db);
  if (!dupes.some((d) => d.invoice_id === invoiceId)) {
    throw new Error('Invoice is not flagged for duplicate COGS repair');
  }

  const jes = await db.query(
    `SELECT id FROM journal_entries
     WHERE reference_type = 'Sales Invoice' AND reference_id = $1 AND status = 'Posted'
     ORDER BY created_at DESC`,
    [invoiceId],
  );

  let removedLines = 0;
  for (const je of jes.rows) {
    const cogsLines = await db.query(
      `SELECT jel.id FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE jel.entry_id = $1 AND coa.account_code IN ('5110','5111','5112','5113','5114','5000','1200')`,
      [je.id],
    );
    for (const line of cogsLines.rows) {
      await db.query('DELETE FROM journal_entry_lines WHERE id = $1', [line.id]);
      removedLines += 1;
    }
    await db.query(
      `UPDATE journal_entries je
       SET total_debit = agg.line_total, total_credit = agg.line_total, updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT entry_id, ROUND(SUM(debit)::numeric, 2) AS line_total
         FROM journal_entry_lines WHERE entry_id = $1 GROUP BY entry_id
       ) agg
       WHERE je.id = agg.entry_id`,
      [je.id],
    );
  }

  const editLedger = await db.query(
    `SELECT product_id, location_id, quantity FROM inventory_ledger
     WHERE reference_type IN ('Sales Invoice', 'Sales Invoice Edit') AND reference_id = $1`,
    [invoiceId],
  );
  for (const row of editLedger.rows) {
    await db.query(
      'UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3',
      [row.quantity, row.product_id, row.location_id || 1],
    );
  }
  const delLedger = await db.query(
    `DELETE FROM inventory_ledger
     WHERE reference_type IN ('Sales Invoice', 'Sales Invoice Edit') AND reference_id = $1
     RETURNING id`,
    [invoiceId],
  );

  return { removed_lines: removedLines, restored_inventory_rows: delLedger.rowCount || 0 };
}
