import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [highlightPos, setHighlightPos] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);
  const [shift, setShift] = useState<any>(null);
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [qtyTarget, setQtyTarget] = useState<any>(null);
  const [newQty, setNewQty] = useState(1);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [suspendedSales, setSuspendedSales] = useState<any[]>([]);
  const [locationId, setLocationId] = useState('1');
  const [chilledProduct, setChilledProduct] = useState<any>(null);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const lastReceiptRef = useRef<any>(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showPaymentComplete, setShowPaymentComplete] = useState(false);
  const [paymentResult, setPaymentResult] = useState<any>(null);
  const [showCashMove, setShowCashMove] = useState(false);
  const [cashMoveType, setCashMoveType] = useState<'in' | 'out'>('in');
  const [cashForm, setCashForm] = useState({ amount: '', reason: '' });
  const [referenceNumber, setReferenceNumber] = useState('');
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const paymentModalRef = useRef<HTMLDivElement>(null);
  const [printerSettings, setPrinterSettings] = useState<any>({ printer_name: '', printer_port: '', paper_size: 58, auto_print: false });

  // Search products
  useEffect(() => {
    if (search.length > 0) {
      api.get(`/products/search/quick?q=${search}`).then((res) => setProducts(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    } else {
      setProducts([]);
    }
  }, [search]);

  // Auto-focus payment complete modal
  useEffect(() => {
    if (showPaymentComplete) {
      setTimeout(() => paymentModalRef.current?.focus(), 100);
    }
  }, [showPaymentComplete]);

  // Load printer settings
  useEffect(() => {
    api.get('/settings/business-details').then(r => {
      if (r.data) setPrinterSettings({ printer_name: r.data.printer_name || '', printer_port: r.data.printer_port || '', paper_size: r.data.paper_size || 58, auto_print: r.data.auto_print || false });
    }).catch(() => {});
  }, []);

  // Flat list: products + variants for keyboard navigation
  const selectableItems = React.useMemo(() => {
    const items: any[] = [];
    for (const p of products) {
      items.push({ type: 'product', data: p });
      if (p.has_variants && p.variants?.length > 0) {
        for (const v of p.variants) {
          items.push({ type: 'variant', data: v, parent: p });
        }
      }
    }
    return items;
  }, [products]);

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
    const amt = parseFloat(openingCash);
    if (!amt || amt <= 0) { toast.error('Enter opening cash amount'); return; }
    try {
      await api.post('/pos/shifts/open', { opening_cash: amt });
      const res = await api.get('/pos/shifts/current'); setShift(res.data);
      toast.success('Shift opened');
      setShowOpenShift(false); setOpeningCash('');
    }
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
        payment_details: referenceNumber ? { reference: referenceNumber } : undefined,
        amount_tendered: tendered,
        location_id: locationId,
      });
      setLastReceipt({
        transaction_number: res.data.transaction_number,
        date: new Date(),
        items: [...cart],
        subtotal, totalDiscount, vat, netTotal, grossProfit, marginPct,
        paymentMethod, tendered, change: res.data.change,
        customerName: customer?.customer_name || 'Walk-in',
      });
      lastReceiptRef.current = {
        transaction_number: res.data.transaction_number,
        date: new Date(),
        items: [...cart],
        subtotal, totalDiscount, vat, netTotal, grossProfit, marginPct,
        paymentMethod, tendered, change: res.data.change,
        customerName: customer?.customer_name || 'Walk-in',
      };
      setCart([]);
      setAmountTendered('');
      setPaymentModal(false);
      setCustomer(null);
      setPaymentMethod('Cash');
      setReferenceNumber('');
      setPaymentResult({
        total: res.data.total,
        tendered: tendered,
        change: res.data.change || 0,
        grossProfit: res.data.gross_profit,
        marginPct: res.data.margin_pct,
      });
      setShowPaymentComplete(true);
      setTimeout(() => printReceipt(), 300);
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

  const printToThermal = async (text: string) => {
    const serverUrl = 'http://localhost:9999';
    try {
      // Connect using saved port first
      const savedPort = printerSettings.printer_port;
      if (savedPort) {
        const st = await fetch(`${serverUrl}/status`).then(r => r.json());
        if (st.port !== savedPort || !st.connected) {
          await fetch(`${serverUrl}/connect`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portPath: savedPort }),
          });
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        // Fall back to auto-connect
        const st = await fetch(`${serverUrl}/status`).then(r => r.json());
        if (!st.connected) {
          await fetch(`${serverUrl}/auto-connect`, { method: 'POST' });
          await new Promise(r => setTimeout(r, 500));
        }
      }
      const res = await fetch(`${serverUrl}/print`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) return true;
    } catch { /* fall back */ }
    return false;
  };

  // ========== 58mm Receipt Helpers (32 chars per line) ==========
  const centerText = (text: string, width = 32) => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  const leftRightText = (left: string, right: string, width = 32) => {
    const gap = width - left.length - right.length;
    return left + (gap > 0 ? ' '.repeat(gap) : ' ') + right;
  };
  const wrapItemName = (name: string, maxLen = 20) => {
    if (name.length <= maxLen) return [name];
    return [name.substring(0, maxLen), '  ' + name.substring(maxLen, maxLen + 20)];
  };

  const printReceipt = async (reprint = false) => {
    if (!lastReceipt && !lastReceiptRef.current) { toast.error('No receipt to print'); return; }
    const r = lastReceipt || lastReceiptRef.current;
    const fc = (v: number) => '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    // Thermal printer can't print ₱ — use PHP instead
    const ft = (v: number) => 'PHP' + v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    const W = 32; // 58mm = 32 chars
    const line = '='.repeat(W);
    const dash = '-'.repeat(W);

    // Build plain text receipt
    let text = '';
    text += centerText('D METRAN TRADING', W) + '\n';
    text += centerText('DMT POS', W) + '\n';
    text += centerText('Sta. Cruz Public Market, Zambales', W) + '\n';
    text += centerText('TIN: 123-456-789-000', W) + '\n';
    text += line + '\n';
    if (reprint) text += centerText('*** REPRINT COPY ***', W) + '\n';
    text += 'Receipt #: ' + r.transaction_number + '\n';
    text += 'Date: ' + r.date.toLocaleString('en-PH') + '\n';
    text += 'Cashier: Admin\n';
    text += 'Customer: ' + (r.customerName || 'Walk-in') + '\n';
    text += dash + '\n';
    text += leftRightText('ITEM', 'QTY   AMOUNT', W) + '\n';
    text += dash + '\n';
    for (const item of r.items) {
      const name = item.name || '';
      const qty = String(item.quantity);
      const itemTotal = ft(item.total || item.quantity * item.unit_price * (1 - (item.discount || 0) / 100));
      const lines = wrapItemName(name);
      text += leftRightText(lines[0], qty + '     ' + itemTotal, W) + '\n';
      if (lines[1]) text += lines[1] + '\n';
      if (item.discount > 0) text += '  (Disc: ' + item.discount + '%)\n';
    }
    text += dash + '\n';
    text += leftRightText('Subtotal:', ft(r.subtotal), W) + '\n';
    if (r.totalDiscount > 0) text += leftRightText('Discount:', ft(r.totalDiscount), W) + '\n';
    const vatableSales = r.subtotal - r.totalDiscount - r.vat;
    text += leftRightText('VATable Sales:', ft(vatableSales), W) + '\n';
    text += leftRightText('VAT 12%:', ft(r.vat), W) + '\n';
    text += dash + '\n';
    text += leftRightText('TOTAL:', ft(r.netTotal), W) + '\n';
    text += leftRightText(r.paymentMethod + ':', ft(r.tendered), W) + '\n';
    if (r.change > 0) text += leftRightText('Change:', ft(r.change), W) + '\n';
    text += line + '\n';
    text += centerText('THANK YOU!', W) + '\n';
    text += centerText('Please come again', W) + '\n';
    text += line + '\n\n';

    // Try thermal server first
    const printed = await printToThermal(text);
    if (printed) { toast.success('Receipt printed'); return; }

    // Fallback to window.print()
    toast('Sending to system printer...', { icon: '🖨️' });
    const itemsHTML = r.items.map((item: any) => {
      const itemTotal = fc(item.total || item.quantity * item.unit_price * (1 - (item.discount || 0) / 100));
      return `<tr><td style="font-size:8px;padding:1px 0">${item.name}</td><td style="font-size:8px;padding:1px 0;text-align:center">${item.quantity}</td><td style="font-size:8px;padding:1px 0;text-align:right">${itemTotal}</td></tr>`;
    }).join('');
    const w2 = window.open('', '_blank', 'width=300,height=600');
    if (!w2) return;
    w2.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:8px;width:58mm;padding:1mm;margin:0 auto;color:#000}.c{text-align:center}.l{border-top:1px dashed #000;margin:2px 0}.b{font-weight:bold}.r{text-align:right}table{width:100%;border-collapse:collapse}@media print{body{width:58mm}}</style></head><body>
<div class="c"><span class="b" style="font-size:11px">D METRAN TRADING</span><br>DMT POS<br>Sta. Cruz Public Market, Zambales<br>TIN: 123-456-789-000</div>
<div class="l"></div>
<div class="c">Receipt #: ${r.transaction_number}<br>Date: ${r.date.toLocaleString('en-PH')}<br>Cashier: Admin<br>Customer: ${r.customerName || 'Walk-in'}</div>
<div class="l"></div>
<table><thead><tr><th style="text-align:left;font-size:7px">ITEM</th><th style="text-align:center;font-size:7px">QTY</th><th class="r" style="font-size:7px">AMOUNT</th></tr></thead><tbody>${itemsHTML}</tbody></table>
<div class="l"></div>
<table>
<tr><td>Subtotal:</td><td class="r">${fc(r.subtotal)}</td></tr>
${r.totalDiscount > 0 ? '<tr><td>Discount:</td><td class="r">'+fc(r.totalDiscount)+'</td></tr>' : ''}
<tr><td>VATable Sales:</td><td class="r">${fc(r.subtotal - r.totalDiscount - r.vat)}</td></tr>
<tr><td>VAT 12%:</td><td class="r">${fc(r.vat)}</td></tr>
</table>
<div class="l"></div>
<div class="b" style="font-size:11px">${leftRightText('TOTAL:', fc(r.netTotal))}</div>
<div>${leftRightText(r.paymentMethod + ':', fc(r.tendered))}</div>
${r.change > 0 ? '<div>'+leftRightText('Change:', fc(r.change))+'</div>' : ''}
<div class="l"></div>
<div class="c"><span class="b">THANK YOU!</span><br>Please come again</div>
<script>window.onload=function(){window.print();window.close();}</script>
</body></html>`);
    w2.document.close();
  };

  const printXReading = async () => {
    if (!shift) { toast.error('No open shift'); return; }
    try {
      const res = await api.get('/pos/shifts/' + shift.id);
      const s = res.data; const txs = s.transactions || [];
      const fc = (v: number) => v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
      const W = 32; const line = '='.repeat(W); const dash = '-'.repeat(W);
      const totalTx = txs.filter((t: any) => t.status === 'Completed').length;
      const totalVoid = txs.filter((t: any) => t.status === 'Void').length;
      let text = '';
      text += centerText('D METRAN TRADING', W) + '\n';
      text += centerText('X READING', W) + '\n';
      text += centerText('(Mid-Shift Report)', W) + '\n';
      text += line + '\n';
      text += 'Shift #: ' + (s.shift_number || '') + '\n';
      text += 'Cashier: ' + (s.full_name || user?.full_name || '') + '\n';
      text += 'Open: ' + new Date(s.opening_date || s.created_at).toLocaleString('en-PH') + '\n';
      text += 'Status: OPEN\n';
      text += dash + '\n';
      text += leftRightText('Cash Sales:', fc(parseFloat(s.cash_sales) || 0), W) + '\n';
      text += leftRightText('GCash:', fc(parseFloat(s.gcash_sales) || 0), W) + '\n';
      text += leftRightText('Maya:', fc(parseFloat(s.maya_sales) || 0), W) + '\n';
      text += leftRightText('Card:', fc(parseFloat(s.card_sales) || 0), W) + '\n';
      text += leftRightText('Bank Transfer:', fc(parseFloat(s.bank_transfer_sales) || 0), W) + '\n';
      text += leftRightText('Charge:', fc(parseFloat(s.charge_sales) || 0), W) + '\n';
      text += dash + '\n';
      text += leftRightText('Total Sales:', fc(parseFloat(s.total_sales) || 0), W) + '\n';
      text += leftRightText('Discounts:', fc(parseFloat(s.discount_total) || 0), W) + '\n';
      text += leftRightText('Net Sales:', fc(parseFloat(s.net_sales) || 0), W) + '\n';
      text += leftRightText('Voids:', fc(parseFloat(s.void_total) || 0), W) + '\n';
      text += leftRightText('Returns:', fc(parseFloat(s.return_total) || 0), W) + '\n';
      text += dash + '\n';
      text += 'Transactions: ' + totalTx + ' | Voids: ' + totalVoid + '\n';
      text += line + '\n';
      text += centerText(new Date().toLocaleString('en-PH'), W) + '\n\n';
      await printToThermal(text);
      toast.success('X Reading printed');
    } catch { toast.error('Failed to load shift data'); }
  };

  const printZReading = async () => {
    try {
      const res = await api.get('/pos/shifts?limit=1&status=Closed');
      const shifts = res.data?.data || res.data || [];
      if (shifts.length === 0) { toast.error('No closed shifts found'); return; }
      const s = shifts[0];
      const res2 = await api.get('/pos/shifts/' + s.id);
      const detail = res2.data; const txs = detail.transactions || [];
      const fc = (v: number) => v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
      const W = 32; const line = '='.repeat(W); const dash = '-'.repeat(W);
      const totalTx = txs.filter((t: any) => t.status === 'Completed').length;
      const totalVoid = txs.filter((t: any) => t.status === 'Void').length;
      let text = '';
      text += centerText('D METRAN TRADING', W) + '\n';
      text += centerText('Z READING', W) + '\n';
      text += centerText('(End-of-Shift Report)', W) + '\n';
      text += line + '\n';
      text += 'Shift #: ' + (s.shift_number || '') + '\n';
      text += 'Cashier: ' + (s.full_name || '') + '\n';
      text += 'Open: ' + new Date(s.opening_date || s.created_at).toLocaleString('en-PH') + '\n';
      text += 'Close: ' + new Date(s.closing_date).toLocaleString('en-PH') + '\n';
      text += 'Status: CLOSED\n';
      text += dash + '\n';
      text += leftRightText('Cash Sales:', fc(parseFloat(s.cash_sales) || 0), W) + '\n';
      text += leftRightText('GCash:', fc(parseFloat(s.gcash_sales) || 0), W) + '\n';
      text += leftRightText('Maya:', fc(parseFloat(s.maya_sales) || 0), W) + '\n';
      text += leftRightText('Card:', fc(parseFloat(s.card_sales) || 0), W) + '\n';
      text += leftRightText('Bank Transfer:', fc(parseFloat(s.bank_transfer_sales) || 0), W) + '\n';
      text += leftRightText('Charge:', fc(parseFloat(s.charge_sales) || 0), W) + '\n';
      text += dash + '\n';
      text += leftRightText('Total Sales:', fc(parseFloat(s.total_sales) || 0), W) + '\n';
      text += leftRightText('Discounts:', fc(parseFloat(s.discount_total) || 0), W) + '\n';
      text += leftRightText('Net Sales:', fc(parseFloat(s.net_sales) || 0), W) + '\n';
      text += leftRightText('Voids:', fc(parseFloat(s.void_total) || 0), W) + '\n';
      text += dash + '\n';
      text += leftRightText('Opening Cash:', fc(parseFloat(s.opening_cash) || 0), W) + '\n';
      text += leftRightText('Closing Cash:', fc(parseFloat(s.closing_cash) || 0), W) + '\n';
      const variance = parseFloat(s.closing_cash || '0') - parseFloat(s.expected_cash || '0');
      text += leftRightText('Variance:', fc(variance), W) + '\n';
      text += dash + '\n';
      text += 'Transactions: ' + totalTx + ' | Voids: ' + totalVoid + '\n';
      text += line + '\n';
      text += centerText(new Date().toLocaleString('en-PH'), W) + '\n\n';
      await printToThermal(text);
      toast.success('Z Reading printed');
    } catch { toast.error('Failed to load shift data'); }
  };

  const checkPrinter = async () => {
    setShowMoreOptions(false);
    const info: string[] = [];
    // Try local print server
    try {
      const st = await fetch('http://localhost:9999/status').then(r => r.json());
      if (st.connected) {
        toast.success(`Printer connected on ${st.port}`);
        return;
      }
      // Try auto-connect
      const ac = await fetch('http://localhost:9999/auto-connect', { method: 'POST' }).then(r => r.json());
      if (ac.connected) {
        toast.success(`Connected to ${ac.port} — ${ac.friendlyName || ac.manufacturer || 'Printer'}`);
        return;
      }
      // Try scanning
      const ports = await fetch('http://localhost:9999/scan').then(r => r.json());
      if (ports.length > 0) {
        toast(ports.map((p: any) => `${p.path}: ${p.friendlyName || p.manufacturer || 'Unknown'}`).join(' | '), { duration: 8000 });
        return;
      }
      info.push('No COM ports found — is printer paired via Windows Bluetooth?');
    } catch { info.push('Print server not running — start thermal-print-server'); }
    toast(info.join(' | ') || 'Check Windows > Bluetooth & devices', { duration: 6000 });
  };

  const submitCashMove = async () => {
    const amt = parseFloat(cashForm.amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await api.post('/pos/' + (cashMoveType === 'in' ? 'cash-in' : 'cash-out'), cashForm);
      toast.success(`Cash ${cashMoveType === 'in' ? 'In' : 'Out'}: ₱${amt.toLocaleString('en-PH', {minimumFractionDigits: 2})}`);
      if (shift) setShift({ ...shift, expected_cash: res.data.expected_cash });
      setShowCashMove(false); setCashForm({ amount: '', reason: '' });
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openCashMove = (type: 'in' | 'out') => {
    setCashMoveType(type); setCashForm({ amount: '', reason: '' }); setShowCashMove(true);
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
    if (showQtyModal) {
      setTimeout(() => qtyRef.current?.select(), 100);
    }
  }, [showQtyModal]);

  useEffect(() => {
    if (paymentModal && netTotal > 0) {
      setAmountTendered(netTotal.toFixed(2));
      setTimeout(() => amountRef.current?.select(), 100);
    }
  }, [paymentModal, netTotal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); if (cart.length > 0) { setQtyTarget(cart[cart.length - 1]); setNewQty(cart[cart.length - 1].quantity); setShowQtyModal(true); } }
      if (e.key === 'F2') { e.preventDefault(); toast('Price override: click item price'); }
      if (e.key === 'F3') { e.preventDefault(); toast('Discount: enter discount % on item'); }
      if (e.key === 'F4') { e.preventDefault(); setShowCustomerModal(true); }
      if (e.key === 'F5') { e.preventDefault(); setShowMoreOptions(true); }
      if (e.key === 'F6') { e.preventDefault(); loadSuspendedSales(); }
      if (e.key === 'F10') { e.preventDefault(); if (cart.length > 0) setPaymentModal(true); }
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        e.preventDefault();
        if (cart.length > 0) setPaymentModal(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCustomerModal(false);
        setShowQtyModal(false);
        setPaymentModal(false);
        setShowRecallModal(false);
        setChilledProduct(null);
      }
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
              <button onClick={() => setShowOpenShift(true)} className="px-6 py-3 bg-blue-600 text-white rounded-lg text-lg font-medium hover:bg-blue-700">Open Shift</button>
            </div>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-3">
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search product by name, SKU, or barcode... (Enter to pay)"
                value={search} onChange={(e) => { setSearch(e.target.value); setHighlightPos(0); }} autoFocus
                onKeyDown={(e) => {
                  const max = selectableItems.length - 1;
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightPos(h => Math.min(h + 1, max)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightPos(h => Math.max(h - 1, 0)); }
                  else if (e.key === 'Enter' && search.trim().length > 0) {
                    e.preventDefault();
                    const looksLikeBarcode = /^\d{5,}$/.test(search.trim());
                    if (looksLikeBarcode) {
                      api.get(`/products/search/exact?q=${search.trim()}`).then((res) => {
                        if (res.data) {
                          const p = res.data;
                          if (p.has_chilled_variant && priceMode === 'Retail') {
                            setChilledProduct(p);
                          } else {
                            addToCart(p);
                          }
                          setSearch(''); setHighlightPos(0);
                        }
                      }).catch(() => {});
                    } else if (selectableItems.length > 0) {
                      const item = selectableItems[highlightPos];
                      if (!item) return;
                      if (item.type === 'variant') {
                        const p = item.parent;
                        const v = item.data;
                        const price = priceMode === 'Retail' ? p.retail_price : priceMode === 'Wholesale' ? p.wholesale_price : p.distributor_price;
                        const varPrice = priceMode === 'Retail' ? (v.retail_price || price + (v.additional_cost || 0)) : price + (v.additional_cost || 0);
                        addToCart({ ...p, retail_price: varPrice, wholesale_price: varPrice, distributor_price: varPrice, name: `${p.name} - ${v.name}` });
                        setSearch(''); setHighlightPos(0);
                      } else {
                        const p = item.data;
                        const price = priceMode === 'Retail' ? p.retail_price : priceMode === 'Wholesale' ? p.wholesale_price : p.distributor_price;
                        const hasVariants = p.has_variants && p.variants && p.variants.length > 0;
                        const showChilledOption = p.has_chilled_variant && priceMode === 'Retail';
                        if (hasVariants) {
                          const v = p.variants[0];
                          const varPrice = priceMode === 'Retail' ? (v.retail_price || price + (v.additional_cost || 0)) : price + (v.additional_cost || 0);
                          addToCart({ ...p, retail_price: varPrice, wholesale_price: varPrice, distributor_price: varPrice, name: `${p.name} - ${v.name}` });
                          setSearch(''); setHighlightPos(0);
                        } else if (showChilledOption) {
                          setChilledProduct(p);
                        } else {
                          addToCart(p); setSearch(''); setHighlightPos(0);
                        }
                      }
                    }
                  }
                }}
                className="w-full pl-12 pr-4 py-3.5 border-2 border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>

            {/* Product Results */}
            {search && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3 max-h-60 overflow-y-auto shadow-lg">
                {products.map((p, prodIdx) => {
                  const price = priceMode === 'Retail' ? p.retail_price : priceMode === 'Wholesale' ? p.wholesale_price : p.distributor_price;
                  const hasVariants = p.has_variants && p.variants && p.variants.length > 0;
                  const showChilledOption = p.has_chilled_variant && priceMode === 'Retail';
                  // Find flat index for this product
                  const flatIdx = selectableItems.findIndex(item => item.type === 'product' && item.data.id === p.id);
                  const handleClick = () => {
                    if (hasVariants) return;
                    if (showChilledOption) { setChilledProduct(p); return; }
                    addToCart(p);
                  };
                  return (
                    <div key={p.id}>
                      <div onClick={handleClick}
                        className={`flex items-center justify-between px-4 py-3 hover:bg-blue-50 border-b border-gray-100 ${hasVariants ? 'cursor-default' : 'cursor-pointer'} ${flatIdx === highlightPos ? 'bg-blue-200' : ''}`}>
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
                            const varFlatIdx = selectableItems.findIndex(item => item.type === 'variant' && item.data.id === v.id && item.parent.id === p.id);
                            return (
                              <div key={v.id}
                                onClick={() => addToCart({ ...p, retail_price: varPrice, wholesale_price: varPrice, distributor_price: varPrice, name: `${p.name} - ${v.name}` })}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg hover:bg-blue-100 cursor-pointer border border-gray-100 ${varFlatIdx === highlightPos ? 'bg-blue-200' : 'bg-gray-50'}`}>
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
            {chilledProduct && (() => {
              const chilledHighlight = 0;
              return (
              <div className="modal-overlay" onClick={() => setChilledProduct(null)}>
                <div className="modal-content max-w-xs" onClick={(e) => e.stopPropagation()} tabIndex={0} autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setChilledProduct(null); }
                  }}>
                  <div className="p-6 text-center">
                    <p className="text-lg font-semibold mb-1">{chilledProduct.name}</p>
                    <p className="text-sm text-gray-500 mb-4">Select variant (Enter to confirm)</p>
                    <button onClick={() => { const p = chilledProduct; addToCart(p); }}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const p = chilledProduct; addToCart(p); } }}
                      className="w-full py-3 mb-2 bg-white border-2 border-gray-300 rounded-lg font-semibold text-lg hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none">
                      Regular - {formatCurrency(priceMode === 'Retail' ? chilledProduct.retail_price : priceMode === 'Wholesale' ? chilledProduct.wholesale_price : chilledProduct.distributor_price)}
                    </button>
                    <button onClick={() => { addToCart(chilledProduct, 'Chilled'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToCart(chilledProduct, 'Chilled'); } }}
                      className="w-full py-3 bg-cyan-50 border-2 border-cyan-300 rounded-lg font-semibold text-lg text-cyan-700 hover:bg-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none">
                      Chilled - {formatCurrency(chilledProduct.chilled_price)}
                    </button>
                    <button onClick={() => setChilledProduct(null)} className="mt-3 text-sm text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                </div>
              </div>
              );
            })()}

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
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                  <span className="text-gray-400">Printer: </span><span className={`font-medium text-xs ${printerSettings.printer_name ? 'text-green-600' : 'text-gray-400'}`}>{printerSettings.printer_name ? `${printerSettings.printer_name} ${printerSettings.paper_size}mm` : 'Not Set'}</span>
                  {printerSettings.auto_print && <span className="ml-1 text-[10px] text-blue-600">Auto</span>}
                </div>
                {shift && (
                  <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                    <span className="text-gray-400">Cash Drawer: </span><span className="font-medium text-xs text-amber-700">{formatCurrency(parseFloat(shift.expected_cash) || parseFloat(shift.opening_cash) || 0)}</span>
                  </div>
                )}
                <button onClick={closeShift} className="px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200">
                  <RotateCcw size={14} className="inline mr-1" />Close
                </button>
                <button onClick={() => openCashMove('in')} className="px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200">
                  + Cash In
                </button>
                <button onClick={() => openCashMove('out')} className="px-3 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200">
                  - Cash Out
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
            <button onClick={() => setShowMoreOptions(true)} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-purple-50 rounded-lg text-sm font-medium w-full">
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
            <button onClick={suspendSale} className="w-full py-2.5 border-2 border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">Suspend (F3)</button>
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
              <input type="number" value={newQty} onChange={(e) => setNewQty(parseInt(e.target.value) || 1)} min="1" ref={qtyRef}
                onKeyDown={(e) => { if (e.key === 'Enter') { updateQuantity(qtyTarget?.cart_key, newQty); setShowQtyModal(false); } }}
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
                  <button key={method} onClick={() => { setPaymentMethod(method === 'Salary Ded.' ? 'Salary Deduction' : method === 'Card' ? 'Credit Card' : method === 'Check' ? 'Check' : method); }}
                    className={`py-3 rounded-lg text-sm font-bold border-2 ${paymentMethod === method || (method === 'Salary Ded.' && paymentMethod === 'Salary Deduction') || (method === 'Card' && paymentMethod === 'Credit Card') ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}>
                    {method}
                  </button>
                ))}
              </div>

              {/* Amount Tendered + Quick Buttons */}
              {(paymentMethod !== 'Charge' && paymentMethod !== 'Salary Deduction') && (
                <div className="mb-4">
                  <label className="block text-sm font-bold mb-1">Amount Tendered</label>
                  <input type="number" step="0.01" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} ref={amountRef}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const tendered = parseFloat(amountTendered) || 0;
                        const isCharge = paymentMethod === 'Charge' || paymentMethod === 'Salary Deduction';
                        if (isCharge || tendered >= netTotal) finalizeSale();
                      }
                    }}
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
                  <input type="text" placeholder="Enter reference no." value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
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

      {/* More Options Modal */}
      {showMoreOptions && (
        <div className="modal-overlay" onClick={() => setShowMoreOptions(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">More Options</h2>
              <div className="space-y-2">
                <button onClick={() => { setShowCustomerModal(true); setShowMoreOptions(false); }} className="w-full px-4 py-3 text-left text-sm rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium">Select Customer</button>
                <button onClick={() => { setShowReceiptPreview(true); setShowMoreOptions(false); }} disabled={!lastReceipt && !lastReceiptRef.current} className="w-full px-4 py-3 text-left text-sm rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium disabled:opacity-50">Receipt Preview</button>
                <button onClick={() => { printReceipt(); setShowMoreOptions(false); }} disabled={!lastReceipt && !lastReceiptRef.current} className="w-full px-4 py-3 text-left text-sm rounded-lg bg-green-50 hover:bg-green-100 text-green-700 font-medium disabled:opacity-50">Print Last Receipt</button>
                <button onClick={() => { checkPrinter(); setShowMoreOptions(false); }} className="w-full px-4 py-3 text-left text-sm rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 font-medium">Check Printer</button>
                <button onClick={() => { printXReading(); setShowMoreOptions(false); }} disabled={!shift} className="w-full px-4 py-3 text-left text-sm rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium disabled:opacity-50">X Reading (Mid-Shift)</button>
                <button onClick={() => { printZReading(); setShowMoreOptions(false); }} className="w-full px-4 py-3 text-left text-sm rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-medium">Z Reading (End-of-Day)</button>
                <button onClick={() => setShowMoreOptions(false)} className="w-full px-4 py-3 text-center text-sm rounded-lg border hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Preview Modal — 58mm layout */}
      {showReceiptPreview && lastReceipt && (() => {
        const r = lastReceipt;
        const fc = (v: number) => '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2 });
        const W = 32;
        const L = (l: string, rr: string) => l + ' '.repeat(Math.max(1, W - l.length - rr.length)) + rr;
        const C = (t: string) => ' '.repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t;
        const line = '='.repeat(W);
        const dash = '-'.repeat(W);
        const lines = [
          C('D METRAN TRADING'), C('DMT POS'), C('Sta. Cruz Public Market, Zambales'), C('TIN: 123-456-789-000'),
          line, 'Receipt #: ' + r.transaction_number, 'Date: ' + r.date.toLocaleString('en-PH'),
          'Cashier: Admin', 'Customer: ' + (r.customerName || 'Walk-in'), dash,
          L('ITEM', 'QTY   AMOUNT'), dash,
        ];
        for (const item of r.items) {
          const itemTotal = fc(item.total || item.quantity * item.unit_price * (1 - (item.discount || 0) / 100));
          lines.push(L(item.name.substring(0, 18), String(item.quantity) + '     ' + itemTotal));
        }
        const vatSales = r.subtotal - r.totalDiscount - r.vat;
        lines.push(dash, L('Subtotal:', fc(r.subtotal)));
        if (r.totalDiscount > 0) lines.push(L('Discount:', fc(r.totalDiscount)));
        lines.push(L('VATable Sales:', fc(vatSales)), L('VAT 12%:', fc(r.vat)), dash);
        lines.push(L('TOTAL:', fc(r.netTotal)));
        lines.push(L(r.paymentMethod + ':', fc(r.tendered)));
        if (r.change > 0) lines.push(L('Change:', fc(r.change)));
        lines.push(line, C('THANK YOU!'), C('Please come again'), line);
        return (
          <div className="modal-overlay" onClick={() => setShowReceiptPreview(false)}>
            <div className="modal-content max-w-xs" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center p-3 border-b bg-gray-50">
                <h2 className="text-sm font-semibold">Receipt Preview</h2>
                <div className="flex gap-2">
                  <button onClick={() => printReceipt()} className="px-3 py-1 bg-green-600 text-white rounded text-xs">Print</button>
                  <button onClick={() => setShowReceiptPreview(false)} className="px-3 py-1 border rounded text-xs">Close</button>
                </div>
              </div>
              <div className="p-3 bg-white overflow-auto max-h-[70vh]">
                <pre style={{ fontFamily: '"Courier New", monospace', fontSize: '7.5px', lineHeight: '1.3', width: '58mm', margin: '0 auto', whiteSpace: 'pre', background: '#fff', color: '#000' }}>
                  {lines.join('\n')}
                </pre>
              </div>
            </div>
          </div>
        );
      })(      )}

      {/* Payment Complete Modal */}
      {showPaymentComplete && paymentResult && (
        <div className="modal-overlay" onClick={() => { setShowPaymentComplete(false); setPaymentResult(null); }}>
          <div className="modal-content max-w-sm text-center" onClick={e => e.stopPropagation()} tabIndex={-1} ref={paymentModalRef}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setShowPaymentComplete(false);
                setPaymentResult(null);
                setTimeout(() => {
                  const searchInput = document.querySelector('input[placeholder*="Search product"]') as HTMLInputElement;
                  if (searchInput) searchInput.focus();
                }, 100);
              }
            }}>
            <div className="p-8">
              <div className="text-4xl mb-4">✓</div>
              <h2 className="text-xl font-bold text-green-600 mb-4">Payment Complete</h2>
              <div className="space-y-2 text-sm mb-6">
                <div className="flex justify-between"><span className="text-gray-500">Total Amount:</span><span className="font-bold text-lg">{formatCurrency(paymentResult.total)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Tender Amount:</span><span className="font-medium">{formatCurrency(paymentResult.tendered)}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="text-gray-500">Change:</span><span className="font-bold text-green-600">{formatCurrency(paymentResult.change)}</span></div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-700 font-medium">Press <kbd className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs">Enter</kbd> for New Transaction</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash In / Cash Out Modal */}
      {showCashMove && (
        <div className="modal-overlay" onClick={() => setShowCashMove(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{cashMoveType === 'in' ? 'Cash In' : 'Cash Out'}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Amount</label>
                  <input type="number" step="0.01" value={cashForm.amount} onChange={e => setCashForm({ ...cashForm, amount: e.target.value })} autoFocus
                    className="w-full px-4 py-3 text-2xl font-bold border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-right" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reason</label>
                  <input type="text" value={cashForm.reason} onChange={e => setCashForm({ ...cashForm, reason: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder={cashMoveType === 'in' ? 'e.g. Additional float' : 'e.g. Petty cash expense'} />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setShowCashMove(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitCashMove} className={`px-6 py-2 text-white rounded-lg text-sm font-medium ${cashMoveType === 'in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                  {cashMoveType === 'in' ? 'Cash In' : 'Cash Out'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Open Shift Modal */}
      {showOpenShift && (
        <div className="modal-overlay" onClick={() => setShowOpenShift(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Open Shift</h2>
              <p className="text-sm text-gray-500 mb-4">Enter the opening cash float amount</p>
              <div>
                <label className="block text-sm font-medium mb-1">Opening Cash Float <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" value={openingCash} onChange={e => setOpeningCash(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') openShift(); }}
                  className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-right" placeholder="0.00" />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowOpenShift(false); setOpeningCash(''); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={openShift} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Open Shift</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
