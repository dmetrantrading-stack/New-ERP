import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Plus, RefreshCw } from 'lucide-react';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import UomCatalogPanel from './UomCatalogPanel';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';

const PRIMARY = '#1E40AF';

export default function UnitConversions({ embedded = false }: { embedded?: boolean }) {
  const { hasPerm } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [conversions, setConversions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [factorForm, setFactorForm] = useState({ from_unit: '', to_unit: '', conversion_factor: '' });
  const [convertForm, setConvertForm] = useState({ from_unit: '', to_unit: '', quantity: '1', location_id: 1 });
  const [locations, setLocations] = useState<any[]>([]);

  useEffect(() => {
    api.get('/products?limit=500').then((r) => setProducts(r.data.data || [])).catch(() => {});
    api.get('/inventory/locations').then((r) => setLocations(r.data || [])).catch(() => {
      setLocations([{ id: 1, name: 'Store' }]);
    });
  }, []);

  const searchProducts = async (q: string) => {
    try { return (await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`)).data; }
    catch { return []; }
  };

  const loadConversions = async (productId: string) => {
    setLoading(true);
    try {
      const r = await api.get(`/conversions/${productId}`);
      setConversions(r.data || []);
    } catch {
      toast.error('Failed to load conversions');
      setConversions([]);
    } finally {
      setLoading(false);
    }
  };

  const selectProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    setSelectedProduct(p || { id, name: 'Product' });
    if (id) loadConversions(id);
  };

  const addFactor = async () => {
    if (!selectedProduct?.id) { toast.error('Select a product first'); return; }
    if (!factorForm.from_unit || !factorForm.to_unit || !factorForm.conversion_factor) {
      toast.error('Fill all factor fields'); return;
    }
    try {
      await api.post('/conversions/', {
        product_id: selectedProduct.id,
        from_unit: factorForm.from_unit,
        to_unit: factorForm.to_unit,
        conversion_factor: parseFloat(factorForm.conversion_factor),
      });
      toast.success('Conversion factor added');
      setFactorForm({ from_unit: '', to_unit: '', conversion_factor: '' });
      loadConversions(selectedProduct.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add factor');
    }
  };

  const runConvert = async () => {
    if (!selectedProduct?.id) { toast.error('Select a product'); return; }
    try {
      const r = await api.post('/conversions/convert', {
        product_id: selectedProduct.id,
        from_unit: convertForm.from_unit,
        to_unit: convertForm.to_unit,
        quantity: parseFloat(convertForm.quantity),
        location_id: convertForm.location_id,
      });
      toast.success(r.data.message || 'Conversion completed');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Conversion failed');
    }
  };

  return (
    <div>
      {!embedded && (
        <div className="mb-4">
          <h1 className="text-xl font-bold">Unit Conversions</h1>
          <p className="text-sm text-gray-500">Manage global UOM types and product conversion factors</p>
        </div>
      )}

      <UomCatalogPanel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold mb-3">Select Product</h2>
          <ProductAutocomplete
            products={products}
            value={selectedProduct?.id || ''}
            selectedName={selectedProduct?.name || ''}
            placeholder="Search product…"
            getPrice={(p) => p.cost || 0}
            searchFn={searchProducts}
            onSelect={(p) => {
              if (!products.find((x) => x.id === p.id)) setProducts((prev) => [...prev, p]);
              selectProduct(p.id);
            }}
          />
          {selectedProduct && (
            <p className="text-xs text-gray-500 mt-2">
              Base UOM: {selectedProduct.unit_of_measure || 'pc'}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Conversion Factors</h3>
            {selectedProduct && (
              <button onClick={() => loadConversions(selectedProduct.id)} className="text-gray-400 hover:text-gray-600"><RefreshCw size={14} /></button>
            )}
          </div>
          {loading ? (
            <p className="text-sm text-gray-400 py-4">Loading...</p>
          ) : conversions.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No factors defined</p>
          ) : (
            <table className="w-full text-xs mt-2">
              <thead><tr className="text-gray-500">
                <th className="text-left py-1">From</th><th className="text-left py-1">To</th><th className="text-right py-1">Factor</th>
              </tr></thead>
              <tbody>
                {conversions.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1.5">{c.from_unit}</td>
                    <td className="py-1.5">{c.to_unit}</td>
                    <td className="py-1.5 text-right">{c.conversion_factor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {hasPerm('inventory.inventory.edit') && (
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-sm font-semibold mb-2">Add Factor</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <input placeholder="From unit" value={factorForm.from_unit} onChange={(e) => setFactorForm({ ...factorForm, from_unit: e.target.value })} className="border rounded px-2 py-1.5" />
                <input placeholder="To unit" value={factorForm.to_unit} onChange={(e) => setFactorForm({ ...factorForm, to_unit: e.target.value })} className="border rounded px-2 py-1.5" />
                <input placeholder="Factor" type="number" step="0.0001" value={factorForm.conversion_factor} onChange={(e) => setFactorForm({ ...factorForm, conversion_factor: e.target.value })} className="border rounded px-2 py-1.5" />
              </div>
              <button onClick={addFactor} className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-700"><Plus size={14} /> Add Factor</button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold mb-3">Run Conversion</h2>
          <p className="text-xs text-gray-500 mb-3">Deducts parent unit quantity and records conversion in inventory ledger.</p>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-xs text-gray-500">From Unit</label>
              <select value={convertForm.from_unit} onChange={(e) => setConvertForm({ ...convertForm, from_unit: e.target.value })} className="w-full border rounded mt-1 px-2 py-1.5">
                <option value="">Select</option>
                {[...new Set(conversions.map((c) => c.from_unit))].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">To Unit</label>
              <select value={convertForm.to_unit} onChange={(e) => setConvertForm({ ...convertForm, to_unit: e.target.value })} className="w-full border rounded mt-1 px-2 py-1.5">
                <option value="">Select</option>
                {conversions.filter((c) => c.from_unit === convertForm.from_unit).map((c) => (
                  <option key={c.id} value={c.to_unit}>{c.to_unit} (×{c.conversion_factor})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Quantity to Convert</label>
              <input type="number" min="0.01" step="0.01" value={convertForm.quantity} onChange={(e) => setConvertForm({ ...convertForm, quantity: e.target.value })} className="w-full border rounded mt-1 px-2 py-1.5" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Location</label>
              <select value={convertForm.location_id} onChange={(e) => setConvertForm({ ...convertForm, location_id: parseInt(e.target.value) })} className="w-full border rounded mt-1 px-2 py-1.5">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <button onClick={runConvert} disabled={!selectedProduct} className="w-full py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50" style={{ backgroundColor: PRIMARY }}>
              Convert Units
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
