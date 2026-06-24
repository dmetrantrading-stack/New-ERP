import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import { calculateInvoiceItems, resolveInvoiceEwtRate } from '../../utils/invoiceTax';
import {
  aggregateByAccountCode,
  aggregateGlCogsByAccountCode,
  insertCogsInventoryLines,
  insertCogsInventoryReversalLines,
  insertRevenueCreditLines,
  insertRevenueDebitLines,
  invoiceLineNetRevenue,
  loadCategoryAccountsForProducts,
  storedInvoiceItemNetRevenue,
  sumLineGlCogs,
  invoiceHadCogsRecognized,
  shouldSkipInvoiceInventoryCogs,
} from '../../utils/categoryGlPosting';
import { deductInventoryFefo } from '../../utils/batchFefo';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../../utils/auditHelpers';
import { AppError } from '../../middleware/errorHandler';
import { assertPeriodNotLocked } from '../../utils/periodLock';
import {
  tableRow, renderEnterpriseNotesBlock, renderEnterpriseSectionTitle,
  renderEnterpriseAgingRow, renderEnterpriseTotalBanner, fmtCurrency, fmtDate,
} from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildCustomerMetaRows,
  buildEnterpriseTwoPartySignatures,
  buildBillingStatementSignatures,
  buildBillingStatementSummaryRows,
  computeBillingStatementTotals,
  SALES_LINE_ITEM_HEADERS,
} from '../../utils/salesEnterprisePrint';

const router = Router();

const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-[0-9]+$'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const generateInvoiceNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `SI-${year}-`;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number, ${prefix.length + 1}) AS INTEGER)), 0) + 1 as next
     FROM sales_invoices WHERE invoice_number LIKE $1`,
    [`${prefix}%`]
  );
  return `${prefix}${String(result.rows[0]?.next || 1).padStart(6, '0')}`;
};

// ==================== SALES INVOICES (Multi-Tax-Type Engine) ====================
router.post('/invoices', authenticate, hasUserPerm('sales.sales-invoice.create'), auditLog('Sales', 'Create Invoice'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPeriodNotLocked(new Date().toISOString().slice(0, 10));
    const invoice_number = await generateInvoiceNumber();
    const {
      customer_id, customer_name, customer_type, employee_id, price_mode, items, discount,
      payment_method, payment_terms, amount_tendered, due_date, notes, terms_conditions, invoice_tax_type, ewt_rate,
      so_id, skip_inventory, dn_id
    } = req.body;
    const ewtPercent = parseFloat(ewt_rate || '0');
    const isEmployee = customer_type === 'Employee';
    const effectivePaymentMethod = isEmployee ? 'Salary Deduction' : (payment_method || 'Cash');

    const id = uuidv4();
    const { lines: invoiceItems, totals } = calculateInvoiceItems(items || [], ewtPercent, invoice_tax_type || 'VAT');
    const {
      subtotal, totalDiscount, totalVat, totalLguTax, totalWht,
      totalVatableSales, totalVatExemptSales, totalZeroRatedSales, netRevenue,
    } = totals;
    const discountAmount = parseFloat(discount || 0);
    const finalTotal = subtotal - totalDiscount - discountAmount;
    const amountDue = finalTotal - totalLguTax;
    const skipInvOps = await shouldSkipInvoiceInventoryCogs(
      { query },
      { skip_inventory: !!skip_inventory, dn_id: dn_id || null, so_id: so_id || null },
    );

    await query(
       `INSERT INTO sales_invoices (id, invoice_number, customer_id, customer_name, customer_type, employee_id, price_mode, invoice_date,
         due_date, payment_method, payment_terms, status, notes, terms_conditions, subtotal, discount, tax, tax_type, total, amount_paid, balance,
         vatable_sales, vat_exempt_sales, zero_rated_sales, vat_amount, lgu_final_tax, withholding_tax, ewt_rate, so_id, dn_id,
         cashier_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, $9, $10, 'Posted', $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
      [id, invoice_number, isEmployee ? null : customer_id, customer_name, customer_type || 'Customer', isEmployee ? employee_id : null,
        price_mode || 'Retail', due_date, effectivePaymentMethod, payment_terms,
        notes, terms_conditions || null, subtotal, discountAmount, totalVat, invoice_tax_type || 'VAT',
        finalTotal, amount_tendered || 0, finalTotal - (amount_tendered || 0),
        totalVatableSales, totalVatExemptSales, totalZeroRatedSales, totalVat, totalLguTax, totalWht, ewtPercent, so_id || null, dn_id || null,
        req.user!.id, req.user!.id]
    );

    for (const item of invoiceItems) {
      const itemId = uuidv4();
      const locId = item.location_id || 1;

      // Get cost from inventory (always, even when skipping deduction)
      const inv = await query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, locId]);
      let cost = 0;
      let availableQty = 0;
      if (inv.rows.length > 0) {
        cost = parseFloat(inv.rows[0].unit_cost);
        availableQty = parseFloat(inv.rows[0].quantity);
      }

      if (!skipInvOps) {
        if (inv.rows.length > 0 && item.quantity > availableQty) {
          return res.status(400).json({ error: `Insufficient stock at selected location. Available: ${availableQty}, Requested: ${item.quantity}` });
        }
        if (inv.rows.length === 0) {
          const setting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
          if (setting.rows[0]?.setting_value !== 'true') {
            return res.status(400).json({ error: `No stock found at selected location.` });
          }
        }
        const fefo = await deductInventoryFefo({ query }, {
          product_id: item.product_id,
          location_id: locId,
          quantity: item.quantity,
          reference_type: 'Sales Invoice',
          reference_id: id,
          created_by: req.user!.id,
        });
        cost = fefo.unitCost;
        availableQty = fefo.runningQuantity;
      }

      item.cost = cost;
      await query(
        `INSERT INTO sales_invoice_items (id, invoice_id, product_id, variant_id, description, quantity, unit_price, discount, tax, total, cost, location_id, tax_type, vat_amount, selected_variant)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [itemId, id, item.product_id, item.variant_id, item.description, item.quantity, item.unit_price,
         item.discount || 0, item.tax_amount || 0, item.total, cost, locId, item.tax_type || 'VAT', item.tax_amount || 0, item.selected_variant || null]
      );

    }

    if (isEmployee && employee_id) {
      await query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance + $1 WHERE id = $2', [amountDue, employee_id]);
    } else if (customer_id) {
      await query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [amountDue - (amount_tendered || 0), customer_id]);
    }

    // ==== ACCOUNTING ENTRIES ====
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const totalCogs = invoiceItems.reduce((sum: number, i: any) => sum + (i.quantity * parseFloat(i.cost || 0)), 0);
    const cogsGlLines = invoiceItems.map((item: any) => ({
      product_id: item.product_id,
      cogsGrossAmount: item.quantity * parseFloat(item.cost || 0),
      tax_type: item.tax_type,
    }));
    const glCogs = !skipInvOps && totalCogs > 0 ? sumLineGlCogs(cogsGlLines) : 0;
    const jeTotal = amountDue + glCogs;
    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Sales Invoice', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `Sales Invoice ${invoice_number}`, jeTotal, req.user!.id]
    );

    // Debit Cash / AR (or Employee Grocery Receivable)
    const isFullyPaid = amount_tendered && parseFloat(amount_tendered) >= amountDue;
    if (isEmployee) {
      // Employee: Debit Employee Grocery Receivable (1120)
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1120'), $3, $4, 0, 'Sales Invoice', $5)`,
        [uuidv4(), entryId, `Employee Credit ${invoice_number}`, amountDue, id]);
    } else if (isFullyPaid) {
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), $3, $4, 0, 'Sales Invoice', $5)`,
        [uuidv4(), entryId, `Cash ${invoice_number}`, amountDue, id]);
      // Cash transaction
      await query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Cash In', $3, 'Sales Invoice', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), amountDue, id,
         `Sales Invoice ${invoice_number}`, req.user!.id]
      );
    } else {
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1100'), $3, $4, 0, 'Sales Invoice', $5)`,
        [uuidv4(), entryId, `AR ${invoice_number}`, amountDue - (amount_tendered || 0), id]);
      if (amount_tendered && parseFloat(amount_tendered) > 0) {
        await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
          VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), $3, $4, 0, 'Sales Invoice', $5)`,
          [uuidv4(), entryId, `Cash ${invoice_number}`, amount_tendered, id]);
        // Cash transaction for partial payment
        await query(
          `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
           VALUES ($1, $2, 'Cash In', $3, 'Sales Invoice', $4, $5, $6)`,
          [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), amount_tendered, id,
           `Partial payment for invoice ${invoice_number}`, req.user!.id]
        );
      }
    }

    // Credit Sales Revenue (by product category)
    const categoryMap = await loadCategoryAccountsForProducts(
      { query },
      invoiceItems.map((item: any) => item.product_id),
    );
    const revenueBuckets = aggregateByAccountCode(
      invoiceItems.map((item: any) => ({
        product_id: item.product_id,
        revenueAmount: invoiceLineNetRevenue(item),
      })),
      categoryMap,
      'revenue_account_code',
      'revenueAmount',
    );
    await insertRevenueCreditLines({ query }, entryId, revenueBuckets, 'Sales Invoice', id, `Revenue ${invoice_number}`);

    // Credit VAT Payable (12%)
    if (totalVat > 0) {
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, 0, $4, 'Sales Invoice', $5)`,
        [uuidv4(), entryId, `VAT ${invoice_number}`, totalVat, id]);
    }

    // LGU Final Tax - net against revenue (already excluded from amount due)
    if (totalLguTax > 0) {
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2110'), $3, 0, $4, 'Sales Invoice', $5)`,
        [uuidv4(), entryId, `LGU Final VAT ${invoice_number}`, totalLguTax, id]);
    }

    // Debit COGS, Credit Inventory (net-of-VAT for GL) — skip when DR/SO workflow already expensed inventory
    if (!skipInvOps && totalCogs > 0) {
      const cogsBuckets = aggregateGlCogsByAccountCode(
        invoiceItems.map((item: any) => ({
          product_id: item.product_id,
          cogsGrossAmount: item.quantity * parseFloat(item.cost || 0),
          tax_type: item.tax_type,
        })),
        categoryMap,
      );
      await insertCogsInventoryLines({ query }, entryId, cogsBuckets, 'Sales Invoice', id, invoice_number);
    }

    // Link SO and mark as Invoiced
    if (so_id) {
      await query("UPDATE sales_orders SET status = 'Invoiced', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [so_id]);
    }

    const grossProfit = finalTotal - totalCogs;
    const marginPct = finalTotal > 0 ? ((grossProfit / finalTotal) * 100) : 0;
    res.status(201).json({
      id, invoice_number,
      total: finalTotal,
      total_cost: totalCogs,
      gross_profit: grossProfit,
      margin_pct: Math.round(marginPct * 100) / 100,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/invoices', authenticate, hasUserPerm('sales.sales-invoice.view'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      whereClause = 'WHERE si.status = $1';
      params.push(status);
      paramIndex++;
    }

    const total = await query(`SELECT COUNT(*) FROM sales_invoices si ${whereClause}`, params);
    const result = await query(
      `SELECT si.*, u.full_name as cashier_name,
              e.first_name as emp_first_name, e.last_name as emp_last_name, e.employee_code
       FROM sales_invoices si
       LEFT JOIN users u ON si.cashier_id = u.id
       LEFT JOIN employees e ON si.employee_id = e.id
       ${whereClause}
       ORDER BY si.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Prefill payload for duplicating an invoice (no DB write)
router.get('/invoices/:id/copy-to-invoice', authenticate, hasUserPerm('sales.sales-invoice.create'), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await query(
      `SELECT si.*, c.customer_name, c.customer_code, c.address as customer_address,
              c.phone as customer_phone, c.tin as customer_tin, c.customer_type,
              so.so_number, sq.sq_number, dn.dr_number
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN sales_orders so ON si.so_id = so.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       LEFT JOIN delivery_notes dn ON si.dn_id = dn.id
       WHERE si.id = $1`,
      [req.params.id]
    );
    if (invoice.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    if (['Void', 'Cancelled'].includes(invoice.rows[0].status)) {
      return res.status(400).json({ error: `Cannot copy ${invoice.rows[0].status} invoice` });
    }

    const items = await query(
      `SELECT sii.*, p.name as product_name, p.sku, p.unit_of_measure
       FROM sales_invoice_items sii
       LEFT JOIN products p ON sii.product_id = p.id
       WHERE sii.invoice_id = $1 ORDER BY sii.id`,
      [req.params.id]
    );
    if (items.rows.length === 0) return res.status(400).json({ error: 'No items on invoice' });

    const row = invoice.rows[0];
    const mappedItems = items.rows.map((i: any) => ({
      product_id: i.product_id,
      variant_id: i.variant_id,
      product_name: i.product_name || '',
      sku: i.sku || '',
      unit_of_measure: i.unit_of_measure || '',
      description: i.description || i.product_name || '',
      quantity: parseFloat(i.quantity),
      unit_price: parseFloat(i.unit_price),
      discount: parseFloat(i.discount || 0),
      tax_type: i.tax_type || row.tax_type || 'VATable',
      vat_amount: parseFloat(i.vat_amount || 0),
      location_id: i.location_id || 1,
      unit_cost: parseFloat(i.cost || 0),
    }));
    const ewtRate = resolveInvoiceEwtRate(row.ewt_rate, mappedItems, row.withholding_tax, row.tax_type || 'VATable');
    const skipInvForCopy = await shouldSkipInvoiceInventoryCogs(
      { query },
      { dn_id: row.dn_id, so_id: row.so_id, invoice_id: row.id },
    );

    res.json({
      source_invoice_id: row.id,
      source_invoice_number: row.invoice_number,
      source_so_number: row.so_number || null,
      source_sq_number: row.sq_number || null,
      source_dr_number: row.dr_number || null,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_code: row.customer_code || '',
      customer_tin: row.customer_tin || '',
      customer_phone: row.customer_phone || '',
      customer_address: row.customer_address || '',
      customer_type: row.customer_type || 'Customer',
      employee_id: row.employee_id,
      payment_terms: row.payment_terms || '',
      payment_method: row.payment_method || 'Cash',
      invoice_tax_type: row.tax_type || 'VATable',
      ewt_rate: ewtRate,
      due_date: row.due_date || '',
      notes: row.notes || '',
      skip_inventory: skipInvForCopy,
      duplicate: true,
      items: mappedItems,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/invoices/:id', authenticate, hasUserPerm('sales.sales-invoice.view'), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await query(
      `SELECT si.*, u.full_name as cashier_name, c.customer_name, c.address as customer_address, c.tin as customer_tin,
              e.first_name as emp_first_name, e.last_name as emp_last_name, e.employee_code
       FROM sales_invoices si
       LEFT JOIN users u ON si.cashier_id = u.id
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN employees e ON si.employee_id = e.id
       WHERE si.id = $1`,
      [req.params.id]
    );
    if (invoice.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const items = await query(
      `SELECT sii.*, p.sku, p.name as product_name,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_invoice_items sii
       JOIN products p ON sii.product_id = p.id
       WHERE sii.invoice_id = $1`,
      [req.params.id]
    );

    res.json({ ...invoice.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Printable Invoice (public via token in query param)
router.get('/invoices/:id/print', authenticate, hasUserPerm('sales.sales-invoice.print'), async (req: any, res: Response) => {
  try {
    const inv = await query(
      `SELECT si.*, u.full_name as cashier_name, c.customer_name, c.customer_code, c.tin as customer_tin, c.address as customer_address, c.phone as customer_phone,
              e.first_name as emp_first, e.last_name as emp_last
       FROM sales_invoices si
       LEFT JOIN users u ON si.cashier_id = u.id
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN employees e ON si.employee_id = e.id
       WHERE si.id = $1`,
      [req.params.id]
    );
    if (inv.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const i = inv.rows[0];

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const items = await query(
      `SELECT sii.*, p.sku, p.name as product_name, COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_invoice_items sii JOIN products p ON sii.product_id = p.id WHERE sii.invoice_id = $1 ORDER BY sii.id`,
      [req.params.id]
    );

    const totalQty = items.rows.reduce((s: number, r: any) => s + parseFloat(r.quantity), 0);
    const grossTotal = parseFloat(i.subtotal) || 0;
    const discountAmt = parseFloat(i.discount) || 0;
    const netOfVAT = parseFloat(i.vatable_sales || 0);
    const vatExemptSales = parseFloat(i.vat_exempt_sales || 0);
    const zeroRatedSales = parseFloat(i.zero_rated_sales || 0);
    const vatAmount = parseFloat(i.vat_amount || i.tax || 0);
    const total = parseFloat(i.total) || 0;
    const isCash = i.payment_method === 'Cash';
    const invoiceType = isCash ? 'Cash Sales Invoice' : 'Charge Sales Invoice (Credit)';

    const customerName = i.customer_type === 'Employee' && i.emp_first
      ? `${i.emp_last}, ${i.emp_first}`
      : (i.customer_name || 'Walk-in');

    const itemRows = items.rows.map((row: any, idx: number) =>
      tableRow([
        { html: String(idx + 1), align: 'c' },
        { html: row.sku || '—' },
        { html: row.product_name || row.description || '—' },
        { html: String(parseFloat(row.quantity)), align: 'c' },
        { html: row.unit_of_measure || '—', align: 'c' },
        { html: fmtCurrency(row.unit_price), align: 'r' },
        { html: fmtCurrency(row.total), align: 'r' },
      ])
    ).join('');

    const summaryRows: { label: string; value: string; total?: boolean }[] = [
      { label: 'No. of Line Items', value: String(items.rows.length) },
      { label: 'Total Quantity', value: String(totalQty) },
      { label: 'Trade Subtotal', value: fmtCurrency(grossTotal) },
    ];
    if (discountAmt > 0) summaryRows.push({ label: 'Less Discount', value: fmtCurrency(discountAmt) });
    if (netOfVAT > 0) {
      summaryRows.push({ label: 'VATable Sales (Net of VAT)', value: fmtCurrency(netOfVAT) });
    }
    if (vatExemptSales > 0) {
      summaryRows.push({ label: 'VAT Exempt Sales', value: fmtCurrency(vatExemptSales) });
    }
    if (zeroRatedSales > 0) {
      summaryRows.push({ label: 'Zero Rated Sales', value: fmtCurrency(zeroRatedSales) });
    }
    if (vatAmount > 0) {
      summaryRows.push({ label: 'Output VAT (12%)', value: fmtCurrency(vatAmount) });
    }
    if (parseFloat(i.lgu_final_tax || 0) > 0) {
      summaryRows.push({ label: 'LGU Final VAT (5%)', value: fmtCurrency(i.lgu_final_tax) });
    }
    if (parseFloat(i.withholding_tax || 0) > 0) {
      summaryRows.push({ label: 'Withholding Tax', value: fmtCurrency(i.withholding_tax) });
    }
    summaryRows.push({ label: 'TOTAL AMOUNT DUE', value: fmtCurrency(total), total: true });
    if (isCash) {
      summaryRows.push(
        { label: 'Amount Tendered', value: fmtCurrency(i.amount_paid) },
        { label: 'Change', value: fmtCurrency(Math.max(0, parseFloat(i.amount_paid) - total)) },
      );
    }

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Sales Invoice ${i.invoice_number}`,
      docTitle: 'Sales Invoice',
      docMetaRows: [
        { label: 'Document No.', value: i.invoice_number || '—' },
        { label: 'Document Date', value: fmtDate(i.invoice_date, 'short') },
        ...(i.due_date ? [{ label: 'Due Date', value: fmtDate(i.due_date, 'short') }] : []),
        { label: 'Status', value: String(i.status || 'Draft').toUpperCase() },
      ],
      customerRows: buildCustomerMetaRows({
        name: customerName,
        address: i.customer_address,
        tin: i.customer_tin,
        code: i.customer_code,
      }),
      detailsTitle: 'Invoice Details',
      detailsRows: [
        { label: 'Invoice Type', value: invoiceType },
        { label: 'Payment Method', value: i.payment_method || 'N/A' },
        ...(i.payment_terms ? [{ label: 'Credit Terms', value: i.payment_terms }] : []),
        { label: 'Cashier', value: i.cashier_name || '—' },
        { label: 'Currency', value: String(b.currency || 'PHP') },
      ],
      itemHeaders: SALES_LINE_ITEM_HEADERS,
      itemRows,
      summaryRows,
      bottomLeftHtml: [
        renderEnterpriseNotesBlock(
          'Taxation Compliance Information',
          `All values declared herein include Output Value Added Tax (VAT) of 12% in compliance with Bureau of Internal Revenue regulations. ${b.business_name || 'D METRAN TRADING'} | ${b.vat_type || 'VAT Registered'} TIN #${b.tin_number || '—'}`,
        ),
        renderEnterpriseNotesBlock(
          'Terms, Warranties & Settlement Conditions',
          i.terms_conditions?.trim() || 'Payment is due strictly within approved credit terms. Interest of 2.5% monthly will accrue on overdue account ledger balances. Goods once sold are non-refundable. Warranty claims must be filed within 7 days of receipt.',
        ),
        ...(i.notes ? [renderEnterpriseNotesBlock('Remarks', i.notes)] : []),
      ].join(''),
      footerNote: 'This is a system-generated sales invoice.',
      status: i.status,
      biz: b,
    });

    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Void invoice
router.patch('/invoices/:id/void', authenticate, hasUserPerm('sales.sales-invoice.edit'), auditLog('Sales', 'Void Invoice'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { reason } = req.body;
    const invoice = await client.query('SELECT * FROM sales_invoices WHERE id = $1', [req.params.id]);
    if (invoice.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const inv = invoice.rows[0];
    auditBefore(req, auditSnapshot(inv, AUDIT_FIELDS.salesInvoice));

    await client.query(
      "UPDATE sales_invoices SET status = 'Void', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [req.params.id]
    );

    const skipInvOps = await shouldSkipInvoiceInventoryCogs(client, {
      dn_id: inv.dn_id,
      so_id: inv.so_id,
      invoice_id: req.params.id,
    });

    // Restore inventory only when this invoice deducted stock (not when DR/SO already did)
    const items = await client.query('SELECT sii.*, inv.location_id FROM sales_invoice_items sii JOIN inventory inv ON sii.product_id = inv.product_id WHERE sii.invoice_id = $1', [req.params.id]);
    const hadInvoiceInventoryDeduction = (await client.query(
      `SELECT 1 FROM inventory_ledger
       WHERE reference_id = $1 AND reference_type IN ('Sales Invoice', 'Sales Invoice Edit')
       LIMIT 1`,
      [req.params.id],
    )).rows.length > 0;

    if (hadInvoiceInventoryDeduction) {
      for (const item of items.rows) {
        const locId = item.location_id || 1;
        await client.query('UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3',
          [item.quantity, item.product_id, locId]);

        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, created_by)
           VALUES ($1, $2, $3, 'Void Invoice', $4, 'IN', $5, $6)`,
          [uuidv4(), item.product_id, locId, req.params.id, item.quantity, req.user!.id]
        );
      }
    }

    // Reverse customer/employee balance (creation added total minus lgu+wht, not full total)
    const lguTax = parseFloat(inv.lgu_final_tax || 0);
    const wht = parseFloat(inv.withholding_tax || 0);
    const reversalAmount = parseFloat(inv.balance) - lguTax - wht;
    if (inv.customer_type === 'Employee' && inv.employee_id) {
      await client.query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance - $1 WHERE id = $2', [reversalAmount, inv.employee_id]);
    } else if (inv.customer_id) {
      await client.query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [reversalAmount, inv.customer_id]);
    }

    // Reversing journal entry
    const voidEntryId = uuidv4();
    const voidEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const finalTotal = parseFloat(inv.total);
    const totalTax = parseFloat(inv.vat_amount) || parseFloat(inv.tax) || 0;
    const totalCogs = items.rows.reduce((sum: number, i: any) => sum + (i.quantity * parseFloat(i.cost || 0)), 0);
    const revenue = parseFloat(inv.subtotal) - parseFloat(inv.discount || 0);
    const netRevenue = Math.max(0, revenue - totalTax - lguTax);
    const isEmployee = inv.customer_type === 'Employee';
    const creditAccount = isEmployee ? '1120' : (parseFloat(inv.amount_paid) >= finalTotal ? '1000' : '1100');
    const voidCogsGlLines = items.rows.map((i: any) => ({
      product_id: i.product_id,
      cogsGrossAmount: parseFloat(i.quantity) * parseFloat(i.cost || 0),
      tax_type: i.tax_type,
    }));
    const glCogs = !skipInvOps && totalCogs > 0 ? sumLineGlCogs(voidCogsGlLines) : 0;
    const jeTotal = finalTotal + glCogs;

    const voidCategoryMap = await loadCategoryAccountsForProducts(
      client,
      items.rows.map((i: any) => i.product_id),
    );
    const voidRevenueBuckets = aggregateByAccountCode(
      items.rows.map((i: any) => ({
        product_id: i.product_id,
        revenueAmount: storedInvoiceItemNetRevenue(i),
      })),
      voidCategoryMap,
      'revenue_account_code',
      'revenueAmount',
    );

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Void Invoice', $3, $4, $5, $5, $6)`,
      [voidEntryId, voidEntryNumber, req.params.id, `Void Invoice ${inv.invoice_number}`, jeTotal, req.user!.id]
    );

    // Reverse: Debit Revenue (by category), Debit VAT, Credit appropriate AR/Cash account
    await insertRevenueDebitLines(
      client, voidEntryId, voidRevenueBuckets, 'Void Invoice', req.params.id, `Reverse Revenue ${inv.invoice_number}`,
    );
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, $4, 0, 'Void Invoice', $5),
              ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $7), $8, 0, $9, 'Void Invoice', $5)`,
      [uuidv4(), voidEntryId, `Reverse VAT ${inv.invoice_number}`, totalTax, req.params.id,
       uuidv4(), creditAccount, `Reverse ${isEmployee ? 'Employee Receivable' : 'Cash/AR'} ${inv.invoice_number}`, finalTotal]
    );

    // Reverse WHT Receivable if present
    if (wht > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1105'), $3, 0, $4, 'Void Invoice', $5)`,
        [uuidv4(), voidEntryId, `Reverse WHT ${inv.invoice_number}`, wht, req.params.id]
      );
    }

    // Reverse LGU Final VAT if present
    if (lguTax > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2110'), $3, 0, $4, 'Void Invoice', $5)`,
        [uuidv4(), voidEntryId, `Reverse LGU VAT ${inv.invoice_number}`, lguTax, req.params.id]
      );
    }

    // Reverse COGS: Credit COGS (by category), Debit Inventory — skip when DR/SO workflow already expensed inventory
    if (!skipInvOps && totalCogs > 0) {
      const voidCogsBuckets = aggregateGlCogsByAccountCode(voidCogsGlLines, voidCategoryMap);
      await insertCogsInventoryReversalLines(
        client, voidEntryId, voidCogsBuckets, 'Void Invoice', req.params.id, `Reverse ${inv.invoice_number}`,
      );
    }

    // Cash transaction reversal (only for cash-type payments)
    const isEmployeeInvoice = inv.customer_type === 'Employee';
    const hadCashPayment = parseFloat(inv.amount_paid) > 0 && !isEmployeeInvoice;
    if (hadCashPayment) {
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Void', $3, 'Sales Invoice', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), finalTotal, req.params.id,
         `Void Invoice ${inv.invoice_number}`, req.user!.id]
      );
    }

    await client.query('COMMIT');
    auditAfter(req, {
      id: req.params.id,
      invoice_number: inv.invoice_number,
      status: 'Void',
      reason: reason || null,
    });
    res.json({ message: 'Invoice voided', id: req.params.id, invoice_number: inv.invoice_number, status: 'Void' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Edit invoice
router.patch('/invoices/:id', authenticate, hasUserPerm('sales.sales-invoice.edit'), auditLog('Sales', 'Edit Invoice'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const inv = await client.query('SELECT * FROM sales_invoices WHERE id = $1', [req.params.id]);
    if (inv.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const old = inv.rows[0];
    if (!['Draft','Posted','Partial'].includes(old.status)) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: `Cannot edit invoice with status ${old.status}` });
    }
    auditBefore(req, auditSnapshot(old, AUDIT_FIELDS.salesInvoice));

    const { customer_id, customer_name, customer_type, employee_id, price_mode, due_date,
            payment_method, payment_terms, notes, terms_conditions, invoice_tax_type, ewt_rate, items, skip_inventory } = req.body;
    if (!items || items.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Items required' }); }

    const ewtPercent = parseFloat(ewt_rate || '0');
    const skipInvOps = await shouldSkipInvoiceInventoryCogs(client, {
      skip_inventory: skip_inventory === true,
      dn_id: old.dn_id,
      so_id: old.so_id,
      invoice_id: req.params.id,
    });
    const originalLedger = await client.query(
      `SELECT 1 FROM inventory_ledger
       WHERE reference_id = $1 AND reference_type IN ('Sales Invoice', 'Sales Invoice Edit')
       LIMIT 1`,
      [req.params.id],
    );
    const hadOriginalInventoryDeduction = originalLedger.rows.length > 0;

    // ---- Reverse old ----
    const oldItems = await client.query('SELECT sii.*, i.location_id FROM sales_invoice_items sii JOIN inventory i ON sii.product_id = i.product_id WHERE sii.invoice_id = $1', [req.params.id]);
    if (hadOriginalInventoryDeduction) {
      for (const oi of oldItems.rows) {
        await client.query('UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3', [oi.quantity, oi.product_id, oi.location_id || 1]);
      }
    }
    const oldLgu = parseFloat(old.lgu_final_tax || 0);
    const oldWht = parseFloat(old.withholding_tax || 0);
    const oldReversal = parseFloat(old.total) - oldLgu - parseFloat(old.amount_paid);
    if (old.customer_type === 'Employee' && old.employee_id) {
      await client.query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance - $1 WHERE id = $2', [oldReversal, old.employee_id]);
    } else if (old.customer_id) {
      await client.query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [oldReversal, old.customer_id]);
    }
    await client.query("UPDATE journal_entries SET status = 'Void' WHERE reference_type = 'Sales Invoice' AND reference_id = $1 AND status = 'Posted'", [req.params.id]);
    await client.query('DELETE FROM sales_invoice_items WHERE invoice_id = $1', [req.params.id]);

    // ---- Compute new ----
    const { lines: invoiceItems, totals } = calculateInvoiceItems(items || [], ewtPercent, invoice_tax_type || 'VAT');
    const {
      subtotal: totalSubtotal, totalDiscount: totalDisc, totalVat, totalLguTax: totalLgu,
      totalWht, totalVatableSales: totalVatable, totalVatExemptSales, totalZeroRatedSales,
    } = totals;
    let totalCogs = 0;

    for (const item of invoiceItems) {
      const locId = item.location_id || 1;
      const invRow = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, locId]);
      let cost = invRow.rows[0] ? parseFloat(invRow.rows[0].unit_cost) : 0;
      const avQty = invRow.rows[0] ? parseFloat(invRow.rows[0].quantity) : 0;
      if (!skipInvOps) {
        if (item.quantity > avQty) {
          const setting = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
          if (setting.rows[0]?.setting_value !== 'true') { await client.query('ROLLBACK'); return res.status(400).json({ error: `Insufficient stock for ${item.description || item.product_id}` }); }
        }
        const fefo = await deductInventoryFefo(client, {
          product_id: item.product_id,
          location_id: locId,
          quantity: item.quantity,
          reference_type: 'Sales Invoice Edit',
          reference_id: req.params.id,
          created_by: req.user!.id,
        });
        cost = fefo.unitCost;
        totalCogs += fefo.totalCost;
      } else {
        totalCogs += item.quantity * cost;
      }
      item.cost = cost;

      await client.query(`INSERT INTO sales_invoice_items (id, invoice_id, product_id, variant_id, description, quantity, unit_price, discount, tax, total, cost, location_id, tax_type, vat_amount, selected_variant)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [uuidv4(), req.params.id, item.product_id, item.variant_id, item.description, item.quantity, item.unit_price,
         item.discount || 0, item.tax_amount || 0, item.total, cost, locId, item.tax_type || 'VAT', item.tax_amount || 0, item.selected_variant || null]);
    }

    const finalTotal = totalSubtotal - totalDisc;
    const amountDue = finalTotal - totalLgu;

    await client.query(`UPDATE sales_invoices SET customer_id=$1, customer_name=$2, customer_type=$3, employee_id=$4, price_mode=$5,
      due_date=$6, payment_method=$7, payment_terms=$8, notes=$9, terms_conditions=$10, subtotal=$11, discount=$12, tax=$13, tax_type=$14, total=$15,
      vatable_sales=$16, vat_exempt_sales=$17, zero_rated_sales=$18, vat_amount=$19, lgu_final_tax=$20, withholding_tax=$21, ewt_rate=$22, balance=$23, updated_at=CURRENT_TIMESTAMP WHERE id=$24`,
      [customer_type === 'Employee' ? null : customer_id, customer_name, customer_type || 'Customer', customer_type === 'Employee' ? employee_id : null,
       price_mode || 'Retail', due_date, payment_method, payment_terms, notes, terms_conditions || null, totalSubtotal, totalDisc, totalVat, invoice_tax_type || 'VAT',
       finalTotal, totalVatable, totalVatExemptSales, totalZeroRatedSales, totalVat, totalLgu, totalWht, ewtPercent, finalTotal - parseFloat(old.amount_paid), req.params.id]);

    if (customer_type === 'Employee' && employee_id) {
      await client.query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance + $1 WHERE id = $2', [amountDue, employee_id]);
    } else if (customer_id) {
      await client.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [amountDue, customer_id]);
    }

    // New journal entry
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const netRevenue = totalVatable + totalVatExemptSales + totalZeroRatedSales;
    const editCogsGlLines = invoiceItems.map((item: any) => ({
      product_id: item.product_id,
      cogsGrossAmount: item.quantity * parseFloat(item.cost || 0),
      tax_type: item.tax_type,
    }));
    const glCogs = !skipInvOps && totalCogs > 0 ? sumLineGlCogs(editCogsGlLines) : 0;
    const jeTotal = amountDue + glCogs;
    await client.query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
      VALUES ($1,$2,CURRENT_DATE,'Sales Invoice',$3,$4,$5,$5,$6)`, [entryId, entryNumber, req.params.id, `Sales Invoice ${old.invoice_number} (edited)`, jeTotal, req.user!.id]);
    if (customer_type === 'Employee') {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1120'),$3,$4,0,'Sales Invoice',$5)`, [uuidv4(), entryId, `Employee Credit ${old.invoice_number}`, amountDue, req.params.id]);
    } else {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1100'),$3,$4,0,'Sales Invoice',$5)`, [uuidv4(), entryId, `AR ${old.invoice_number}`, amountDue, req.params.id]);
    }
    const editCategoryMap = await loadCategoryAccountsForProducts(
      client,
      invoiceItems.map((item: any) => item.product_id),
    );
    const editRevenueBuckets = aggregateByAccountCode(
      invoiceItems.map((item: any) => ({
        product_id: item.product_id,
        revenueAmount: invoiceLineNetRevenue(item),
      })),
      editCategoryMap,
      'revenue_account_code',
      'revenueAmount',
    );
    await insertRevenueCreditLines(
      client, entryId, editRevenueBuckets, 'Sales Invoice', req.params.id, `Revenue ${old.invoice_number}`,
    );
    if (totalVat > 0) {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='2100'),$3,0,$4,'Sales Invoice',$5)`, [uuidv4(), entryId, `VAT ${old.invoice_number}`, totalVat, req.params.id]);
    }
    if (totalLgu > 0) {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='2110'),$3,0,$4,'Sales Invoice',$5)`, [uuidv4(), entryId, `LGU Final VAT ${old.invoice_number}`, totalLgu, req.params.id]);
    }
    if (!skipInvOps && totalCogs > 0) {
      const editCogsBuckets = aggregateGlCogsByAccountCode(editCogsGlLines, editCategoryMap);
      await insertCogsInventoryLines(
        client, entryId, editCogsBuckets, 'Sales Invoice', req.params.id, old.invoice_number,
      );
    }
    await client.query('COMMIT');
    auditAfter(req, auditSnapshot({
      id: req.params.id,
      invoice_number: old.invoice_number,
      status: old.status,
      customer_id,
      customer_name,
      total: finalTotal,
      subtotal: totalSubtotal,
      discount: totalDisc,
      vat_amount: totalVat,
      withholding_tax: totalWht,
      ewt_rate: ewtPercent,
      lgu_final_tax: totalLgu,
      balance: finalTotal - parseFloat(old.amount_paid),
      payment_method,
      payment_terms,
      due_date,
      tax_type: invoice_tax_type || 'VAT',
    }, AUDIT_FIELDS.salesInvoice));
    res.json({ id: req.params.id, invoice_number: old.invoice_number });
  } catch (error: any) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

// ==================== COLLECTION RECEIPTS ====================
router.post('/collections', authenticate, hasUserPerm('sales.collections.create'), auditLog('Sales', 'Create Collection'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_id, invoice_id, payment_method, reference_number, amount, notes, terms_conditions, bank_account_id, collection_date, ewt_amount, lgu_amount, allocations, check_date, check_bank } = req.body;

    const payDate = collection_date || new Date().toISOString().split('T')[0];

    // Multi-invoice batch payment via allocations array
    if (allocations && Array.isArray(allocations) && allocations.length > 0) {
      let totalApplied = 0;
      let totalCash = 0;
      let totalEwt = 0;
      let totalLgu = 0;

      if (!customer_id) return res.status(400).json({ error: 'Customer is required for batch payments' });
      if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });

      // Validate each allocation
      for (const alloc of allocations) {
        const aa = parseFloat(alloc.applied_amount || '0');
        const ewt = parseFloat(alloc.ewt_amount || '0');
        const lgu = parseFloat(alloc.lgu_amount || '0');
        const cash = aa - ewt - lgu;
        if (aa <= 0) return res.status(400).json({ error: 'Each allocation amount must be > 0' });
        if (cash < 0) return res.status(400).json({ error: 'Cash collected cannot be negative per allocation' });

        const inv = await query('SELECT * FROM sales_invoices WHERE id = $1', [alloc.invoice_id]);
        if (inv.rows.length === 0) return res.status(404).json({ error: `Invoice ${alloc.invoice_id} not found` });
        if (inv.rows[0].status === 'Void' || inv.rows[0].status === 'Cancelled') {
          return res.status(400).json({ error: `Invoice ${inv.rows[0].invoice_number} is void/cancelled` });
        }
        const rem = parseFloat(inv.rows[0].total) - parseFloat(inv.rows[0].amount_paid);
        if (aa > rem) return res.status(400).json({ error: `Amount ${aa.toFixed(2)} exceeds invoice ${inv.rows[0].invoice_number} balance ${rem.toFixed(2)}` });

        totalApplied += aa;
        totalCash += cash;
        totalEwt += ewt;
        totalLgu += lgu;
      }

      const receipt_number = await generateRefNumber('CR', 'collection_receipts', 'receipt_number');
      const receiptId = uuidv4();

      // One master receipt
      await query(
        `INSERT INTO collection_receipts (id, receipt_number, customer_id, payment_date, payment_method, reference_number, bank_account_id, amount, notes, terms_conditions, check_date, check_bank, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [receiptId, receipt_number, customer_id, payDate, payment_method, reference_number, bank_account_id || null, totalApplied, notes, terms_conditions || null, check_date || null, check_bank || null, req.user!.id]
      );

      // Insert allocation rows + update each invoice
      for (const alloc of allocations) {
        const aa = parseFloat(alloc.applied_amount || '0');
        const ewt = parseFloat(alloc.ewt_amount || '0');
        const lgu = parseFloat(alloc.lgu_amount || '0');
        await query(
          `INSERT INTO collection_receipt_allocations (id, receipt_id, invoice_id, applied_amount, ewt_amount, lgu_amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), receiptId, alloc.invoice_id, aa, ewt, lgu]
        );
        const inv = await query('SELECT * FROM sales_invoices WHERE id = $1', [alloc.invoice_id]);
        const newPaid = parseFloat(inv.rows[0].amount_paid) + aa;
        const newBalance = parseFloat(inv.rows[0].total) - newPaid;
        const newStatus = newBalance <= 0 ? 'Paid' : 'Partial';
        await query('UPDATE sales_invoices SET amount_paid=$1, balance=$2, status=$3 WHERE id=$4', [newPaid, newBalance, newStatus, alloc.invoice_id]);
      }

      // Update customer balance
      await query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [totalApplied, customer_id]);

      // Accounting entries
      const isBank = payment_method === 'Check' || payment_method === 'Bank Transfer';
      const isCash = payment_method === 'Cash' || payment_method === 'GCash' || payment_method === 'Maya';
      const depositTo = req.body.deposit_to || (isBank ? 'bank' : 'cash');
      let debitAccount = '1000';
      if (depositTo === 'checks_on_hand') debitAccount = '1015';
      else if (depositTo === 'bank') debitAccount = '1010';
      const entryId = uuidv4();
      const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');

      await query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
         VALUES ($1,$2,$3,'Collection',$4,$5,$6,$6,$7)`,
        [entryId, entryNumber, payDate, receiptId, `Collection ${receipt_number}`, totalApplied, req.user!.id]
      );
      if (totalCash > 0) {
        await query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Collection',$6)`,
          [uuidv4(), entryId, debitAccount, `Collection ${receipt_number}`, totalCash, receiptId]
        );
      }
      if (totalLgu > 0) {
        await query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='2110'),$3,$4,0,'Collection',$5)`,
          [uuidv4(), entryId, `LGU Final VAT ${receipt_number}`, totalLgu, receiptId]
        );
      }
      const arCode = '1100';
      await query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,0,$5,'Collection',$6)`,
        [uuidv4(), entryId, arCode, `AR ${receipt_number}`, totalApplied, receiptId]
      );
      if (totalEwt > 0) {
        await query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1105'),$3,$4,0,'Collection',$5)`,
          [uuidv4(), entryId, `WHT ${receipt_number}`, totalEwt, receiptId]
        );
      }
      if (isCash && totalCash > 0) {
        await query(
          `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,'Collection',$3,'Collection',$4,$5,$6)`,
          [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), totalCash, receiptId, notes, req.user!.id]
        );
      }
      if (isBank && bank_account_id && totalCash > 0) {
        await query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1,$2,'Deposit',$3,$4,$5,$6)`,
          [uuidv4(), bank_account_id, totalCash, payDate, `Collection ${receipt_number}`, req.user!.id]
        );
        await query('UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2', [totalCash, bank_account_id]);
      }

      return res.status(201).json({
        id: receiptId, receipt_number, allocation_count: allocations.length,
        total_applied: totalApplied, total_cash: totalCash, total_ewt: totalEwt, total_lgu: totalLgu,
      });
    }

    // ---- Single-invoice (backward compatible) ----
    const appliedAmount = parseFloat(amount || '0');
    const ewtAmt = parseFloat(ewt_amount || '0');
    const lguAmt = parseFloat(lgu_amount || '0');

    const invCheck = await query('SELECT customer_type, employee_id FROM sales_invoices WHERE id = $1', [invoice_id]);
    const isEmployeeInvoice = invCheck.rows[0]?.customer_type === 'Employee';
    const empId = invCheck.rows[0]?.employee_id;

    if (!customer_id && !isEmployeeInvoice) return res.status(400).json({ error: 'Customer is required' });
    if (!invoice_id) return res.status(400).json({ error: 'Invoice is required' });
    if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });
    if (appliedAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    if (ewtAmt < 0) return res.status(400).json({ error: 'EWT amount cannot be negative' });
    if (lguAmt < 0) return res.status(400).json({ error: 'Final VAT amount cannot be negative' });

    const inv = await query('SELECT * FROM sales_invoices WHERE id = $1', [invoice_id]);
    if (inv.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.rows[0].status === 'Void' || inv.rows[0].status === 'Cancelled') {
      return res.status(400).json({ error: 'Cannot collect on a voided/cancelled invoice' });
    }

    const remainingBalance = parseFloat(inv.rows[0].total) - parseFloat(inv.rows[0].amount_paid);
    if (appliedAmount > remainingBalance) {
      return res.status(400).json({ error: `Amount exceeds remaining balance of ${remainingBalance.toFixed(2)}` });
    }

    const cashCollected = appliedAmount - ewtAmt - lguAmt;
    if (cashCollected < 0) return res.status(400).json({ error: 'Cash collected cannot be negative. Check EWT/Final VAT amounts.' });

    if (Math.abs(cashCollected + ewtAmt + lguAmt - appliedAmount) > 0.01) {
      return res.status(400).json({ error: 'Cash + EWT + Final VAT must equal the applied amount' });
    }

    const receipt_number = await generateRefNumber('CR', 'collection_receipts', 'receipt_number');
    const id = uuidv4();

    await query(
      `INSERT INTO collection_receipts (id, receipt_number, customer_id, invoice_id, payment_date, payment_method, reference_number, bank_account_id, amount, notes, terms_conditions, check_date, check_bank, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, receipt_number, customer_id, invoice_id, payDate, payment_method, reference_number, bank_account_id || null, appliedAmount, notes, terms_conditions || null, check_date || null, check_bank || null, req.user!.id]
    );

    await query(
      `INSERT INTO collection_receipt_allocations (id, receipt_id, invoice_id, applied_amount, ewt_amount, lgu_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv4(), id, invoice_id, appliedAmount, ewtAmt, lguAmt]
    );

    const newPaid = parseFloat(inv.rows[0].amount_paid) + appliedAmount;
    const newBalance = parseFloat(inv.rows[0].total) - newPaid;
    const newStatus = newBalance <= 0 ? 'Paid' : 'Partial';
    await query(
      'UPDATE sales_invoices SET amount_paid = $1, balance = $2, status = $3 WHERE id = $4',
      [newPaid, newBalance, newStatus, invoice_id]
    );

    if (customer_id) {
      await query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [appliedAmount, customer_id]);
    } else if (isEmployeeInvoice && empId) {
      await query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance - $1 WHERE id = $2', [appliedAmount, empId]);
    }

    const isBankPayment = payment_method === 'Check' || payment_method === 'Bank Transfer';
    const isCash = payment_method === 'Cash' || payment_method === 'GCash' || payment_method === 'Maya';
    const depositTo = req.body.deposit_to || (isBankPayment ? 'bank' : 'cash');
    let debitAccount = '1000';
    if (depositTo === 'checks_on_hand') debitAccount = '1015';
    else if (depositTo === 'bank') debitAccount = '1010';

    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');

    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, $3, 'Collection', $4, $5, $6, $6, $7)`,
      [entryId, entryNumber, payDate, id, `Collection ${receipt_number}`, appliedAmount, req.user!.id]
    );

    if (cashCollected > 0) {
      await query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, 'Collection', $6)`,
        [uuidv4(), entryId, debitAccount, `Collection ${receipt_number}`, cashCollected, id]
      );
    }

    if (lguAmt > 0) {
      await query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2110'), $3, $4, 0, 'Collection', $5)`,
        [uuidv4(), entryId, `LGU Final VAT ${receipt_number}`, lguAmt, id]
      );
    }

    const arAccountCode = isEmployeeInvoice ? '1120' : '1100';
    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '${arAccountCode}'), $3, 0, $4, 'Collection', $5)`,
      [uuidv4(), entryId, `AR ${receipt_number}`, appliedAmount, id]
    );

    if (ewtAmt > 0) {
      await query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1105'), $3, $4, 0, 'Collection', $5)`,
        [uuidv4(), entryId, `WHT ${receipt_number}`, ewtAmt, id]
      );
    }

    if (isCash && cashCollected > 0) {
      await query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Collection', $3, 'Collection', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), cashCollected, id, notes, req.user!.id]
      );
    }

    if (isBankPayment && bank_account_id && cashCollected > 0) {
      await query(
        `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
         VALUES ($1, $2, 'Deposit', $3, $4, $5, $6)`,
        [uuidv4(), bank_account_id, cashCollected, payDate, `Collection ${receipt_number}`, req.user!.id]
      );
      await query(`UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2`, [cashCollected, bank_account_id]);
    }

    res.status(201).json({
      id, receipt_number, new_status: newStatus, new_balance: newBalance,
      applied_amount: appliedAmount, cash_collected: cashCollected, ewt_amount: ewtAmt, lgu_amount: lguAmt,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Outstanding AR with aging
router.get('/outstanding-ar', authenticate, hasUserPerm('sales.collections.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT si.id AS invoice_id, si.invoice_number, si.invoice_date, si.due_date, si.total,
             si.subtotal, si.discount, si.amount_paid, si.balance, si.status, si.customer_name, si.customer_id,
             si.tax_type, si.vatable_sales, si.vat_exempt_sales, si.zero_rated_sales,
             si.vat_amount, si.lgu_final_tax, si.withholding_tax, si.ewt_rate,
             c.customer_code,
             CURRENT_DATE - si.due_date AS days_overdue,
             CASE
               WHEN CURRENT_DATE - si.due_date <= 0 THEN 'Current'
               WHEN CURRENT_DATE - si.due_date <= 30 THEN '1-30 Days'
               WHEN CURRENT_DATE - si.due_date <= 60 THEN '31-60 Days'
               WHEN CURRENT_DATE - si.due_date <= 90 THEN '61-90 Days'
               ELSE '90+ Days'
             END AS aging_bucket
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      WHERE si.status IN ('Posted', 'Partial')
        AND si.balance > 0
      ORDER BY si.due_date ASC
    `);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/collections', authenticate, hasUserPerm('sales.collections.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT cr.*, c.customer_name,
              e.first_name || ' ' || e.last_name as employee_name
       FROM collection_receipts cr
       LEFT JOIN customers c ON cr.customer_id = c.id
       LEFT JOIN sales_invoices si ON cr.invoice_id = si.id
       LEFT JOIN employees e ON si.employee_id = e.id
       ORDER BY cr.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Customer Statements — unpaid invoices grouped by customer
router.get('/customer-statements', authenticate, hasUserPerm('sales.collections.view'), async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.search as string || '';
    const from = req.query.from as string || '2020-01-01';
    const to = req.query.to as string || '2099-12-31';
    const result = await query(
      `SELECT c.id as customer_id, c.customer_code, c.customer_name,
              MIN(si.invoice_date) as oldest_invoice_date,
              COUNT(si.id) as unpaid_count,
              SUM(si.balance) as total_outstanding
       FROM sales_invoices si
       JOIN customers c ON si.customer_id = c.id
       WHERE si.status IN ('Posted','Partial','Overdue')
         AND si.balance > 0
         AND si.invoice_date >= $2 AND si.invoice_date <= $3
         AND c.customer_name ILIKE $1
       GROUP BY c.id, c.customer_code, c.customer_name
       ORDER BY total_outstanding DESC`,
      [`%${search}%`, from, to]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Customer Statement Detail — invoices + payment history for one customer
router.get('/customer-statement/:customerId', authenticate, hasUserPerm('sales.collections.view'), async (req: AuthRequest, res: Response) => {
  try {
    const cust = await query('SELECT * FROM customers WHERE id = $1', [req.params.customerId]);
    if (cust.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const invoices = await query(
      `SELECT si.*, CURRENT_DATE - si.invoice_date::date as days_outstanding,
              CURRENT_DATE - si.due_date::date as days_past_due
       FROM sales_invoices si
       WHERE si.customer_id = $1 AND si.status IN ('Posted','Partial','Overdue') AND si.balance > 0
       ORDER BY si.invoice_date ASC`,
      [req.params.customerId]
    );

    const payments = await query(
      `SELECT cr.*, 
              COALESCE((SELECT jsonb_agg(jsonb_build_object('invoice_id', cra.invoice_id, 'invoice_number', si2.invoice_number, 'amount', cra.applied_amount))
                        FROM collection_receipt_allocations cra
                        LEFT JOIN sales_invoices si2 ON cra.invoice_id = si2.id
                        WHERE cra.receipt_id = cr.id), '[]'::jsonb) as applied_invoices
       FROM collection_receipts cr
       WHERE cr.customer_id = $1 AND cr.status = 'Posted'
       ORDER BY cr.payment_date DESC`,
      [req.params.customerId]
    );

    const aging = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    for (const inv of invoices.rows) {
      const due = parseInt(inv.days_past_due) || 0;
      const bal = parseFloat(inv.balance);
      aging.total += bal;
      if (due <= 0) aging.current += bal;
      else if (due <= 30) aging.d30 += bal;
      else if (due <= 60) aging.d60 += bal;
      else if (due <= 90) aging.d90 += bal;
      else aging.over90 += bal;
    }

    res.json({ customer: cust.rows[0], invoices: invoices.rows, payments: payments.rows, aging });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Customer Statement Print
router.get('/customer-statement/:customerId/print', authenticate, hasUserPerm('sales.collections.print'), async (req: AuthRequest, res: Response) => {
  try {
    const cust = await query('SELECT * FROM customers WHERE id = $1', [req.params.customerId]);
    if (cust.rows.length === 0) return res.status(404).send('Not found');
    const c = cust.rows[0];

    const invoices = await query(
      `SELECT * FROM sales_invoices WHERE customer_id = $1 AND status IN ('Posted','Partial','Overdue') AND balance > 0 ORDER BY invoice_date ASC`,
      [req.params.customerId]
    );

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const totalOutstanding = invoices.rows.reduce((s: number, i: any) => s + parseFloat(i.balance), 0);

    const aged = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    for (const inv of invoices.rows) {
      const due = Math.floor((new Date().getTime() - new Date(inv.due_date || inv.invoice_date).getTime()) / 86400000);
      const bal = parseFloat(inv.balance);
      if (due <= 0) aged.current += bal;
      else if (due <= 30) aged.d30 += bal;
      else if (due <= 60) aged.d60 += bal;
      else if (due <= 90) aged.d90 += bal;
      else aged.over90 += bal;
    }

    const invoiceRows = invoices.rows.map((inv: any) => {
      const daysDue = Math.floor((new Date().getTime() - new Date(inv.due_date || inv.invoice_date).getTime()) / 86400000);
      return tableRow([
        { html: fmtDate(inv.invoice_date, 'short') },
        { html: inv.invoice_number },
        { html: inv.notes || '—' },
        { html: fmtCurrency(parseFloat(inv.total)), align: 'r' },
        { html: String(Math.max(0, daysDue)), align: 'r' },
        { html: fmtCurrency(parseFloat(inv.balance)), align: 'r' },
      ]);
    }).join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Statement - ${c.customer_name}`,
      docTitle: 'Statement of Account',
      docMetaRows: [
        { label: 'Statement Date', value: fmtDate(new Date(), 'short') },
        { label: 'Unpaid Invoices', value: String(invoices.rows.length) },
        { label: 'Customer Code', value: c.customer_code || '—' },
        { label: 'Status', value: 'OUTSTANDING' },
      ],
      customerRows: buildCustomerMetaRows({
        name: c.customer_name,
        address: c.address,
        tin: c.tin,
        code: c.customer_code,
      }),
      detailsTitle: 'Account Summary',
      detailsRows: [
        { label: 'Credit Limit', value: c.credit_limit != null ? fmtCurrency(c.credit_limit) : '—' },
        { label: 'Payment Terms', value: c.payment_terms || '—' },
        { label: 'Contact Person', value: c.contact_person || '—' },
        { label: 'Currency', value: String(b.currency || 'PHP') },
      ],
      beforeItemsHtml: renderEnterpriseSectionTitle('Outstanding Invoices'),
      itemHeaders: [
        { text: 'Date', align: 'left' },
        { text: 'Invoice No.' },
        { text: 'Description' },
        { text: 'Total', align: 'right' },
        { text: 'Overdue Days', align: 'right', width: '72px' },
        { text: 'Balance Due', align: 'right', width: '88px' },
      ],
      itemRows: invoiceRows,
      skipBottom: true,
      summaryRows: [{ label: 'Total Outstanding', value: fmtCurrency(totalOutstanding), total: true }],
      afterSummaryHtml: [
        renderEnterpriseSectionTitle('Aging Summary'),
        renderEnterpriseAgingRow(aged),
        renderEnterpriseTotalBanner('Total Outstanding', fmtCurrency(totalOutstanding)),
      ].join(''),
      footerNote: 'Statement of Account — please remit payment for all overdue balances.',
      biz: b,
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Billing Statement — selected sales invoices with VAT summary (Statement of Account for billing)
router.get('/customer-statement/:customerId/billing-statement/print', authenticate, hasUserPerm('sales.collections.print'), async (req: AuthRequest, res: Response) => {
  try {
    const cust = await query('SELECT * FROM customers WHERE id = $1', [req.params.customerId]);
    if (cust.rows.length === 0) return res.status(404).send('Not found');
    const c = cust.rows[0];

    const rawIds = String(req.query.invoice_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (rawIds.length === 0) {
      return res.status(400).send('<p>Select at least one sales invoice for the billing statement.</p>');
    }

    const invoices = await query(
      `SELECT * FROM sales_invoices
       WHERE customer_id = $1 AND id = ANY($2::uuid[])
         AND status NOT IN ('Void', 'Cancelled', 'Draft')
       ORDER BY invoice_date ASC, invoice_number ASC`,
      [req.params.customerId, rawIds],
    );

    if (invoices.rows.length === 0) {
      return res.status(400).send('<p>No valid invoices found for this customer.</p>');
    }
    if (invoices.rows.length !== rawIds.length) {
      return res.status(400).send('<p>One or more invoices do not belong to this customer or are not billable.</p>');
    }

    const description = String(req.query.description || '').trim();
    const totals = computeBillingStatementTotals(invoices.rows);
    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const invoiceRows = invoices.rows.map((inv: any) =>
      tableRow([
        { html: fmtDate(inv.invoice_date, 'short') },
        { html: inv.invoice_number },
        { html: fmtCurrency(parseFloat(inv.total)), align: 'r' },
      ]),
    ).join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Billing Statement - ${c.customer_name}`,
      docTitle: 'Billing Statement',
      docMetaRows: [
        { label: 'Statement Date', value: fmtDate(new Date(), 'short') },
        { label: 'Customer Code', value: c.customer_code || '—' },
        { label: 'No. of Invoices', value: String(invoices.rows.length) },
        { label: 'Document', value: 'Statement of Account' },
      ],
      customerRows: buildCustomerMetaRows({
        name: c.customer_name,
        address: c.address,
        tin: c.tin,
        phone: c.phone,
        code: c.customer_code,
      }),
      detailsTitle: 'Billing Details',
      detailsRows: [
        { label: 'Payment Terms', value: c.payment_terms || '—' },
        { label: 'Contact Person', value: c.contact_person || '—' },
        { label: 'Currency', value: String(b.currency || 'PHP') },
        { label: 'Total Net Amount', value: fmtCurrency(totals.netAmount) },
      ],
      beforeItemsHtml: renderEnterpriseSectionTitle('Sales Invoices'),
      itemHeaders: [
        { text: 'Date', align: 'left', width: '100px' },
        { text: 'SI No.', align: 'left' },
        { text: 'Amount', align: 'right', width: '120px' },
      ],
      itemRows: invoiceRows,
      bottomLeftHtml: renderEnterpriseNotesBlock(
        'Description',
        description || 'Please find below the list of sales invoices for your account. Kindly remit payment for the total net amount due.',
      ),
      summaryRows: buildBillingStatementSummaryRows(totals),
      amountInWords: totals.netAmount,
      signatures: buildBillingStatementSignatures(b),
      signatureCols: 3,
      footerNote: 'Billing Statement / Statement of Account — this is a system-generated document.',
      biz: b,
    });
    res.send(html);
  } catch (error: any) {
    res.status(500).send('<p>Error: ' + error.message + '</p>');
  }
});

// Collection Receipt Print
router.get('/collection-receipt/:id/print', authenticate, hasUserPerm('sales.collection-receipt.print'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT cr.*, c.customer_name, c.customer_code, c.address as customer_address,
              ba.bank_name, ba.account_name
       FROM collection_receipts cr
       LEFT JOIN customers c ON cr.customer_id = c.id
       LEFT JOIN bank_accounts ba ON cr.bank_account_id = ba.id
       WHERE cr.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];

    const allocations = await query(
      `SELECT cra.applied_amount, cra.ewt_amount, cra.lgu_amount,
              si.invoice_number, si.invoice_date, si.total AS invoice_total, si.balance AS invoice_balance,
              si.ewt_rate
       FROM collection_receipt_allocations cra
       JOIN sales_invoices si ON cra.invoice_id = si.id
       WHERE cra.receipt_id = $1
       UNION ALL
       SELECT cr.amount AS applied_amount,
              COALESCE((
                SELECT SUM(jel.debit)
                FROM journal_entries je
                JOIN journal_entry_lines jel ON jel.entry_id = je.id
                JOIN chart_of_accounts coa ON coa.id = jel.account_id
                WHERE je.reference_type = 'Collection' AND je.reference_id = cr.id AND coa.account_code = '1105'
              ), 0) AS ewt_amount,
              COALESCE((
                SELECT SUM(jel.debit)
                FROM journal_entries je
                JOIN journal_entry_lines jel ON jel.entry_id = je.id
                JOIN chart_of_accounts coa ON coa.id = jel.account_id
                WHERE je.reference_type = 'Collection' AND je.reference_id = cr.id AND coa.account_code = '2110'
              ), 0) AS lgu_amount,
              si.invoice_number, si.invoice_date, si.total AS invoice_total, si.balance AS invoice_balance,
              si.ewt_rate
       FROM collection_receipts cr
       JOIN sales_invoices si ON cr.invoice_id = si.id
       WHERE cr.id = $1 AND cr.invoice_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM collection_receipt_allocations x WHERE x.receipt_id = cr.id)
       ORDER BY invoice_date`,
      [req.params.id]
    );

    const totalApplied = allocations.rows.reduce((s: number, a: any) => s + (parseFloat(a.applied_amount) || 0), 0)
      || parseFloat(d.amount) || 0;
    const totalEwt = allocations.rows.reduce((s: number, a: any) => s + (parseFloat(a.ewt_amount) || 0), 0);
    const totalLgu = allocations.rows.reduce((s: number, a: any) => s + (parseFloat(a.lgu_amount) || 0), 0);
    const cashReceived = Math.max(0, totalApplied - totalEwt - totalLgu);

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const hasEwtOrLgu = totalEwt > 0 || totalLgu > 0;
    const ewtRateLabel = allocations.rows.find((a: any) => parseFloat(a.ewt_rate) > 0)?.ewt_rate;

    const allocRows = allocations.rows.map((a: any) => {
      const cells: { html: string; align?: 'c' | 'r' }[] = [
        { html: a.invoice_number },
        { html: fmtDate(a.invoice_date, 'short') },
        { html: fmtCurrency(parseFloat(a.invoice_total)), align: 'r' },
        { html: fmtCurrency(parseFloat(a.applied_amount)), align: 'r' },
      ];
      if (hasEwtOrLgu) {
        cells.push(
          { html: parseFloat(a.ewt_amount) > 0 ? fmtCurrency(a.ewt_amount) : '—', align: 'r' },
          { html: parseFloat(a.lgu_amount) > 0 ? fmtCurrency(a.lgu_amount) : '—', align: 'r' },
        );
      }
      return tableRow(cells);
    }).join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `CR ${d.receipt_number}`,
      docTitle: 'Collection Receipt',
      docMetaRows: [
        { label: 'Receipt No.', value: d.receipt_number || '—' },
        { label: 'Payment Date', value: fmtDate(d.payment_date, 'short') },
        { label: 'Payment Method', value: d.payment_method || '—' },
        { label: 'Status', value: String(d.status || 'Posted').toUpperCase() },
      ],
      customerRows: buildCustomerMetaRows({
        name: d.customer_name,
        address: d.customer_address,
        code: d.customer_code,
      }),
      detailsTitle: 'Receipt Details',
      detailsRows: [
        ...(d.reference_number ? [{ label: 'Reference No.', value: d.reference_number }] : []),
        ...(d.check_date ? [{ label: 'Check Date', value: fmtDate(d.check_date, 'short') }] : []),
        ...(d.check_bank ? [{ label: 'Check Bank', value: d.check_bank }] : []),
        ...(d.bank_name ? [{ label: 'Deposit Account', value: `${d.bank_name}${d.account_name ? ` (${d.account_name})` : ''}` }] : []),
        { label: 'Currency', value: String(b.currency || 'PHP') },
      ],
      beforeItemsHtml: renderEnterpriseSectionTitle('Payment Allocation'),
      itemHeaders: [
        { text: 'Invoice #' },
        { text: 'Date' },
        { text: 'Invoice Total', align: 'right' },
        { text: 'Applied', align: 'right', width: '88px' },
        ...(hasEwtOrLgu ? [
          { text: 'EWT', align: 'right' as const, width: '72px' },
          { text: 'LGU 5%', align: 'right' as const, width: '72px' },
        ] : []),
      ],
      itemRows: allocRows,
      summaryRows: [
        { label: 'Amount Applied', value: fmtCurrency(totalApplied) },
        ...(totalEwt > 0 ? [{ label: `Less: EWT${ewtRateLabel ? ` (${parseFloat(ewtRateLabel)}%)` : ''}`, value: `-${fmtCurrency(totalEwt)}` }] : []),
        ...(totalLgu > 0 ? [{ label: 'Less: LGU Final VAT (5%)', value: `-${fmtCurrency(totalLgu)}` }] : []),
        { label: 'Total Received', value: fmtCurrency(cashReceived), total: true },
      ],
      notes: d.notes ? [{ label: 'Remarks', content: d.notes }] : [],
      footerNote: 'Official collection receipt — acknowledge payment received.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseTwoPartySignatures(b),
      signatureCols: 2,
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// ==================== SALES RETURNS ====================

router.get('/returns/copy-from-invoice/:invoiceId', authenticate, hasUserPerm('sales.sales-invoice.create'), async (req: AuthRequest, res: Response) => {
  try {
    const inv = await query(
      `SELECT si.*, c.customer_name, c.customer_code,
              e.id as emp_id, CONCAT(e.last_name, ', ', e.first_name) as employee_name
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN employees e ON si.employee_id = e.id
       WHERE si.id = $1`,
      [req.params.invoiceId]
    );
    if (inv.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = inv.rows[0];
    if (invoice.status !== 'Posted') return res.status(400).json({ error: 'Only posted invoices can be returned' });
    const items = await query(
      `SELECT sii.*, p.sku, p.name as product_name,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_invoice_items sii
       JOIN products p ON sii.product_id = p.id
       WHERE sii.invoice_id = $1`,
      [req.params.invoiceId]
    );
    res.json({
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      customer_id: invoice.customer_id,
      customer_name: invoice.customer_type === 'Employee' ? invoice.employee_name : invoice.customer_name,
      customer_type: invoice.customer_type || 'Customer',
      employee_id: invoice.employee_id || null,
      notes: '',
      reason: '',
      items: items.rows.map((i: any) => ({
        invoice_item_id: i.id,
        product_id: i.product_id,
        product_name: i.product_name,
        sku: i.sku,
        unit_of_measure: i.unit_of_measure,
        invoiced_qty: parseFloat(i.quantity),
        quantity: parseFloat(i.quantity),
        unit_price: parseFloat(i.unit_price),
        line_total: parseFloat(i.total),
        location_id: i.location_id || 1,
        cost: parseFloat(i.cost || 0),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/returns', authenticate, hasUserPerm('sales.sales-invoice.view'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const total = await query('SELECT COUNT(*) FROM sales_returns');
    const result = await query(
      `SELECT sr.*, c.customer_name, si.invoice_number, si.customer_type,
              CONCAT(e.last_name, ', ', e.first_name) as employee_name,
              (SELECT COUNT(*) FROM sales_return_items WHERE return_id = sr.id) as item_count
       FROM sales_returns sr
       LEFT JOIN customers c ON sr.customer_id = c.id
       LEFT JOIN sales_invoices si ON sr.invoice_id = si.id
       LEFT JOIN employees e ON sr.employee_id = e.id
       ORDER BY sr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/returns/:id', authenticate, hasUserPerm('sales.sales-invoice.view'), async (req: AuthRequest, res: Response) => {
  try {
    const sr = await query(
      `SELECT sr.*, c.customer_name, c.customer_code, si.invoice_number, si.customer_type,
              CONCAT(e.last_name, ', ', e.first_name) as employee_name, u.full_name as created_by_name
       FROM sales_returns sr
       LEFT JOIN customers c ON sr.customer_id = c.id
       LEFT JOIN sales_invoices si ON sr.invoice_id = si.id
       LEFT JOIN employees e ON sr.employee_id = e.id
       LEFT JOIN users u ON sr.created_by = u.id
       WHERE sr.id = $1`,
      [req.params.id]
    );
    if (sr.rows.length === 0) return res.status(404).json({ error: 'Sales return not found' });
    const items = await query(
      `SELECT sri.*, p.sku, p.name as product_name,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_return_items sri
       JOIN products p ON sri.product_id = p.id
       WHERE sri.return_id = $1`,
      [req.params.id]
    );
    res.json({ ...sr.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/returns/:id/print', authenticate, hasUserPerm('sales.sales-invoice.print'), async (req: AuthRequest, res: Response) => {
  try {
    const sr = await query(
      `SELECT sr.*, c.customer_name, c.address as customer_address, si.invoice_number, si.customer_type,
              CONCAT(e.last_name, ', ', e.first_name) as employee_name, u.full_name as created_by_name
       FROM sales_returns sr
       LEFT JOIN customers c ON sr.customer_id = c.id
       LEFT JOIN sales_invoices si ON sr.invoice_id = si.id
       LEFT JOIN employees e ON sr.employee_id = e.id
       LEFT JOIN users u ON sr.created_by = u.id
       WHERE sr.id = $1`,
      [req.params.id]
    );
    if (sr.rows.length === 0) return res.status(404).send('Not found');
    const d = sr.rows[0];
    const items = await query(
      `SELECT sri.*, p.sku, p.name as product_name,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_return_items sri
       JOIN products p ON sri.product_id = p.id
       WHERE sri.return_id = $1`,
      [req.params.id]
    );
    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const partyName = d.customer_type === 'Employee' ? d.employee_name : d.customer_name;
    const itemRows = items.rows.map((i: any, idx: number) => tableRow([
      { html: String(idx + 1), align: 'c' },
      { html: i.sku || '—' },
      { html: i.product_name || '—' },
      { html: parseFloat(i.quantity).toFixed(2), align: 'c' },
      { html: i.unit_of_measure || 'pc', align: 'c' },
      { html: fmtCurrency(i.unit_price), align: 'r' },
      { html: fmtCurrency(i.total), align: 'r' },
    ])).join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Sales Return ${d.return_number}`,
      docTitle: 'Sales Return',
      docMetaRows: [
        { label: 'Document No.', value: d.return_number || '—' },
        { label: 'Return Date', value: fmtDate(d.return_date, 'short') },
        { label: 'Reference Invoice', value: d.invoice_number || '—' },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      customerRows: buildCustomerMetaRows({
        name: partyName,
        address: d.customer_address,
      }),
      detailsRows: [
        { label: 'Reason', value: d.reason || '—' },
        { label: 'Processed By', value: d.created_by_name || '—' },
        { label: 'Currency', value: String(b.currency || 'PHP') },
      ],
      itemHeaders: SALES_LINE_ITEM_HEADERS,
      itemRows,
      summaryRows: [{ label: 'Total Return Amount', value: fmtCurrency(d.total || 0), total: true }],
      notes: d.notes ? [{ label: 'Remarks', content: d.notes }] : [],
      footerNote: 'Sales return document — for inventory and AR adjustment reference.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseTwoPartySignatures(b),
      signatureCols: 2,
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

router.post('/returns', authenticate, hasUserPerm('sales.sales-invoice.create'), auditLog('Sales', 'Create Sales Return'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await assertPeriodNotLocked(new Date().toISOString().slice(0, 10));
    await client.query('BEGIN');
    const { invoice_id, customer_id, items, reason, notes, terms_conditions } = req.body;
    if (!invoice_id) throw new AppError('Invoice is required');
    if (!items?.length) throw new AppError('At least one item is required');

    const inv = await client.query('SELECT * FROM sales_invoices WHERE id = $1', [invoice_id]);
    if (inv.rows.length === 0) throw new AppError('Invoice not found');
    if (inv.rows[0].status !== 'Posted') throw new AppError('Only posted invoices can be returned');
    const sourceInvoice = inv.rows[0];
    const isEmployee = sourceInvoice.customer_type === 'Employee';
    const employeeId = sourceInvoice.employee_id;
    const postReturnCogs = await invoiceHadCogsRecognized(client, {
      id: sourceInvoice.id,
      dn_id: sourceInvoice.dn_id,
      so_id: sourceInvoice.so_id,
    });

    const return_number = await generateRefNumber('SR', 'sales_returns', 'return_number');
    const id = uuidv4();

    await client.query(
      `INSERT INTO sales_returns (id, return_number, invoice_id, customer_id, employee_id, return_date, status, reason, notes, terms_conditions, total, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'Draft', $6, $7, $8, 0, $9)`,
      [id, return_number, invoice_id, isEmployee ? null : (customer_id || sourceInvoice.customer_id), isEmployee ? employeeId : null, reason, notes, terms_conditions || null, req.user!.id]
    );

    let totalReturn = 0;
    let totalCogs = 0;
    const returnGlLines: Array<{ product_id: string; revenueAmount: number; cogsGrossAmount: number; tax_type?: string }> = [];

    for (const item of items) {
      const qty = parseFloat(item.quantity);
      if (qty <= 0) throw new AppError('Return quantity must be greater than zero');

      const line = await client.query('SELECT * FROM sales_invoice_items WHERE id = $1 AND invoice_id = $2', [
        item.invoice_item_id, invoice_id,
      ]);
      if (line.rows.length === 0) throw new AppError('Invalid invoice line item');
      const invLine = line.rows[0];
      const invoicedQty = parseFloat(invLine.quantity);
      if (qty > invoicedQty) throw new AppError(`Return qty exceeds invoiced qty for ${invLine.description || 'item'}`);

      const unitPrice = parseFloat(invLine.unit_price);
      const lineTotal = (parseFloat(invLine.total) / invoicedQty) * qty;
      const cost = parseFloat(invLine.cost || 0);
      const locId = item.location_id || invLine.location_id || 1;
      totalReturn += lineTotal;
      totalCogs += cost * qty;
      const productId = item.product_id || invLine.product_id;
      const lineVat = (parseFloat(invLine.vat_amount || 0) / invoicedQty) * qty;
      returnGlLines.push({
        product_id: productId,
        revenueAmount: storedInvoiceItemNetRevenue({
          total: lineTotal,
          vat_amount: lineVat,
          tax_type: invLine.tax_type,
        }),
        cogsGrossAmount: cost * qty,
        tax_type: invLine.tax_type,
      });

      await client.query(
        `INSERT INTO sales_return_items (id, return_id, invoice_item_id, product_id, location_id, quantity, unit_price, total, cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [uuidv4(), id, item.invoice_item_id, item.product_id || invLine.product_id, locId, qty, unitPrice, lineTotal, cost]
      );

      const invRow = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id || invLine.product_id, locId]
      );
      if (invRow.rows.length > 0) {
        const currentQty = parseFloat(invRow.rows[0].quantity);
        const newQty = currentQty + qty;
        await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [newQty, invRow.rows[0].id]);
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
           VALUES ($1, $2, $3, 'Sales Return', $4, 'IN', $5, $6, $7, $8, $9)`,
          [uuidv4(), item.product_id || invLine.product_id, locId, id, qty, newQty, cost, cost * qty, req.user!.id]
        );
      } else {
        await client.query(
          'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)',
          [item.product_id || invLine.product_id, locId, qty, cost]
        );
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
           VALUES ($1, $2, $3, 'Sales Return', $4, 'IN', $5, $6, $7, $8, $9)`,
          [uuidv4(), item.product_id || invLine.product_id, locId, id, qty, qty, cost, cost * qty, req.user!.id]
        );
      }
    }

    await client.query("UPDATE sales_returns SET status = 'Completed', total = $1 WHERE id = $2", [totalReturn, id]);

    if (isEmployee && employeeId) {
      await client.query(
        'UPDATE employees SET grocery_credit_balance = GREATEST(grocery_credit_balance - $1, 0) WHERE id = $2',
        [totalReturn, employeeId]
      );
    } else {
      const custId = customer_id || inv.rows[0].customer_id;
      if (custId) {
        await client.query('UPDATE customers SET balance = GREATEST(balance - $1, 0) WHERE id = $2', [totalReturn, custId]);
      }
    }

    await client.query(
      'UPDATE sales_invoices SET balance = GREATEST(balance - $1, 0), amount_paid = GREATEST(amount_paid - $1, 0) WHERE id = $2',
      [totalReturn, invoice_id]
    );

    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const creditAccount = isEmployee ? '1120' : '1100';

    const returnCategoryMap = await loadCategoryAccountsForProducts(
      client,
      returnGlLines.map((l) => l.product_id),
    );
    const returnRevenueBuckets = aggregateByAccountCode(
      returnGlLines,
      returnCategoryMap,
      'revenue_account_code',
      'revenueAmount',
    );
    const returnCogsBuckets = aggregateGlCogsByAccountCode(returnGlLines, returnCategoryMap);
    const glCogs = postReturnCogs ? sumLineGlCogs(returnGlLines) : 0;
    const netRevenue = returnGlLines.reduce((s, l) => s + (l.revenueAmount || 0), 0);
    const vatAmount = totalReturn - netRevenue;
    const jeTotal = totalReturn + glCogs;

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Sales Return', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `Sales Return ${return_number}`, jeTotal, req.user!.id]
    );

    await insertRevenueDebitLines(
      client, entryId, returnRevenueBuckets, 'Sales Return', id, `Revenue reversal ${return_number}`,
    );
    if (vatAmount > 0.01) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, $4, 0, 'Sales Return', $5)`,
        [uuidv4(), entryId, `VAT reversal ${return_number}`, vatAmount, id]
      );
    }
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $6), $3, 0, $4, 'Sales Return', $5)`,
      [uuidv4(), entryId, `${isEmployee ? 'Employee grocery credit' : 'AR'} credit ${return_number}`, totalReturn, id, creditAccount]
    );
    if (postReturnCogs && glCogs > 0) {
      await insertCogsInventoryReversalLines(
        client, entryId, returnCogsBuckets, 'Sales Return', id, return_number,
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id, return_number, total: totalReturn });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
