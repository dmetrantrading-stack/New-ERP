import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth';
import Layout from './components/layout/Layout';
import LoginPage from './pages/auth/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ExecutiveDashboard from './pages/dashboard/ExecutiveDashboard';
import ProductsPage from './pages/products/ProductsPage';
import CategoryList from './pages/categories/CategoryList';
import BrandList from './pages/brands/BrandList';
import InventoryPage from './pages/inventory/InventoryPage';
import PurchaseOrders from './pages/purchases/PurchaseOrders';
import SalesInvoices from './pages/sales/SalesInvoices';
import CollectionsPage from './pages/sales/CollectionsPage';
import CustomerStatementDetail from './pages/sales/CustomerStatementDetail';
import POSPage from './pages/pos/POSPage';
import CustomerList from './pages/customers/CustomerList';
import SupplierList from './pages/suppliers/SupplierList';
import UserList from './pages/users/UserList';
import AccountingPage from './pages/accounting/AccountingPage';
import StockTransferPage from './pages/stockTransfer/StockTransferPage';
import BankCashPage from './pages/bankCash/BankCashPage';
import ExpenseList from './pages/expenses/ExpenseList';
import HrPage from './pages/hr/HrPage';
import ReportsPage from './pages/reports/ReportsPage';
import AuditPage from './pages/audit/AuditPage';
import InventoryCountPage from './pages/inventoryCount/InventoryCountPage';
import PayablesPage from './pages/payables/PayablesPage';
import ProductionOrders from './pages/production/ProductionOrders';
import FinancePage from './pages/finance/FinancePage';
import SettingsPage from './pages/settings/SettingsPage';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!user) return <Navigate to="/login" />;
  return <Layout>{children}</Layout>;
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><ExecutiveDashboard /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute><ProductsPage /></ProtectedRoute>} />
      <Route path="/categories" element={<ProtectedRoute><CategoryList /></ProtectedRoute>} />
      <Route path="/brands" element={<ProtectedRoute><BrandList /></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute><InventoryPage /></ProtectedRoute>} />
      <Route path="/purchases" element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>} />
      <Route path="/sales" element={<ProtectedRoute><SalesInvoices /></ProtectedRoute>} />
      <Route path="/pos" element={<ProtectedRoute><POSPage /></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute><CustomerList /></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute><SupplierList /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UserList /></ProtectedRoute>} />
      <Route path="/finance" element={<ProtectedRoute><FinancePage /></ProtectedRoute>} />
      <Route path="/accounting" element={<ProtectedRoute><AccountingPage /></ProtectedRoute>} />
      <Route path="/stock-transfers" element={<ProtectedRoute><StockTransferPage /></ProtectedRoute>} />
      <Route path="/bank-cash" element={<ProtectedRoute><BankCashPage /></ProtectedRoute>} />
      <Route path="/expenses" element={<ProtectedRoute><ExpenseList /></ProtectedRoute>} />
      <Route path="/hr" element={<ProtectedRoute><HrPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute><AuditPage /></ProtectedRoute>} />
      <Route path="/inventory-count" element={<ProtectedRoute><InventoryCountPage /></ProtectedRoute>} />
      <Route path="/payables" element={<ProtectedRoute><PayablesPage /></ProtectedRoute>} />
      <Route path="/production" element={<ProtectedRoute><ProductionOrders /></ProtectedRoute>} />
      <Route path="/collections" element={<ProtectedRoute><CollectionsPage /></ProtectedRoute>} />
      <Route path="/customer-statement/:customerId" element={<ProtectedRoute><CustomerStatementDetail /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
