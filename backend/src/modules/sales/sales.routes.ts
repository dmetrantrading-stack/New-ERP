import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

const router = Router();

const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-'`
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
router.post('/invoices', authenticate, auditLog('Sales', 'Create Invoice'), async (req: AuthRequest, res: Response) => {
  try {
    const invoice_number = await generateInvoiceNumber();
    const {
      customer_id, customer_name, customer_type, employee_id, price_mode, items, discount,
      payment_method, payment_terms, amount_tendered, due_date, notes, invoice_tax_type, ewt_rate
    } = req.body;
    const ewtPercent = parseFloat(ewt_rate || '0');
    const isEmployee = customer_type === 'Employee';
    const effectivePaymentMethod = isEmployee ? 'Salary Deduction' : (payment_method || 'Cash');

    const id = uuidv4();
    let subtotal = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    let totalLguTax = 0;
    let totalWht = 0;
    let totalVatableSales = 0;
    let totalVatExemptSales = 0;
    let totalZeroRatedSales = 0;

    const invoiceItems = (items || []).map((item: any) => {
      const qty = parseFloat(item.quantity);
      const price = parseFloat(item.unit_price);
      const disc = parseFloat(item.discount || 0);
      const lineTaxType = item.tax_type || invoice_tax_type || 'VAT';
      const gross = qty * price;
      const lineDiscount = gross * (disc / 100);
      const netAfterDisc = gross - lineDiscount;

      let lineTax = 0;
      let lineFinalTotal = netAfterDisc;
      let itemVatableSales = 0;

      if (lineTaxType === 'VAT' || lineTaxType === 'VATable') {
        itemVatableSales = netAfterDisc / 1.12;
        lineTax = netAfterDisc - itemVatableSales;
        lineFinalTotal = netAfterDisc;
        totalVatableSales += itemVatableSales;
        totalVat += lineTax;
        // EWT for VATable: apply ewt_rate on vatable sales if set
        if (ewtPercent > 0) {
          totalWht += itemVatableSales * (ewtPercent / 100);
        }
      } else if (lineTaxType === 'VAT Exempt') {
        totalVatExemptSales += netAfterDisc;
        lineFinalTotal = netAfterDisc;
        // EWT on VAT exempt: apply on gross if ewt_rate set
        if (ewtPercent > 0) {
          totalWht += netAfterDisc * (ewtPercent / 100);
        }
      } else if (lineTaxType === 'Zero Rated') {
        totalZeroRatedSales += netAfterDisc;
        lineFinalTotal = netAfterDisc;
      } else if (lineTaxType === 'LGU' || lineTaxType === 'LGU 5% Final VAT') {
        const netOfVat = netAfterDisc / 1.12;
        const vat12 = netAfterDisc - netOfVat;
        const lgu5 = netOfVat * 0.05;
        const wht1 = netOfVat * 0.01;
        lineTax = vat12;
        totalVat += vat12;
        totalLguTax += lgu5;
        totalWht += wht1;
        totalVatableSales += netOfVat;
        lineFinalTotal = netAfterDisc;
      }

      subtotal += gross;
      totalDiscount += lineDiscount;

      return {
        ...item,
        quantity: qty,
        unit_price: price,
        discount: disc,
        tax_type: lineTaxType,
        tax_amount: lineTax,
        total: lineFinalTotal,
      };
    });

    const total = subtotal - totalDiscount;
    const discountAmount = parseFloat(discount || 0);
    const finalTotal = total - discountAmount;
    const netRevenue = totalVatableSales + totalVatExemptSales + totalZeroRatedSales;
    const amountDue = finalTotal - totalLguTax;

    await query(
      `INSERT INTO sales_invoices (id, invoice_number, customer_id, customer_name, customer_type, employee_id, price_mode, invoice_date,
        due_date, payment_method, payment_terms, status, notes, subtotal, discount, tax, tax_type, total, amount_paid, balance,
        vatable_sales, vat_exempt_sales, zero_rated_sales, vat_amount, lgu_final_tax, withholding_tax,
        cashier_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, $9, $10, 'Posted', $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26)`,
      [id, invoice_number, isEmployee ? null : customer_id, customer_name, customer_type || 'Customer', isEmployee ? employee_id : null,
        price_mode || 'Retail', due_date, effectivePaymentMethod, payment_terms,
        notes, subtotal, discountAmount, totalVat, invoice_tax_type || 'VAT',
        finalTotal, amount_tendered || 0, finalTotal - (amount_tendered || 0),
        totalVatableSales, totalVatExemptSales, totalZeroRatedSales, totalVat, totalLguTax, totalWht,
        req.user!.id, req.user!.id]
    );

    for (const item of invoiceItems) {
      const itemId = uuidv4();
      const locId = item.location_id || 1;

      const inv = await query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, locId]);
      let cost = 0;
      let availableQty = 0;

      if (inv.rows.length > 0) {
        cost = parseFloat(inv.rows[0].unit_cost);
        availableQty = parseFloat(inv.rows[0].quantity);
        if (item.quantity > availableQty) {
          return res.status(400).json({ error: `Insufficient stock at selected location. Available: ${availableQty}, Requested: ${item.quantity}` });
        }
        await query('UPDATE inventory SET quantity = $1 WHERE id = $2', [availableQty - item.quantity, inv.rows[0].id]);
      } else {
        const setting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
        if (setting.rows[0]?.setting_value !== 'true') {
          return res.status(400).json({ error: `No stock found at selected location.` });
        }
      }

      item.cost = cost;
      await query(
        `INSERT INTO sales_invoice_items (id, invoice_id, product_id, variant_id, description, quantity, unit_price, discount, tax, total, cost, location_id, tax_type, vat_amount, selected_variant)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [itemId, id, item.product_id, item.variant_id, item.description, item.quantity, item.unit_price,
         item.discount || 0, item.tax_amount || 0, item.total, cost, locId, item.tax_type || 'VAT', item.tax_amount || 0, item.selected_variant || null]
      );

      await query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
         VALUES ($1, $2, $3, 'Sales Invoice', $4, 'OUT', $5, $6, $7, $8, $9, $10)`,
        [uuidv4(), item.product_id, locId, id, item.quantity, availableQty - item.quantity, cost, item.quantity * cost, null, req.user!.id]
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
    const jeTotal = amountDue + totalCogs;
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

    // Credit Sales Revenue
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
      VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), $3, 0, $4, 'Sales Invoice', $5)`,
      [uuidv4(), entryId, `Revenue ${invoice_number}`, netRevenue, id]);

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

    // Debit COGS, Credit Inventory (net-of-VAT for GL)
    const glCogs = totalCogs / 1.12;
    if (totalCogs > 0) {
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '5000'), $3, $4, 0, 'Sales Invoice', $5),
               ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $7, 0, $4, 'Sales Invoice', $5)`,
        [uuidv4(), entryId, `COGS ${invoice_number}`, glCogs, id, uuidv4(), `Inventory ${invoice_number}`]);
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

router.get('/invoices', authenticate, async (req: AuthRequest, res: Response) => {
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

router.get('/invoices/:id', authenticate, async (req: AuthRequest, res: Response) => {
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
      `SELECT sii.*, p.sku, p.name as product_name
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
router.get('/invoices/:id/print', async (req: any, res: Response) => {
  try {
    // Authenticate via query token
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    let decoded: any;
    try { decoded = jwt.verify(token, config.jwtSecret); }
    catch { return res.status(401).json({ error: 'Invalid token' }); }

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
      `SELECT sii.*, p.sku, p.name as product_name, p.unit_of_measure
       FROM sales_invoice_items sii JOIN products p ON sii.product_id = p.id WHERE sii.invoice_id = $1 ORDER BY sii.id`,
      [req.params.id]
    );

    const totalQty = items.rows.reduce((s: number, r: any) => s + parseFloat(r.quantity), 0);
    const grossTotal = parseFloat(i.subtotal) || 0;
    const discountAmt = parseFloat(i.discount) || 0;
    const afterDiscount = grossTotal - discountAmt;
    const netOfVAT = parseFloat(i.vatable_sales || 0);
    const vatAmount = parseFloat(i.vat_amount || i.tax || 0);
    const total = parseFloat(i.total) || 0;
    const isCash = i.payment_method === 'Cash';
    const invoiceType = isCash ? 'CASH SALES INVOICE' : 'CHARGE SALES INVOICE (CREDIT)';

    const fc = (val: any) => {
      const n = parseFloat(val);
      return isNaN(n) ? '0.00' : n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const itemRows = items.rows.map((row: any, idx: number) => `
      <tr>
        <td style="padding:4px 6px;font-size:10px">${row.product_name || row.description || '-'}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center">${parseFloat(row.quantity)}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center">${row.unit_of_measure || '-'}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right">${fc(row.unit_price)}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right">${fc(row.total)}</td>
      </tr>
    `).join('');

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Sales Invoice ${i.invoice_number}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:10px;color:#111;padding:8mm 10mm;max-width:210mm;margin:0 auto;letter-spacing:0.2px;text-rendering:optimizeSpeed}
.company-header{text-align:center;margin-bottom:8px}
.company-header h1{font-size:18px;font-weight:bold;letter-spacing:4px;margin:0}
.company-header .tagline{font-size:9px;color:#111;margin:3px 0}
.company-header .info{font-size:8px;color:#111;margin:2px 0}
.dot-divider{text-align:center;font-size:11px;font-weight:bold;margin:4px 0;letter-spacing:1px}
.dot-divider-thin{text-align:center;font-size:10px;color:#444;margin:2px 0;letter-spacing:1px}
.invoice-title{text-align:center;border:1px dotted #444;padding:6px 0;margin:8px 0}
.invoice-title h2{font-size:14px;font-weight:bold;letter-spacing:6px;margin:0}
.invoice-title .sub{font-size:9px;color:#333}
.details{display:flex;gap:20px;margin:10px 0}
.details-left{flex:1;border:1px dotted #444;padding:8px 10px}
.details-right{flex:1;border:1px dotted #444;padding:8px 10px}
.details-left .label,.details-right .label{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:5px}
.details p{font-size:9px;margin:2px 0}
.details .highlight{font-weight:bold;font-size:10px;text-decoration:underline}
.items-table{width:100%;border-collapse:collapse;margin:10px 0}
.items-table th{background:#f8f8f8;border:1px dotted #444;padding:5px 6px;font-size:9px;text-align:left;font-weight:bold}
.items-table td{border:1px dotted #444;padding:4px 6px;font-size:9px}
.computation{display:flex;justify-content:flex-end;margin:10px 0}
.comp-table{width:260px;border-collapse:collapse}
.comp-table td{padding:3px 8px;font-size:9px}
.comp-table td:last-child{text-align:right}
.comp-table .total-row{border-top:2px dotted #000;font-size:12px;font-weight:bold}
.compliance{display:flex;gap:20px;margin:12px 0}
.compliance-left{flex:1;border:1px dotted #444;padding:8px 10px}
.compliance-right{flex:1;border:1px dotted #444;padding:8px 10px}
.compliance h4{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:4px}
.compliance p{font-size:8px;line-height:1.4;color:#111}
.signatures{display:flex;justify-content:space-between;margin-top:28px;gap:10px}
.sig-block{text-align:center;flex:1}
.sig-block .sig-line{border-bottom:1px solid #000;height:34px;margin-bottom:4px}
.sig-block .sig-label{font-size:8px;color:#222}
.footer-note{text-align:center;font-size:7px;color:#666;margin-top:14px}
@media print{body{padding:5mm 8mm;font-size:10px}}
</style></head><body>

<!-- Company Header -->
<div class="company-header">
  <h1>${b.business_name || 'D METRAN TRADING'}</h1>
  <div class="tagline">${b.trade_name || 'General Merchandise &amp; Integrated Trade Distribution'}</div>
  <div class="info">${b.address || ''}${b.city ? ', ' + b.city : ''} | Tel: ${b.telephone_number || b.mobile_number || ''} | Email: ${b.email_address || ''}</div>
  <div class="info">TIN: ${b.tin_number || '123-456-789-000'} | ${b.vat_type || 'VAT Registered'}</div>
</div>
<div class="dot-divider">================================================</div>
<div class="dot-divider-thin">------------------------------------------------</div>

<!-- Invoice Title -->
<div class="invoice-title">
  <h2>${invoiceType}</h2>
  <div class="sub">VAT Registered | Non-VAT Invoice upon request</div>
</div>

<!-- Details -->
<div class="details">
  <div class="details-left">
    <div class="label">${isCash ? 'Cash Customer' : 'Charge Customer Account'}</div>
    ${i.customer_type === 'Employee' && i.emp_first
      ? `<p><strong>Name:</strong> ${i.emp_last}, ${i.emp_first}</p>`
      : `<p><strong>Name:</strong> ${i.customer_name || 'Walk-in'}</p>`
    }
    ${i.customer_address ? `<p><strong>Address:</strong> ${i.customer_address}</p>` : ''}
    ${i.customer_tin ? `<p><strong>TIN:</strong> ${i.customer_tin}</p>` : ''}
    ${i.customer_code ? `<p><strong>Customer Code:</strong> ${i.customer_code}</p>` : ''}
    ${i.notes ? `<p><strong>Notes:</strong> ${i.notes}</p>` : ''}
  </div>
  <div class="details-right">
    <div class="label">Invoice Details</div>
    <p><strong>Invoice No:</strong> ${i.invoice_number}</p>
    <p><strong>Date:</strong> ${new Date(i.invoice_date).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'})}</p>
    ${i.payment_terms ? `<p><strong>Credit Terms:</strong> <span class="highlight">${i.payment_terms}</span></p>` : ''}
    ${i.due_date ? `<p><strong>Due Date:</strong> <span class="highlight">${new Date(i.due_date).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'})}</span></p>` : ''}
    <p><strong>Payment Method:</strong> ${i.payment_method || 'N/A'}</p>
    <p><strong>Status:</strong> ${i.status}</p>
  </div>
</div>

<!-- Items Table -->
<table class="items-table">
  <thead><tr>
    <th>Item Description</th>
    <th style="width:50px;text-align:center">Qty</th>
    <th style="width:50px;text-align:center">UOM</th>
    <th style="width:80px;text-align:right">Unit Price</th>
    <th style="width:90px;text-align:right">Line Total</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<!-- Computation Box -->
<div class="computation">
  <table class="comp-table">
    <tr><td>Total Items:</td><td>${items.rows.length}</td></tr>
    <tr><td>Total Quantity:</td><td>${totalQty}</td></tr>
    <tr><td>Trade Subtotal:</td><td>₱${fc(grossTotal)}</td></tr>
    ${discountAmt > 0 ? `<tr><td>Less Discount:</td><td>₱${fc(discountAmt)}</td></tr>` : ''}
    <tr><td>Net of VAT:</td><td>₱${fc(netOfVAT)}</td></tr>
    <tr><td>Output VAT (12%):</td><td>₱${fc(vatAmount)}</td></tr>
    ${parseFloat(i.lgu_final_tax || 0) > 0 ? `<tr><td>LGU Final VAT (5%):</td><td>₱${fc(i.lgu_final_tax)}</td></tr>` : ''}
    ${parseFloat(i.withholding_tax || 0) > 0 ? `<tr><td>Withholding Tax:</td><td>₱${fc(i.withholding_tax)}</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL AMOUNT DUE:</td><td>₱${fc(total)}</td></tr>
    ${isCash ? `
      <tr><td>Amount Tendered:</td><td>₱${fc(i.amount_paid)}</td></tr>
      <tr><td>Change:</td><td>₱${fc(Math.max(0, parseFloat(i.amount_paid) - total))}</td></tr>
    ` : ''}
  </table>
</div>

<!-- Compliance & Terms -->
<div class="compliance">
  <div class="compliance-left">
    <h4>TAXATION COMPLIANCE INFORMATION</h4>
    <p>All values declared herein include Output Value Added Tax (VAT) of 12% in compliance with Bureau of Internal Revenue regulations.</p>
    <p style="margin-top:3px">${b.business_name || 'D METRAN TRADING'} | ${b.vat_type || 'VAT Registered'} TIN #${b.tin_number || '123-456-789-000'}</p>
  </div>
  <div class="compliance-right">
    <h4>TERMS, WARRANTIES &amp; SETTLEMENT CONDITIONS</h4>
    <p>Payment is due strictly within approved credit terms. Interest of 2.5% monthly will accrue on overdue account ledger balances.</p>
    <p style="margin-top:3px">Goods once sold are non-refundable. Warranty claims must be filed within 7 days of receipt.</p>
  </div>
</div>

<!-- Signatures -->
<div class="signatures">
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Checked by</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Approved by</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Received by</div></div>
</div>

<div class="footer-note">
  Printed: ${new Date().toLocaleString('en-PH')} | This is a computer-generated document | Valid without signature
</div>

</body></html>`;

    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Void invoice
router.patch('/invoices/:id/void', authenticate, auditLog('Sales', 'Void Invoice'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { reason } = req.body;
    const invoice = await client.query('SELECT * FROM sales_invoices WHERE id = $1', [req.params.id]);
    if (invoice.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const inv = invoice.rows[0];

    await client.query(
      "UPDATE sales_invoices SET status = 'Void', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [req.params.id]
    );

    // Restore inventory at the original location
    const items = await client.query('SELECT sii.*, inv.location_id FROM sales_invoice_items sii JOIN inventory inv ON sii.product_id = inv.product_id WHERE sii.invoice_id = $1', [req.params.id]);
    for (const item of items.rows) {
      const locId = item.location_id || 1;
      await client.query('UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3',
        [item.quantity, item.product_id, locId]);

      // Inventory ledger entry for void
      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, created_by)
         VALUES ($1, $2, $3, 'Void Invoice', $4, 'IN', $5, $6)`,
        [uuidv4(), item.product_id, locId, req.params.id, item.quantity, req.user!.id]
      );
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
    const jeTotal = finalTotal + totalCogs;

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Void Invoice', $3, $4, $5, $5, $6)`,
      [voidEntryId, voidEntryNumber, req.params.id, `Void Invoice ${inv.invoice_number}`, jeTotal, req.user!.id]
    );

    // Reverse: Debit Revenue, Debit VAT, Credit appropriate AR/Cash account
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES
         ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), $3, $4, 0, 'Void Invoice', $5),
         ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $7, $8, 0, 'Void Invoice', $5),
         ($9, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $10), $11, 0, $12, 'Void Invoice', $5)`,
      [uuidv4(), voidEntryId, `Reverse Revenue ${inv.invoice_number}`, netRevenue, req.params.id,
       uuidv4(), `Reverse VAT ${inv.invoice_number}`, totalTax,
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

    // Reverse COGS: Credit COGS, Debit Inventory
    if (totalCogs > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'Void Invoice', $5),
                ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '5000'), $7, 0, $4, 'Void Invoice', $5)`,
        [uuidv4(), voidEntryId, `Reverse Inventory ${inv.invoice_number}`, totalCogs, req.params.id,
         uuidv4(), `Reverse COGS ${inv.invoice_number}`]
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
    res.json({ message: 'Invoice voided' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Edit invoice
router.patch('/invoices/:id', authenticate, auditLog('Sales', 'Edit Invoice'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const inv = await client.query('SELECT * FROM sales_invoices WHERE id = $1', [req.params.id]);
    if (inv.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const old = inv.rows[0];
    if (!['Draft','Posted','Partial'].includes(old.status)) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: `Cannot edit invoice with status ${old.status}` });
    }

    const { customer_id, customer_name, customer_type, employee_id, price_mode, due_date,
            payment_method, payment_terms, notes, invoice_tax_type, ewt_rate, items } = req.body;
    if (!items || items.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Items required' }); }

    const ewtPercent = parseFloat(ewt_rate || '0');

    // ---- Reverse old ----
    const oldItems = await client.query('SELECT sii.*, i.location_id FROM sales_invoice_items sii JOIN inventory i ON sii.product_id = i.product_id WHERE sii.invoice_id = $1', [req.params.id]);
    for (const oi of oldItems.rows) {
      await client.query('UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3', [oi.quantity, oi.product_id, oi.location_id || 1]);
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
    const invoiceItems = (items || []).map((item: any) => {
      const qty = parseFloat(item.quantity || '0');
      const price = parseFloat(item.unit_price || '0');
      const disc = parseFloat(item.discount || '0');
      const gross = qty * price;
      const discountAmt = gross * (disc / 100);
      const netAfterDisc = gross - discountAmt;
      const taxType = item.tax_type || invoice_tax_type || 'VAT';
      let lineTax = 0, itemVatable = 0, itemVat = 0, itemLgu = 0, itemWht = 0, lineFinal = 0;
      if (taxType === 'VAT' || taxType === 'VATable') {
        itemVatable = netAfterDisc / 1.12; lineTax = netAfterDisc - itemVatable;
        if (ewtPercent > 0) itemWht = itemVatable * (ewtPercent / 100);
        lineFinal = netAfterDisc;
      } else if (taxType === 'VAT Exempt') {
        itemVatable = netAfterDisc; lineFinal = netAfterDisc;
        if (ewtPercent > 0) itemWht = netAfterDisc * (ewtPercent / 100);
      } else if (taxType === 'LGU' || taxType === 'LGU 5% Final VAT') {
        const nv = netAfterDisc / 1.12; lineTax = netAfterDisc - nv;
        itemLgu = nv * 0.05; itemWht = nv * 0.01; itemVatable = nv; lineFinal = netAfterDisc;
      }
      return { ...item, quantity: qty, unit_price: price, discount: disc, tax_type: taxType, tax_amount: lineTax,
        total: lineFinal, vatable: itemVatable, vat: lineTax - itemLgu, lgu: itemLgu, wht: itemWht, gross, discountAmt, netAfterDisc };
    });

    let totalSubtotal = 0, totalDisc = 0, totalVatable = 0, totalVat = 0, totalLgu = 0, totalWht = 0, totalCogs = 0;
    for (const item of invoiceItems) {
      totalSubtotal += item.gross; totalDisc += item.discountAmt; totalVatable += item.vatable;
      totalVat += item.vat; totalLgu += item.lgu; totalWht += item.wht;
      const locId = item.location_id || 1;
      const invRow = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, locId]);
      const cost = invRow.rows[0] ? parseFloat(invRow.rows[0].unit_cost) : 0;
      const avQty = invRow.rows[0] ? parseFloat(invRow.rows[0].quantity) : 0;
      item.cost = cost;
      if (item.quantity > avQty) {
        const setting = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
        if (setting.rows[0]?.setting_value !== 'true') { await client.query('ROLLBACK'); return res.status(400).json({ error: `Insufficient stock for ${item.description || item.product_id}` }); }
      }
      await client.query('UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3', [item.quantity, item.product_id, locId]);
      const newQty = avQty - item.quantity;
      await client.query(`INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
        VALUES ($1,$2,$3,'Sales Invoice Edit',$4,'OUT',$5,$6,$7,$8,$9)`, [uuidv4(), item.product_id, locId, req.params.id, item.quantity, newQty, cost, item.quantity * cost, req.user!.id]);
      totalCogs += item.quantity * cost;

      await client.query(`INSERT INTO sales_invoice_items (id, invoice_id, product_id, variant_id, description, quantity, unit_price, discount, tax, total, cost, location_id, tax_type, vat_amount, selected_variant)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [uuidv4(), req.params.id, item.product_id, item.variant_id, item.description, item.quantity, item.unit_price,
         item.discount || 0, item.tax_amount || 0, item.total, cost, locId, item.tax_type || 'VAT', item.tax_amount || 0, item.selected_variant || null]);
    }

    const finalTotal = totalSubtotal - totalDisc;
    const amountDue = finalTotal - totalLgu;

    await client.query(`UPDATE sales_invoices SET customer_id=$1, customer_name=$2, customer_type=$3, employee_id=$4, price_mode=$5,
      due_date=$6, payment_method=$7, payment_terms=$8, notes=$9, subtotal=$10, discount=$11, tax=$12, tax_type=$13, total=$14,
      vatable_sales=$15, vat_amount=$16, lgu_final_tax=$17, withholding_tax=$18, balance=$19, updated_at=CURRENT_TIMESTAMP WHERE id=$20`,
      [customer_type === 'Employee' ? null : customer_id, customer_name, customer_type || 'Customer', customer_type === 'Employee' ? employee_id : null,
       price_mode || 'Retail', due_date, payment_method, payment_terms, notes, totalSubtotal, totalDisc, totalVat, invoice_tax_type || 'VAT',
       finalTotal, totalVatable, totalVat, totalLgu, totalWht, finalTotal - parseFloat(old.amount_paid), req.params.id]);

    if (customer_type === 'Employee' && employee_id) {
      await client.query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance + $1 WHERE id = $2', [amountDue, employee_id]);
    } else if (customer_id) {
      await client.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [amountDue, customer_id]);
    }

    // New journal entry
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const netRevenue = totalVatable + (items.filter((i:any) => i.tax_type === 'VAT Exempt').reduce((s:number,i:any)=>s+(parseFloat(i.quantity)*parseFloat(i.unit_price)),0));
    const glCogs = totalCogs / 1.12;
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
    await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
      VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='4000'),$3,0,$4,'Sales Invoice',$5)`, [uuidv4(), entryId, `Revenue ${old.invoice_number}`, netRevenue, req.params.id]);
    if (totalVat > 0) {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='2100'),$3,0,$4,'Sales Invoice',$5)`, [uuidv4(), entryId, `VAT ${old.invoice_number}`, totalVat, req.params.id]);
    }
    if (totalLgu > 0) {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='2110'),$3,0,$4,'Sales Invoice',$5)`, [uuidv4(), entryId, `LGU Final VAT ${old.invoice_number}`, totalLgu, req.params.id]);
    }
    if (totalCogs > 0) {
      await client.query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='5000'),$3,$4,0,'Sales Invoice',$5),
               ($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1200'),$7,0,$4,'Sales Invoice',$5)`,
        [uuidv4(), entryId, `COGS ${old.invoice_number}`, glCogs, req.params.id, uuidv4(), `Inventory ${old.invoice_number}`]);
    }
    await client.query('COMMIT');
    res.json({ id: req.params.id, invoice_number: old.invoice_number });
  } catch (error: any) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

// ==================== COLLECTION RECEIPTS ====================
router.post('/collections', authenticate, auditLog('Sales', 'Create Collection'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_id, invoice_id, payment_method, reference_number, amount, notes, bank_account_id, collection_date, ewt_amount, lgu_amount, allocations, check_date, check_bank } = req.body;

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
        `INSERT INTO collection_receipts (id, receipt_number, customer_id, payment_date, payment_method, reference_number, bank_account_id, amount, notes, check_date, check_bank, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [receiptId, receipt_number, customer_id, payDate, payment_method, reference_number, bank_account_id || null, totalApplied, notes, check_date || null, check_bank || null, req.user!.id]
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
         VALUES ($1,$2,CURRENT_DATE,'Collection',$3,$4,$5,$5,$6)`,
        [entryId, entryNumber, receiptId, `Collection ${receipt_number}`, totalApplied, req.user!.id]
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
           VALUES ($1,$2,'Deposit',$3,CURRENT_DATE,$4,$5)`,
          [uuidv4(), bank_account_id, totalCash, `Collection ${receipt_number}`, req.user!.id]
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
      `INSERT INTO collection_receipts (id, receipt_number, customer_id, invoice_id, payment_date, payment_method, reference_number, bank_account_id, amount, notes, check_date, check_bank, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, receipt_number, customer_id, invoice_id, payDate, payment_method, reference_number, bank_account_id || null, appliedAmount, notes, check_date || null, check_bank || null, req.user!.id]
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
       VALUES ($1, $2, CURRENT_DATE, 'Collection', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `Collection ${receipt_number}`, appliedAmount, req.user!.id]
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
         VALUES ($1, $2, 'Deposit', $3, CURRENT_DATE, $4, $5)`,
        [uuidv4(), bank_account_id, cashCollected, `Collection ${receipt_number}`, req.user!.id]
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
router.get('/outstanding-ar', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT si.id AS invoice_id, si.invoice_number, si.invoice_date, si.due_date, si.total,
             si.subtotal, si.discount, si.amount_paid, si.balance, si.status, si.customer_name, si.customer_id,
             si.tax_type, si.vatable_sales, si.vat_exempt_sales, si.zero_rated_sales,
             si.vat_amount, si.lgu_final_tax, si.withholding_tax,
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

router.get('/collections', authenticate, async (req: AuthRequest, res: Response) => {
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
router.get('/customer-statements', authenticate, async (req: AuthRequest, res: Response) => {
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
router.get('/customer-statement/:customerId', authenticate, async (req: AuthRequest, res: Response) => {
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

// Customer Statement Print — dot-matrix
router.get('/customer-statement/:customerId/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const cust = await query('SELECT * FROM customers WHERE id = $1', [req.params.customerId]);
    if (cust.rows.length === 0) return res.status(404).send('Not found');
    const c = cust.rows[0];

    const invoices = await query(
      `SELECT * FROM sales_invoices WHERE customer_id = $1 AND status IN ('Posted','Partial','Overdue') AND balance > 0 ORDER BY invoice_date ASC`,
      [req.params.customerId]
    );

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const bizName = 'D METRAN TRADING';
    const bizProp = 'Donnel M. Metran - Prop.';
    const bizVat = 'VAT REG TIN: 418 944 134 000';
    const bizAddress = 'New Public Market, Sta. Cruz, Zambales 2213';

    const totalOutstanding = invoices.rows.reduce((s: number, i: any) => s + parseFloat(i.balance), 0);
    const fmtCurrency = (n: number) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

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

    const rows = invoices.rows.map((i: any) => {
      const days = Math.floor((new Date().getTime() - new Date(i.invoice_date).getTime()) / 86400000);
      const daysDue = Math.floor((new Date().getTime() - new Date(i.due_date || i.invoice_date).getTime()) / 86400000);
      return `<tr><td>${fmtDate(i.invoice_date)}</td><td>${i.invoice_number}</td><td>${i.notes || ''}</td><td class="right">${fmtCurrency(parseFloat(i.total))}</td><td class="right">${Math.max(0, daysDue)}</td><td class="right">${fmtCurrency(parseFloat(i.balance))}</td></tr>`;
    }).join('');

    const style = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:10px;color:#111;padding:8mm 10mm;max-width:210mm;margin:0 auto}.header{display:flex;justify-content:space-between;margin-bottom:10px}.header-left h2{font-size:16px;font-weight:bold;margin:0}.header-left p{font-size:9px;margin:2px 0}.header-right{text-align:right;font-size:9px}.header-right p{margin:2px 0}.doc-title{text-align:center;border:1px dotted #444;padding:6px 0;margin:10px 0}.doc-title h2{font-size:14px;font-weight:bold;letter-spacing:6px;margin:0}table{width:100%;border-collapse:collapse;margin:8px 0}th{background:#f8f8f8;border:1px dotted #444;padding:5px 6px;font-size:9px;text-align:left;font-weight:bold}td{border:1px dotted #444;padding:4px 6px;font-size:9px}td.right{text-align:right}.aging{display:flex;gap:6px;margin:8px 0}.aging-box{flex:1;border:1px dotted #444;padding:5px;text-align:center}.aging-box .amt{font-size:11px;font-weight:bold}.aging-box .lbl{font-size:7px;text-transform:uppercase;color:#555}.total-row{text-align:right;font-size:14px;font-weight:bold;border-top:2px dotted #000;padding-top:4px;margin-top:8px}.footer{text-align:center;font-size:7px;color:#666;margin-top:12px;border-top:1px dotted #999;padding-top:4px}@media print{body{padding:4mm 6mm}}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Statement - ${c.customer_name}</title><style>${style}</style></head><body>
<div class="header">
  <div class="header-left"><h2>Statement</h2><p>${c.customer_name || ''}</p><p>${c.address || ''}</p><p>${c.contact_person || ''}</p></div>
  <div class="header-right"><p>${bizName}</p><p>${bizProp}</p><p>${bizVat}</p><p>${bizAddress}</p></div>
</div>
<div class="doc-title"><h2>STATEMENT OF ACCOUNT</h2></div>
<p style="font-size:9px;margin-bottom:6px"><strong>Date:</strong> ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</p>
<table>
<thead><tr><th>Date</th><th>Invoice No.</th><th>Description</th><th style="text-align:right">Total</th><th style="text-align:right">Overdue Days</th><th style="text-align:right">Balance Due</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center">No unpaid invoices</td></tr>'}</tbody>
</table>
<div class="aging">
<div class="aging-box"><div class="amt">${fmtCurrency(aged.current)}</div><div class="lbl">Current</div></div>
<div class="aging-box"><div class="amt">${fmtCurrency(aged.d30)}</div><div class="lbl">1-30 Days</div></div>
<div class="aging-box"><div class="amt">${fmtCurrency(aged.d60)}</div><div class="lbl">31-60 Days</div></div>
<div class="aging-box"><div class="amt">${fmtCurrency(aged.d90)}</div><div class="lbl">61-90 Days</div></div>
<div class="aging-box"><div class="amt">${fmtCurrency(aged.over90)}</div><div class="lbl">90+ Days</div></div>
</div>
<div class="total-row">Total Outstanding: ${fmtCurrency(totalOutstanding)}</div>
<div class="footer">Printed: ${new Date().toLocaleString('en-PH')} | Statement of Account</div>
</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Collection Receipt Print — dot-matrix
router.get('/collection-receipt/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

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
      `SELECT cra.*, si.invoice_number, si.invoice_date, si.total as invoice_total, si.balance as invoice_balance
       FROM collection_receipt_allocations cra
       JOIN sales_invoices si ON cra.invoice_id = si.id
       WHERE cra.receipt_id = $1 ORDER BY si.invoice_date`,
      [req.params.id]
    );

    const bizName = 'D METRAN TRADING';
    const fmtCurrency = (n: number) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const total = parseFloat(d.amount) || 0;

    const allocRows = allocations.rows.map((a: any) =>
      `<tr><td>${a.invoice_number}</td><td>${fmtDate(a.invoice_date)}</td><td class="right">${fmtCurrency(parseFloat(a.invoice_total))}</td><td class="right">${fmtCurrency(parseFloat(a.applied_amount))}</td></tr>`
    ).join('');

    const style = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:10px;color:#111;padding:8mm 10mm;max-width:210mm;margin:0 auto}.header{text-align:center;margin-bottom:8px}.header h1{font-size:16px;font-weight:bold;letter-spacing:3px;margin:0}.header p{font-size:9px;margin:2px 0}.dot-divider{text-align:center;font-size:10px;font-weight:bold;margin:4px 0}.doc-title{text-align:center;border:1px dotted #444;padding:5px 0;margin:8px 0}.doc-title h2{font-size:13px;font-weight:bold;letter-spacing:5px;margin:0}.info{display:flex;gap:15px;margin:8px 0}.info-box{flex:1;border:1px dotted #444;padding:6px 8px}.info-box .lbl{font-size:8px;font-weight:bold;text-transform:uppercase;margin-bottom:4px}.info-box p{font-size:9px;margin:1px 0}table{width:100%;border-collapse:collapse;margin:8px 0}th{background:#f8f8f8;border:1px dotted #444;padding:4px 5px;font-size:8px;text-align:left;font-weight:bold}td{border:1px dotted #444;padding:3px 5px;font-size:8px}td.right{text-align:right}.total{text-align:right;font-size:13px;font-weight:bold;border-top:2px dotted #000;padding-top:4px;margin-top:8px}.signatures{display:flex;justify-content:space-between;margin-top:20px;gap:10px}.sig-block{text-align:center;flex:1}.sig-block .sig-line{border-bottom:1px dotted #444;height:25px;margin-bottom:3px}.sig-block .sig-label{font-size:8px;text-transform:uppercase}.footer{text-align:center;font-size:7px;color:#666;margin-top:10px;border-top:1px dotted #999;padding-top:4px}@media print{body{padding:4mm 6mm}}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CR ${d.receipt_number}</title><style>${style}</style></head><body>
<div class="header"><h1>${bizName}</h1><p>Donnel M. Metran - Prop. | VAT REG TIN: 418 944 134 000</p><p>New Public Market, Sta. Cruz, Zambales 2213</p></div>
<div class="dot-divider">. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .</div>
<div class="doc-title"><h2>COLLECTION RECEIPT</h2></div>
<div class="info">
<div class="info-box"><div class="lbl">Receipt Details</div><p><strong>CR #:</strong> ${d.receipt_number}</p><p><strong>Date:</strong> ${fmtDate(d.payment_date)}</p><p><strong>Method:</strong> ${d.payment_method || '—'}</p>${d.reference_number ? '<p><strong>Ref:</strong> ' + d.reference_number + '</p>' : ''}${d.check_date ? '<p><strong>Check Date:</strong> ' + fmtDate(d.check_date) + '</p>' : ''}${d.check_bank ? '<p><strong>Bank:</strong> ' + d.check_bank + '</p>' : ''}</div>
<div class="info-box"><div class="lbl">Customer</div><p><strong>Name:</strong> ${d.customer_name || '—'}</p><p><strong>Code:</strong> ${d.customer_code || '—'}</p><p><strong>Address:</strong> ${d.customer_address || '—'}</p></div>
</div>
<table>
<thead><tr><th>Invoice #</th><th>Date</th><th style="text-align:right">Invoice Total</th><th style="text-align:right">Applied</th></tr></thead>
<tbody>${allocRows || '<tr><td colspan="4" style="text-align:center">No allocations</td></tr>'}</tbody>
</table>
<div class="total">Total Received: ${fmtCurrency(total)}</div>
${d.notes ? '<div style="border:1px dotted #444;padding:5px 8px;margin:6px 0;font-size:9px"><strong>Notes:</strong> ' + d.notes + '</div>' : ''}
<div class="signatures">
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by</div></div>
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Received by</div></div>
</div>
<div class="footer">Printed: ${new Date().toLocaleString('en-PH')} | Collection Receipt</div>
</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
