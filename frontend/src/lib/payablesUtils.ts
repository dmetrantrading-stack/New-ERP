export const PRIMARY = '#1E40AF';

export const APV_STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Posted: 'bg-blue-100 text-blue-700',
  'Partially Paid': 'bg-yellow-100 text-yellow-700',
  'Fully Paid': 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
  Paid: 'bg-green-100 text-green-700',
  Partial: 'bg-yellow-100 text-yellow-700',
  Void: 'bg-gray-200 text-gray-500',
};

export function statusBadgeClass(s: string) {
  return 'px-2 py-0.5 text-xs rounded-full ' + (APV_STATUS_COLORS[s] || 'bg-gray-100 text-gray-700');
}

export const blankApvItem = () => ({
  product_id: '',
  description: '',
  qty: 1,
  uom: 'pc',
  unit_cost: 0,
  discount_amount: 0,
  tax_type: 'VAT',
});

export const AGING_LABELS: Record<string, string> = {
  current: 'Current',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: 'Over 90 days',
  no_due: 'No due date',
};
