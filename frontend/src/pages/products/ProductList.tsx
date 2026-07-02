import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, generateBarcode } from '../../lib/utils';
import { validateProductForm, isOnlyReorderLevelChanged, PRIMARY } from '../../lib/productsUtils';
import {
  findBaseUomFromCatalog,
  findProductBaseRowIndex,
  getProductBaseUomId,
  isProductBaseRow,
  normalizeProductUomRows,
  normalizeUomCode,
} from '../../lib/uomUtils';
import ProductUomPanel, { pricesFromBasePc, ProductFormSection } from './ProductUomPanel';
import { useAuth } from '../../store/auth';
import { Plus, Search, Edit2, Eye, Download, Upload, ToggleLeft, Barcode, Trash2, FileText, X, Loader2, Package, TrendingUp, Printer, ArrowLeft } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono = false, highlight = false }: { label: string; value: React.ReactNode; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs' : ''} ${highlight ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{value}</span>
    </div>
  );
}

function MetricCard({ label, value, sub, tone = 'gray' }: { label: string; value: string; sub?: string; tone?: 'gray' | 'green' | 'red' | 'blue' | 'purple' }) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-50 border-gray-200 text-gray-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-bold mt-0.5 truncate">{value}</p>
      {sub && <p className="text-xs opacity-70 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

const EMPTY_FORM = {
  name: '', barcode: '', category_id: '', brand_id: '', unit_of_measure: 'pc', description: '',
  cost: 0, retail_price: 0, wholesale_price: 0, distributor_price: 0, reorder_level: 0, tax_type: 'VAT', price_type: 'VAT Inclusive',
  retail_markup: 0, wholesale_markup: 0, distributor_markup: 0,
  has_chilled_variant: false, chilled_price: 0,
  allow_multiple_uom: true, track_batch: true, track_expiry: true,
  _manualRetail: false, _manualWholesale: false, _manualDistributor: false,
};

const DEFAULT_UOM_ROW = (prices: { cost: number; retail: number; wholesale: number; distributor: number; barcode?: string }) => ([{
  uom_id: 0,
  uom_code: 'pc',
  conversion_to_base: 1,
  barcode: prices.barcode || '',
  purchase_price: prices.cost,
  retail_price: prices.retail,
  wholesale_price: prices.wholesale,
  distributor_price: prices.distributor,
  is_default_purchase: true,
  is_default_sales: true,
}]);

export default function ProductList({ embedded = false, onChanged, onFormOpenChange }: { embedded?: boolean; onChanged?: () => void; onFormOpenChange?: (open: boolean) => void }) {
  const { hasPerm, hasAnyPerm } = useAuth();
  const showPriceType = hasAnyPerm(['pos.view', 'pos.write']);
  const canCreate = hasPerm('inventory.inventory.create');
  const canEdit = hasPerm('inventory.inventory.edit');
  const canExport = hasPerm('inventory.inventory.export');
  const readOnly = !canCreate && !canEdit;
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState<any>(null);

  useEffect(() => {
    onFormOpenChange?.(showForm);
  }, [showForm, onFormOpenChange]);

  useEffect(() => () => {
    onFormOpenChange?.(false);
  }, [onFormOpenChange]);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [detailProduct, setDetailProduct] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'details' | 'price-history'>('details');
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [priceComparison, setPriceComparison] = useState<any>(null);
  const [phLoading, setPhLoading] = useState(false);
  const [phFilterSupplier, setPhFilterSupplier] = useState('');
  const [phDateFrom, setPhDateFrom] = useState('');
  const [phDateTo, setPhDateTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const [uomConversions, setUomConversions] = useState<any[]>(DEFAULT_UOM_ROW({ cost: 0, retail: 0, wholesale: 0, distributor: 0 }));

  // Auto-calculate prices when cost or markup changes
  useEffect(() => {
    const cost = parseFloat(form.cost) || 0;
    const rm = parseFloat(form.retail_markup);
    const wm = parseFloat(form.wholesale_markup);
    const dm = parseFloat(form.distributor_markup);
    if (!form._manualRetail && !isNaN(rm)) {
      setForm((f: any) => ({ ...f, retail_price: Math.round(cost * (1 + rm / 100) * 100) / 100 }));
    }
    if (!form._manualWholesale && !isNaN(wm)) {
      setForm((f: any) => ({ ...f, wholesale_price: Math.round(cost * (1 + wm / 100) * 100) / 100 }));
    }
    if (!form._manualDistributor && !isNaN(dm)) {
      setForm((f: any) => ({ ...f, distributor_price: Math.round(cost * (1 + dm / 100) * 100) / 100 }));
    }
  }, [form.cost, form.retail_markup, form.wholesale_markup, form.distributor_markup]);

  // Auto-sync alternate UOM prices from base unit when "Auto" is enabled
  useEffect(() => {
    setUomConversions((rows) => rows.map((row) => {
      const isBase = isProductBaseRow(row, rows, form.base_uom_id ?? editProduct?.base_uom_id);
      if (isBase) {
        return {
          ...row,
          purchase_price: parseFloat(form.cost) || 0,
          retail_price: parseFloat(form.retail_price) || 0,
          wholesale_price: parseFloat(form.wholesale_price) || 0,
          distributor_price: parseFloat(form.distributor_price) || 0,
        };
      }
      if (!row.auto_from_pc) return row;
      return {
        ...row,
        ...pricesFromBasePc({
          cost: form.cost,
          retail_markup: form.retail_markup,
          wholesale_markup: form.wholesale_markup,
          distributor_markup: form.distributor_markup,
          retail_price: form.retail_price,
          wholesale_price: form.wholesale_price,
          distributor_price: form.distributor_price,
        }, row.conversion_to_base),
      };
    }));
  }, [form.cost, form.retail_price, form.wholesale_price, form.distributor_price, form.base_uom_id, editProduct?.base_uom_id]);

  const loadProducts = () => {
    setLoading(true);
    api.get(`/products?search=${search}&is_active=${statusFilter}&page=${page}&limit=${limit}`)
      .then((res) => { setProducts(res.data.data); setTotal(res.data.total); onChanged?.(); })
      .catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => { loadProducts(); }, [page, search, statusFilter]);
  useEffect(() => {
    api.get('/categories/all').then((res) => setCategories(res.data)).catch(console.error);
    api.get('/brands/all').then((res) => setBrands(res.data)).catch(console.error);
  }, []);

  const openCreate = () => {
    if (!canCreate) { toast.error('You do not have permission to add products'); return; }
    setEditProduct(null);
    setForm({ ...EMPTY_FORM });
    setUomConversions(DEFAULT_UOM_ROW({ cost: 0, retail: 0, wholesale: 0, distributor: 0 }));
    api.get('/uoms/catalog').then((r) => {
      const catalog = Array.isArray(r.data) ? r.data : [];
      const pc = findBaseUomFromCatalog(catalog);
      if (pc) {
        setForm((f: any) => ({
          ...f,
          base_uom_id: Number(pc.id),
          unit_of_measure: normalizeUomCode(pc.code) || 'pc',
        }));
        setUomConversions([{
          uom_id: Number(pc.id),
          uom_code: normalizeUomCode(pc.code) || 'pc',
          conversion_to_base: 1,
          barcode: '',
          purchase_price: 0,
          retail_price: 0,
          wholesale_price: 0,
          distributor_price: 0,
          is_default_purchase: true,
          is_default_sales: true,
        }]);
      }
    }).catch(() => {});
    setShowForm(true);
  };
  const openEdit = async (p: any) => {
    if (!canEdit) { toast.error('You do not have permission to edit products'); return; }
    const cost = parseFloat(p.cost) || 0;
    try {
      const full = await api.get(`/products/${p.id}`);
      const prod = full.data;
      setEditProduct(prod);
      setForm({
        ...prod,
        retail_markup: cost > 0 ? Math.round(((parseFloat(prod.retail_price) || 0) / cost - 1) * 100 * 100) / 100 : 0,
        wholesale_markup: cost > 0 ? Math.round(((parseFloat(prod.wholesale_price) || 0) / cost - 1) * 100 * 100) / 100 : 0,
        distributor_markup: cost > 0 ? Math.round(((parseFloat(prod.distributor_price) || 0) / cost - 1) * 100 * 100) / 100 : 0,
        _manualRetail: false,
        _manualWholesale: false,
        _manualDistributor: false,
        allow_multiple_uom: Boolean(prod.allow_multiple_uom),
        track_batch: Boolean(prod.track_batch),
        track_expiry: Boolean(prod.track_expiry),
      });
      setUomConversions(prod.uoms?.length
        ? normalizeProductUomRows(prod.uoms.map((row: any) => ({
          ...row,
          auto_from_pc: Boolean(row.auto_from_pc),
        })), prod.base_uom_id)
        : DEFAULT_UOM_ROW({
          cost: parseFloat(prod.cost) || 0,
          retail: parseFloat(prod.retail_price) || 0,
          wholesale: parseFloat(prod.wholesale_price) || 0,
          distributor: parseFloat(prod.distributor_price) || 0,
          barcode: prod.barcode,
        }));
      setShowForm(true);
    } catch {
      toast.error('Failed to load product');
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (editProduct && !canEdit) { toast.error('You do not have permission to edit products'); return; }
    if (!editProduct && !canCreate) { toast.error('You do not have permission to add products'); return; }

    const validationError = validateProductForm(form);
    if (validationError) { toast.error(validationError); return; }

    setSaving(true);
    try {
      const payload = { ...form };
      delete payload._manualRetail; delete payload._manualWholesale; delete payload._manualDistributor;
      delete payload.retail_markup; delete payload.wholesale_markup; delete payload.distributor_markup;
      payload.name = String(payload.name).trim();
      payload.barcode = String(payload.barcode || '').trim();
      payload.category_id = payload.category_id || null;
      payload.brand_id = payload.brand_id || null;
      payload.cost = parseFloat(payload.cost) || 0;
      payload.retail_price = parseFloat(payload.retail_price) || 0;
      payload.wholesale_price = parseFloat(payload.wholesale_price) || 0;
      payload.distributor_price = parseFloat(payload.distributor_price) || 0;
      payload.reorder_level = parseFloat(payload.reorder_level) || 0;
      payload.chilled_price = parseFloat(payload.chilled_price) || 0;
      payload.has_chilled_variant = Boolean(payload.has_chilled_variant);
      payload.allow_multiple_uom = Boolean(form.allow_multiple_uom)
        || uomConversions.some((r) => parseFloat(String(r.conversion_to_base)) > 1);
      payload.track_batch = Boolean(form.track_batch);
      payload.track_expiry = Boolean(form.track_expiry);

      const normalizedRows = normalizeProductUomRows(uomConversions, form.base_uom_id ?? editProduct?.base_uom_id);
      const baseUomId = getProductBaseUomId(normalizedRows, form.base_uom_id ?? editProduct?.base_uom_id);
      const baseRow = normalizedRows[findProductBaseRowIndex(normalizedRows, baseUomId)] || normalizedRows[0];
      payload.unit_of_measure = normalizeUomCode(baseRow?.uom_code) || payload.unit_of_measure || 'pc';
      payload.base_uom_id = baseUomId;

      let catalogForSave: any[] = [];
      if (payload.allow_multiple_uom || normalizedRows.some((r) => !Number(r.uom_id))) {
        try {
          const catRes = await api.get('/uoms/catalog');
          catalogForSave = Array.isArray(catRes.data) ? catRes.data : [];
        } catch {
          toast.error('Failed to load UOM catalog');
          setSaving(false);
          return;
        }
      }
      const baseCatalogUom = findBaseUomFromCatalog(catalogForSave);
      let syncedUoms = normalizedRows.map((row) => {
        const isBase = baseUomId ? Number(row.uom_id) === Number(baseUomId) : parseFloat(String(row.conversion_to_base)) === 1;
        const uomId = Number(row.uom_id) || (isBase && baseCatalogUom ? Number(baseCatalogUom.id) : 0);
        const { auto_from_pc: _auto, ...rowRest } = row;
        return {
          ...rowRest,
          uom_id: uomId,
          purchase_price: isBase ? payload.cost : row.purchase_price,
          retail_price: isBase ? payload.retail_price : row.retail_price,
          wholesale_price: isBase ? payload.wholesale_price : row.wholesale_price,
          distributor_price: isBase ? payload.distributor_price : row.distributor_price,
          barcode: isBase ? payload.barcode : row.barcode,
        };
      }).filter((row) => Number(row.uom_id) > 0);

      if (payload.allow_multiple_uom && !syncedUoms.some((r) => Number(r.uom_id) === Number(baseUomId))) {
        toast.error('Base UOM is required');
        setSaving(false);
        return;
      }

      payload.uom_conversions = syncedUoms;
      payload.default_sales_uom_id = syncedUoms.find((r) => r.is_default_sales)?.uom_id || syncedUoms[0]?.uom_id;
      payload.default_purchase_uom_id = syncedUoms.find((r) => r.is_default_purchase)?.uom_id || syncedUoms[0]?.uom_id;
      payload.base_uom_id = baseUomId || syncedUoms.find((r) => parseFloat(String(r.conversion_to_base)) === 1)?.uom_id || syncedUoms[0]?.uom_id;

      if (editProduct) {
        if (isOnlyReorderLevelChanged(editProduct, payload)) {
          await api.patch(`/products/${editProduct.id}/reorder-level`, { reorder_level: payload.reorder_level });
          toast.success('Reorder level updated');
        } else {
          await api.put(`/products/${editProduct.id}`, payload);
          toast.success('Product updated');
        }
      } else {
        await api.post('/products', payload);
        toast.success('Product created');
      }
      setShowForm(false);
      loadProducts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving product'); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (id: string) => {
    if (!canEdit) { toast.error('You do not have permission to edit products'); return; }
    try { await api.patch(`/products/${id}/toggle`); loadProducts(); toast.success('Status toggled'); } catch (err: any) { toast.error(err.response?.data?.error || 'Error toggling product'); }
  };

  const deleteProduct = async (id: string) => {
    if (!canEdit) { toast.error('You do not have permission to delete products'); return; }
    if (!window.confirm('Are you sure you want to delete this product? This cannot be undone.')) return;
    try { await api.delete(`/products/${id}`); loadProducts(); toast.success('Product deleted'); } catch (err: any) { toast.error(err.response?.data?.error || 'Error deleting product'); }
  };

  const exportProducts = (format: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/products/export?format=${format}&search=${search}&status=${statusFilter}&token=${token}`, '_blank');
    setShowExportDropdown(false);
  };
  const downloadTemplate = () => { const token = localStorage.getItem('token'); window.open(`/api/products/export/template?token=${token}`, '_blank'); };

  const handlePreview = async () => {
    if (!importFile) { toast.error('Select a file'); return; }
    setImportPreview(null);
    setImportResult(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/products/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportPreview(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Preview failed'); }
    setImporting(false);
  };

  const handleExecuteImport = async () => {
    if (!importFile) return;
    if (!window.confirm(`Import ${importPreview?.valid_rows || 0} products? Rows with errors will be skipped.`)) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/products/import/execute', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(res.data);
      setImportPreview(null);
      if (res.data.imported > 0 || res.data.updated > 0) { loadProducts(); toast.success(`Imported ${res.data.imported} new, updated ${res.data.updated}`); }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Import failed'); }
    setImporting(false);
  };

  const loadPriceHistory = async (productId: string) => {
    setPhLoading(true);
    try {
      const params = new URLSearchParams();
      if (phFilterSupplier) params.set('supplier_name', phFilterSupplier);
      if (phDateFrom) params.set('date_from', phDateFrom);
      if (phDateTo) params.set('date_to', phDateTo);
      const [histRes, compRes] = await Promise.all([
        api.get(`/supplier-price-history/product/${productId}?${params.toString()}`),
        api.get(`/supplier-price-history/product/${productId}/comparison`),
      ]);
      setPriceHistory(histRes.data);
      setPriceComparison(compRes.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load price history');
    }
    setPhLoading(false);
  };

  const prefetchPriceSummary = async (productId: string) => {
    try {
      const compRes = await api.get(`/supplier-price-history/product/${productId}/comparison`);
      setPriceComparison(compRes.data);
    } catch {
      /* optional teaser on overview */
    }
  };

  const openDetail = (product: any) => {
    setDetailProduct(product);
    setDetailTab('details');
    setShowDetail(true);
    setPriceHistory([]);
    setPriceComparison(null);
    setPhFilterSupplier('');
    setPhDateFrom('');
    setPhDateTo('');
    prefetchPriceSummary(product.id);
  };

  const openDetailWithHistory = (product: any) => {
    setDetailProduct(product);
    setDetailTab('price-history');
    setShowDetail(true);
    setPriceHistory([]);
    setPriceComparison(null);
    setPhFilterSupplier('');
    setPhDateFrom('');
    setPhDateTo('');
    loadPriceHistory(product.id);
  };

  const switchDetailTab = (tab: 'details' | 'price-history') => {
    setDetailTab(tab);
    if (tab === 'price-history' && detailProduct && !phLoading && priceHistory.length === 0 && !priceComparison) {
      loadPriceHistory(detailProduct.id);
    }
  };

  const handleGenerateBarcode = () => {
    const raw = String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000000));
    const barcode = generateBarcode(raw);
    setForm({ ...form, barcode });
    toast.success('Barcode generated');
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditProduct(null);
  };

  const renderUomPanel = () => (
    <ProductUomPanel
      key={editProduct?.id || 'new'}
      allowMultiple={Boolean(form.allow_multiple_uom)}
      trackBatch={Boolean(form.track_batch)}
      trackExpiry={Boolean(form.track_expiry)}
      conversions={uomConversions}
      pricing={{
        cost: form.cost,
        retail_markup: form.retail_markup,
        wholesale_markup: form.wholesale_markup,
        distributor_markup: form.distributor_markup,
        retail_price: form.retail_price,
        wholesale_price: form.wholesale_price,
        distributor_price: form.distributor_price,
        _manualRetail: form._manualRetail,
        _manualWholesale: form._manualWholesale,
        _manualDistributor: form._manualDistributor,
      }}
      onAllowMultipleChange={(v) => {
        setForm({ ...form, allow_multiple_uom: v });
        if (!v) {
          setUomConversions((rows) => {
            const idx = findProductBaseRowIndex(rows, form.base_uom_id ?? editProduct?.base_uom_id);
            return idx >= 0 ? [rows[idx]] : rows.slice(0, 1);
          });
        }
      }}
      onTrackBatchChange={(v) => setForm({ ...form, track_batch: v })}
      onTrackExpiryChange={(v) => setForm({ ...form, track_expiry: v })}
      onConversionsChange={setUomConversions}
      onPricingChange={(updates) => setForm((f: any) => ({ ...f, ...updates }))}
      productBarcode={form.barcode}
      baseUomId={form.base_uom_id ?? editProduct?.base_uom_id}
      onBaseUomIdChange={(uomId, uomCode) => {
        setForm((f: any) => ({ ...f, base_uom_id: uomId, unit_of_measure: normalizeUomCode(uomCode) || 'pc' }));
      }}
    />
  );

  const renderProductFormFields = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-6 w-full">
      <div className="space-y-4 min-w-0">
        <ProductFormSection step={1} title="Product details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Product Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving || (editProduct ? !canEdit : !canCreate)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Barcode</label>
              <div className="flex gap-2">
                <input type="text" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <button type="button" onClick={handleGenerateBarcode} title="Generate barcode" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-blue-600"><Barcode size={16} /></button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">Select Category</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Brand</label>
              <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none md:max-w-md">
                <option value="">Select Brand</option>
                {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
        </ProductFormSection>

        <ProductFormSection step={5} title="Inventory & tax">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Reorder Level</label>
              <input type="number" step="0.01" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tax Type</label>
              <select value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="VAT">VAT 12%</option><option value="VAT Exempt">VAT Exempt</option>
                <option value="Zero Rated">Zero Rated</option><option value="LGU 5% Final VAT">LGU 5% Final VAT</option>
              </select>
            </div>
            {showPriceType && (
              <div>
                <label className="block text-sm font-medium mb-1">Price Type (POS)</label>
                <select value={form.price_type} onChange={(e) => setForm({ ...form, price_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="VAT Inclusive">VAT Inclusive</option>
                  <option value="VAT Exclusive">VAT Exclusive</option>
                </select>
                <p className="text-[10px] text-gray-400 mt-1">Whether retail price includes 12% VAT at POS.</p>
              </div>
            )}
          </div>
        </ProductFormSection>

        <ProductFormSection step={6} title="Variants">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.has_chilled_variant} onChange={(e) => setForm({ ...form, has_chilled_variant: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm font-medium text-gray-700">Enable Chilled Variant</span>
          </label>
          {form.has_chilled_variant && (
            <div className="mt-3 max-w-xs">
              <label className="block text-xs text-gray-500 mb-1">Chilled Selling Price (Retail only) *</label>
              <input type="number" step="0.01" min="0" value={form.chilled_price} onChange={(e) => setForm({ ...form, chilled_price: e.target.value })}
                disabled={saving}
                className="w-full px-3 py-2 border rounded-lg text-sm font-medium text-cyan-700 focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50" />
            </div>
          )}
        </ProductFormSection>
      </div>

      <div className="space-y-4 min-w-0 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto">
        {renderUomPanel()}
      </div>
    </div>
  );

  if (showForm) {
    return (
      <div className={`flex flex-col bg-gray-50 min-h-0 ${embedded ? 'h-full' : 'min-h-[calc(100vh-4rem)] -m-6'}`}>
        <div
          className="flex-shrink-0 sticky top-0 z-10 px-4 sm:px-6 h-12 flex flex-wrap items-center justify-between gap-3 shadow-sm"
          style={{ backgroundColor: PRIMARY }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={closeForm} disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white border border-white/30 rounded-lg hover:bg-white/10 disabled:opacity-50">
              <ArrowLeft size={16} /> Back
            </button>
            <div className="min-w-0 border-l border-white/20 pl-3">
              <h1 className="text-sm font-semibold text-white truncate">
                {editProduct ? 'Edit Product' : 'Add Product'}
              </h1>
              {editProduct?.sku && <p className="text-[11px] text-white/70 truncate">{editProduct.sku}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={closeForm} disabled={saving}
              className="px-4 py-1.5 border border-white/30 rounded-lg text-sm text-white hover:bg-white/10 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving || (editProduct ? !canEdit : !canCreate)}
              className="inline-flex items-center gap-2 px-4 py-1.5 bg-white text-blue-800 rounded-lg text-sm font-semibold hover:bg-blue-50 disabled:opacity-50">
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4">
          {renderProductFormFields()}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-0 ${embedded ? 'h-full gap-0' : 'space-y-4'}`}>
      {readOnly && (
        <div className="flex-shrink-0 mb-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
          Read-only mode — you can view products but cannot add or edit. Contact an administrator for catalog access.
        </div>
      )}

      {/* Dynamic page toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 pb-3">
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{total}</span> product{total !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-2 flex-wrap justify-end">
          {canEdit && (
            <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 bg-white"><Upload size={14} /> Import</button>
          )}
          {canExport && (
            <div className="relative">
              <button onClick={() => setShowExportDropdown(!showExportDropdown)} className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 bg-white"><Download size={14} /> Export</button>
              {showExportDropdown && (
                <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-40">
                  <button onClick={() => exportProducts('csv')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100">Export as CSV</button>
                  <button onClick={() => exportProducts('xlsx')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">Export as Excel</button>
                </div>
              )}
            </div>
          )}
          {canCreate && (
            <button onClick={openCreate} className="flex items-center gap-2 px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800"><Plus size={14} /> Create</button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex-shrink-0 flex flex-wrap gap-3 items-center bg-white border border-gray-200 rounded-t-lg px-4 py-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search name, SKU, or barcode…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
          <option value="all">All status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className={`bg-white border border-t-0 border-gray-200 overflow-hidden flex flex-col min-h-0 ${embedded ? 'flex-1 rounded-b-lg' : 'rounded-b-lg'}`}>
        <div className="flex-1 overflow-auto min-h-0">
          <table className="data-table">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th>SKU</th><th>Name</th><th>Category</th><th>Cost</th><th>Retail</th><th>Wholesale</th><th>Stock</th><th>Status</th><th className="w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">No products found</td></tr>
              ) : products.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td>
                    <button type="button" onClick={() => openDetail(p)} className="font-medium text-left hover:text-blue-600 hover:underline">
                      {p.name}
                    </button>
                  </td>
                  <td>{p.category_name || '-'}</td>
                  <td>{formatCurrency(p.cost)}</td>
                  <td>{formatCurrency(p.retail_price)}</td>
                  <td>{formatCurrency(p.wholesale_price)}</td>
                  <td>{p.store_stock || 0} / {p.warehouse_stock || 0}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openDetail(p)} className="p-1.5 hover:bg-gray-50 rounded" title="View product"><Eye size={15} /></button>
                      <button onClick={() => openDetailWithHistory(p)} className="p-1.5 hover:bg-amber-50 rounded text-amber-700" title="Supplier price history"><FileText size={15} /></button>
                      {canEdit && (
                        <>
                          <button onClick={() => openEdit(p)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Edit"><Edit2 size={15} /></button>
                          <button onClick={() => toggleStatus(p.id)} className="p-1.5 hover:bg-gray-50 rounded" title="Toggle status"><ToggleLeft size={15} /></button>
                          <button onClick={() => deleteProduct(p.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Delete"><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex-shrink-0 border-t border-gray-100">
          <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} limit={limit} onLimitChange={(l) => setPage(1)} showSizeChanger />
        </div>
      </div>

      {/* Import modal */}
      {showImportModal && (
        <ModalOverlay onClose={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Import Products</h2>
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}
                  className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              {importResult ? (
                /* Step 3: Results */
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
                /* Step 2: Preview table with errors */
                <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{importPreview.file_name}</span>
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{importPreview.valid_rows} valid</span>
                        {(() => { const creates = importPreview.rows?.filter((r: any) => r.action === 'Create').length || 0; const updates = importPreview.rows?.filter((r: any) => r.action === 'Update').length || 0; return <><span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{creates} to create</span><span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">{updates} to update</span></>; })()}
                        {importPreview.error_rows > 0 && <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">{importPreview.error_rows} errors</span>}
                      </div>
                    <button onClick={() => setImportPreview(null)} className="text-xs text-blue-600 hover:underline">Back to file upload</button>
                  </div>
                  <div className="max-h-80 overflow-auto border border-gray-200 rounded-lg mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Name</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">SKU</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Barcode</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Category</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-500">Cost</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-500">Retail</th>
                          <th className="px-2 py-2 text-center font-semibold text-gray-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.rows?.map((r: any) => (
                          <tr key={r.row} className={r.has_errors ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-2 py-1.5 text-gray-400">{r.row}</td>
                            <td className="px-2 py-1.5 font-medium">{r.name}</td>
                            <td className="px-2 py-1.5 font-mono text-xs">{r.sku || '-'}</td>
                            <td className="px-2 py-1.5 font-mono">{r.barcode || '-'}</td>
                            <td className="px-2 py-1.5">{r.category || '-'}</td>
                            <td className="px-2 py-1.5 text-right">{r.cost}</td>
                            <td className="px-2 py-1.5 text-right">{r.retail_price}</td>
                            <td className="px-2 py-1.5 text-center">
                              {r.has_errors ? (
                                <span className="text-red-600 font-medium" title={r.errors?.join('; ')}>Error</span>
                              ) : (
                                <span className={`font-medium ${r.action === 'Update' ? 'text-blue-600' : 'text-green-600'}`}>{r.action}</span>
                              )}
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
                    <button onClick={() => { setImportPreview(null); setImportFile(null); }}
                      className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handleExecuteImport} disabled={importing || importPreview.valid_rows === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {importing ? 'Importing...' : `Import ${importPreview.valid_rows} Products`}
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 1: Upload file */
                <div>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && (f.name.endsWith('.csv') || f.name.endsWith('.xlsx'))) setImportFile(f); else toast.error('Please select a CSV or Excel file'); }}>
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
                          <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }} />
                        </label>
                        <p className="text-xs text-gray-400 mt-2">CSV or Excel (.xlsx) up to 10MB</p>
                      </div>
                    )}
                  </div>
                  <button onClick={downloadTemplate} className="text-xs text-blue-600 hover:underline mb-4 inline-block">
                    Download import template
                  </button>
                  <div className="flex justify-end gap-3 mt-4">
                    <button onClick={() => { setShowImportModal(false); setImportFile(null); }}
                      className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
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

      {/* Product Detail Modal */}
      {showDetail && detailProduct && (
        <ModalOverlay onClose={() => setShowDetail(false)}>
          <div className="modal-content max-w-6xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Package size={18} className="text-blue-600 shrink-0" />
                    <h2 className="text-lg font-semibold text-gray-900 truncate">{detailProduct.name}</h2>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${detailProduct.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {detailProduct.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 font-mono">
                    {detailProduct.sku}
                    {detailProduct.category_name ? ` · ${detailProduct.category_name}` : ''}
                    {detailProduct.brand_name ? ` · ${detailProduct.brand_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => { setShowDetail(false); openEdit(detailProduct); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
                    >
                      <Edit2 size={14} /> Edit
                    </button>
                  )}
                  <button type="button" onClick={() => setShowDetail(false)} className="p-1.5 hover:bg-gray-200 rounded-lg"><X size={18} /></button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                <MetricCard label="Cost" value={formatCurrency(detailProduct.cost)} tone="blue" />
                <MetricCard label="Retail" value={formatCurrency(detailProduct.retail_price)} />
                <MetricCard label="Wholesale" value={formatCurrency(detailProduct.wholesale_price)} />
                <MetricCard label="Stock" value={`${detailProduct.store_stock || 0} / ${detailProduct.warehouse_stock || 0}`} sub="Store / Warehouse" tone="purple" />
              </div>
            </div>

            {/* Tab bar */}
            <div className="px-6 pt-3 border-b border-gray-200 bg-white">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => switchDetailTab('details')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px ${
                    detailTab === 'details' ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Package size={15} /> Overview
                </button>
                <button
                  type="button"
                  onClick={() => switchDetailTab('price-history')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px ${
                    detailTab === 'price-history' ? 'border-amber-600 text-amber-700 bg-amber-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <TrendingUp size={15} /> Supplier Price History
                  {priceHistory.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-800">{priceHistory.length}</span>
                  )}
                </button>
              </div>
            </div>

            <div className="p-6 max-h-[calc(85vh-14rem)] overflow-y-auto">
              {detailTab === 'details' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <DetailSection title="Identification">
                    <DetailRow label="SKU" value={detailProduct.sku} mono />
                    <DetailRow label="Barcode" value={detailProduct.barcode || '—'} mono />
                    <DetailRow label="Category" value={detailProduct.category_name || '—'} />
                    <DetailRow label="Brand" value={detailProduct.brand_name || '—'} />
                    <DetailRow label="Unit of Measure" value={detailProduct.unit_of_measure || '—'} />
                    {detailProduct.description && (
                      <div className="pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Description</p>
                        <p className="text-sm text-gray-800">{detailProduct.description}</p>
                      </div>
                    )}
                  </DetailSection>

                  <DetailSection title="Selling Prices">
                    <DetailRow label="Retail" value={formatCurrency(detailProduct.retail_price)} highlight />
                    <DetailRow label="Wholesale" value={formatCurrency(detailProduct.wholesale_price)} />
                    <DetailRow label="Distributor" value={formatCurrency(detailProduct.distributor_price)} />
                    {detailProduct.has_chilled_variant && (
                      <DetailRow label="Chilled Price" value={formatCurrency(detailProduct.chilled_price)} />
                    )}
                    <DetailRow label="Cost (current)" value={formatCurrency(detailProduct.cost)} highlight />
                  </DetailSection>

                  <DetailSection title="Tax & Reorder">
                    <DetailRow label="Tax Type" value={detailProduct.tax_type || '—'} />
                    {showPriceType && (
                      <DetailRow label="Price Type" value={detailProduct.price_type || '—'} />
                    )}
                    <DetailRow label="Reorder Level" value={String(detailProduct.reorder_level ?? 0)} />
                  </DetailSection>

                  <DetailSection title="Supplier Costs">
                    <p className="text-xs text-gray-500">
                      Purchase cost history from posted Goods Receipts. Switch to the Supplier Price History tab for full ledger and supplier comparison.
                    </p>
                    {priceComparison?.stats?.last_purchase_price > 0 ? (
                      <>
                        <DetailRow label="Last GR cost" value={formatCurrency(priceComparison.stats.last_purchase_price)} highlight />
                        <DetailRow label="Cheapest supplier" value={priceComparison.stats.cheapest_supplier || '—'} />
                        <DetailRow label="Cheapest cost" value={formatCurrency(priceComparison.stats.cheapest_price)} />
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => switchDetailTab('price-history')}
                        className="w-full mt-1 px-3 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                      >
                        View supplier price history →
                      </button>
                    )}
                  </DetailSection>
                </div>
              )}

              {detailTab === 'price-history' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Records are created when you <strong>post a Goods Receipt (RR)</strong>. This tracks supplier unit cost only — not retail/wholesale selling prices.
                  </p>

                  {phLoading ? (
                    <div className="flex items-center justify-center py-16 text-sm text-gray-400 gap-2">
                      <Loader2 size={18} className="animate-spin" /> Loading price history…
                    </div>
                  ) : (
                    <>
                      {priceComparison?.stats && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <MetricCard
                            label="Cheapest"
                            value={formatCurrency(priceComparison.stats.cheapest_price)}
                            sub={priceComparison.stats.cheapest_supplier || 'No data'}
                            tone="green"
                          />
                          <MetricCard
                            label="Highest"
                            value={formatCurrency(priceComparison.stats.highest_price)}
                            sub={priceComparison.stats.most_expensive_supplier || 'No data'}
                            tone="red"
                          />
                          <MetricCard
                            label="Average / Suppliers"
                            value={formatCurrency(priceComparison.stats.avg_cost)}
                            sub={`${priceComparison.stats.supplier_count || 0} supplier(s)`}
                            tone="blue"
                          />
                          <MetricCard
                            label="Current vs Last GR"
                            value={formatCurrency(priceComparison.stats.current_cost)}
                            sub={`Last GR: ${formatCurrency(priceComparison.stats.last_purchase_price)}`}
                            tone="purple"
                          />
                        </div>
                      )}

                      {priceComparison?.suppliers?.length > 0 && (
                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-700">Supplier Comparison</span>
                            <span className="text-xs text-gray-400">{priceComparison.suppliers.length} supplier(s)</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 text-xs uppercase text-gray-500">
                                  <th className="px-4 py-2 text-left">Supplier</th>
                                  <th className="px-4 py-2 text-right">Latest</th>
                                  <th className="px-4 py-2 text-right">Previous</th>
                                  <th className="px-4 py-2 text-right">Change</th>
                                  <th className="px-4 py-2 text-center">Trend</th>
                                  <th className="px-4 py-2 text-left">Last RR</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {priceComparison.suppliers.map((s: any) => (
                                  <tr key={s.supplier_id} className={s.is_best_price ? 'bg-green-50/60' : 'hover:bg-gray-50'}>
                                    <td className="px-4 py-2.5 font-medium">
                                      {s.supplier_name}
                                      {s.is_best_price && <span className="ml-2 text-[10px] font-semibold text-green-700 uppercase">Best</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(s.latest_cost)}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-500">{formatCurrency(s.previous_cost)}</td>
                                    <td className={`px-4 py-2.5 text-right ${s.price_difference > 0 ? 'text-red-600' : s.price_difference < 0 ? 'text-green-600' : ''}`}>
                                      {s.price_difference > 0 ? '+' : ''}{formatCurrency(s.price_difference)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                                        s.trend === 'Increased' ? 'bg-red-100 text-red-700' :
                                        s.trend === 'Decreased' ? 'bg-green-100 text-green-700' :
                                        'bg-gray-100 text-gray-600'
                                      }`}>{s.trend}</span>
                                    </td>
                                    <td className="px-4 py-2.5 text-xs text-gray-600">
                                      {s.gr_number || s.po_number || '—'}
                                      {s.last_purchase_date && <span className="block text-gray-400">{new Date(s.last_purchase_date).toLocaleDateString()}</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-700">Receipt Ledger ({priceHistory.length})</span>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/supplier-price-history/report?product_id=${detailProduct.id}&format=csv&token=${token}`, '_blank'); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs hover:bg-white bg-white"
                              >
                                <Download size={13} /> CSV
                              </button>
                              <button
                                type="button"
                                onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/supplier-price-history/report?product_id=${detailProduct.id}&format=xlsx&token=${token}`, '_blank'); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs hover:bg-white bg-white"
                              >
                                <Download size={13} /> Excel
                              </button>
                              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs hover:bg-white bg-white">
                                <Printer size={13} /> Print
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">Supplier</label>
                              <input type="text" placeholder="Search supplier…" value={phFilterSupplier} onChange={(e) => setPhFilterSupplier(e.target.value)}
                                className="px-2.5 py-1.5 border rounded-lg text-sm w-40" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">From</label>
                              <input type="date" value={phDateFrom} onChange={(e) => setPhDateFrom(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">To</label>
                              <input type="date" value={phDateTo} onChange={(e) => setPhDateTo(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm" />
                            </div>
                            <button type="button" onClick={() => loadPriceHistory(detailProduct.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Apply</button>
                          </div>
                        </div>
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0 text-xs uppercase text-gray-500">
                              <tr>
                                <th className="px-3 py-2 text-left">Date</th>
                                <th className="px-3 py-2 text-left">Supplier</th>
                                <th className="px-3 py-2 text-left">RR #</th>
                                <th className="px-3 py-2 text-left">PO #</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-right">Unit Cost</th>
                                <th className="px-3 py-2 text-right">Change</th>
                                <th className="px-3 py-2 text-left hidden lg:table-cell">Location</th>
                                <th className="px-3 py-2 text-left hidden xl:table-cell">Batch / Expiry</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {priceHistory.length === 0 ? (
                                <tr>
                                  <td colSpan={9} className="text-center py-12 text-gray-400">
                                    <TrendingUp size={28} className="mx-auto mb-2 opacity-30" />
                                    <p className="font-medium text-gray-500">No supplier price history yet</p>
                                    <p className="text-xs mt-1">Post a Goods Receipt containing this product to record the first entry.</p>
                                  </td>
                                </tr>
                              ) : priceHistory.map((h: any) => (
                                <tr key={h.id} className="hover:bg-amber-50/30">
                                  <td className="px-3 py-2 text-xs whitespace-nowrap">{h.received_date ? new Date(h.received_date).toLocaleDateString() : '—'}</td>
                                  <td className="px-3 py-2 font-medium">{h.supplier_name}</td>
                                  <td className="px-3 py-2 font-mono text-xs">{h.gr_number || '—'}</td>
                                  <td className="px-3 py-2 font-mono text-xs">{h.po_number || '—'}</td>
                                  <td className="px-3 py-2 text-right">{h.quantity_received} {h.uom}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(h.unit_cost)}</td>
                                  <td className={`px-3 py-2 text-right ${h.price_difference > 0 ? 'text-red-600' : h.price_difference < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                    {h.price_difference > 0 ? '+' : ''}{formatCurrency(h.price_difference)}
                                  </td>
                                  <td className="px-3 py-2 text-xs hidden lg:table-cell">{h.location_name || h.location_name_ref || '—'}</td>
                                  <td className="px-3 py-2 text-xs hidden xl:table-cell">
                                    {h.batch_number || '—'}
                                    {h.expiry_date && <span className="block text-gray-400">Exp {new Date(h.expiry_date).toLocaleDateString()}</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
