import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  fetchSoCopyToDelivery,
  buildDrFormFromSoCopy,
  buildSelectedCustomerFromSoCopy,
  mapSoItemsForDrGrid,
} from '../../lib/salesCopy';
import CopyToMenu from '../../components/CopyToMenu';
import { printDocument } from '../../lib/printDocument';
import { Plus, Eye, XCircle, Edit2, CheckCircle, ArrowLeft, Printer, FileText, Paperclip, Download, X, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import Pagination from '../../components/Pagination';
import AttachmentPanel from '../../components/AttachmentPanel';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { useAuth } from '../../store/auth';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Posted: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
};

const PRIMARY = '#1E40AF';

const DR_STANDARD_NOTE = `Please Inspect upon delivery.
Report any shortages or damages within 24 hours.
Thank you for your continued support!`;

export default function DeliveryReceipt() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [drs, setDrs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewDr, setViewDr] = useState<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedSo, setSelectedSo] = useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [soItems, setSoItems] = useState<any[]>([]);
  const [drForm, setDrForm] = useState<any>({ so_id: '', delivery_date: new Date().toISOString().split('T')[0], delivery_address: '', driver_name: '', vehicle_plate: '', dispatch_notes: '', notes: DR_STANDARD_NOTE, terms_conditions: '', items: [] });
  const [loading, setLoading] = useState(false);
  const [pickSoModal, setPickSoModal] = useState(false);
  const [pickSoList, setPickSoList] = useState<any[]>([]);
  const [pickSoSearch, setPickSoSearch] = useState('');
  const [attachModal, setAttachModal] = useState<{ open: boolean; dr: any; files: any[] }>({ open: false, dr: null, files: [] });
  const [search, setSearch] = useState('');
  const [editingMeta, setEditingMeta] = useState<{ dr_number?: string; status?: string }>({});

  const loadDrs = () => {
    api.get(`/delivery-notes?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}`)
      .then(r => { setDrs(r.data.data || []); setTotal(r.data.total || 0); }).catch(() => {});
  };

  useEffect(() => { loadDrs(); }, [page, statusFilter]);
  useEffect(() => {
    api.get('/customers?limit=500').then(r => setCustomers(r.data?.data || r.data || [])).catch(() => {});
  }, []);

  const applySoCopyPayload = useCallback((payload: any, autoSelectAll = true) => {
    setSelectedSo(payload.order || {
      id: payload.source_so_id,
      so_number: payload.source_so_number,
      customer_name: payload.customer_name,
      sq_number: payload.source_sq_number,
    });
    setSoItems(mapSoItemsForDrGrid(payload.items));
    setDrForm(prev => ({
      ...prev,
      ...buildDrFormFromSoCopy(payload, autoSelectAll),
      delivery_date: new Date().toISOString().split('T')[0],
      notes: prev.notes?.trim() || DR_STANDARD_NOTE,
    }));
    setSelectedCustomer(buildSelectedCustomerFromSoCopy(payload, customers));
  }, [customers]);

  const loadSoItems = useCallback(async (soId: string, autoSelectAll = true) => {
    try {
      const payload = await fetchSoCopyToDelivery(soId);
      applySoCopyPayload(payload, autoSelectAll);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Error loading sales order');
    }
  }, [applySoCopyPayload]);

  useEffect(() => {
    if (!creating || customers.length === 0 || !drForm.so_id) return;
    setSelectedCustomer(prev => {
      if (!prev?.id) return prev;
      const fromList = customers.find((x: any) => String(x.id) === String(prev.id));
      return fromList || prev;
    });
  }, [customers, creating, drForm.so_id]);

  useEffect(() => {
    const soId = searchParams.get('so_id');
    if (!soId) return;
    const copyKey = `dr-so:${soId}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    setEditingId(null);
    setSelectedSo(null);
    setSelectedCustomer(null);
    setSoItems([]);
    setDrForm({ so_id: soId, delivery_date: new Date().toISOString().split('T')[0], delivery_address: '', driver_name: '', vehicle_plate: '', dispatch_notes: '', notes: DR_STANDARD_NOTE, terms_conditions: '', items: [] });
    setCreating(true);
    loadSoItems(soId, true).finally(() => endCopyNavigation(copyKey));
  }, [searchParams, setSearchParams, loadSoItems]);

  const toggleDrItem = (soItem: any) => {
    setDrForm(prev => {
      const exists = prev.items.find((i: any) => i.order_item_id === soItem.id);
      if (exists) {
        return { ...prev, items: prev.items.filter((i: any) => i.order_item_id !== soItem.id) };
      }
      return {
        ...prev,
        items: [...prev.items, {
          order_item_id: soItem.id,
          product_name: soItem.product_name,
          remaining: soItem.remaining_qty,
          quantity: soItem.deliver_qty,
        }],
      };
    });
  };

  const updateDrQty = (orderItemId: string, qty: string | number) => {
    setDrForm(prev => ({
      ...prev,
      items: prev.items.map((i: any) => i.order_item_id === orderItemId ? { ...i, quantity: qty } : i),
    }));
  };

  const openPickSoModal = async () => {
    try {
      const r = await api.get('/sales-orders?limit=200');
      const data = r.data.data || [];
      setPickSoList(data.filter((so: any) => !['Draft', 'Cancelled', 'Closed', 'Fully Delivered', 'Invoiced'].includes(so.status)));
      setPickSoSearch('');
      setPickSoModal(true);
    } catch {
      toast.error('Failed to load orders');
    }
  };

  const selectSo = async (so: any) => {
    await loadSoItems(so.id, true);
    setPickSoModal(false);
    toast.success(`Loaded SO ${so.so_number}`);
  };

  const openCreate = () => {
    setEditingId(null);
    setEditingMeta({});
    setDrForm({ so_id: '', delivery_date: new Date().toISOString().split('T')[0], delivery_address: '', driver_name: '', vehicle_plate: '', dispatch_notes: '', notes: DR_STANDARD_NOTE, terms_conditions: '', items: [] });
    setSelectedSo(null);
    setSelectedCustomer(null);
    setSoItems([]);
    setCreating(true);
    openPickSoModal();
  };

  const openEdit = async (id: string) => {
    try {
      const r = await api.get(`/delivery-notes/${id}`);
      const dr = r.data;
      setEditingId(id);
      setEditingMeta({ dr_number: dr.dr_number, status: dr.status });
      setDrForm({ so_id: dr.so_id, delivery_date: dr.delivery_date || '', delivery_address: dr.delivery_address || '', driver_name: dr.driver_name || '', vehicle_plate: dr.vehicle_plate || '', dispatch_notes: dr.dispatch_notes || '', notes: dr.notes || DR_STANDARD_NOTE, terms_conditions: dr.terms_conditions || '', items: (dr.items || []).map((i: any) => ({ order_item_id: i.order_item_id, product_name: i.product_name, quantity: parseFloat(i.quantity) })) });
      setSelectedSo({ customer_name: dr.customer_name, so_number: dr.so_number });
      setSoItems((dr.items || []).map((i: any) => {
        const qty = parseFloat(String(i.quantity));
        const extra = i.soi_delivered ? parseFloat(String(i.ordered_qty)) - parseFloat(String(i.soi_delivered)) : 0;
        return { id: i.order_item_id, product_name: i.product_name, remaining_qty: qty + extra, deliver_qty: qty };
      }));
      setCreating(true);
    } catch { toast.error('Failed to load'); }
  };

  const saveDr = async () => {
    if (!drForm.so_id || !drForm.items.length) { toast.error('Select SO and at least one item'); return; }
    const today = new Date().toISOString().split('T')[0];
    const payload = editingId ? drForm : { ...drForm, delivery_date: today };
    setLoading(true);
    try {
      if (editingId) {
        await api.put(`/delivery-notes/${editingId}`, payload);
        toast.success('DR updated');
      } else {
        await api.post('/delivery-notes', payload);
        toast.success('DR created');
      }
      setCreating(false);
      loadDrs();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };

  const postDr = async (id: string) => {
    try { await api.patch(`/delivery-notes/${id}/post`); toast.success('Posted'); loadDrs(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const cancelDr = async (id: string) => {
    if (!confirm('Cancel this delivery receipt? This will reverse SO delivery updates.')) return;
    try { await api.patch(`/delivery-notes/${id}/cancel`); toast.success('Cancelled'); loadDrs(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewDetail = async (id: string) => {
    try { const r = await api.get(`/delivery-notes/${id}`); setViewDr(r.data); setViewing(true); }
    catch { toast.error('Failed to load'); }
  };

  const openAttachments = async (dr: any) => {
    try {
      const r = await api.get(`/attachments/list/DeliveryNote/${dr.id}`);
      setAttachModal({ open: true, dr, files: r.data || [] });
    } catch { toast.error('Failed to load attachments'); }
  };

  // ========== FULL-PAGE VIEW (DOT-MATRIX PRINT LAYOUT) ==========
  if (viewing && viewDr) {
    const primary = '#1E40AF';
    const v = viewDr;
    const printDoc = () => { printDocument(`/api/delivery-notes/${v.id}/print`); };
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Delivery Receipt</h1>
            <span className="text-xs font-mono text-white/80">{v.dr_number || v.dn_number}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}`}>{v.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CopyToMenu sourceType="DR" docId={v.id} doc={v} hasPerm={hasPerm} onNavigate={() => setViewing(false)} />
            <button onClick={printDoc}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)}
              className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/delivery-notes/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow"
            style={{ width: '800px', minHeight: '1100px' }}
            title="Delivery Receipt Preview" />
        </div>
      </div>
    );
  }

  // ========== MODERN ERP CREATE/EDIT VIEW ==========
  if (creating) {
    const totalDrQty = drForm.items.reduce((s: number, i: any) => s + parseFloat(i.quantity || 0), 0);
    const primary = '#1E40AF';
    const docStatus = editingMeta.status || 'Draft';

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Delivery Receipt</h1>
            <span className="text-xs font-mono text-white/80">{editingMeta.dr_number || (editingId ? `#${editingId.substring(0, 8)}` : 'NEW')}</span>
            {selectedSo?.so_number && <span className="text-xs text-white/70">SO {selectedSo.so_number}</span>}
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[docStatus] || 'bg-gray-200 text-gray-700'}`}>{docStatus}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {editingId && docStatus === 'Posted' && (
              <CopyToMenu sourceType="DR" docId={editingId} doc={{ id: editingId, status: docStatus }} hasPerm={hasPerm} />
            )}
            {editingId && (
              <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/delivery-notes/${editingId}/print?token=${token}`, '_blank'); }}
                className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30 flex items-center gap-1"><Eye size={13} /> Preview</button>
            )}
            {editingId && hasPerm('sales.delivery-receipt.approve') && docStatus === 'Draft' && (
              <button onClick={() => postDr(editingId)} className="px-3 py-1.5 bg-white/20 text-white text-xs rounded hover:bg-white/30 font-medium">Post</button>
            )}
            <button onClick={saveDr} disabled={loading || !drForm.items.length}
              className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
              {editingId ? 'Update' : 'Save Receipt'}
            </button>
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Sales Order &amp; Customer</div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Sales Order</label>
                  <div className="mt-0.5 space-y-1.5">
                    {selectedSo?.so_number ? (
                      <>
                        <div className="px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-blue-50 text-blue-800 font-medium">{selectedSo.so_number} — {selectedSo.customer_name}</div>
                        {!editingId && (
                          <button type="button" onClick={openPickSoModal}
                            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Change Sales Order</button>
                        )}
                      </>
                    ) : !editingId ? (
                      <button type="button" onClick={openPickSoModal}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded border border-dashed border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 w-full justify-center">
                        <FileText size={14} /> Select Sales Order
                      </button>
                    ) : (
                      <div className="px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-gray-50 text-gray-400">No SO linked</div>
                    )}
                  </div>
                </div>
                {selectedCustomer && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                    <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Customer</span><span className="font-medium text-gray-800">{selectedCustomer.customer_name || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Code</span><span className="text-gray-700">{selectedCustomer.customer_code || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">TIN</span><span className="text-gray-700">{selectedCustomer.tin || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Address</span><span className="text-gray-600">{selectedCustomer.address || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Phone</span><span className="text-gray-700">{selectedCustomer.phone || '—'}</span></div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Delivery Details</div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Delivery Date</label>
                  <input type="date" value={drForm.delivery_date || new Date().toISOString().split('T')[0]} readOnly
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs mt-0.5 bg-gray-50 text-gray-700 cursor-not-allowed" />
                  <p className="text-[9px] text-gray-400 mt-0.5">Set automatically on save</p>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Delivery Address</label>
                  <input type="text" value={drForm.delivery_address} onChange={e => setDrForm({ ...drForm, delivery_address: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" placeholder="Delivery address..." />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Driver</label>
                  <input type="text" value={drForm.driver_name || ''} onChange={e => setDrForm({ ...drForm, driver_name: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" placeholder="Driver name" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Vehicle Plate</label>
                  <input type="text" value={drForm.vehicle_plate || ''} onChange={e => setDrForm({ ...drForm, vehicle_plate: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" placeholder="ABC 1234" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Dispatch Notes</label>
                  <input type="text" value={drForm.dispatch_notes || ''} onChange={e => setDrForm({ ...drForm, dispatch_notes: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" placeholder="Route, time window, site contact..." />
                </div>
                {drForm.sq_number && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">SQ Reference</label>
                    <input type="text" value={drForm.sq_number} readOnly className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-gray-50 font-mono mt-0.5" />
                  </div>
                )}
              </div>
            </div>

            {soItems.length > 0 ? (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 240 }}>
                <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase">3 · Line Items ({soItems.length} available)</span>
                  <span className="text-[10px] text-gray-400">Selected: {drForm.items.length} · Qty: {totalDrQty}</span>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left">Product</th>
                        <th className="px-3 py-2 text-center w-24">Remaining</th>
                        <th className="px-3 py-2 text-center w-28">Deliver Qty</th>
                        <th className="w-24"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {soItems.map((item: any) => {
                        const drItem = drForm.items.find((i: any) => i.order_item_id === item.id);
                        const isSelected = !!drItem;
                        return (
                          <tr key={item.id} className={isSelected ? 'bg-blue-50/40' : ''}>
                            <td className="px-3 py-2 font-medium text-xs">{item.product_name || item.description}</td>
                            <td className="px-3 py-2 text-center text-xs">{parseFloat(item.remaining_qty || 0)}</td>
                            <td className="px-3 py-2 text-center">
                              {isSelected ? (
                                <input type="number" step="0.01" min="0.01" max={item.remaining_qty} value={drItem.quantity}
                                  onChange={e => updateDrQty(item.id, e.target.value)}
                                  className="w-20 px-2 py-1 border border-gray-200 rounded text-xs text-center" />
                              ) : <span className="text-gray-400 text-xs">—</span>}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button onClick={() => toggleDrItem(item)}
                                className={`px-2.5 py-1 text-[10px] rounded font-medium ${isSelected ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'}`}>
                                {isSelected ? 'Remove' : 'Add'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400 text-sm space-y-3">
                <p>Select a Sales Order to load deliverable items</p>
                {!editingId && (
                  <button type="button" onClick={openPickSoModal}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100">
                    <FileText size={14} /> Select Sales Order
                  </button>
                )}
              </div>
            )}

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={drForm.notes || ''}
              termsConditions={drForm.terms_conditions || ''}
              onNotesChange={(v) => setDrForm({ ...drForm, notes: v })}
              onTermsChange={(v) => setDrForm({ ...drForm, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.DeliveryNote}
              referenceId={editingId || ''}
              notesPlaceholder="Delivery notes, inspection reminders, or special instructions..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Delivery Summary</div>
              <div className="space-y-2 text-xs">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">SO Reference</div>
                  <div className="font-mono text-gray-800">{selectedSo?.so_number || '—'}</div>
                </div>
                {drForm.sq_number && (
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase font-semibold">SQ Reference</div>
                    <div className="font-mono text-gray-800">{drForm.sq_number}</div>
                  </div>
                )}
                <div className="flex justify-between py-1 border-t border-gray-100">
                  <span className="text-gray-500">Items Selected</span>
                  <span className="font-medium">{drForm.items.length}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-500">Total Qty</span>
                  <span className="font-medium">{totalDrQty}</span>
                </div>
              </div>
            </div>

            {(selectedCustomer || selectedSo?.customer_name) && (
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs">
                <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Deliver To</div>
                <div className="font-medium text-gray-800">{selectedCustomer?.customer_name || selectedSo?.customer_name}</div>
                <div className="text-gray-500 mt-1">{drForm.delivery_address || selectedCustomer?.address || '—'}</div>
              </div>
            )}
          </div>
        </div>

        {pickSoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="font-semibold text-sm">Select Sales Order</h3>
                <button onClick={() => setPickSoModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
              </div>
              <div className="px-4 py-2 border-b">
                <input type="text" value={pickSoSearch} onChange={e => setPickSoSearch(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs" placeholder="Search by SO# or customer..." />
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {pickSoList.filter((s: any) => !pickSoSearch || s.so_number.toLowerCase().includes(pickSoSearch.toLowerCase()) || (s.customer_name || '').toLowerCase().includes(pickSoSearch.toLowerCase())).length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-6">No matching orders found.</p>
                )}
                {pickSoList.filter((s: any) => !pickSoSearch || s.so_number.toLowerCase().includes(pickSoSearch.toLowerCase()) || (s.customer_name || '').toLowerCase().includes(pickSoSearch.toLowerCase())).map((s: any) => (
                  <div key={s.id} onClick={() => selectSo(s)}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-blue-50 cursor-pointer">
                    <div>
                      <span className="text-xs font-mono font-semibold text-blue-700">{s.so_number}</span>
                      <span className="text-xs text-gray-500 ml-2">{s.customer_name || '—'}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      <span className="font-medium text-gray-700">{formatCurrency(s.total)}</span>
                      <span className="ml-2 text-gray-400">Rem: {parseFloat(s.total_remaining_qty || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========== LIST VIEW ==========
  const filtered = drs.filter((dr) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return dr.dr_number?.toLowerCase().includes(s)
      || dr.so_number?.toLowerCase().includes(s)
      || dr.customer_name?.toLowerCase().includes(s);
  });
  const draftCount = drs.filter((dr) => dr.status === 'Draft').length;
  const postedCount = drs.filter((dr) => dr.status === 'Posted').length;

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Delivery Receipts</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} records</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-2 py-1 rounded text-xs bg-white/20 text-white border border-white/30 outline-none">
            <option value="" className="text-gray-900">All Status</option>
            <option value="Draft" className="text-gray-900">Draft</option>
            <option value="Posted" className="text-gray-900">Posted</option>
            <option value="Cancelled" className="text-gray-900">Cancelled</option>
          </select>
          {hasPerm('sales.delivery-receipt.create') && (
            <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
              <Plus size={14} /> New Delivery
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="DR #, SO ref, customer…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Delivery History</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">DR #</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">SO Ref</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-center">Qty</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-center">Files</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No delivery receipts</td></tr>
                )}
                {filtered.map((dr) => (
                  <tr key={dr.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewDetail(dr.id)}>{dr.dr_number}</td>
                    <td className="px-3 py-2">{formatDate(dr.delivery_date)}</td>
                    <td className="px-3 py-2 font-mono text-gray-600">{dr.so_number || '—'}</td>
                    <td className="px-3 py-2 font-medium">{dr.customer_name}</td>
                    <td className="px-3 py-2 text-center">{parseFloat(dr.total_qty || 0)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_COLORS[dr.status] || 'bg-gray-100 text-gray-700'}`}>{dr.status}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => openAttachments(dr)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Attachments"><Paperclip size={14} /></button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => viewDetail(dr.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View"><Eye size={14} /></button>
                        <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/delivery-notes/${dr.id}/print?token=${token}`, '_blank'); }}
                          className="p-1 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={14} /></button>
                        {dr.status === 'Draft' && hasPerm('sales.delivery-receipt.edit') && (
                          <button onClick={() => openEdit(dr.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Edit"><Edit2 size={14} /></button>
                        )}
                        {dr.status === 'Draft' && hasPerm('sales.delivery-receipt.approve') && (
                          <button onClick={() => postDr(dr.id)} className="p-1 hover:bg-green-50 rounded text-green-600" title="Post"><CheckCircle size={14} /></button>
                        )}
                        {dr.status === 'Posted' && <CopyToMenu sourceType="DR" docId={dr.id} doc={dr} hasPerm={hasPerm} variant="list" />}
                        {dr.status === 'Posted' && hasPerm('sales.delivery-receipt.edit') && (
                          <button onClick={() => cancelDr(dr.id)} className="p-1 hover:bg-red-50 rounded text-red-600" title="Cancel"><XCircle size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={Math.ceil(total / 20)} total={total} limit={20} onPageChange={setPage} />
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Draft Deliveries</div>
            <p className="text-2xl font-bold text-blue-900">{draftCount}</p>
            <p className="text-xs text-gray-500 mt-1">Awaiting post</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Posted</div>
            <p className="text-2xl font-bold text-green-700">{postedCount}</p>
            <p className="text-xs text-gray-500 mt-1">Ready to copy to invoice</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed">
            Workflow: Pick Sales Order → Enter delivered qty → Post DR → Copy to Sales Invoice.
          </div>
        </div>
      </div>

      {/* Attachment Modal */}
      {attachModal.open && attachModal.dr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Attachments — {attachModal.dr.dr_number}</h3>
              <button onClick={() => setAttachModal({ open: false, dr: null, files: [] })} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {attachModal.files.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No attachments.</p>
              ) : attachModal.files.map((f: any) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <Paperclip size={16} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{f.original_name}</p>
                    <p className="text-[10px] text-gray-400">{f.file_size ? `${(f.file_size / 1024).toFixed(1)} KB` : ''} · {f.created_at ? new Date(f.created_at).toLocaleDateString('en-PH') : ''}</p>
                  </div>
                  <button onClick={() => window.open(`/api/attachments/preview/${f.id}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank')}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">View</button>
                  <button onClick={() => window.open(`/api/attachments/download/${f.id}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank')}
                    className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"><Download size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
