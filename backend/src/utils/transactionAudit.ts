import { query } from '../config/database';

type AuditSourceConfig = {
  label: string;
  table: string;
  docColumn: string;
  dateColumn: string;
  amountColumn: string;
  amountSql?: string;
  statusFilter: string;
  journalReferenceType: string;
  /** When false, documents with zero amount are not flagged as missing a JE. */
  requireJournalWhenZeroAmount?: boolean;
};

const AUDIT_SOURCES: AuditSourceConfig[] = [
  { label: 'Sales Invoice', table: 'sales_invoices', docColumn: 'invoice_number', dateColumn: 'invoice_date', amountColumn: 'total', statusFilter: "d.status IN ('Posted','Partial','Overdue','Paid')", journalReferenceType: 'Sales Invoice' },
  { label: 'POS Sale', table: 'pos_transactions', docColumn: 'transaction_number', dateColumn: 'created_at', amountColumn: 'total', statusFilter: "d.status = 'Completed'", journalReferenceType: 'POS Sale' },
  { label: 'Collection Receipt', table: 'collection_receipts', docColumn: 'receipt_number', dateColumn: 'payment_date', amountColumn: 'amount', statusFilter: "d.status = 'Posted'", journalReferenceType: 'Collection' },
  { label: 'Payment Voucher', table: 'payment_vouchers', docColumn: 'voucher_number', dateColumn: 'payment_date', amountColumn: 'amount', statusFilter: "d.status = 'Posted'", journalReferenceType: 'Payment Voucher' },
  { label: 'AP Voucher', table: 'ap_vouchers', docColumn: 'apv_number', dateColumn: 'apv_date', amountColumn: 'total_amount', statusFilter: "d.status IN ('Posted','Partially Paid','Fully Paid')", journalReferenceType: 'AP Voucher' },
  {
    label: 'Goods Receipt',
    table: 'goods_receipts',
    docColumn: 'gr_number',
    dateColumn: 'received_date',
    amountColumn: 'total',
    amountSql: `(SELECT COALESCE(SUM(gri.total_cost), 0) FROM goods_receipt_items gri WHERE gri.gr_id = d.id)`,
    statusFilter: "d.status = 'Completed'",
    journalReferenceType: 'Goods Receipt',
  },
  {
    label: 'Purchase Return',
    table: 'purchase_returns',
    docColumn: 'pr_number',
    dateColumn: 'return_date',
    amountColumn: 'total',
    statusFilter: "d.status = 'Completed'",
    journalReferenceType: 'Purchase Return',
  },
  {
    label: 'Sales Return',
    table: 'sales_returns',
    docColumn: 'return_number',
    dateColumn: 'return_date',
    amountColumn: 'total',
    statusFilter: "d.status = 'Completed'",
    journalReferenceType: 'Sales Return',
  },
  { label: 'Expense', table: 'expenses', docColumn: 'expense_number', dateColumn: 'expense_date', amountColumn: 'amount', statusFilter: "d.status = 'Posted'", journalReferenceType: 'Expense' },
  { label: 'Petty Cash Voucher', table: 'petty_cash_vouchers', docColumn: 'pcv_number', dateColumn: 'voucher_date', amountColumn: 'amount', statusFilter: "d.status != 'Cancelled'", journalReferenceType: 'Petty Cash' },
  {
    label: 'Delivery Receipt',
    table: 'delivery_notes',
    docColumn: 'dr_number',
    dateColumn: 'delivery_date',
    amountColumn: 'total',
    amountSql: `(SELECT COALESCE(SUM(dni.total), 0) FROM delivery_note_items dni WHERE dni.note_id = d.id)`,
    statusFilter: "d.status = 'Posted'",
    journalReferenceType: 'Delivery Receipt',
  },
  {
    label: 'Inventory Count',
    table: 'inventory_counts',
    docColumn: 'count_number',
    dateColumn: 'posted_at',
    amountColumn: 'total_variance',
    amountSql: `(SELECT COALESCE(SUM(ABS((ici.actual_qty - ici.system_qty) * ici.unit_cost)), 0) FROM inventory_count_items ici WHERE ici.count_id = d.id)`,
    statusFilter: "d.status = 'Posted'",
    journalReferenceType: 'Inventory Count',
    requireJournalWhenZeroAmount: false,
  },
  { label: 'Payroll', table: 'payroll', docColumn: 'payroll_number', dateColumn: 'pay_period_end', amountColumn: 'net_pay', statusFilter: "d.status IN ('Posted','Paid')", journalReferenceType: 'Payroll' },
  { label: 'Cash In', table: 'cash_transactions', docColumn: 'transaction_number', dateColumn: 'created_at', amountColumn: 'amount', statusFilter: "d.transaction_type = 'Cash In' AND COALESCE(d.status,'') != 'Void'", journalReferenceType: 'Cash In' },
  { label: 'Cash Out', table: 'cash_transactions', docColumn: 'transaction_number', dateColumn: 'created_at', amountColumn: 'amount', statusFilter: "d.transaction_type = 'Cash Out' AND COALESCE(d.status,'') != 'Void'", journalReferenceType: 'Cash Out' },
  { label: 'Bank Deposit', table: 'bank_transactions', docColumn: 'id', dateColumn: 'transaction_date', amountColumn: 'amount', statusFilter: "d.transaction_type = 'Deposit'", journalReferenceType: 'Bank Deposit' },
  { label: 'Bank Withdrawal', table: 'bank_transactions', docColumn: 'id', dateColumn: 'transaction_date', amountColumn: 'amount', statusFilter: "d.transaction_type = 'Withdrawal'", journalReferenceType: 'Bank Withdrawal' },
];

async function auditSource(source: AuditSourceConfig, from?: string, to?: string) {
  let dateFilter = '';
  const params: any[] = [source.journalReferenceType];
  let paramIndex = 2;

  if (from) {
    dateFilter += ` AND d.${source.dateColumn}::date >= $${paramIndex}`;
    params.push(from);
    paramIndex++;
  }
  if (to) {
    dateFilter += ` AND d.${source.dateColumn}::date <= $${paramIndex}`;
    params.push(to);
    paramIndex++;
  }

  const amountExpr = source.amountSql
    ? source.amountSql
    : source.docColumn === 'id'
      ? 'd.amount'
      : `d.${source.amountColumn}`;

  const docExpr = source.docColumn === 'id'
    ? `'BT-' || SUBSTRING(d.id::text, 1, 8)`
    : `d.${source.docColumn}`;

  const rows = await query(
    `SELECT d.id, ${docExpr} AS document_number, d.${source.dateColumn} AS document_date,
            ${amountExpr} AS amount,
            EXISTS (
              SELECT 1 FROM journal_entries je
              WHERE je.reference_type = $1 AND je.reference_id = d.id AND je.status = 'Posted'
            ) AS has_journal
     FROM ${source.table} d
     WHERE ${source.statusFilter}${dateFilter}
     ORDER BY d.${source.dateColumn} DESC
     LIMIT 500`,
    params,
  );

  const isJournalOk = (r: { has_journal: boolean; amount?: string | number }) => {
    if (r.has_journal) return true;
    if (source.requireJournalWhenZeroAmount === false && Math.abs(parseFloat(String(r.amount || 0))) <= 0.009) return true;
    return false;
  };

  const missing = rows.rows
    .filter((r) => !isJournalOk(r))
    .map((r) => ({
      id: r.id,
      document_number: r.document_number,
      document_date: r.document_date,
      amount: parseFloat(r.amount || 0),
    }));

  return {
    document_type: source.label,
    journal_reference_type: source.journalReferenceType,
    total: rows.rows.length,
    with_journal: rows.rows.filter((r) => isJournalOk(r)).length,
    missing_journal: missing.length,
    missing: missing.slice(0, 25),
  };
}

export async function runTransactionAudit(from?: string, to?: string) {
  const by_type = [];
  for (const source of AUDIT_SOURCES) {
    by_type.push(await auditSource(source, from, to));
  }

  let unbalancedWhere = "je.status = 'Posted'";
  const unbalancedParams: any[] = [];
  if (from) { unbalancedWhere += ' AND je.entry_date >= $1'; unbalancedParams.push(from); }
  if (to) { unbalancedWhere += ` AND je.entry_date <= $${unbalancedParams.length + 1}`; unbalancedParams.push(to); }

  const unbalancedFixed = await query(
    `SELECT je.id, je.entry_number, je.reference_type, je.reference_id, je.description,
            je.total_debit, je.total_credit,
            ABS(je.total_debit - je.total_credit) AS difference
     FROM journal_entries je
     WHERE ${unbalancedWhere}
       AND ABS(je.total_debit - je.total_credit) > 0.009
     ORDER BY je.entry_date DESC
     LIMIT 50`,
    unbalancedParams,
  );

  let orphanedWhere = "je.status = 'Posted' AND je.reference_id IS NOT NULL";
  const orphanedParams: any[] = [];
  if (from) { orphanedWhere += ' AND je.entry_date >= $1'; orphanedParams.push(from); }
  if (to) { orphanedWhere += ` AND je.entry_date <= $${orphanedParams.length + 1}`; orphanedParams.push(to); }

  const orphaned = await query(
    `SELECT je.entry_number, je.entry_date, je.reference_type, je.reference_id, je.description, je.total_debit
     FROM journal_entries je
     WHERE ${orphanedWhere}
       AND NOT EXISTS (
         SELECT 1 FROM sales_invoices si WHERE je.reference_type = 'Sales Invoice' AND si.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM pos_transactions pt WHERE je.reference_type IN ('POS Sale','Void POS') AND pt.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM collection_receipts cr WHERE je.reference_type = 'Collection' AND cr.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM payment_vouchers pv WHERE je.reference_type = 'Payment Voucher' AND pv.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM ap_vouchers av WHERE je.reference_type = 'AP Voucher' AND av.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM goods_receipts gr WHERE je.reference_type = 'Goods Receipt' AND gr.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM purchase_returns pr WHERE je.reference_type = 'Purchase Return' AND pr.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM sales_returns sr WHERE je.reference_type = 'Sales Return' AND sr.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM expenses e WHERE je.reference_type = 'Expense' AND e.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM petty_cash_vouchers pcv WHERE je.reference_type = 'Petty Cash' AND pcv.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM delivery_notes dn WHERE je.reference_type = 'Delivery Receipt' AND dn.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM inventory_counts ic WHERE je.reference_type = 'Inventory Count' AND ic.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM inventory_ledger il WHERE je.reference_type = 'Inventory Adjustment' AND il.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM cash_transactions ct WHERE je.reference_type IN ('Cash In','Cash Out','Petty Cash') AND ct.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM bank_transactions bt WHERE je.reference_type IN ('Bank Deposit','Bank Withdrawal') AND bt.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM payroll p WHERE je.reference_type IN ('Payroll','Payroll Payment','Payroll Cancel') AND p.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM pos_shifts ps WHERE je.reference_type IN ('POS Shift Close','POS Shift Open') AND ps.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM cash_advances ca WHERE je.reference_type IN ('Cash Advance','Cash Advance Cancel') AND ca.id = je.reference_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM sss_contributions sc WHERE je.reference_type IN ('SSS Contribution','SSS Payment') AND sc.id = je.reference_id
       )
       AND je.reference_type NOT IN ('Bank Transfer','Manual Entry')
     ORDER BY je.entry_date DESC
     LIMIT 50`,
    orphanedParams,
  );

  const totalDocuments = by_type.reduce((s, t) => s + t.total, 0);
  const withJournal = by_type.reduce((s, t) => s + t.with_journal, 0);
  const missingJournal = by_type.reduce((s, t) => s + t.missing_journal, 0);

  return {
    summary: {
      total_documents: totalDocuments,
      with_journal: withJournal,
      missing_journal: missingJournal,
      unbalanced_entries: unbalancedFixed.rows.length,
      orphaned_journals: orphaned.rows.length,
    },
    by_type,
    unbalanced: unbalancedFixed.rows,
    orphaned_journals: orphaned.rows,
    notes: [
      'Documents without journal entries may pre-date fixes or be non-posting types (e.g. POS shift opening cash).',
      'Sales Quotation, Sales Order, and Purchase Order do not post to GL until invoiced/received.',
      'Stock transfers between locations do not create journal entries (inventory value unchanged).',
      'Inventory counts with zero variance do not require a journal entry.',
      'Goods receipts and purchase/sales returns use status Completed (not Posted).',
    ],
  };
}
