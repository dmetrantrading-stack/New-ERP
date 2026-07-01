import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, parseNumericField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Plus, Edit2, Search, Trash2, Upload, Download, FileText, X, Tag } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function CustomerList() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [form, setForm] = useState<any>({ customer_name: '', contact_person: '', address: '', phone: '', email: '', customer_type: 'Retail', default_price_mode: '', credit_limit: '', payment_terms: '', tax_type: 'VAT', tin: '', loyalty_points: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [priceCustomer, setPriceCustomer] = useState<any>(null);
  const [priceRows, setPriceRows] = useState<any[]>([]);
  const [priceProducts, setPriceProducts] = useState<any[]>([]);
  const [priceSaving, setPriceSaving] = useState(false);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { api.get(`/customers?search=${search}&page=${page}&limit=${limit}`).then((r) => { setCustomers(r.data.data); setTotal(r.data.total); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false)); }, [search, page]);

  const openCreate = () => { setEditCustomer(null); setForm({ customer_name: '', contact_person: '', address: '', phone: '', email: '', customer_type: 'Retail', default_price_mode: '', credit_limit: '', payment_terms: '', tax_type: 'VAT', tin: '', loyalty_points: '' }); setShowModal(true); };
  const openEdit = (c: any) => { setEditCustomer(c); setForm({ ...c, loyalty_points: c.loyalty_points ?? 0 }); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    try { await api.delete(`/customers/${id}`); toast.success('Customer deleted'); setCustomers(customers.filter(c => c.id !== id)); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.customer_name) { toast.error('Customer name is required'); return; }
    try {
      if (editCustomer) {
        const payload: any = { ...form, credit_limit: parseNumericField(form.credit_limit), default_price_mode: form.default_price_mode || null };
        if (form.loyalty_points !== '' && form.loyalty_points != null) {
          payload.loyalty_points = Math.max(0, parseInt(String(form.loyalty_points), 10) || 0);
        }
        await api.put(`/customers/${editCustomer.id}`, payload);
        toast.success('Updated');
      }
      else { await api.post('/customers', { ...form, credit_limit: parseNumericField(form.credit_limit), default_price_mode: form.default_price_mode || null }); toast.success('Created'); }
      setShowModal(false);
      const res = await api.get(`/customers?search=${search}&page=${page}&limit=${limit}`); setCustomers(res.data.data); setTotal(res.data.total);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openPriceList = async (c: any) => {
    setPriceCustomer(c);
    try {
      const [prices, prods] = await Promise.all([
        api.get(`/customers/${c.id}/prices`),
        api.get('/products?limit=500'),
      ]);
      setPriceRows(prices.data || []);
      setPriceProducts(prods.data.data || []);
    } catch {
      toast.error('Failed to load prices');
    }
  };

  const addPriceRow = () => {
    setPriceRows((rows) => [...rows, { product_id: '', unit_price: '', effective_from: '', effective_to: '' }]);
  };

  const savePrices = async () => {
    if (!priceCustomer) return;
    setPriceSaving(true);
    try {
      const prices = priceRows.filter((r) => r.product_id && r.unit_price !== '');
      await api.put(`/customers/${priceCustomer.id}/prices`, { prices });
      toast.success('Prices saved');
      setPriceCustomer(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setPriceSaving(false);
    }
  };

  const exportCustomers = (format: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/customers/export?format=${format}&token=${token}`, '_blank');
    setShowExportDropdown(false);
  };
  const downloadTemplate = () => {
    const token = localStorage.getItem('token');
    window.open(`/api/customers/export/template?token=${token}`, '_blank');
  };
  const handlePreview = async () => {
    if (!importFile) { toast.error('Select a file'); return; }
    setImportPreview(null); setImportResult(null); setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/customers/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportPreview(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Preview failed'); }
    setImporting(false);
  };
  const handleExecuteImport = async () => {
    if (!importFile) return;
    if (!window.confirm(`Import ${importPreview?.valid_rows || 0} customers? Rows with errors will be skipped.`)) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/customers/import/execute', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(res.data);
      setImportPreview(null);
      if (res.data.imported > 0 || res.data.updated > 0) {
        const r = await api.get(`/customers?search=${search}&page=${page}&limit=${limit}`); setCustomers(r.data.data); setTotal(r.data.total);
        toast.success(`Imported ${res.data.imported} new, updated ${res.data.updated}`);
      }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Import failed'); }
    setImporting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            <Upload size={16} /> Import
          </button>
          <div className="relative">
            <button onClick={() => setShowExportDropdown(!showExportDropdown)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              <Download size={16} /> Export
            </button>
            {showExportDropdown && (
              <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-40">
                <button onClick={() => exportCustomers('csv')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100">
                  Export as CSV
                </button>
                <button onClick={() => exportCustomers('xlsx')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">
                  Export as Excel
                </button>
              </div>
            )}
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Customer</button>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Phone</th><th>Terms</th><th>Credit Limit</th><th>Balance</th><th>Loyalty Pts</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.customer_code}</td>
                <td className="font-medium">{c.customer_name}</td>
                <td><span className="px-2 py-0.5 text-xs rounded bg-gray-100">{c.customer_type}</span></td>
                <td>{c.phone || '-'}</td>
                <td className="text-xs">{c.payment_terms ? `${c.payment_terms} Days` : '—'}</td>
                <td>{formatCurrency(c.credit_limit)}</td>
                <td className={c.balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(c.balance)}</td>
                <td className="font-mono text-xs">{parseInt(String(c.loyalty_points ?? 0), 10) || 0}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openPriceList(c)} title="Price list" className="p-1.5 hover:bg-purple-50 rounded text-purple-600"><Tag size={15} /></button>
                      <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
      </div>
      {/* Import modal */}
      {showImportModal && (
        <ModalOverlay onClose={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Import Customers</h2>
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              {importResult ? (
                <div>
                  <div className="flex items-center gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium">Results:</span>
                    <span className="text-sm text-green-700 font-medium bg-green-50 px-3 py-1 rounded">{importResult.imported} created</span>
                    {importResult.updated > 0 && <span className="text-sm text-blue-700 font-medium bg-blue-50 px-3 py-1 rounded">{importResult.updated} updated</span>}
                    {importResult.errors?.length > 0 && <span className="text-sm text-red-700 font-medium bg-red-50 px-3 py-1 rounded">{importResult.errors.length} errors</span>}
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
                      {importResult.errors.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{e.row > 0 ? `Row ${e.row}: ` : ''}{e.message}</p>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Done</button>
                </div>
              ) : importPreview ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{importPreview.file_name}</span>
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{importPreview.valid_rows} valid</span>
                      {(() => {
                        const creates = importPreview.rows?.filter((r: any) => r.action === 'Create').length || 0;
                        const updates = importPreview.rows?.filter((r: any) => r.action === 'Update').length || 0;
                        return <><span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{creates} to create</span><span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">{updates} to update</span></>;
                      })()}
                      {importPreview.error_rows > 0 && <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">{importPreview.error_rows} errors</span>}
                    </div>
                    <button onClick={() => setImportPreview(null)} className="text-xs text-blue-600 hover:underline">Back to file upload</button>
                  </div>
                  <div className="max-h-80 overflow-auto border border-gray-200 rounded-lg mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Customer Name</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Contact Person</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Phone</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Customer Type</th>
                          <th className="px-2 py-2 text-center font-semibold text-gray-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.rows?.map((r: any) => (
                          <tr key={r.row} className={r.has_errors ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-2 py-1.5 text-gray-400">{r.row}</td>
                            <td className="px-2 py-1.5 font-medium">{r.customer_name || '-'}</td>
                            <td className="px-2 py-1.5">{r.contact_person || '-'}</td>
                            <td className="px-2 py-1.5">{r.phone || '-'}</td>
                            <td className="px-2 py-1.5">{r.customer_type || '-'}</td>
                            <td className="px-2 py-1.5 text-center">
                              {r.has_errors ? <span className="text-red-600 font-medium" title={r.errors?.join('; ')}>Error</span>
                                : <span className={`font-medium ${r.action === 'Update' ? 'text-blue-600' : 'text-green-600'}`}>{r.action}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importPreview.errors?.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 mb-3">
                      {importPreview.errors.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1 rounded">{e.row > 0 ? `Row ${e.row}: ` : ''}{e.message}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setImportPreview(null); setImportFile(null); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handleExecuteImport} disabled={importing || importPreview.valid_rows === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {importing ? 'Importing...' : `Import ${importPreview.valid_rows} Customers`}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f && (f.name.endsWith('.csv') || f.name.endsWith('.xlsx'))) setImportFile(f);
                      else toast.error('Please select a CSV or Excel file');
                    }}>
                    {importFile ? (
                      <div>
                        <FileText size={32} className="mx-auto text-blue-500 mb-2" />
                        <p className="text-sm font-medium text-gray-700">{importFile.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{(importFile.size / 1024).toFixed(1)} KB</p>
                        <button onClick={() => setImportFile(null)} className="text-xs text-red-500 hover:underline mt-2">Remove</button>
                      </div>
                    ) : (
                      <div>
                        <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-500">Drag & drop a CSV or Excel file here, or</p>
                        <label className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded text-sm cursor-pointer hover:bg-blue-700">
                          Browse Files
                          <input type="file" accept=".csv,.xlsx" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }} />
                        </label>
                        <p className="text-xs text-gray-400 mt-2">CSV or Excel (.xlsx) up to 10MB</p>
                      </div>
                    )}
                  </div>
                  <button onClick={downloadTemplate} className="text-xs text-blue-600 hover:underline mb-4 inline-block">
                    Download import template
                  </button>
                  <div className="flex justify-end gap-3 mt-4">
                    <button onClick={() => { setShowImportModal(false); setImportFile(null); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handlePreview} disabled={!importFile || importing}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {importing ? 'Reading file...' : 'Preview Import'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editCustomer ? 'Edit Customer' : 'Add Customer'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Customer Name *</label>
                  <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Contact Person</label>
                  <input type="text" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Phone</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Address</label>
                  <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} /></div>
                <div><label className="block text-sm font-medium mb-1">Customer Type</label>
                  <select value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Retail">Retail</option><option value="Wholesale">Wholesale</option><option value="LGU">LGU</option>
                    <option value="Corporate">Corporate</option><option value="Mining">Mining</option><option value="Resort">Resort</option>
                    <option value="Distributor">Distributor</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Default Price Mode</label>
                  <select value={form.default_price_mode || ''} onChange={(e) => setForm({ ...form, default_price_mode: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Auto (from segment)</option>
                    <option value="Retail">Retail</option>
                    <option value="Wholesale">Wholesale</option>
                    <option value="Distributor">Distributor</option>
                  </select>
                  <p className="text-[10px] text-gray-400 mt-0.5">LGU / Mining / Corporate default to Wholesale when blank.</p>
                </div>
                <div><label className="block text-sm font-medium mb-1">Tax Type</label>
                  <select value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="VAT">VAT 12%</option><option value="VAT Exempt">VAT Exempt</option><option value="Zero Rated">Zero Rated</option>
                    <option value="LGU 5% Final VAT">LGU 5% Final VAT</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Payment Terms (Days)</label>
                  <select value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">COD / Walk-in</option>
                    <option value="7">7 Days</option><option value="15">15 Days</option><option value="30">30 Days</option>
                    <option value="45">45 Days</option><option value="60">60 Days</option><option value="90">90 Days</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Credit Limit</label>
                  <NumericInput value={form.credit_limit} onValueChange={(credit_limit) => setForm({ ...form, credit_limit })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">TIN</label>
                  <input type="text" value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                {editCustomer && (
                  <div><label className="block text-sm font-medium mb-1">Loyalty Points</label>
                    <input type="number" min={0} step={1} value={form.loyalty_points ?? 0}
                      onChange={(e) => setForm({ ...form, loyalty_points: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <p className="text-[10px] text-gray-400 mt-0.5">Manual adjustment writes to loyalty ledger.</p>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
      {priceCustomer && (
        <ModalOverlay onClose={() => setPriceCustomer(null)}>
          <div className="modal-content max-w-3xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Price List — {priceCustomer.customer_name}</h2>
                <button onClick={() => setPriceCustomer(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <p className="text-xs text-gray-500 mb-3">Custom prices override retail/wholesale on sales invoices for this customer.</p>
              <div className="max-h-96 overflow-auto border rounded-lg mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Product</th>
                      <th className="text-right px-3 py-2 w-32">Unit Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceRows.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">
                          <select className="w-full border rounded px-2 py-1 text-sm" value={row.product_id}
                            onChange={(e) => { const rows = [...priceRows]; rows[i] = { ...rows[i], product_id: e.target.value }; setPriceRows(rows); }}>
                            <option value="">Select product</option>
                            {priceProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <NumericInput value={row.unit_price} onValueChange={(v) => { const rows = [...priceRows]; rows[i] = { ...rows[i], unit_price: v }; setPriceRows(rows); }}
                            className="w-full border rounded px-2 py-1 text-sm text-right" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between">
                <button onClick={addPriceRow} className="text-sm text-blue-600">+ Add price</button>
                <div className="flex gap-2">
                  <button onClick={() => setPriceCustomer(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                  <button onClick={savePrices} disabled={priceSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">{priceSaving ? 'Saving…' : 'Save Prices'}</button>
                </div>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
