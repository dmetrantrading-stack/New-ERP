import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, hasUserPerm, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import {
  tableRow, fc, fmtCurrency, fmtDate,
  renderEnterpriseItemsTable, renderEnterpriseSectionTitle, renderEnterpriseTotalBanner,
} from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildEnterpriseSignatures,
} from '../../utils/salesEnterprisePrint';

const router = Router();

const prodView = hasUserPerm('inventory.production.view');
const prodPrint = hasUserPerm('inventory.production.print');

const generatePONumber = async (): Promise<string> => {
  const yr = new Date().getFullYear();
  const r = await query(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(po_number, 10) AS INTEGER)), 0) + 1 as next FROM production_orders WHERE po_number LIKE $1",
    ['PO-' + yr + '-%']
  );
  return 'PO-' + yr + '-' + String(r.rows[0]?.next || 1).padStart(6, '0');
};

// List
router.get('/', authenticate, prodView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let where = ''; const params: any[] = []; let i = 1;
    if (status) { where = 'WHERE po.status = $' + (i++); params.push(status); }

    const cnt = await query('SELECT COUNT(*) FROM production_orders po ' + where, params);
    const total = parseInt(cnt.rows[0].count);

    const r = await query(
      'SELECT po.*, u.full_name as created_by_name, uc.full_name as completed_by_name FROM production_orders po LEFT JOIN users u ON po.created_by = u.id LEFT JOIN users uc ON po.completed_by = uc.id ' + where + ' ORDER BY po.created_at DESC LIMIT $' + (i++) + ' OFFSET $' + (i++),
      [...params, limit, offset]
    );

    res.json({ data: r.rows, total, page, limit });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get
router.get('/:id', authenticate, prodView, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM production_orders WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const inputs = await query(
      'SELECT pi.*, p.name as product_name, p.sku, p.unit_of_measure as product_uom FROM production_order_inputs pi LEFT JOIN products p ON pi.product_id = p.id WHERE pi.po_id = $1',
      [req.params.id]
    );
    const outputs = await query(
      'SELECT po.*, p.name as product_name, p.sku, p.unit_of_measure as product_uom FROM production_order_outputs po LEFT JOIN products p ON po.product_id = p.id WHERE po.po_id = $1',
      [req.params.id]
    );
    res.json({ ...r.rows[0], inputs: inputs.rows, outputs: outputs.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Create
router.post('/', authenticate, hasUserPerm('inventory.production.create'), auditLog('Production', 'Create Production Order'), async (req: AuthRequest, res: Response) => {
  try {
    const po_number = await generatePONumber();
    const { po_date, source_location_id, destination_location_id, notes, inputs, outputs } = req.body;

    if (!inputs || inputs.length === 0) return res.status(400).json({ error: 'At least one input item is required' });
    if (!outputs || outputs.length === 0) return res.status(400).json({ error: 'At least one output item is required' });
    if (!source_location_id || !destination_location_id) return res.status(400).json({ error: 'Source and destination locations are required' });

    // Compute costs
    let totalInputCost = 0;
    for (const inp of inputs) {
      const qty = parseFloat(inp.quantity) || 0;
      if (qty <= 0) return res.status(400).json({ error: 'Input quantity must be > 0' });
      const cost = parseFloat(inp.unit_cost) || 0;
      totalInputCost += qty * cost;
    }

    let totalOutputQty = 0;
    for (const out of outputs) {
      const qty = parseFloat(out.quantity) || 0;
      if (qty <= 0) return res.status(400).json({ error: 'Output quantity must be > 0' });
      totalOutputQty += qty;
    }
    const outputUnitCost = totalOutputQty > 0 ? Math.round((totalInputCost / totalOutputQty) * 10000) / 10000 : 0;

    const id = uuidv4();
    await query(
      'INSERT INTO production_orders (id, po_number, po_date, source_location_id, destination_location_id, status, notes, total_input_cost, total_output_qty, output_unit_cost, created_by) VALUES ($1,$2,$3,$4,$5,\'Draft\',$6,$7,$8,$9,$10)',
      [id, po_number, po_date || new Date().toISOString().split('T')[0], source_location_id, destination_location_id, notes || null, totalInputCost, totalOutputQty, outputUnitCost, req.user!.id]
    );

    for (const inp of inputs) {
      await query(
        'INSERT INTO production_order_inputs (id, po_id, product_id, uom, quantity, unit_cost, total_cost, location_id, batch_number, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [uuidv4(), id, inp.product_id, inp.uom || 'pcs', inp.quantity || 0, inp.unit_cost || 0, (inp.quantity || 0) * (inp.unit_cost || 0), source_location_id, inp.batch_number || null, inp.expiry_date || null]
      );
    }

    for (const out of outputs) {
      await query(
        'INSERT INTO production_order_outputs (id, po_id, product_id, uom, quantity, unit_cost, total_cost, location_id, batch_number, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [uuidv4(), id, out.product_id, out.uom || 'pcs', out.quantity || 0, outputUnitCost, outputUnitCost * (out.quantity || 0), destination_location_id, out.batch_number || null, out.expiry_date || null]
      );
    }

    res.status(201).json({ id, po_number, output_unit_cost: outputUnitCost });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Update (Draft only)
router.patch('/:id', authenticate, hasUserPerm('inventory.production.edit'), auditLog('Production', 'Update Production Order'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM production_orders WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (r.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft orders can be edited' });

    const { po_date, source_location_id, destination_location_id, notes, inputs, outputs } = req.body;

    if (!inputs || inputs.length === 0) return res.status(400).json({ error: 'At least one input item is required' });
    if (!outputs || outputs.length === 0) return res.status(400).json({ error: 'At least one output item is required' });

    let totalInputCost = 0;
    for (const inp of inputs) {
      const qty = parseFloat(inp.quantity) || 0;
      if (qty <= 0) return res.status(400).json({ error: 'Input quantity must be > 0' });
      totalInputCost += qty * (parseFloat(inp.unit_cost) || 0);
    }

    let totalOutputQty = 0;
    for (const out of outputs) {
      const qty = parseFloat(out.quantity) || 0;
      if (qty <= 0) return res.status(400).json({ error: 'Output quantity must be > 0' });
      totalOutputQty += qty;
    }
    const outputUnitCost = totalOutputQty > 0 ? Math.round((totalInputCost / totalOutputQty) * 10000) / 10000 : 0;

    await query(
      'UPDATE production_orders SET po_date=$1, source_location_id=$2, destination_location_id=$3, notes=$4, total_input_cost=$5, total_output_qty=$6, output_unit_cost=$7, updated_at=CURRENT_TIMESTAMP WHERE id=$8',
      [po_date, source_location_id, destination_location_id, notes || null, totalInputCost, totalOutputQty, outputUnitCost, req.params.id]
    );

    await query('DELETE FROM production_order_inputs WHERE po_id = $1', [req.params.id]);
    for (const inp of inputs) {
      await query(
        'INSERT INTO production_order_inputs (id, po_id, product_id, uom, quantity, unit_cost, total_cost, location_id, batch_number, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [uuidv4(), req.params.id, inp.product_id, inp.uom || 'pcs', inp.quantity || 0, inp.unit_cost || 0, (inp.quantity || 0) * (inp.unit_cost || 0), source_location_id, inp.batch_number || null, inp.expiry_date || null]
      );
    }

    await query('DELETE FROM production_order_outputs WHERE po_id = $1', [req.params.id]);
    for (const out of outputs) {
      await query(
        'INSERT INTO production_order_outputs (id, po_id, product_id, uom, quantity, unit_cost, total_cost, location_id, batch_number, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [uuidv4(), req.params.id, out.product_id, out.uom || 'pcs', out.quantity || 0, outputUnitCost, outputUnitCost * (out.quantity || 0), destination_location_id, out.batch_number || null, out.expiry_date || null]
      );
    }

    res.json({ id: req.params.id, po_number: r.rows[0].po_number, output_unit_cost: outputUnitCost });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Complete
router.post('/:id/complete', authenticate, hasUserPerm('inventory.production.approve'), auditLog('Production', 'Complete Production Order'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const r = await client.query('SELECT * FROM production_orders WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (r.rows[0].status !== 'Draft') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only draft orders can be completed' }); }

    const po = r.rows[0];
    const inputs = await client.query('SELECT * FROM production_order_inputs WHERE po_id = $1', [req.params.id]);
    const outputs = await client.query('SELECT * FROM production_order_outputs WHERE po_id = $1', [req.params.id]);

    // Validate and deduct input stock
    for (const inp of inputs.rows) {
      const inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [inp.product_id, inp.location_id || po.source_location_id]);
      if (inv.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No inventory found for input product at source location` });
      }
      const available = parseFloat(inv.rows[0].quantity);
      if (parseFloat(inp.quantity) > available) {
        await client.query('ROLLBACK');
        const prod = await client.query('SELECT name FROM products WHERE id = $1', [inp.product_id]);
        return res.status(400).json({ error: `Insufficient stock for ${prod.rows[0]?.name || 'product'}. Available: ${available}, Required: ${inp.quantity}` });
      }
      // Deduct
      await client.query('UPDATE inventory SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [inp.quantity, inv.rows[0].id]);
      // Inventory ledger - OUT
      await client.query(
        'INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT quantity FROM inventory WHERE id = $8),$9,$10,$11,$12)',
        [uuidv4(), inp.product_id, inp.location_id || po.source_location_id, 'Production Order', req.params.id, 'OUT', inp.quantity, inv.rows[0].id, inp.unit_cost, inp.quantity * parseFloat(inp.unit_cost), 'Production: ' + po.po_number, req.user!.id]
      );
    }

    // Add output stock
    for (const out of outputs.rows) {
      const inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [out.product_id, out.location_id || po.destination_location_id]);
      const unitCost = parseFloat(out.unit_cost) || parseFloat(po.output_unit_cost);
      if (inv.rows.length > 0) {
        // Update existing inventory - recalculate weighted average
        const oldQty = parseFloat(inv.rows[0].quantity);
        const oldCost = parseFloat(inv.rows[0].unit_cost);
        const newQty = oldQty + parseFloat(out.quantity);
        const newAvgCost = newQty > 0 ? ((oldQty * oldCost) + (parseFloat(out.quantity) * unitCost)) / newQty : unitCost;
        await client.query('UPDATE inventory SET quantity = $1, unit_cost = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newQty, newAvgCost, inv.rows[0].id]);
      } else {
        await client.query(
          'INSERT INTO inventory (product_id, location_id, quantity, unit_cost, updated_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
          [out.product_id, out.location_id || po.destination_location_id, out.quantity, unitCost]
        );
      }
      // Inventory ledger - IN
      await client.query(
        'INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(quantity,0) FROM inventory WHERE product_id = $2 AND location_id = $3),$8,$9,$10,$11)',
        [uuidv4(), out.product_id, out.location_id || po.destination_location_id, 'Production Order', req.params.id, 'IN', out.quantity, unitCost, unitCost * parseFloat(out.quantity), 'Production: ' + po.po_number, req.user!.id]
      );

      // Create batch record if output has batch/expiry
      if (out.batch_number || out.expiry_date) {
        const existingBatch = await client.query('SELECT * FROM batches WHERE product_id = $1 AND batch_number = $2 AND location_id = $3', [out.product_id, out.batch_number, out.location_id || po.destination_location_id]);
        if (existingBatch.rows.length > 0) {
          const bQty = parseFloat(existingBatch.rows[0].quantity);
          const bCost = parseFloat(existingBatch.rows[0].unit_cost);
          const newQty = bQty + parseFloat(out.quantity);
          const newAvgCost = newQty > 0 ? ((bQty * bCost) + (parseFloat(out.quantity) * unitCost)) / newQty : unitCost;
          await client.query('UPDATE batches SET quantity = $1, unit_cost = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newQty, newAvgCost, existingBatch.rows[0].id]);
        } else {
          await client.query(
            'INSERT INTO batches (id, product_id, location_id, batch_number, expiry_date, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [uuidv4(), out.product_id, out.location_id || po.destination_location_id, out.batch_number, out.expiry_date, out.quantity, unitCost]
          );
        }
      }
    }

    await client.query('UPDATE production_orders SET status=$1, completed_by=$2, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$3', ['Completed', req.user!.id, req.params.id]);
    await client.query('COMMIT');
    res.json({ id: req.params.id, status: 'Completed' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Cancel
router.post('/:id/cancel', authenticate, hasUserPerm('inventory.production.edit'), auditLog('Production', 'Cancel Production Order'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM production_orders WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (r.rows[0].status === 'Cancelled') return res.status(400).json({ error: 'Already cancelled' });

    if (r.rows[0].status === 'Completed') {
      // Reverse inventory
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const po = r.rows[0];
        const inputs = await client.query('SELECT * FROM production_order_inputs WHERE po_id = $1', [req.params.id]);
        const outputs = await client.query('SELECT * FROM production_order_outputs WHERE po_id = $1', [req.params.id]);

        // Reverse outputs (deduct)
        for (const out of outputs.rows) {
          const inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [out.product_id, out.location_id || po.destination_location_id]);
          if (inv.rows.length > 0) {
            const newQty = Math.max(0, parseFloat(inv.rows[0].quantity) - parseFloat(out.quantity));
            await client.query('UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, inv.rows[0].id]);
          }
          // Reverse batch records for outputs
          if (out.batch_number) {
            const batch = await client.query('SELECT * FROM batches WHERE product_id = $1 AND batch_number = $2 AND location_id = $3', [out.product_id, out.batch_number, out.location_id || po.destination_location_id]);
            if (batch.rows.length > 0) {
              const newBatchQty = Math.max(0, parseFloat(batch.rows[0].quantity) - parseFloat(out.quantity));
              if (newBatchQty <= 0) {
                await client.query('DELETE FROM batches WHERE id = $1', [batch.rows[0].id]);
              } else {
                await client.query('UPDATE batches SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newBatchQty, batch.rows[0].id]);
              }
            }
          }
        }
        // Reverse inputs (add back)
        for (const inp of inputs.rows) {
          const inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [inp.product_id, inp.location_id || po.source_location_id]);
          if (inv.rows.length > 0) {
            await client.query('UPDATE inventory SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [inp.quantity, inv.rows[0].id]);
          } else {
            await client.query('INSERT INTO inventory (product_id, location_id, quantity, unit_cost, updated_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)', [inp.product_id, inp.location_id || po.source_location_id, inp.quantity, inp.unit_cost || 0]);
          }
        }

        await client.query('UPDATE production_orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', ['Cancelled', req.params.id]);
        await client.query('COMMIT');
        res.json({ id: req.params.id, status: 'Cancelled' });
      } catch (error: any) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
      } finally {
        client.release();
      }
    } else {
      await query('UPDATE production_orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', ['Cancelled', req.params.id]);
      res.json({ id: req.params.id, status: 'Cancelled' });
    }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Delete
router.delete('/:id', authenticate, hasUserPerm('inventory.production.edit'), auditLog('Production', 'Delete Production Order'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM production_orders WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (r.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft orders can be deleted' });
    await query('DELETE FROM production_orders WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Print
router.get('/:id/print', authenticate, prodPrint, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM production_orders WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const po = r.rows[0];
    const inputs = await query('SELECT pi.*, p.name as product_name, p.sku FROM production_order_inputs pi LEFT JOIN products p ON pi.product_id = p.id WHERE pi.po_id = $1', [req.params.id]);
    const outputs = await query('SELECT po2.*, p.name as product_name, p.sku FROM production_order_outputs po2 LEFT JOIN products p ON po2.product_id = p.id WHERE po2.po_id = $1', [req.params.id]);

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const inputRows = inputs.rows.map((i: any, idx: number) => tableRow([
      { html: String(idx + 1), align: 'c' },
      { html: i.product_name || '—' },
      { html: i.sku || '—', align: 'c' },
      { html: i.uom || '—', align: 'c' },
      { html: fc(i.quantity), align: 'r' },
      { html: i.batch_number || '—', align: 'c' },
      { html: i.expiry_date ? fmtDate(i.expiry_date, 'short') : '—', align: 'c' },
      { html: fmtCurrency(i.unit_cost), align: 'r' },
      { html: fmtCurrency(i.total_cost), align: 'r' },
    ])).join('');

    const outputRows = outputs.rows.map((o: any, idx: number) => tableRow([
      { html: String(idx + 1), align: 'c' },
      { html: o.product_name || '—' },
      { html: o.sku || '—', align: 'c' },
      { html: o.uom || '—', align: 'c' },
      { html: fc(o.quantity), align: 'r' },
      { html: o.batch_number || '—', align: 'c' },
      { html: o.expiry_date ? fmtDate(o.expiry_date, 'short') : '—', align: 'c' },
      { html: fmtCurrency(o.unit_cost), align: 'r' },
      { html: fmtCurrency(o.total_cost), align: 'r' },
    ])).join('');

    const lineHeaders = [
      { text: '#', align: 'center' as const, width: '28px' },
      { text: 'Product', align: 'left' as const },
      { text: 'Item Code', align: 'center' as const, width: '72px' },
      { text: 'UOM', align: 'center' as const, width: '40px' },
      { text: 'Qty', align: 'center' as const, width: '44px' },
      { text: 'Batch #', align: 'center' as const, width: '64px' },
      { text: 'Expiry', align: 'center' as const, width: '64px' },
      { text: 'Unit Cost', align: 'right' as const, width: '76px' },
      { text: 'Amount', align: 'right' as const, width: '80px' },
    ];

    const beforeItemsHtml = [
      renderEnterpriseSectionTitle('Input Materials'),
      renderEnterpriseItemsTable(lineHeaders, inputRows),
      renderEnterpriseTotalBanner('Total Input Cost', fmtCurrency(po.total_input_cost)),
      renderEnterpriseSectionTitle('Output Finished Goods'),
      renderEnterpriseItemsTable(lineHeaders, outputRows),
    ].join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Production Order ${po.po_number}`,
      docTitle: 'Production Order',
      docMetaRows: [
        { label: 'Document No.', value: po.po_number || '—' },
        { label: 'Production Date', value: fmtDate(po.po_date || po.created_at, 'short') },
        { label: 'Source Location', value: String(po.source_location_id || '—') },
        { label: 'Status', value: String(po.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Production Details',
      customerRows: [
        { label: 'Destination Location', value: String(po.destination_location_id || '—') },
      ],
      detailsRows: [
        { label: 'Total Input Cost', value: fmtCurrency(po.total_input_cost) },
        { label: 'Total Output Qty', value: fc(po.total_output_qty) },
      ],
      beforeItemsHtml,
      skipItemsTable: true,
      summaryRows: [
        { label: 'Total Output Qty', value: fc(po.total_output_qty) },
        { label: 'OUTPUT UNIT COST', value: fmtCurrency(po.output_unit_cost), total: true },
      ],
      amountInWords: parseFloat(po.output_unit_cost) || 0,
      notes: po.notes ? [{ label: 'Remarks', content: po.notes }] : [],
      footerNote: 'System-generated production order.',
      status: po.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
