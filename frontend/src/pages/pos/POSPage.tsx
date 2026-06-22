import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatQuantity, computeVAT, PRICE_MODES, parseNumericField, parseIntegerField } from '../../lib/utils';
import {
  PRIMARY, FINANCE_FONT, financeTabClass, POS_TABS, PosTabKey,
  PAYMENT_METHODS_UI, buildReceiptText, buildThermalPrintHtml, printHtmlToBrowser, buildXReadingText, buildZReadingText,
  pushRecentProduct, loadRecentProducts, THERMAL_PRINT_SERVER, THERMAL_PRINT_START_HINT,
} from '../../lib/posUtils';
import { useAuth } from '../../store/auth';
import {
  Search, X, Minus, Plus, ShoppingCart, User, RotateCcw, Printer, RefreshCw,
  Monitor, History, Settings2, Ban, Receipt, Wallet, BarChart3, Banknote, Smartphone, CreditCard, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';

const TAB_ICONS: Record<PosTabKey, React.ElementType> = {
  register: Monitor,
  sales: BarChart3,
  history: History,
  advanced: Settings2,
};

const PAYMENT_METHOD_GROUPS = [
  { id: 'cash', label: 'Cash', icon: Banknote, methods: ['Cash'] as const },
  { id: 'digital', label: 'Digital / Card', icon: Smartphone, methods: ['GCash', 'Maya', 'Credit Card', 'Check'] as const },
  { id: 'account', label: 'On Account', icon: CreditCard, methods: ['Charge', 'Salary Deduction'] as const },
];

const REFERENCE_PAYMENT_METHODS = new Set(['GCash', 'Maya', 'Credit Card', 'Check']);
const NON_TENDER_METHODS = new Set(['Charge', 'Salary Deduction']);

type PaymentCompleteResult = {
  transaction_number: string;
  total: number;
  tendered: number;
  change: number;
  grossProfit?: number;
  marginPct?: number;
  paymentMethod: string;
  customerName?: string;
  priceMode?: string;
};

const SHORTCUTS = [
  { key: 'F1', action: 'Adjust quantity (last item)' },
  { key: 'F2', action: 'Price override hint' },
  { key: 'F3', action: 'Suspend sale' },
  { key: 'F4', action: 'Select customer' },
  { key: 'F5', action: 'Advanced tab' },
  { key: 'F6', action: 'Recall suspended sale' },
  { key: 'F9', action: 'Clear cart' },
  { key: 'F10', action: 'Open payment' },
  { key: 'Enter', action: 'Open payment (outside inputs)' },
  { key: 'Esc', action: 'Close modals' },
];

type CartItem = {
  cart_key: string;
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  cost: number;
  selected_variant?: string;
  has_chilled_variant?: boolean;
};

function lineGross(item: CartItem) {
  return item.quantity * item.unit_price;
}

function lineAfterItemDiscount(item: CartItem) {
  return lineGross(item) * (1 - (item.discount || 0) / 100);
}

export default function POSPage() {
  const { user, hasPerm } = useAuth();
  const canWrite = hasPerm('pos.write');

  const [activeTab, setActiveTab] = useState<PosTabKey>('register');
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchRequestRef = useRef(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscountPct, setCartDiscountPct] = useState<string | number>('');
  const [priceMode, setPriceMode] = useState<'Retail' | 'Wholesale' | 'Distributor'>('Retail');
  const [customer, setCustomer] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentMethodIndex, setPaymentMethodIndex] = useState(0);
  const [paymentFocusStep, setPaymentFocusStep] = useState<'method' | 'employee' | 'tender'>('method');
  const [employeeHighlightIndex, setEmployeeHighlightIndex] = useState(0);
  const [amountTendered, setAmountTendered] = useState('');
  const paymentModalContentRef = useRef<HTMLDivElement>(null);
  const employeeListRef = useRef<HTMLDivElement>(null);
  const confirmDeductionRef = useRef<HTMLButtonElement>(null);
  const [highlightPos, setHighlightPos] = useState(0);
  const searchListRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [shift, setShift] = useState<any>(null);
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [qtyTarget, setQtyTarget] = useState<CartItem | null>(null);
  const [newQty, setNewQty] = useState<string | number>('1');
  const qtyRef = useRef<HTMLInputElement>(null);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [suspendedSales, setSuspendedSales] = useState<any[]>([]);
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  const [chilledProduct, setChilledProduct] = useState<any>(null);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const lastReceiptRef = useRef<any>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showPaymentComplete, setShowPaymentComplete] = useState(false);
  const [paymentResult, setPaymentResult] = useState<PaymentCompleteResult | null>(null);
  const [showCashMove, setShowCashMove] = useState(false);
  const [cashMoveType, setCashMoveType] = useState<'in' | 'out'>('in');
  const [cashForm, setCashForm] = useState({ amount: '', reason: '' });
  const [referenceNumber, setReferenceNumber] = useState('');
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [closingCash, setClosingCash] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const paymentModalRef = useRef<HTMLDivElement>(null);
  const [printerSettings, setPrinterSettings] = useState<any>({ printer_name: '', printer_port: '', paper_size: 58, auto_print: false });
  const [businessDetails, setBusinessDetails] = useState<any>({});
  const [recentProducts, setRecentProducts] = useState<any[]>(() => loadRecentProducts());
  const [shiftTransactions, setShiftTransactions] = useState<any[]>([]);
  const [shiftHistory, setShiftHistory] = useState<any[]>([]);
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [shiftDetail, setShiftDetail] = useState<any>(null);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState('');

  const receiptOpts = useMemo(() => ({
    businessName: businessDetails.business_name,
    businessAddress: businessDetails.address,
    tin: businessDetails.tin_number,
    cashierName: user?.full_name,
    paperSize: printerSettings.paper_size || 58,
  }), [businessDetails, user, printerSettings.paper_size]);

  const afterLineDiscount = useMemo(
    () => cart.reduce((s, i) => s + lineAfterItemDiscount(i), 0),
    [cart],
  );

  const cartDiscountPctNum = useMemo(() => Math.min(100, Math.max(0, parseNumericField(cartDiscountPct))), [cartDiscountPct]);

  const cartDiscountAmount = useMemo(
    () => afterLineDiscount * (cartDiscountPctNum / 100),
    [afterLineDiscount, cartDiscountPctNum],
  );

  const lineTotal = useCallback((item: CartItem) => {
    const base = lineAfterItemDiscount(item);
    if (afterLineDiscount <= 0 || cartDiscountPctNum <= 0) return base;
    return base - (base / afterLineDiscount) * cartDiscountAmount;
  }, [afterLineDiscount, cartDiscountAmount, cartDiscountPctNum]);

  const lineGP = useCallback((item: CartItem) => {
    return lineTotal(item) - (item.cost || 0) * item.quantity;
  }, [lineTotal]);

  const effectiveDiscount = useCallback((item: CartItem) => {
    const gross = lineGross(item);
    if (gross <= 0) return item.discount || 0;
    return (1 - lineTotal(item) / gross) * 100;
  }, [lineTotal]);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + lineGross(i), 0), [cart]);
  const totalDiscount = subtotal - afterLineDiscount + cartDiscountAmount;
  const netTotal = afterLineDiscount - cartDiscountAmount;
  const { netOfVat, vat } = computeVAT(netTotal);
  const totalCost = useMemo(() => cart.reduce((s, i) => s + (i.cost || 0) * i.quantity, 0), [cart]);
  const grossProfit = netTotal - totalCost;
  const marginPct = netTotal > 0 ? (grossProfit / netTotal) * 100 : 0;

  const salesSummary = useMemo(() => {
    const completed = shiftTransactions.filter((t) => t.status === 'Completed');
    const voided = shiftTransactions.filter((t) => t.status === 'Void');
    return {
      completedCount: completed.length,
      voidCount: voided.length,
      totalSales: completed.reduce((s, t) => s + parseFloat(t.total || 0), 0),
    };
  }, [shiftTransactions]);

  const refreshShift = useCallback(async () => {
    try {
      const res = await api.get('/pos/shifts/current');
      setShift(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load shift');
    }
  }, []);

  const loadCurrentTransactions = useCallback(async () => {
    try {
      const res = await api.get('/pos/transactions/current');
      setShiftTransactions(res.data?.data || []);
    } catch {
      setShiftTransactions([]);
    }
  }, []);

  const loadShiftHistory = useCallback(async () => {
    try {
      const res = await api.get('/pos/shifts?limit=30');
      setShiftHistory(res.data?.data || res.data || []);
    } catch {
      setShiftHistory([]);
    }
  }, []);

  const loadShiftDetail = useCallback(async (id: string) => {
    try {
      const res = await api.get(`/pos/shifts/${id}`);
      setShiftDetail(res.data);
    } catch {
      toast.error('Failed to load shift detail');
    }
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setProducts([]);
      setSearchLoading(false);
      return;
    }

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const requestId = ++searchRequestRef.current;
    setSearchLoading(true);

    searchDebounceRef.current = setTimeout(() => {
      const loc = locationId || '1';
      api.get(`/products/search/quick?q=${encodeURIComponent(search.trim())}&location_id=${loc}`)
        .then((res) => {
          if (searchRequestRef.current !== requestId) return;
          setProducts((res.data || []).map((p: any) => ({
            ...p,
            variants: Array.isArray(p.variants) ? p.variants : [],
          })));
        })
        .catch((err) => {
          if (searchRequestRef.current !== requestId) return;
          toast.error(err.response?.data?.error || 'Failed to load products');
          setProducts([]);
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setSearchLoading(false);
        });
    }, 250);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search, locationId]);

  useEffect(() => {
    api.get('/settings/business-details').then((r) => {
      if (r.data) {
        setBusinessDetails(r.data);
        setPrinterSettings({
          printer_name: r.data.printer_name || '',
          printer_port: r.data.printer_port || '',
          paper_size: r.data.paper_size || 58,
          auto_print: r.data.auto_print || false,
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/inventory/locations').then((r) => {
      const locs = r.data || [];
      setLocations(locs);
      if (locs.length > 0) {
        setLocationId((prev) => {
          if (prev) return prev;
          const store = locs.find((l: any) => l.type === 'Store');
          return String((store || locs[0]).id);
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (shift) loadCurrentTransactions();
  }, [shift, loadCurrentTransactions]);

  useEffect(() => {
    if (canWrite) {
      api.get('/pos/employees').then((r) => setEmployees(r.data)).catch(() => {});
    }
  }, [canWrite]);

  useEffect(() => { refreshShift(); }, [refreshShift]);

  useEffect(() => {
    if (customerSearch.length > 0) {
      api.get(`/customers?search=${customerSearch}&limit=10`).then((r) => setCustomers(r.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    }
  }, [customerSearch]);

  useEffect(() => {
    if (activeTab === 'sales') loadCurrentTransactions();
    if (activeTab === 'history') loadShiftHistory();
  }, [activeTab, loadCurrentTransactions, loadShiftHistory]);

  useEffect(() => {
    if (showQtyModal) setTimeout(() => qtyRef.current?.select(), 100);
  }, [showQtyModal]);

  useEffect(() => {
    if (!paymentModal) return;
    setPaymentFocusStep('method');
    setPaymentMethodIndex(0);
    setPaymentMethod('Cash');
    setTimeout(() => paymentModalContentRef.current?.focus(), 100);
  }, [paymentModal]);

  useEffect(() => {
    if (!paymentModal || paymentFocusStep !== 'method') return;
    const el = paymentModalContentRef.current?.querySelector(`[data-pay-idx="${paymentMethodIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [paymentMethodIndex, paymentModal, paymentFocusStep]);

  useEffect(() => {
    if (!paymentModal || paymentFocusStep !== 'employee') return;
    const el = employeeListRef.current?.querySelector(`[data-emp-idx="${employeeHighlightIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [employeeHighlightIndex, paymentModal, paymentFocusStep]);

  const cartItemCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  const tenderedAmount = useMemo(() => parseFloat(amountTendered || '0') || 0, [amountTendered]);

  const changeDue = useMemo(() => Math.max(0, tenderedAmount - netTotal), [tenderedAmount, netTotal]);

  const needsTender = !NON_TENDER_METHODS.has(paymentMethod);

  const needsReference = REFERENCE_PAYMENT_METHODS.has(paymentMethod);

  const quickTenderAmounts = useMemo(() => {
    const amounts = new Set<number>([netTotal]);
    [20, 50, 100, 200, 500, 1000, 2000, 5000].forEach((bill) => {
      if (bill >= netTotal) amounts.add(bill);
    });
    const round50 = Math.ceil(netTotal / 50) * 50;
    const round100 = Math.ceil(netTotal / 100) * 100;
    if (round50 >= netTotal) amounts.add(round50);
    if (round100 >= netTotal) amounts.add(round100);
    return Array.from(amounts).sort((a, b) => a - b).slice(0, 8);
  }, [netTotal]);

  const canCompletePayment = canWrite
    && (paymentMethod !== 'Salary Deduction' || !!selectedEmployee)
    && (paymentMethod !== 'Charge' || !!customer)
    && (!needsTender || tenderedAmount >= netTotal);

  const paymentBlockReason = useMemo(() => {
    if (paymentMethod === 'Charge' && !customer) return 'Select a customer before charging this sale to account.';
    if (paymentMethod === 'Salary Deduction' && !selectedEmployee) return 'Select an employee for salary / grocery deduction.';
    if (needsTender && tenderedAmount < netTotal) {
      return `Amount tendered is short by ${formatCurrency(netTotal - tenderedAmount)}.`;
    }
    return '';
  }, [paymentMethod, customer, selectedEmployee, needsTender, tenderedAmount, netTotal]);

  const openPaymentModal = useCallback(() => {
    if (!canWrite || cart.length === 0) return;
    setPaymentMethod('Cash');
    setPaymentMethodIndex(0);
    setPaymentFocusStep('method');
    setSelectedEmployee(null);
    setEmployeeHighlightIndex(0);
    setReferenceNumber('');
    setAmountTendered(netTotal.toFixed(2));
    setPaymentModal(true);
  }, [canWrite, cart.length, netTotal]);

  const closePaymentModal = useCallback(() => {
    setPaymentModal(false);
    setPaymentFocusStep('method');
    setPaymentMethodIndex(0);
    setSelectedEmployee(null);
    setEmployeeHighlightIndex(0);
  }, []);

  const movePaymentMethod = useCallback((delta: number) => {
    setPaymentMethodIndex((current) => {
      const next = Math.max(0, Math.min(PAYMENT_METHODS_UI.length - 1, current + delta));
      const method = PAYMENT_METHODS_UI[next].value;
      setPaymentMethod(method);
      setAmountTendered(netTotal.toFixed(2));
      if (!REFERENCE_PAYMENT_METHODS.has(method)) setReferenceNumber('');
      return next;
    });
  }, [netTotal]);

  const moveEmployeeHighlight = useCallback((delta: number) => {
    if (employees.length === 0) return;
    setEmployeeHighlightIndex((current) => {
      const next = Math.max(0, Math.min(employees.length - 1, current + delta));
      setSelectedEmployee(employees[next] || null);
      return next;
    });
  }, [employees]);

  const confirmPaymentMethodSelection = useCallback(() => {
    const method = PAYMENT_METHODS_UI[paymentMethodIndex]?.value || 'Cash';
    setPaymentMethod(method);
    setAmountTendered(netTotal.toFixed(2));
    if (!REFERENCE_PAYMENT_METHODS.has(method)) setReferenceNumber('');
    if (method === 'Salary Deduction') {
      setSelectedEmployee(null);
      setEmployeeHighlightIndex(0);
      setPaymentFocusStep('employee');
      setTimeout(() => paymentModalContentRef.current?.focus(), 50);
      return;
    }
    setPaymentFocusStep('tender');
    if (NON_TENDER_METHODS.has(method)) {
      setTimeout(() => paymentModalContentRef.current?.focus(), 50);
    } else {
      setTimeout(() => amountRef.current?.select(), 50);
    }
  }, [paymentMethodIndex, netTotal]);

  const confirmEmployeeSelection = useCallback(() => {
    const emp = employees[employeeHighlightIndex];
    if (!emp) {
      toast.error('No employee to select');
      return;
    }
    setSelectedEmployee(emp);
    setPaymentFocusStep('tender');
    setTimeout(() => confirmDeductionRef.current?.focus(), 50);
  }, [employees, employeeHighlightIndex]);

  const paymentKeyboardHint = useMemo(() => {
    if (paymentFocusStep === 'method') return '↑↓ payment method · Enter to continue';
    if (paymentMethod === 'Salary Deduction' && paymentFocusStep === 'employee') {
      return employees.length === 0
        ? 'No employees loaded · ↑ back to methods'
        : '↑↓ employee · Enter to confirm deduction · ↑ back to methods';
    }
    if (paymentMethod === 'Salary Deduction' && paymentFocusStep === 'tender') {
      return 'Enter to complete deduction · ↑ back to employee';
    }
    if (needsTender) return 'Enter amount · Enter again to complete · ↑ back to methods';
    return 'Enter to complete · ↑ back to methods';
  }, [paymentFocusStep, paymentMethod, employees.length, needsTender]);

  const focusSearchBar = useCallback(() => {
    setTimeout(() => {
      setActiveTab('register');
      searchInputRef.current?.focus();
    }, 50);
  }, []);

  const closePaymentComplete = useCallback(() => {
    setShowPaymentComplete(false);
    setPaymentResult(null);
    setSearch('');
    setHighlightPos(0);
    setProducts([]);
    focusSearchBar();
  }, [focusSearchBar]);

  const selectPaymentMethod = useCallback((method: string) => {
    const idx = PAYMENT_METHODS_UI.findIndex((m) => m.value === method);
    if (idx >= 0) setPaymentMethodIndex(idx);
    setPaymentMethod(method);
    setAmountTendered(netTotal.toFixed(2));
    if (!REFERENCE_PAYMENT_METHODS.has(method)) setReferenceNumber('');
  }, [netTotal]);

  useEffect(() => {
    if (showPaymentComplete) setTimeout(() => paymentModalRef.current?.focus(), 100);
  }, [showPaymentComplete]);

  const selectableItems = useMemo(() => {
    const items: any[] = [];
    for (const p of products) {
      items.push({ type: 'product', data: p });
      if (p.has_variants && p.variants?.length > 0) {
        for (const v of p.variants) items.push({ type: 'variant', data: v, parent: p });
      }
    }
    return items;
  }, [products]);

  useEffect(() => {
    if (selectableItems.length > 0 && highlightPos >= selectableItems.length) {
      setHighlightPos(Math.max(0, selectableItems.length - 1));
    }
  }, [selectableItems, highlightPos]);

  useEffect(() => {
    if (!search.trim() || !searchListRef.current) return;
    const row = searchListRef.current.querySelector(`[data-select-idx="${highlightPos}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [highlightPos, search, products]);

  const recalcItemTotal = (item: CartItem) => ({
    ...item,
    total: parseNumericField(item.quantity) * parseNumericField(item.unit_price) * (1 - parseNumericField(item.discount) / 100),
  });

  const addToCart = (product: any, variant?: string) => {
    if (!canWrite) return;
    const isChilled = variant === 'Chilled';
    const price = isChilled ? product.chilled_price
      : priceMode === 'Retail' ? product.retail_price
      : priceMode === 'Wholesale' ? product.wholesale_price
      : product.distributor_price;
    const key = `${product.id}_${isChilled ? 'Chilled' : 'Regular'}`;
    const existing = cart.find((item) => item.cart_key === key);
    if (existing) {
      const qty = existing.quantity + 1;
      setCart(cart.map((item) => item.cart_key === key
        ? recalcItemTotal({ ...item, quantity: qty })
        : item));
    } else {
      setCart([...cart, recalcItemTotal({
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
      })]);
    }
    const next = pushRecentProduct({ id: product.id, name: product.name, sku: product.sku });
    setRecentProducts(next);
    setSearch('');
    setChilledProduct(null);
  };

  const loadRecentProduct = async (id: string) => {
    try {
      const res = await api.get(`/products/${id}`);
      let p = res.data;
      if (p.has_variants) {
        const vr = await api.get(`/products/${id}/variants`);
        p = { ...p, variants: vr.data || [] };
      }
      if (p.has_chilled_variant && priceMode === 'Retail') setChilledProduct(p);
      else addToCart(p);
    } catch {
      toast.error('Product not found');
    }
  };

  const updateQuantity = (cartKey: string, qty: number) => {
    if (!canWrite) return;
    if (qty <= 0) { setCart(cart.filter((item) => item.cart_key !== cartKey)); return; }
    setCart(cart.map((item) => item.cart_key === cartKey ? recalcItemTotal({ ...item, quantity: qty }) : item));
  };

  const updateDiscount = (cartKey: string, disc: string | number) => {
    if (!canWrite) return;
    setCart(cart.map((item) => item.cart_key === cartKey ? recalcItemTotal({ ...item, discount: parseNumericField(disc) }) : item));
  };

  const removeFromCart = (cartKey: string) => {
    if (!canWrite) return;
    setCart(cart.filter((item) => item.cart_key !== cartKey));
  };

  const openShift = async () => {
    const amt = parseFloat(openingCash);
    if (!amt || amt <= 0) { toast.error('Enter opening cash amount'); return; }
    try {
      await api.post('/pos/shifts/open', { opening_cash: amt });
      await refreshShift();
      toast.success('Shift opened');
      setShowOpenShift(false);
      setOpeningCash('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Error opening shift');
    }
  };

  const submitCloseShift = async () => {
    const cs = parseFloat(closingCash);
    if (Number.isNaN(cs)) { toast.error('Enter closing cash amount'); return; }
    try {
      const res = await api.post('/pos/shifts/close', { closing_cash: cs });
      toast.success(`Shift closed. Variance: ${formatCurrency(res.data.variance)}`);
      setShift(null);
      setShowCloseShift(false);
      setClosingCash('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Error closing shift');
    }
  };

  const printToThermal = async (text: string) => {
    const serverUrl = THERMAL_PRINT_SERVER;
    try {
      const savedPort = printerSettings.printer_port;
      if (savedPort) {
        const st = await fetch(`${serverUrl}/status`).then((r) => r.json());
        if (st.port !== savedPort || !st.connected) {
          await fetch(`${serverUrl}/connect`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portPath: savedPort }),
          });
          await new Promise((r) => setTimeout(r, 300));
        }
      } else {
        const st = await fetch(`${serverUrl}/status`).then((r) => r.json());
        if (!st.connected) {
          await fetch(`${serverUrl}/auto-connect`, { method: 'POST' });
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      const res = await fetch(`${serverUrl}/print`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) return true;
    } catch { /* fallback */ }
    return false;
  };

  const printReceipt = async (reprint = false) => {
    const r = lastReceipt || lastReceiptRef.current;
    if (!r) { toast.error('No receipt to print'); return; }
    const text = buildReceiptText(r, { ...receiptOpts, reprint });
    const printed = await printToThermal(text);
    if (printed) { toast.success('Receipt printed'); return; }
    const preview = buildReceiptText(r, { ...receiptOpts, reprint });
    const html = buildThermalPrintHtml(preview, receiptOpts.paperSize);
    if (printHtmlToBrowser(html)) {
      toast('Sent to system printer', { icon: '🖨️' });
    } else {
      toast.error('Could not open print dialog');
    }
  };

  const openReceiptPreview = () => {
    const r = lastReceipt || lastReceiptRef.current;
    if (!r) {
      toast.error('No receipt to preview');
      return;
    }
    setShowReceiptPreview(true);
  };

  const printXReading = async () => {
    if (!shift) { toast.error('No open shift'); return; }
    try {
      const res = await api.get(`/pos/shifts/${shift.id}`);
      const text = buildXReadingText(res.data, res.data.transactions || [], receiptOpts);
      await printToThermal(text);
      toast.success('X Reading printed');
    } catch {
      toast.error('Failed to load shift data');
    }
  };

  const printZReading = async () => {
    try {
      const res = await api.get(`/pos/shifts?limit=5&status=Closed&user_id=${user?.id || ''}`);
      let shifts = res.data?.data || res.data || [];
      const mine = shifts.filter((s: any) => s.user_id === user?.id);
      const pick = mine.length > 0 ? mine[0] : shifts[0];
      if (!pick) { toast.error('No closed shifts found'); return; }
      const detail = await api.get(`/pos/shifts/${pick.id}`);
      const text = buildZReadingText(detail.data, detail.data.transactions || [], receiptOpts);
      await printToThermal(text);
      toast.success('Z Reading printed');
    } catch {
      toast.error('Failed to load shift data');
    }
  };

  const checkPrinter = async () => {
    try {
      const st = await fetch(`${THERMAL_PRINT_SERVER}/status`).then((r) => r.json());
      if (st.connected) { toast.success(`Printer connected on ${st.port}`); return; }
      const ac = await fetch(`${THERMAL_PRINT_SERVER}/auto-connect`, { method: 'POST' }).then((r) => r.json());
      if (ac.connected) { toast.success(`Connected to ${ac.port}`); return; }
      const ports = await fetch(`${THERMAL_PRINT_SERVER}/scan`).then((r) => r.json());
      if (ports.length > 0) {
        toast(
          `Print server OK — no printer connected yet. Found: ${ports.map((p: any) => `${p.path} (${p.friendlyName || 'Unknown'})`).join(', ')}. Pair printer in Windows Bluetooth, then click Check Printer again.`,
          { duration: 10000 },
        );
        return;
      }
      toast(
        'Print server is running but no COM ports found. Pair your thermal printer via Windows Bluetooth (it appears as a COM port), then try again.',
        { duration: 10000 },
      );
    } catch {
      toast.error(THERMAL_PRINT_START_HINT, { duration: 12000 });
    }
  };

  const finalizeSale = async () => {
    if (!canWrite) return;
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!shift) { toast.error('Open a shift first'); return; }
    if (paymentMethod === 'Salary Deduction' && !selectedEmployee) {
      toast.error('Select an employee for salary deduction');
      return;
    }
    if (paymentMethod === 'Charge' && !customer) {
      toast.error('Select a customer for charge sales');
      return;
    }
    const tendered = parseFloat(amountTendered) || netTotal;
    if (tendered < netTotal && paymentMethod !== 'Charge' && paymentMethod !== 'Salary Deduction') {
      toast.error('Insufficient amount');
      return;
    }
    try {
      const res = await api.post('/pos/transactions', {
        shift_id: shift.id,
        customer_id: paymentMethod === 'Salary Deduction' ? undefined : customer?.id,
        employee_id: paymentMethod === 'Salary Deduction' ? selectedEmployee?.id : undefined,
        customer_name: paymentMethod === 'Salary Deduction'
          ? `${selectedEmployee.last_name}, ${selectedEmployee.first_name}`
          : customer?.customer_name,
        price_mode: priceMode,
        items: cart.map((item) => ({
          product_id: item.product_id,
          description: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount: effectiveDiscount(item),
          selected_variant: item.selected_variant || 'Regular',
        })),
        payment_method: paymentMethod,
        payment_details: referenceNumber ? { reference: referenceNumber } : undefined,
        amount_tendered: tendered,
        location_id: locationId,
      });
      const receipt = {
        transaction_number: res.data.transaction_number,
        date: new Date(),
        items: cart.map((item) => ({ ...item, total: lineTotal(item), discount: effectiveDiscount(item) })),
        subtotal, totalDiscount, vat, netTotal, paymentMethod, tendered,
        change: res.data.change, customerName: customer?.customer_name || 'Walk-in',
        priceMode,
      };
      setLastReceipt(receipt);
      lastReceiptRef.current = receipt;
      setCart([]);
      setCartDiscountPct('');
      setAmountTendered('');
      setPaymentModal(false);
      setCustomer(null);
      setSelectedEmployee(null);
      setPaymentMethod('Cash');
      setReferenceNumber('');
      setPaymentResult({
        transaction_number: res.data.transaction_number,
        total: parseFloat(res.data.total) || netTotal,
        tendered,
        change: parseFloat(res.data.change) || 0,
        grossProfit: parseFloat(res.data.gross_profit) || grossProfit,
        marginPct: parseFloat(res.data.margin_pct) || marginPct,
        paymentMethod,
        customerName: paymentMethod === 'Salary Deduction'
          ? `${selectedEmployee?.last_name}, ${selectedEmployee?.first_name}`
          : customer?.customer_name || 'Walk-in',
        priceMode,
      });
      setShowPaymentComplete(true);
      await refreshShift();
      loadCurrentTransactions();
      setTimeout(() => printReceipt(), 300);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Transaction failed');
    }
  };

  const handlePaymentModalKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const inField = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';

    if (paymentFocusStep === 'method') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        movePaymentMethod(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        movePaymentMethod(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmPaymentMethodSelection();
      }
      return;
    }

    if (paymentFocusStep === 'employee') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveEmployeeHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (employeeHighlightIndex === 0) {
          setPaymentFocusStep('method');
          setSelectedEmployee(null);
          setTimeout(() => paymentModalContentRef.current?.focus(), 50);
        } else {
          moveEmployeeHighlight(-1);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmEmployeeSelection();
      }
      return;
    }

    if (paymentFocusStep === 'tender') {
      if (e.key === 'ArrowUp' && !inField) {
        e.preventDefault();
        if (paymentMethod === 'Salary Deduction') {
          setPaymentFocusStep('employee');
          setTimeout(() => paymentModalContentRef.current?.focus(), 50);
        } else {
          setPaymentFocusStep('method');
          setTimeout(() => paymentModalContentRef.current?.focus(), 50);
        }
        return;
      }
      if (e.key === 'Enter' && !inField) {
        if (target.tagName === 'BUTTON') return;
        e.preventDefault();
        if (canCompletePayment) finalizeSale();
      }
    }
  };

  const suspendSale = async () => {
    if (!canWrite || cart.length === 0) return;
    try {
      await api.post('/pos/suspend', {
        shift_id: shift?.id, customer_id: customer?.id, customer_name: customer?.customer_name,
        price_mode: priceMode, cart_discount_pct: cartDiscountPctNum,
        items: cart.map((item) => ({ ...item, total: lineTotal(item) })),
        subtotal, discount_total: totalDiscount, tax_total: vat, total: netTotal,
      });
      toast.success('Sale suspended');
      setCart([]);
      setCartDiscountPct('');
    } catch {
      toast.error('Error suspending sale');
    }
  };

  const submitCashMove = async () => {
    if (!canWrite) return;
    const amt = parseFloat(cashForm.amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await api.post(`/pos/${cashMoveType === 'in' ? 'cash-in' : 'cash-out'}`, cashForm);
      toast.success(`Cash ${cashMoveType === 'in' ? 'In' : 'Out'}: ${formatCurrency(amt)}`);
      if (shift) setShift({ ...shift, expected_cash: res.data.expected_cash });
      setShowCashMove(false);
      setCashForm({ amount: '', reason: '' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Error');
    }
  };

  const openCashMove = (type: 'in' | 'out') => {
    setCashMoveType(type);
    setCashForm({ amount: '', reason: '' });
    setShowCashMove(true);
  };

  const loadSuspendedSales = async () => {
    try {
      const res = await api.get('/pos/suspend');
      setSuspendedSales(res.data);
      setShowRecallModal(true);
    } catch {
      toast.error('Failed to load suspended sales');
    }
  };

  const recallSale = (sale: any) => {
    if (!canWrite) return;
    const items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;
    setCart(items.map((item: any) => ({ ...item, cost: item.cost || 0 })));
    setCartDiscountPct(sale.cart_discount_pct != null ? String(sale.cart_discount_pct) : '');
    setCustomer(sale.customer_id ? { id: sale.customer_id, customer_name: sale.customer_name } : null);
    setPriceMode(sale.price_mode || 'Retail');
    setShowRecallModal(false);
    setActiveTab('register');
    api.delete(`/pos/suspend/${sale.id}`).catch(() => {});
  };

  const deleteSuspended = async (id: string) => {
    try {
      await api.delete(`/pos/suspend/${id}`);
      toast.success('Removed');
      loadSuspendedSales();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const submitVoid = async () => {
    if (!voidTarget || !voidReason.trim()) { toast.error('Enter void reason'); return; }
    try {
      await api.post(`/pos/transactions/${voidTarget.id}/void`, { reason: voidReason });
      toast.success('Transaction voided');
      setVoidTarget(null);
      setVoidReason('');
      await refreshShift();
      loadCurrentTransactions();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Void failed');
    }
  };

  const handleRefresh = () => {
    refreshShift();
    if (activeTab === 'sales') loadCurrentTransactions();
    if (activeTab === 'history') loadShiftHistory();
  };

  const toggleShiftRow = (id: string) => {
    if (expandedShiftId === id) {
      setExpandedShiftId(null);
      setShiftDetail(null);
    } else {
      setExpandedShiftId(id);
      loadShiftDetail(id);
    }
  };

  const receiptPreviewText = useMemo(() => {
    const r = lastReceipt || lastReceiptRef.current;
    if (!r) return '';
    try {
      return buildReceiptText(r, receiptOpts);
    } catch {
      return '';
    }
  }, [lastReceipt, receiptOpts, showPaymentComplete]);

  const receiptPaperMm = receiptOpts.paperSize || 58;
  const receiptPreviewScale = receiptPaperMm === 80 ? 1.85 : 2.35;
  const receiptPreviewFontPx = receiptPaperMm === 80 ? 9 : 8;

  const expectedCash = parseFloat(shift?.expected_cash || shift?.opening_cash || 0);
  const closingVariance = parseFloat(closingCash || '0') - expectedCash;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canWrite) return;
      if (e.key === 'F1') {
        e.preventDefault();
        if (cart.length > 0) {
          setQtyTarget(cart[cart.length - 1]);
          setNewQty(cart[cart.length - 1].quantity);
          setShowQtyModal(true);
        }
      }
      if (e.key === 'F2') { e.preventDefault(); toast('Price override: click item price'); }
      if (e.key === 'F3') { e.preventDefault(); suspendSale(); }
      if (e.key === 'F4') { e.preventDefault(); setShowCustomerModal(true); }
      if (e.key === 'F5') { e.preventDefault(); setActiveTab('advanced'); }
      if (e.key === 'F6') { e.preventDefault(); loadSuspendedSales(); }
      if (e.key === 'F9') { e.preventDefault(); setCart([]); setCartDiscountPct(''); }
      if (e.key === 'F10') { e.preventDefault(); if (cart.length > 0) openPaymentModal(); }
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (paymentModal || showPaymentComplete) return;
        e.preventDefault();
        if (cart.length > 0) openPaymentModal();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showReceiptPreview) { setShowReceiptPreview(false); return; }
        if (showPaymentComplete) { closePaymentComplete(); return; }
        setShowCustomerModal(false);
        setShowQtyModal(false);
        setPaymentModal(false);
        setShowRecallModal(false);
        setShowCloseShift(false);
        setVoidTarget(null);
        setChilledProduct(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, canWrite, suspendSale, loadSuspendedSales, openPaymentModal, paymentModal, showPaymentComplete, showReceiptPreview, closePaymentComplete]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const max = selectableItems.length - 1;
    if (e.key === 'ArrowDown' && selectableItems.length > 0) {
      e.preventDefault();
      setHighlightPos((h) => Math.min(h + 1, max));
    } else if (e.key === 'ArrowUp' && selectableItems.length > 0) {
      e.preventDefault();
      setHighlightPos((h) => Math.max(h - 1, 0));
    }
    else if (e.key === 'Enter' && search.trim().length > 0) {
      e.preventDefault();
      const looksLikeBarcode = /^\d{5,}$/.test(search.trim());
      if (looksLikeBarcode) {
        api.get(`/products/search/exact?q=${encodeURIComponent(search.trim())}&location_id=${locationId || '1'}`).then((res) => {
          if (res.data) {
            const p = res.data;
            if (p.has_chilled_variant && priceMode === 'Retail') setChilledProduct(p);
            else addToCart(p);
            setSearch('');
            setHighlightPos(0);
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
        } else {
          const p = item.data;
          const price = priceMode === 'Retail' ? p.retail_price : priceMode === 'Wholesale' ? p.wholesale_price : p.distributor_price;
          const hasVariants = p.has_variants && p.variants?.length > 0;
          const showChilledOption = p.has_chilled_variant && priceMode === 'Retail';
          if (hasVariants) {
            const v = p.variants[0];
            const varPrice = priceMode === 'Retail' ? (v.retail_price || price + (v.additional_cost || 0)) : price + (v.additional_cost || 0);
            addToCart({ ...p, retail_price: varPrice, wholesale_price: varPrice, distributor_price: varPrice, name: `${p.name} - ${v.name}` });
          } else if (showChilledOption) setChilledProduct(p);
          else addToCart(p);
        }
        setSearch('');
        setHighlightPos(0);
      }
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0" style={{ backgroundColor: PRIMARY }}>
        <div className="px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <ShoppingCart size={18} className="text-white/90 flex-shrink-0" />
            <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto max-w-full">
              {POS_TABS.map((t) => {
                const Icon = TAB_ICONS[t.key];
                return (
                  <button key={t.key} type="button" onClick={() => setActiveTab(t.key)} className={financeTabClass(activeTab === t.key)}>
                    <span className="inline-flex items-center gap-1"><Icon size={13} />{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={handleRefresh} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20">
              <RefreshCw size={14} /> Refresh
            </button>
            {!shift && canWrite && (
              <button type="button" onClick={() => setShowOpenShift(true)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-blue-900 hover:bg-blue-50">
                Open Shift
              </button>
            )}
          </div>
        </div>
        <div className="px-4 pb-2 flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/10 text-white">Shift #{shift?.shift_number || '—'}</span>
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/10 text-white">Net Sales: {formatCurrency(parseFloat(shift?.net_sales || 0))}</span>
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/10 text-white">Tx Count: {shift ? shiftTransactions.length : '—'}</span>
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/10 text-white">Cash Drawer: {formatCurrency(expectedCash)}</span>
          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${shift?.status === 'Open' ? 'bg-green-500/30 text-white' : 'bg-white/10 text-white/80'}`}>
            {shift?.status || 'No Shift'}
          </span>
        </div>
      </div>

      {!canWrite && (
        <div className="flex-shrink-0 mx-4 mt-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          Read-only mode — you have <strong>pos.view</strong>. Open shift, sales, and void require <strong>pos.write</strong>.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden p-4">
        {activeTab === 'register' && (
          <div className="h-full flex gap-4 min-h-0">
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              {!shift ? (
                <div className="flex-1 flex items-center justify-center bg-white rounded-xl border border-gray-200">
                  <div className="text-center">
                    <h2 className="text-xl font-semibold mb-2">No Open Shift</h2>
                    <p className="text-sm text-gray-500 mb-4">Open a shift to start selling</p>
                    {canWrite && (
                      <button type="button" onClick={() => setShowOpenShift(true)} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">Open Shift</button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative mb-3 flex-shrink-0">
                    <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={searchInputRef} type="text" placeholder="Search product by name, SKU, or barcode..." value={search} onChange={(e) => { setSearch(e.target.value); setHighlightPos(0); }} onKeyDown={handleSearchKeyDown} autoFocus className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
                  </div>
                  {recentProducts.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
                      {recentProducts.map((rp: any) => (
                        <button key={rp.id} type="button" onClick={() => loadRecentProduct(rp.id)} className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-full hover:bg-blue-50">{rp.name}</button>
                      ))}
                    </div>
                  )}
                  {search && (
                    <div ref={searchListRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3 max-h-48 overflow-y-auto shadow-lg flex-shrink-0">
                      {products.map((prod) => {
                        const price = priceMode === 'Retail' ? prod.retail_price : priceMode === 'Wholesale' ? prod.wholesale_price : prod.distributor_price;
                        const hasVariants = prod.has_variants && prod.variants?.length > 0;
                        const showChilledOption = prod.has_chilled_variant && priceMode === 'Retail';
                        const flatIdx = selectableItems.findIndex((item) => item.type === 'product' && item.data.id === prod.id);
                        const stock = parseFloat(String(prod.stock ?? prod.available_stock ?? 0)) || 0;
                        return (
                          <div key={prod.id}>
                            <div data-select-idx={flatIdx >= 0 ? flatIdx : undefined} onClick={() => { if (hasVariants) return; if (showChilledOption) setChilledProduct(prod); else addToCart(prod); }} className={`flex items-center justify-between px-4 py-3 hover:bg-blue-50 border-b border-gray-100 ${hasVariants ? 'cursor-default' : 'cursor-pointer'} ${flatIdx === highlightPos ? 'bg-blue-100' : ''}`}>
                              <div>
                                <p className="font-medium text-sm">{prod.name}</p>
                                <p className="text-xs text-gray-500">
                                  {prod.sku} |{' '}
                                  <span className={stock > 0 ? 'text-green-600 font-medium' : 'text-red-500'}>
                                    {stock > 0 ? `${formatQuantity(stock)} in stock` : 'Out of stock'}
                                  </span>
                                </p>
                              </div>
                              <p className="font-bold">{formatCurrency(price)}</p>
                            </div>
                            {hasVariants && prod.variants.map((v: any) => {
                              const varPrice = priceMode === 'Retail' ? (v.retail_price || price + (v.additional_cost || 0)) : price + (v.additional_cost || 0);
                              const varFlatIdx = selectableItems.findIndex((item) => item.type === 'variant' && item.data.id === v.id && item.parent.id === prod.id);
                              return (
                                <div key={v.id} data-select-idx={varFlatIdx >= 0 ? varFlatIdx : undefined} onClick={() => addToCart({ ...prod, retail_price: varPrice, wholesale_price: varPrice, distributor_price: varPrice, name: `${prod.name} - ${v.name}` })} className={`mx-4 mb-1 flex items-center justify-between px-3 py-2 rounded-lg hover:bg-blue-100 cursor-pointer border border-gray-100 ${varFlatIdx === highlightPos ? 'bg-blue-200' : 'bg-gray-50'}`}>
                                  <span className="text-sm font-medium">{v.name}</span>
                                  <span className="text-sm font-bold">{formatCurrency(varPrice)}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {searchLoading && <p className="text-center py-4 text-gray-400 text-sm">Searching products…</p>}
                      {!searchLoading && products.length === 0 && <p className="text-center py-4 text-gray-400 text-sm">No products found</p>}
                    </div>
                  )}
                  <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col min-h-0">
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
                            <th className="px-4 py-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {cart.map((item) => (
                            <tr key={item.cart_key} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-3"><p className="font-medium text-sm">{item.name}{item.selected_variant ? <span className="ml-1 text-xs text-cyan-600">({item.selected_variant})</span> : ''}</p><p className="text-xs text-gray-400">{item.sku}</p></td>
                              <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1"><button type="button" onClick={() => updateQuantity(item.cart_key, item.quantity - 1)} disabled={!canWrite} className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-40"><Minus size={14} /></button><span className="w-8 text-center font-medium">{item.quantity}</span><button type="button" onClick={() => updateQuantity(item.cart_key, item.quantity + 1)} disabled={!canWrite} className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-40"><Plus size={14} /></button></div></td>
                              <td className="px-4 py-3 text-right font-medium text-sm">{formatCurrency(item.unit_price)}</td>
                              <td className="px-4 py-3 text-center"><input type="number" value={item.discount} onChange={(e) => updateDiscount(item.cart_key, e.target.value)} disabled={!canWrite} className="w-14 text-center border rounded text-sm py-1 disabled:bg-gray-50" min={0} max={100} /></td>
                              <td className="px-4 py-3 text-right text-xs text-emerald-600 font-medium">{formatCurrency(lineGP(item))}</td>
                              <td className="px-4 py-3 text-right font-bold text-sm">{formatCurrency(lineTotal(item))}</td>
                              <td className="px-4 py-3 text-center"><button type="button" onClick={() => removeFromCart(item.cart_key)} disabled={!canWrite} className="text-red-400 hover:text-red-600 disabled:opacity-40"><X size={16} /></button></td>
                            </tr>
                          ))}
                          {cart.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-gray-400"><ShoppingCart size={40} className="mx-auto mb-2 text-gray-300" /><p className="text-sm">Search and select products to start selling</p></td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
            {shift && (
              <div className="w-72 flex-shrink-0 flex flex-col gap-3 min-h-0">
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-sm">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Order Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Items</span><span className="font-medium">{cart.reduce((s, i) => s + i.quantity, 0)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                    {totalDiscount > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="text-red-600">-{formatCurrency(totalDiscount)}</span></div>}
                    <div className="flex justify-between"><span className="text-gray-500">VATable</span><span>{formatCurrency(netOfVat)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span>{formatCurrency(vat)}</span></div>
                    <div className="flex justify-between border-t pt-2"><span className="font-medium text-gray-700">Gross Profit</span><span className="font-bold text-emerald-600">{formatCurrency(grossProfit)} ({marginPct.toFixed(1)}%)</span></div>
                    <div className="flex justify-between items-center border-t pt-2"><span className="text-gray-500">Cart Disc %</span><input type="number" min={0} max={100} value={cartDiscountPct} onChange={(e) => setCartDiscountPct(e.target.value)} disabled={!canWrite} className="w-16 text-right border rounded text-sm py-1 px-2 disabled:bg-gray-50" /></div>
                    <div className="flex justify-between border-t-2 pt-3"><span className="text-lg font-bold">Total</span><span className="text-2xl font-bold text-gray-900">{formatCurrency(netTotal)}</span></div>
                  </div>
                  <button type="button" onClick={openPaymentModal} disabled={!canWrite || cart.length === 0} className="w-full py-3 bg-blue-600 text-white rounded-xl text-base font-bold hover:bg-blue-700 disabled:opacity-50">Pay Now (F10)</button>
                  <button type="button" onClick={suspendSale} disabled={!canWrite || cart.length === 0} className="w-full py-2 border-2 border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Suspend (F3)</button>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                  <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Price Mode</label><div className="flex flex-wrap gap-1">{PRICE_MODES.map((mode) => (<button key={mode} type="button" onClick={() => setPriceMode(mode as typeof priceMode)} className={`px-2 py-1 rounded text-xs font-medium ${priceMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{mode}</button>))}</div></div>
                  <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Location</label><select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">{locations.map((loc) => (<option key={loc.id} value={String(loc.id)}>{loc.name || loc.location_name}</option>))}</select></div>
                  <button type="button" onClick={() => setShowCustomerModal(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white hover:bg-gray-50"><User size={14} /> {customer ? customer.customer_name : 'Walk-in Customer'}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === 'sales' && (
          <div className="h-full flex flex-col min-h-0 gap-4">
            <div className="grid grid-cols-3 gap-4 flex-shrink-0">
              <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 uppercase font-semibold">Completed</p><p className="text-2xl font-bold text-green-600">{salesSummary.completedCount}</p></div>
              <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 uppercase font-semibold">Voided</p><p className="text-2xl font-bold text-red-600">{salesSummary.voidCount}</p></div>
              <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 uppercase font-semibold">Total Sales</p><p className="text-2xl font-bold text-gray-900">{formatCurrency(salesSummary.totalSales)}</p></div>
            </div>
            <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden min-h-0">
              <div className="overflow-auto h-full">
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Time</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Receipt #</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Customer</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Payment</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                      <th className="px-4 py-2 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {shiftTransactions.map((tx) => (
                      <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">{new Date(tx.created_at).toLocaleString('en-PH')}</td>
                        <td className="px-4 py-2 text-sm font-medium">{tx.transaction_number}</td>
                        <td className="px-4 py-2 text-sm">{tx.customer_name || 'Walk-in'}</td>
                        <td className="px-4 py-2 text-sm">{tx.payment_method}</td>
                        <td className="px-4 py-2 text-sm text-right font-medium">{formatCurrency(parseFloat(tx.total || 0))}</td>
                        <td className="px-4 py-2 text-center"><span className={`px-2 py-0.5 text-xs rounded-full ${tx.status === 'Completed' ? 'bg-green-100 text-green-700' : tx.status === 'Void' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{tx.status}</span></td>
                        <td className="px-4 py-2 text-right">{tx.status === 'Completed' && canWrite && (<button type="button" onClick={() => { setVoidTarget(tx); setVoidReason(''); }} className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"><Ban size={12} className="inline mr-1" />Void</button>)}</td>
                      </tr>
                    ))}
                    {shiftTransactions.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">No transactions for current shift</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="h-full flex flex-col min-h-0">
            <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden min-h-0">
              <div className="overflow-auto h-full">
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Opened</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Closed</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Cashier</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Net Sales</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftHistory.map((s) => (
                      <React.Fragment key={s.id}>
                        <tr onClick={() => toggleShiftRow(s.id)} className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer">
                          <td className="px-4 py-2 text-sm">{s.opening_date ? new Date(s.opening_date).toLocaleString('en-PH') : '—'}</td>
                          <td className="px-4 py-2 text-sm">{s.closing_date ? new Date(s.closing_date).toLocaleString('en-PH') : '—'}</td>
                          <td className="px-4 py-2 text-sm">{s.user_name || '—'}</td>
                          <td className="px-4 py-2 text-sm text-right font-medium">{formatCurrency(parseFloat(s.net_sales || 0))}</td>
                          <td className="px-4 py-2 text-center"><span className={`px-2 py-0.5 text-xs rounded-full ${s.status === 'Open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{s.status}</span></td>
                        </tr>
                        {expandedShiftId === s.id && shiftDetail && (
                          <tr><td colSpan={5} className="px-4 py-3 bg-gray-50">
                            <p className="text-xs font-semibold text-gray-500 mb-2">Shift #{shiftDetail.shift_number} — Transactions</p>
                            <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500"><th className="text-left py-1">Time</th><th className="text-left py-1">Receipt</th><th className="text-left py-1">Customer</th><th className="text-left py-1">Payment</th><th className="text-right py-1">Total</th><th className="text-center py-1">Status</th></tr></thead>
                              <tbody>{(shiftDetail.transactions || []).map((tx: any) => (<tr key={tx.id} className="border-t border-gray-200"><td className="py-1">{new Date(tx.created_at).toLocaleString('en-PH')}</td><td className="py-1">{tx.transaction_number}</td><td className="py-1">{tx.customer_name || 'Walk-in'}</td><td className="py-1">{tx.payment_method}</td><td className="py-1 text-right">{formatCurrency(parseFloat(tx.total || 0))}</td><td className="py-1 text-center">{tx.status}</td></tr>))}</tbody>
                            </table>
                          </td></tr>
                        )}
                      </React.Fragment>
                    ))}
                    {shiftHistory.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">No shift history</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="h-full overflow-y-auto space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { label: 'X Reading', icon: BarChart3, action: printXReading, disabled: !shift },
                { label: 'Z Reading', icon: Receipt, action: printZReading, disabled: false },
                { label: 'Cash In', icon: Wallet, action: () => openCashMove('in'), disabled: !canWrite || !shift },
                { label: 'Cash Out', icon: Wallet, action: () => openCashMove('out'), disabled: !canWrite || !shift },
                { label: 'Recall Suspended', icon: RotateCcw, action: loadSuspendedSales, disabled: !canWrite },
                { label: 'Print Last Receipt', icon: Printer, action: () => printReceipt(), disabled: !lastReceipt && !lastReceiptRef.current },
                { label: 'Receipt Preview', icon: Receipt, action: openReceiptPreview, disabled: !lastReceipt && !lastReceiptRef.current },
                { label: 'Check Printer', icon: Printer, action: checkPrinter, disabled: false },
                { label: 'Close Shift', icon: RotateCcw, action: () => { setClosingCash(''); setShowCloseShift(true); }, disabled: !canWrite || !shift },
              ].map((card) => (
                <button key={card.label} type="button" onClick={card.action} disabled={card.disabled} className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 disabled:opacity-50 disabled:cursor-not-allowed text-center">
                  <card.icon size={24} className="text-blue-700" />
                  <span className="text-sm font-semibold text-gray-800">{card.label}</span>
                </button>
              ))}
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
              <p className="font-semibold mb-1">Hybrid cloud — thermal printer on this PC</p>
              <p className="text-blue-800 mb-2">
                You may be using ERP online in the browser. Receipt printing still uses a small local app on <strong>this cashier PC</strong>{' '}
                (<code className="bg-white/80 px-1 rounded">localhost:9999</code>) — not the cloud server.
              </p>
              <p className="text-blue-800 text-xs mb-2">
                <strong>One-click start:</strong> double-click{' '}
                <code className="bg-white/80 px-1 rounded font-semibold">start-print-server.bat</code>{' '}
                on this PC. Leave that window open while POS is in use.
              </p>
              <p className="text-blue-800 text-xs">
                Or run <code className="bg-white/80 px-1 rounded">npm run start:print</code> from a terminal on this PC.
                Pair the printer in Windows Bluetooth first (shows as a COM port). Configure the port under Settings → Printer.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500 uppercase"><th className="px-4 py-2 text-left">Key</th><th className="px-4 py-2 text-left">Action</th></tr></thead>
                <tbody>{SHORTCUTS.map((s) => (<tr key={s.key} className="border-t border-gray-100"><td className="px-4 py-2"><kbd className="px-2 py-0.5 bg-gray-100 border rounded text-xs font-mono">{s.key}</kbd></td><td className="px-4 py-2 text-gray-700">{s.action}</td></tr>))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {chilledProduct && (
        <ModalOverlay onClose={() => setChilledProduct(null)}>
          <div className="modal-content max-w-xs">
            <div className="p-6 text-center">
              <p className="text-lg font-semibold mb-1">{chilledProduct.name}</p>
              <p className="text-sm text-gray-500 mb-4">Select variant</p>
              <button type="button" onClick={() => addToCart(chilledProduct)} className="w-full py-3 mb-2 bg-white border-2 border-gray-300 rounded-lg font-semibold hover:bg-gray-50">Regular — {formatCurrency(priceMode === 'Retail' ? chilledProduct.retail_price : priceMode === 'Wholesale' ? chilledProduct.wholesale_price : chilledProduct.distributor_price)}</button>
              <button type="button" onClick={() => addToCart(chilledProduct, 'Chilled')} className="w-full py-3 bg-cyan-50 border-2 border-cyan-300 rounded-lg font-semibold text-cyan-700 hover:bg-cyan-100">Chilled — {formatCurrency(chilledProduct.chilled_price)}</button>
              <button type="button" onClick={() => setChilledProduct(null)} className="mt-3 text-sm text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showCustomerModal && (
        <ModalOverlay onClose={() => setShowCustomerModal(false)}>
          <div className="modal-content max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Select Customer</h2>
              <input type="text" placeholder="Search customer..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mb-3 focus:ring-2 focus:ring-blue-500 outline-none" autoFocus />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {customers.map((c) => (
                  <div key={c.id} onClick={() => { setCustomer(c); setShowCustomerModal(false); setCustomerSearch(''); }} className="flex items-center justify-between px-3 py-2 hover:bg-blue-50 rounded cursor-pointer">
                    <div><p className="font-medium text-sm">{c.customer_name}</p><p className="text-xs text-gray-500">{c.customer_type}</p></div>
                    <p className="text-sm font-medium">{formatCurrency(c.balance)}</p>
                  </div>
                ))}
                {customers.length === 0 && customerSearch && <p className="text-center text-gray-400 py-4">No customers found</p>}
              </div>
              <div className="flex justify-end mt-4"><button type="button" onClick={() => { setCustomer(null); setShowCustomerModal(false); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Walk-in Customer</button></div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showQtyModal && qtyTarget && (
        <ModalOverlay onClose={() => setShowQtyModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6 text-center">
              <h2 className="text-lg font-semibold mb-2">Adjust Quantity</h2>
              <p className="text-sm text-gray-500 mb-4">{qtyTarget.name}</p>
              <input type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)} min={1} ref={qtyRef} onKeyDown={(e) => { if (e.key === 'Enter') { updateQuantity(qtyTarget.cart_key, parseIntegerField(newQty) || 1); setShowQtyModal(false); } }} className="w-32 text-center text-2xl font-bold px-4 py-3 border-2 border-blue-500 rounded-xl outline-none" />
              <div className="flex justify-center gap-3 mt-4">
                <button type="button" onClick={() => setShowQtyModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={() => { updateQuantity(qtyTarget.cart_key, parseIntegerField(newQty) || 1); setShowQtyModal(false); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Apply</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {paymentModal && (
        <ModalOverlay onClose={closePaymentModal}>
          <div
            ref={paymentModalContentRef}
            tabIndex={-1}
            className="modal-content max-w-2xl outline-none"
            onKeyDown={handlePaymentModalKeyDown}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-gray-200 bg-gray-50 rounded-t-xl">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Tender Payment</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {cartItemCount} item{cartItemCount === 1 ? '' : 's'} · {priceMode} · {customer?.customer_name || 'Walk-in'}
                </p>
                <p className="text-xs text-blue-700 mt-2">{paymentKeyboardHint}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Amount Due</p>
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(netTotal)}</p>
              </div>
              <button type="button" onClick={closePaymentModal} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6 p-6">
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Order Summary</h3>
                <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 text-sm">
                  <div className="flex justify-between px-4 py-2.5"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between px-4 py-2.5"><span className="text-gray-500">Discount</span><span className="text-red-600">-{formatCurrency(totalDiscount)}</span></div>
                  )}
                  <div className="flex justify-between px-4 py-2.5"><span className="text-gray-500">VATable Sales</span><span>{formatCurrency(netOfVat)}</span></div>
                  <div className="flex justify-between px-4 py-2.5"><span className="text-gray-500">VAT (12%)</span><span>{formatCurrency(vat)}</span></div>
                  <div className="flex justify-between px-4 py-2.5"><span className="text-gray-500">Gross Profit</span><span className="font-medium text-emerald-600">{formatCurrency(grossProfit)}</span></div>
                  <div className="flex justify-between px-4 py-3 bg-gray-50 font-bold"><span>Total Due</span><span>{formatCurrency(netTotal)}</span></div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Payment Method</h3>
                <div className="space-y-3">
                  {PAYMENT_METHOD_GROUPS.map((group) => {
                    const Icon = group.icon;
                    const groupMethods = PAYMENT_METHODS_UI.filter((m) => (group.methods as readonly string[]).includes(m.value));
                    if (groupMethods.length === 0) return null;
                    return (
                      <div key={group.id}>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1.5 flex items-center gap-1">
                          <Icon size={12} /> {group.label}
                        </p>
                        <div className={`grid gap-2 ${groupMethods.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {groupMethods.map((m) => {
                            const methodIdx = PAYMENT_METHODS_UI.findIndex((opt) => opt.value === m.value);
                            const isSelected = paymentMethod === m.value;
                            const isKeyboardFocus = paymentFocusStep === 'method' && paymentMethodIndex === methodIdx;
                            return (
                            <button
                              key={m.value}
                              type="button"
                              data-pay-idx={methodIdx}
                              onClick={() => {
                                selectPaymentMethod(m.value);
                                setPaymentFocusStep('method');
                              }}
                              className={`py-2.5 px-3 rounded-lg text-sm font-semibold border-2 transition-colors ${
                                isKeyboardFocus
                                  ? 'border-blue-600 bg-blue-100 text-blue-800 ring-2 ring-blue-300'
                                  : isSelected
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {m.label}
                            </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {needsTender && (
                  <div className={`rounded-xl border bg-white p-4 space-y-3 ${paymentFocusStep === 'tender' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}>
                    <label className="block text-sm font-bold text-gray-700">Amount Tendered</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={amountTendered}
                      onChange={(e) => setAmountTendered(e.target.value)}
                      ref={amountRef}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (canCompletePayment) finalizeSale();
                        }
                        if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
                          e.preventDefault();
                          setPaymentFocusStep('method');
                          setTimeout(() => paymentModalContentRef.current?.focus(), 50);
                        }
                      }}
                      className="w-full px-4 py-3 text-2xl font-bold border-2 border-gray-200 rounded-xl outline-none text-right focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="0.00"
                    />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Change</span>
                      <span className={`text-lg font-bold ${changeDue > 0 ? 'text-green-600' : tenderedAmount < netTotal ? 'text-red-500' : 'text-gray-400'}`}>
                        {formatCurrency(changeDue)}
                      </span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {quickTenderAmounts.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setAmountTendered(amt.toFixed(2))}
                          className={`px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-blue-50 ${
                            Math.abs(amt - netTotal) < 0.01 ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200'
                          }`}
                        >
                          {Math.abs(amt - netTotal) < 0.01 ? 'Exact' : formatCurrency(amt)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {needsReference && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Reference Number</label>
                    <input
                      type="text"
                      placeholder="Transaction / check / card reference"
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl outline-none text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <p className="text-xs text-gray-400 mt-2">Tender amount defaults to exact total for {paymentMethod}.</p>
                  </div>
                )}

                {paymentMethod === 'Charge' && (
                  <div className={`rounded-xl border p-4 text-sm ${customer ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
                    {customer ? (
                      <>
                        <p className="font-semibold text-amber-900 mb-2">Charge to Customer Account</p>
                        <div className="space-y-1 text-amber-900">
                          <p><span className="text-amber-700">Customer:</span> <strong>{customer.customer_name}</strong></p>
                          <p><span className="text-amber-700">Current Balance:</span> {formatCurrency(customer.balance || 0)}</p>
                          <p><span className="text-amber-700">After Sale:</span> {formatCurrency(parseFloat(customer.balance || 0) + netTotal)}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-red-700 mb-2">Customer required for charge sales</p>
                        <button type="button" onClick={() => { closePaymentModal(); setShowCustomerModal(true); }} className="px-3 py-2 bg-white border border-red-200 rounded-lg text-sm font-medium text-red-700 hover:bg-red-100">
                          Select Customer
                        </button>
                      </>
                    )}
                  </div>
                )}

                {paymentMethod === 'Salary Deduction' && (
                  <div className={`rounded-xl border p-4 text-sm space-y-3 ${
                    paymentFocusStep === 'employee'
                      ? 'border-purple-400 ring-2 ring-purple-100 bg-purple-50'
                      : 'border-purple-200 bg-purple-50'
                  }`}>
                    <p className="font-semibold text-purple-900">Deduct from Employee Grocery / Payroll</p>
                    {employees.length === 0 ? (
                      <p className="text-purple-700 text-xs">No active employees loaded.</p>
                    ) : (
                      <div ref={employeeListRef} className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-purple-200 bg-white p-1">
                        {employees.map((emp, idx) => {
                          const isKeyboardFocus = paymentFocusStep === 'employee' && employeeHighlightIndex === idx;
                          const isSelected = selectedEmployee?.id === emp.id;
                          return (
                            <button
                              key={emp.id}
                              type="button"
                              data-emp-idx={idx}
                              onClick={() => {
                                setEmployeeHighlightIndex(idx);
                                setSelectedEmployee(emp);
                                setPaymentFocusStep('tender');
                                setTimeout(() => confirmDeductionRef.current?.focus(), 50);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                isKeyboardFocus
                                  ? 'bg-purple-100 border-2 border-purple-500 text-purple-900 ring-2 ring-purple-200'
                                  : isSelected
                                    ? 'bg-purple-50 border border-purple-300 text-purple-900'
                                    : 'border border-transparent text-gray-800 hover:bg-purple-50/80'
                              }`}
                            >
                              <span className="font-medium">{emp.last_name}, {emp.first_name}</span>
                              <span className="text-purple-600 text-xs ml-1">({emp.employee_code})</span>
                              <span className="block text-xs text-purple-700 mt-0.5">
                                Grocery credit {formatCurrency(emp.grocery_credit_balance || 0)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {selectedEmployee && (
                      <p className="text-purple-800">
                        Amount to deduct: <strong>{formatCurrency(netTotal)}</strong>
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>

            <div className="px-6 pb-6 border-t border-gray-200 pt-4 space-y-3">
              {paymentBlockReason && (
                <p className="text-sm text-red-600 text-center font-medium">{paymentBlockReason}</p>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={closePaymentModal} className="flex-1 py-3 border-2 border-gray-300 rounded-xl font-bold hover:bg-gray-50">
                  Cancel (Esc)
                </button>
                <button
                  ref={paymentMethod === 'Salary Deduction' ? confirmDeductionRef : undefined}
                  type="button"
                  onClick={finalizeSale}
                  disabled={!canCompletePayment}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-300 focus:ring-offset-2"
                >
                  {paymentMethod === 'Charge'
                    ? 'Charge Account'
                    : paymentMethod === 'Salary Deduction'
                      ? 'Confirm Deduction'
                      : 'Complete Payment'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showRecallModal && (
        <ModalOverlay onClose={() => setShowRecallModal(false)}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Recall Suspended Sale</h2>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {suspendedSales.length === 0 && <p className="text-center text-gray-400 py-8">No suspended sales</p>}
                {suspendedSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-gray-50">
                    <div><p className="font-medium text-sm">{sale.transaction_number}</p><p className="text-xs text-gray-500">{sale.customer_name || 'Walk-in'} — {sale.price_mode}</p><p className="text-xs text-gray-400">{new Date(sale.created_at).toLocaleString()}</p></div>
                    <div className="text-right"><p className="font-bold">{formatCurrency(sale.total)}</p><div className="flex gap-1 mt-1"><button type="button" onClick={() => recallSale(sale)} className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Recall</button><button type="button" onClick={() => deleteSuspended(sale.id)} className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Delete</button></div></div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-4"><button type="button" onClick={() => setShowRecallModal(false)} className="px-4 py-2 border rounded-lg text-sm">Close</button></div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showReceiptPreview && receiptPreviewText && (
        <div
          className="fixed inset-0 z-[60] bg-neutral-900/70 flex flex-col"
          onClick={() => setShowReceiptPreview(false)}
        >
          <div
            className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-4 bg-white border-b border-gray-200 shadow-sm"
          >
            <div>
              <h2 className="text-lg font-bold text-gray-900">Receipt Print Preview</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {receiptPaperMm}mm thermal paper · scaled {Math.round(receiptPreviewScale * 100)}% for preview
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => printReceipt()}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700"
              >
                <Printer size={16} /> Print Receipt
              </button>
              <button
                type="button"
                onClick={() => setShowReceiptPreview(false)}
                className="flex items-center gap-2 px-4 py-2.5 border-2 border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50"
              >
                <X size={16} /> Close
              </button>
            </div>
          </div>

          <div
            className="flex-1 min-h-0 overflow-auto flex justify-center items-start py-10 px-6 pb-32"
          >
            <div
              className="flex flex-col items-center gap-3"
              style={{ width: `calc(${receiptPaperMm}mm * ${receiptPreviewScale})` }}
            >
              <div className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">
                Cut line — top of receipt
              </div>
              <div
                className="bg-white shadow-2xl ring-1 ring-black/10"
                style={{
                  width: `${receiptPaperMm}mm`,
                  transform: `scale(${receiptPreviewScale})`,
                  transformOrigin: 'top center',
                }}
              >
                <div
                  className="border-t-4 border-dashed border-gray-200 px-[3mm] py-[2mm]"
                  style={{
                    fontFamily: '"Courier New", Courier, monospace',
                    fontSize: `${receiptPreviewFontPx}px`,
                    lineHeight: 1.25,
                    whiteSpace: 'pre',
                    color: '#111',
                  }}
                >
                  {receiptPreviewText}
                </div>
                <div className="border-b-4 border-dashed border-gray-200 h-2" />
              </div>
              <div className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">
                Cut line — bottom of receipt
              </div>
            </div>
          </div>

          <div
            className="flex-shrink-0 px-6 py-3 bg-neutral-800 text-neutral-300 text-xs flex flex-wrap items-center justify-center gap-x-6 gap-y-1"
          >
            <span>Paper: {receiptPaperMm}mm thermal</span>
            <span>Font: Courier {receiptPreviewFontPx}px (print size)</span>
            <span>Chars per line: {receiptPaperMm === 80 ? 48 : 32}</span>
            <span className="text-neutral-500">Esc to close</span>
          </div>
        </div>
      )}

      {showPaymentComplete && paymentResult && (
        <ModalOverlay onClose={closePaymentComplete}>
          <div
            className="modal-content max-w-md"
            tabIndex={-1}
            ref={paymentModalRef}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                closePaymentComplete();
              }
            }}
          >
            <div className="px-6 pt-6 pb-4 border-b border-gray-200 bg-green-50 rounded-t-xl text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 text-green-600 mb-3">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="text-xl font-bold text-green-700">Payment Complete</h2>
              <p className="text-sm text-green-800 mt-1 font-mono">{paymentResult.transaction_number}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase text-gray-400">Customer</p>
                  <p className="font-medium text-gray-900 mt-0.5 truncate">{paymentResult.customerName || 'Walk-in'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase text-gray-400">Payment</p>
                  <p className="font-medium text-gray-900 mt-0.5">{paymentResult.paymentMethod}</p>
                </div>
                {paymentResult.priceMode && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 col-span-2">
                    <p className="text-[11px] font-semibold uppercase text-gray-400">Price Mode</p>
                    <p className="font-medium text-gray-900 mt-0.5">{paymentResult.priceMode}</p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border-2 border-green-200 bg-white overflow-hidden">
                <div className="flex justify-between items-center px-4 py-4 bg-green-50 border-b border-green-100">
                  <span className="text-sm font-semibold text-gray-700">Total Paid</span>
                  <span className="text-2xl font-bold text-gray-900">{formatCurrency(paymentResult.total)}</span>
                </div>
                <div className="divide-y divide-gray-100 text-sm">
                  {NON_TENDER_METHODS.has(paymentResult.paymentMethod) ? (
                    <div className="flex justify-between px-4 py-2.5">
                      <span className="text-gray-500">
                        {paymentResult.paymentMethod === 'Charge' ? 'Charged to Account' : 'Deducted from Employee'}
                      </span>
                      <span className="font-medium">{formatCurrency(paymentResult.total)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between px-4 py-2.5">
                        <span className="text-gray-500">Amount Tendered</span>
                        <span className="font-medium">{formatCurrency(paymentResult.tendered)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-2.5">
                        <span className="text-gray-500">Change</span>
                        <span className={`font-bold ${paymentResult.change > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {formatCurrency(paymentResult.change)}
                        </span>
                      </div>
                    </>
                  )}
                  {paymentResult.grossProfit != null && Number.isFinite(paymentResult.grossProfit) && (
                    <div className="flex justify-between px-4 py-2.5 bg-gray-50">
                      <span className="text-gray-500">Gross Profit</span>
                      <span className="font-medium text-emerald-600">
                        {formatCurrency(paymentResult.grossProfit)}
                        {paymentResult.marginPct != null && Number.isFinite(paymentResult.marginPct)
                          ? ` (${paymentResult.marginPct.toFixed(1)}%)`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void printReceipt(); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50"
                >
                  <Printer size={16} /> Print Receipt
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openReceiptPreview(); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50"
                >
                  <Receipt size={16} /> Preview
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={closePaymentComplete}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700"
              >
                New Transaction
              </button>
              <p className="text-xs text-center text-gray-500 mt-3">
                Press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] font-mono">Enter</kbd> to continue
              </p>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showCashMove && (
        <ModalOverlay onClose={() => setShowCashMove(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{cashMoveType === 'in' ? 'Cash In' : 'Cash Out'}</h2>
              <div className="space-y-3">
                <input type="number" step="0.01" value={cashForm.amount} onChange={(e) => setCashForm({ ...cashForm, amount: e.target.value })} autoFocus className="w-full px-4 py-3 text-2xl font-bold border-2 border-gray-200 rounded-xl outline-none text-right" placeholder="0.00" />
                <input type="text" value={cashForm.reason} onChange={(e) => setCashForm({ ...cashForm, reason: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder={cashMoveType === 'in' ? 'Reason for cash in' : 'Reason for cash out'} />
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button type="button" onClick={() => setShowCashMove(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={submitCashMove} className={`px-6 py-2 text-white rounded-lg text-sm font-medium ${cashMoveType === 'in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>{cashMoveType === 'in' ? 'Cash In' : 'Cash Out'}</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showOpenShift && (
        <ModalOverlay onClose={() => setShowOpenShift(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Open Shift</h2>
              <p className="text-sm text-gray-500 mb-4">Enter the opening cash float amount</p>
              <input type="number" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') openShift(); }} autoFocus className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-200 rounded-xl outline-none text-right" placeholder="0.00" />
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => { setShowOpenShift(false); setOpeningCash(''); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={openShift} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Open Shift</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showCloseShift && shift && (
        <ModalOverlay onClose={() => setShowCloseShift(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Close Shift</h2>
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Expected Cash</span><span className="font-bold">{formatCurrency(expectedCash)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Net Sales</span><span>{formatCurrency(parseFloat(shift.net_sales || 0))}</span></div>
              </div>
              <label className="block text-sm font-medium mb-1">Closing Cash Count</label>
              <input type="number" step="0.01" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} autoFocus className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-200 rounded-xl outline-none text-right mb-2" placeholder="0.00" />
              <div className={`text-sm font-medium mb-4 ${closingVariance === 0 ? 'text-gray-600' : closingVariance > 0 ? 'text-green-600' : 'text-red-600'}`}>Variance: {formatCurrency(closingVariance)}</div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowCloseShift(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={submitCloseShift} className="px-6 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700">Close Shift</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {voidTarget && (
        <ModalOverlay onClose={() => setVoidTarget(null)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-2">Void Transaction</h2>
              <p className="text-sm text-gray-500 mb-4">{voidTarget.transaction_number} — {formatCurrency(parseFloat(voidTarget.total || 0))}</p>
              <label className="block text-sm font-medium mb-1">Reason</label>
              <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm mb-4" placeholder="Enter void reason..." />
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setVoidTarget(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={submitVoid} className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Void Transaction</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
