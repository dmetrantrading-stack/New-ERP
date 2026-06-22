import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { formatQuantity } from '../lib/utils';

interface ProductAutocompleteProps {
  products: any[];
  value: string;
  selectedName: string;
  onSelect: (product: any) => void;
  getPrice: (product: any) => number;
  placeholder?: string;
  searchFn?: (query: string) => Promise<any[]>;
  autoFocus?: boolean;
}

function productStock(p: any): number {
  const n = parseFloat(p?.store_stock ?? p?.stock ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default function ProductAutocomplete({
  products, value, selectedName, onSelect, getPrice, placeholder, searchFn, autoFocus,
}: ProductAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [serverResults, setServerResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!searchFn || !query.trim()) {
      setServerResults(null);
      setSearching(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestId = ++requestIdRef.current;
    setSearching(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchFn(query.trim());
        if (requestIdRef.current !== requestId) return;
        setServerResults(Array.isArray(res) ? res : []);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setServerResults([]);
      } finally {
        if (requestIdRef.current === requestId) setSearching(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchFn]);

  const results = useMemo(() => {
    if (!query.trim()) return [];

    if (searchFn) {
      if (serverResults === null) return [];
      return serverResults.slice(0, 12);
    }

    const q = query.toLowerCase();
    return products
      .filter((p: any) => p.is_active !== false && (
        p.name?.toLowerCase().includes(q)
        || p.sku?.toLowerCase().includes(q)
        || p.barcode?.toLowerCase().includes(q)
      ))
      .slice(0, 12);
  }, [query, products, searchFn, serverResults]);

  useEffect(() => {
    if (results.length > 0 && highlight >= results.length) {
      setHighlight(Math.max(0, results.length - 1));
    }
  }, [results, highlight]);

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 280),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition, query, results.length]);

  useEffect(() => {
    if (listRef.current && open) {
      const items = listRef.current.children;
      if (items[highlight]) {
        (items[highlight] as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlight, open]);

  const selectProduct = (product: any) => {
    onSelect(product);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    setServerResults(null);
    setSearching(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (!open) { setOpen(true); return; }
      if (results.length === 0) return;
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!open || results.length === 0) return;
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter' && open && results[highlight]) {
      e.preventDefault();
      selectProduct(results[highlight]);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  const showDropdown = open && query.trim().length > 0;
  const showResults = showDropdown && results.length > 0;
  const showEmpty = showDropdown && !searching && results.length === 0;
  const showLoading = showDropdown && searching;

  const dropdownStyle: React.CSSProperties = {
    zIndex: 99999,
    top: pos.top,
    left: pos.left,
    width: pos.width,
  };

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const resultsDropdown = showResults && createPortal(
    <div
      ref={listRef}
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 overflow-y-auto"
      style={dropdownStyle}
    >
      {results.map((p: any, idx: number) => {
        const price = getPrice(p);
        const stock = productStock(p);
        return (
          <div
            key={p.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectProduct(p)}
            onMouseEnter={() => setHighlight(idx)}
            className={`flex justify-between items-center gap-2 px-3 py-2 cursor-pointer text-xs border-b border-gray-100 last:border-0 ${
              idx === highlight ? 'bg-blue-100 font-medium' : 'hover:bg-blue-50'
            }`}
          >
            <div className="min-w-0">
              <span className="font-medium">{p.name}</span>
              <span className="text-gray-400 ml-1">({p.sku})</span>
              {stock > 0 && <span className="text-green-600 ml-2">{formatQuantity(stock)} in stock</span>}
            </div>
            <span className="text-gray-500 shrink-0">{formatCurrency(price || 0)}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );

  const loadingDropdown = showLoading && createPortal(
    <div
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-3 text-xs text-gray-500 text-center"
      style={dropdownStyle}
    >
      Searching products…
    </div>,
    document.body,
  );

  const emptyDropdown = showEmpty && createPortal(
    <div
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-3 text-xs text-gray-400 text-center"
      style={dropdownStyle}
    >
      No products found
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedName}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); updatePosition(); }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); setSearching(false); }, 200)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Search product…'}
        className="w-full px-2 py-1 border border-gray-200 rounded text-xs outline-none focus:ring-1 focus:ring-blue-400"
        autoComplete="off"
      />
      {resultsDropdown}
      {loadingDropdown}
      {emptyDropdown}
    </div>
  );
}
