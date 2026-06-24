import { HR_PAGE_ACCESS_PERMS } from './hrPermissions';
import { STOCK_OPS_ACCESS_PERMS } from './stockOpsUtils';
import { checkPermission, checkAnyPermission } from './permissions';
import type { User } from '../types';

type LandingRoute = { path: string; perm?: string; permAny?: string[] };

/** First accessible route after login (sidebar order). */
const LANDING_ROUTES: LandingRoute[] = [
  { path: '/', perm: 'dashboard.view' },
  { path: '/pos', permAny: ['pos.view', 'pos.write'] },
  { path: '/sales-quotations', perm: 'sales.sales-quotation.view' },
  { path: '/sales-orders', perm: 'sales.sales-order.view' },
  { path: '/sales', perm: 'sales.sales-invoice.view' },
  { path: '/collections', perm: 'sales.collections.view' },
  { path: '/customers', perm: 'sales.customers.view' },
  { path: '/purchase-requisitions', perm: 'purchases.purchase-order.view' },
  { path: '/purchases', perm: 'purchases.purchase-order.view' },
  { path: '/goods-receipts', perm: 'purchases.receiving-report.view' },
  { path: '/payables', permAny: ['purchases.apv.view', 'purchases.payment-voucher.view'] },
  { path: '/suppliers', perm: 'purchases.suppliers.view' },
  { path: '/products', perm: 'inventory.inventory.view' },
  { path: '/stock-ops', permAny: [...STOCK_OPS_ACCESS_PERMS] },
  { path: '/accounting', perm: 'finance.accounting.view' },
  { path: '/bank-cash', perm: 'finance.bank-cash.view' },
  { path: '/expenses', perm: 'finance.expenses.view' },
  { path: '/petty-cash', perm: 'finance.petty-cash.view' },
  { path: '/loans-payable', perm: 'finance.loans.view' },
  { path: '/hr', permAny: [...HR_PAGE_ACCESS_PERMS] },
  { path: '/reports', permAny: ['reports.view', 'reports.daily-payables', 'reports.daily-receivables'] },
  { path: '/users', perm: 'system.users.view' },
  { path: '/settings', permAny: ['system.settings.view', 'system.users.view', 'system.users.edit'] },
  { path: '/audit', perm: 'system.audit.view' },
];

export function getDefaultLandingPath(
  hasPerm: (perm: string) => boolean,
  hasAnyPerm: (perms: string[]) => boolean,
): string {
  for (const route of LANDING_ROUTES) {
    if (route.permAny && hasAnyPerm(route.permAny)) return route.path;
    if (route.perm && hasPerm(route.perm)) return route.path;
  }
  return '/';
}

export function getLandingPathForUser(user: User | null | undefined): string {
  if (!user) return '/login';
  const isAdmin = user.role_name === 'Admin' || user.role_name === 'Owner';
  const hasPerm = (perm: string) => isAdmin || checkPermission(user.permissions, perm);
  const hasAnyPerm = (perms: string[]) => isAdmin || checkAnyPermission(user.permissions, perms);
  return getDefaultLandingPath(hasPerm, hasAnyPerm);
}
