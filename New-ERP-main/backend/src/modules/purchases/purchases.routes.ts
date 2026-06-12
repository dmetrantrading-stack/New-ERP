import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper to generate reference numbers
const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// ==================== PURCHASE REQUISITIONS ====================
router.post('/requisitions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const pr_number = await generateRefNumber('PR', 'purchase_requisitions', 'pr_number');
    const { items, notes } = req.body;
    const id = uuidv4();

    await query(
      'INSERT INTO purchase_requisitions (id, pr_number, requested_by, notes) VALUES ($1, $2, $3, $4)',
      [id, pr_number, req.user!.id, notes]
    );

    for (const item of items || []) {
      await query(
        'INSERT INTO purchase_requisition_items (id, pr_id, product_id, quantity, estimated_cost) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), id, item.product_id, item.quantity, item.estimated_cost]
      );
    }

    res.status(201).json({ id, pr_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requisitions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT pr.*, u.full_name as requested_by_name,
              (SELECT COUNT(*) FROM purchase_requisition_items WHERE pr_id = pr.id) as item_count
       FROM purchase_requisitions pr
       LEFT JOIN users u ON pr.requested_by = u.id
       ORDER BY pr.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PURCHASE ORDERS ====================
router.post('/orders', authenticate, auditLog('Purchases', 'Create PO'), async (req: AuthRequest, res: Response) => {
  try {
    const po_number = await generateRefNumber('PO', 'purchase_orders', 'po_number');
    const { supplier_id, pr_id, items, expected_date, payment_terms, notes, vat_mode } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    const id = uuidv4();
    const vatMode = vat_mode || 'VAT Inclusive';

    let subtotal = 0;
    let totalLineDiscount = 0;

    const orderItems = (items || []).map((item: any) => {
      const qty = parseFloat(item.quantity) || 0;
      const unitCost = parseFloat(item.unit_cost) || 0;
      const gross = qty * unitCost;
      const discType = item.discount_type || '%';
      const discVal = parseFloat(item.discount_value || '0');

      // Line discount
      let discAmt = 0;
      if (discType === '%') {
        discAmt = gross * (discVal / 100);
      } else {
        discAmt = discVal;
      }
      if (discAmt > gross) discAmt = gross; // prevent negative
      const netLineTotal = gross - discAmt;
      const netUnitCost = qty > 0 ? netLineTotal / qty : unitCost;

      subtotal += gross;
      totalLineDiscount += discAmt;

      return {
        product_id: item.product_id, variant_id: item.variant_id, location_id: item.location_id,
        quantity: qty, unit_cost: unitCost,
        discount_type: discType, discount_value: discVal, discount_amount: Math.round(discAmt * 100) / 100,
        net_unit_cost: Math.round(netUnitCost * 100) / 100,
        net_total: Math.round(netLineTotal * 100) / 100,
      };
    });

    const netSubtotal = subtotal - totalLineDiscount;

    // VAT computation based on mode
    let vatAmount = 0;
    let vatableAmount = netSubtotal;
    let netTotal: number;

    if (vatMode === 'VAT Inclusive') {
      vatableAmount = netSubtotal / 1.12;
      vatAmount = netSubtotal - vatableAmount;
      netTotal = netSubtotal; // total = VAT-inclusive amount, no extra VAT added
    } else if (vatMode === 'VAT Exclusive') {
      vatAmount = netSubtotal * 0.12;
      netTotal = netSubtotal + vatAmount;
    } else {
      // VAT Exempt or Zero Rated
      vatAmount = 0;
      netTotal = netSubtotal;
    }

    await query(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, pr_id, status, order_date, expected_date, payment_terms, notes, subtotal, discount, tax, vat_mode, vat_amount, vatable_amount, total, created_by)
       VALUES ($1, $2, $3, $4, 'Draft', CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, po_number, supplier_id, pr_id, expected_date || null, payment_terms, notes,
       subtotal, totalLineDiscount, vatAmount, vatMode, vatAmount, vatableAmount, netTotal, req.user!.id]
    );

    for (const item of orderItems) {
      await query(
        `INSERT INTO purchase_order_items (id, po_id, product_id, quantity, unit_cost, discount_type, discount_value, discount_amount, net_unit_cost, net_total, total_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [uuidv4(), id, item.product_id, item.quantity, item.unit_cost,
         item.discount_type, item.discount_value, item.discount_amount,
         item.net_unit_cost, item.net_total, item.net_total]
      );
    }

    res.status(201).json({ id, po_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/orders', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const supplier_id = req.query.supplier_id as string;
    const where: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (status) { where.push(`po.status = $${pi}`); params.push(status); pi++; }
    if (supplier_id) { where.push(`po.supplier_id = $${pi}`); params.push(supplier_id); pi++; }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const result = await query(
      `SELECT po.*, s.supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       ${whereClause}
       ORDER BY po.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/orders/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const po = await query(
      `SELECT po.*, s.supplier_name, s.supplier_code, u.full_name as created_by_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN users u ON po.created_by = u.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (po.rows.length === 0) return res.status(404).json({ error: 'PO not found' });

    const items = await query(
      `SELECT poi.*, p.sku, p.name as product_name
       FROM purchase_order_items poi
       JOIN products p ON poi.product_id = p.id
       WHERE poi.po_id = $1`,
      [req.params.id]
    );

    res.json({ ...po.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Send PO (change status to Sent)
router.patch('/orders/:id/send', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT id FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });
    await query("UPDATE purchase_orders SET status = 'Sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    res.json({ message: 'PO sent' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Edit Draft PO
router.put('/orders/:id', authenticate, auditLog('Purchases', 'Update PO'), async (req: AuthRequest, res: Response) => {
  try {
    const po = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (po.rows.length === 0) return res.status(404).json({ error: 'PO not found' });
    if (po.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft POs can be edited' });

    const { supplier_id, items, expected_date, payment_terms, notes, vat_mode } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    const vatMode = vat_mode || 'VAT Inclusive';

    let subtotal = 0;
    let totalLineDiscount = 0;

    const orderItems = (items || []).map((item: any) => {
      const qty = parseFloat(item.quantity) || 0;
      const unitCost = parseFloat(item.unit_cost) || 0;
      const gross = qty * unitCost;
      const discType = item.discount_type || '%';
      const discVal = parseFloat(item.discount_value || '0');
      let discAmt = 0;
      if (discType === '%') discAmt = gross * (discVal / 100);
      else discAmt = discVal;
      if (discAmt > gross) discAmt = gross;
      const netLineTotal = gross - discAmt;
      const netUnitCost = qty > 0 ? netLineTotal / qty : unitCost;
      subtotal += gross;
      totalLineDiscount += discAmt;
      return {
        product_id: item.product_id, quantity: qty, unit_cost: unitCost,
        discount_type: discType, discount_value: discVal, discount_amount: Math.round(discAmt * 100) / 100,
        net_unit_cost: Math.round(netUnitCost * 100) / 100,
        net_total: Math.round(netLineTotal * 100) / 100,
      };
    });

    const netSubtotal = subtotal - totalLineDiscount;
    let vatAmount = 0;
    let vatableAmount = netSubtotal;
    let netTotal: number;

    if (vatMode === 'VAT Inclusive') {
      vatableAmount = netSubtotal / 1.12;
      vatAmount = netSubtotal - vatableAmount;
      netTotal = netSubtotal;
    } else if (vatMode === 'VAT Exclusive') {
      vatAmount = netSubtotal * 0.12;
      netTotal = netSubtotal + vatAmount;
    } else {
      vatAmount = 0;
      netTotal = netSubtotal;
    }

    await query(
      `UPDATE purchase_orders SET supplier_id = $1, expected_date = $2, payment_terms = $3, notes = $4,
        subtotal = $5, discount = $6, tax = $7, vat_mode = $8, vat_amount = $9, vatable_amount = $10, total = $11,
        updated_at = CURRENT_TIMESTAMP WHERE id = $12`,
      [supplier_id, expected_date || null, payment_terms, notes,
       subtotal, totalLineDiscount, vatAmount, vatMode, vatAmount, vatableAmount, netTotal, req.params.id]
    );

    // Delete old items and re-insert
    await query('DELETE FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    for (const item of orderItems) {
      await query(
        `INSERT INTO purchase_order_items (id, po_id, product_id, quantity, unit_cost, discount_type, discount_value, discount_amount, net_unit_cost, net_total, total_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [uuidv4(), req.params.id, item.product_id, item.quantity, item.unit_cost,
         item.discount_type, item.discount_value, item.discount_amount,
         item.net_unit_cost, item.net_total, item.net_total]
      );
    }

    res.json({ message: 'PO updated' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== GOODS RECEIPT ====================
router.post('/receipts', authenticate, auditLog('Purchases', 'Goods Receipt'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const gr_number = await generateRefNumber('GR', 'goods_receipts', 'gr_number');
    const { po_id, supplier_id, location_id, items, notes } = req.body;
    if (!location_id) throw new AppError('Location ID is required');
    const id = uuidv4();

    await client.query(
      `INSERT INTO goods_receipts (id, gr_number, po_id, supplier_id, location_id, received_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7)`,
      [id, gr_number, po_id, supplier_id, location_id, notes, req.user!.id]
    );

    for (const item of items || []) {
      const batchId = uuidv4();
      const discAmt = parseFloat(item.discount_amount || '0');
      const netUnitCost = parseFloat(item.net_unit_cost || item.unit_cost || '0');
      // Inventory stores VAT-inclusive discounted cost for operational GP
      // GL journal entry strips VAT separately for accounting
      const totalCost = parseFloat(item.quantity) * netUnitCost;

      // Create batch
      await client.query(
        `INSERT INTO batches (id, product_id, location_id, batch_number, supplier_batch, manufacturing_date, expiry_date, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [batchId, item.product_id, location_id, item.batch_number || `BATCH-${Date.now()}`, item.supplier_batch,
         item.manufacturing_date, item.expiry_date, item.quantity, netUnitCost]
      );

      // Add to goods receipt items
      await client.query(
        `INSERT INTO goods_receipt_items (id, gr_id, po_item_id, product_id, batch_id, quantity, unit_cost, discount_amount, net_unit_cost, total_cost, expiry_date, batch_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [uuidv4(), id, item.po_item_id, item.product_id, batchId, item.quantity, item.unit_cost, discAmt, netUnitCost, totalCost, item.expiry_date, item.batch_number]
      );

      // Update inventory using discounted net cost
      const inventory = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, location_id]
      );

      if (inventory.rows.length > 0) {
        const currentQty = parseFloat(inventory.rows[0].quantity);
        const currentCost = parseFloat(inventory.rows[0].unit_cost);
        const newQty = currentQty + parseFloat(item.quantity);

        // Moving average cost using net (discounted) cost
        const totalValue = (currentCost * currentQty) + (netUnitCost * parseFloat(item.quantity));
        const newAvgCost = newQty > 0 ? totalValue / newQty : 0;

        await client.query(
          'UPDATE inventory SET quantity = $1, unit_cost = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $3 AND location_id = $4',
          [newQty, newAvgCost, item.product_id, location_id]
        );
      } else {
        await client.query(
          'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4) ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, unit_cost = EXCLUDED.unit_cost',
          [item.product_id, location_id, item.quantity, netUnitCost]
        );
      }

      // Inventory ledger entry
      const currentQty = inventory.rows.length > 0 ? parseFloat(inventory.rows[0].quantity) : 0;
      const newRunningQty = currentQty + parseFloat(item.quantity);
      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, batch_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
         VALUES ($1, $2, $3, $4, 'Goods Receipt', $5, 'IN', $6, $7, $8, $9, $10, $11)`,
        [uuidv4(), item.product_id, location_id, batchId, id, item.quantity, newRunningQty, netUnitCost, totalCost, notes, req.user!.id]
      );

      // Update PO received quantity
      if (item.po_item_id) {
        await client.query(
          'UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2',
          [item.quantity, item.po_item_id]
        );
      }
    }

    // Update PO status
    if (po_id) {
      const remaining = await client.query(
        `SELECT COUNT(*) as pending FROM purchase_order_items WHERE po_id = $1 AND received_quantity < quantity`,
        [po_id]
      );
      const newStatus = parseInt(remaining.rows[0].pending) > 0 ? 'Partial' : 'Received';
      await client.query(`UPDATE purchase_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newStatus, po_id]);
    }

    // Update goods receipt status
    await client.query("UPDATE goods_receipts SET status = 'Completed' WHERE id = $1", [id]);

    // Create Accounts Payable journal entry
    const totalAmount = items.reduce((sum: number, i: any) => sum + (parseFloat(i.quantity) * parseFloat(i.net_unit_cost || i.unit_cost || '0')), 0);
    const totalGross = items.reduce((sum: number, i: any) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_cost || '0')), 0);
    const totalDiscount = totalGross - totalAmount;

    // Fetch PO vat_mode for correct accounting
    let poVatMode = 'VAT Inclusive';
    let inputVatAmt = 0;
    let netInventoryCost = totalAmount;
    if (po_id) {
      const po = await client.query('SELECT vat_mode, vat_amount FROM purchase_orders WHERE id = $1', [po_id]);
      if (po.rows.length > 0 && po.rows[0].vat_mode === 'VAT Inclusive') {
        poVatMode = 'VAT Inclusive';
        netInventoryCost = totalAmount / 1.12;
        inputVatAmt = totalAmount - netInventoryCost;
      }
    }

    const apEntryId = uuidv4();
    const apEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Goods Receipt', $3, $4, $5, $5, $6)`,
      [apEntryId, apEntryNumber, id, `AP from GR ${gr_number}`, totalAmount, req.user!.id]
    );

    if (poVatMode === 'VAT Inclusive' && inputVatAmt > 0) {
      // Debit Inventory at net of VAT cost
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'Goods Receipt', $5)`,
        [uuidv4(), apEntryId, `Inventory (net) ${gr_number}`, netInventoryCost, id]
      );
      // Debit Input VAT
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2100'), $3, $4, 0, 'Goods Receipt', $5)`,
        [uuidv4(), apEntryId, `Input VAT ${gr_number}`, inputVatAmt, id]
      );
    } else {
      // Debit Inventory at gross/net cost
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'Goods Receipt', $5)`,
        [uuidv4(), apEntryId, `Inventory ${gr_number}`, totalAmount, id]
      );
    }

    // Credit Accounts Payable at net cost
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, 0, $4, 'Goods Receipt', $5)`,
      [uuidv4(), apEntryId, `AP from ${gr_number}`, totalAmount, id]
    );

    // Update supplier balance
    if (supplier_id) {
      await client.query('UPDATE suppliers SET balance = balance + $1 WHERE id = $2', [totalAmount, supplier_id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ id, gr_number });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/receipts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT gr.*, s.supplier_name, l.name as location_name
       FROM goods_receipts gr
       LEFT JOIN suppliers s ON gr.supplier_id = s.id
       LEFT JOIN locations l ON gr.location_id = l.id
       ORDER BY gr.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PURCHASE RETURNS ====================
router.post('/returns', authenticate, async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const pr_number = await generateRefNumber('PRET', 'purchase_returns', 'pr_number');
    const { supplier_id, items, reason, notes } = req.body;
    const id = uuidv4();

    await client.query(
      `INSERT INTO purchase_returns (id, pr_number, supplier_id, return_date, status, reason, notes, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, 'Draft', $4, $5, $6)`,
      [id, pr_number, supplier_id, reason, notes, req.user!.id]
    );

    let totalReturn = 0;
    for (const item of items || []) {
      const netCost = parseFloat(item.net_unit_cost || item.unit_cost || '0');
      const total = parseFloat(item.quantity) * netCost;
      totalReturn += total;

      // Deduct from inventory
      const inventory = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, item.location_id || 1]
      );
      if (inventory.rows.length > 0) {
        const newQty = parseFloat(inventory.rows[0].quantity) - parseFloat(item.quantity);
        if (newQty < 0) throw new AppError('Negative inventory not allowed for return');
        await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [newQty, inventory.rows[0].id]);

        // Inventory ledger entry
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
           VALUES ($1, $2, $3, 'Purchase Return', $4, 'OUT', $5, $6, $7, $8, $9)`,
          [uuidv4(), item.product_id, item.location_id || 1, id, parseFloat(item.quantity), newQty,
           netCost, total, req.user!.id]
        );
      }

      // Deduct from batch
      if (item.batch_id) {
        await client.query('UPDATE batches SET quantity = quantity - $1 WHERE id = $2', [item.quantity, item.batch_id]);
      }
    }

    await client.query("UPDATE purchase_returns SET status = 'Completed' WHERE id = $1", [id]);

    // Update supplier balance
    if (supplier_id) {
      await client.query('UPDATE suppliers SET balance = balance - $1 WHERE id = $2', [totalReturn, supplier_id]);
    }

    // Reversing journal entry: Credit Inventory, Debit AP (reverse of GR entry)
    const returnEntryId = uuidv4();
    const returnEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Purchase Return', $3, $4, $5, $5, $6)`,
      [returnEntryId, returnEntryNumber, id, `Purchase Return ${pr_number}`, totalReturn, req.user!.id]
    );

    // Debit AP (reduce liability)
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, $4, 0, 'Purchase Return', $5)`,
      [uuidv4(), returnEntryId, `AP Return ${pr_number}`, totalReturn, id]
    );

    // Credit Inventory (reduce asset)
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, 0, $4, 'Purchase Return', $5)`,
      [uuidv4(), returnEntryId, `Inventory Return ${pr_number}`, totalReturn, id]
    );

    await client.query('COMMIT');
    res.status(201).json({ id, pr_number });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
