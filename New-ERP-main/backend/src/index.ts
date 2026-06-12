import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';

// Import routes
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import productRoutes from './modules/products/products.routes';
import categoryRoutes from './modules/categories/categories.routes';
import brandRoutes from './modules/brands/brands.routes';
import customerRoutes from './modules/customers/customers.routes';
import supplierRoutes from './modules/suppliers/suppliers.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import purchaseRoutes from './modules/purchases/purchases.routes';
import salesRoutes from './modules/sales/sales.routes';
import posRoutes from './modules/pos/pos.routes';
import accountingRoutes from './modules/accounting/accounting.routes';
import stockTransferRoutes from './modules/stockTransfer/stockTransfer.routes';
import bankCashRoutes from './modules/bankCash/bankCash.routes';
import expenseRoutes from './modules/expenses/expenses.routes';
import hrRoutes from './modules/hr/hr.routes';
import reportRoutes from './modules/reports/reports.routes';
import auditRoutes from './modules/audit/audit.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import conversionRoutes from './modules/conversions/conversions.routes';
import payableRoutes from './modules/payables/payables.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import inventoryCountRoutes from './modules/inventoryCount/inventoryCount.routes';
import settingsRoutes from './modules/settings/settings.routes';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/stock-transfers', stockTransferRoutes);
app.use('/api/bank-cash', bankCashRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/conversions', conversionRoutes);
app.use('/api/payables', payableRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/inventory-count', inventoryCountRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`D METRAN ERP Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

export default app;
