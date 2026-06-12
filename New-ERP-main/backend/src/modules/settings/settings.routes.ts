import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';

const router = Router();

router.post('/reset-transactions', authenticate, auditLog('Settings', 'Reset Transactions'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query("SET session_replication_role = 'replica'");

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
      'employee_grocery_credits', 'employee_grocery_credit_items', 'sss_contributions',
    ];

    const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const existingTables = new Set(rows.map((r: any) => r.table_name));
    const tablesToTruncate = transactionTables.filter(t => existingTables.has(t));

    if (tablesToTruncate.length > 0) {
      await client.query(`TRUNCATE TABLE ${tablesToTruncate.map(t => `"${t}"`).join(', ')}`);
    }

    await client.query("SET session_replication_role = 'origin'");

    await client.query('UPDATE inventory SET quantity = 0, reserved_quantity = 0, unit_cost = 0');
    await client.query('UPDATE batches SET quantity = 0');
    await client.query('UPDATE customers SET balance = 0');
    await client.query('UPDATE suppliers SET balance = 0');
    await client.query('UPDATE chart_of_accounts SET balance = 0');
    await client.query('UPDATE bank_accounts SET balance = 0');

    await client.query('COMMIT');
    res.json({ message: 'All transactions reset. Products & master data preserved.' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
