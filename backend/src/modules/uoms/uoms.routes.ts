import { Router, Response } from 'express';
import { authenticate, AuthRequest, hasUserAnyPerm, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { createUomCatalogEntry, deactivateUomCatalogEntry, loadUomCatalogRows } from '../../utils/uomCatalog';

const router = Router();

const uomLookup = hasUserAnyPerm([
  'inventory.inventory.view', 'inventory.inventory.edit', 'inventory.inventory.create',
  'purchases.purchase-order.view', 'purchases.purchase-order.create', 'purchases.purchase-order.edit',
  'purchases.receiving-report.view', 'purchases.receiving-report.create', 'purchases.receiving-report.edit',
  'sales.sales-invoice.view', 'sales.sales-invoice.create', 'sales.sales-invoice.edit',
  'sales.sales-order.view', 'sales.sales-order.create', 'sales.sales-order.edit',
  'sales.sales-quotation.view', 'sales.sales-quotation.create',
  'sales.delivery-receipt.view', 'sales.delivery-receipt.create',
  'pos.view', 'pos.write',
]);

router.get('/catalog', authenticate, uomLookup, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await loadUomCatalogRows();
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/catalog', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('UOM', 'Add UOM'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await createUomCatalogEntry(req.body?.code, req.body?.name);
    res.status(201).json(row);
  } catch (error: any) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/catalog/:id', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('UOM', 'Remove UOM'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await deactivateUomCatalogEntry(Number(req.params.id));
    res.json(row);
  } catch (error: any) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
