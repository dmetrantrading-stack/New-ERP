import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, hasUserPerm, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { assertPeriodNotLocked } from '../../utils/periodLock';
import { v4 as uuidv4 } from 'uuid';
import {
  buildSalesEnterpriseDocument,
  buildCustomerMetaRows,
  buildEnterpriseTwoPartySignatures,
} from '../../utils/salesEnterprisePrint';
import { fmtCurrency, fmtDate } from '../../utils/printLayout';

const router = Router();

const memoView = hasUserPerm('sales.sales-invoice.view');
const memoCreate = hasUserPerm('sales.sales-invoice.create');

const generateMemoNumber = async (prefix: string): Promise<string> => {
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(memo_number, ${prefix.length + 2}) AS INTEGER)), 0) + 1 as next
     FROM sales_memos WHERE memo_number ~ $1`,
    [`^${prefix}-`]
  );
  return `${prefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const generateJeNumber = async (): Promise<string> => {
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next
     FROM journal_entries WHERE entry_number ~ '^JE-'`
  );
  return `JE-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/', authenticate, memoView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const cnt = await query('SELECT COUNT(*) FROM sales_memos');
    const total = parseInt(cnt.rows[0].count);
    const r = await query(
      `SELECT sm.*, c.customer_name, si.invoice_number
       FROM sales_memos sm
       LEFT JOIN customers c ON sm.customer_id = c.id
       LEFT JOIN sales_invoices si ON sm.invoice_id = si.id
       ORDER BY sm.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ data: r.rows, total, page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, memoView, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT sm.*, c.customer_name, si.invoice_number
       FROM sales_memos sm
       LEFT JOIN customers c ON sm.customer_id = c.id
       LEFT JOIN sales_invoices si ON sm.invoice_id = si.id
       WHERE sm.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Memo not found' });
    res.json(r.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/print', authenticate, hasUserPerm('sales.sales-invoice.print'), async (req: AuthRequest, res: Response) => {
  try {
    const biz = await query('SELECT * FROM business_details LIMIT 1');
    const b = biz.rows[0] || {};
    const r = await query(
      `SELECT sm.*, c.customer_name, c.address as customer_address, si.invoice_number
       FROM sales_memos sm
       LEFT JOIN customers c ON sm.customer_id = c.id
       LEFT JOIN sales_invoices si ON sm.invoice_id = si.id
       WHERE sm.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];
    const title = d.memo_type === 'Credit' ? 'Credit Memo' : 'Debit Memo';
    const html = buildSalesEnterpriseDocument({
      pageTitle: `${title} ${d.memo_number}`,
      docTitle: title,
      docMetaRows: [
        { label: 'Memo No.', value: d.memo_number || '—' },
        { label: 'Memo Date', value: fmtDate(d.memo_date, 'short') },
        { label: 'Memo Type', value: d.memo_type || '—' },
        { label: 'Status', value: 'POSTED' },
      ],
      customerRows: buildCustomerMetaRows({ name: d.customer_name, address: d.customer_address }),
      detailsRows: [
        { label: 'Invoice Reference', value: d.invoice_number || '—' },
        ...(d.reason ? [{ label: 'Reason', value: d.reason }] : []),
        { label: 'Currency', value: String(b.currency || 'PHP') },
      ],
      skipItemsTable: true,
      summaryRows: [{ label: 'Amount', value: fmtCurrency(d.amount), total: true }],
      notes: d.notes ? [{ label: 'Remarks', content: d.notes }] : [],
      footerNote: `${title} — for accounts receivable adjustment reference.`,
      biz: b,
      signatures: buildEnterpriseTwoPartySignatures(b),
      signatureCols: 2,
    });
    res.send(html);
  } catch (error: any) {
    res.status(500).send('<p>Error: ' + error.message + '</p>');
  }
});

router.post('/', authenticate, memoCreate, auditLog('Sales', 'Create Sales Memo'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    const { memo_type, customer_id, invoice_id, amount, reason, notes, memo_date } = req.body;
    if (!['Credit', 'Debit'].includes(memo_type)) throw new AppError('memo_type must be Credit or Debit');
    if (!customer_id) throw new AppError('Customer is required');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) throw new AppError('Amount must be greater than zero');
    const docDate = memo_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(docDate);

    await client.query('BEGIN');
    const prefix = memo_type === 'Credit' ? 'SCM' : 'SDM';
    const memo_number = await generateMemoNumber(prefix);
    const id = uuidv4();

    await client.query(
      `INSERT INTO sales_memos (id, memo_number, memo_type, customer_id, invoice_id, memo_date, amount, reason, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, memo_number, memo_type, customer_id, invoice_id || null, docDate, amt, reason || null, notes || null, req.user!.id]
    );

    if (memo_type === 'Credit') {
      await client.query('UPDATE customers SET balance = GREATEST(balance - $1, 0) WHERE id = $2', [amt, customer_id]);
      if (invoice_id) {
        await client.query(
          'UPDATE sales_invoices SET balance = GREATEST(balance - $1, 0) WHERE id = $2',
          [amt, invoice_id]
        );
      }
    } else {
      await client.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [amt, customer_id]);
      if (invoice_id) {
        await client.query('UPDATE sales_invoices SET balance = balance + $1, total = total + $1 WHERE id = $2', [amt, invoice_id]);
      }
    }

    const netRevenue = amt / 1.12;
    const vatAmount = amt - netRevenue;
    const entryId = uuidv4();
    const entryNumber = await generateJeNumber();

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, $3, 'Sales Memo', $4, $5, $6, $6, $7)`,
      [entryId, entryNumber, docDate, id, `${memo_type} Memo ${memo_number}`, amt, req.user!.id]
    );

    if (memo_type === 'Credit') {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), $3, $4, 0, 'Sales Memo', $5)`,
        [uuidv4(), entryId, `Revenue adjustment ${memo_number}`, netRevenue, id]
      );
      if (vatAmount > 0.01) {
        await client.query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, $4, 0, 'Sales Memo', $5)`,
          [uuidv4(), entryId, `VAT adjustment ${memo_number}`, vatAmount, id]
        );
      }
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1100'), $3, 0, $4, 'Sales Memo', $5)`,
        [uuidv4(), entryId, `AR credit ${memo_number}`, amt, id]
      );
    } else {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1100'), $3, $4, 0, 'Sales Memo', $5)`,
        [uuidv4(), entryId, `AR debit ${memo_number}`, amt, id]
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), $3, 0, $4, 'Sales Memo', $5)`,
        [uuidv4(), entryId, `Revenue ${memo_number}`, netRevenue, id]
      );
      if (vatAmount > 0.01) {
        await client.query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, 0, $4, 'Sales Memo', $5)`,
          [uuidv4(), entryId, `VAT ${memo_number}`, vatAmount, id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id, memo_number, amount: amt });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
