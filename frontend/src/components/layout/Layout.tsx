import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import {
  LayoutDashboard, Package, ShoppingCart, Users, UserPlus, FileSpreadsheet,
  BarChart3, Settings, LogOut, Menu, X, ChevronDown, Bell, Search,
  Warehouse, Truck, DollarSign, Building2, Receipt, Database, Shield,
  Briefcase, Clock, CreditCard, ScrollText, Wallet, Banknote
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface MenuItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: { label: string; path: string }[];
}

const menuItems: MenuItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Products', icon: Package, path: '/products' },
  {
    label: 'Inventory',
    icon: Warehouse,
    children: [
      { label: 'Inventory', path: '/inventory' },
      { label: 'Production', path: '/production' },
      { label: 'Inventory Counts', path: '/inventory-count' },
      { label: 'Stock Transfers', path: '/stock-transfers' },
    ],
  },
  {
    label: 'Purchases',
    icon: ShoppingCart,
    children: [
      { label: 'Purchase Orders', path: '/purchases' },
      { label: 'Accounts Payable', path: '/payables' },
    ],
  },
  {
    label: 'Sales',
    icon: Receipt,
    children: [
      { label: 'POS', path: '/pos' },
      { label: 'Sales Invoices', path: '/sales' },
      { label: 'Collections & AR', path: '/collections' },
    ],
  },
  { label: 'Customers', icon: Users, path: '/customers' },
  { label: 'Suppliers', icon: UserPlus, path: '/suppliers' },
  {
    label: 'Finance',
    icon: DollarSign,
    children: [
      { label: 'Accounting', path: '/accounting' },
      { label: 'Bank & Cash', path: '/bank-cash' },
      { label: 'Expenses', path: '/expenses' },
      { label: 'Petty Cash', path: '/petty-cash' },
    ],
  },
  { label: 'HR & Payroll', icon: Briefcase, path: '/hr' },
  { label: 'Reports', icon: FileSpreadsheet, path: '/reports' },
  {
    label: 'System',
    icon: Settings,
    children: [
      { label: 'Users', path: '/users' },
      { label: 'Audit Trail', path: '/audit' },
      { label: 'Settings', path: '/settings' },
    ],
  },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const hasPerm = (key: string) => {
    if (!user) return true;
    if (user.role_name === 'Admin' || user.role_name === 'Owner') return true;
    return user.permissions?.includes(key) || false;
  };

  const menuKeyToPerm: Record<string, string> = {
    '/': 'dashboard.view',
    '/products': 'sales.sales-invoice.view',
    '/inventory': 'inventory.inventory.view',
    '/production': 'inventory.production.view',
    '/inventory-count': 'inventory.counts.view',
    '/stock-transfers': 'inventory.stock-transfer.view',
    '/purchases': 'purchases.purchase-order.view',
    '/payables': 'purchases.apv.view',
    '/pos': 'sales.collection-receipt.view',
    '/sales': 'sales.sales-invoice.view',
    '/collections': 'sales.collections.view',
    '/customers': 'sales.sales-invoice.view',
    '/suppliers': 'purchases.purchase-order.view',
    '/accounting': 'finance.accounting.view',
    '/bank-cash': 'finance.bank-cash.view',
    '/expenses': 'finance.expenses.view',
    '/petty-cash': 'finance.petty-cash.view',
    '/hr': 'hr.employees.view',
    '/reports': 'reports.view',
    '/users': 'system.users.view',
    '/audit': 'system.users.view',
    '/settings': 'system.settings.view',
  };

  const filteredMenu = menuItems.filter(item => {
    if (item.path) return hasPerm(menuKeyToPerm[item.path] || '');
    if (item.children) {
      const visibleChildren = item.children.filter(c => hasPerm(menuKeyToPerm[c.path] || ''));
      return visibleChildren.length > 0;
    }
    return true;
  });

  const toggleMenu = (label: string) => {
    setExpandedMenus((prev) =>
      prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label]
    );
  };

  const isActive = (path?: string) => location.pathname === path;
  const isChildActive = (children?: { path: string }[]) =>
    children?.some((c) => location.pathname === c.path);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-white transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-700">
          <div>
            <h1 className="text-lg font-bold">D METRAN</h1>
            <p className="text-xs text-gray-400">Trading ERP System</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {filteredMenu.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path) || isChildActive(item.children);

            if (item.children) {
              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggleMenu(item.label)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors',
                      active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-sidebar-hover'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </span>
                    <ChevronDown size={16} className={cn('transition-transform', expandedMenus.includes(item.label) && 'rotate-180')} />
                  </button>
                  {expandedMenus.includes(item.label) && (
                    <div className="ml-4 mt-1 space-y-1">
                      {item.children.map((child) => (
                        <button
                          key={child.path}
                          onClick={() => { navigate(child.path); setSidebarOpen(false); }}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                            isActive(child.path) ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-sidebar-hover'
                          )}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <button
                key={item.path}
                onClick={() => { navigate(item.path!); setSidebarOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-sidebar-hover'
                )}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-gray-700 p-4">
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="flex items-center gap-2 text-gray-400 hover:text-white text-sm w-full"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-600">
              <Menu size={22} />
            </button>
            <div className="relative hidden sm:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative text-gray-500 hover:text-gray-700">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">3</span>
            </button>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="hidden sm:block">
                <p className="font-medium">{user?.full_name}</p>
                <p className="text-xs text-gray-500">{user?.role_name}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
