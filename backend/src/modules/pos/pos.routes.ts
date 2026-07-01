import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { postCashInJournal, postCashOutJournal, postInventoryVarianceJournal } from '../../utils/journalEntryHelpers';
import {
  aggregateByAccountCode,
  aggregateGlCogsByAccountCode,
  insertCogsInventoryLines,
  insertCogsInventoryReversalLines,
  insertRevenueCreditLines,
  insertRevenueDebitLines,
  loadCategoryAccountsForProducts,
  sumLineGlCogs,
} from '../../utils/categoryGlPosting';
import { deductInventoryFefo } from '../../utils/batchFefo';
import { convertToBaseQty, formatInsufficientStockMessage, getEquivalentUomDisplay } from '../../utils/uom';
import {
  computePosTaxTotals,
  NO_VAT_TAX_TYPE,
  posLineRevenueAmount,
} from '../../utils/retailTaxPolicy';
import { applyLoyaltyOnPosSale, applyLoyaltyOnPosReturn, insertLoyaltyDiscountGlLine, loyaltyDiscountPortion, reverseLoyaltyOnPosVoid } from '../../utils/loyaltyService';
import { getLoyaltySettings, loyaltySettingsToApi } from '../../utils/loyaltySettings';
import { loadProductUoms, lookupBarcodeUom } from '../../utils/productUomDb';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const posView = hasUserPerm('pos.view');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

async function loadPosTransactionDetail(transactionId: string) {
  if (!isUuid(transactionId)) return null;
  const txn = await query(
    `SELECT pt.*, u.full_name as cashier_name
     FROM pos_transactions pt
     LEFT JOIN users u ON pt.cashier_id = u.id
     WHERE pt.id = $1`,
    [transactionId],
  );
  if (txn.rows.length === 0) return null;

  const items = await query(
    `SELECT pti.*, p.description,
        COALESCE(u.code, 'pc') AS uom_code,
        COALESCE(pti.entered_qty, pti.quantity) AS sold_entered_qty,
        COALESCE(pti.returned_entered_qty, 0) AS returned_entered_qty,
        GREATEST(COALESCE(pti.entered_qty, pti.quantity) - COALESCE(pti.returned_entered_qty, 0), 0) AS remaining_entered_qty
     FROM pos_transaction_items pti
     LEFT JOIN products p ON pti.product_id = p.id
     LEFT JOIN uoms u ON pti.uom_id = u.id
     WHERE pti.transaction_id = $1
     ORDER BY pti.created_at`,
    [transactionId],
  );

  const returns = await query(
    `SELECT pr.*, u.full_name AS created_by_name
     FROM pos_returns pr
     LEFT JOIN users u ON pr.created_by = u.id
     WHERE pr.pos_transaction_id = $1
     ORDER BY pr.created_at DESC`,
    [transactionId],
  );

  return { ...txn.rows[0], items: items.rows, returns: returns.rows };
}

const pmShiftColumn = (paymentMethod: string) =>
  paymentMethod === 'GCash' ? 'gcash_sales'
    : paymentMethod === 'Maya' ? 'maya_sales'
    : paymentMethod === 'Credit Card' ? 'card_sales'
    : paymentMethod === 'Bank Transfer' ? 'bank_transfer_sales'
    : paymentMethod === 'Charge' || paymentMethod === 'Check' || paymentMethod === 'Salary Deduction' ? 'charge_sales'
    : 'cash_sales';

const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const POS_RECEIPT_PAD = 6;

/** Numeric receipt # only — e.g. 000001 (continues after legacy POS-00001 rows). */
async function generatePosReceiptNumber(): Promise<string> {
  const result = await query(`
    SELECT GREATEST(
      COALESCE((
        SELECT MAX(CAST(transaction_number AS BIGINT))
        FROM pos_transactions
        WHERE transaction_number ~ '^[0-9]+$'
      ), 0),
      COALESCE((
        SELECT MAX(CAST(SUBSTRING(transaction_number FROM 5) AS INTEGER))
        FROM pos_transactions
        WHERE transaction_number ~ '^POS-[0-9]+$'
      ), 0)
    ) + 1 AS next
  `);
  return String(result.rows[0]?.next || 1).padStart(POS_RECEIPT_PAD, '0');
};

// ==================== POS SHIFTS ====================
router.post('/shifts/open', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Shift Open'), async (req: AuthRequest, res: Response) => {
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

    res.status(201).json({ id, shift_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shifts/close', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Shift Close'), async (req: AuthRequest, res: Response) => {
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

router.get('/shifts/current', authenticate, posView, async (req: AuthRequest, res: Response) => {
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
router.get('/shifts', authenticate, posView, async (req: AuthRequest, res: Response) => {
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
router.get('/shifts/:id', authenticate, posView, async (req: AuthRequest, res: Response) => {
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
router.post('/transactions', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Sale'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const transaction_number = await generatePosReceiptNumber();
    const {
      shift_id, customer_id, customer_name, employee_id, price_mode, items, payment_method,
      payment_details, amount_tendered, location_id: rawLocationId
    } = req.body;
    const location_id = rawLocationId ?? 1;

    if (payment_method === 'Salary Deduction' && !employee_id) {
      return res.status(400).json({ error: 'Employee is required for salary deduction' });
    }

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

    // POS retail policy: no output VAT (see retailTaxPolicy.ts)
    const productIds = [...new Set(transactionItems.map((i: any) => i.product_id))];
    const productTaxMap: Record<string, { tax_type: string; price_type: string }> = {};
    if (productIds.length > 0) {
      const prodResult = await client.query(
        `SELECT id, tax_type, price_type FROM products WHERE id = ANY($1::uuid[])`,
        [productIds],
      );
      for (const p of prodResult.rows) {
        productTaxMap[p.id] = { tax_type: p.tax_type || 'VAT', price_type: p.price_type || 'VAT Inclusive' };
      }
    }

    for (const item of transactionItems) {
      item.netRevenue = posLineRevenueAmount(item.total);
    }

    const {
      totalVatable,
      totalVat,
      totalVatExempt,
      totalZeroRated,
    } = computePosTaxTotals(transactionItems.map((i: any) => i.total));

    const grossTotal = total;
    const vatAmount = totalVat;

    let saleTotal = grossTotal;
    let loyaltyPointsRedeemed = 0;
    let loyaltyPointsEarned = 0;
    let loyaltyDiscount = 0;
    const loyaltyRates = await getLoyaltySettings(client);

    if (req.body.loyalty_points_redeemed && !customer_id) {
      return res.status(400).json({ error: 'Customer is required to redeem loyalty points' });
    }
    if (req.body.loyalty_points_redeemed && !loyaltyRates.enabled) {
      return res.status(400).json({ error: 'Loyalty program is disabled' });
    }

    if (customer_id) {
      const loyalty = await applyLoyaltyOnPosSale(client, {
        customerId: customer_id,
        saleTotalBeforeLoyalty: grossTotal,
        requestedRedeemPoints: req.body.loyalty_points_redeemed || 0,
        posTransactionId: id,
        createdBy: req.user!.id,
        rates: loyaltyRates,
      });
      loyaltyPointsRedeemed = loyalty.pointsRedeemed;
      loyaltyPointsEarned = loyalty.pointsEarned;
      loyaltyDiscount = loyalty.loyaltyDiscount;
      saleTotal = loyalty.finalTotal;
      discountTotal += loyaltyDiscount;
    }

    await client.query(
      `INSERT INTO pos_transactions (id, transaction_number, shift_id, customer_id, customer_name, price_mode,
        subtotal, discount_total, tax_total, total, payment_method, payment_details, amount_tendered, change_amount,
        loyalty_points_redeemed, loyalty_points_earned, loyalty_discount,
        status, cashier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'Completed', $19)`,
      [id, transaction_number, shift_id, customer_id, customer_name, price_mode || 'Retail',
        subtotal, discountTotal, vatAmount, saleTotal, payment_method,
        payment_details ? JSON.stringify(payment_details) : null,
        amount_tendered || saleTotal, Math.max(0, parseFloat(amount_tendered || 0) - saleTotal),
        loyaltyPointsRedeemed, loyaltyPointsEarned, loyaltyDiscount,
        req.user!.id]
    );

    for (const item of transactionItems) {
      const itemId = uuidv4();
      const locId = location_id;
      const conversionToBase = parseFloat(item.conversion_to_base) || 1;
      const enteredQty = parseFloat(item.quantity) || 0;
      const baseQty = item.base_qty != null
        ? parseFloat(item.base_qty)
        : convertToBaseQty(enteredQty, conversionToBase);

      const inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [item.product_id, locId]);
      if (inv.rows.length > 0) {
        const availableQty = parseFloat(inv.rows[0].quantity);
        const setting = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
        if (baseQty > availableQty && setting.rows[0]?.setting_value !== 'true') {
          throw new Error(formatInsufficientStockMessage(availableQty, baseQty, item.uom_code || 'pc'));
        }
      } else {
        const setting = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
        if (setting.rows[0]?.setting_value !== 'true') {
          throw new Error(`No stock for ${item.description || item.product_id}`);
        }
      }

      const fefo = await deductInventoryFefo(client, {
        product_id: item.product_id,
        location_id: locId,
        quantity: baseQty,
        reference_type: 'POS Sale',
        reference_id: id,
        created_by: req.user!.id,
      });
      item.cost = fefo.unitCost;

      await client.query(
        `INSERT INTO pos_transaction_items (id, transaction_id, product_id, variant_id, description, quantity, unit_price, discount, total, cost, selected_variant,
          uom_id, entered_qty, conversion_to_base, base_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [itemId, id, item.product_id, item.variant_id, item.description, enteredQty, item.unit_price,
         item.discount || 0, item.total, fefo.unitCost, item.selected_variant || null,
         item.uom_id || null, enteredQty, conversionToBase, baseQty]
      );
    }

    // Update shift totals
    if (shift_id) {
      if (payment_method === 'Cash') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, cash_sales = cash_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3, expected_cash = expected_cash + $1 WHERE id = $4',
          [saleTotal, discountTotal, saleTotal, shift_id]);
      } else if (payment_method === 'GCash') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, gcash_sales = gcash_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [saleTotal, discountTotal, saleTotal, shift_id]);
      } else if (payment_method === 'Maya') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, maya_sales = maya_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [saleTotal, discountTotal, saleTotal, shift_id]);
      } else if (payment_method === 'Credit Card') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, card_sales = card_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [saleTotal, discountTotal, saleTotal, shift_id]);
      } else if (payment_method === 'Bank Transfer') {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, bank_transfer_sales = bank_transfer_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [saleTotal, discountTotal, saleTotal, shift_id]);
      } else {
        await client.query('UPDATE pos_shifts SET total_sales = total_sales + $1, charge_sales = charge_sales + $1, discount_total = discount_total + $2, net_sales = net_sales + $3 WHERE id = $4',
          [saleTotal, discountTotal, saleTotal, shift_id]);
      }
    }

    // Update customer balance for charge sales
    if (customer_id && payment_method === 'Charge') {
      await client.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [saleTotal, customer_id]);
    }

    // Accounting entries
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const totalCost = transactionItems.reduce((sum: number, i: any) => {
      const baseQty = i.base_qty != null ? parseFloat(i.base_qty) : parseFloat(i.quantity) || 0;
      return sum + baseQty * (i.cost || 0);
    }, 0);
    // GL COGS uses net-of-VAT cost (inventory stored VAT-inclusive for operational GP)
    const posCogsGlLines = transactionItems.map((item: any) => {
      const tax = productTaxMap[item.product_id] || { tax_type: 'VAT', price_type: 'VAT Inclusive' };
      const baseQty = item.base_qty != null ? parseFloat(item.base_qty) : parseFloat(item.quantity) || 0;
      return {
        product_id: item.product_id,
        cogsGrossAmount: baseQty * (item.cost || 0),
        tax_type: tax.tax_type,
      };
    });
    const glCogs = sumLineGlCogs(posCogsGlLines);
    const jeTotal = grossTotal + glCogs;

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'POS Sale', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `POS Transaction ${transaction_number}`, jeTotal, req.user!.id]
    );

    // Debit account: look up from bank_accounts linked by pos_payment_method
    const bankAcct = await client.query(
      'SELECT gl_account_code FROM bank_accounts WHERE pos_payment_method = $1 AND is_active = true LIMIT 1',
      [payment_method]
    );
    const debitFallback: Record<string, string> = { Cash: '1000', Charge: '1100', 'Salary Deduction': '1120' };
    const debitAccount = bankAcct.rows.length > 0
      ? bankAcct.rows[0].gl_account_code
      : (debitFallback[payment_method as string] || '1000');
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, 'POS Sale', $6)`,
      [uuidv4(), entryId, debitAccount, `${payment_method} Sales ${transaction_number}`, saleTotal, id]
    );

    const posCategoryMap = await loadCategoryAccountsForProducts(client, productIds as string[]);
    const posRevenueBuckets = aggregateByAccountCode(
      transactionItems.map((item: any) => ({
        product_id: item.product_id,
        revenueAmount: item.netRevenue || 0,
      })),
      posCategoryMap,
      'revenue_account_code',
      'revenueAmount',
    );

    await insertRevenueCreditLines(
      client, entryId, posRevenueBuckets, 'POS Sale', id, `Sales Revenue ${transaction_number}`,
    );

    if (loyaltyDiscount > 0) {
      await insertLoyaltyDiscountGlLine(client, {
        entryId,
        amount: loyaltyDiscount,
        debit: loyaltyDiscount,
        credit: 0,
        referenceType: 'POS Sale',
        referenceId: id,
        description: `Loyalty discount ${transaction_number}`,
      });
    }

    const revenuePosted = [...posRevenueBuckets.values()].reduce((s, v) => s + (v || 0), 0);
    if (grossTotal > 0.009 && revenuePosted < grossTotal - 0.02) {
      throw new Error(`Revenue GL posting incomplete (posted ₱${revenuePosted.toFixed(2)} of ₱${grossTotal.toFixed(2)}). Check product category GL accounts.`);
    }

    // No VAT Payable for POS (retailTaxPolicy)

    // Debit Cost of Sales / Credit Inventory (by category)
    if (totalCost > 0) {
      const posCogsBuckets = aggregateGlCogsByAccountCode(posCogsGlLines, posCategoryMap);
      await insertCogsInventoryLines(
        client, entryId, posCogsBuckets, 'POS Sale', id, transaction_number,
      );
    }

    // Cash payment → cash_transactions
    if (payment_method === 'Cash') {
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Cash In', $3, 'POS Sale', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), saleTotal, id, `POS Sale ${transaction_number}`, req.user!.id]
      );
    }

    // E-wallet / card / bank transfer → bank_transactions (linked by pos_payment_method)
    if (['GCash', 'Maya', 'Credit Card', 'Bank Transfer'].includes(payment_method)) {
      const bank = await client.query(
        'SELECT id FROM bank_accounts WHERE pos_payment_method = $1 AND is_active = true LIMIT 1',
        [payment_method]
      );
      if (bank.rows.length > 0) {
        await client.query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1, $2, 'Deposit', $3, CURRENT_DATE, $4, $5)`,
          [uuidv4(), bank.rows[0].id, saleTotal, `POS Sale ${transaction_number}`, req.user!.id]
        );
        await client.query('UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [saleTotal, bank.rows[0].id]);
      }
    }

    // Employee grocery credit: create sales invoice for salary deduction
    if (payment_method === 'Salary Deduction' && employee_id) {
      const emp = await client.query('SELECT id, employee_code, first_name, last_name FROM employees WHERE id = $1', [employee_id]);
      if (emp.rows.length > 0) {
        const e = emp.rows[0];
        const invNumber = `SI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        const siId = uuidv4();
        await client.query(
          `INSERT INTO sales_invoices (id, invoice_number, customer_type, employee_id, customer_name, price_mode, invoice_date, payment_method, payment_terms, status, subtotal, discount, tax, tax_type, total, amount_paid, balance, vatable_sales, vat_exempt_sales, vat_amount, cashier_id, created_by)
           VALUES ($1,$2,'Employee',$3,$4,$5,CURRENT_DATE,'Salary Deduction','Salary Deduction','Posted',$6,$7,0,$8,$9,0,$10,0,$9,0,$11,$12)`,
          [siId, invNumber, e.id, `${e.last_name}, ${e.first_name}`, price_mode || 'Retail',
           subtotal, discountTotal, NO_VAT_TAX_TYPE, saleTotal, saleTotal, req.user!.id, req.user!.id]
        );
        for (const item of transactionItems) {
          await client.query(
            `INSERT INTO sales_invoice_items (id, invoice_id, product_id, description, quantity, unit_price, discount, tax, total, cost, location_id, tax_type, vat_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,0)`,
            [uuidv4(), siId, item.product_id, item.description, item.quantity, item.unit_price, item.discount || 0, item.total, item.cost || 0, location_id, NO_VAT_TAX_TYPE]
          );
        }
        await client.query('UPDATE employees SET grocery_credit_balance = grocery_credit_balance + $1 WHERE id = $2', [saleTotal, e.id]);
      }
    }

    await client.query('COMMIT');
    const grossProfit = saleTotal - totalCost;
    const marginPct = saleTotal > 0 ? ((grossProfit / saleTotal) * 100) : 0;
    res.status(201).json({
      id, transaction_number,
      total: saleTotal,
      total_cost: totalCost,
      gross_profit: grossProfit,
      margin_pct: Math.round(marginPct * 100) / 100,
      change: Math.max(0, parseFloat(amount_tendered || 0) - saleTotal),
      loyalty_points_earned: loyaltyPointsEarned,
      loyalty_points_redeemed: loyaltyPointsRedeemed,
      loyalty_discount: loyaltyDiscount,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

async function handleReceiptLookup(req: AuthRequest, res: Response) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Search query required' });

  if (isUuid(q)) {
    const detail = await loadPosTransactionDetail(q);
    if (!detail) return res.status(404).json({ error: 'Transaction not found' });
    return res.json(detail);
  }

  const exact = await query(
    `SELECT id FROM pos_transactions WHERE UPPER(transaction_number) = UPPER($1) LIMIT 1`,
    [q],
  );
  if (exact.rows.length > 0) {
    const detail = await loadPosTransactionDetail(exact.rows[0].id);
    return res.json(detail);
  }

  const partial = await query(
    `SELECT id, transaction_number, total, status, created_at, customer_name, payment_method
     FROM pos_transactions
     WHERE transaction_number ILIKE $1 OR COALESCE(customer_name, '') ILIKE $1
     ORDER BY created_at DESC
     LIMIT 15`,
    [`%${q}%`],
  );
  if (partial.rows.length === 1) {
    const detail = await loadPosTransactionDetail(partial.rows[0].id);
    return res.json(detail);
  }
  res.json({ matches: partial.rows });
}

// Receipt lookup — dedicated path avoids /transactions/:id catching "lookup"
router.get('/receipts/lookup', authenticate, posView, async (req: AuthRequest, res: Response) => {
  try {
    await handleReceiptLookup(req, res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/transactions/lookup', authenticate, posView, async (req: AuthRequest, res: Response) => {
  try {
    await handleReceiptLookup(req, res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get current shift transactions
router.get('/transactions/current', authenticate, posView, async (req: AuthRequest, res: Response) => {
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
router.get('/transactions', authenticate, posView, async (req: AuthRequest, res: Response) => {
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
router.get('/transactions/:id', authenticate, posView, async (req: AuthRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }
    const detail = await loadPosTransactionDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Transaction not found' });
    res.json(detail);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Void POS transaction
router.post('/transactions/:id/void', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Void'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { reason } = req.body;
    const txn = await client.query('SELECT * FROM pos_transactions WHERE id = $1', [req.params.id]);
    if (txn.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    const t = txn.rows[0];
    if (t.status === 'Void') return res.status(400).json({ error: 'Transaction already voided' });
    if (t.status === 'Suspended') return res.status(400).json({ error: 'Cannot void suspended transaction' });

    const priorReturns = await client.query(
      `SELECT COALESCE(SUM(returned_entered_qty), 0) AS qty FROM pos_transaction_items WHERE transaction_id = $1`,
      [req.params.id],
    );
    if (parseFloat(priorReturns.rows[0]?.qty || 0) > 0) {
      return res.status(400).json({ error: 'Cannot void a transaction that has returns — process remaining return instead' });
    }

    await client.query(
      "UPDATE pos_transactions SET status = 'Void', void_reason = $1, voided_at = CURRENT_TIMESTAMP, voided_by = $2 WHERE id = $3",
      [reason, req.user!.id, req.params.id]
    );

    if (t.customer_id) {
      await reverseLoyaltyOnPosVoid(client, {
        customerId: t.customer_id,
        pointsEarned: parseInt(t.loyalty_points_earned || '0', 10) || 0,
        pointsRedeemed: parseInt(t.loyalty_points_redeemed || '0', 10) || 0,
        posTransactionId: req.params.id,
        createdBy: req.user!.id,
      });
    }

    // Restore inventory at the same location used for the original sale
    const items = await client.query(
      `SELECT pti.*,
        (SELECT il.location_id FROM inventory_ledger il
         WHERE il.reference_id = pti.transaction_id AND il.product_id = pti.product_id
           AND il.transaction_type = 'OUT'
         ORDER BY il.created_at DESC LIMIT 1) AS location_id
       FROM pos_transaction_items pti WHERE pti.transaction_id = $1`,
      [req.params.id]
    );
    for (const item of items.rows) {
      const locId = item.location_id || 1;
      const restoreQty = item.base_qty != null ? parseFloat(item.base_qty) : parseFloat(item.quantity);
      await client.query('UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND location_id = $3',
        [restoreQty, item.product_id, locId]);

      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, created_by)
         VALUES ($1, $2, $3, 'POS Void', $4, 'IN', $5, $6)`,
        [uuidv4(), item.product_id, locId, req.params.id, restoreQty, req.user!.id]
      );
    }

    // Update shift — subtract from correct payment method column
    if (t.shift_id) {
      const pmColumn = t.payment_method === 'GCash' ? 'gcash_sales'
        : t.payment_method === 'Maya' ? 'maya_sales'
        : t.payment_method === 'Credit Card' ? 'card_sales'
        : t.payment_method === 'Bank Transfer' ? 'bank_transfer_sales'
        : t.payment_method === 'Charge' || t.payment_method === 'Check' || t.payment_method === 'Salary Deduction' ? 'charge_sales'
        : 'cash_sales';
      await client.query(
        `UPDATE pos_shifts SET total_sales = total_sales - $1, ${pmColumn} = ${pmColumn} - $1, discount_total = discount_total - $2, net_sales = net_sales - $1, void_total = void_total + $1 WHERE id = $3`,
        [t.total, t.discount_total, t.shift_id]
      );
    }

    // Reversing journal entry
    const voidEntryId = uuidv4();
    const voidEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const paidTotal = parseFloat(t.total);
    const loyaltyDiscVoid = parseFloat(t.loyalty_discount || 0);
    const itemRevenueTotal = items.rows.reduce(
      (sum: number, i: any) => sum + posLineRevenueAmount(parseFloat(i.total)),
      0,
    );
    const totalCost = items.rows.reduce((sum: number, i: any) => {
      const baseQty = i.base_qty != null ? parseFloat(i.base_qty) : parseFloat(i.quantity) || 0;
      return sum + baseQty * parseFloat(i.cost || 0);
    }, 0);
    const jeTotal = itemRevenueTotal + totalCost;

    const voidProductIds = [...new Set(items.rows.map((i: any) => i.product_id))];
    const voidProductTaxMap: Record<string, { tax_type: string; price_type: string }> = {};
    if (voidProductIds.length > 0) {
      const prodResult = await client.query(
        `SELECT id, tax_type, price_type FROM products WHERE id = ANY($1::uuid[])`,
        [voidProductIds],
      );
      for (const p of prodResult.rows) {
        voidProductTaxMap[p.id] = { tax_type: p.tax_type || 'VAT', price_type: p.price_type || 'VAT Inclusive' };
      }
    }
    const voidPosCategoryMap = await loadCategoryAccountsForProducts(client, voidProductIds as string[]);
    const voidPosRevenueBuckets = aggregateByAccountCode(
      items.rows.map((item: any) => ({
        product_id: item.product_id,
        revenueAmount: posLineRevenueAmount(parseFloat(item.total)),
      })),
      voidPosCategoryMap,
      'revenue_account_code',
      'revenueAmount',
    );
    const voidPosCogsGlLines = items.rows.map((item: any) => {
      const tax = voidProductTaxMap[item.product_id] || { tax_type: 'VAT', price_type: 'VAT Inclusive' };
      const baseQty = item.base_qty != null ? parseFloat(item.base_qty) : parseFloat(item.quantity) || 0;
      return {
        product_id: item.product_id,
        cogsGrossAmount: baseQty * parseFloat(item.cost || 0),
        tax_type: tax.tax_type,
      };
    });
    const voidPosCogsBuckets = aggregateGlCogsByAccountCode(voidPosCogsGlLines, voidPosCategoryMap);

    // No VAT reversal for POS void (retailTaxPolicy)

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Void POS', $3, $4, $5, $5, $6)`,
      [voidEntryId, voidEntryNumber, req.params.id, `Void POS Transaction ${t.transaction_number}`, jeTotal, req.user!.id]
    );

    await insertRevenueDebitLines(
      client, voidEntryId, voidPosRevenueBuckets, 'Void POS', req.params.id, `Reverse Revenue ${t.transaction_number}`,
    );
    const pm = t.payment_method || 'Cash';
    const bankAcctVoid = await client.query(
      'SELECT gl_account_code FROM bank_accounts WHERE pos_payment_method = $1 AND is_active = true LIMIT 1',
      [pm]
    );
    const reverseFallback: Record<string, string> = { Cash: '1000', Charge: '1100', 'Salary Deduction': '1120' };
    const reverseAccount = bankAcctVoid.rows.length > 0
      ? bankAcctVoid.rows[0].gl_account_code
      : (reverseFallback[pm as string] || '1000');
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, 0, $5, 'Void POS', $6)`,
      [uuidv4(), voidEntryId, reverseAccount, `Reverse ${pm} ${t.transaction_number}`, paidTotal, req.params.id],
    );

    if (loyaltyDiscVoid > 0) {
      await insertLoyaltyDiscountGlLine(client, {
        entryId: voidEntryId,
        amount: loyaltyDiscVoid,
        debit: 0,
        credit: loyaltyDiscVoid,
        referenceType: 'Void POS',
        referenceId: req.params.id,
        description: `Reverse loyalty discount ${t.transaction_number}`,
      });
    }

    if (totalCost > 0) {
      await insertCogsInventoryReversalLines(
        client, voidEntryId, voidPosCogsBuckets, 'Void POS', req.params.id, t.transaction_number,
      );
    }

    // Cash transaction reversal only for cash payments
    if (pm === 'Cash') {
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Void', $3, 'POS Sale', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), paidTotal, req.params.id,
         `Void POS ${t.transaction_number}`, req.user!.id]
      );
    }

    // Bank transaction reversal for e-wallet/card/bank transfer
    if (['GCash', 'Maya', 'Credit Card', 'Bank Transfer'].includes(pm)) {
      const bankVoid = await client.query(
        'SELECT id FROM bank_accounts WHERE pos_payment_method = $1 AND is_active = true LIMIT 1',
        [pm]
      );
      if (bankVoid.rows.length > 0) {
        await client.query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1, $2, 'Withdrawal', $3, CURRENT_DATE, $4, $5)`,
          [uuidv4(), bankVoid.rows[0].id, paidTotal, `Void POS ${t.transaction_number}`, req.user!.id]
        );
        await client.query('UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [paidTotal, bankVoid.rows[0].id]);
      }
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

// Partial or full POS return
router.post('/transactions/:id/return', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Return'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { reason, items: returnItems } = req.body;
    if (!returnItems?.length) return res.status(400).json({ error: 'At least one item is required' });
    if (!reason?.trim()) return res.status(400).json({ error: 'Return reason is required' });

    const txn = await client.query('SELECT * FROM pos_transactions WHERE id = $1', [req.params.id]);
    if (txn.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    const t = txn.rows[0];
    if (t.status === 'Void') return res.status(400).json({ error: 'Cannot return a voided transaction' });
    if (t.status === 'Suspended') return res.status(400).json({ error: 'Cannot return a suspended transaction' });

    const returnId = uuidv4();
    const returnNumber = await generateRefNumber('PR', 'pos_returns', 'return_number');
    const pm = t.payment_method || 'Cash';
    let totalReturn = 0;
    let totalCost = 0;
    const returnGlLines: Array<{ product_id: string; revenueAmount: number; cogsGrossAmount: number; tax_type?: string }> = [];
    const processedLines: any[] = [];

    for (const reqItem of returnItems) {
      const qty = parseFloat(reqItem.quantity);
      if (!reqItem.transaction_item_id || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('Each return line needs a valid item and quantity');
      }

      const line = await client.query(
        `SELECT pti.*,
          (SELECT il.location_id FROM inventory_ledger il
           WHERE il.reference_id = pti.transaction_id AND il.product_id = pti.product_id
             AND il.transaction_type = 'OUT'
           ORDER BY il.created_at DESC LIMIT 1) AS location_id
         FROM pos_transaction_items pti
         WHERE pti.id = $1 AND pti.transaction_id = $2`,
        [reqItem.transaction_item_id, req.params.id],
      );
      if (line.rows.length === 0) throw new Error('Invalid transaction line item');
      const invLine = line.rows[0];

      const soldEntered = parseFloat(invLine.entered_qty ?? invLine.quantity);
      const returnedSoFar = parseFloat(invLine.returned_entered_qty || 0);
      const remaining = soldEntered - returnedSoFar;
      if (qty > remaining + 0.0001) {
        throw new Error(`Return qty exceeds remaining for ${invLine.description || 'item'}`);
      }

      const soldBase = parseFloat(invLine.base_qty ?? invLine.quantity);
      const returnedBaseSoFar = parseFloat(invLine.returned_base_qty || 0);
      const returnBaseQty = soldEntered > 0
        ? ((soldBase - returnedBaseSoFar) / (soldEntered - returnedSoFar)) * qty
        : qty;

      const lineTotal = (parseFloat(invLine.total) / soldEntered) * qty;
      const cost = parseFloat(invLine.cost || 0);
      const locId = reqItem.location_id || invLine.location_id || 1;
      totalReturn += lineTotal;
      totalCost += cost * returnBaseQty;

      returnGlLines.push({
        product_id: invLine.product_id,
        revenueAmount: posLineRevenueAmount(lineTotal),
        cogsGrossAmount: cost * returnBaseQty,
      });

      await client.query(
        `UPDATE pos_transaction_items
         SET returned_entered_qty = COALESCE(returned_entered_qty, 0) + $1,
             returned_base_qty = COALESCE(returned_base_qty, 0) + $2
         WHERE id = $3`,
        [qty, returnBaseQty, invLine.id],
      );

      const invRow = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [invLine.product_id, locId],
      );
      if (invRow.rows.length > 0) {
        const newQty = parseFloat(invRow.rows[0].quantity) + returnBaseQty;
        await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [newQty, invRow.rows[0].id]);
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
           VALUES ($1, $2, $3, 'POS Return', $4, 'IN', $5, $6, $7, $8, $9)`,
          [uuidv4(), invLine.product_id, locId, returnId, returnBaseQty, newQty, cost, cost * returnBaseQty, req.user!.id],
        );
      } else {
        await client.query(
          'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)',
          [invLine.product_id, locId, returnBaseQty, cost],
        );
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
           VALUES ($1, $2, $3, 'POS Return', $4, 'IN', $5, $6, $7, $8, $9)`,
          [uuidv4(), invLine.product_id, locId, returnId, returnBaseQty, returnBaseQty, cost, cost * returnBaseQty, req.user!.id],
        );
      }

      processedLines.push({
        pos_transaction_item_id: invLine.id,
        product_id: invLine.product_id,
        entered_qty: qty,
        base_qty: returnBaseQty,
        unit_price: parseFloat(invLine.unit_price),
        discount: parseFloat(invLine.discount || 0),
        total: lineTotal,
        cost,
        location_id: locId,
      });
    }

    const grossItemRow = await client.query(
      `SELECT COALESCE(SUM(total), 0) AS gross FROM pos_transaction_items WHERE transaction_id = $1`,
      [req.params.id],
    );
    const grossItemTotal = parseFloat(grossItemRow.rows[0]?.gross || 0);
    const loyaltyDisc = parseFloat(t.loyalty_discount || 0);
    const loyaltyReturnPortion = loyaltyDiscountPortion(totalReturn, grossItemTotal, loyaltyDisc);
    const cashRefund = Math.round((totalReturn - loyaltyReturnPortion) * 100) / 100;

    let loyaltyReturnAdjust = { earnClawback: 0, redeemRestore: 0 };
    if (t.customer_id) {
      const earned = parseInt(t.loyalty_points_earned || '0', 10) || 0;
      const redeemed = parseInt(t.loyalty_points_redeemed || '0', 10) || 0;
      if (earned > 0 || redeemed > 0) {
        loyaltyReturnAdjust = await applyLoyaltyOnPosReturn(client, {
          customerId: t.customer_id,
          pointsEarned: earned,
          pointsRedeemed: redeemed,
          returnAmount: totalReturn,
          grossItemTotal,
          posTransactionId: req.params.id,
          returnId,
          createdBy: req.user!.id,
        });
      }
    }

    const shiftId = t.shift_id;
    await client.query(
      `INSERT INTO pos_returns (id, return_number, pos_transaction_id, shift_id, total, refund_method, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [returnId, returnNumber, req.params.id, shiftId, totalReturn, pm, reason.trim(), req.user!.id],
    );

    for (const pl of processedLines) {
      await client.query(
        `INSERT INTO pos_return_items (id, return_id, pos_transaction_item_id, product_id, entered_qty, base_qty, unit_price, discount, total, cost, location_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [uuidv4(), returnId, pl.pos_transaction_item_id, pl.product_id, pl.entered_qty, pl.base_qty,
          pl.unit_price, pl.discount, pl.total, pl.cost, pl.location_id],
      );
    }

    const allReturned = await client.query(
      `SELECT BOOL_AND(COALESCE(returned_entered_qty, 0) >= COALESCE(entered_qty, quantity)) AS fully_returned
       FROM pos_transaction_items WHERE transaction_id = $1`,
      [req.params.id],
    );
    if (allReturned.rows[0]?.fully_returned) {
      await client.query("UPDATE pos_transactions SET status = 'Returned' WHERE id = $1", [req.params.id]);
    }

    if (shiftId) {
      const pmColumn = pmShiftColumn(pm);
      await client.query(
        `UPDATE pos_shifts SET total_sales = total_sales - $1, ${pmColumn} = ${pmColumn} - $1,
          net_sales = net_sales - $1, return_total = return_total + $1
         WHERE id = $2`,
        [cashRefund, shiftId],
      );
      if (pm === 'Cash') {
        await client.query(
          'UPDATE pos_shifts SET expected_cash = expected_cash - $1 WHERE id = $2',
          [cashRefund, shiftId],
        );
      }
    }

    if (t.customer_id && pm === 'Charge') {
      await client.query(
        'UPDATE customers SET balance = GREATEST(balance - $1, 0) WHERE id = $2',
        [cashRefund, t.customer_id],
      );
    }

    if (pm === 'Salary Deduction') {
      const si = await client.query(
        `SELECT employee_id FROM sales_invoices
         WHERE payment_method = 'Salary Deduction' AND cashier_id = $1
           AND invoice_date = ($2::timestamptz)::date
           AND ABS(total - $3) < 0.02
         ORDER BY created_at DESC LIMIT 1`,
        [t.cashier_id, t.created_at, parseFloat(t.total)],
      );
      if (si.rows.length > 0 && si.rows[0].employee_id) {
        await client.query(
          'UPDATE employees SET grocery_credit_balance = GREATEST(grocery_credit_balance - $1, 0) WHERE id = $2',
          [totalReturn, si.rows[0].employee_id],
        );
      }
    }

    const returnProductIds = [...new Set(returnGlLines.map((l) => l.product_id))];
    const returnProductTaxMap: Record<string, { tax_type: string; price_type: string }> = {};
    if (returnProductIds.length > 0) {
      const prodResult = await client.query(
        `SELECT id, tax_type, price_type FROM products WHERE id = ANY($1::uuid[])`,
        [returnProductIds],
      );
      for (const p of prodResult.rows) {
        returnProductTaxMap[p.id] = { tax_type: p.tax_type || 'VAT', price_type: p.price_type || 'VAT Inclusive' };
      }
    }
    const returnCategoryMap = await loadCategoryAccountsForProducts(client, returnProductIds as string[]);
    const returnRevenueBuckets = aggregateByAccountCode(
      returnGlLines,
      returnCategoryMap,
      'revenue_account_code',
      'revenueAmount',
    );
    const returnCogsGlLines = returnGlLines.map((item) => ({
      product_id: item.product_id,
      cogsGrossAmount: item.cogsGrossAmount,
      tax_type: returnProductTaxMap[item.product_id]?.tax_type || 'VAT',
    }));
    const returnCogsBuckets = aggregateGlCogsByAccountCode(returnCogsGlLines, returnCategoryMap);
    const glCogs = sumLineGlCogs(returnCogsGlLines);
    const jeTotal = totalReturn + glCogs;

    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'POS Return', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, returnId, `POS Return ${returnNumber} — ${t.transaction_number}`, jeTotal, req.user!.id],
    );

    await insertRevenueDebitLines(
      client, entryId, returnRevenueBuckets, 'POS Return', returnId, `Reverse Revenue ${t.transaction_number}`,
    );

    const bankAcctReturn = await client.query(
      'SELECT gl_account_code FROM bank_accounts WHERE pos_payment_method = $1 AND is_active = true LIMIT 1',
      [pm],
    );
    const refundFallback: Record<string, string> = { Cash: '1000', Charge: '1100', 'Salary Deduction': '1120' };
    const refundAccount = bankAcctReturn.rows.length > 0
      ? bankAcctReturn.rows[0].gl_account_code
      : (refundFallback[pm as string] || '1000');
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, 0, $5, 'POS Return', $6)`,
      [uuidv4(), entryId, refundAccount, `Refund ${pm} ${t.transaction_number}`, cashRefund, returnId],
    );

    if (loyaltyReturnPortion > 0) {
      await insertLoyaltyDiscountGlLine(client, {
        entryId,
        amount: loyaltyReturnPortion,
        debit: 0,
        credit: loyaltyReturnPortion,
        referenceType: 'POS Return',
        referenceId: returnId,
        description: `Reverse loyalty discount ${t.transaction_number}`,
      });
    }

    if (glCogs > 0) {
      await insertCogsInventoryReversalLines(
        client, entryId, returnCogsBuckets, 'POS Return', returnId, returnNumber,
      );
    }

    if (pm === 'Cash') {
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Cash Out', $3, 'POS Return', $4, $5, $6)`,
        [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), cashRefund, returnId,
          `POS Return ${returnNumber} — ${t.transaction_number}`, req.user!.id],
      );
    }

    if (['GCash', 'Maya', 'Credit Card', 'Bank Transfer'].includes(pm)) {
      const bankReturn = await client.query(
        'SELECT id FROM bank_accounts WHERE pos_payment_method = $1 AND is_active = true LIMIT 1',
        [pm],
      );
      if (bankReturn.rows.length > 0) {
        await client.query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1, $2, 'Withdrawal', $3, CURRENT_DATE, $4, $5)`,
          [uuidv4(), bankReturn.rows[0].id, cashRefund, `POS Return ${returnNumber} — ${t.transaction_number}`, req.user!.id],
        );
        await client.query(
          'UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [cashRefund, bankReturn.rows[0].id],
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      id: returnId,
      return_number: returnNumber,
      total: totalReturn,
      cash_refund: cashRefund,
      loyalty_return_portion: loyaltyReturnPortion,
      loyalty_earn_clawback: loyaltyReturnAdjust.earnClawback,
      loyalty_redeem_restore: loyaltyReturnAdjust.redeemRestore,
      transaction_number: t.transaction_number,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error.statusCode || 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==================== SUSPENDED SALES ====================
router.post('/suspend', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Suspend Sale'), async (req: AuthRequest, res: Response) => {
  try {
    const txn_number = await generateRefNumber('SUS', 'suspended_sales', 'transaction_number');
    const { customer_id, customer_name, price_mode, items, subtotal, discount_total, tax_total, total, shift_id, loyalty_redeem_points } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO suspended_sales (id, transaction_number, shift_id, customer_id, customer_name, price_mode, items, subtotal, discount_total, tax_total, total, loyalty_redeem_points, cashier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, txn_number, shift_id, customer_id, customer_name, price_mode,
       JSON.stringify(items), subtotal, discount_total, tax_total, total,
       Math.max(0, Math.floor(loyalty_redeem_points || 0)), req.user!.id]
    );

    res.status(201).json({ id, transaction_number: txn_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/employees', authenticate, hasUserPerm('pos.write'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, employee_code, first_name, last_name, department, credit_limit, grocery_credit_balance
       FROM employees WHERE is_active = true ORDER BY last_name, first_name`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/suspend', authenticate, posView, async (req: AuthRequest, res: Response) => {
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

router.delete('/suspend/:id', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Delete Suspend'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT id FROM suspended_sales WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Suspended sale not found' });
    await query('DELETE FROM suspended_sales WHERE id = $1', [req.params.id]);
    res.json({ message: 'Suspended sale removed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CASH IN / CASH OUT ====================

// Cash In — add money to cash drawer
router.post('/cash-in', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Cash In'), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, reason, notes } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Amount is required' });

    const shift = await query("SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open'", [req.user!.id]);
    if (shift.rows.length === 0) return res.status(400).json({ error: 'No open shift' });

    const s = shift.rows[0];
    const newExpected = (parseFloat(s.expected_cash) || 0) + amt;
    await query('UPDATE pos_shifts SET expected_cash = $1 WHERE id = $2', [newExpected, s.id]);

    // Record cash transaction
    const ctId = uuidv4();
    const ctNum = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    await query(
      'INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [ctId, ctNum, 'Cash In', amt, 'POS Shift', s.id, reason || notes || 'Cash In', req.user!.id]
    );

    await postCashInJournal(query, {
      referenceId: ctId,
      description: `POS Cash In ${ctNum}`,
      amount: amt,
      userId: req.user!.id,
    });

    res.json({ id: ctId, transaction_number: ctNum, expected_cash: newExpected });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Cash Out — remove money from cash drawer
router.post('/cash-out', authenticate, hasUserPerm('pos.write'), auditLog('POS', 'Cash Out'), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, reason, notes } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Amount is required' });

    const shift = await query("SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open'", [req.user!.id]);
    if (shift.rows.length === 0) return res.status(400).json({ error: 'No open shift' });

    const s = shift.rows[0];
    const newExpected = Math.max(0, (parseFloat(s.expected_cash) || 0) - amt);
    await query('UPDATE pos_shifts SET expected_cash = $1 WHERE id = $2', [newExpected, s.id]);

    // Record cash transaction
    const ctId = uuidv4();
    const ctNum = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    await query(
      'INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [ctId, ctNum, 'Cash Out', amt, 'POS Shift', s.id, reason || notes || 'Cash Out', req.user!.id]
    );

    await postCashOutJournal(query, {
      referenceId: ctId,
      description: `POS Cash Out ${ctNum}`,
      amount: amt,
      userId: req.user!.id,
    });

    res.json({ id: ctId, transaction_number: ctNum, expected_cash: newExpected });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

const STOCK_SQL = 'COALESCE(i.quantity, 0)';

function buildPriceInquiryRow(row: any, uoms: any[]) {
  const stock = parseFloat(row.stock) || 0;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    barcode: row.barcode,
    stock,
    stock_display: getEquivalentUomDisplay(
      stock,
      uoms.map((u: any) => ({ uom_code: u.uom_code, conversion_to_base: u.conversion_to_base })),
      row.unit_of_measure || 'pc',
    ),
    retail_price: parseFloat(row.retail_price) || 0,
    wholesale_price: parseFloat(row.wholesale_price) || 0,
    distributor_price: parseFloat(row.distributor_price) || 0,
    chilled_price: row.chilled_price != null ? parseFloat(row.chilled_price) : null,
    has_chilled_variant: !!row.has_chilled_variant,
    uoms: uoms.map((u: any) => ({
      uom_id: u.uom_id,
      uom_code: u.uom_code,
      conversion_to_base: parseFloat(u.conversion_to_base) || 1,
      retail_price: parseFloat(u.retail_price) || 0,
      wholesale_price: parseFloat(u.wholesale_price) || 0,
      distributor_price: parseFloat(u.distributor_price) || 0,
    })),
  };
}

router.get('/loyalty-policy', authenticate, posView, async (_req: AuthRequest, res: Response) => {
  try {
    res.json(loyaltySettingsToApi(await getLoyaltySettings()));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/loyalty/:customerId', authenticate, posView, async (req: AuthRequest, res: Response) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isFinite(customerId)) return res.status(400).json({ error: 'Invalid customer ID' });
    const result = await query(
      `SELECT id, customer_code, customer_name, loyalty_points, default_price_mode, phone
       FROM customers WHERE id = $1 AND is_active = true`,
      [customerId],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/price-inquiry', authenticate, posView, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) return res.status(400).json({ error: 'Search query required' });
    const location_id = parseInt(String(req.query.location_id ?? '1'), 10) || 1;

    const bcHit = await lookupBarcodeUom({ query }, q);
    if (bcHit) {
      const result = await query(
        `SELECT p.id, p.sku, p.name, p.barcode, p.retail_price, p.wholesale_price, p.distributor_price,
          p.has_chilled_variant, p.chilled_price,
          COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') AS unit_of_measure, ${STOCK_SQL} AS stock
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $2
         WHERE p.id = $1 AND p.is_active = true`,
        [bcHit.product_id, location_id],
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Product not found' });
      const uoms = await loadProductUoms({ query }, bcHit.product_id);
      return res.json(buildPriceInquiryRow(row, uoms));
    }

    const exact = await query(
      `SELECT p.id, p.sku, p.name, p.barcode, p.retail_price, p.wholesale_price, p.distributor_price,
        p.has_chilled_variant, p.chilled_price,
        COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') AS unit_of_measure, ${STOCK_SQL} AS stock
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $2
       WHERE p.is_active = true AND (p.barcode = $1 OR p.sku ILIKE $1)
       ORDER BY CASE WHEN p.barcode = $1 THEN 0 WHEN p.sku ILIKE $1 THEN 1 ELSE 2 END
       LIMIT 1`,
      [q, location_id],
    );
    let row = exact.rows[0];
    if (!row) {
      const fuzzy = await query(
        `SELECT p.id, p.sku, p.name, p.barcode, p.retail_price, p.wholesale_price, p.distributor_price,
          p.has_chilled_variant, p.chilled_price,
          COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') AS unit_of_measure, ${STOCK_SQL} AS stock
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $2
         WHERE p.is_active = true AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.barcode ILIKE $1)
         ORDER BY p.name LIMIT 1`,
        [`%${q}%`, location_id],
      );
      row = fuzzy.rows[0];
    }
    if (!row) return res.status(404).json({ error: 'Product not found' });
    const uoms = await loadProductUoms({ query }, row.id);
    res.json(buildPriceInquiryRow(row, uoms));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
