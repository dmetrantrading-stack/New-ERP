import { PRIMARY, FINANCE_FONT, financeTabClass } from './financeUtils';

export { PRIMARY, FINANCE_FONT, financeTabClass };

export const PRODUCTS_TABS = [
  { key: 'products', label: 'Catalog', perm: 'inventory.inventory.view', description: 'Product master data, pricing, barcodes, and units of measure' },
  { key: 'categories', label: 'Categories', perm: 'inventory.inventory.view', description: 'Category GL accounts for sales and COGS posting' },
  { key: 'brands', label: 'Brands', perm: 'inventory.inventory.view', description: 'Brand master for product classification' },
] as const;

export type ProductsTabKey = (typeof PRODUCTS_TABS)[number]['key'];

export function parseProductsTab(value: string | null): ProductsTabKey | null {
  if (value && PRODUCTS_TABS.some((t) => t.key === value)) return value as ProductsTabKey;
  return null;
}

export function filterProductsTabs(hasPerm: (p: string) => boolean) {
  return PRODUCTS_TABS.filter((t) => hasPerm(t.perm));
}

export function validateProductForm(form: {
  name?: string;
  cost?: number | string;
  retail_price?: number | string;
  wholesale_price?: number | string;
  distributor_price?: number | string;
  reorder_level?: number | string;
  chilled_price?: number | string;
  has_chilled_variant?: boolean;
}): string | null {
  if (!String(form.name || '').trim()) return 'Product name is required';

  const numericChecks: [string, number | string | undefined][] = [
    ['Cost', form.cost],
    ['Retail price', form.retail_price],
    ['Wholesale price', form.wholesale_price],
    ['Distributor price', form.distributor_price],
    ['Reorder level', form.reorder_level],
    ['Chilled price', form.chilled_price],
  ];
  for (const [label, value] of numericChecks) {
    const n = parseFloat(String(value ?? ''));
    if (value !== '' && value !== undefined && !Number.isNaN(n) && n < 0) {
      return `${label} cannot be negative`;
    }
  }

  if (form.has_chilled_variant && (parseFloat(String(form.chilled_price ?? '')) || 0) <= 0) {
    return 'Chilled price is required when chilled variant is enabled';
  }

  return null;
}

/** Normalize product fields for save/compare (handles string vs number from forms/API). */
export function normalizeProductForCompare(p: Record<string, unknown>) {
  const str = (v: unknown) => String(v ?? '').trim();
  const id = (v: unknown) => (v == null || v === '' ? null : String(v));
  const num = (v: unknown) => parseFloat(String(v ?? '')) || 0;
  const bool = (v: unknown) => Boolean(v);

  return {
    name: str(p.name),
    barcode: str(p.barcode),
    category_id: id(p.category_id),
    brand_id: id(p.brand_id),
    unit_of_measure: str(p.unit_of_measure) || 'pc',
    description: str(p.description),
    cost: num(p.cost),
    retail_price: num(p.retail_price),
    wholesale_price: num(p.wholesale_price),
    distributor_price: num(p.distributor_price),
    reorder_level: num(p.reorder_level),
    tax_type: str(p.tax_type) || 'VAT',
    price_type: str(p.price_type) || 'VAT Inclusive',
    has_chilled_variant: bool(p.has_chilled_variant),
    chilled_price: num(p.chilled_price),
  };
}

/** True when payload differs from original only in reorder_level. */
export function isOnlyReorderLevelChanged(original: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  const a = normalizeProductForCompare(original);
  const b = normalizeProductForCompare(payload);
  if (a.reorder_level === b.reorder_level) return false;

  const { reorder_level: _ra, ...restA } = a;
  const { reorder_level: _rb, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}
