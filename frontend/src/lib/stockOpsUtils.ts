import { PRIMARY, FINANCE_FONT, financeTabClass } from './financeUtils';

export { PRIMARY, FINANCE_FONT, financeTabClass };

export const STOCK_OPS_TABS = [
  { key: 'inventory', label: 'Stock Levels', perm: 'inventory.inventory.view' },
  { key: 'unit-conversions', label: 'Unit Conversions', perm: 'inventory.inventory.view' },
  { key: 'production', label: 'Production', perm: 'inventory.production.view' },
  { key: 'bom', label: 'BOM / Recipes', perm: 'inventory.production.view' },
  { key: 'counts', label: 'Inventory Counts', perm: 'inventory.counts.view' },
  { key: 'transfers', label: 'Stock Transfers', perm: 'inventory.stock-transfer.view' },
] as const;

export type StockOpsTabKey = (typeof STOCK_OPS_TABS)[number]['key'];

export const STOCK_OPS_ACCESS_PERMS = [...new Set(STOCK_OPS_TABS.map((t) => t.perm))];

export const LEGACY_STOCK_OPS_PATHS: Record<string, StockOpsTabKey> = {
  '/inventory': 'inventory',
  '/unit-conversions': 'unit-conversions',
  '/production': 'production',
  '/bom': 'bom',
  '/inventory-count': 'counts',
  '/stock-transfers': 'transfers',
};

export function parseStockOpsTab(value: string | null): StockOpsTabKey | null {
  if (value && STOCK_OPS_TABS.some((t) => t.key === value)) return value as StockOpsTabKey;
  return null;
}

export function filterStockOpsTabs(hasPerm: (p: string) => boolean) {
  return STOCK_OPS_TABS.filter((t) => hasPerm(t.perm));
}
