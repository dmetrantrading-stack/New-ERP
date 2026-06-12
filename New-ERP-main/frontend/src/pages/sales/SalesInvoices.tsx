import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate, PAYMENT_METHODS, PRICE_MODES } from '../../lib/utils';
import { Plus, Eye, XCircle, Printer, Search, ArrowLeft, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

const LOCATIONS = [{ id: 1, name: 'Store' }, { id: 2, name: 'Warehouse' }];
const TAX_TYPES = ['VATable', 'VAT Exempt', 'Zero Rated', 'LGU 5% Final VAT'];

export default function SalesInvoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvoice, setShowInvoice] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [priceMode, setPriceMode] = useState<'Retail' | 'Wholesale' | 'Distributor'>('Retail');
  const [invoiceTaxType, setInvoiceTaxType] = useState('VATable');
  const [ewtRate, setEwtRate] = useState('0');
  const [customerType, setCustomerType] = useState('Customer');
  const [form, setForm] = useState<any>({ customer_id: '', employee_id: '', items: [], payment_method: 'Cash', amount_tendered: 0, due_date: '', notes: '', payment_terms: '' });
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);

  const loadInvoices = () => { api.get('/sales/invoices').then((res) => setInvoices(res.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load')).finally(() => setLoading(false)); };

  useEffect(() => {
    loadInvoices();
    loadCustomers();
    api.get('/hr/employees').then((res) => setEmployees(res.data)).catch(() => {});
    api.get('/products?limit=500').then((res) => setProducts(res.data.data)).catch(() => {});
  }, []);

  const loadCustomers = () => {
    api.get('/customers?limit=500')
      .then((r) => {
        const list = r.data.data || r.data || [];
        setCustomers(Array.isArray(list) ? list : []);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load customers'));
  };

  const filteredInvoices = invoices.filter((inv) => !statusFilter || inv.status === statusFilter);

  const viewInvoice = async (id: string) => {
    try { const res = await api.get(`/sales/invoices/${id}`); setShowInvoice(res.data); } catch { toast.error('Error loading invoice'); }
  };

  const computeDueDate = (date: string, terms: string) => {
    if (!date || !terms) return '';
    const d = parseInt(terms);
    if (isNaN(d)) return '';
    const dt = new Date(date);
    dt.setDate(dt.getDate() + d);
    return dt.toISOString().split('T')[0];
  };

  const selectCustomer = (customerId: string) => {
    if (!customerId) {
      setSelectedCustomer(null);
      setForm({ ...form, customer_id: '', customer_name: '', payment_terms: '', payment_method: 'Cash', due_date: '' });
      return;
    }
    const c = customers.find(x => String(x.id) === customerId);
    if (!c) return;
    setSelectedCustomer(c);
    const terms = c.payment_terms || '';
    const isCharge = !!terms;
    setForm(prev => ({ ...prev, customer_id: c.id, customer_name: c.customer_name, payment_terms: terms, payment_method: isCharge ? 'Charge' : prev.payment_method, due_date: terms ? computeDueDate(invoiceDate, terms) : '' }));
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

  const selectProduct = (product: any) => {
    const price = priceMode === 'Retail' ? product.retail_price : priceMode === 'Wholesale' ? product.wholesale_price : product.distributor_price;
    const newItem = { product_id: product.id, product_name: product.name, sku: product.sku, variant_id: '', location_id: 1, quantity: 1, available_qty: 0, unit_cost: product.cost || 0, unit_price: price || 0, unit_of_measure: product.unit_of_measure || '', discount: 0, tax_type: invoiceTaxType, variants: product.variants || [] };
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
        const price = priceMode === 'Retail' ? product.retail_price : priceMode === 'Wholesale' ? product.wholesale_price : product.distributor_price;
        items[index].unit_price = price || 0; items[index].unit_cost = product.cost || 0; items[index].unit_of_measure = product.unit_of_measure || ''; items[index].variant_id = ''; items[index].variants = product.variants || [];
      }
      await fetchAvailableQty(items, index);
    }
    if (field === 'location_id') await fetchAvailableQty(items, index);
    setForm({ ...form, items });
  };

  const fetchAvailableQty = async (items: any[], index: number) => {
    const item = items[index]; if (!item.product_id) return;
    try { const res = await api.get(`/inventory/product/${item.product_id}`); const locInv = res.data.find((i: any) => i.location_id === item.location_id); items[index].available_qty = locInv ? parseFloat(locInv.quantity) : 0; setForm({ ...form, items: [...items] }); } catch {}
  };

  const removeItem = (index: number) => setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) });

  const computeLine = (item: any) => {
    const qty = parseFloat(String(item.quantity)) || 0;
    const price = parseFloat(String(item.unit_price)) || 0;
    const disc = parseFloat(String(item.discount)) || 0;
    const gross = qty * price;
    const discountAmt = gross * (disc / 100);
    const netAfterDisc = gross - discountAmt;
    const taxType = item.tax_type || invoiceTaxType;
    let vatAmount = 0, lguTax = 0, whtAmount = 0, vatableSales = 0;
    if (taxType === 'VATable' || taxType === 'VAT') {
      vatableSales = netAfterDisc / 1.12; vatAmount = netAfterDisc - vatableSales;
      if (parseFloat(ewtRate) > 0) whtAmount = vatableSales * (parseFloat(ewtRate) / 100);
    }
    else if (taxType === 'VAT Exempt') {
      if (parseFloat(ewtRate) > 0) whtAmount = netAfterDisc * (parseFloat(ewtRate) / 100);
    }
    else if (taxType === 'LGU 5% Final VAT' || taxType === 'LGU') { const netOfVat = netAfterDisc / 1.12; vatAmount = netAfterDisc - netOfVat; lguTax = netOfVat * 0.05; whtAmount = netOfVat * 0.01; vatableSales = netOfVat; }
    return { gross, discountAmt, netAfterDisc, vatAmount, lguTax, whtAmount, vatableSales, total: netAfterDisc };
  };

  const totals = form.items.reduce((acc, item) => {
    const c = computeLine(item);
    acc.subtotal += c.gross; acc.discount += c.discountAmt; acc.vatableSales += c.vatableSales; acc.vatAmount += c.vatAmount; acc.lguTax += c.lguTax; acc.whtAmount += c.whtAmount;
    return acc;
  }, { subtotal: 0, discount: 0, vatableSales: 0, vatAmount: 0, lguTax: 0, whtAmount: 0 });
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
        customer_name: selectedCustomer?.customer_name || selectedEmployee ? `${selectedEmployee?.last_name}, ${selectedEmployee?.first_name}` : form.customer_name,
        price_mode: priceMode, invoice_tax_type: invoiceTaxType,
        items: form.items.map((i: any) => ({ product_id: i.product_id, variant_id: i.variant_id || undefined, quantity: parseFloat(String(i.quantity)), unit_price: parseFloat(String(i.unit_price)), discount: parseFloat(String(i.discount)), location_id: i.location_id, tax_type: i.tax_type || invoiceTaxType })),
        payment_method: form.payment_method, payment_terms: form.payment_terms || undefined, amount_tendered: parseFloat(String(form.amount_tendered)) || 0,
        due_date: form.due_date || undefined, notes: form.notes,
        ewt_rate: ewtRate,
      };
      const res = await api.post('/sales/invoices', payload);
      toast.success(`Invoice ${res.data.invoice_number} | Total: ${formatCurrency(res.data.total)} | Profit: ${formatCurrency(res.data.gross_profit)} (${res.data.margin_pct}%)`); setCreating(false); resetForm(); loadInvoices();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error creating invoice'); }
  };

  const selectEmployee = (empId: string) => {
    if (!empId) { setSelectedEmployee(null); setForm({ ...form, employee_id: '', customer_name: '' }); return; }
    const e = employees.find(x => String(x.id) === empId);
    if (!e) return;
    setSelectedEmployee(e);
    setForm({ ...form, employee_id: e.id, customer_name: `${e.last_name}, ${e.first_name}`, payment_method: 'Salary Deduction', payment_terms: 'Salary Deduction', amount_tendered: 0 });
  };

  const resetForm = () => {
    setForm({ customer_id: '', employee_id: '', customer_name: '', items: [], payment_method: 'Cash', amount_tendered: 0, due_date: '', notes: '', payment_terms: '' });
    setSelectedCustomer(null); setSelectedEmployee(null); setCustomerType('Customer'); setProductSearch(''); setInvoiceTaxType('VATable'); setPriceMode('Retail'); setEwtRate('0'); setInvoiceDate(new Date().toISOString().split('T')[0]);
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

  // ========== FULL-SCREEN CREATE VIEW ==========
  if (creating) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50">
        {/* Header Bar */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => { setCreating(false); resetForm(); }} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
            <h1 className="text-lg font-bold text-gray-900">New Sales Invoice</h1>
            <span className="font-mono text-base font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded">SI-{new Date().getFullYear()}-######</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>F8: Post Invoice</span><span>|</span><span>Esc: Cancel</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Info Row */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Invoice Date</label>
              <input type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); if (form.payment_terms) setForm({ ...form, due_date: computeDueDate(e.target.value, form.payment_terms) }); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Price Mode</label>
              <div className="flex mt-1 rounded-lg border border-gray-300 overflow-hidden">
                {PRICE_MODES.map((m) => <button key={m} type="button" onClick={() => setPriceMode(m as any)}
                  className={`flex-1 px-2 py-2 text-xs font-medium ${priceMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>{m}</button>)}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Payment Method</label>
              {isEmployee
                ? <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-purple-50 text-purple-700 font-medium">Salary Deduction</div>
                : isCharge
                ? <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-amber-50 text-amber-700 font-medium">Charge Account</div>
                : <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              }
            </div>
          </div>

          {/* Customer / Employee Section */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-5 gap-4 mb-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Customer Type *</label>
                <select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setSelectedCustomer(null); setSelectedEmployee(null); setForm({ ...form, customer_id: '', employee_id: '', customer_name: '', payment_method: e.target.value === 'Employee' ? 'Salary Deduction' : 'Cash', payment_terms: e.target.value === 'Employee' ? 'Salary Deduction' : '', amount_tendered: 0, due_date: '' }); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1">
                  <option value="Customer">Regular Customer</option>
                  <option value="LGU">LGU / Company</option>
                  <option value="Employee">Employee</option>
                </select>
              </div>
              {isEmployee ? (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Employee *</label>
                  <select value={form.employee_id} onChange={(e) => selectEmployee(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1">
                    <option value="">Select Employee</option>
                    {employees.map((e: any) => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name} ({e.employee_code})</option>)}
                  </select>
                </div>
              ) : (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Customer *</label>
                  <select value={form.customer_id} onChange={(e) => selectCustomer(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1">
                    <option value="">Select Customer</option>
                    {customers.map((c: any) => <option key={c.id} value={c.id}>{c.customer_name}{c.customer_code ? ` (${c.customer_code})` : ''}</option>)}
                  </select>
                </div>
              )}
              {selectedEmployee && <>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">Code</label><input type="text" value={selectedEmployee.employee_code || ''} readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" /></div>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">Department</label><input type="text" value={selectedEmployee.department || '-'} readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" /></div>
              </>}
              {selectedCustomer && !isEmployee && <>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">Customer Code</label><input type="text" value={selectedCustomer.customer_code || ''} readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" /></div>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">TIN</label><input type="text" value={selectedCustomer.tin || ''} readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" /></div>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">Payment Terms</label><input type="text" value={form.payment_terms || '-'} readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" /></div>
              </>}
            </div>
            {selectedCustomer && selectedCustomer.address && (
              <div className="mt-2 text-xs text-gray-500">{selectedCustomer.address}{selectedCustomer.contact_person ? ` · ${selectedCustomer.contact_person}` : ''}{selectedCustomer.contact_number ? ` · ${selectedCustomer.contact_number}` : ''}</div>
            )}
          </div>

          {/* EWT / Tax Settings */}
          {priceMode === 'Retail' && (
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-semibold text-gray-500 uppercase">EWT Rate:</span>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                {['0', '1', '2'].map(rate => (
                  <button key={rate} type="button" onClick={() => setEwtRate(rate)}
                    className={`px-3 py-1.5 text-xs font-medium ${ewtRate === rate ? 'bg-orange-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {rate === '0' ? 'None' : `${rate}%`}
                  </button>
                ))}
              </div>
              {ewtRate !== '0' && (
                <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                  {ewtRate}% EWT will be deducted from amount due
                </span>
              )}
            </div>
          )}

          {/* Items Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase">
                    <th className="px-2 py-2 text-left w-5">#</th>
                    <th className="px-2 py-2 text-left">Product</th>
                    <th className="px-2 py-2 text-left w-24">Variant</th>
                    <th className="px-2 py-2 text-left w-20">Location</th>
                    <th className="px-2 py-2 text-center w-12">Avail</th>
                    <th className="px-2 py-2 text-center w-20">Qty</th>
                    <th className="px-2 py-2 text-center w-12">Unit</th>
                    <th className="px-2 py-2 text-right w-20">Cost</th>
                    <th className="px-2 py-2 text-right w-24">Price</th>
                    <th className="px-2 py-2 text-center w-14">Disc%</th>
                    <th className="px-2 py-2 text-right w-20">Disc Amt</th>
                    <th className="px-2 py-2 text-center w-20">Tax Type</th>
                    <th className="px-2 py-2 text-right w-20">VAT</th>
                    <th className="px-2 py-2 text-right w-24">Total</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.items.map((item: any, i: number) => {
                    const c = computeLine(item);
                    const product = products.find((p) => p.id === item.product_id);
                    const variants = item.variants || product?.variants || [];
                    return (
                      <tr key={i} className="hover:bg-blue-50/30">
                        <td className="px-2 py-1.5 text-xs text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <select value={item.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded text-xs"><option value="">Select</option>{products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select>
                        </td>
                        <td className="px-2 py-1.5"><select value={item.variant_id || ''} onChange={(e) => updateItem(i, 'variant_id', e.target.value)} disabled={variants.length === 0} className="w-full px-2 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"><option value="">—</option>{variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></td>
                        <td className="px-2 py-1.5"><select value={item.location_id} onChange={(e) => updateItem(i, 'location_id', parseInt(e.target.value))} className="w-full px-2 py-1 border border-gray-200 rounded text-xs">{LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></td>
                        <td className="px-2 py-1.5 text-center text-xs"><span className={item.available_qty <= 0 ? 'text-red-500 font-medium' : 'text-gray-500'}>{item.available_qty}</span></td>
                        <td className="px-2 py-1.5"><input type="number" step="any" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-center" min="0.001" /></td>
                        <td className="px-2 py-1.5 text-center text-xs text-gray-500">{item.unit_of_measure || '—'}</td>
                        <td className="px-2 py-1.5 text-right text-xs text-gray-500">{formatCurrency(item.unit_cost || 0)}</td>
                        <td className="px-2 py-1.5"><input type="number" step="0.01" value={item.unit_price} onChange={(e) => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-right" /></td>
                        <td className="px-2 py-1.5"><input type="number" step="0.01" value={item.discount} onChange={(e) => updateItem(i, 'discount', parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-center" min="0" max="100" /></td>
                        <td className="px-2 py-1.5 text-right text-xs text-gray-500">{c.discountAmt > 0 ? formatCurrency(c.discountAmt) : '—'}</td>
                        <td className="px-2 py-1.5"><select value={item.tax_type || invoiceTaxType} onChange={(e) => updateItem(i, 'tax_type', e.target.value)} className="w-full px-1 py-1 border border-gray-200 rounded text-[10px]">{TAX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                        <td className="px-2 py-1.5 text-right text-xs text-gray-500">{c.vatAmount > 0 ? formatCurrency(c.vatAmount) : '—'}</td>
                        <td className="px-2 py-1.5 text-right text-xs font-semibold">{formatCurrency(c.total)}</td>
                        <td className="px-2 py-1.5 text-center"><button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 font-bold">&times;</button></td>
                      </tr>
                    );
                  })}
                  {form.items.length === 0 && (
                    <tr><td colSpan={15} className="px-4 py-12 text-center text-gray-400 text-sm">Click "Add Item" below to start adding products.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <button onClick={() => { const newItem = { product_id: '', variant_id: '', location_id: 1, quantity: 1, available_qty: 0, unit_cost: 0, unit_price: 0, unit_of_measure: '', discount: 0, tax_type: invoiceTaxType, variants: [] }; setForm({ ...form, items: [...form.items, newItem] }); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 mb-4">
            <Plus size={14} /> Add Item</button>

          {/* Notes */}
          <div className="mb-4 max-w-md">
            <label className="text-xs font-semibold text-gray-500 uppercase">Notes</label>
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Payment terms, delivery instructions..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" />
          </div>

          {/* Invoice Totals - Right aligned below table */}
          <div className="flex justify-end">
            <div className="bg-white border border-gray-200 rounded-lg p-4 w-80">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">{formatCurrency(totals.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="font-medium text-red-600">{formatCurrency(totals.discount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">VATable Sales</span><span className="font-medium">{formatCurrency(totals.vatableSales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span className="font-medium">{formatCurrency(totals.vatAmount)}</span></div>
              {totals.lguTax > 0 && <div className="flex justify-between"><span className="text-gray-500">LGU Final VAT 5%</span><span className="font-medium text-orange-600">{formatCurrency(totals.lguTax)}</span></div>}
              {totals.whtAmount > 0 && <div className="flex justify-between"><span className="text-gray-500">EWT {ewtRate !== '0' ? `${ewtRate}%` : '(1%)'}</span><span className="font-medium text-orange-600">-{formatCurrency(totals.whtAmount)}</span></div>}
              {totals.whtAmount > 0 && <div className="flex justify-between border-t border-gray-200 pt-2"><span className="font-bold text-gray-700">Amount Due (Net of EWT)</span><span className="font-bold text-lg text-gray-900">{formatCurrency(amountDue)}</span></div>}
              {totals.whtAmount <= 0 && <div className="flex justify-between border-t border-gray-200 pt-2"><span className="font-bold text-gray-700">Amount Due</span><span className="font-bold text-lg text-gray-900">{formatCurrency(amountDue)}</span></div>}
            </div>
          </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">{form.items.length} items &middot; {form.items.reduce((s: number, i: any) => s + parseFloat(String(i.quantity) || '0'), 0)} qty</div>
          <div className="flex items-center gap-4">
            {!isCharge && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-500 uppercase">Tendered</label>
                <input type="number" step="0.01" value={form.amount_tendered} onChange={(e) => setForm({ ...form, amount_tendered: e.target.value })}
                  className="w-36 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right" />
                {parseFloat(String(form.amount_tendered)) > amountDue && (
                  <span className="text-xs text-green-600 font-medium">Change: {formatCurrency(parseFloat(String(form.amount_tendered)) - amountDue)}</span>
                )}
              </div>
            )}
            <button onClick={() => { setCreating(false); resetForm(); }} className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100">Cancel</button>
            <button onClick={createInvoice} disabled={form.items.length === 0} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Post Invoice (F8)</button>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sales Invoices</h1>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Create Invoice</button>
      </div>

      <div className="flex items-center gap-2">
        <Search size={16} className="text-gray-400" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="">All Statuses</option>
          <option value="Paid">Paid</option><option value="Posted">Posted</option><option value="Partial">Partial</option><option value="Overdue">Overdue</option><option value="Deducted">Deducted</option><option value="Void">Void</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {filteredInvoices.map((inv) => (
              <tr key={inv.id}>
                <td className="font-mono text-xs">{inv.invoice_number}</td>
                <td>
                  {inv.customer_type === 'Employee' ? (
                    <span className="text-purple-700 font-medium">{inv.emp_last_name}, {inv.emp_first_name} <span className="text-xs text-purple-400">(Employee)</span></span>
                  ) : (inv.customer_name || 'Walk-in')}
                </td>
                <td className="text-xs">{formatDate(inv.invoice_date)}</td>
                <td className="text-xs">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                <td>{formatCurrency(inv.total)}</td><td>{formatCurrency(inv.amount_paid)}</td>
                <td className={inv.balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(inv.balance)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${inv.status === 'Paid' ? 'bg-green-100 text-green-700' : inv.status === 'Posted' ? 'bg-blue-100 text-blue-700' : inv.status === 'Overdue' ? 'bg-red-100 text-red-700' : inv.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : inv.status === 'Deducted' ? 'bg-purple-100 text-purple-700' : inv.status === 'Void' ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-700'}`}>{inv.status}</span></td>
                <td>
                  <div className="flex gap-1">
                    {inv.status !== 'Void' && inv.status !== 'Paid' && inv.status !== 'Deducted' && inv.customer_type !== 'Employee' && inv.balance > 0 && (
                      <button onClick={() => navigate(`/collections?invoice=${inv.id}`)} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Collect Payment"><DollarSign size={15} /></button>
                    )}
                    <button onClick={() => viewInvoice(inv.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Preview"><Eye size={15} /></button>
                    <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/sales/invoices/${inv.id}/print?token=${token}`, '_blank'); }} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={15} /></button>
                    {inv.status !== 'Void' && inv.status !== 'Deducted' && <button onClick={() => voidInvoice(inv.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Void"><XCircle size={15} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowInvoice(null)}>
          <div className="bg-white rounded-xl shadow-2xl flex flex-col w-[95vw] max-w-none max-h-[95vh]" onClick={(e) => e.stopPropagation()}>
            {/* Top bar */}
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-gray-200 bg-gray-50 rounded-t-xl">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Sales Invoice Preview</h2>
                <p className="text-xs text-gray-500">{showInvoice.invoice_number} · {showInvoice.customer_name || 'Walk-in'}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/sales/invoices/${showInvoice.id}/print?token=${token}`, '_blank'); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"><Printer size={13} /> Print</button>
                <button onClick={() => setShowInvoice(null)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-xs font-medium hover:bg-gray-100">Close</button>
              </div>
            </div>
            {/* Scrollable body showing full A4 invoice */}
            <div className="flex-1 overflow-y-auto bg-gray-100 p-4 flex justify-center">
              <iframe
                src={`/api/sales/invoices/${showInvoice.id}/print?token=${localStorage.getItem('token')}`}
                className="border border-gray-300 bg-white shadow"
                style={{ width: '794px', height: '1123px', minHeight: '1123px' }}
                title="Invoice Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
