import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, hasUserPerm, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import { fmtCurrency, fmtDate } from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildSupplierMetaRows,
} from '../../utils/salesEnterprisePrint';

const router = Router();

const certView = hasUserPerm('purchases.payment-voucher.view');
const certCreate = hasUserPerm('purchases.payment-voucher.create');

const generateCertNumber = async (): Promise<string> => {
  const yr = new Date().getFullYear();
  const r = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(certificate_number, 10) AS INTEGER)), 0) + 1 as next
     FROM bir_2307_certificates WHERE certificate_number LIKE $1`,
    [`2307-${yr}-%`]
  );
  return `2307-${yr}-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/', authenticate, certView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const cnt = await query('SELECT COUNT(*) FROM bir_2307_certificates');
    const total = parseInt(cnt.rows[0].count);
    const r = await query(
      `SELECT c.*, s.supplier_name
       FROM bir_2307_certificates c
       LEFT JOIN suppliers s ON c.supplier_id = s.id
       ORDER BY c.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ data: r.rows, total, page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, certView, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT c.*, s.supplier_name, s.tin as supplier_tin, s.address as supplier_address
       FROM bir_2307_certificates c
       LEFT JOIN suppliers s ON c.supplier_id = s.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Certificate not found' });
    res.json(r.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/print', authenticate, hasUserPerm('purchases.payment-voucher.print'), async (req: AuthRequest, res: Response) => {
  try {
    const biz = await query('SELECT * FROM business_details LIMIT 1');
    const b = biz.rows[0] || {};
    const r = await query(
      `SELECT c.*, s.supplier_name, s.tin as supplier_tin, s.address as supplier_address
       FROM bir_2307_certificates c
       LEFT JOIN suppliers s ON c.supplier_id = s.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const c = r.rows[0];
    const taxWithheld = parseFloat(c.tax_withheld) || 0;
    res.send(buildSalesEnterpriseDocument({
      pageTitle: `BIR 2307 ${c.certificate_number}`,
      docTitle: 'BIR Form 2307',
      docMetaRows: [
        { label: 'Certificate No.', value: c.certificate_number || '—' },
        { label: 'Period From', value: fmtDate(c.period_from, 'short') },
        { label: 'Period To', value: fmtDate(c.period_to, 'short') },
        { label: 'ATC Code', value: c.atc_code || '—' },
      ],
      partySectionTitle: 'Withholding Agent',
      customerRows: [
        { label: 'Business Name', value: String(b.business_name || '—') },
        { label: 'TIN', value: String(b.tin_number || b.tin || '—') },
      ],
      detailsTitle: 'Payee Information',
      detailsRows: buildSupplierMetaRows({
        name: c.payee_name || c.supplier_name,
        tin: c.payee_tin || c.supplier_tin,
        address: c.supplier_address,
      }),
      skipItemsTable: true,
      summaryRows: [
        { label: 'Income Payment', value: fmtCurrency(c.income_payment) },
        { label: 'Tax Withheld', value: fmtCurrency(taxWithheld), total: true },
      ],
      amountInWords: taxWithheld,
      notes: c.notes ? [{ label: 'Remarks', content: c.notes }] : [],
      footerNote: 'BIR Form 2307 — Certificate of Creditable Tax Withheld at Source.',
      biz: b,
      skipSignatures: true,
      showAmountInWords: false,
    }));
  } catch (error: any) {
    res.status(500).send('<p>Error: ' + error.message + '</p>');
  }
});

router.post('/', authenticate, certCreate, auditLog('Payables', 'Create BIR 2307'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      supplier_id, payee_name, payee_tin, period_from, period_to,
      income_payment, tax_withheld, atc_code, payment_voucher_id, apv_id, notes,
    } = req.body;
    if (!payee_name) throw new AppError('Payee name is required');
    if (!period_from || !period_to) throw new AppError('Period dates are required');

    const certificate_number = await generateCertNumber();
    const id = uuidv4();
    await query(
      `INSERT INTO bir_2307_certificates
       (id, certificate_number, supplier_id, payee_name, payee_tin, period_from, period_to,
        income_payment, tax_withheld, atc_code, payment_voucher_id, apv_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, certificate_number, supplier_id || null, payee_name, payee_tin || null,
        period_from, period_to, parseFloat(income_payment) || 0, parseFloat(tax_withheld) || 0,
        atc_code || null, payment_voucher_id || null, apv_id || null, notes || null, req.user!.id,
      ]
    );
    res.status(201).json({ id, certificate_number });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

export default router;
