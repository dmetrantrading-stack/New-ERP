import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { findDuplicateCogsInvoices } from '../../utils/glIntegrity';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const notifications: any[] = [];

    const lowStock = await query(
      `SELECT p.id as product_id, p.name, i.quantity, p.reorder_level, l.name as location_name
       FROM products p
       JOIN inventory i ON p.id = i.product_id
       JOIN locations l ON i.location_id = l.id
       WHERE p.is_active = true AND p.reorder_level > 0 AND i.quantity <= p.reorder_level
       ORDER BY (i.quantity::float / NULLIF(p.reorder_level, 0)) ASC
       LIMIT 10`
    );

    for (const item of lowStock.rows) {
      notifications.push({
        type: 'low_stock',
        title: 'Low Stock Alert',
        message: `${item.name} is low on stock (${item.quantity}/${item.reorder_level}) at ${item.location_name}`,
        reference_type: 'product',
        reference_id: item.product_id,
        path: '/inventory',
      });
    }

    const expiring = await query(
      `SELECT b.id as batch_id, b.*, p.name as product_name
       FROM batches b
       JOIN products p ON b.product_id = p.id
       WHERE b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND b.quantity > 0
       ORDER BY b.expiry_date`
    );

    for (const item of expiring.rows) {
      const daysLeft = Math.ceil((new Date(item.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      notifications.push({
        type: 'expiring',
        title: 'Expiry Alert',
        message: `${item.product_name} (Batch: ${item.batch_number}) expires in ${daysLeft} days`,
        reference_type: 'batch',
        reference_id: item.batch_id,
        path: '/inventory',
      });
    }

    const overdueAR = await query(
      `SELECT c.id as customer_id, c.customer_name, c.balance
       FROM customers c
       WHERE c.balance > 0
       ORDER BY c.balance DESC
       LIMIT 5`
    );

    for (const item of overdueAR.rows) {
      notifications.push({
        type: 'overdue_ar',
        title: 'Outstanding Receivable',
        message: `${item.customer_name} has outstanding balance of ₱${parseFloat(item.balance).toFixed(2)}`,
        reference_type: 'customer',
        reference_id: String(item.customer_id),
        path: `/customer-statement/${item.customer_id}`,
      });
    }

    const overdueAP = await query(
      `SELECT s.id as supplier_id, s.supplier_name, s.balance
       FROM suppliers s
       WHERE s.balance > 0
       ORDER BY s.balance DESC
       LIMIT 5`
    );

    for (const item of overdueAP.rows) {
      notifications.push({
        type: 'overdue_ap',
        title: 'Outstanding Payable',
        message: `${item.supplier_name} has outstanding balance of ₱${parseFloat(item.balance).toFixed(2)}`,
        reference_type: 'supplier',
        reference_id: String(item.supplier_id),
        path: '/payables',
      });
    }

    const pendingPO = await query(
      `SELECT po.id as po_id, po.po_number, s.supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       WHERE po.status IN ('Draft', 'Sent')
       LIMIT 5`
    );

    for (const item of pendingPO.rows) {
      notifications.push({
        type: 'pending_po',
        title: 'Pending Purchase Order',
        message: `PO ${item.po_number} from ${item.supplier_name || 'N/A'} is pending`,
        reference_type: 'po',
        reference_id: item.po_id,
        path: '/purchases',
      });
    }

    const pendingPR = await query(
      `SELECT pr.id, pr.pr_number FROM purchase_requisitions pr
       WHERE pr.status IN ('Draft', 'Pending') ORDER BY pr.created_at DESC LIMIT 5`,
    );
    for (const item of pendingPR.rows) {
      notifications.push({
        type: 'pending_pr',
        title: 'PR Awaiting Approval',
        message: `${item.pr_number} needs approval`,
        reference_type: 'pr',
        reference_id: item.id,
        path: '/purchase-requisitions',
      });
    }

    const draftApv = await query(
      `SELECT a.id, a.apv_number, s.supplier_name FROM ap_vouchers a
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       WHERE a.status = 'Draft' ORDER BY a.created_at DESC LIMIT 5`,
    );
    for (const item of draftApv.rows) {
      notifications.push({
        type: 'draft_apv',
        title: 'Draft AP Voucher',
        message: `${item.apv_number} for ${item.supplier_name || 'supplier'} is still draft`,
        reference_type: 'apv',
        reference_id: item.id,
        path: '/payables',
      });
    }

    const overdueInv = await query(
      `SELECT si.id, si.invoice_number, c.customer_name, si.balance, si.due_date
       FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.status IN ('Posted', 'Partial', 'Overdue')
         AND si.balance > 0 AND si.due_date < CURRENT_DATE
       ORDER BY si.due_date ASC LIMIT 5`,
    );
    for (const item of overdueInv.rows) {
      notifications.push({
        type: 'overdue_invoice',
        title: 'Overdue Invoice',
        message: `${item.invoice_number} (${item.customer_name}) — ₱${parseFloat(item.balance).toFixed(2)} due ${item.due_date}`,
        reference_type: 'invoice',
        reference_id: item.id,
        path: '/sales',
      });
    }

    const pendingDr = await query(
      `SELECT dn.id, dn.dr_number, c.customer_name, dn.delivery_date
       FROM delivery_notes dn
       LEFT JOIN customers c ON c.id = dn.customer_id
       WHERE dn.status = 'Draft' AND dn.delivery_date <= CURRENT_DATE
       ORDER BY dn.delivery_date ASC LIMIT 5`,
    );
    for (const item of pendingDr.rows) {
      notifications.push({
        type: 'pending_dr',
        title: 'DR Ready to Post',
        message: `${item.dr_number} for ${item.customer_name || 'customer'} — delivery ${item.delivery_date}`,
        reference_type: 'dr',
        reference_id: item.id,
        path: '/delivery-notes',
      });
    }

    try {
      const dupes = await findDuplicateCogsInvoices();
      if (dupes.length > 0) {
        notifications.push({
          type: 'gl_integrity',
          title: 'Duplicate COGS Detected',
          message: `${dupes.length} invoice(s) have DR + SI double COGS — review in Accounting → GL Integrity`,
          reference_type: 'gl_integrity',
          reference_id: 'duplicate-cogs',
          path: '/accounting',
        });
      }
    } catch { /* non-blocking */ }

    const limitedNotifications = notifications.slice(0, 25);
    res.json({ data: limitedNotifications, unread_count: limitedNotifications.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
