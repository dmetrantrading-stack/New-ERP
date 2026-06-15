import { query, getClient } from '../config/database';

const reset = async () => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // All transaction tables to truncate (order doesn't matter when done together)
    const transactionTables = [
      'inventory_ledger', 'inventory_counts', 'inventory_count_items',
      'purchase_requisitions', 'purchase_requisition_items',
      'purchase_orders', 'purchase_order_items',
      'goods_receipts', 'goods_receipt_items',
      'purchase_returns',
      'stock_transfers', 'stock_transfer_items',
      'sales_quotations', 'sales_orders', 'delivery_notes',
      'sales_invoices', 'sales_invoice_items', 'sales_returns',
      'pos_shifts', 'pos_transactions', 'pos_transaction_items', 'suspended_sales',
      'journal_entries', 'journal_entry_lines',
      'collection_receipts', 'payment_vouchers',
      'cash_transactions', 'bank_transactions',
      'expenses',
      'attendance', 'payroll', 'payroll_deductions', 'cash_advances',
      'audit_logs',
    ];

    // Get list of tables that actually exist in the database
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const existingTables = new Set(rows.map((r: any) => r.table_name));

    // Filter to only existing transaction tables
    const tablesToTruncate = transactionTables.filter(t => existingTables.has(t));
    const skipped = transactionTables.filter(t => !existingTables.has(t));

    if (skipped.length > 0) {
      console.log(`Skipping (not found): ${skipped.join(', ')}`);
    }

    if (tablesToTruncate.length > 0) {
      console.log('Disabling foreign key checks...');
      await client.query("SET session_replication_role = 'replica'");

      // Truncate all at once to avoid FK dependency issues
      console.log(`Truncating ${tablesToTruncate.length} transaction tables...`);
      await client.query(`TRUNCATE TABLE ${tablesToTruncate.map(t => `"${t}"`).join(', ')}`);

      await client.query("SET session_replication_role = 'origin'");
    }

    // ==================== RESET INVENTORY QUANTITIES ====================
    console.log('Resetting inventory quantities to 0...');
    await client.query(`UPDATE inventory SET quantity = 0, reserved_quantity = 0, unit_cost = 0`);

    // ==================== RESET BATCH QUANTITIES ====================
    console.log('Resetting batch quantities to 0...');
    await client.query(`UPDATE batches SET quantity = 0`);

    // ==================== RESET CUSTOMER & SUPPLIER BALANCES ====================
    console.log('Resetting customer and supplier balances...');
    await client.query(`UPDATE customers SET balance = 0`);
    await client.query(`UPDATE suppliers SET balance = 0`);

    // ==================== RESET COA BALANCES ====================
    console.log('Resetting chart of accounts balances...');
    await client.query(`UPDATE chart_of_accounts SET balance = 0`);

    // ==================== RESET BANK ACCOUNT BALANCES ====================
    console.log('Resetting bank account balances...');
    await client.query(`UPDATE bank_accounts SET balance = 0`);

    await client.query('COMMIT');
    console.log('\nDone. All transactions reset. Products & master data preserved.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

reset()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
