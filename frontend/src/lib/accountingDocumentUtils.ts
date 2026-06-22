import api from './api';

export const REF_TYPE_COLORS: Record<string, string> = {
  'Sales Invoice': 'bg-blue-100 text-blue-800 border-blue-200',
  'Goods Receipt': 'bg-amber-100 text-amber-800 border-amber-200',
  'Delivery Receipt': 'bg-purple-100 text-purple-800 border-purple-200',
  'Collection': 'bg-green-100 text-green-800 border-green-200',
  'Payment Voucher': 'bg-red-100 text-red-800 border-red-200',
  'POS Sale': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Cash In': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Cash Out': 'bg-orange-100 text-orange-800 border-orange-200',
  'Payroll': 'bg-pink-100 text-pink-800 border-pink-200',
  'Expense': 'bg-gray-100 text-gray-800 border-gray-200',
  'Petty Cash': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'AP Voucher': 'bg-rose-100 text-rose-800 border-rose-200',
  'Purchase Return': 'bg-orange-50 text-orange-800 border-orange-200',
  'Sales Return': 'bg-cyan-100 text-cyan-800 border-cyan-200',
};

export type SourceFieldDef = { key: string; label: string; format?: 'currency' | 'date'; summary?: boolean };

export const SOURCE_FIELDS: Record<string, SourceFieldDef[]> = {
  'Sales Invoice': [
    { key: 'invoice_number', label: 'Invoice #', summary: true },
    { key: 'invoice_date', label: 'Date', format: 'date', summary: true },
    { key: 'customer_name', label: 'Customer', summary: true },
    { key: 'payment_method', label: 'Payment' },
    { key: 'status', label: 'Status', summary: true },
    { key: 'vatable_sales', label: 'Net Sales', format: 'currency' },
    { key: 'vat_amount', label: 'Output VAT', format: 'currency' },
    { key: 'total', label: 'Total', format: 'currency', summary: true },
    { key: 'balance', label: 'Balance Due', format: 'currency' },
  ],
  'Goods Receipt': [
    { key: 'gr_number', label: 'GR #', summary: true },
    { key: 'received_date', label: 'Date', format: 'date', summary: true },
    { key: 'supplier_name', label: 'Supplier', summary: true },
    { key: 'status', label: 'Status', summary: true },
    { key: 'total_amount', label: 'Total', format: 'currency', summary: true },
  ],
  'Delivery Receipt': [
    { key: 'dr_number', label: 'DR #', summary: true },
    { key: 'delivery_date', label: 'Date', format: 'date', summary: true },
    { key: 'customer_name', label: 'Customer', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Collection': [
    { key: 'receipt_number', label: 'Receipt #', summary: true },
    { key: 'payment_date', label: 'Date', format: 'date', summary: true },
    { key: 'customer_name', label: 'Customer', summary: true },
    { key: 'amount', label: 'Amount', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Payment Voucher': [
    { key: 'voucher_number', label: 'Voucher #', summary: true },
    { key: 'payment_date', label: 'Date', format: 'date', summary: true },
    { key: 'supplier_name', label: 'Supplier', summary: true },
    { key: 'amount', label: 'Amount', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'AP Voucher': [
    { key: 'apv_number', label: 'APV #', summary: true },
    { key: 'apv_date', label: 'Date', format: 'date', summary: true },
    { key: 'supplier_name', label: 'Supplier', summary: true },
    { key: 'total_amount', label: 'Total', format: 'currency', summary: true },
    { key: 'balance', label: 'Balance', format: 'currency' },
    { key: 'status', label: 'Status', summary: true },
  ],
  'POS Sale': [
    { key: 'transaction_number', label: 'Transaction #', summary: true },
    { key: 'payment_method', label: 'Payment', summary: true },
    { key: 'net_total', label: 'Total', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Petty Cash': [
    { key: 'pcv_number', label: 'PCV #', summary: true },
    { key: 'voucher_date', label: 'Date', format: 'date', summary: true },
    { key: 'payee', label: 'Payee', summary: true },
    { key: 'category', label: 'Category' },
    { key: 'amount', label: 'Amount', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Expense': [
    { key: 'expense_number', label: 'Expense #', summary: true },
    { key: 'expense_date', label: 'Date', format: 'date', summary: true },
    { key: 'category_name', label: 'Category', summary: true },
    { key: 'amount', label: 'Amount', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Payroll': [
    { key: 'payroll_number', label: 'Payroll #', summary: true },
    { key: 'pay_period_end', label: 'Period End', format: 'date', summary: true },
    { key: 'last_name', label: 'Employee', summary: true },
    { key: 'gross_pay', label: 'Gross', format: 'currency' },
    { key: 'net_pay', label: 'Net Pay', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Purchase Return': [
    { key: 'pr_number', label: 'Return #', summary: true },
    { key: 'return_date', label: 'Date', format: 'date', summary: true },
    { key: 'supplier_name', label: 'Supplier', summary: true },
    { key: 'total', label: 'Total', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
  'Sales Return': [
    { key: 'return_number', label: 'Return #', summary: true },
    { key: 'return_date', label: 'Date', format: 'date', summary: true },
    { key: 'customer_name', label: 'Customer', summary: true },
    { key: 'total', label: 'Total', format: 'currency', summary: true },
    { key: 'status', label: 'Status', summary: true },
  ],
};

export const ITEM_COLUMN_LABELS: Record<string, string> = {
  description: 'Description',
  product_name: 'Product',
  quantity: 'Qty',
  unit_price: 'Unit Price',
  unit_cost: 'Unit Cost',
  total: 'Total',
  total_cost: 'Total',
};

export const ITEM_LOADERS: Record<string, (id: string) => Promise<{ items: any[]; columns: string[] }>> = {
  'Sales Invoice': async (id) => {
    const res = await api.get(`/sales/invoices/${id}`);
    const items = (res.data?.items || []).map((item: any) => ({
      ...item,
      description: item.description || item.product_name || '',
    }));
    return { items, columns: ['description', 'quantity', 'unit_price', 'total'] };
  },
  'Goods Receipt': async (id) => {
    const res = await api.get(`/purchases/receipts/${id}`);
    return { items: res.data?.items || [], columns: ['product_name', 'quantity', 'unit_cost', 'total_cost'] };
  },
  'POS Sale': async (id) => {
    const res = await api.get(`/pos/transactions/${id}`);
    return { items: res.data?.items || [], columns: ['product_name', 'quantity', 'unit_price', 'total'] };
  },
  'Delivery Receipt': async (id) => {
    const res = await api.get(`/delivery-notes/${id}`);
    return { items: res.data?.items || [], columns: ['description', 'quantity', 'unit_price', 'total'] };
  },
  'Sales Return': async (id) => {
    const res = await api.get(`/sales/returns/${id}`);
    return { items: res.data?.items || [], columns: ['description', 'quantity', 'unit_price', 'total'] };
  },
  'Purchase Return': async (id) => {
    const res = await api.get(`/purchases/returns/${id}`);
    return { items: res.data?.items || [], columns: ['product_name', 'quantity', 'unit_cost', 'total_cost'] };
  },
};

export function refTypeBadge(type: string) {
  return REF_TYPE_COLORS[type] || 'bg-gray-100 text-gray-700 border-gray-200';
}

export function getDocTitle(refType: string, doc: any): string {
  if (!doc) return refType;
  const keys = ['invoice_number', 'gr_number', 'dr_number', 'receipt_number', 'voucher_number', 'apv_number',
    'transaction_number', 'pcv_number', 'expense_number', 'payroll_number', 'pr_number', 'return_number', 'entry_number'];
  for (const k of keys) {
    if (doc[k]) return String(doc[k]);
  }
  return refType;
}

export function resolveFieldValue(doc: any, key: string) {
  if (key === 'last_name' && doc.last_name) return `${doc.last_name}, ${doc.first_name}`;
  if (key === 'total_amount' && doc.total_amount == null && doc.total != null) return doc.total;
  return doc[key];
}
