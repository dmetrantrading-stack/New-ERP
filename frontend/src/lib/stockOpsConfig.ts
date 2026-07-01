export type StockOpsSectionKey = 'inventory' | 'movement' | 'production';

export type StockOpsTabKey =
  | 'inventory'
  | 'unit-conversions'
  | 'production'
  | 'bom'
  | 'counts'
  | 'transfers';

export type StockOpsTabDef = {
  id: StockOpsTabKey;
  label: string;
  section: StockOpsSectionKey;
  description: string;
  perm: string;
};

export const STOCK_OPS_SECTIONS: {
  key: StockOpsSectionKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'inventory',
    label: 'Stock & Master',
    description: 'On-hand quantities and unit-of-measure setup',
  },
  {
    key: 'movement',
    label: 'Movement & Counts',
    description: 'Transfers between locations and physical inventory counts',
  },
  {
    key: 'production',
    label: 'Production',
    description: 'Manufacturing orders and bill of materials',
  },
];

export const STOCK_OPS_TABS: StockOpsTabDef[] = [
  {
    id: 'inventory',
    label: 'Stock Levels',
    section: 'inventory',
    description: 'SKU quantities, costs, and low-stock alerts by location',
    perm: 'inventory.inventory.view',
  },
  {
    id: 'unit-conversions',
    label: 'Unit Conversions',
    section: 'inventory',
    description: 'BOX, CASE, PC and other UOM factors per product',
    perm: 'inventory.inventory.view',
  },
  {
    id: 'transfers',
    label: 'Stock Transfers',
    section: 'movement',
    description: 'Move stock between stores or warehouses',
    perm: 'inventory.stock-transfer.view',
  },
  {
    id: 'counts',
    label: 'Inventory Counts',
    section: 'movement',
    description: 'Physical count sessions and variance adjustments',
    perm: 'inventory.counts.view',
  },
  {
    id: 'production',
    label: 'Production Orders',
    section: 'production',
    description: 'Issue materials and receive finished goods',
    perm: 'inventory.production.view',
  },
  {
    id: 'bom',
    label: 'BOM / Recipes',
    section: 'production',
    description: 'Bill of materials and assembly recipes',
    perm: 'inventory.production.view',
  },
];

const TAB_IDS = new Set<string>(STOCK_OPS_TABS.map((t) => t.id));

export function parseStockOpsTab(value: string | null): StockOpsTabKey | null {
  if (value && TAB_IDS.has(value)) return value as StockOpsTabKey;
  return null;
}

export function sectionForTab(tab: StockOpsTabKey): StockOpsSectionKey {
  return STOCK_OPS_TABS.find((t) => t.id === tab)?.section ?? 'inventory';
}

export function tabsForSection(section: StockOpsSectionKey, hasPerm: (p: string) => boolean): StockOpsTabDef[] {
  return STOCK_OPS_TABS.filter((t) => t.section === section && hasPerm(t.perm));
}

export function sectionsForUser(hasPerm: (p: string) => boolean) {
  return STOCK_OPS_SECTIONS.filter((s) => tabsForSection(s.key, hasPerm).length > 0);
}

export function tabDef(tab: StockOpsTabKey): StockOpsTabDef | undefined {
  return STOCK_OPS_TABS.find((t) => t.id === tab);
}

export function filterStockOpsTabs(hasPerm: (p: string) => boolean): StockOpsTabDef[] {
  return STOCK_OPS_TABS.filter((t) => hasPerm(t.perm));
}

export const STOCK_OPS_ACCESS_PERMS = [...new Set(STOCK_OPS_TABS.map((t) => t.perm))];

export const LEGACY_STOCK_OPS_PATHS: Record<string, StockOpsTabKey> = {
  '/inventory': 'inventory',
  '/unit-conversions': 'unit-conversions',
  '/production': 'production',
  '/bom': 'bom',
  '/inventory-count': 'counts',
  '/stock-transfers': 'transfers',
};
