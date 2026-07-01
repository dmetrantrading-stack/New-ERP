import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm, hasUserAnyPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { getInvoiceCopyMode, setInvoiceCopyMode, InvoiceCopyMode } from '../../utils/salesSettings';
import { getAccountingLockDate, setAccountingLockDate } from '../../utils/periodLock';
import { runOpeningBalanceImport } from '../../utils/openingBalanceImport';
import { getRegistrationSettings, setRegistrationSettings } from '../../utils/registrationSettings';
import { getLoyaltySettings, loyaltySettingsToApi, setLoyaltySettings } from '../../utils/loyaltySettings';

const router = Router();

const loyaltyView = hasUserAnyPerm(['system.settings.view', 'pos.view', 'pos.write']);

router.get('/loyalty', authenticate, loyaltyView, async (_req: AuthRequest, res: Response) => {
  try {
    res.json(loyaltySettingsToApi(await getLoyaltySettings()));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/loyalty', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Loyalty'), async (req: AuthRequest, res: Response) => {
  try {
    const { enabled, earn_peso_per_point, redeem_peso_per_point } = req.body;
    const payload: {
      enabled?: boolean;
      earn_peso_per_point?: number;
      redeem_peso_per_point?: number;
    } = {};
    if (typeof enabled === 'boolean') payload.enabled = enabled;
    if (earn_peso_per_point != null) {
      const n = parseFloat(String(earn_peso_per_point));
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: 'earn_peso_per_point must be a positive number' });
      }
      payload.earn_peso_per_point = n;
    }
    if (redeem_peso_per_point != null) {
      const n = parseFloat(String(redeem_peso_per_point));
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: 'redeem_peso_per_point must be a positive number' });
      }
      payload.redeem_peso_per_point = n;
    }
    res.json(loyaltySettingsToApi(await setLoyaltySettings(payload)));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/reset-transactions', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Reset Transactions'), async (req: AuthRequest, res: Response) => {
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
      'petty_cash_vouchers',
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

router.put('/business-details', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Business Details'), async (req: AuthRequest, res: Response) => {
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

router.post('/reset-products', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Reset Products'), async (req: AuthRequest, res: Response) => {
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

// Public business info (no auth — used by login page for logo)
router.get('/public', async (req, res: Response) => {
  try {
    const r = await query('SELECT logo_url, business_name FROM business_details WHERE id = 1');
    res.json(r.rows[0] || { logo_url: null, business_name: 'D METRAN TRADING' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Logo upload
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('uploads', 'logos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'logo' + ext);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/gif'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, GIF images allowed') as any);
  },
});

router.post('/upload-logo', authenticate, hasUserPerm('system.settings.edit'), logoUpload.single('logo'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const logoUrl = '/api/settings/logo';
    await query('UPDATE business_details SET logo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [logoUrl]);
    res.json({ logo_url: logoUrl });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Serve logo image (via /api proxy)
router.get('/logo', async (req, res: Response) => {
  try {
    const r = await query('SELECT logo_url FROM business_details WHERE id = 1');
    const url = r.rows[0]?.logo_url;
    if (!url) return res.status(404).end();
    // Extract filename from stored URL path or use default
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'logos');
    const files = fs.readdirSync(dir);
    if (files.length === 0) return res.status(404).end();
    const logoFile = path.join(dir, files[0]);
    const ext = path.extname(files[0]).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/gif';
    res.setHeader('Content-Type', mime);
    res.sendFile(logoFile);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/sales-workflow', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const invoice_copy_mode = await getInvoiceCopyMode();
    res.json({ invoice_copy_mode });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/sales-workflow', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Sales Workflow'), async (req: AuthRequest, res: Response) => {
  try {
    const { invoice_copy_mode } = req.body;
    if (!['ordered', 'delivered'].includes(invoice_copy_mode)) {
      return res.status(400).json({ error: 'invoice_copy_mode must be ordered or delivered' });
    }
    await setInvoiceCopyMode(invoice_copy_mode as InvoiceCopyMode);
    res.json({ invoice_copy_mode });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/purchase-workflow', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'enforce_approval_limits'`);
    res.json({ enforce_approval_limits: r.rows[0]?.setting_value === 'true' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/purchase-workflow', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Purchase Workflow'), async (req: AuthRequest, res: Response) => {
  try {
    const { enforce_approval_limits } = req.body;
    const val = enforce_approval_limits ? 'true' : 'false';
    await query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('enforce_approval_limits', $1)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      [val],
    );
    res.json({ enforce_approval_limits: val === 'true' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/inventory-cost', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await query(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('auto_update_cost_from_rr', 'auto_reprice_on_gr')`);
    const map = Object.fromEntries(r.rows.map((row: any) => [row.setting_key, row.setting_value]));
    res.json({
      auto_update_cost_from_rr: map.auto_update_cost_from_rr === 'true',
      auto_reprice_on_gr: map.auto_reprice_on_gr === 'true',
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/inventory-cost', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Inventory Cost'), async (req: AuthRequest, res: Response) => {
  try {
    const { auto_update_cost_from_rr, auto_reprice_on_gr } = req.body;
    const upsert = async (key: string, val: boolean) => {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        [key, val ? 'true' : 'false'],
      );
    };
    if (typeof auto_update_cost_from_rr === 'boolean') {
      await upsert('auto_update_cost_from_rr', auto_update_cost_from_rr);
    }
    if (typeof auto_reprice_on_gr === 'boolean') {
      await upsert('auto_reprice_on_gr', auto_reprice_on_gr);
    }
    const r = await query(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('auto_update_cost_from_rr', 'auto_reprice_on_gr')`);
    const map = Object.fromEntries(r.rows.map((row: any) => [row.setting_key, row.setting_value]));
    res.json({
      auto_update_cost_from_rr: map.auto_update_cost_from_rr === 'true',
      auto_reprice_on_gr: map.auto_reprice_on_gr === 'true',
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/registration', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getRegistrationSettings());
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/registration', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Registration'), async (req: AuthRequest, res: Response) => {
  try {
    const { enabled, require_approval, default_role } = req.body;
    const payload: Partial<{ enabled: boolean; require_approval: boolean; default_role: string }> = {};
    if (typeof enabled === 'boolean') payload.enabled = enabled;
    if (typeof require_approval === 'boolean') payload.require_approval = require_approval;
    if (typeof default_role === 'string' && default_role.trim()) payload.default_role = default_role.trim();
    res.json(await setRegistrationSettings(payload));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/accounting-lock', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const accounting_lock_date = await getAccountingLockDate();
    res.json({ accounting_lock_date });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/accounting-lock', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Update Period Lock'), async (req: AuthRequest, res: Response) => {
  try {
    const { accounting_lock_date } = req.body;
    if (accounting_lock_date && !/^\d{4}-\d{2}-\d{2}$/.test(accounting_lock_date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD or empty to unlock' });
    }
    await setAccountingLockDate(accounting_lock_date || null);
    res.json({ accounting_lock_date: accounting_lock_date || null });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/import/opening-balances', authenticate, hasUserPerm('system.settings.edit'), auditLog('Settings', 'Import Opening Balances'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, csv, entry_date } = req.body;
    if (!type || !csv) return res.status(400).json({ error: 'type and csv are required' });
    const result = await runOpeningBalanceImport(String(type), String(csv), req.user!.id, entry_date);
    res.json(result);
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

const sigStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join('uploads', 'signatures');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const role = req.params.role || 'sig';
    cb(null, `${role}${path.extname(file.originalname)}`);
  },
});

const sigUpload = multer({
  storage: sigStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, GIF, WEBP images allowed') as any);
  },
});

router.post('/upload-signature/:role', authenticate, hasUserPerm('system.settings.edit'), sigUpload.single('signature'), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.params.role;
    if (!['prepared', 'approved'].includes(role)) return res.status(400).json({ error: 'role must be prepared or approved' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const col = role === 'prepared' ? 'prepared_by_signature_url' : 'approved_by_signature_url';
    const url = `/api/settings/signature/${role}`;
    await query(`UPDATE business_details SET ${col} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, [url]);
    res.json({ signature_url: url });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/signature/:role', async (req, res: Response) => {
  try {
    const role = req.params.role;
    if (!['prepared', 'approved'].includes(role)) return res.status(404).end();
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'signatures');
    if (!fs.existsSync(dir)) return res.status(404).end();
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(role));
    if (files.length === 0) return res.status(404).end();
    const file = path.join(dir, files[0]);
    const ext = path.extname(files[0]).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.sendFile(file);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
