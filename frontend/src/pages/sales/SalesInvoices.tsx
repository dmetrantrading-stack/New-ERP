import React, { useState, useEffect, useRef } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate, PAYMENT_METHODS } from '../../lib/utils';
import { Plus, Eye, XCircle, Printer, Search, ArrowLeft, X, Edit2, FileText, Paperclip, Banknote } from 'lucide-react';
import toast from 'react-hot-toast';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import CustomerAutocomplete, { formatCustomerLabel } from '../../components/CustomerAutocomplete';
import AttachmentPanel from '../../components/AttachmentPanel';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { useAuth } from '../../store/auth';

const LOCATIONS = [{ id: 1, name: 'Store' }, { id: 2, name: 'Warehouse' }];
const TAX_TYPES = ['VATable', 'VAT Exempt', 'Zero Rated', 'LGU 5% Final VAT'];

import Pagination from '../../components/Pagination';
import { computeInvoiceLine, computeEwtForAppliedAmount, resolveInvoiceEwtRate } from '../../lib/invoiceTax';
import { effectiveInvoiceTaxType, NO_VAT_TAX_TYPE } from '../../lib/retailTaxPolicy';
import {
  fetchSoCopyToInvoice,
  fetchDrCopyToInvoice,
  fetchInvoiceCopyToInvoice,
  buildInvoiceFormFromCopyPayload,
  buildSelectedCustomerFromInvoiceCopy,
  enrichInvoiceItemsWithProducts,
  mergeProductsFromCopyItems,
  mapTaxTypeForInvoice,
} from '../../lib/salesCopy';
import CopyToMenu from '../../components/CopyToMenu';
import { printDocument } from '../../lib/printDocument';
import { resolveCustomerPriceMode } from '../../lib/customerPricing';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import { convertToBaseQty, getUomPrice, resolveSalesUom } from '../../lib/uomUtils';
import { hydrateSalesDocLineFromApi } from '../../lib/salesDocUom';

const PRIMARY = '#1E40AF';

const INV_STATUS_COLORS: Record<string, string> = {
  Paid: 'bg-green-100 text-green-700',
  Posted: 'bg-blue-100 text-blue-700',
  Partial: 'bg-yellow-100 text-yellow-700',
  Overdue: 'bg-red-100 text-red-700',
  Deducted: 'bg-purple-100 text-purple-700',
  Void: 'bg-gray-200 text-gray-500',
};

export default function SalesInvoices() {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(false);
  const [viewInv, setViewInv] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState<{ invoice_number?: string; status?: string }>({});
  const [currentInvoiceId, setCurrentInvoiceId] = useState<string | null>(null);
  const [invoiceAttachments, setInvoiceAttachments] = useState<any[]>([]);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [previewAttachFile, setPreviewAttachFile] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [customerPriceMap, setCustomerPriceMap] = useState<Record<string, number>>({});
  const [invoiceTaxType, setInvoiceTaxType] = useState('VATable');
  const getPrice = (customer: any, product: any) => {
    if (product?.id && customerPriceMap[product.id] != null) {
      return parseFloat(String(customerPriceMap[product.id]));
    }
    const mode = resolveCustomerPriceMode(customer);
    if (mode === 'Wholesale') return parseFloat(product.wholesale_price || 0);
    if (mode === 'Distributor') return parseFloat(product.distributor_price || 0);
    return parseFloat(product.retail_price || 0);
  };
  const blankInvoiceLineItem = (locationId = 1) => ({
    product_id: '', location_id: locationId, quantity: 1, available_qty: 0,
    unit_cost: 0, unit_price: 0, unit_of_measure: '', discount: 0, tax_type: invoiceTaxType,
    uoms: [] as any[], uom_id: null as number | null,
  });
  const loadLineUoms = async (productId: string | number) => {
    try {
      const res = await api.get(`/products/${productId}/uoms`);
      return res.data || [];
    } catch {
      return [];
    }
  };
  const uomPriceForCustomer = (uom: any) => getUomPrice(uom, resolveCustomerPriceMode(selectedCustomer));
  const applySalesUomToLine = (line: any, uoms: any[], uomId?: number | null, product?: any) => {
    const uom = resolveSalesUom(uoms, uomId, null);
    if (!uom) return line;
    let unitPrice = uomPriceForCustomer(uom);
    if (!unitPrice && product) unitPrice = getPrice(selectedCustomer, product);
    return {
      ...line,
      uoms,
      uom_id: uom.uom_id,
      unit_of_measure: uom.uom_code || line.unit_of_measure || 'pc',
      unit_price: unitPrice,
    };
  };
  const lineBaseQty = (item: any) => {
    const uom = resolveSalesUom(item.uoms || [], item.uom_id, null);
    return convertToBaseQty(parseFloat(String(item.quantity || 0)), uom?.conversion_to_base || 1);
  };
  const buildInvoiceItemPayload = (i: any) => {
    const uom = resolveSalesUom(i.uoms || [], i.uom_id, null);
    const enteredQty = parseFloat(String(i.quantity));
    const conversion = uom?.conversion_to_base || 1;
    return {
      product_id: i.product_id,
      quantity: enteredQty,
      entered_qty: enteredQty,
      uom_id: i.uom_id || uom?.uom_id || null,
      conversion_to_base: conversion,
      base_qty: convertToBaseQty(enteredQty, conversion),
      unit_price: parseFloat(String(i.unit_price)),
      discount: parseFloat(String(i.discount)),
      location_id: i.location_id,
      tax_type: i.tax_type || invoiceTaxType,
    };
  };
  const [ewtRate, setEwtRate] = useState('0');
  const [customerType, setCustomerType] = useState('Customer');
  const [form, setForm] = useState<any>({ customer_id: '', employee_id: '', items: [], payment_method: 'Cash', amount_tendered: 0, due_date: '', notes: '', terms_conditions: '', payment_terms: '', so_id: '', so_number: '', sq_number: '', dn_id: '', dr_number: '', skip_inventory: false });
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [autoFocusItem, setAutoFocusItem] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listSearch, setListSearch] = useState('');
  const limit = 20;

  const loadInvoices = () => {
    api.get(`/sales/invoices?page=${page}&limit=${limit}${statusFilter ? `&status=${statusFilter}` : ''}`)
      .then((res) => { setInvoices(res.data.data); setTotal(res.data.total); })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadInvoices();
    api.get('/hr/employees').then((res) => setEmployees(res.data)).catch(() => {});
    api.get('/products?limit=500').then((res) => setProducts(res.data.data)).catch(() => {});
  }, [page, statusFilter]);

  const searchProducts = async (q: string) => {
    try { const res = await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`); return res.data; }
    catch { return []; }
  };

  const computeDueDate = (date: string, terms: string) => {
    if (!date || !terms) return '';
    const d = parseInt(terms);
    if (isNaN(d)) return '';
    const dt = new Date(date);
    dt.setDate(dt.getDate() + d);
    return dt.toISOString().split('T')[0];
  };

  const applyInvoiceCopyPayload = async (payload: any, sourceLabel: string) => {
    const built = buildInvoiceFormFromCopyPayload(payload, invoiceDate, computeDueDate);
    const { invoiceTaxType: taxType, ewtRate: ewt, customerType: custType, ...nextForm } = built;
    let productList = products;
    try {
      const pr = await api.get('/products?limit=500');
      productList = pr.data?.data || pr.data || products;
      mergeProductsFromCopyItems(nextForm.items, setProducts);
    } catch {
      mergeProductsFromCopyItems(nextForm.items, setProducts);
    }
    const priceTier = payload.customer_type || 'Retail';
    const enrichedItems = [];
    for (const item of nextForm.items) {
      const hydrated = await hydrateSalesDocLineFromApi(
        { ...item, product_name: item.description },
        priceTier,
      );
      const product = productList.find((p: any) => String(p.id) === String(item.product_id));
      let available_qty = item.available_qty || 0;
      if (item.product_id) {
        try {
          const res = await api.get(`/inventory/product/${item.product_id}`);
          const locInv = res.data.find((inv: any) => inv.location_id === (item.location_id || 1));
          available_qty = locInv ? parseFloat(locInv.quantity) : 0;
        } catch {
          // non-blocking
        }
      }
      enrichedItems.push({
        ...hydrated,
        location_id: item.location_id || 1,
        available_qty,
        unit_cost: product?.cost ?? item.unit_cost ?? 0,
        tax_type: item.tax_type,
      });
    }
    setForm({ ...nextForm, items: enrichedItems });
    if (custType === 'Employee' && payload.employee_id) {
      const emp = employees.find((e: any) => String(e.id) === String(payload.employee_id));
      setSelectedEmployee(emp || { id: payload.employee_id });
      setSelectedCustomer(null);
    } else {
      const cust = buildSelectedCustomerFromInvoiceCopy(payload, customers);
      if (cust?.id) selectCustomer(String(cust.id), cust);
      else setSelectedCustomer(cust);
      setSelectedEmployee(null);
    }
    setCustomerType(custType);
    setInvoiceTaxType(taxType);
    setEwtRate(ewt);
    setCreating(true);
    setEditingInvoiceId(null);
    setEditingMeta({});
    toast.success(`Copied from ${sourceLabel}`);
  };

  const loadFromSalesOrder = async (soId: string) => {
    const payload = await fetchSoCopyToInvoice(soId);
    await applyInvoiceCopyPayload(payload, payload.source_so_number);
  };

  const loadFromDeliveryReceipt = async (drId: string) => {
    const payload = await fetchDrCopyToInvoice(drId);
    await applyInvoiceCopyPayload(payload, payload.source_dr_number);
  };

  const loadFromInvoice = async (invoiceId: string) => {
    const payload = await fetchInvoiceCopyToInvoice(invoiceId);
    await applyInvoiceCopyPayload(payload, payload.source_invoice_number);
  };

  useEffect(() => {
    const soId = searchParams.get('copy_from_so');
    const drId = searchParams.get('copy_from_dr');
    const invoiceId = searchParams.get('copy_from_invoice');
    const copyKey = soId ? `so:${soId}` : drId ? `dr:${drId}` : invoiceId ? `inv:${invoiceId}` : '';
    if (!copyKey || !beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    const loader = soId
      ? loadFromSalesOrder(soId)
      : drId
        ? loadFromDeliveryReceipt(drId)
        : loadFromInvoice(invoiceId!);
    loader
      .catch((err: any) => toast.error(err.response?.data?.error || 'Failed to load copy data'))
      .finally(() => endCopyNavigation(copyKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const cid = form.customer_id;
    if (!creating || !cid || customerType === 'Employee') return;
    if (String(selectedCustomer?.id) === String(cid)) return;
    selectCustomer(String(cid));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customer_id, creating, customerType]);

  useEffect(() => { setPage(1); }, [statusFilter]);

  const searchCustomers = async (q: string) => {
    try {
      const res = await api.get(`/customers?search=${encodeURIComponent(q)}&limit=20`);
      return res.data.data || res.data || [];
    } catch {
      return [];
    }
  };

  const applyCustomer = (c: any) => {
    setCustomers((prev) => (prev.some((x) => String(x.id) === String(c.id)) ? prev : [...prev, c]));
    setSelectedCustomer(c);
    api.get(`/customers/${c.id}/prices`)
      .then((r) => {
        const map: Record<string, number> = {};
        (r.data || []).forEach((row: any) => { map[row.product_id] = parseFloat(row.unit_price); });
        setCustomerPriceMap(map);
      })
      .catch(() => setCustomerPriceMap({}));
    const terms = c.payment_terms || '';
    const isCharge = !!terms;
    setForm((prev: any) => {
      const next = {
        ...prev,
        customer_id: c.id,
        customer_name: c.customer_name,
        customer_code: c.customer_code || '',
        payment_terms: prev.payment_terms || terms,
        payment_method: prev.payment_method || (isCharge ? 'Charge' : 'Cash'),
        due_date: prev.due_date || (terms ? computeDueDate(invoiceDate, terms) : ''),
      };
      if (prev.items.length === 0) {
        next.items = [blankInvoiceLineItem()];
        setAutoFocusItem(true);
      }
      return next;
    });
  };

  const selectCustomer = (customerId: string, customer?: any) => {
    if (!customerId) {
      setSelectedCustomer(null);
      setCustomerPriceMap({});
      setForm((prev) => ({ ...prev, customer_id: '', customer_name: '', customer_code: '', payment_terms: '', payment_method: 'Cash', due_date: '' }));
      return;
    }
    const c = customer || customers.find((x) => String(x.id) === customerId);
    if (c) {
      applyCustomer(c);
      return;
    }
    api.get(`/customers/${customerId}`)
      .then((res) => applyCustomer(res.data))
      .catch(() => toast.error('Failed to load customer'));
  };

  // === Product search ===
  const handleProductSearch = (value: string) => {
    setProductSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!value.trim()) { setSearchResults([]); setShowSearchResults(false); return; }
    searchTimeoutRef.current = setTimeout(() => {
      const q = value.toLowerCase();
      setSearchResults(products.filter((p: any) => p.is_active !== false && (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q) || p.category_name?.toLowerCase().includes(q))).slice(0, 15));
      setShowSearchResults(true);
    }, 150);
  };

  const selectProduct = async (product: any) => {
    const uoms = await loadLineUoms(product.id);
    const newItem = applySalesUomToLine({
      product_id: product.id, product_name: product.name, sku: product.sku,
      location_id: 1, quantity: 1, available_qty: 0, unit_cost: product.cost || 0,
      discount: 0, tax_type: mapTaxTypeForInvoice(product.tax_type),
    }, uoms, null, product);
    const items = [...form.items, newItem];
    setForm({ ...form, items });
    setProductSearch(''); setSearchResults([]); setShowSearchResults(false);
    const idx = items.length - 1;
    if (product.id) { api.get(`/inventory/product/${product.id}`).then(res => { const locInv = res.data.find((inv: any) => inv.location_id === 1); items[idx].available_qty = locInv ? parseFloat(locInv.quantity) : 0; setForm(prev => ({ ...prev, items: [...items] })); }).catch(() => {}); }
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const updateItem = async (index: number, field: string, value: any) => {
    const items = [...form.items];
    items[index][field] = value;
    if (field === 'product_id' && value) {
      const product = products.find((p) => p.id === value);
      if (product) {
        items[index].unit_cost = product.cost || 0;
        items[index].tax_type = mapTaxTypeForInvoice(product.tax_type);
        const uoms = await loadLineUoms(value);
        Object.assign(items[index], applySalesUomToLine(items[index], uoms, null, product));
      }
      await fetchAvailableQty(items, index);
    }
    if (field === 'uom_id' && value) {
      const product = products.find((p) => p.id === items[index].product_id);
      Object.assign(items[index], applySalesUomToLine(items[index], items[index].uoms || [], parseInt(String(value), 10), product));
    }
    if (field === 'location_id') await fetchAvailableQty(items, index);
    setForm({ ...form, items });
  };

  const fetchAvailableQty = async (items: any[], index: number) => {
    const item = items[index]; if (!item.product_id) return;
    try { const res = await api.get(`/inventory/product/${item.product_id}`); const locInv = res.data.find((i: any) => i.location_id === item.location_id); items[index].available_qty = locInv ? parseFloat(locInv.quantity) : 0; setForm({ ...form, items: [...items] }); } catch {}
  };

  const removeItem = (index: number) => setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) });

  const computeLine = (item: any) => computeInvoiceLine(item, activeInvoiceTaxType, isEmployee ? '0' : ewtRate);

  const totals = form.items.reduce((acc, item) => {
    const c = computeLine(item);
    acc.subtotal += c.gross;
    acc.discount += c.discountAmt;
    acc.vatableSales += c.vatableSales;
    acc.vatExemptSales += c.vatExemptSales;
    acc.zeroRatedSales += c.zeroRatedSales;
    acc.vatAmount += c.vatAmount;
    acc.lguTax += c.lguTax;
    acc.whtAmount += c.whtAmount;
    return acc;
  }, { subtotal: 0, discount: 0, vatableSales: 0, vatExemptSales: 0, zeroRatedSales: 0, vatAmount: 0, lguTax: 0, whtAmount: 0 });
  const amountDue = (totals.subtotal - totals.discount) - totals.lguTax - totals.whtAmount;

  const createInvoice = async () => {
    if (form.items.length === 0) { toast.error('Add at least one item'); return; }
    for (const item of form.items) {
      if (!item.product_id) { toast.error('Select a product for every row'); return; }
      if (parseFloat(String(item.quantity)) <= 0) { toast.error('Quantity must be > 0'); return; }
    }
    try {
      const payload = {
        customer_type: customerType,
        customer_id: customerType === 'Employee' ? undefined : form.customer_id,
        employee_id: customerType === 'Employee' ? form.employee_id : undefined,
        customer_name: selectedCustomer ? selectedCustomer.customer_name : selectedEmployee ? `${selectedEmployee.last_name}, ${selectedEmployee.first_name}` : form.customer_name,
        price_mode: resolveCustomerPriceMode(selectedCustomer), invoice_tax_type: activeInvoiceTaxType,
        items: form.items.map((i: any) => buildInvoiceItemPayload(i)),
        payment_method: form.payment_method, payment_terms: form.payment_terms || undefined, amount_tendered: parseFloat(String(form.amount_tendered)) || 0,
        due_date: form.due_date || undefined, notes: form.notes, terms_conditions: form.terms_conditions,
        ewt_rate: ewtRate,
        so_id: form.so_id || undefined,
        dn_id: form.dn_id || undefined,
        skip_inventory: form.skip_inventory || false,
      };
      if (editingInvoiceId) {
        await api.patch('/sales/invoices/' + editingInvoiceId, payload);
        toast.success('Invoice updated');
      } else {
        const res = await api.post('/sales/invoices', payload);
        toast.success(`Invoice ${res.data.invoice_number} | Total: ${formatCurrency(res.data.total)} | Profit: ${formatCurrency(res.data.gross_profit)} (${res.data.margin_pct}%)`);
      }
      setCreating(false);
      setEditingInvoiceId(null);
      resetForm();
      loadInvoices();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error creating invoice'); }
  };

  const selectEmployee = (empId: string) => {
    if (!empId) { setSelectedEmployee(null); setForm({ ...form, employee_id: '', customer_name: '' }); return; }
    const e = employees.find(x => String(x.id) === empId);
    if (!e) return;
    setSelectedEmployee(e);
    setInvoiceTaxType(NO_VAT_TAX_TYPE);
    setForm({
      ...form,
      employee_id: e.id,
      customer_name: `${e.last_name}, ${e.first_name}`,
      payment_method: 'Salary Deduction',
      payment_terms: 'Salary Deduction',
      amount_tendered: 0,
      items: form.items.map((i: any) => ({ ...i, tax_type: NO_VAT_TAX_TYPE })),
    });
  };

  const resetForm = () => {
    setForm({ customer_id: '', employee_id: '', customer_name: '', items: [], payment_method: 'Cash', amount_tendered: 0, due_date: '', notes: '', terms_conditions: '', payment_terms: '', so_id: '', so_number: '', sq_number: '', dn_id: '', dr_number: '', skip_inventory: false });
    setSelectedCustomer(null); setSelectedEmployee(null); setCustomerType('Customer'); setProductSearch(''); setInvoiceTaxType('VATable'); setEwtRate('0'); setInvoiceDate(new Date().toISOString().split('T')[0]);
    setEditingInvoiceId(null);
    setEditingMeta({});
  };

  const editInvoice = async (invoiceId: string) => {
    try {
      const res = await api.get(`/sales/invoices/${invoiceId}`);
      const inv = res.data;
      setEditingInvoiceId(invoiceId);
      setEditingMeta({ invoice_number: inv.invoice_number, status: inv.status });
      setCustomerType(inv.customer_type || 'Customer');
      if (inv.customer_type === 'Employee') {
        setSelectedEmployee({ id: inv.employee_id, first_name: inv.emp_first_name, last_name: inv.emp_last_name });
      } else if (inv.customer_id) {
        selectCustomer(String(inv.customer_id), {
          id: inv.customer_id,
          customer_name: inv.customer_name,
          customer_code: inv.customer_code,
          address: inv.customer_address,
          tin: inv.customer_tin,
          customer_type: inv.customer_type,
          payment_terms: inv.payment_terms,
        });
      }
      setInvoiceTaxType(inv.tax_type || 'VATable');
      const editItems = (inv.items || []).map((i: any) => ({
        quantity: i.quantity,
        unit_price: i.unit_price,
        discount: i.discount || 0,
        tax_type: i.tax_type || inv.tax_type || 'VATable',
      }));
      setEwtRate(resolveInvoiceEwtRate(inv.ewt_rate, editItems, inv.withholding_tax, inv.tax_type || 'VATable'));
      setInvoiceDate(inv.invoice_date || new Date().toISOString().split('T')[0]);
      setForm({
        customer_id: inv.customer_id || '', employee_id: inv.employee_id || '',
        customer_name: inv.customer_name || '',
        customer_code: inv.customer_code || '',
        items: await Promise.all((inv.items || []).map(async (i: any) => {
          const uoms = i.product_id ? await loadLineUoms(i.product_id) : [];
          const uom = resolveSalesUom(uoms, i.uom_id, null);
          return {
            product_id: i.product_id,
            description: i.description || '',
            quantity: i.entered_qty ?? i.quantity,
            unit_price: i.unit_price,
            discount: i.discount || 0,
            total: i.total,
            location_id: i.location_id,
            tax_type: i.tax_type || inv.tax_type || 'VATable',
            uom_id: i.uom_id || uom?.uom_id || null,
            uoms,
            unit_of_measure: i.uom_code || i.unit_of_measure || uom?.uom_code || 'pc',
            unit_cost: i.cost || 0,
            available_qty: 0,
          };
        })),
        payment_method: inv.payment_method || 'Cash', amount_tendered: 0,
        due_date: inv.due_date || '', notes: inv.notes || '', terms_conditions: inv.terms_conditions || '', payment_terms: inv.payment_terms || '',
      });
      setCreating(true);
    } catch { toast.error('Failed to load invoice'); }
  };

  const viewInvoice = async (id: string) => {
    try { const res = await api.get(`/sales/invoices/${id}`); setViewInv(res.data); setViewing(true); } catch { toast.error('Failed to load invoice'); }
  };

  const viewAttachments = async (id: string) => {
    try {
      const res = await api.get(`/attachments/list/SalesInvoice/${id}`);
      setInvoiceAttachments(res.data || []);
      setShowAttachModal(true);
    } catch { toast.error('Failed to load attachments'); }
  };

  const voidInvoice = async (id: string) => {
    if (!confirm('Void this invoice?')) return;
    try { await api.patch(`/sales/invoices/${id}/void`); toast.success('Invoice voided'); loadInvoices(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error voiding invoice'); }
  };

  useEffect(() => {
    if (!creating) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === 'F8') { e.preventDefault(); createInvoice(); }
      if (e.key === 'Escape') { e.preventDefault(); setCreating(false); resetForm(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [creating, form]);

  const isCharge = form.payment_method === 'Charge' || form.payment_method === 'Salary Deduction';
  const isEmployee = customerType === 'Employee';
  const activeInvoiceTaxType = effectiveInvoiceTaxType(invoiceTaxType, customerType, form.payment_method);

  // ========== FULL-PAGE VIEW (DOT-MATRIX PRINT LAYOUT) ==========
  if (viewing && viewInv) {
    const primary = '#1E40AF';
    const v = viewInv;
    const viewBalance = Math.max(0, parseFloat(v.balance ?? Math.max(0, parseFloat(v.total) - parseFloat(v.amount_paid || 0))) - parseFloat(v.withholding_tax || '0'));
    const canCollectView = viewBalance > 0 && v.customer_type !== 'Employee' && !['Void', 'Cancelled', 'Paid'].includes(v.status) && hasPerm('sales.collections.create');
    const printDoc = () => { printDocument(`/api/sales/invoices/${v.id}/print`); };
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Sales Invoice</h1>
            <span className="text-xs font-mono text-white/80">{v.invoice_number}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${v.status === 'Paid' ? 'bg-green-100 text-green-700' : v.status === 'Void' ? 'bg-gray-200 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>{v.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {canCollectView && (
              <button type="button" onClick={() => navigate(`/collections?invoice=${v.id}`)}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-bold hover:bg-emerald-600">
                <Banknote size={13} /> Collect ₱{viewBalance.toFixed(2)}
              </button>
            )}
            <CopyToMenu sourceType="SI" docId={v.id} doc={v} hasPerm={hasPerm} onNavigate={() => setViewing(false)} />
            <button onClick={printDoc}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)}
              className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/sales/invoices/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow"
            style={{ width: '800px', minHeight: '1100px' }}
            title="Invoice Preview" />
        </div>
      </div>
    );
  }

  // ========== MODERN ERP CREATE VIEW ==========
  if (creating) {
    const totalQty = form.items.reduce((s: number, i: any) => s + parseFloat(String(i.quantity) || '0'), 0);
    const change = parseFloat(String(form.amount_tendered)) - amountDue;
    const primary = '#1E40AF';
    const docStatus = editingMeta.status || 'Draft';
    const previewSi = () => {
      const id = editingInvoiceId || currentInvoiceId;
      if (!id) { toast.error('Save the invoice first to preview'); return; }
      window.open(`/api/sales/invoices/${id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank');
    };

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { setCreating(false); resetForm(); }} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Sales Invoice</h1>
            <span className="text-xs font-mono text-white/80">{editingMeta.invoice_number || (editingInvoiceId ? `#${editingInvoiceId.substring(0, 8)}` : 'NEW')}</span>
            {form.so_number && <span className="text-xs text-white/70">from {form.so_number}</span>}
            {form.dr_number && <span className="text-xs text-white/70">DR {form.dr_number}</span>}
            {editingInvoiceId && <span className="px-2 py-0.5 text-xs rounded-full bg-white/20 text-white">{docStatus}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {editingInvoiceId && (
              <CopyToMenu sourceType="SI" docId={editingInvoiceId} doc={{ id: editingInvoiceId, status: docStatus }} hasPerm={hasPerm} />
            )}
            <button onClick={previewSi} className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30 flex items-center gap-1"><Eye size={13} /> Preview</button>
            <button onClick={createInvoice} disabled={form.items.length === 0}
              className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
              {editingInvoiceId ? 'Update (F8)' : 'Post (F8)'}
            </button>
            <button onClick={() => { setCreating(false); resetForm(); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Customer Information</div>
                <select value={customerType} onChange={(e) => {
                  const nextType = e.target.value;
                  setCustomerType(nextType);
                  setSelectedCustomer(null);
                  setSelectedEmployee(null);
                  const employeeSale = nextType === 'Employee';
                  if (employeeSale) setInvoiceTaxType(NO_VAT_TAX_TYPE);
                  else if (invoiceTaxType === NO_VAT_TAX_TYPE) setInvoiceTaxType('VATable');
                  setForm((prev) => ({
                    ...prev,
                    customer_id: '',
                    employee_id: '',
                    customer_name: '',
                    payment_method: employeeSale ? 'Salary Deduction' : 'Cash',
                    payment_terms: employeeSale ? 'Salary Deduction' : '',
                    amount_tendered: 0,
                    due_date: '',
                    items: employeeSale
                      ? prev.items.map((i: any) => ({ ...i, tax_type: NO_VAT_TAX_TYPE }))
                      : prev.items,
                  }));
                }}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-gray-50 font-medium">
                  <option value="Customer">Regular Customer</option><option value="LGU">LGU / Company</option><option value="Employee">Employee</option>
                </select>
                {isEmployee ? (
                  <select value={form.employee_id} onChange={(e) => selectEmployee(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs">
                    <option value="">Select Employee</option>{employees.map((e: any) => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name}</option>)}
                  </select>
                ) : (
                  <CustomerAutocomplete
                    customers={customers}
                    value={String(form.customer_id || '')}
                    selectedName={formatCustomerLabel(selectedCustomer) || formatCustomerLabel(form) || form.customer_name || ''}
                    onSelect={(c) => {
                      if (!c?.id) selectCustomer('');
                      else selectCustomer(String(c.id), c);
                    }}
                    searchFn={searchCustomers}
                    placeholder="Search customer name or code…"
                  />
                )}
                {selectedCustomer && !isEmployee && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Code</span><span className="font-mono text-gray-700">{selectedCustomer.customer_code || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">TIN</span><span className="text-gray-700">{selectedCustomer.tin || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Type</span><span className="font-medium text-blue-700">{selectedCustomer.customer_type || 'Retail'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Address</span><span className="text-gray-600">{selectedCustomer.address || '—'}</span></div>
                  </div>
                )}
                {selectedEmployee && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Code</span><span className="text-gray-700">{selectedEmployee.employee_code || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Dept</span><span className="text-gray-700">{selectedEmployee.department || '—'}</span></div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Invoice Details</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Invoice Date</label>
                    <input type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); if (form.payment_terms) setForm({ ...form, due_date: computeDueDate(e.target.value, form.payment_terms) }); }}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Due Date</label>
                    <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Terms</label>
                    <select value={form.payment_terms} onChange={(e) => { const v = e.target.value; setForm({ ...form, payment_terms: v, due_date: v ? computeDueDate(invoiceDate, v) : '' }); }}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      <option value="">Cash</option><option value="7">7 Days</option><option value="15">15 Days</option><option value="30">30 Days</option><option value="60">60 Days</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment</label>
                    {isCharge ? (
                      <div className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-amber-50 text-amber-700 font-medium mt-0.5">Charge Account</div>
                    ) : (
                      <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">EWT Rate</label>
                  <div className="flex rounded border overflow-hidden mt-0.5">{['0', '1', '2'].map(rate => (
                    <button key={rate} type="button" onClick={() => setEwtRate(rate)}
                      className={`flex-1 py-1.5 text-xs font-medium ${ewtRate === rate ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      style={ewtRate === rate ? { backgroundColor: primary } : {}}>{rate === '0' ? 'None' : `${rate}%`}</button>
                  ))}</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 280 }}>
              <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                <span className="text-[10px] font-semibold text-gray-500 uppercase">3 · Line Items ({form.items.length})</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">Qty: {totalQty}</span>
                  <button onClick={() => setForm({ ...form, items: [...form.items, blankInvoiceLineItem()] })}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100"><Plus size={12} /> Add Item</button>
                </div>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-2 py-1.5 text-left w-6">#</th>
                      <th className="px-2 py-1.5 text-left" style={{ minWidth: 180 }}>Product</th>
                      <th className="px-2 py-1.5 text-left w-14">Loc</th>
                      <th className="px-2 py-1.5 text-center w-10">Avail</th>
                      <th className="px-2 py-1.5 text-center w-14">Qty</th>
                      <th className="line-uom-col px-2 py-1.5 text-center">UOM</th>
                      <th className="px-2 py-1.5 text-right w-14">Cost</th>
                      <th className="px-2 py-1.5 text-right w-16">Price</th>
                      <th className="px-2 py-1.5 text-center w-12">Disc%</th>
                      <th className="px-2 py-1.5 text-center w-20">Tax</th>
                      <th className="px-2 py-1.5 text-right w-20">Total</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.length === 0 && (
                      <tr><td colSpan={12} className="px-4 py-16 text-center text-gray-300 text-xs">Click Add Item to start</td></tr>
                    )}
                    {form.items.map((item: any, i: number) => {
                      const c = computeLine(item);
                      const product = products.find((p) => p.id === item.product_id);
                      const uom = resolveSalesUom(item.uoms || [], item.uom_id, null);
                      const neededBase = lineBaseQty(item);
                      const stockShort = item.product_id && neededBase > (item.available_qty || 0);
                      return (
                        <tr key={i} className="hover:bg-blue-50/20">
                          <td className="px-2 py-1.5 text-gray-400 text-[10px]">{i + 1}</td>
                          <td className="px-1 py-1">
                            <ProductAutocomplete products={products} value={item.product_id}
                              selectedName={product?.name || item.description || ''} placeholder="Search product..."
                              getPrice={(p) => getPrice(selectedCustomer, p)} searchFn={searchProducts}
                              autoFocus={autoFocusItem && i === 0}
                              onSelect={async (p) => {
                                if (!products.find(x => x.id === p.id)) setProducts(prev => [...prev, p]);
                                const uoms = await loadLineUoms(p.id);
                                const items = [...form.items];
                                items[i] = applySalesUomToLine({
                                  ...items[i],
                                  product_id: p.id,
                                  unit_cost: p.cost || 0,
                                  tax_type: mapTaxTypeForInvoice(p.tax_type),
                                }, uoms, null, p);
                                setForm({ ...form, items });
                                setAutoFocusItem(false);
                                if (p.id) { api.get(`/inventory/product/${p.id}`).then(res => { const locInv = res.data.find((inv: any) => inv.location_id === (item.location_id || 1)); items[i].available_qty = locInv ? parseFloat(locInv.quantity) : 0; setForm(prev => ({ ...prev, items: [...items] })); }).catch(() => {}); }
                                if (i === form.items.length - 1) {
                                  setTimeout(() => {
                                    setForm(prev => ({ ...prev, items: [...prev.items, blankInvoiceLineItem(item.location_id || 1)] }));
                                  }, 100);
                                }
                              }} />
                          </td>
                          <td className="px-1 py-1">
                            <select value={item.location_id} onChange={(e) => updateItem(i, 'location_id', parseInt(e.target.value))}
                              className="w-full px-1 py-1 text-[10px] border border-gray-200 rounded">{LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name.substring(0, 4)}</option>)}</select>
                          </td>
                          <td className={`px-1 py-1 text-center text-[10px] ${stockShort ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                            {item.available_qty || '—'}
                            {uom && (uom.conversion_to_base || 1) > 1 && item.product_id && (
                              <div className="text-[8px]">({neededBase} pc)</div>
                            )}
                          </td>
                          <td className="px-1 py-1">
                            <input type="number" step="any" value={item.quantity}
                              onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs text-center border border-gray-200 rounded" min="0.001" />
                          </td>
                          <td className="line-uom-col px-1 py-1 text-center">
                            {(item.uoms?.length || 0) > 1 ? (
                              <select value={item.uom_id || ''} onChange={(e) => updateItem(i, 'uom_id', parseInt(e.target.value, 10))}
                                className="line-uom-select px-1 py-1 border border-gray-200 rounded text-[10px] uppercase">
                                {(item.uoms || []).map((u: any) => (
                                  <option key={u.uom_id} value={u.uom_id}>{(u.uom_code || '').toUpperCase()}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[10px] uppercase text-gray-400">{(uom?.uom_code || item.unit_of_measure || 'pc').toUpperCase()}</span>
                            )}
                          </td>
                          <td className="px-1 py-1 text-right text-[10px] text-gray-400">{formatCurrency(item.unit_cost || 0)}</td>
                          <td className="px-1 py-1">
                            <input type="number" step="0.01" value={item.unit_price}
                              onChange={(e) => updateItem(i, 'unit_price', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs text-right border border-gray-200 rounded" />
                          </td>
                          <td className="px-1 py-1">
                            <input type="number" step="0.01" value={item.discount}
                              onChange={(e) => updateItem(i, 'discount', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs text-center border border-gray-200 rounded" min="0" max="100" />
                          </td>
                          <td className="px-1 py-1">
                            <select value={item.tax_type || activeInvoiceTaxType} onChange={(e) => updateItem(i, 'tax_type', e.target.value)}
                              disabled={isEmployee}
                              className="w-full px-1 py-1 text-[10px] border border-gray-200 rounded disabled:bg-gray-50">{TAX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-semibold">{formatCurrency(c.total)}</td>
                          <td className="px-1 py-1 text-center">
                            <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500 text-sm leading-none">&times;</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={form.notes || ''}
              termsConditions={form.terms_conditions || ''}
              onNotesChange={(v) => setForm({ ...form, notes: v })}
              onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.SalesInvoice}
              referenceId={editingInvoiceId || currentInvoiceId || ''}
              notesPlaceholder="Payment instructions, delivery notes, or special remarks..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Sales Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1"><span className="text-gray-500">Items</span><span className="font-medium">{form.items.length}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-500">Total Qty</span><span className="font-medium">{totalQty}</span></div>
                <div className="flex justify-between py-1 border-t border-gray-100"><span className="text-gray-500">Subtotal</span><span className="font-medium">{formatCurrency(totals.subtotal)}</span></div>
                {totals.discount > 0 && <div className="flex justify-between py-1"><span className="text-gray-500">Discount</span><span className="font-medium text-red-600">-{formatCurrency(totals.discount)}</span></div>}
                <div className="flex justify-between py-1 border-t pt-2"><span className="text-gray-700 font-semibold">Invoice Amount</span><span className="font-bold text-gray-900">{formatCurrency(totals.subtotal - totals.discount)}</span></div>
                <div className="bg-gray-50 rounded-lg p-2.5 space-y-1.5 mt-2">
                  {totals.vatableSales > 0 && (
                    <div className="flex justify-between"><span className="text-gray-400 text-[10px]">VATable Sales (Net)</span><span className="text-[10px]">{formatCurrency(totals.vatableSales)}</span></div>
                  )}
                  {totals.vatExemptSales > 0 && (
                    <div className="flex justify-between"><span className="text-gray-400 text-[10px]">VAT Exempt Sales</span><span className="text-[10px]">{formatCurrency(totals.vatExemptSales)}</span></div>
                  )}
                  {totals.zeroRatedSales > 0 && (
                    <div className="flex justify-between"><span className="text-gray-400 text-[10px]">Zero Rated Sales</span><span className="text-[10px]">{formatCurrency(totals.zeroRatedSales)}</span></div>
                  )}
                  {totals.vatAmount > 0 && (
                    <div className="flex justify-between"><span className="text-gray-400 text-[10px]">VAT (12%)</span><span className="text-[10px] font-medium">{formatCurrency(totals.vatAmount)}</span></div>
                  )}
                  {totals.lguTax > 0 && <div className="flex justify-between"><span className="text-gray-500 text-[10px]">LGU 5% Tax</span><span className="text-[10px] text-orange-600">-{formatCurrency(totals.lguTax)}</span></div>}
                  <div className="flex justify-between"><span className="text-gray-500 text-[10px]">EWT {ewtRate !== '0' ? `(${ewtRate}%)` : ''}</span><span className={`text-[10px] ${totals.whtAmount > 0 ? 'text-orange-600 font-medium' : 'text-gray-300'}`}>{totals.whtAmount > 0 ? `-${formatCurrency(totals.whtAmount)}` : '—'}</span></div>
                </div>
              </div>
            </div>

            <div className="rounded-lg p-4 text-white" style={{ backgroundColor: primary }}>
              <div className="text-[10px] uppercase opacity-70 font-semibold mb-1">Total Amount Due</div>
              <div className="text-2xl font-bold tracking-tight">{formatCurrency(amountDue)}</div>
            </div>

            {!isCharge && (
              <div className="space-y-1.5">
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Amount Tendered</label>
                  <input type="number" step="0.01" value={form.amount_tendered} onChange={(e) => setForm({ ...form, amount_tendered: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs text-right mt-0.5 focus:outline-none focus:ring-1 focus:ring-blue-200" />
                </div>
                {change > 0 && (
                  <div className="flex justify-between text-xs bg-green-50 border border-green-100 rounded px-2 py-1.5">
                    <span className="text-green-600 font-medium">Change</span>
                    <span className="text-green-600 font-bold">{formatCurrency(change)}</span>
                  </div>
                )}
              </div>
            )}

            {(selectedCustomer || selectedEmployee) && (
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs">
                <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Bill To</div>
                <div className="font-medium text-gray-800">
                  {selectedCustomer?.customer_name || (selectedEmployee ? `${selectedEmployee.last_name}, ${selectedEmployee.first_name}` : '—')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  const filteredInvoices = invoices.filter((inv) => {
    if (!listSearch.trim()) return true;
    const s = listSearch.toLowerCase();
    return inv.invoice_number?.toLowerCase().includes(s)
      || inv.customer_name?.toLowerCase().includes(s)
      || `${inv.emp_last_name || ''} ${inv.emp_first_name || ''}`.toLowerCase().includes(s);
  });
  const overdueCount = invoices.filter((inv) => inv.status === 'Overdue').length;
  const unpaidCount = invoices.filter((inv) => ['Posted', 'Partial', 'Overdue'].includes(inv.status)).length;
  const pageBalance = invoices.reduce((sum, inv) => {
    const bal = Math.max(0, parseFloat(inv.total) - parseFloat(inv.amount_paid) - parseFloat(inv.withholding_tax || '0'));
    return sum + bal;
  }, 0);

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Sales Invoices</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} records</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-2 py-1 rounded text-xs bg-white/20 text-white border border-white/30 outline-none">
            <option value="" className="text-gray-900">All Statuses</option>
            <option value="Paid" className="text-gray-900">Paid</option>
            <option value="Posted" className="text-gray-900">Posted</option>
            <option value="Partial" className="text-gray-900">Partial</option>
            <option value="Overdue" className="text-gray-900">Overdue</option>
            <option value="Deducted" className="text-gray-900">Deducted</option>
            <option value="Void" className="text-gray-900">Void</option>
          </select>
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
            <Plus size={14} /> Create Invoice
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Invoice #, customer…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Invoice History</div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Invoice #</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Due</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">WHT</th>
                      <th className="px-3 py-2 text-right">Paid</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredInvoices.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">No invoices found</td></tr>
                    )}
                    {filteredInvoices.map((inv) => {
                      const wht = parseFloat(inv.withholding_tax || '0');
                      const balance = Math.max(0, parseFloat(inv.balance ?? Math.max(0, parseFloat(inv.total) - parseFloat(inv.amount_paid || 0))) - wht);
                      const canCollect = balance > 0 && inv.customer_type !== 'Employee' && !['Void', 'Cancelled', 'Paid'].includes(inv.status) && hasPerm('sales.collections.create');
                      return (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono font-medium text-blue-700">
                            <span className="cursor-pointer hover:underline" onClick={() => viewInvoice(inv.id)}>{inv.invoice_number}</span>
                            <button onClick={() => viewAttachments(inv.id)} className="ml-1 p-0.5 hover:bg-blue-50 rounded text-blue-600" title="Attachments"><Paperclip size={12} /></button>
                          </td>
                          <td className="px-3 py-2">
                            {inv.customer_type === 'Employee' ? (
                              <span className="text-purple-700 font-medium">{inv.emp_last_name}, {inv.emp_first_name} <span className="text-[10px] text-purple-400">(Employee)</span></span>
                            ) : (inv.customer_name || 'Walk-in')}
                          </td>
                          <td className="px-3 py-2">{formatDate(inv.invoice_date)}</td>
                          <td className="px-3 py-2">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(inv.total)}</td>
                          <td className="px-3 py-2 text-right text-orange-600">{wht > 0 ? `(${formatCurrency(wht)})` : '—'}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(inv.amount_paid)}</td>
                          <td className={`px-3 py-2 text-right ${balance > 0 ? 'text-red-600 font-medium' : ''}`}>{formatCurrency(balance)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] ${INV_STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}>{inv.status}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canCollect && (
                                <button onClick={() => navigate(`/collections?invoice=${inv.id}`)} className="p-1 hover:bg-emerald-50 rounded text-emerald-700" title="Collect payment"><Banknote size={14} /></button>
                              )}
                              <button onClick={() => editInvoice(inv.id)} className="p-1 hover:bg-yellow-50 rounded text-yellow-600" title="Edit"><Edit2 size={14} /></button>
                              <button onClick={() => viewInvoice(inv.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Preview"><Eye size={14} /></button>
                              <CopyToMenu sourceType="SI" docId={inv.id} doc={inv} hasPerm={hasPerm} variant="list" />
                              <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/sales/invoices/${inv.id}/print?token=${token}`, '_blank'); }}
                                className="p-1 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={14} /></button>
                              {inv.status !== 'Void' && inv.status !== 'Deducted' && (
                                <button onClick={() => voidInvoice(inv.id)} className="p-1 hover:bg-red-50 rounded text-red-600" title="Void"><XCircle size={14} /></button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
              </>
            )}
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Unpaid (this page)</div>
            <p className="text-2xl font-bold text-blue-900">{unpaidCount}</p>
            <p className="text-xs text-gray-500 mt-1">Posted, partial, or overdue</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Overdue</div>
            <p className="text-2xl font-bold text-red-700">{overdueCount}</p>
            <p className="text-xs text-gray-500 mt-1">Past due date</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Balance (this page)</div>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(pageBalance)}</p>
            <p className="text-xs text-gray-500 mt-1">Outstanding AR on current page</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed space-y-2">
            <p>Charge invoices are posted to AR. Use Collections to record customer payments.</p>
            {hasPerm('sales.collections.view') && (
              <button type="button" onClick={() => navigate('/collections')} className="w-full py-1.5 bg-blue-700 text-white rounded text-[10px] font-semibold hover:bg-blue-800">
                Open Collections &amp; AR →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Attachment preview modal */}
      {showAttachModal && (
        <ModalOverlay onClose={() => { setShowAttachModal(false); setPreviewAttachFile(null); }} className="z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl flex flex-col w-[600px] max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-sm">Attachments ({invoiceAttachments.length})</h3>
              <button onClick={() => { setShowAttachModal(false); setPreviewAttachFile(null); }}
                className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
            </div>
            {previewAttachFile ? (
              <div className="flex-1 overflow-auto p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium truncate">{previewAttachFile.original_name}</span>
                  <button onClick={() => setPreviewAttachFile(null)}
                    className="text-xs text-blue-600 hover:underline shrink-0 ml-2">Back to list</button>
                </div>
                {previewAttachFile.mime_type?.startsWith('image/') ? (
                  <img src={`/api/attachments/preview/${previewAttachFile.id}?token=${localStorage.getItem('token')}`}
                    alt={previewAttachFile.original_name} className="max-w-full rounded border" />
                ) : previewAttachFile.mime_type?.includes('pdf') ? (
                  <iframe src={`/api/attachments/preview/${previewAttachFile.id}?token=${localStorage.getItem('token')}`}
                    className="w-full h-[70vh] border rounded" title={previewAttachFile.original_name} />
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <p className="mb-3">Preview not available for this file type.</p>
                    <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/attachments/download/${previewAttachFile.id}?token=${t}`, '_blank'); }}
                      className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Download File</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {invoiceAttachments.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No attachments.</p>
                ) : (
                  invoiceAttachments.map((f: any) => (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg hover:bg-gray-100">
                      <span className="text-lg">{f.mime_type?.startsWith('image/') ? '🖼' : f.mime_type?.includes('pdf') ? '📄' : f.mime_type?.includes('word') || f.mime_type?.includes('document') ? '📝' : f.mime_type?.includes('excel') || f.mime_type?.includes('spreadsheet') ? '📊' : '📎'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.original_name}</p>
                        <p className="text-xs text-gray-400">{Math.round(f.file_size / 1024)} KB · {new Date(f.created_at).toLocaleDateString('en-PH')}</p>
                      </div>
                      <button onClick={() => setPreviewAttachFile(f)}
                        className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium">View</button>
                      <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/attachments/download/${f.id}?token=${t}`, '_blank'); }}
                        className="px-3 py-1.5 text-xs bg-gray-200 rounded hover:bg-gray-300">DL</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
