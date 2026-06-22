import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useAuth } from '../../store/auth';
import {
  PRIMARY, FINANCE_FONT, financeTabClass,
  REPORT_SECTIONS, ReportSectionKey, ReportDef,
  canAccessReportSection, filterReportsForUser, reportEndpoint,
  exportDailyPayables, exportDailyReceivables,
  exportPurchaseRegister, exportSalesInvoiceRegister, exportArAging, exportApAging,
  exportConsolidatedSales, exportDeliveryFulfillment, exportDispatchList, exportReorderSuggestions,
  exportCategoryMargin,
  exportWithholdingTax, exportSlspSales, exportSlspPurchases,
  exportBir2550q, exportBranchSummary,
  exportStockMovement, exportSlowMoving, exportCountVariance,
  AGING_BUCKET_LABELS,
} from '../../lib/reportsUtils';
import {
  FileSpreadsheet, BarChart3, TrendingUp, AlertTriangle, Clock,
  ArrowDownCircle, ArrowUpCircle, Download, Printer, RefreshCw,
  ShoppingCart, Wallet, Package,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { printDocument } from '../../lib/printDocument';

const SECTION_ICONS: Record<ReportSectionKey, React.ElementType> = {
  sales: ShoppingCart,
  finance: Wallet,
  inventory: Package,
};

const REPORT_ICONS: Record<string, React.ElementType> = {
  'daily-sales': BarChart3,
  'sales-by-item': TrendingUp,
  'sales-by-cashier': TrendingUp,
  'sales-by-customer': TrendingUp,
  'sales-invoice-register': FileSpreadsheet,
  'consolidated-sales': TrendingUp,
  'category-margin': BarChart3,
  'delivery-fulfillment': Package,
  'dispatch-list': Package,
  'daily-payables': ArrowDownCircle,
  'daily-receivables': ArrowUpCircle,
  'purchase-register': ShoppingCart,
  'ar-aging': ArrowUpCircle,
  'ap-aging': ArrowDownCircle,
  vat: BarChart3,
  'bir-2550q': FileSpreadsheet,
  'branch-summary': Package,
  'withholding-tax': Wallet,
  'slsp-sales': FileSpreadsheet,
  'slsp-purchases': FileSpreadsheet,
  'inventory-valuation': BarChart3,
  'stock-movement': TrendingUp,
  'slow-moving': Clock,
  'count-variance': AlertTriangle,
  'low-stock': AlertTriangle,
  'reorder-suggestions': AlertTriangle,
  expiry: Clock,
};

const FULFILLMENT_STAGE_TONES: Record<string, string> = {
  'Pending Delivery': 'bg-yellow-100 text-yellow-800',
  'Partially Delivered': 'bg-orange-100 text-orange-800',
  'Fully Delivered': 'bg-blue-100 text-blue-800',
  Invoiced: 'bg-green-100 text-green-800',
  Closed: 'bg-gray-100 text-gray-700',
};

const AGING_BUCKET_ORDER = ['current', '1_30', '31_60', '61_90', 'over_90', 'no_due'] as const;

function AgingBucketCards({ buckets }: { buckets: Record<string, number> | undefined }) {
  const tones: Record<string, string> = {
    current: 'green',
    '1_30': 'blue',
    '31_60': 'orange',
    '61_90': 'orange',
    over_90: 'red',
    no_due: 'gray',
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {AGING_BUCKET_ORDER.map((key) => (
        <SummaryCard
          key={key}
          label={AGING_BUCKET_LABELS[key] || key}
          value={formatCurrency(buckets?.[key] || 0)}
          tone={tones[key] || 'gray'}
        />
      ))}
    </div>
  );
}

function KpiPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs whitespace-nowrap">
      <span className="text-white/70">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, tone = 'gray' }: { label: string; value: string; tone?: string }) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-50 border-gray-200 text-gray-800',
    blue: 'bg-blue-50 border-blue-100 text-blue-800',
    green: 'bg-green-50 border-green-100 text-green-800',
    red: 'bg-red-50 border-red-100 text-red-800',
    orange: 'bg-orange-50 border-orange-100 text-orange-800',
    purple: 'bg-purple-50 border-purple-100 text-purple-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone] || tones.gray}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

function ReportTable({ children, empty }: { children: React.ReactNode; empty?: boolean }) {
  if (empty) {
    return <div className="text-center py-16 text-sm text-gray-400">No records for the selected period</div>;
  }
  return (
    <div className="overflow-auto max-h-[calc(100vh-18rem)]">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide bg-gray-50 sticky top-0 ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

function Td({ children, align, className = '' }: { children: React.ReactNode; align?: 'right'; className?: string }) {
  return (
    <td className={`px-4 py-2 border-t border-gray-100 ${align === 'right' ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  );
}

export default function ReportsPage() {
  const { hasPerm, hasAnyPerm } = useAuth();
  const today = new Date().toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState({ from: today, to: today });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const sections = useMemo(
    () => REPORT_SECTIONS.filter((s) => canAccessReportSection(hasAnyPerm, s.key)),
    [hasAnyPerm],
  );

  const allAccessible = useMemo(() => filterReportsForUser(hasPerm), [hasPerm]);

  const [activeSection, setActiveSection] = useState<ReportSectionKey>('sales');
  const [activeReport, setActiveReport] = useState('');

  const sectionReports = useMemo(
    () => filterReportsForUser(hasPerm, activeSection),
    [hasPerm, activeSection],
  );

  const activeDef = useMemo(
    () => allAccessible.find((r) => r.id === activeReport),
    [allAccessible, activeReport],
  );

  useEffect(() => {
    if (sections.length > 0 && !sections.some((s) => s.key === activeSection)) {
      setActiveSection(sections[0].key);
    }
  }, [sections, activeSection]);

  useEffect(() => {
    if (sectionReports.length > 0 && !sectionReports.some((r) => r.id === activeReport)) {
      setActiveReport(sectionReports[0].id);
    }
  }, [sectionReports, activeReport]);

  const loadReport = useCallback(() => {
    if (!activeReport) return;
    setLoading(true);
    setData(null);
    const endpoint = reportEndpoint(activeReport, dateRange.from, dateRange.to);
    if (!endpoint) {
      setLoading(false);
      return;
    }
    api.get(endpoint)
      .then((res) => setData(res.data))
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [activeReport, dateRange]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExport = () => {
    if (!data) return;
    if (activeReport === 'daily-payables') {
      exportDailyPayables(data, dateRange.from);
      toast.success('Downloaded');
    } else if (activeReport === 'daily-receivables') {
      exportDailyReceivables(data, dateRange.from);
      toast.success('Downloaded');
    } else if (activeReport === 'purchase-register') {
      exportPurchaseRegister(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'sales-invoice-register') {
      exportSalesInvoiceRegister(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'ar-aging') {
      exportArAging(data);
      toast.success('Downloaded');
    } else if (activeReport === 'ap-aging') {
      exportApAging(data);
      toast.success('Downloaded');
    } else if (activeReport === 'consolidated-sales') {
      exportConsolidatedSales(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'category-margin') {
      exportCategoryMargin(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'delivery-fulfillment') {
      exportDeliveryFulfillment(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'dispatch-list') {
      exportDispatchList(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'reorder-suggestions') {
      exportReorderSuggestions(data);
      toast.success('Downloaded');
    } else if (activeReport === 'bir-2550q') {
      exportBir2550q(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'branch-summary') {
      exportBranchSummary(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'withholding-tax') {
      exportWithholdingTax(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'slsp-sales') {
      exportSlspSales(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'slsp-purchases') {
      exportSlspPurchases(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'stock-movement') {
      exportStockMovement(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    } else if (activeReport === 'slow-moving') {
      exportSlowMoving(data);
      toast.success('Downloaded');
    } else if (activeReport === 'count-variance') {
      exportCountVariance(data, dateRange.from, dateRange.to);
      toast.success('Downloaded');
    }
  };

  const hasExportRows = useMemo(() => {
    if (!data) return false;
    if (Array.isArray(data?.rows) && data.rows.length > 0) return true;
    if (Array.isArray(data?.lines) && data.lines.length > 0) return true;
    if (Array.isArray(data?.daily) && data.daily.length > 0) return true;
    if (Array.isArray(data?.invoice_rows) && data.invoice_rows.length > 0) return true;
    if (Array.isArray(data?.collection_rows) && data.collection_rows.length > 0) return true;
    if (Array.isArray(data) && data.length > 0) return true;
    return false;
  }, [data]);

  const headerKpis = useMemo(() => {
    if (!data || loading) return [];
    switch (activeReport) {
      case 'daily-sales':
        return [
          { label: 'Sales', value: formatCurrency(data?.summary?.total_sales || 0) },
          { label: 'Txns', value: String(data?.summary?.transaction_count || 0) },
          { label: 'GP', value: formatCurrency(data?.summary?.gross_profit || 0) },
        ];
      case 'daily-payables':
        return [
          { label: 'Cash Out', value: formatCurrency(data?.summary?.cash_total || 0) },
          { label: 'Checks', value: formatCurrency(data?.summary?.check_total || 0) },
          { label: 'Total', value: formatCurrency(data?.summary?.total || 0) },
        ];
      case 'daily-receivables':
        return [
          { label: 'Cash In', value: formatCurrency(data?.summary?.cash_total || 0) },
          { label: 'Checks', value: formatCurrency(data?.summary?.check_total || 0) },
          { label: 'Total', value: formatCurrency(data?.summary?.total || 0) },
        ];
      case 'vat':
        return [
          { label: 'Output VAT', value: formatCurrency(data?.output_vat || 0) },
          { label: 'Input VAT', value: formatCurrency(data?.input_vat || 0) },
          { label: 'Payable', value: formatCurrency(data?.vat_payable || 0) },
        ];
      case 'bir-2550q':
        return [
          { label: 'Output VAT', value: formatCurrency(data?.summary?.output_vat || 0) },
          { label: 'Input VAT', value: formatCurrency(data?.summary?.input_vat || 0) },
          { label: 'Variance', value: formatCurrency(data?.summary?.variance || 0) },
        ];
      case 'branch-summary':
        return [
          { label: 'Locations', value: String(data?.summary?.location_count || 0) },
          { label: 'Inventory', value: formatCurrency(data?.summary?.total_inventory_value || 0) },
          { label: 'Credit Sales', value: formatCurrency(data?.summary?.total_credit_sales || 0) },
        ];
      case 'purchase-register':
        return [
          { label: 'POs', value: String(data?.summary?.order_count || 0) },
          { label: 'Total', value: formatCurrency(data?.summary?.total || 0) },
          { label: 'VAT', value: formatCurrency(data?.summary?.vat_amount || 0) },
        ];
      case 'sales-invoice-register':
        return [
          { label: 'Invoices', value: String(data?.summary?.invoice_count || 0) },
          { label: 'Total', value: formatCurrency(data?.summary?.total || 0) },
          { label: 'Balance', value: formatCurrency(data?.summary?.balance || 0) },
        ];
      case 'consolidated-sales':
        return [
          { label: 'Total Sales', value: formatCurrency(data?.summary?.total_sales || 0) },
          { label: 'GP', value: formatCurrency(data?.summary?.gross_profit || 0) },
          { label: 'Margin', value: `${data?.summary?.margin_pct || 0}%` },
        ];
      case 'delivery-fulfillment':
        return [
          { label: 'Orders', value: String(data?.summary?.order_count || 0) },
          { label: 'Pending Qty', value: String(data?.summary?.pending_qty || 0) },
          { label: 'Invoiced', value: formatCurrency(data?.summary?.total_invoiced || 0) },
        ];
      case 'dispatch-list':
        return [
          { label: 'DRs', value: String(data?.summary?.count || 0) },
        ];
      case 'reorder-suggestions':
        return [
          { label: 'Products', value: String(data?.summary?.product_count || 0) },
          { label: 'Suppliers', value: String(data?.summary?.supplier_count || 0) },
        ];
      case 'withholding-tax':
        return [
          { label: 'Inv EWT', value: formatCurrency(data?.summary?.invoice_ewt || 0) },
          { label: 'Coll EWT', value: formatCurrency(data?.summary?.collected_ewt || 0) },
        ];
      case 'slsp-sales':
        return [
          { label: 'Rows', value: String(data?.summary?.row_count || 0) },
          { label: 'Output VAT', value: formatCurrency(data?.summary?.output_vat || 0) },
        ];
      case 'slsp-purchases':
        return [
          { label: 'Rows', value: String(data?.summary?.row_count || 0) },
          { label: 'Input VAT', value: formatCurrency(data?.summary?.input_vat || 0) },
        ];
      case 'stock-movement':
        return [
          { label: 'Movements', value: String(data?.summary?.movement_count || 0) },
          { label: 'Net Qty', value: String(data?.summary?.net_movement || 0) },
        ];
      case 'slow-moving':
        return [
          { label: 'Items', value: String(data?.summary?.item_count || 0) },
          { label: 'Value', value: formatCurrency(data?.summary?.total_value || 0) },
        ];
      case 'count-variance':
        return [
          { label: 'Counts', value: String(data?.summary?.count_sessions || 0) },
          { label: 'Net Var', value: formatCurrency(data?.summary?.net_variance_value || 0) },
        ];
      case 'ar-aging':
      case 'ap-aging':
        return [
          { label: 'Open', value: String(data?.count || 0) },
          { label: 'Outstanding', value: formatCurrency(data?.total_outstanding || 0) },
        ];
      case 'low-stock':
        return [{ label: 'Items', value: String(Array.isArray(data) ? data.length : 0) }];
      case 'expiry':
        return [{ label: 'Batches', value: String(Array.isArray(data) ? data.length : 0) }];
      default:
        if (Array.isArray(data)) {
          return [{ label: 'Rows', value: String(data.length) }];
        }
        return [];
    }
  }, [activeReport, data, loading]);

  const renderContent = () => {
    if (loading) {
      return <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading report...</div>;
    }

    switch (activeReport) {
      case 'daily-sales':
        return (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="Transactions" value={String(data?.summary?.transaction_count || 0)} tone="blue" />
              <SummaryCard label="Total Sales" value={formatCurrency(data?.summary?.total_sales || 0)} tone="green" />
              <SummaryCard label="Total Cost" value={formatCurrency(data?.summary?.total_cost || 0)} tone="red" />
              <SummaryCard label="Gross Profit" value={formatCurrency(data?.summary?.gross_profit || 0)} tone="green" />
              <SummaryCard label="Margin" value={`${data?.summary?.margin_pct || 0}%`} tone="purple" />
            </div>
            <ReportTable empty={!data?.transactions?.length}>
              <thead><tr><Th>Time</Th><Th>Transaction #</Th><Th>Cashier</Th><Th>Items</Th><Th align="right">Total</Th></tr></thead>
              <tbody>
                {data?.transactions?.map((t: any) => (
                  <tr key={t.id} className="hover:bg-blue-50/40">
                    <Td>{new Date(t.created_at).toLocaleTimeString('en-PH')}</Td>
                    <Td><span className="font-mono text-xs">{t.transaction_number}</span></Td>
                    <Td>{t.cashier_name}</Td>
                    <Td>{t.item_count}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(t.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'daily-payables':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">Posted supplier payments (Cash & Check) · Payment date {formatDate(data?.date || dateRange.from)}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Transactions" value={String(data?.summary?.transaction_count || 0)} />
              <SummaryCard label="Cash Out" value={formatCurrency(data?.summary?.cash_total || 0)} tone="red" />
              <SummaryCard label="Checks Issued" value={formatCurrency(data?.summary?.check_total || 0)} tone="orange" />
              <SummaryCard label="Total Disbursements" value={formatCurrency(data?.summary?.total || 0)} tone="red" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>PV #</Th><Th>Supplier</Th><Th>Method</Th><Th>Reference</Th>
                  <Th>Check Bank</Th><Th>Check Date</Th><Th>APV #</Th><Th>Prepared By</Th><Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-red-50/30">
                    <Td><span className="font-mono text-xs">{r.voucher_number}</span></Td>
                    <Td>{r.supplier_name}</Td>
                    <Td>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${r.payment_method === 'Cash' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {r.payment_method}
                      </span>
                    </Td>
                    <Td className="text-xs">{r.reference_number || '—'}</Td>
                    <Td className="text-xs">{r.check_bank || '—'}</Td>
                    <Td className="text-xs">{r.check_date ? formatDate(r.check_date) : '—'}</Td>
                    <Td className="font-mono text-xs">{r.apv_number || '—'}</Td>
                    <Td className="text-xs">{r.created_by_name || '—'}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'daily-receivables':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">Posted customer collections (Cash & Check) · Payment date {formatDate(data?.date || dateRange.from)}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Transactions" value={String(data?.summary?.transaction_count || 0)} />
              <SummaryCard label="Cash Received" value={formatCurrency(data?.summary?.cash_total || 0)} tone="green" />
              <SummaryCard label="Checks Received" value={formatCurrency(data?.summary?.check_total || 0)} tone="blue" />
              <SummaryCard label="Total Collections" value={formatCurrency(data?.summary?.total || 0)} tone="green" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>CR #</Th><Th>Customer</Th><Th>Method</Th><Th>Reference</Th>
                  <Th>Check Bank</Th><Th>Check Date</Th><Th>Prepared By</Th><Th align="right">Amount Received</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-green-50/30">
                    <Td><span className="font-mono text-xs">{r.receipt_number}</span></Td>
                    <Td>{r.customer_name || '—'}</Td>
                    <Td>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${r.payment_method === 'Cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {r.payment_method}
                      </span>
                    </Td>
                    <Td className="text-xs">{r.reference_number || '—'}</Td>
                    <Td className="text-xs">{r.check_bank || '—'}</Td>
                    <Td className="text-xs">{r.check_date ? formatDate(r.check_date) : '—'}</Td>
                    <Td className="text-xs">{r.created_by_name || '—'}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.amount_received)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'sales-by-item':
        return (
          <ReportTable empty={!Array.isArray(data) || data.length === 0}>
            <thead><tr><Th>SKU</Th><Th>Product</Th><Th>Qty</Th><Th align="right">Sales</Th><Th align="right">Cost</Th><Th align="right">GP</Th><Th align="right">Margin</Th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((item: any) => (
                <tr key={item.sku} className="hover:bg-blue-50/40">
                  <Td><span className="font-mono text-xs">{item.sku}</span></Td>
                  <Td>{item.name}</Td>
                  <Td>{item.total_qty}</Td>
                  <Td align="right">{formatCurrency(item.total_amount)}</Td>
                  <Td align="right">{formatCurrency(item.total_cost)}</Td>
                  <Td align="right" className="font-semibold">{formatCurrency(item.gross_profit)}</Td>
                  <Td align="right">{item.margin_pct}%</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        );

      case 'sales-by-cashier':
        return (
          <ReportTable empty={!Array.isArray(data) || data.length === 0}>
            <thead><tr><Th>Cashier</Th><Th>Transactions</Th><Th align="right">Total Sales</Th><Th align="right">Avg Sale</Th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((c: any) => (
                <tr key={c.full_name} className="hover:bg-blue-50/40">
                  <Td>{c.full_name}</Td>
                  <Td>{c.transaction_count}</Td>
                  <Td align="right">{formatCurrency(c.total_sales)}</Td>
                  <Td align="right">{formatCurrency(c.avg_sale)}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        );

      case 'sales-by-customer':
        return (
          <ReportTable empty={!Array.isArray(data) || data.length === 0}>
            <thead><tr><Th>Code</Th><Th>Customer</Th><Th>Invoices</Th><Th align="right">Sales</Th><Th align="right">Balance</Th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((c: any) => (
                <tr key={c.customer_code} className="hover:bg-blue-50/40">
                  <Td><span className="font-mono text-xs">{c.customer_code}</span></Td>
                  <Td>{c.customer_name}</Td>
                  <Td>{c.invoice_count}</Td>
                  <Td align="right">{formatCurrency(c.total_sales)}</Td>
                  <Td align="right" className={parseFloat(c.total_balance) > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(c.total_balance)}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        );

      case 'sales-invoice-register':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Posted credit sales invoices · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Invoices" value={String(data?.summary?.invoice_count || 0)} tone="blue" />
              <SummaryCard label="Total Sales" value={formatCurrency(data?.summary?.total || 0)} tone="green" />
              <SummaryCard label="Amount Paid" value={formatCurrency(data?.summary?.amount_paid || 0)} tone="green" />
              <SummaryCard label="Outstanding" value={formatCurrency(data?.summary?.balance || 0)} tone="red" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Invoice #</Th><Th>Date</Th><Th>Due</Th><Th>Customer</Th><Th>Status</Th>
                  <Th align="right">Subtotal</Th><Th align="right">VAT</Th><Th align="right">Total</Th><Th align="right">Paid</Th><Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-blue-50/40">
                    <Td><span className="font-mono text-xs">{r.invoice_number}</span></Td>
                    <Td className="text-xs">{formatDate(r.invoice_date)}</Td>
                    <Td className="text-xs">{r.due_date ? formatDate(r.due_date) : '—'}</Td>
                    <Td>{r.customer_name || '—'}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{r.status}</span></Td>
                    <Td align="right">{formatCurrency(r.subtotal)}</Td>
                    <Td align="right">{formatCurrency(r.vat_amount)}</Td>
                    <Td align="right">{formatCurrency(r.total)}</Td>
                    <Td align="right">{formatCurrency(r.amount_paid)}</Td>
                    <Td align="right" className={parseFloat(r.balance) > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(r.balance)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'consolidated-sales':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              POS + credit sales · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="Total Sales" value={formatCurrency(data?.summary?.total_sales || 0)} tone="green" />
              <SummaryCard label="Total Cost" value={formatCurrency(data?.summary?.total_cost || 0)} tone="red" />
              <SummaryCard label="Gross Profit" value={formatCurrency(data?.summary?.gross_profit || 0)} tone="green" />
              <SummaryCard label="Margin" value={`${data?.summary?.margin_pct || 0}%`} tone="purple" />
              <SummaryCard label="Documents" value={String((data?.summary?.pos_doc_count || 0) + (data?.summary?.credit_doc_count || 0))} tone="blue" />
            </div>
            <ReportTable empty={!data?.by_channel?.length}>
              <thead>
                <tr>
                  <Th>Channel</Th><Th>Documents</Th><Th align="right">Sales</Th><Th align="right">Cost</Th><Th align="right">Gross Profit</Th><Th align="right">Margin</Th>
                </tr>
              </thead>
              <tbody>
                {data?.by_channel?.map((c: any) => (
                  <tr key={c.channel} className="hover:bg-blue-50/40">
                    <Td className="font-medium">{c.channel}</Td>
                    <Td>{c.doc_count}</Td>
                    <Td align="right">{formatCurrency(c.sales)}</Td>
                    <Td align="right">{formatCurrency(c.cost)}</Td>
                    <Td align="right" className="font-semibold">{formatCurrency(c.gross_profit)}</Td>
                    <Td align="right">{c.margin_pct}%</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Daily Breakdown</p>
              <ReportTable empty={!data?.daily?.length}>
                <thead>
                  <tr>
                    <Th>Date</Th><Th>POS</Th><Th>Credit</Th><Th align="right">POS Sales</Th><Th align="right">Credit Sales</Th>
                    <Th align="right">Total Sales</Th><Th align="right">Cost</Th><Th align="right">GP</Th><Th align="right">Margin</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.daily?.map((d: any) => (
                    <tr key={d.sale_date} className="hover:bg-blue-50/40">
                      <Td className="text-xs">{formatDate(d.sale_date)}</Td>
                      <Td>{d.pos_count}</Td>
                      <Td>{d.credit_count}</Td>
                      <Td align="right">{formatCurrency(d.pos_sales)}</Td>
                      <Td align="right">{formatCurrency(d.credit_sales)}</Td>
                      <Td align="right" className="font-medium">{formatCurrency(d.total_sales)}</Td>
                      <Td align="right">{formatCurrency(d.total_cost)}</Td>
                      <Td align="right" className="font-semibold">{formatCurrency(d.gross_profit)}</Td>
                      <Td align="right">{d.margin_pct}%</Td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </div>
          </div>
        );

      case 'category-margin':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              GL category accounts (401x Sales vs 511x COGS) · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Total Sales" value={formatCurrency(data?.summary?.total_sales || 0)} tone="green" />
              <SummaryCard label="Total COGS" value={formatCurrency(data?.summary?.total_cogs || 0)} tone="red" />
              <SummaryCard label="Gross Profit" value={formatCurrency(data?.summary?.gross_profit || 0)} tone="green" />
              <SummaryCard label="Margin" value={`${data?.summary?.margin_pct || 0}%`} tone="purple" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Category</Th><Th>Sales Acct</Th><Th>COGS Acct</Th>
                  <Th align="right">Sales</Th><Th align="right">COGS</Th><Th align="right">Gross Profit</Th><Th align="right">Margin</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.category} className="hover:bg-blue-50/40">
                    <Td className="font-medium">{r.category}</Td>
                    <Td><span className="font-mono text-xs">{r.revenue_code}</span></Td>
                    <Td><span className="font-mono text-xs">{r.cogs_code}</span></Td>
                    <Td align="right">{formatCurrency(r.sales)}</Td>
                    <Td align="right">{formatCurrency(r.cogs)}</Td>
                    <Td align="right" className="font-semibold">{formatCurrency(r.gross_profit)}</Td>
                    <Td align="right">{r.margin_pct}%</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'dispatch-list':
        return (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">
                Delivery receipts for dispatch · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
              </p>
              <button
                type="button"
                onClick={() => printDocument(`/api/delivery-notes/dispatch-list/print?from=${dateRange.from}&to=${dateRange.to}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800"
              >
                <Printer size={14} /> Print Dispatch List
              </button>
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Date</Th><Th>DR #</Th><Th>Customer</Th><Th>SO #</Th><Th>Driver</Th><Th>Vehicle</Th>
                  <Th align="right">Qty</Th><Th>Status</Th><Th>Address</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-blue-50/40">
                    <Td className="text-xs">{formatDate(r.delivery_date)}</Td>
                    <Td><span className="font-mono text-xs">{r.dr_number}</span></Td>
                    <Td>{r.customer_name || '—'}</Td>
                    <Td><span className="font-mono text-xs">{r.so_number || '—'}</span></Td>
                    <Td>{r.driver_name || '—'}</Td>
                    <Td>{r.vehicle_plate || '—'}</Td>
                    <Td align="right">{r.total_qty}</Td>
                    <Td className="text-xs">{r.status}</Td>
                    <Td className="text-xs max-w-[200px] truncate">{r.delivery_address || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'reorder-suggestions':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">Low-stock products with suggested reorder qty, grouped by supplier catalog.</p>
            {(data?.suppliers || []).map((grp: any) => (
              <div key={grp.supplier_id || grp.supplier_name} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-700">
                  {grp.supplier_name} · {grp.items?.length || 0} item(s) · Suggested qty {grp.total_suggested_qty}
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 text-[10px] uppercase text-gray-500">
                      <th className="px-2 py-1.5 text-left">SKU</th>
                      <th className="px-2 py-1.5 text-left">Product</th>
                      <th className="px-2 py-1.5 text-right">On Hand</th>
                      <th className="px-2 py-1.5 text-right">Reorder</th>
                      <th className="px-2 py-1.5 text-right">Suggest</th>
                      <th className="px-2 py-1.5 text-right">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grp.items || []).map((r: any) => (
                      <tr key={r.product_id} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 font-mono">{r.sku}</td>
                        <td className="px-2 py-1.5">{r.product_name}</td>
                        <td className="px-2 py-1.5 text-right">{r.on_hand}</td>
                        <td className="px-2 py-1.5 text-right">{r.reorder_level}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-orange-700">{r.suggested_qty}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(r.est_unit_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {!data?.suppliers?.length && (
              <div className="text-center text-gray-400 py-12">No reorder suggestions — all products above reorder level</div>
            )}
          </div>
        );

      case 'delivery-fulfillment':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              SO → DR → SI pipeline · Order date {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <SummaryCard label="Orders" value={String(data?.summary?.order_count || 0)} tone="blue" />
              <SummaryCard label="Pending Delivery" value={String(data?.summary?.pending_delivery || 0)} tone="orange" />
              <SummaryCard label="Partial" value={String(data?.summary?.partially_delivered || 0)} tone="orange" />
              <SummaryCard label="Fully Delivered" value={String(data?.summary?.fully_delivered || 0)} tone="blue" />
              <SummaryCard label="Invoiced" value={String(data?.summary?.invoiced || 0)} tone="green" />
              <SummaryCard label="Pending Qty" value={String(data?.summary?.pending_qty || 0)} tone="red" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>SO #</Th><Th>Order Date</Th><Th>Customer</Th><Th>Stage</Th><Th>SO Status</Th>
                  <Th align="right">Ordered</Th><Th align="right">Delivered</Th><Th align="right">Remaining</Th><Th align="right">Del %</Th>
                  <Th>DRs</Th><Th>Inv</Th><Th align="right">Order Value</Th><Th align="right">Invoiced</Th><Th align="right">Uninvoiced</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-blue-50/40">
                    <Td><span className="font-mono text-xs">{r.so_number}</span></Td>
                    <Td className="text-xs">{formatDate(r.order_date)}</Td>
                    <Td>{r.customer_name || '—'}</Td>
                    <Td>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${FULFILLMENT_STAGE_TONES[r.fulfillment_stage] || 'bg-gray-100 text-gray-700'}`}>
                        {r.fulfillment_stage}
                      </span>
                    </Td>
                    <Td className="text-xs">{r.status}</Td>
                    <Td align="right">{r.total_ordered_qty}</Td>
                    <Td align="right">{r.total_delivered_qty}</Td>
                    <Td align="right" className={parseFloat(r.total_remaining_qty) > 0 ? 'text-orange-600 font-medium' : ''}>{r.total_remaining_qty}</Td>
                    <Td align="right">{r.delivery_pct}%</Td>
                    <Td>{r.dr_posted_count}{r.dr_draft_count > 0 ? ` (+${r.dr_draft_count} draft)` : ''}</Td>
                    <Td>{r.invoice_count}</Td>
                    <Td align="right">{formatCurrency(r.order_value)}</Td>
                    <Td align="right">{formatCurrency(r.invoiced_amount)}</Td>
                    <Td align="right" className={parseFloat(r.uninvoiced_amount) > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(r.uninvoiced_amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'purchase-register':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Purchase orders · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Orders" value={String(data?.summary?.order_count || 0)} tone="blue" />
              <SummaryCard label="Subtotal" value={formatCurrency(data?.summary?.subtotal || 0)} />
              <SummaryCard label="VAT" value={formatCurrency(data?.summary?.vat_amount || 0)} tone="orange" />
              <SummaryCard label="Total" value={formatCurrency(data?.summary?.total || 0)} tone="green" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>PO #</Th><Th>Date</Th><Th>Supplier</Th><Th>Status</Th><Th>VAT Mode</Th>
                  <Th align="right">Subtotal</Th><Th align="right">Discount</Th><Th align="right">Tax</Th><Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-blue-50/40">
                    <Td><span className="font-mono text-xs">{r.po_number}</span></Td>
                    <Td className="text-xs">{formatDate(r.order_date)}</Td>
                    <Td>{r.supplier_name || '—'}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{r.status}</span></Td>
                    <Td className="text-xs">{r.vat_mode || '—'}</Td>
                    <Td align="right">{formatCurrency(r.subtotal)}</Td>
                    <Td align="right">{formatCurrency(r.discount)}</Td>
                    <Td align="right">{formatCurrency(r.tax)}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'ar-aging':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">Open receivables as of today · {data?.count || 0} invoice(s) · {formatCurrency(data?.total_outstanding || 0)} outstanding</p>
            <AgingBucketCards buckets={data?.buckets} />
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Invoice #</Th><Th>Customer</Th><Th>Invoice Date</Th><Th>Due Date</Th><Th>Aging</Th><Th>Status</Th>
                  <Th align="right">Total</Th><Th align="right">Paid</Th><Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-green-50/30">
                    <Td><span className="font-mono text-xs">{r.invoice_number}</span></Td>
                    <Td>{r.customer_name || '—'}</Td>
                    <Td className="text-xs">{formatDate(r.invoice_date)}</Td>
                    <Td className="text-xs">{r.due_date ? formatDate(r.due_date) : '—'}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">{AGING_BUCKET_LABELS[r.aging_bucket] || r.aging_bucket}</span></Td>
                    <Td className="text-xs">{r.status}</Td>
                    <Td align="right">{formatCurrency(r.total)}</Td>
                    <Td align="right">{formatCurrency(r.amount_paid)}</Td>
                    <Td align="right" className="font-medium text-red-600">{formatCurrency(r.balance_due)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'ap-aging':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">Open payables as of today · {data?.count || 0} voucher(s) · {formatCurrency(data?.total_outstanding || 0)} outstanding</p>
            <AgingBucketCards buckets={data?.buckets} />
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>APV #</Th><Th>Supplier</Th><Th>APV Date</Th><Th>Due Date</Th><Th>Aging</Th><Th>Status</Th><Th>PO #</Th>
                  <Th align="right">Total</Th><Th align="right">Paid</Th><Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-red-50/30">
                    <Td><span className="font-mono text-xs">{r.apv_number}</span></Td>
                    <Td>{r.supplier_name || '—'}</Td>
                    <Td className="text-xs">{formatDate(r.apv_date)}</Td>
                    <Td className="text-xs">{r.due_date ? formatDate(r.due_date) : '—'}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">{AGING_BUCKET_LABELS[r.aging_bucket] || r.aging_bucket}</span></Td>
                    <Td className="text-xs">{r.status}</Td>
                    <Td className="font-mono text-xs">{r.po_number || '—'}</Td>
                    <Td align="right">{formatCurrency(r.total_amount)}</Td>
                    <Td align="right">{formatCurrency(r.amount_paid)}</Td>
                    <Td align="right" className="font-medium text-red-600">{formatCurrency(r.balance_due)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'inventory-valuation':
        return (
          <ReportTable empty={!Array.isArray(data) || data.length === 0}>
            <thead><tr><Th>SKU</Th><Th>Product</Th><Th>Location</Th><Th align="right">Qty</Th><Th align="right">Unit Cost</Th><Th align="right">Value</Th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((i: any) => (
                <tr key={`${i.sku}-${i.location_name}`} className="hover:bg-blue-50/40">
                  <Td><span className="font-mono text-xs">{i.sku}</span></Td>
                  <Td>{i.name}</Td>
                  <Td>{i.location_name}</Td>
                  <Td align="right">{i.total_quantity}</Td>
                  <Td align="right">{formatCurrency(i.cost)}</Td>
                  <Td align="right" className="font-medium">{formatCurrency(i.total_value)}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        );

      case 'stock-movement':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Inventory ledger · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="Movements" value={String(data?.summary?.movement_count || 0)} tone="blue" />
              <SummaryCard label="Total IN" value={String(data?.summary?.total_in || 0)} tone="green" />
              <SummaryCard label="Total OUT" value={String(data?.summary?.total_out || 0)} tone="red" />
              <SummaryCard label="Adjustments" value={String(data?.summary?.total_adjustment || 0)} tone="orange" />
              <SummaryCard label="Net Qty" value={String(data?.summary?.net_movement || 0)} tone="purple" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Date/Time</Th><Th>SKU</Th><Th>Product</Th><Th>Location</Th><Th>Reference</Th><Th>Type</Th>
                  <Th align="right">Qty</Th><Th align="right">Signed</Th><Th align="right">Cost</Th><Th align="right">Running</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-blue-50/40">
                    <Td className="text-xs">{new Date(r.created_at).toLocaleString('en-PH')}</Td>
                    <Td><span className="font-mono text-xs">{r.sku}</span></Td>
                    <Td>{r.product_name}</Td>
                    <Td>{r.location_name || '—'}</Td>
                    <Td className="text-xs">{r.reference_type}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded-full bg-gray-100">{r.transaction_type}</span></Td>
                    <Td align="right">{r.quantity}</Td>
                    <Td align="right" className={parseFloat(r.signed_qty) < 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>{r.signed_qty}</Td>
                    <Td align="right">{formatCurrency(r.unit_cost)}</Td>
                    <Td align="right">{r.running_quantity ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'slow-moving':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              In-stock items with no outbound movement in {data?.summary?.days_threshold || 90}+ days
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SummaryCard label="Slow Items" value={String(data?.summary?.item_count || 0)} tone="orange" />
              <SummaryCard label="Total Qty" value={String(data?.summary?.total_qty || 0)} />
              <SummaryCard label="Stock Value" value={formatCurrency(data?.summary?.total_value || 0)} tone="red" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>SKU</Th><Th>Product</Th><Th>Location</Th><Th align="right">Qty</Th><Th align="right">Value</Th><Th>Last Out</Th><Th>Days Idle</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={`${r.sku}-${r.location_name}`} className="hover:bg-amber-50/40">
                    <Td><span className="font-mono text-xs">{r.sku}</span></Td>
                    <Td>{r.product_name}</Td>
                    <Td>{r.location_name}</Td>
                    <Td align="right">{r.quantity}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.stock_value)}</Td>
                    <Td className="text-xs">{r.last_movement_at ? formatDate(r.last_movement_at) : 'Never'}</Td>
                    <Td>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${r.days_since_movement == null ? 'bg-red-100 text-red-700' : r.days_since_movement >= 180 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {r.days_since_movement == null ? 'Never sold' : `${r.days_since_movement} days`}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'count-variance':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Posted inventory counts · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
              {data?.all_items != null ? ` · ${data.all_items} lines counted` : ''}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Count Sessions" value={String(data?.summary?.count_sessions || 0)} tone="blue" />
              <SummaryCard label="With Variance" value={String(data?.summary?.items_with_variance || 0)} tone="orange" />
              <SummaryCard label="Shrinkage" value={formatCurrency(data?.summary?.shrinkage_value || 0)} tone="red" />
              <SummaryCard label="Overage" value={formatCurrency(data?.summary?.overage_value || 0)} tone="green" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Count #</Th><Th>Date</Th><Th>Location</Th><Th>SKU</Th><Th>Product</Th>
                  <Th align="right">System</Th><Th align="right">Actual</Th><Th align="right">Variance</Th><Th align="right">Value</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={`${r.count_id}-${r.sku}`} className="hover:bg-amber-50/40">
                    <Td><span className="font-mono text-xs">{r.count_number}</span></Td>
                    <Td className="text-xs">{formatDate(r.count_date)}</Td>
                    <Td>{r.location_name || '—'}</Td>
                    <Td><span className="font-mono text-xs">{r.sku}</span></Td>
                    <Td>{r.product_name}</Td>
                    <Td align="right">{r.system_qty}</Td>
                    <Td align="right">{r.actual_qty}</Td>
                    <Td align="right" className={parseFloat(r.variance) < 0 ? 'text-red-600 font-medium' : parseFloat(r.variance) > 0 ? 'text-green-600 font-medium' : ''}>{r.variance}</Td>
                    <Td align="right">{formatCurrency(r.variance_value)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'low-stock':
        return (
          <ReportTable empty={!Array.isArray(data) || data.length === 0}>
            <thead><tr><Th>SKU</Th><Th>Product</Th><Th>Location</Th><Th align="right">Stock</Th><Th align="right">Reorder</Th><Th align="right">Deficit</Th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((i: any) => (
                <tr key={`${i.sku}-${i.location_name}`} className="hover:bg-red-50/30">
                  <Td><span className="font-mono text-xs">{i.sku}</span></Td>
                  <Td className="font-medium text-red-700">{i.name}</Td>
                  <Td>{i.location_name}</Td>
                  <Td align="right" className="text-red-600 font-bold">{i.quantity}</Td>
                  <Td align="right">{i.reorder_level}</Td>
                  <Td align="right" className="text-red-600">{i.deficit}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        );

      case 'expiry':
        return (
          <ReportTable empty={!Array.isArray(data) || data.length === 0}>
            <thead><tr><Th>Product</Th><Th>Batch</Th><Th>Location</Th><Th align="right">Qty</Th><Th>Expiry</Th><Th>Days Left</Th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((b: any) => {
                const daysLeft = Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000);
                return (
                  <tr key={b.id} className="hover:bg-amber-50/40">
                    <Td>{b.product_name}</Td>
                    <Td><span className="font-mono text-xs">{b.batch_number}</span></Td>
                    <Td>{b.location_name}</Td>
                    <Td align="right">{b.quantity}</Td>
                    <Td className="text-xs">{b.expiry_date ? formatDate(b.expiry_date) : '—'}</Td>
                    <Td>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${daysLeft <= 7 ? 'bg-red-100 text-red-700' : daysLeft <= 30 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                        {daysLeft > 0 ? `${daysLeft} days` : 'Expired'}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </ReportTable>
        );

      case 'vat':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              VAT summary · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
              {data?.input?.source && data.input.source !== 'None' ? ` · Input source: ${data.input.source}` : ''}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard label="Output VAT" value={formatCurrency(data?.output_vat || 0)} tone="blue" />
              <SummaryCard label="Input VAT" value={formatCurrency(data?.input_vat || 0)} tone="orange" />
              <SummaryCard label="VAT Payable" value={formatCurrency(data?.vat_payable || 0)} tone={parseFloat(data?.vat_payable || 0) >= 0 ? 'green' : 'red'} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Output Tax (Sales)</p>
                <ReportTable empty={false}>
                  <thead><tr><Th>Source</Th><Th>Docs</Th><Th align="right">VATable</Th><Th align="right">Output VAT</Th></tr></thead>
                  <tbody>
                    <tr className="hover:bg-blue-50/40">
                      <Td>POS</Td><Td>{data?.output?.pos_count || 0}</Td>
                      <Td align="right">{formatCurrency(data?.output?.pos_vatable || 0)}</Td>
                      <Td align="right">{formatCurrency(data?.output?.pos_vat || 0)}</Td>
                    </tr>
                    <tr className="hover:bg-blue-50/40">
                      <Td>Credit Invoices</Td><Td>{data?.output?.credit_count || 0}</Td>
                      <Td align="right">{formatCurrency(data?.output?.credit_vatable || 0)}</Td>
                      <Td align="right">{formatCurrency(data?.output?.credit_vat || 0)}</Td>
                    </tr>
                    <tr className="font-semibold bg-gray-50">
                      <Td>Total</Td><Td>{(data?.output?.pos_count || 0) + (data?.output?.credit_count || 0)}</Td>
                      <Td align="right">{formatCurrency(data?.output?.total_vatable || 0)}</Td>
                      <Td align="right">{formatCurrency(data?.output?.total_vat || 0)}</Td>
                    </tr>
                  </tbody>
                </ReportTable>
                {(parseFloat(data?.output?.credit_exempt || 0) > 0 || parseFloat(data?.output?.credit_zero_rated || 0) > 0) && (
                  <p className="text-[11px] text-gray-400 mt-2">
                    Credit exempt: {formatCurrency(data?.output?.credit_exempt || 0)} · Zero-rated: {formatCurrency(data?.output?.credit_zero_rated || 0)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Input Tax (Purchases)</p>
                <ReportTable empty={false}>
                  <thead><tr><Th>Source</Th><Th>Docs</Th><Th align="right">VATable</Th><Th align="right">Input VAT</Th></tr></thead>
                  <tbody>
                    <tr className={`hover:bg-orange-50/40 ${data?.input?.source === 'APV' ? 'font-medium' : 'opacity-60'}`}>
                      <Td>AP Vouchers {data?.input?.source === 'APV' ? '(used)' : ''}</Td><Td>{data?.input?.apv_count || 0}</Td>
                      <Td align="right">{formatCurrency(data?.input?.apv_vatable || 0)}</Td>
                      <Td align="right">{formatCurrency(data?.input?.apv_vat || 0)}</Td>
                    </tr>
                    <tr className={`hover:bg-orange-50/40 ${data?.input?.source === 'PO' ? 'font-medium' : 'opacity-60'}`}>
                      <Td>Purchase Orders {data?.input?.source === 'PO' ? '(used)' : '(ref)'}</Td><Td>{data?.input?.po_count || 0}</Td>
                      <Td align="right">{formatCurrency(data?.input?.po_vatable || 0)}</Td>
                      <Td align="right">{formatCurrency(data?.input?.po_vat || 0)}</Td>
                    </tr>
                    <tr className="font-semibold bg-gray-50">
                      <Td>Total (payable calc)</Td><Td>—</Td>
                      <Td align="right">—</Td>
                      <Td align="right">{formatCurrency(data?.input_vat || 0)}</Td>
                    </tr>
                  </tbody>
                </ReportTable>
              </div>
            </div>
          </div>
        );

      case 'bir-2550q':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              BIR Form 2550Q prep worksheet · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="VATable Sales" value={formatCurrency(data?.summary?.vatable_sales || 0)} tone="blue" />
              <SummaryCard label="Output VAT" value={formatCurrency(data?.summary?.output_vat || 0)} tone="green" />
              <SummaryCard label="Input VAT" value={formatCurrency(data?.summary?.input_vat || 0)} tone="orange" />
              <SummaryCard label="VAT Payable" value={formatCurrency(data?.summary?.vat_payable || 0)} tone="purple" />
            </div>
            <p className="text-[11px] text-gray-400">
              GL 2100 movement: {formatCurrency(data?.summary?.gl_vat_payable_balance || 0)}
              {Math.abs(parseFloat(data?.summary?.variance || 0)) > 0.01 && (
                <span className="text-amber-600"> · Variance vs line 57: {formatCurrency(data?.summary?.variance || 0)}</span>
              )}
            </p>
            <ReportTable empty={!data?.lines?.length}>
              <thead><tr><Th>Line</Th><Th>Description</Th><Th align="right">Amount</Th><Th>Source</Th></tr></thead>
              <tbody>
                {data?.lines?.map((r: any) => (
                  <tr key={r.line} className="hover:bg-blue-50/40">
                    <Td><span className="font-mono text-xs">{r.line}</span></Td>
                    <Td>{r.description}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.amount)}</Td>
                    <Td className="text-xs text-gray-500">{r.source || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'branch-summary':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Inventory and credit sales by location · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Locations" value={String(data?.summary?.location_count || 0)} tone="blue" />
              <SummaryCard label="Inventory Value" value={formatCurrency(data?.summary?.total_inventory_value || 0)} tone="orange" />
              <SummaryCard label="Credit Sales" value={formatCurrency(data?.summary?.total_credit_sales || 0)} tone="green" />
              <SummaryCard label="Gross Profit" value={formatCurrency(data?.summary?.gross_profit || 0)} tone="purple" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Location</Th><Th>Type</Th><Th align="right">Inventory</Th><Th align="right">On Hand Qty</Th>
                  <Th align="right">Credit Sales</Th><Th align="right">COGS</Th><Th align="right">GP</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.location_id} className="hover:bg-blue-50/40">
                    <Td className="font-medium">{r.location_name}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded bg-gray-100">{r.location_type}</span></Td>
                    <Td align="right">{formatCurrency(r.inventory_value)}</Td>
                    <Td align="right">{r.total_qty}</Td>
                    <Td align="right">{formatCurrency(r.credit_sales)}</Td>
                    <Td align="right">{formatCurrency(r.cogs)}</Td>
                    <Td align="right" className="font-semibold">{formatCurrency(r.gross_profit)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
            <p className="text-[11px] text-gray-400">POS sales are store-wide and not split by location in this report.</p>
          </div>
        );

      case 'withholding-tax':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              Expanded Withholding Tax & LGU · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Invoice EWT" value={formatCurrency(data?.summary?.invoice_ewt || 0)} tone="orange" />
              <SummaryCard label="Collected EWT" value={formatCurrency(data?.summary?.collected_ewt || 0)} tone="orange" />
              <SummaryCard label="Invoice LGU" value={formatCurrency(data?.summary?.invoice_lgu || 0)} tone="purple" />
              <SummaryCard label="Collected LGU" value={formatCurrency(data?.summary?.collected_lgu || 0)} tone="purple" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">On Invoices ({data?.summary?.invoice_count || 0})</p>
              <ReportTable empty={!data?.invoice_rows?.length}>
                <thead><tr><Th>Invoice #</Th><Th>Date</Th><Th>Customer</Th><Th>TIN</Th><Th align="right">EWT</Th><Th align="right">LGU</Th><Th align="right">Total</Th></tr></thead>
                <tbody>
                  {data?.invoice_rows?.map((r: any) => (
                    <tr key={r.id} className="hover:bg-orange-50/30">
                      <Td><span className="font-mono text-xs">{r.invoice_number}</span></Td>
                      <Td className="text-xs">{formatDate(r.invoice_date)}</Td>
                      <Td>{r.customer_name || '—'}</Td>
                      <Td className="text-xs font-mono">{r.customer_tin || '—'}</Td>
                      <Td align="right">{formatCurrency(r.ewt_amount)}</Td>
                      <Td align="right">{formatCurrency(r.lgu_amount)}</Td>
                      <Td align="right">{formatCurrency(r.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">On Collections ({data?.summary?.collection_count || 0})</p>
              <ReportTable empty={!data?.collection_rows?.length}>
                <thead><tr><Th>CR #</Th><Th>Payment Date</Th><Th>Customer</Th><Th>Invoice #</Th><Th align="right">EWT</Th><Th align="right">LGU</Th><Th align="right">Applied</Th></tr></thead>
                <tbody>
                  {data?.collection_rows?.map((r: any) => (
                    <tr key={`${r.id}-${r.invoice_number}`} className="hover:bg-orange-50/30">
                      <Td><span className="font-mono text-xs">{r.receipt_number}</span></Td>
                      <Td className="text-xs">{formatDate(r.payment_date)}</Td>
                      <Td>{r.customer_name || '—'}</Td>
                      <Td className="font-mono text-xs">{r.invoice_number}</Td>
                      <Td align="right">{formatCurrency(r.ewt_amount)}</Td>
                      <Td align="right">{formatCurrency(r.lgu_amount)}</Td>
                      <Td align="right">{formatCurrency(r.applied_amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </div>
          </div>
        );

      case 'slsp-sales':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              BIR Summary List of Sales · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="Records" value={String(data?.summary?.row_count || 0)} tone="blue" />
              <SummaryCard label="Gross Sales" value={formatCurrency(data?.summary?.gross_sales || 0)} tone="green" />
              <SummaryCard label="VATable" value={formatCurrency(data?.summary?.vatable_sales || 0)} />
              <SummaryCard label="Exempt" value={formatCurrency(data?.summary?.exempt_sales || 0)} tone="orange" />
              <SummaryCard label="Output VAT" value={formatCurrency(data?.summary?.output_vat || 0)} tone="purple" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>Doc #</Th><Th>Date</Th><Th>Source</Th><Th>Customer</Th><Th>TIN</Th>
                  <Th align="right">Gross</Th><Th align="right">Exempt</Th><Th align="right">Zero Rated</Th><Th align="right">VATable</Th><Th align="right">Output VAT</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={`${r.source}-${r.id || r.doc_number}`} className="hover:bg-blue-50/40">
                    <Td><span className="font-mono text-xs">{r.doc_number}</span></Td>
                    <Td className="text-xs">{formatDate(r.doc_date)}</Td>
                    <Td><span className="px-2 py-0.5 text-xs rounded-full bg-gray-100">{r.source}</span></Td>
                    <Td>{r.customer_name || '—'}</Td>
                    <Td className="text-xs font-mono">{r.customer_tin || '—'}</Td>
                    <Td align="right">{formatCurrency(r.gross_sales)}</Td>
                    <Td align="right">{formatCurrency(r.exempt_sales)}</Td>
                    <Td align="right">{formatCurrency(r.zero_rated_sales)}</Td>
                    <Td align="right">{formatCurrency(r.vatable_sales)}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.output_vat)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      case 'slsp-purchases':
        return (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">
              BIR Summary List of Purchases · {formatDate(data?.period?.from || dateRange.from)} to {formatDate(data?.period?.to || dateRange.to)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Records" value={String(data?.summary?.row_count || 0)} tone="blue" />
              <SummaryCard label="Gross Purchases" value={formatCurrency(data?.summary?.gross_purchases || 0)} tone="green" />
              <SummaryCard label="VATable" value={formatCurrency(data?.summary?.vatable_purchases || 0)} />
              <SummaryCard label="Input VAT" value={formatCurrency(data?.summary?.input_vat || 0)} tone="orange" />
            </div>
            <ReportTable empty={!data?.rows?.length}>
              <thead>
                <tr>
                  <Th>APV #</Th><Th>Date</Th><Th>Supplier Inv #</Th><Th>Supplier</Th><Th>TIN</Th><Th>Status</Th>
                  <Th align="right">Gross</Th><Th align="right">Exempt</Th><Th align="right">VATable</Th><Th align="right">Input VAT</Th>
                </tr>
              </thead>
              <tbody>
                {data?.rows?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-orange-50/30">
                    <Td><span className="font-mono text-xs">{r.doc_number}</span></Td>
                    <Td className="text-xs">{formatDate(r.doc_date)}</Td>
                    <Td className="text-xs font-mono">{r.supplier_invoice_number || '—'}</Td>
                    <Td>{r.supplier_name || '—'}</Td>
                    <Td className="text-xs font-mono">{r.supplier_tin || '—'}</Td>
                    <Td className="text-xs">{r.status}</Td>
                    <Td align="right">{formatCurrency(r.gross_purchases)}</Td>
                    <Td align="right">{formatCurrency(r.exempt_purchases)}</Td>
                    <Td align="right">{formatCurrency(r.vatable_purchases)}</Td>
                    <Td align="right" className="font-medium">{formatCurrency(r.input_vat)}</Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        );

      default:
        return null;
    }
  };

  if (allAccessible.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
        <div className="text-center text-gray-500">
          <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No reports available</p>
          <p className="text-sm mt-1">Contact an administrator to assign report permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50 print:h-auto print:m-0" style={{ fontFamily: FINANCE_FONT }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3 print:hidden" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <FileSpreadsheet size={18} className="text-white/90 flex-shrink-0" />
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto max-w-full">
            {sections.map((s) => {
              const Icon = SECTION_ICONS[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveSection(s.key)}
                  className={financeTabClass(activeSection === s.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon size={13} />
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 flex-shrink-0 overflow-x-auto max-w-[45%]">
          {headerKpis.map((k) => <KpiPill key={k.label} label={k.label} value={k.value} />)}
        </div>
        <button
          type="button"
          onClick={loadReport}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20 flex-shrink-0 print:hidden"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Sub-report picker + filters */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {sectionReports.map((r: ReportDef) => {
              const Icon = REPORT_ICONS[r.id] || BarChart3;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveReport(r.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeReport === r.id
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Icon size={13} />
                  {r.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {activeDef?.singleDate && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 whitespace-nowrap">
                  {activeReport === 'daily-payables' || activeReport === 'daily-receivables' ? 'Payment Date' : 'Date'}
                </label>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm"
                />
              </div>
            )}
            {activeDef && !activeDef.singleDate && !activeDef.noDateRange && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">From</label>
                  <input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">To</label>
                  <input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm" />
                </div>
              </>
            )}
            {activeDef?.exportable && (
              <>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={loading || !hasExportRows}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  <Download size={14} /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <Printer size={14} /> Print
                </button>
              </>
            )}
          </div>
        </div>
        {activeDef && (
          <p className="text-[11px] text-gray-400 mt-2">{activeDef.label} · {sections.find((s) => s.key === activeSection)?.label}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 p-4 print:p-0">
        <div className="h-full bg-white rounded-xl border border-gray-200 overflow-hidden print:border-0 print:rounded-none">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
