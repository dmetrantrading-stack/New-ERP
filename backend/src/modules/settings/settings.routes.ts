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
      'ap_vouchers', 'ap_voucher_items',
      'production_orders', 'production_order_inputs', 'production_order_outputs',
      'cash_transactions', 'bank_transactions',
      'expenses',
      'attendance', 'payroll', 'payroll_deductions', 'cash_advances',
      'audit_logs', 'notifications',
      'employee_grocery_credits', 'employee_grocery_credit_items', 'sss_contributions',
    ];

    const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const existingTables = new Set(rows.map((r: any) => r.table_name));
    const tablesToTruncate = transactionTables.filter(t => existingTables.has(t));

    if (tablesToTruncate.length > 0) {
      await client.query(`TRUNCATE TABLE ${tablesToTruncate.map(t => `"${t}"`).join(', ')} CASCADE`);
    }

    await client.query('UPDATE inventory SET quantity = 0, reserved_quantity = 0, unit_cost = 0');
    await client.query('UPDATE batches SET quantity = 0');
    await client.query('UPDATE customers SET balance = 0');
    await client.query('UPDATE suppliers SET balance = 0');
    await client.query('UPDATE employees SET cash_advance_balance = 0, grocery_credit_balance = 0');
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

router.get('/business-details', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM business_details WHERE id = 1');
    res.json(r.rows[0] || null);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/business-details', authenticate, auditLog('Settings', 'Update Business Details'), async (req: AuthRequest, res: Response) => {
  try {
    const { business_name, trade_name, address, barangay, city, province, zip_code, mobile_number, telephone_number, email_address, website, tin_number, vat_type, vat_rate, prepared_by, prepared_by_position, approved_by, approved_by_position, currency, date_format, logo_url, printer_name, printer_type, paper_size, auto_print, printer_port } = req.body;
    await query(
      `UPDATE business_details SET business_name=$1, trade_name=$2, address=$3, barangay=$4, city=$5, province=$6, zip_code=$7, mobile_number=$8, telephone_number=$9, email_address=$10, website=$11, tin_number=$12, vat_type=$13, vat_rate=$14, prepared_by=$15, prepared_by_position=$16, approved_by=$17, approved_by_position=$18, currency=$19, date_format=$20, logo_url=$21, printer_name=$22, printer_type=$23, paper_size=$24, auto_print=$25, printer_port=$26, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
      [business_name, trade_name || null, address, barangay || null, city || null, province || null, zip_code || null, mobile_number || null, telephone_number || null, email_address || null, website || null, tin_number, vat_type, vat_rate || 12, prepared_by || null, prepared_by_position || null, approved_by || null, approved_by_position || null, currency || 'PHP', date_format || 'MM/DD/YYYY', logo_url || null, printer_name || 'PT-210', printer_type || 'Bluetooth', paper_size || 58, auto_print || false, printer_port || null]
    );
    const r = await query('SELECT * FROM business_details WHERE id = 1');
    res.json(r.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/reset-products', authenticate, auditLog('Settings', 'Reset Products'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query('TRUNCATE TABLE products CASCADE');

    await client.query('COMMIT');
    res.json({ message: 'All products and related data deleted.' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
