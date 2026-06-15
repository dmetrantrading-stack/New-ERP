import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Generate notifications on-the-fly from current data
    const notifications: any[] = [];

    // Low stock alerts
    const lowStock = await query(
      `SELECT p.name, i.quantity, p.reorder_level, l.name as location_name
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
      });
    }

    // Expiring items
    const expiring = await query(
      `SELECT b.*, p.name as product_name
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
      });
    }

    // Overdue receivables
    const overdueAR = await query(
      `SELECT c.customer_name, c.balance
       FROM customers c
       WHERE c.balance > 0
       ORDER BY c.balance DESC
       LIMIT 5`
    );

    for (const item of overdueAR.rows) {
      notifications.push({
        type: 'overdue_ar',
        title: 'Overdue Receivable',
        message: `${item.customer_name} has outstanding balance of ₱${parseFloat(item.balance).toFixed(2)}`,
        reference_type: 'customer',
      });
    }

    // Overdue payables
    const overdueAP = await query(
      `SELECT s.supplier_name, s.balance
       FROM suppliers s
       WHERE s.balance > 0
       ORDER BY s.balance DESC
       LIMIT 5`
    );

    for (const item of overdueAP.rows) {
      notifications.push({
        type: 'overdue_ap',
        title: 'Overdue Payable',
        message: `${item.supplier_name} has outstanding balance of ₱${parseFloat(item.balance).toFixed(2)}`,
        reference_type: 'supplier',
      });
    }

    // Pending POs
    const pendingPO = await query(
      `SELECT po.po_number, s.supplier_name
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
      });
    }

    // Limit notifications
    const limitedNotifications = notifications.slice(0, 20);

    // Store unread count
    const unreadCount = limitedNotifications.length;

    res.json({ data: limitedNotifications, unread_count: unreadCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
