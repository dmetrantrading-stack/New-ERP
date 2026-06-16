import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { savePriceHistoryFromGR } from '../supplier-price-history/supplier-price-history.routes';
import { config } from '../../config';

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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (status) { where.push(`po.status = $${pi}`); params.push(status); pi++; }
    if (supplier_id) { where.push(`po.supplier_id = $${pi}`); params.push(supplier_id); pi++; }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = await query(`SELECT COUNT(*) FROM purchase_orders po ${whereClause}`, params);

    const result = await query(
      `SELECT po.*, s.supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       ${whereClause}
       ORDER BY po.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
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
    const { po_id, supplier_id, location_id, items, notes, supplier_invoice_number } = req.body;
    if (!location_id) throw new AppError('Location ID is required');
    const id = uuidv4();

    await client.query(
      `INSERT INTO goods_receipts (id, gr_number, po_id, supplier_id, location_id, received_date, notes, supplier_invoice_number, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8)`,
      [id, gr_number, po_id, supplier_id, location_id, notes, supplier_invoice_number || null, req.user!.id]
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

      // Save supplier price history (isolated via savepoint to avoid aborting main transaction)
      await client.query('SAVEPOINT sph_save');
      try {
        const prod = await client.query('SELECT name, unit_of_measure FROM products WHERE id = $1', [item.product_id]);
        const supp = await client.query('SELECT supplier_name FROM suppliers WHERE id = $1', [supplier_id]);
        const poData = po_id ? await client.query('SELECT po_number FROM purchase_orders WHERE id = $1', [po_id]) : { rows: [] };
        const loc = await client.query('SELECT name FROM locations WHERE id = $1', [location_id]);
        const grItemRes = await client.query(
          'SELECT id FROM goods_receipt_items WHERE gr_id = $1 AND product_id = $2 AND po_item_id = $3 LIMIT 1',
          [id, item.product_id, item.po_item_id]
        );

        await savePriceHistoryFromGR(client, {
          product_id: item.product_id,
          supplier_id: parseInt(supplier_id),
          product_name: prod.rows[0]?.name || '',
          supplier_name: supp.rows[0]?.supplier_name || '',
          po_id: po_id || null,
          po_number: poData.rows[0]?.po_number || null,
          gr_id: id,
          gr_number: gr_number,
          gr_item_id: grItemRes.rows.length > 0 ? grItemRes.rows[0].id : null,
          received_date: new Date().toISOString().split('T')[0],
          unit_cost: netUnitCost,
          quantity_received: parseFloat(item.quantity),
          uom: prod.rows[0]?.unit_of_measure || 'pc',
          location_id: parseInt(location_id),
          location_name: loc.rows[0]?.name || '',
          batch_number: item.batch_number || '',
          expiry_date: item.expiry_date || '',
          created_by: req.user!.id,
          remarks: `Received via ${gr_number}`,
        });
        await client.query('RELEASE SAVEPOINT sph_save');
      } catch (sphErr) {
        await client.query('ROLLBACK TO SAVEPOINT sph_save');
        console.error('Failed to save supplier price history:', sphErr);
      }
    }

    // Update product-level cost based on moving average across all locations (once per GR)
    const autoSetting = await client.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'auto_update_cost_from_rr'`);
    const autoUpdate = autoSetting.rows.length > 0 && autoSetting.rows[0].setting_value === 'true';
    if (autoUpdate) {
      const uniqueProductIds = [...new Set(items.map((i: any) => i.product_id))];
      for (const pid of uniqueProductIds) {
        const inv = await client.query(
          `SELECT SUM(quantity) as total_qty, SUM(quantity * unit_cost) as total_value FROM inventory WHERE product_id = $1`,
          [pid]
        );
        const totalQty = parseFloat(inv.rows[0]?.total_qty || 0);
        const totalValue = parseFloat(inv.rows[0]?.total_value || 0);
        if (totalQty > 0) {
          await client.query(
            `UPDATE products SET cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [totalValue / totalQty, pid]
          );
        }
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
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1106'), $3, $4, 0, 'Goods Receipt', $5)`,
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

    // Note: Supplier balance is updated when APV is posted, not here

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

// Printable Purchase Order
router.get('/orders/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const po = await query(
      `SELECT po.*, s.supplier_name, s.supplier_code, s.contact_person, s.phone as contact_number, s.tin as supplier_tin, s.address as supplier_address, u.full_name as created_by_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN users u ON po.created_by = u.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (po.rows.length === 0) return res.status(404).send('Not found');
    const d = po.rows[0];

    const items = await query(
      `SELECT poi.*, p.sku, p.name as product_name, p.unit_of_measure
       FROM purchase_order_items poi
       JOIN products p ON poi.product_id = p.id
       WHERE poi.po_id = $1 ORDER BY poi.id`,
      [req.params.id]
    );

    const fc = (val: any) => { const n = parseFloat(val); return isNaN(n) ? '0.00' : n.toLocaleString('en-PH', { minimumFractionDigits: 2 }); };

    const itemRows = items.rows.map((row: any, idx: number) => `
      <tr>
        <td style="padding:4px 6px;font-size:10px">${row.product_name || '-'}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center">${parseFloat(row.quantity)}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center">${row.unit_of_measure || '-'}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right">${fc(row.unit_cost)}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right">${fc(row.discount_amount || 0)}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right">${fc(row.net_total || row.total_cost)}</td>
      </tr>
    `).join('');

    const grossTotal = parseFloat(d.subtotal) || 0;
    const discountAmt = parseFloat(d.discount) || 0;
    const vatableAmt = parseFloat(d.vatable_amount) || 0;
    const vatAmt = parseFloat(d.vat_amount) || 0;
    const total = parseFloat(d.total) || 0;
    const totalQty = items.rows.reduce((s: number, r: any) => s + parseFloat(r.quantity), 0);

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Purchase Order ${d.po_number}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:10px;color:#111;padding:8mm 10mm;max-width:210mm;margin:0 auto;letter-spacing:0.2px;text-rendering:optimizeSpeed}
.company-header{text-align:center;margin-bottom:8px}
.company-header h1{font-size:18px;font-weight:bold;letter-spacing:4px;margin:0}
.company-header .tagline{font-size:9px;color:#111;margin:3px 0}
.company-header .info{font-size:8px;color:#111;margin:2px 0}
.dot-divider{text-align:center;font-size:11px;font-weight:bold;margin:4px 0;letter-spacing:1px}
.dot-divider-thin{text-align:center;font-size:10px;color:#444;margin:2px 0;letter-spacing:1px}
.doc-title{text-align:center;border:1px dotted #444;padding:6px 0;margin:8px 0}
.doc-title h2{font-size:14px;font-weight:bold;letter-spacing:6px;margin:0}
.doc-title .sub{font-size:9px;color:#333}
.details{display:flex;gap:20px;margin:10px 0}
.details-left{flex:1;border:1px dotted #444;padding:8px 10px}
.details-right{flex:1;border:1px dotted #444;padding:8px 10px}
.details-left .label,.details-right .label{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:5px}
.details p{font-size:9px;margin:2px 0}
.items-table{width:100%;border-collapse:collapse;margin:10px 0}
.items-table th{background:#f8f8f8;border:1px dotted #444;padding:5px 6px;font-size:9px;text-align:left;font-weight:bold}
.items-table td{border:1px dotted #444;padding:4px 6px;font-size:9px}
.computation{display:flex;justify-content:flex-end;margin:10px 0}
.comp-table{width:260px;border-collapse:collapse}
.comp-table td{padding:3px 8px;font-size:9px}
.comp-table td:last-child{text-align:right}
.comp-table .total-row{border-top:2px dotted #000;font-size:12px;font-weight:bold}
.terms-sect{display:flex;gap:20px;margin:12px 0}
.terms-left,.terms-right{flex:1;border:1px dotted #444;padding:8px 10px}
.terms-sect h4{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:4px}
.terms-sect p{font-size:8px;line-height:1.4;color:#111}
.signatures{display:flex;justify-content:space-between;margin-top:28px;gap:10px}
.sig-block{text-align:center;flex:1}
.sig-block .sig-line{border-bottom:1px solid #000;height:34px;margin-bottom:4px}
.sig-block .sig-label{font-size:8px;color:#222}
.footer-note{text-align:center;font-size:7px;color:#666;margin-top:14px}
@media print{body{padding:5mm 8mm;font-size:10px}}
</style></head><body>

<div class="company-header">
  <h1>${b.business_name || 'D METRAN TRADING'}</h1>
  <div class="tagline">${b.trade_name || 'General Merchandise &amp; Integrated Trade Distribution'}</div>
  <div class="info">${b.address || ''}${b.city ? ', ' + b.city : ''} | Tel: ${b.telephone_number || b.mobile_number || ''} | Email: ${b.email_address || ''}</div>
  <div class="info">TIN: ${b.tin_number || '123-456-789-000'} | ${b.vat_type || 'VAT Registered'}</div>
</div>
<div class="dot-divider">================================================</div>
<div class="dot-divider-thin">------------------------------------------------</div>

<div class="doc-title">
  <h2>PURCHASE ORDER</h2>
  <div class="sub">Document No: ${d.po_number}</div>
</div>

<div class="details">
  <div class="details-left">
    <div class="label">Supplier Account</div>
    <p><strong>Name:</strong> ${d.supplier_name || '-'}</p>
    ${d.supplier_code ? `<p><strong>Supplier Code:</strong> ${d.supplier_code}</p>` : ''}
    ${d.supplier_address ? `<p><strong>Address:</strong> ${d.supplier_address}</p>` : ''}
    ${d.supplier_tin ? `<p><strong>TIN:</strong> ${d.supplier_tin}</p>` : ''}
    ${d.contact_person ? `<p><strong>Contact:</strong> ${d.contact_person}</p>` : ''}
    ${d.contact_number ? `<p><strong>Phone:</strong> ${d.contact_number}</p>` : ''}
  </div>
  <div class="details-right">
    <div class="label">Purchase Order Details</div>
    <p><strong>PO Number:</strong> ${d.po_number}</p>
    <p><strong>Order Date:</strong> ${new Date(d.order_date).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'})}</p>
    ${d.expected_date ? `<p><strong>Expected Delivery:</strong> ${new Date(d.expected_date).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'})}</p>` : ''}
    ${d.payment_terms ? `<p><strong>Payment Terms:</strong> ${d.payment_terms}</p>` : ''}
    <p><strong>VAT Mode:</strong> ${d.vat_mode || 'N/A'}</p>
    <p><strong>Status:</strong> ${d.status}</p>
  </div>
</div>

<table class="items-table">
  <thead><tr>
    <th>Item Description</th>
    <th style="width:55px;text-align:center">Qty</th>
    <th style="width:50px;text-align:center">UOM</th>
    <th style="width:80px;text-align:right">Unit Cost</th>
    <th style="width:70px;text-align:right">Discount</th>
    <th style="width:90px;text-align:right">Line Total</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="computation">
  <table class="comp-table">
    <tr><td>Total Items:</td><td>${items.rows.length}</td></tr>
    <tr><td>Total Quantity:</td><td>${totalQty}</td></tr>
    <tr><td>Trade Subtotal:</td><td>₱${fc(grossTotal)}</td></tr>
    ${discountAmt > 0 ? `<tr><td>Less Discount:</td><td>₱${fc(discountAmt)}</td></tr>` : ''}
    <tr><td>VATable Purchase:</td><td>₱${fc(vatableAmt)}</td></tr>
    <tr><td>Input VAT (12%):</td><td>₱${fc(vatAmt)}</td></tr>
    <tr class="total-row"><td>TOTAL PO AMOUNT:</td><td>₱${fc(total)}</td></tr>
  </table>
</div>

<div class="terms-sect">
  <div class="terms-left">
    <h4>PURCHASE TERMS &amp; SUPPLIER INSTRUCTIONS</h4>
    <p>Please deliver the ordered goods according to the quantities, unit cost, and delivery schedule stated in this Purchase Order. Any shortage, damaged item, wrong item, or expired item shall be subject to return or adjustment.</p>
  </div>
  <div class="terms-right">
    <h4>RECEIVING &amp; INVENTORY CONDITIONS</h4>
    <p>All received items must be checked against this Purchase Order. Batch number, expiry date, quantity received, and receiving location must be recorded before inventory is updated.</p>
  </div>
</div>

<div class="signatures">
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by<br>PURCHASING STAFF</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Checked by<br>INVENTORY / WAREHOUSE</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Approved by<br>M. METRAN (PROPRIETOR)</div></div>
</div>

<div class="footer-note">
  Printed: ${new Date().toLocaleString('en-PH')} | This is a computer-generated document
</div>

</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
