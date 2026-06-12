import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

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

// ==================== POS SHIFTS ====================
router.post('/shifts/open', authenticate, auditLog('POS', 'Shift Open'), async (req: AuthRequest, res: Response) => {
  try {
    const shift_number = await generateRefNumber('SH', 'pos_shifts', 'shift_number');
    const { opening_cash } = req.body;

    // Check if user has open shift
    const openShift = await query("SELECT id FROM pos_shifts WHERE user_id = $1 AND status = 'Open'", [req.user!.id]);
    if (openShift.rows.length > 0) {
      return res.status(400).json({ error: 'You have an open shift. Close it first.' });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO pos_shifts (id, user_id, shift_number, opening_cash, status)
       VALUES ($1, $2, $3, $4, 'Open')`,
      [id, req.user!.id, shift_number, opening_cash || 0]
    );

    // Cash transaction
    await query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
       VALUES ($1, $2, 'Opening', $3, 'POS Shift', $4, $5, $6)`,
      [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), opening_cash || 0, id, `Opening cash for shift ${shift_number}`, req.user!.id]
    );

    // Journal entry for opening cash
    if (parseFloat(opening_cash || '0') > 0) {
      const entryId = uuidv4();
      const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
      await query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
         VALUES ($1, $2, CURRENT_DATE, 'POS Shift Open', $3, $4, $5, $5, $6)`,
        [entryId, entryNumber, id, `Opening cash for shift ${shift_number}`, opening_cash, req.user!.id]
      );
      await query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), $3, $4, 0, 'POS Shift Open', $5),
                ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '3000'), $7, 0, $4, 'POS Shift Open', $5)`,
        [uuidv4(), entryId, `Opening Cash ${shift_number}`, opening_cash, id,
         uuidv4(), `Opening Cash ${shift_number}`]
      );
    }

    res.status(201).json({ id, shift_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shifts/close', authenticate, auditLog('POS', 'Shift Close'), async (req: AuthRequest, res: Response) => {
  try {
    const { closing_cash, notes } = req.body;
    const shift = await query(
      "SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC LIMIT 1",
      [req.user!.id]
    );
    if (shift.rows.length === 0) return res.status(404).json({ error: 'No open shift found' });

    const s = shift.rows[0];
    const expectedCash = parseFloat(s.opening_cash) + parseFloat(s.cash_sales) - parseFloat(s.return_total);
    const variance = parseFloat(closing_cash || 0) - expectedCash;

    await query(
      `UPDATE pos_shifts SET closing_date = CURRENT_TIMESTAMP, closing_cash = $1, expected_cash = $2, net_sales = $3, status = 'Closed', notes = $4 WHERE id = $5`,
      [closing_cash, expectedCash, s.total_sales, notes, s.id]
    );

    // Cash count transaction
    await query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
       VALUES ($1, $2, 'Cash Count', $3, 'POS Shift', $4, $5, $6)`,
      [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), closing_cash || 0, s.id, `Closing shift. Variance: ${variance}`, req.user!.id]
    );

    // Journal entry for closing variance
    if (Math.abs(variance) > 0.01) {
      const entryId = uuidv4();
      const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
      const absVariance = Math.abs(variance);
      const isOverage = variance > 0;
      await query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
         VALUES ($1, $2, CURRENT_DATE, 'POS Shift Close', $3, $4, $5, $5, $6)`,
        [entryId, entryNumber, s.id, `Shift variance: ${variance.toFixed(2)}`, absVariance, req.user!.id]
      );
      await query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, 'POS Shift Close', $6),
                ($7, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $8), $9, 0, $5, 'POS Shift Close', $6)`,
        [uuidv4(), entryId, isOverage ? '1000' : '6080', `Shift Variance`, absVariance, s.id,
         uuidv4(), isOverage ? '4200' : '1000', `Shift Variance`]
      );
    }

    res.json({ message: 'Shift closed', expected_cash: expectedCash, variance, closing_cash: closing_cash || 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/shifts/current', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await query(
      "SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC LIMIT 1",
      [req.user!.id]
    );
    res.json(shift.rows[0] || null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all shifts
router.get('/shifts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const { status, user_id } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status) {
      whereClause += ` AND ps.status = $${paramIdx++}`;
      params.push(status);
    }
    if (user_id) {
      whereClause += ` AND ps.user_id = $${paramIdx++}`;
      params.push(user_id);
    }

    const total = await query(`SELECT COUNT(*) FROM pos_shifts ps ${whereClause}`, params);
    const result = await query(
      `SELECT ps.*, u.full_name as user_name
       FROM pos_shifts ps
       LEFT JOIN users u ON ps.user_id = u.id
       ${whereClause}
       ORDER BY ps.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single shift with transactions
router.get('/shifts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await query(
      `SELECT ps.*, u.full_name as user_name
       FROM pos_shifts ps
       LEFT JOIN users u ON ps.user_id = u.id
       WHERE ps.id = $1`,
      [req.params.id]
    );
    if (shift.rows.length === 0) return res.status(404).json({ error: 'Shift not found' });

    const transactions = await query(
      `SELECT pt.*, u.full_name as cashier_name
       FROM pos_transactions pt
       LEFT JOIN users u ON pt.cashier_id = u.id
       WHERE pt.shift_id = $1
       ORDER BY pt.created_at DESC`,
      [shift.rows[0].id]
    );

    res.json({ ...shift.rows[0], transactions: transactions.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== POS TRANSACTIONS ====================
router.post('/transactions', authenticate, auditLog('POS', 'Sale'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const transaction_number = await generateRefNumber('POS', 'pos_transactions', 'transaction_number');
    const {
      shift_id, customer_id, customer_name, price_mode, items, payment_method,
      payment_details, amount_tendered, location_id
    } = req.body;
    if (!location_id) throw new Error('Location ID is required');

    // Validate shift
    if (shift_id) {
      const shift = await client.query('SELECT * FROM pos_shifts WHERE id = $1 AND status = $2', [shift_id, 'Open']);
      if (shift.rows.length === 0) return res.status(400).json({ error: 'Shift is not open' });
    }

    const id = uuidv4();
    let subtotal = 0;
    let discountTotal = 0;
    let total = 0;

    const transactionItems = (items || []).map((item: any) => {
      const qty = parseFloat(item.quantity);
      const price = parseFloat(item.unit_price);
      const disc = parseFloat(item.discount || 0);
      const lineTotal = qty * price;
      const lineDiscount = lineTotal * (disc / 100);
      const lineFinal = lineTotal - lineDiscount;

      subtotal += lineTotal;
      discountTotal += lineDiscount;
      total += lineFinal;

      return { ...item, quantity: qty, unit_price: price, discount: disc, total: lineFinal };
    });

    // Per-item tax computation based on product settings
    let totalVatable = 0;
    let totalVat = 0;
    let totalVatExempt = 0;
    let totalZeroRated = 0;
    const productIds = [...new Set(transactionItems.map((i: any) => i.product_id))];
    const productTaxMap: Record<string, { tax_type: string; price_type: string }> = {};
    if (productIds.length > 0) {
      const prodResult = await client.query(
        `SELECT id, tax_type, price_type FROM products WHERE id = ANY($1::uuid[])`,
        [productIds]
      );
      for (const p of prodResult.rows) {
        productTaxMap[p.id] = { tax_type: p.tax_type || 'VAT', price_type: p.price_type || 'VAT Inclusive' };
      }
    }

    for (const item of transactionItems) {
      const tax = productTaxMap[item.product_id] || { tax_type: 'VAT', price_type: 'VAT Inclusive' };
      const lineFinal = item.total;
      if (tax.tax_type === 'VAT Exempt') {
        totalVatExempt += lineFinal;
      } else if (tax.tax_type === 'Zero Rated') {
        totalZeroRated += lineFinal;
      } else if (tax.tax_type === 'VAT' || tax.tax_type === 'VATable') {
        if (tax.price_type === 'VAT Inclusive') {
          const net = lineFinal / 1.12;
          totalVatable += net;
          totalVat += lineFinal - net;
        } else {
          totalVatable += lineFinal;
          totalVat += lineFinal * 0.12;
        }
      } else {
        // LGU or other — treat as VAT-inclusive for now
        const net = lineFinal / 1.12;
        totalVatable += net;
        totalVat += lineFinal - net;
      }
    }

    const grossTotal = total;
    const vatAmount = totalVat;

    await client.query(
      `INSERT INTO pos_transactions (id, transaction_number, shift_id, customer_id, customer_name, price_mode,
        subtotal, discount_total, tax_total, total, payment_method, payment_details, amount_tendered, change_amount,
        status, cashier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'Completed', $15)`,
      [id, transaction_number, shift_id, customer_id, customer_name, price_mode || 'Retail',
        subtotal, discountTotal, vatAmount, grossTotal, payment_method,
        payment_details ? JSON.stringify(payment_details) : null,
        amount_tendered || grossTotal, Math.max(0, parseFloat(amount_tendered || 0) - grossTotal),
        req.user!.id]
    );

    for (const item of transactionItems) {
      const itemId = uuidv4();
      const costResult = await client.query('SELECT unit_cost FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, location_id]);
      const cost = costResult.rows[0]?.unit_cost || 0;
      item.cost = cost; // Store for COGS calculation later

      await client.query(
        `INSERT INTO pos_transaction_items (id, transaction_id, product_id, variant_id, description, quantity, unit_price, discount, total, cost, selected_variant)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [itemId, id, item.product_id, item.variant_id, item.description, item.quantity, item.unit_price,
         item.discount || 0, item.total, cost, item.selected_variant || null]
      );

      // Deduct inventory
      const locId = location_id;
      const inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, locId]);
      if (inv.rows.length > 0) {
        const newQty = parseFloat(inv.rows[0].quantity) - item.quantity;
        const setting = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
        if (newQty < 0 && setting.rows[0]?.setting_value !== 'true') {
          throw new Error(`Insufficient stock for ${item.description || item.product_id}`);
        }
        await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [newQty, inv.rows[0].id]);
      }

      // Inventory ledger
      const ledgerQty = inv.rows[0] ? parseFloat(inv.rows[0].quantity) - item.quantity : -item.quantity;
      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
         VALUES ($1, $2, $3, 'POS Sale', $4, 'OUT', $5, $6, $7, $8, $9)`,
        [uuidv4(), item.product_id, locId, id, item.quantity, ledgerQty, cost, item.quantity * cost, req.user!.id]
      );
    }

    // Update shift totals
    if (shift_id) {
      if (payment_method === 'Cash') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, cash_sales = cash_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [grossTotal, discountTotal, grossTotal, shift_id]);
      } else if (payment_method === 'GCash') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, gcash_sales = gcash_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [grossTotal, discountTotal, grossTotal, shift_id]);
      } else if (payment_method === 'Maya') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, maya_sales = maya_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [grossTotal, discountTotal, grossTotal, shift_id]);
      } else if (payment_method === 'Credit Card') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, card_sales = card_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [grossTotal, discountTotal, grossTotal, shift_id]);
      } else if (payment_method === 'Bank Transfer') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, bank_transfer_sales = bank_transfer_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [grossTotal, discountTotal, grossTotal, shift_id]);
      } else {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, charge_sales = charge_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [grossTotal, discountTotal, grossTotal, shift_id]);
      }
    }

    // Update customer balance for charge sales
    if (customer_id && payment_method === 'Charge') {
      await client.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [grossTotal, customer_id]);
    }

    // Accounting entries
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const totalCost = transactionItems.reduce((sum: number, i: any) => sum + (i.quantity * (i.cost || 0)), 0);
    // GL COGS uses net-of-VAT cost (inventory stored VAT-inclusive for operational GP)
    const glCogs = totalCost / 1.12;
    const jeTotal = grossTotal + glCogs;

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'POS Sale', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `POS Transaction ${transaction_number}`, jeTotal, req.user!.id]
    );

    // Debit appropriate account based on payment method
    const debitAccountMap: Record<string, string> = {
      Cash: '1000',
      GCash: '1000',
      Maya: '1000',
      'Credit Card': '1000',
      'Bank Transfer': '1010',
      Charge: '1100',
      'Salary Deduction': '1120',
    };
    const debitAccount = debitAccountMap[payment_method] || '1000';
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, 'POS Sale', $6)`,
      [uuidv4(), entryId, debitAccount, `${payment_method} Sales ${transaction_number}`, grossTotal, id]
    );

    const revenueTotal = totalVatable + totalVatExempt + totalZeroRated;
    // Credit Sales Revenue
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), $3, 0, $4, 'POS Sale', $5)`,
      [uuidv4(), entryId, `Sales Revenue ${transaction_number}`, revenueTotal, id]
    );

    // Credit VAT Payable
    if (vatAmount > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, 0, $4, 'POS Sale', $5)`,
        [uuidv4(), entryId, `VAT ${transaction_number}`, vatAmount, id]
      );
    }

    // Debit Cost of Sales / Credit Inventory
    if (totalCost > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '5000'), $3, $4, 0, 'POS Sale', $5),
                ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $7, 0, $4, 'POS Sale', $5)`,
        [uuidv4(), entryId, `COGS ${transaction_number}`, glCogs, id,
         uuidv4(), `Inventory ${transaction_number}`]
      );
    }

    // Cash transaction only for cash-type payments
    if (['Cash', 'GCash', 'Maya'].includes(payment_method)) {
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Cash In', $3, 'POS Sale', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), grossTotal, id, `POS Sale ${transaction_number}`, req.user!.id]
      );
    }

    // Bank transaction for bank transfer payments
    if (payment_method === 'Bank Transfer') {
      const bank = await client.query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1');
      if (bank.rows.length > 0) {
        await client.query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1, $2, 'Deposit', $3, CURRENT_DATE, $4, $5)`,
          [uuidv4(), bank.rows[0].id, grossTotal, `POS Sale ${transaction_number}`, req.user!.id]
        );
        await client.query(`UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [grossTotal, bank.rows[0].id]);
      }
    }

    // Employee Grocery Credit: create sales_invoice for salary deduction
    if (payment_method === 'Salary Deduction' && customer_id) {
      const emp = await client.query('SELECT id, employee_code FROM employees WHERE id = $1', [customer_id]);
      if (emp.rows.length > 0) {
        const invNumber = `SI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        const siId = uuidv4();
        await client.query(
          `INSERT INTO sales_invoices (id, invoice_number, customer_type, employee_id, customer_name, price_mode, invoice_date, payment_method, payment_terms, status, subtotal, discount, tax, tax_type, total, amount_paid, balance, cashier_id, created_by)
           VALUES ($1,$2,'Employee',$3,$4,$5,CURRENT_DATE,'Salary Deduction','Salary Deduction','Posted',$6,$7,$8,'VAT',$9,0,$10,$11,$12)`,
          [siId, invNumber, emp.rows[0].id, `Employee ${emp.rows[0].employee_code}`, price_mode || 'Retail',
           subtotal, discountTotal, totalVat, grossTotal, grossTotal, req.user!.id, req.user!.id]
        );
        for (const item of transactionItems) {
          await client.query(
            `INSERT INTO sales_invoice_items (id, invoice_id, product_id, description, quantity, unit_price, discount, tax, total, cost, location_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [uuidv4(), siId, item.product_id, item.description, item.quantity, item.unit_price, item.discount || 0, 0, item.total, item.cost || 0, location_id]
          );
        }
        await client.query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance + $1 WHERE id = $2', [grossTotal, emp.rows[0].id]);
      }
    }

    await client.query('COMMIT');
    const grossProfit = grossTotal - totalCost;
    const marginPct = grossTotal > 0 ? ((grossProfit / grossTotal) * 100) : 0;
    res.status(201).json({
      id, transaction_number,
      total: grossTotal,
      total_cost: totalCost,
      gross_profit: grossProfit,
      margin_pct: Math.round(marginPct * 100) / 100,
      change: Math.max(0, parseFloat(amount_tendered || 0) - grossTotal),
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get current shift transactions
router.get('/transactions/current', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await query(
      "SELECT id FROM pos_shifts WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC LIMIT 1",
      [req.user!.id]
    );
    if (shift.rows.length === 0) return res.json({ data: [], total: 0 });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const total = await query('SELECT COUNT(*) FROM pos_transactions WHERE shift_id = $1', [shift.rows[0].id]);
    const result = await query(
      `SELECT pt.*, u.full_name as cashier_name
       FROM pos_transactions pt
       LEFT JOIN users u ON pt.cashier_id = u.id
       WHERE pt.shift_id = $1
       ORDER BY pt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [shift.rows[0].id, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get ALL transactions (across all shifts)
router.get('/transactions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const { status, cashier_id, date_from, date_to } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status) {
      whereClause += ` AND pt.status = $${paramIdx++}`;
      params.push(status);
    }
    if (cashier_id) {
      whereClause += ` AND pt.cashier_id = $${paramIdx++}`;
      params.push(cashier_id);
    }
    if (date_from) {
      whereClause += ` AND pt.created_at >= $${paramIdx++}`;
      params.push(date_from);
    }
    if (date_to) {
      whereClause += ` AND pt.created_at <= $${paramIdx++}`;
      params.push(date_to);
    }

    const total = await query(`SELECT COUNT(*) FROM pos_transactions pt ${whereClause}`, params);
    const result = await query(
      `SELECT pt.*, u.full_name as cashier_name
       FROM pos_transactions pt
       LEFT JOIN users u ON pt.cashier_id = u.id
       ${whereClause}
       ORDER BY pt.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single transaction with items
router.get('/transactions/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const txn = await query(
      `SELECT pt.*, u.full_name as cashier_name
       FROM pos_transactions pt
       LEFT JOIN users u ON pt.cashier_id = u.id
       WHERE pt.id = $1`,
      [req.params.id]
    );
    if (txn.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    const items = await query(
      `SELECT pti.*, p.description
       FROM pos_transaction_items pti
       LEFT JOIN products p ON pti.product_id = p.id
       WHERE pti.transaction_id = $1
       ORDER BY pti.created_at`,
      [req.params.id]
    );

    res.json({ ...txn.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Void POS transaction
router.post('/transactions/:id/void', authenticate, auditLog('POS', 'Void'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { reason } = req.body;
    const txn = await client.query('SELECT * FROM pos_transactions WHERE id = $1', [req.params.id]);
    if (txn.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    const t = txn.rows[0];

    await client.query(
      "UPDATE pos_transactions SET status = 'Void', void_reason = $1, voided_at = CURRENT_TIMESTAMP, voided_by = $2 WHERE id = $3",
      [reason, req.user!.id, req.params.id]
    );

    // Restore inventory
    const items = await client.query('SELECT pti.*, inv.location_id FROM pos_transaction_items pti JOIN inventory inv ON pti.product_id = inv.product_id WHERE pti.transaction_id = $1', [req.params.id]);
    for (const item of items.rows) {
      const locId = item.location_id || 1;
      await client.query('UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3',
        [item.quantity, item.product_id, locId]);

      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, created_by)
         VALUES ($1, $2, $3, 'POS Void', $4, 'IN', $5, $6)`,
        [uuidv4(), item.product_id, locId, req.params.id, item.quantity, req.user!.id]
      );
    }

    // Update shift — subtract from correct payment method column
    if (t.shift_id) {
      const pmColumn = t.payment_method === 'GCash' ? 'gcash_sales'
        : t.payment_method === 'Maya' ? 'maya_sales'
        : t.payment_method === 'Credit Card' ? 'card_sales'
        : t.payment_method === 'Bank Transfer' ? 'bank_transfer_sales'
        : t.payment_method === 'Charge' ? 'charge_sales'
        : 'cash_sales';
      await client.query(
        `UPDATE pos_shifts SET total_sales = total_sales - $1, ${pmColumn} = ${pmColumn} - $1, discount_total = discount_total - $2, net_sales = net_sales - $1, void_total = void_total + $1 WHERE id = $3`,
        [t.total, t.discount_total, t.shift_id]
      );
    }

    // Reversing journal entry
    const voidEntryId = uuidv4();
    const voidEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const grossTotal = parseFloat(t.total);
    const netOfVat = grossTotal / 1.12;
    const vatAmount = grossTotal - netOfVat;
    const totalCost = items.rows.reduce((sum: number, i: any) => sum + (i.quantity * parseFloat(i.cost || 0)), 0);
    const jeTotal = grossTotal + totalCost;

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Void POS', $3, $4, $5, $5, $6)`,
      [voidEntryId, voidEntryNumber, req.params.id, `Void POS Transaction ${t.transaction_number}`, jeTotal, req.user!.id]
    );

    // Reverse: Credit Revenue, Debit VAT, Credit the payment account
    const pm = t.payment_method || 'Cash';
    const reverseAcct: Record<string, string> = { Cash: '1000', GCash: '1000', Maya: '1000', 'Credit Card': '1000', 'Bank Transfer': '1010', Charge: '1100' };
    const reverseAccount = reverseAcct[pm] || '1000';
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES
         ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), $3, $4, 0, 'Void POS', $5),
         ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $7, $8, 0, 'Void POS', $5),
         ($9, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $10), $11, 0, $12, 'Void POS', $5)`,
      [uuidv4(), voidEntryId, `Reverse Revenue ${t.transaction_number}`, netOfVat, req.params.id,
       uuidv4(), `Reverse VAT ${t.transaction_number}`, vatAmount,
       uuidv4(), reverseAccount, `Reverse ${pm} ${t.transaction_number}`, grossTotal]
    );

    // Reverse COGS: Debit Inventory, Credit COGS
    if (totalCost > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'Void POS', $5),
                ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '5000'), $7, 0, $4, 'Void POS', $5)`,
        [uuidv4(), voidEntryId, `Reverse Inventory ${t.transaction_number}`, totalCost, req.params.id,
         uuidv4(), `Reverse COGS ${t.transaction_number}`]
      );
    }

    // Cash transaction reversal only for cash-type payments
    if (['Cash', 'GCash', 'Maya'].includes(pm)) {
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Void', $3, 'POS Sale', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), grossTotal, req.params.id,
         `Void POS ${t.transaction_number}`, req.user!.id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Transaction voided' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==================== SUSPENDED SALES ====================
router.post('/suspend', authenticate, auditLog('POS', 'Suspend Sale'), async (req: AuthRequest, res: Response) => {
  try {
    const txn_number = await generateRefNumber('SUS', 'suspended_sales', 'transaction_number');
    const { customer_id, customer_name, price_mode, items, subtotal, discount_total, tax_total, total, shift_id } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO suspended_sales (id, transaction_number, shift_id, customer_id, customer_name, price_mode, items, subtotal, discount_total, tax_total, total, cashier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, txn_number, shift_id, customer_id, customer_name, price_mode,
       JSON.stringify(items), subtotal, discount_total, tax_total, total, req.user!.id]
    );

    res.status(201).json({ id, transaction_number: txn_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/suspend', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM suspended_sales WHERE cashier_id = $1 ORDER BY created_at DESC`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/suspend/:id', authenticate, auditLog('POS', 'Delete Suspend'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT id FROM suspended_sales WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Suspended sale not found' });
    await query('DELETE FROM suspended_sales WHERE id = $1', [req.params.id]);
    res.json({ message: 'Suspended sale removed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
