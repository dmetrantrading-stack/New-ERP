export type PriceMode = 'Retail' | 'Wholesale' | 'Distributor';

const B2B_TYPES = new Set(['LGU', 'Corporate', 'Mining', 'Resort']);

export function resolveCustomerPriceMode(customer?: {
  customer_type?: string;
  default_price_mode?: string;
} | null): PriceMode {
  const explicit = customer?.default_price_mode;
  if (explicit === 'Retail' || explicit === 'Wholesale' || explicit === 'Distributor') {
    return explicit;
  }
  const segment = customer?.customer_type || 'Retail';
  if (segment === 'Wholesale') return 'Wholesale';
  if (segment === 'Distributor') return 'Distributor';
  if (B2B_TYPES.has(segment)) return 'Wholesale';
  return 'Retail';
}
