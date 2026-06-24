import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import {
  LayoutDashboard, Package, ShoppingCart, Users, UserPlus, FileSpreadsheet,
  Settings, LogOut, Menu, X, ChevronDown, Search,
  Warehouse, DollarSign, Receipt, Briefcase, ScrollText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import NotificationsPanel from '../NotificationsPanel';
import { HR_PAGE_ACCESS_PERMS } from '../../lib/hrPermissions';
import { STOCK_OPS_ACCESS_PERMS } from '../../lib/stockOpsUtils';

const PRIMARY = '#1E40AF';

interface MenuItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: { label: string; path: string }[];
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const menuSections: MenuSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Products', icon: Package, path: '/products' },
      { label: 'Stock & Ops', icon: Warehouse, path: '/stock-ops' },
    ],
  },
  {
    title: 'Purchasing',
    items: [
      {
        label: 'Purchases',
        icon: ShoppingCart,
        children: [
          { label: 'Purchase Requisitions', path: '/purchase-requisitions' },
          { label: 'Purchase Orders', path: '/purchases' },
          { label: 'Goods Receipts', path: '/goods-receipts' },
          { label: 'Purchase Returns', path: '/purchase-returns' },
          { label: 'Vendor Memos', path: '/purchase-memos' },
          { label: 'Accounts Payable', path: '/payables' },
        ],
      },
      { label: 'Suppliers', icon: UserPlus, path: '/suppliers' },
    ],
  },
  {
    title: 'Sales',
    items: [
      {
        label: 'Sales Module',
        icon: Receipt,
        children: [
          { label: 'POS', path: '/pos' },
          { label: 'Sales Quotations', path: '/sales-quotations' },
          { label: 'Sales Orders', path: '/sales-orders' },
          { label: 'Sales Invoices', path: '/sales' },
          { label: 'Sales Returns', path: '/sales-returns' },
          { label: 'Credit / Debit Memos', path: '/sales-memos' },
          { label: 'Delivery Receipts', path: '/delivery-notes' },
          { label: 'Collections & AR', path: '/collections' },
        ],
      },
      { label: 'Customers', icon: Users, path: '/customers' },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        label: 'Finance',
        icon: DollarSign,
        children: [
          { label: 'Accounting', path: '/accounting' },
          { label: 'Bank & Cash', path: '/bank-cash' },
          { label: 'Expenses', path: '/expenses' },
          { label: 'Petty Cash', path: '/petty-cash' },
          { label: 'Loans Payable', path: '/loans-payable' },
        ],
      },
    ],
  },
  {
    title: 'People & Reports',
    items: [
      { label: 'HR & Payroll', icon: Briefcase, path: '/hr' },
      { label: 'Reports', icon: FileSpreadsheet, path: '/reports' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Users', icon: Users, path: '/users' },
      { label: 'Settings', icon: Settings, path: '/settings' },
      { label: 'Audit Trail', icon: ScrollText, path: '/audit' },
    ],
  },
];

const menuKeyToPerm: Record<string, string> = {
  '/': 'dashboard.view',
  '/products': 'inventory.inventory.view',
  '/stock-ops': 'inventory.inventory.view',
  '/purchases': 'purchases.purchase-order.view',
  '/purchase-requisitions': 'purchases.purchase-order.view',
  '/goods-receipts': 'purchases.receiving-report.view',
  '/purchase-returns': 'purchases.receiving-report.view',
  '/payables': 'purchases.apv.view',
  '/pos': 'pos.write',
  '/sales': 'sales.sales-invoice.view',
  '/sales-returns': 'sales.sales-invoice.view',
  '/sales-orders': 'sales.sales-order.view',
  '/sales-quotations': 'sales.sales-quotation.view',
  '/delivery-notes': 'sales.delivery-receipt.view',
  '/collections': 'sales.collections.view',
  '/customers': 'sales.customers.view',
  '/suppliers': 'purchases.suppliers.view',
  '/accounting': 'finance.accounting.view',
  '/bank-cash': 'finance.bank-cash.view',
  '/expenses': 'finance.expenses.view',
  '/petty-cash': 'finance.petty-cash.view',
  '/loans-payable': 'finance.loans.view',
  '/hr': 'hr.employees.view',
  '/reports': 'reports.view',
  '/users': 'system.users.view',
  '/permissions': 'system.users.edit',
  '/audit': 'system.audit.view',
  '/settings': 'system.settings.view',
};

function filterSections(
  sections: MenuSection[],
  canAccessPath: (path: string) => boolean,
): MenuSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => {
          if (item.path) return canAccessPath(item.path) ? item : null;
          if (item.children) {
            const children = item.children.filter((c) => canAccessPath(c.path));
            return children.length > 0 ? { ...item, children } : null;
          }
          return null;
        })
        .filter(Boolean) as MenuItem[],
    }))
    .filter((section) => section.items.length > 0);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const { user, logout, hasPerm, hasAnyPerm } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const canAccessPath = (path: string) => {
    if (path === '/payables') return hasAnyPerm(['purchases.apv.view', 'purchases.payment-voucher.view']);
    if (path === '/purchase-memos') return hasAnyPerm(['purchases.apv.view', 'purchases.apv.create']);
    if (path === '/sales-memos') return hasPerm('sales.sales-invoice.view');
    if (path === '/hr') return hasAnyPerm([...HR_PAGE_ACCESS_PERMS]);
    if (path === '/pos') return hasAnyPerm(['pos.view', 'pos.write']);
    if (path === '/settings') return hasAnyPerm(['system.settings.view', 'system.users.view', 'system.users.edit']);
    if (path === '/reports') return hasAnyPerm(['reports.view', 'reports.daily-payables', 'reports.daily-receivables']);
    if (path === '/stock-ops') return hasAnyPerm([...STOCK_OPS_ACCESS_PERMS]);
    return hasPerm(menuKeyToPerm[path] || '');
  };

  const filteredSections = useMemo(
    () => filterSections(menuSections, canAccessPath),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.permissions],
  );

  const isActive = (path?: string) => {
    if (path === '/settings') {
      return location.pathname === '/settings' || location.pathname.startsWith('/settings/');
    }
    if (path === '/users') {
      return location.pathname === '/users' || location.pathname.startsWith('/settings/permissions/');
    }
    if (path === '/stock-ops') {
      return location.pathname === '/stock-ops'
        || ['/inventory', '/unit-conversions', '/production', '/bom', '/inventory-count', '/stock-transfers'].includes(location.pathname);
    }
    if (path === '/products') {
      return location.pathname === '/products' || location.pathname === '/categories' || location.pathname === '/brands';
    }
    return path === location.pathname;
  };
  const isChildActive = (children?: { path: string }[]) =>
    children?.some((c) => {
      if (c.path === '/settings') {
        return location.pathname === '/settings' || location.pathname.startsWith('/settings/');
      }
      return location.pathname === c.path;
    });

  useEffect(() => {
    const activeParents: string[] = [];
    for (const section of filteredSections) {
      for (const item of section.items) {
        if (item.children?.some((c) => {
          if (c.path === '/settings') return location.pathname === '/settings' || location.pathname.startsWith('/settings/');
          return c.path === location.pathname;
        })) {
          activeParents.push(item.label);
        }
      }
    }
    if (activeParents.length > 0) {
      setExpandedMenus((prev) => [...new Set([...prev, ...activeParents])]);
    }
  }, [location.pathname, filteredSections]);

  const toggleMenu = (label: string) => {
    setExpandedMenus((prev) =>
      prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label],
    );
  };

  const navItemClass = (active: boolean, nested = false) =>
    cn(
      'w-full flex items-center gap-2 rounded-md text-xs font-medium transition-colors',
      nested ? 'px-2 py-1.5' : 'px-2.5 py-2',
      active
        ? 'bg-blue-50 text-blue-900 border-l-2 border-blue-700 -ml-px pl-[calc(0.625rem-1px)]'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border-l-2 border-transparent',
    );

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon;
    const active = isActive(item.path) || isChildActive(item.children);
    const expanded = expandedMenus.includes(item.label);

    if (item.children) {
      return (
        <div key={item.label}>
          <button
            type="button"
            onClick={() => toggleMenu(item.label)}
            className={navItemClass(active)}
          >
            <Icon size={15} className={active ? 'text-blue-700' : 'text-gray-400'} />
            <span className="flex-1 text-left truncate">{item.label}</span>
            <ChevronDown
              size={14}
              className={cn('text-gray-400 transition-transform flex-shrink-0', expanded && 'rotate-180')}
            />
          </button>
          {expanded && (
            <div className="ml-3 mt-0.5 pl-2 border-l border-blue-100 space-y-0.5 mb-1">
              {item.children.map((child) => (
                <button
                  key={child.path}
                  type="button"
                  onClick={() => { navigate(child.path); setSidebarOpen(false); }}
                  className={navItemClass(isActive(child.path), true)}
                >
                  <span className="truncate">{child.label}</span>
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
        type="button"
        onClick={() => { navigate(item.path!); setSidebarOpen(false); }}
        className={navItemClass(active)}
      >
        <Icon size={15} className={active ? 'text-blue-700' : 'text-gray-400'} />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-white border-r border-gray-200 shadow-sm transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand header */}
        <div
          className="flex-shrink-0 h-12 px-3 flex items-center justify-between"
          style={{ backgroundColor: PRIMARY }}
        >
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white tracking-wide truncate">D METRAN</h1>
            <p className="text-[10px] text-white/70 leading-none">Trading ERP</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-white/70 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Module nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {filteredSections.map((section) => (
            <div key={section.title} className="mb-3 last:mb-0">
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map(renderItem)}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 border-t border-gray-200 p-2 bg-gray-50">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
              style={{ backgroundColor: PRIMARY }}
            >
              {user?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-800 truncate">{user?.full_name}</p>
              <p className="text-[10px] text-gray-500 truncate">{user?.role_name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-gray-600 hover:bg-white hover:text-red-700 transition-colors"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-3 lg:px-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-gray-600 p-1 rounded hover:bg-gray-100"
            >
              <Menu size={20} />
            </button>
            <div className="relative hidden sm:block">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search modules..."
                className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-xs w-52 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsPanel />
            <div className="hidden md:flex items-center gap-2 text-xs text-gray-600">
              <span className="font-medium text-gray-800">{user?.full_name}</span>
              <span className="text-gray-300">|</span>
              <span>{user?.role_name}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
