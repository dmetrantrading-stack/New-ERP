import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth';
import Layout from './components/layout/Layout';
import PosShell from './components/layout/PosShell';
import AccessDenied from './components/AccessDenied';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ExecutiveDashboard from './pages/dashboard/ExecutiveDashboard';
import ProductsPage from './pages/products/ProductsPage';
import StockOpsPage from './pages/stockOps/StockOpsPage';
import PurchaseOrders from './pages/purchases/PurchaseOrders';
import GoodsReceipts from './pages/purchases/GoodsReceipts';
import PurchaseRequisitions from './pages/purchases/PurchaseRequisitions';
import PurchaseReturns from './pages/purchases/PurchaseReturns';
import PurchaseMemos from './pages/purchases/PurchaseMemos';
import SalesInvoices from './pages/sales/SalesInvoices';
import SalesReturns from './pages/sales/SalesReturns';
import SalesMemos from './pages/sales/SalesMemos';
import SalesOrders from './pages/sales/SalesOrders';
import SalesQuotations from './pages/sales/SalesQuotations';
import DeliveryReceipt from './pages/sales/DeliveryReceipt';
import CollectionsPage from './pages/sales/CollectionsPage';
import CustomerStatementDetail from './pages/sales/CustomerStatementDetail';
import POSPage from './pages/pos/POSPage';
import CustomerList from './pages/customers/CustomerList';
import SuppliersPage from './pages/suppliers/SuppliersPage';
import SupplierCatalogPage from './pages/suppliers/SupplierCatalogPage';
import UserList from './pages/users/UserList';
import AccountingPage from './pages/accounting/AccountingPage';
import BankCashPage from './pages/bankCash/BankCashPage';
import ExpenseList from './pages/expenses/ExpenseList';
import PettyCashPage from './pages/pettyCash/PettyCashPage';
import LoansPayablePage from './pages/loans/LoansPayablePage';
import HrPage from './pages/hr/HrPage';
import ReportsPage from './pages/reports/ReportsPage';
import AuditPage from './pages/audit/AuditPage';
import PayablesPage from './pages/payables/PayablesPage';
import SettingsPage from './pages/settings/SettingsPage';
import PermissionEditor from './pages/settings/PermissionEditor';
import PermissionsPage from './pages/settings/PermissionsPage';
import { HR_PAGE_ACCESS_PERMS } from './lib/hrPermissions';
import { STOCK_OPS_ACCESS_PERMS } from './lib/stockOpsUtils';
import { getDefaultLandingPath } from './lib/defaultLandingPath';

const ProtectedRoute = ({ children, perm, permAny }: { children: React.ReactNode; perm?: string; permAny?: string[] }) => {
  const { user, loading, hasPerm, hasAnyPerm } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (permAny && !hasAnyPerm(permAny)) return <Layout><AccessDenied /></Layout>;
  if (perm && !hasPerm(perm)) return <Layout><AccessDenied /></Layout>;
  return <Layout>{children}</Layout>;
};

const PosProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, hasAnyPerm } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (!hasAnyPerm(['pos.view', 'pos.write'])) return <Layout><AccessDenied /></Layout>;
  return <PosShell>{children}</PosShell>;
};

function DefaultRedirect() {
  const { hasPerm, hasAnyPerm } = useAuth();
  return <Navigate to={getDefaultLandingPath(hasPerm, hasAnyPerm)} replace />;
}

const perm = (key: string) => key;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/" element={<ProtectedRoute perm={perm('dashboard.view')}><ExecutiveDashboard /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute perm={perm('inventory.inventory.view')}><ProductsPage /></ProtectedRoute>} />
      <Route path="/categories" element={<Navigate to="/products?tab=categories" replace />} />
      <Route path="/brands" element={<Navigate to="/products?tab=brands" replace />} />
      <Route path="/stock-ops" element={<ProtectedRoute permAny={[...STOCK_OPS_ACCESS_PERMS]}><StockOpsPage /></ProtectedRoute>} />
      <Route path="/inventory" element={<Navigate to="/stock-ops?tab=inventory" replace />} />
      <Route path="/unit-conversions" element={<Navigate to="/stock-ops?tab=unit-conversions" replace />} />

      <Route path="/purchases" element={<ProtectedRoute perm={perm('purchases.purchase-order.view')}><PurchaseOrders /></ProtectedRoute>} />
      <Route path="/purchase-requisitions" element={<ProtectedRoute perm={perm('purchases.purchase-order.view')}><PurchaseRequisitions /></ProtectedRoute>} />
      <Route path="/goods-receipts" element={<ProtectedRoute perm={perm('purchases.receiving-report.view')}><GoodsReceipts /></ProtectedRoute>} />
      <Route path="/purchase-returns" element={<ProtectedRoute perm={perm('purchases.receiving-report.view')}><PurchaseReturns /></ProtectedRoute>} />
      <Route path="/purchase-memos" element={<ProtectedRoute permAny={['purchases.apv.view', 'purchases.apv.create']}><PurchaseMemos /></ProtectedRoute>} />
      <Route path="/payables" element={<ProtectedRoute permAny={['purchases.apv.view', 'purchases.payment-voucher.view']}><PayablesPage /></ProtectedRoute>} />

      <Route path="/pos" element={<PosProtectedRoute><POSPage /></PosProtectedRoute>} />
      <Route path="/sales" element={<ProtectedRoute perm={perm('sales.sales-invoice.view')}><SalesInvoices /></ProtectedRoute>} />
      <Route path="/sales-returns" element={<ProtectedRoute perm={perm('sales.sales-invoice.view')}><SalesReturns /></ProtectedRoute>} />
      <Route path="/sales-memos" element={<ProtectedRoute perm={perm('sales.sales-invoice.view')}><SalesMemos /></ProtectedRoute>} />
      <Route path="/sales-orders" element={<ProtectedRoute perm={perm('sales.sales-order.view')}><SalesOrders /></ProtectedRoute>} />
      <Route path="/sales-quotations" element={<ProtectedRoute perm={perm('sales.sales-quotation.view')}><SalesQuotations /></ProtectedRoute>} />
      <Route path="/delivery-notes" element={<ProtectedRoute perm={perm('sales.delivery-receipt.view')}><DeliveryReceipt /></ProtectedRoute>} />
      <Route path="/collections" element={<ProtectedRoute perm={perm('sales.collections.view')}><CollectionsPage /></ProtectedRoute>} />
      <Route path="/customer-statement/:customerId" element={<ProtectedRoute perm={perm('sales.collections.view')}><CustomerStatementDetail /></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute perm={perm('sales.customers.view')}><CustomerList /></ProtectedRoute>} />

      <Route path="/suppliers" element={<ProtectedRoute perm={perm('purchases.suppliers.view')}><SuppliersPage /></ProtectedRoute>} />
      <Route path="/suppliers/:supplierId/catalog" element={<ProtectedRoute perm={perm('purchases.suppliers.view')}><SupplierCatalogPage /></ProtectedRoute>} />

      <Route path="/accounting" element={<ProtectedRoute perm={perm('finance.accounting.view')}><AccountingPage /></ProtectedRoute>} />
      <Route path="/bank-cash" element={<ProtectedRoute perm={perm('finance.bank-cash.view')}><BankCashPage /></ProtectedRoute>} />
      <Route path="/expenses" element={<ProtectedRoute perm={perm('finance.expenses.view')}><ExpenseList /></ProtectedRoute>} />
      <Route path="/petty-cash" element={<ProtectedRoute perm={perm('finance.petty-cash.view')}><PettyCashPage /></ProtectedRoute>} />
      <Route path="/loans-payable" element={<ProtectedRoute perm={perm('finance.loans.view')}><LoansPayablePage /></ProtectedRoute>} />

      <Route path="/bom" element={<Navigate to="/stock-ops?tab=bom" replace />} />
      <Route path="/production" element={<Navigate to="/stock-ops?tab=production" replace />} />
      <Route path="/inventory-count" element={<Navigate to="/stock-ops?tab=counts" replace />} />
      <Route path="/stock-transfers" element={<Navigate to="/stock-ops?tab=transfers" replace />} />

      <Route path="/hr" element={<ProtectedRoute permAny={[...HR_PAGE_ACCESS_PERMS]}><HrPage /></ProtectedRoute>} />

      <Route path="/reports" element={<ProtectedRoute permAny={['reports.view', 'reports.daily-payables', 'reports.daily-receivables']}><ReportsPage /></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute perm={perm('system.audit.view')}><AuditPage /></ProtectedRoute>} />

      <Route path="/users" element={<ProtectedRoute perm={perm('system.users.view')}><UserList /></ProtectedRoute>} />
      <Route path="/permissions" element={<ProtectedRoute perm={perm('system.users.edit')}><PermissionsPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute permAny={['system.settings.view', 'system.users.view', 'system.users.edit']}><SettingsPage /></ProtectedRoute>} />
      <Route path="/settings/permissions/:userId" element={<ProtectedRoute permAny={['system.users.view', 'system.users.edit']}><PermissionEditor /></ProtectedRoute>} />

      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  );
}
