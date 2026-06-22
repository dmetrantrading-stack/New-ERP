import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Edit2, Search, Trash2, FileText, X, Upload, Download, Package } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function SupplierList() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState<any>(null);
  const [form, setForm] = useState<any>({ supplier_name: '', contact_person: '', address: '', phone: '', email: '', payment_terms: '', tin: '' });
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { api.get(`/suppliers?search=${search}&page=${page}&limit=${limit}`).then((r) => { setSuppliers(r.data.data); setTotal(r.data.total); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false)); }, [search, page]);

  const openCreate = () => { setEditSupplier(null); setForm({ supplier_name: '', contact_person: '', address: '', phone: '', email: '', payment_terms: '', tin: '' }); setShowModal(true); };
  const openEdit = (s: any) => { setEditSupplier(s); setForm(s); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;
    try { await api.delete(`/suppliers/${id}`); toast.success('Supplier deleted'); setSuppliers(suppliers.filter(s => s.id !== id)); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.supplier_name) { toast.error('Supplier name is required'); return; }
    try {
      if (editSupplier) { await api.put(`/suppliers/${editSupplier.id}`, form); toast.success('Updated'); }
      else { await api.post('/suppliers', form); toast.success('Created'); }
      setShowModal(false);
      const res = await api.get(`/suppliers?search=${search}&page=${page}&limit=${limit}`); setSuppliers(res.data.data); setTotal(res.data.total);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const exportSuppliers = (format: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/suppliers/export?format=${format}&token=${token}`, '_blank');
    setShowExportDropdown(false);
  };
  const downloadTemplate = () => {
    const token = localStorage.getItem('token');
    window.open(`/api/suppliers/export/template?token=${token}`, '_blank');
  };
  const handlePreview = async () => {
    if (!importFile) { toast.error('Select a file'); return; }
    setImportPreview(null); setImportResult(null); setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/suppliers/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportPreview(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Preview failed'); }
    setImporting(false);
  };
  const handleExecuteImport = async () => {
    if (!importFile) return;
    if (!window.confirm(`Import ${importPreview?.valid_rows || 0} suppliers? Rows with errors will be skipped.`)) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/suppliers/import/execute', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(res.data);
      setImportPreview(null);
      if (res.data.imported > 0 || res.data.updated > 0) {
        const r = await api.get(`/suppliers?search=${search}&page=${page}&limit=${limit}`); setSuppliers(r.data.data); setTotal(r.data.total);
        toast.success(`Imported ${res.data.imported} new, updated ${res.data.updated}`);
      }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Import failed'); }
    setImporting(false);
  };

  const viewLedger = async (supplierId: number) => {
    setLoadingLedger(true);
    try {
      const res = await api.get(`/suppliers/${supplierId}/ledger`);
      setLedgerData(res.data);
      setShowLedger(true);
    } catch { toast.error('Failed to load ledger'); }
    finally { setLoadingLedger(false); }
  };

  const viewPOs = (supplierId: number) => {
    navigate(`/purchases?supplier=${supplierId}`);
  };

  const viewCatalog = (supplierId: number) => {
    navigate(`/suppliers/${supplierId}/catalog`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
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
                <button onClick={() => exportSuppliers('csv')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100">
                  Export as CSV
                </button>
                <button onClick={() => exportSuppliers('xlsx')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">
                  Export as Excel
                </button>
              </div>
            )}
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Supplier</button>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Phone</th><th>POs</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="font-mono text-xs">{s.supplier_code}</td>
                <td className="font-medium">
                  <button onClick={() => viewPOs(s.id)} className="text-blue-600 hover:underline text-left">
                    {s.supplier_name}
                  </button>
                </td>
                <td>{s.contact_person || '-'}</td>
                <td>{s.phone || '-'}</td>
                <td className="text-center font-medium">{s.po_count || 0}</td>
                <td className={s.balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(s.balance)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div className="flex gap-1">
                    <button onClick={() => viewCatalog(s.id)} className="p-1.5 hover:bg-amber-50 rounded text-amber-700" title="Low Stock Catalog"><Package size={15} /></button>
                    <button onClick={() => viewLedger(s.id)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="View Ledger"><FileText size={15} /></button>
                    <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                    <button onClick={() => handleDelete(s.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No suppliers found</td></tr>}
          </tbody>
        </table>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editSupplier ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Supplier Name *</label>
                  <input type="text" value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
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
                <div><label className="block text-sm font-medium mb-1">Payment Terms</label>
                  <input type="text" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">TIN</label>
                  <input type="text" value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Import modal */}
      {showImportModal && (
        <ModalOverlay onClose={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Import Suppliers</h2>
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
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Supplier Name</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Contact Person</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Phone</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Payment Terms</th>
                          <th className="px-2 py-2 text-center font-semibold text-gray-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.rows?.map((r: any) => (
                          <tr key={r.row} className={r.has_errors ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-2 py-1.5 text-gray-400">{r.row}</td>
                            <td className="px-2 py-1.5 font-medium">{r.supplier_name || '-'}</td>
                            <td className="px-2 py-1.5">{r.contact_person || '-'}</td>
                            <td className="px-2 py-1.5">{r.phone || '-'}</td>
                            <td className="px-2 py-1.5">{r.payment_terms || '-'}</td>
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
                      {importing ? 'Importing...' : `Import ${importPreview.valid_rows} Suppliers`}
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

      {/* Supplier Ledger Modal */}
      {showLedger && ledgerData && (
        <ModalOverlay onClose={() => setShowLedger(false)}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">{ledgerData.supplier.supplier_name}</h2>
                  <p className="text-xs text-gray-500">{ledgerData.supplier.supplier_code} · Balance: {formatCurrency(ledgerData.supplier.balance)}</p>
                </div>
                <button onClick={() => setShowLedger(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {ledgerData.ledger.map((row: any, i: number) => (
                      <tr key={i} className="text-sm">
                        <td className="text-xs">{formatDate(row.date)}</td>
                        <td>
                          <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                            row.type === 'Purchase Order' ? 'bg-blue-50 text-blue-700' :
                            row.type === 'Goods Receipt' ? 'bg-green-50 text-green-700' :
                            row.type === 'Payment' ? 'bg-amber-50 text-amber-700' :
                            'bg-red-50 text-red-700'
                          }`}>{row.type}</span>
                        </td>
                        <td className="font-mono text-xs">{row.ref_no}</td>
                        <td className="text-right text-red-600">{row.debit > 0 ? formatCurrency(row.debit) : '—'}</td>
                        <td className="text-right text-green-600">{row.credit > 0 ? formatCurrency(row.credit) : '—'}</td>
                        <td className="text-right font-mono text-xs">{formatCurrency(row.running_balance)}</td>
                        <td className="text-xs">{row.status}</td>
                      </tr>
                    ))}
                    {ledgerData.ledger.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-gray-500">No transactions</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-right text-sm font-bold">
                Balance: <span className={ledgerData.running_balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(ledgerData.running_balance)}</span>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
