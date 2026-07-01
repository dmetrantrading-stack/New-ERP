import { Router, Response } from 'express';
import { getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { auditAfter } from '../../utils/auditHelpers';
import { findDuplicateCogsInvoices, repairDuplicateInvoiceCogs } from '../../utils/glIntegrity';
import { auditCategoryGlMapping } from '../../utils/categoryGlHealth';
import {
  findMisclassifiedPosCategoryGl,
  repairPosCategoryGl,
} from '../../utils/posCategoryGlRepair';

const router = Router();

/** Ping — confirms GL integrity routes are loaded (no auth, for deploy checks). */
router.get('/ping', (_req, res) => {
  res.json({ ok: true, module: 'gl-integrity' });
});

router.get('/duplicate-cogs', authenticate, hasUserPerm('finance.accounting.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await findDuplicateCogsInvoices();
    const totalDuplicate = rows.reduce((s, r) => s + r.duplicate_amount, 0);
    res.json({
      issue_count: rows.length,
      total_duplicate_cogs: Math.round(totalDuplicate * 100) / 100,
      rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/repair-duplicate-cogs/:invoiceId', authenticate, hasUserPerm('finance.accounting.edit'), auditLog('Accounting', 'Repair Duplicate COGS'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await repairDuplicateInvoiceCogs(client, req.params.invoiceId);
    await client.query('COMMIT');
    auditAfter(req, { invoice_id: req.params.invoiceId, ...result });
    res.json({ message: 'Duplicate COGS repaired', ...result });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/category-gl-mapping', authenticate, hasUserPerm('finance.accounting.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const report = await auditCategoryGlMapping();
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pos-category-gl', authenticate, hasUserPerm('finance.accounting.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await findMisclassifiedPosCategoryGl();
    res.json({ issue_count: rows.length, rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/repair-pos-category-gl/:transactionId', authenticate, hasUserPerm('finance.accounting.edit'), auditLog('Accounting', 'Repair POS Category GL'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await repairPosCategoryGl(client, req.params.transactionId);
    await client.query('COMMIT');
    auditAfter(req, result);
    res.json({ message: 'POS sale reclassified to category GL accounts', ...result });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/repair-all-pos-category-gl', authenticate, hasUserPerm('finance.accounting.edit'), auditLog('Accounting', 'Repair All POS Category GL'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const rows = await findMisclassifiedPosCategoryGl(client);
    const repaired: string[] = [];
    for (const row of rows) {
      await repairPosCategoryGl(client, row.transaction_id);
      repaired.push(row.transaction_number);
    }
    await client.query('COMMIT');
    auditAfter(req, { repaired_count: repaired.length, transaction_numbers: repaired });
    res.json({ message: `Reclassified ${repaired.length} POS sale(s)`, repaired_count: repaired.length, transaction_numbers: repaired });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
