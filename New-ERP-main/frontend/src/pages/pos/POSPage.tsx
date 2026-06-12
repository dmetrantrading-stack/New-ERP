import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { formatCurrency, computeVAT, PRICE_MODES } from '../../lib/utils';
import { useAuth } from '../../store/auth';
import { Search, X, Minus, Plus, Percent, DollarSign, Users, Printer, ShoppingCart, User, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

export default function POSPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<any[]>([]);
  const [priceMode, setPriceMode] = useState<'Retail' | 'Wholesale' | 'Distributor'>('Retail');
  const [customer, setCustomer] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [shift, setShift] = useState<any>(null);
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [qtyTarget, setQtyTarget] = useState<any>(null);
  const [newQty, setNewQty] = useState(1);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [suspendedSales, setSuspendedSales] = useState<any[]>([]);
  const [locationId, setLocationId] = useState('1');
  const [chilledProduct, setChilledProduct] = useState<any>(null);

  // Search products
  useEffect(() => {
    if (search.length > 0) {
      api.get(`/products/search/quick?q=${search}`).then((res) => setProducts(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    } else {
      setProducts([]);
    }
  }, [search]);

  // Check open shift
  useEffect(() => {
    api.get('/pos/shifts/current').then((res) => setShift(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, []);

  // Load customers
  useEffect(() => {
    if (customerSearch.length > 0) {
      api.get(`/customers?search=${customerSearch}&limit=10`).then((r) => setCustomers(r.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    }
  }, [customerSearch]);

  const addToCart = (product: any, variant?: string) => {
    const isChilled = variant === 'Chilled';
    const price = isChilled ? product.chilled_price
      : priceMode === 'Retail' ? product.retail_price
      : priceMode === 'Wholesale' ? product.wholesale_price
      : product.distributor_price;

    const key = `${product.id}_${isChilled ? 'Chilled' : 'Regular'}`;
    const existing = cart.find((item) => item.cart_key === key);
    if (existing) {
      const newQty = existing.quantity + 1;
      setCart(cart.map((item) => item.cart_key === key
        ? { ...item, quantity: newQty, total: newQty * item.unit_price * (1 - (item.discount || 0) / 100) }
        : item));
    } else {
      setCart([...cart, {
        cart_key: key,
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        quantity: 1,
        unit_price: price,
        discount: 0,
        total: price,
        cost: product.cost || 0,
        selected_variant: isChilled ? 'Chilled' : 'Regular',
        has_chilled_variant: !!product.has_chilled_variant,
      }]);
    }
    setSearch('');
    setChilledProduct(null);
  };

  const updateQuantity = (cartKey: string, qty: number) => {
    if (qty <= 0) { setCart(cart.filter((item) => item.cart_key !== cartKey)); return; }
    setCart(cart.map((item) => item.cart_key === cartKey ? { ...item, quantity: qty, total: qty * item.unit_price * (1 - (item.discount || 0) / 100) } : item));
  };

  const updateDiscount = (cartKey: string, disc: number) => {
    setCart(cart.map((item) => item.cart_key === cartKey ? { ...item, discount: disc, total: item.quantity * item.unit_price * (1 - disc / 100) } : item));
  };

  const removeFromCart = (cartKey: string) => {
    setCart(cart.filter((item) => item.cart_key !== cartKey));
  };

  const openShift = async () => {
    try { await api.post('/pos/shifts/open', { opening_cash: 0 }); const res = await api.get('/pos/shifts/current'); setShift(res.data); toast.success('Shift opened'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error opening shift'); }
  };

  const subtotal = cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const totalDiscount = cart.reduce((sum, item) => sum + item.unit_price * item.quantity * (item.discount / 100), 0);
  const netTotal = subtotal - totalDiscount;
  const { netOfVat, vat } = computeVAT(netTotal);
  const totalCost = cart.reduce((sum, item) => sum + (item.cost || 0) * item.quantity, 0);
  const grossProfit = netTotal - totalCost;
  const marginPct = netTotal > 0 ? ((grossProfit / netTotal) * 100) : 0;

  const finalizeSale = async () => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!shift) { toast.error('Open a shift first'); return; }
    const tendered = parseFloat(amountTendered) || netTotal;
    if (tendered < netTotal && paymentMethod !== 'Charge') { toast.error('Insufficient amount'); return; }

    try {
      const res = await api.post('/pos/transactions', {
        shift_id: shift.id,
        customer_id: customer?.id,
        customer_name: customer?.customer_name,
        price_mode: priceMode,
        items: cart.map((item) => ({ product_id: item.product_id, description: item.name, quantity: item.quantity, unit_price: item.unit_price, discount: item.discount, selected_variant: item.selected_variant || 'Regular' })),
        payment_method: paymentMethod,
        amount_tendered: tendered,
        location_id: locationId,
      });
      toast.success(`Sold! Total: ${formatCurrency(res.data.total)} | Profit: ${formatCurrency(res.data.gross_profit)} (${res.data.margin_pct}%) | Change: ${formatCurrency(res.data.change)}`);
      setCart([]);
      setAmountTendered('');
      setPaymentModal(false);
      setCustomer(null);
      setPaymentMethod('Cash');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Transaction failed'); }
  };

  const suspendSale = async () => {
    if (cart.length === 0) return;
    try {
      await api.post('/pos/suspend', {
        shift_id: shift?.id, customer_id: customer?.id, customer_name: customer?.customer_name,
        price_mode: priceMode,         items: cart.map((item) => ({ product_id: item.product_id, name: item.name, sku: item.sku, quantity: item.quantity, unit_price: item.unit_price, discount: item.discount, total: item.total, cost: item.cost, selected_variant: item.selected_variant, cart_key: item.cart_key })), subtotal, discount_total: totalDiscount, tax_total: vat, total: netTotal,
      });
      toast.success('Sale suspended');
      setCart([]);
    } catch (err: any) { toast.error('Error suspending sale'); }
  };

  const closeShift = async () => {
    try {
      const cs = prompt('Enter closing cash amount:');
      if (!cs) return;
      const res = await api.post('/pos/shifts/close', { closing_cash: parseFloat(cs) });
      toast.success(`Shift closed. Variance: ${formatCurrency(res.data.variance)}`);
      setShift(null);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error closing shift'); }
  };

  const loadSuspendedSales = async () => {
    try {
      const res = await api.get('/pos/suspend');
      setSuspendedSales(res.data);
      setShowRecallModal(true);
    } catch (err: any) { toast.error('Failed to load suspended sales'); }
  };

  const recallSale = (sale: any) => {
    const items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;
    setCart(items.map((item: any) => ({ ...item, product_id: item.product_id, cost: item.cost || 0 })));
    setCustomer(sale.customer_id ? { id: sale.customer_id, customer_name: sale.customer_name } : null);
    setPriceMode(sale.price_mode || 'Retail');
    setShowRecallModal(false);
    api.delete(`/pos/suspend/${sale.id}`).catch(() => {});
  };

  const deleteSuspended = async (id: string) => {
    try { await api.delete(`/pos/suspend/${id}`); toast.success('Removed'); loadSuspendedSales(); }
    catch (err: any) { toast.error('Failed to delete'); }
  };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); if (cart.length > 0) { setQtyTarget(cart[cart.length - 1]); setNewQty(cart[cart.length - 1].quantity); setShowQtyModal(true); } }
      if (e.key === 'F2') { e.preventDefault(); toast('Price override: click item price'); }
      if (e.key === 'F3') { e.preventDefault(); toast('Discount: enter discount % on item'); }
      if (e.key === 'F4') { e.preventDefault(); setShowCustomerModal(true); }
      if (e.key === 'F5') { e.preventDefault(); suspendSale(); }
      if (e.key === 'F6') { e.preventDefault(); loadSuspendedSales(); }
      if (e.key === 'F10') { e.preventDefault(); if (cart.length > 0) setPaymentModal(true); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, shift, customer, priceMode, subtotal, totalDiscount, netTotal, vat, paymentMethod, amountTendered, suspendSale]);

  return (
    <div className="h-[calc(100vh-6rem)] flex gap-4">
      {/* Left: Products */}
      <div className="flex-1 flex flex-col">
        {!shift ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-4">No Open Shift</h2>
              <button onClick={openShift} className="px-6 py-3 bg-blue-600 text-white rounded-lg text-lg font-medium hover:bg-blue-700">Open Shift</button>
            </div>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-3">
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search product by name, SKU, or barcode... (F1-Qty, F4-Customer, F10-Pay)"
                value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
                className="w-full pl-12 pr-4 py-3.5 border-2 border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>

            {/* Product Results */}
            {search && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3 max-h-60 overflow-y-auto shadow-lg">
                {products.map((p) => {
                  const price = priceMode === 'Retail' ? p.retail_price : priceMode === 'Wholesale' ? p.wholesale_price : p.distributor_price;
                  const hasVariants = p.has_variants && p.variants && p.variants.length > 0;
                  const showChilledOption = p.has_chilled_variant && priceMode === 'Retail';
                  const handleClick = () => {
                    if (hasVariants) return;
                    if (showChilledOption) { setChilledProduct(p); return; }
                    addToCart(p);
                  };
                  return (
                    <div key={p.id}>
                      <div onClick={handleClick} className={`flex items-center justify-between px-4 py-3 hover:bg-blue-50 border-b border-gray-100 ${hasVariants ? 'cursor-default' : 'cursor-pointer'}`}>
                        <div>
                          <p className="font-medium">{p.name} {showChilledOption && <span className="text-[10px] text-cyan-600 font-normal bg-cyan-50 px-1.5 py-0.5 rounded ml-1">+Chilled</span>}</p>
                          <p className="text-xs text-gray-500">{p.sku} | Stock: {p.available_stock}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">{formatCurrency(price)}</p>
                          <p className="text-xs text-gray-400">{priceMode}</p>
                        </div>
                      </div>
                      {hasVariants && (
                        <div className="pl-8 pr-4 pb-2 space-y-1">
                          {p.variants.map((v: any) => {
                            const varPrice = priceMode === 'Retail' ? (v.retail_price || price + (v.additional_cost || 0)) : price + (v.additional_cost || 0);
                            return (
                              <div key={v.id} onClick={() => addToCart({ ...p, retail_price: varPrice, wholesale_price: varPrice, distributor_price: varPrice, name: `${p.name} - ${v.name}` })}
                                className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg hover:bg-blue-50 cursor-pointer border border-gray-100">
                                <span className="text-sm font-medium">{v.name}</span>
                                <span className="text-sm font-bold">{formatCurrency(varPrice)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {products.length === 0 && <p className="text-center py-4 text-gray-400">No products found</p>}
              </div>
            )}

            {/* Chilled Variant Popup */}
            {chilledProduct && (
              <div className="modal-overlay" onClick={() => setChilledProduct(null)}>
                <div className="modal-content max-w-xs" onClick={(e) => e.stopPropagation()}>
                  <div className="p-6 text-center">
                    <p className="text-lg font-semibold mb-1">{chilledProduct.name}</p>
                    <p className="text-sm text-gray-500 mb-4">Select variant</p>
                    <button onClick={() => { const p = chilledProduct; addToCart(p); }}
                      className="w-full py-3 mb-2 bg-white border-2 border-gray-300 rounded-lg font-semibold text-lg hover:bg-gray-50">
                      Regular - {formatCurrency(priceMode === 'Retail' ? chilledProduct.retail_price : priceMode === 'Wholesale' ? chilledProduct.wholesale_price : chilledProduct.distributor_price)}
                    </button>
                    <button onClick={() => { addToCart(chilledProduct, 'Chilled'); }}
                      className="w-full py-3 bg-cyan-50 border-2 border-cyan-300 rounded-lg font-semibold text-lg text-cyan-700 hover:bg-cyan-100">
                      Chilled - {formatCurrency(chilledProduct.chilled_price)}
                    </button>
                    <button onClick={() => setChilledProduct(null)} className="mt-3 text-sm text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Price Mode + Controls */}
            <div className="flex gap-2 mb-3 items-center flex-wrap">
              {PRICE_MODES.map((mode) => (
                <button key={mode} onClick={() => setPriceMode(mode as any)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${priceMode === mode ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 hover:bg-gray-50'}`}>
                  {mode}
                </button>
              ))}
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium bg-white">
                <option value="1">Store</option>
                <option value="2">Warehouse</option>
              </select>
              <button onClick={() => setShowCustomerModal(true)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white hover:bg-gray-50 flex items-center gap-1">
                <User size={14} /> {customer ? customer.customer_name : 'Walk-in'}
              </button>
              {/* Shift Card */}
              <div className="ml-auto flex items-center gap-3 text-xs">
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                  <span className="text-gray-400">Cashier: </span><span className="font-medium">{user?.full_name || '—'}</span>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                  <span className="text-gray-400">Shift: </span><span className={`font-medium ${shift?.status === 'Open' ? 'text-green-600' : 'text-red-600'}`}>{shift?.status || 'Closed'}</span>
                </div>
                <button onClick={closeShift} className="px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200">
                  <RotateCcw size={14} className="inline mr-1" />Close
                </button>
              </div>
            </div>

            {/* Cart */}
            <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Item</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase w-16">Qty</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-20">Price</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase w-14">Disc%</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-20">GP</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-20">Total</th>
                      <th className="px-4 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.cart_key} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-sm">{item.name}{item.selected_variant ? <span className="ml-1 text-xs font-normal text-cyan-600">({item.selected_variant})</span> : ''}</p>
                          <p className="text-xs text-gray-400">{item.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => updateQuantity(item.cart_key, item.quantity - 1)} className="p-0.5 hover:bg-gray-200 rounded"><Minus size={14} /></button>
                            <span className="w-8 text-center font-medium">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.cart_key, item.quantity + 1)} className="p-0.5 hover:bg-gray-200 rounded"><Plus size={14} /></button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.unit_price)}</td>
                        <td className="px-4 py-3 text-center">
                          <input type="number" value={item.discount} onChange={(e) => updateDiscount(item.cart_key, parseFloat(e.target.value) || 0)}
                            className="w-14 text-center border rounded text-sm py-1" min="0" max="100" />
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{formatCurrency(item.total)}</td>
                        <td className="px-4 py-3 text-right text-xs text-emerald-600">{formatCurrency((item.unit_price - (item.cost || 0)) * item.quantity * (1 - (item.discount || 0) / 100))}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => removeFromCart(item.cart_key)} className="text-red-400 hover:text-red-600"><X size={16} /></button>
                        </td>
                      </tr>
                    ))}
                    {cart.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                        <ShoppingCart size={48} className="mx-auto mb-3 text-gray-300" />
                        <p>Search and select products to start selling</p>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>


      {/* Right Panel */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-3 self-end">
        {/* Shortcuts */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Shortcut Keys</h3>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { if (cart.length > 0) { setQtyTarget(cart[cart.length - 1]); setNewQty(cart[cart.length - 1].quantity); setShowQtyModal(true); } }} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-blue-50 rounded-lg text-sm font-medium">
              <kbd className="px-2 py-1 bg-white border rounded text-xs font-mono font-bold">F4</kbd> Quantity
            </button>
            <button onClick={() => { if (cart.length > 0) { setQtyTarget(cart[cart.length - 1]); updateDiscount(cart[cart.length - 1].cart_key, 0); } }} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-amber-50 rounded-lg text-sm font-medium">
              <kbd className="px-2 py-1 bg-white border rounded text-xs font-mono font-bold">F2</kbd> Discount
            </button>
            <button onClick={() => { if (cart.length > 0) { setCart(cart.slice(0, -1)); } }} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-red-50 rounded-lg text-sm font-medium text-red-600">
              <kbd className="px-2 py-1 bg-white border rounded text-xs font-mono font-bold">Del</kbd> Delete
            </button>
            <button onClick={() => setCart([])} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-red-50 rounded-lg text-sm font-medium text-red-600">
              <kbd className="px-2 py-1 bg-white border rounded text-xs font-mono font-bold">F9</kbd> Clear All
            </button>
            <button onClick={suspendSale} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-amber-50 rounded-lg text-sm font-medium">
              <kbd className="px-2 py-1 bg-white border rounded text-xs font-mono font-bold">F3</kbd> Save Order
            </button>
            <button onClick={() => setShowCustomerModal(true)} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-purple-50 rounded-lg text-sm font-medium">
              <kbd className="px-2 py-1 bg-white border rounded text-xs font-mono font-bold">F5</kbd> More Options
            </button>
          </div>
        </div>

        {/* Order Summary */}
        {shift && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-lg">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Order Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Items</span><span className="font-medium">{cart.reduce((s, i) => s + i.quantity, 0)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              {totalDiscount > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="text-red-600">-{formatCurrency(totalDiscount)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">VATable</span><span>{formatCurrency(netOfVat)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span>{formatCurrency(vat)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Cost</span><span>{formatCurrency(totalCost)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-medium text-gray-700">Gross Profit</span><span className="font-bold text-emerald-600">{formatCurrency(grossProfit)} ({marginPct.toFixed(1)}%)</span></div>
              <div className="flex justify-between border-t-2 pt-3"><span className="text-lg font-bold">Total</span><span className="text-2xl font-bold text-gray-900">{formatCurrency(netTotal)}</span></div>
            </div>
            <button onClick={() => setPaymentModal(true)} className="w-full py-3 bg-blue-600 text-white rounded-xl text-base font-bold hover:bg-blue-700">Pay Now (F10)</button>
            <button onClick={suspendSale} className="w-full py-2.5 border-2 border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">Suspend (F5)</button>
          </div>
        )}
      </div>

      {/* Customer Modal */}
      {showCustomerModal && (
        <div className="modal-overlay" onClick={() => setShowCustomerModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Select Customer</h2>
              <input type="text" placeholder="Search customer..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm mb-3 focus:ring-2 focus:ring-blue-500 outline-none" autoFocus />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {customers.map((c) => (
                  <div key={c.id} onClick={() => { setCustomer(c); setShowCustomerModal(false); setCustomerSearch(''); }}
                    className="flex items-center justify-between px-3 py-2 hover:bg-blue-50 rounded cursor-pointer">
                    <div><p className="font-medium text-sm">{c.customer_name}</p><p className="text-xs text-gray-500">{c.customer_type}</p></div>
                    <p className="text-sm font-medium">{formatCurrency(c.balance)}</p>
                  </div>
                ))}
                {customers.length === 0 && customerSearch && <p className="text-center text-gray-400 py-4">No customers found</p>}
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={() => { setCustomer(null); setShowCustomerModal(false); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Walk-in Customer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quantity Modal */}
      {showQtyModal && (
        <div className="modal-overlay" onClick={() => setShowQtyModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center">
              <h2 className="text-lg font-semibold mb-2">Adjust Quantity</h2>
              <p className="text-sm text-gray-500 mb-4">{qtyTarget?.name}</p>
              <input type="number" value={newQty} onChange={(e) => setNewQty(parseInt(e.target.value) || 1)} min="1" autoFocus
                className="w-32 text-center text-2xl font-bold px-4 py-3 border-2 border-blue-500 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
              <div className="flex justify-center gap-3 mt-4">
                <button onClick={() => setShowQtyModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={() => { updateQuantity(qtyTarget?.cart_key, newQty); setShowQtyModal(false); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal && (
        <div className="modal-overlay" onClick={() => setPaymentModal(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-bold mb-4">Tender Payment</h2>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="text-red-600">{formatCurrency(totalDiscount)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">VAT</span><span>{formatCurrency(vat)}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-600">Gross Profit</span><span className="font-medium">{formatCurrency(grossProfit)}</span></div>
                </div>
                <div className="flex justify-between items-center border-t pt-3 mt-3">
                  <span className="text-lg font-bold">Grand Total</span>
                  <span className="text-3xl font-bold text-gray-900">{formatCurrency(netTotal)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {cart.length} items · {customer ? customer.customer_name : 'Walk-in'} · {priceMode}
                </div>
              </div>

              {/* Payment Methods */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {['Cash', 'GCash', 'Maya', 'Card', 'Check', 'Charge', 'Salary Ded.'].map((method) => (
                  <button key={method} onClick={() => { setPaymentMethod(method === 'Salary Ded.' ? 'Salary Deduction' : method === 'Card' ? 'Credit Card' : method === 'Check' ? 'Check' : method); setAmountTendered(''); }}
                    className={`py-3 rounded-lg text-sm font-bold border-2 ${paymentMethod === method || (method === 'Salary Ded.' && paymentMethod === 'Salary Deduction') || (method === 'Card' && paymentMethod === 'Credit Card') ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}>
                    {method}
                  </button>
                ))}
              </div>

              {/* Amount Tendered + Quick Buttons */}
              {(paymentMethod !== 'Charge' && paymentMethod !== 'Salary Deduction') && (
                <div className="mb-4">
                  <label className="block text-sm font-bold mb-1">Amount Tendered</label>
                  <input type="number" step="0.01" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} autoFocus
                    className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-right"
                    placeholder="0.00" />
                  {amountTendered && parseFloat(amountTendered) >= netTotal && (
                    <p className="text-right mt-2 text-xl font-bold text-green-600">
                      Change: {formatCurrency(Math.max(0, parseFloat(amountTendered) - netTotal))}
                    </p>
                  )}
                  {amountTendered && parseFloat(amountTendered) < netTotal && (
                    <p className="text-right mt-2 text-sm font-bold text-red-600">Insufficient Payment</p>
                  )}
                  {/* Quick Amounts */}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button onClick={() => setAmountTendered(netTotal.toFixed(2))} className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold hover:bg-blue-50 hover:border-blue-300">Exact</button>
                    {[100, 200, 500, 1000, 2000, 5000].map(amt => (
                      <button key={amt} onClick={() => setAmountTendered(amt.toString())}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">{formatCurrency(amt)}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Reference for non-cash */}
              {['GCash', 'Maya', 'Credit Card', 'Check'].includes(paymentMethod) && (
                <div className="mb-4">
                  <label className="block text-sm font-bold mb-1">Reference Number</label>
                  <input type="text" placeholder="Enter reference no." className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              )}

              {/* Charge info */}
              {paymentMethod === 'Charge' && customer && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm">
                  <p><span className="text-gray-500">Customer:</span> <strong>{customer.customer_name}</strong></p>
                  <p><span className="text-gray-500">Balance:</span> {formatCurrency(customer.balance)}</p>
                </div>
              )}

              {/* Salary Deduction info */}
              {paymentMethod === 'Salary Deduction' && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-4 text-sm">
                  <p className="text-purple-700 font-medium">Will be deducted from employee payroll</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button onClick={() => setPaymentModal(false)} className="flex-1 py-3.5 border-2 border-gray-300 rounded-xl text-base font-bold hover:bg-gray-50">Cancel</button>
                <button onClick={finalizeSale}
                  disabled={paymentMethod !== 'Charge' && paymentMethod !== 'Salary Deduction' && parseFloat(amountTendered || '0') < netTotal}
                  className="flex-1 py-3.5 bg-green-600 text-white rounded-xl text-base font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {paymentMethod === 'Charge' ? 'Charge Account' : paymentMethod === 'Salary Deduction' ? 'Deduct from Salary' : `Tender ${formatCurrency(parseFloat(amountTendered) || 0)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Recall Modal */}
      {showRecallModal && (
        <div className="modal-overlay" onClick={() => setShowRecallModal(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Recall Suspended Sale</h2>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {suspendedSales.length === 0 && <p className="text-center text-gray-400 py-8">No suspended sales</p>}
                {suspendedSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-gray-50">
                    <div>
                      <p className="font-medium text-sm">{sale.transaction_number}</p>
                      <p className="text-xs text-gray-500">{sale.customer_name || 'Walk-in'} - {sale.price_mode}</p>
                      <p className="text-xs text-gray-400">{new Date(sale.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatCurrency(sale.total)}</p>
                      <div className="flex gap-1 mt-1">
                        <button onClick={() => recallSale(sale)} className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Recall</button>
                        <button onClick={() => deleteSuspended(sale.id)} className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={() => setShowRecallModal(false)} className="px-4 py-2 border rounded-lg text-sm">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
