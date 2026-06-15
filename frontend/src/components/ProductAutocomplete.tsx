import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ProductAutocompleteProps {
  products: any[];
  value: string;
  selectedName: string;
  onSelect: (product: any) => void;
  getPrice: (product: any) => number;
  placeholder?: string;
  searchFn?: (query: string) => Promise<any[]>;
}

export default function ProductAutocomplete({ products, value, selectedName, onSelect, getPrice, placeholder, searchFn }: ProductAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [serverResults, setServerResults] = useState<any[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  React.useEffect(() => {
    if (searchFn && query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const res = await searchFn(query);
        setServerResults(res);
      }, 250);
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    } else {
      setServerResults(null);
    }
  }, [query, searchFn]);

  const results = React.useMemo(() => {
    if (!query.trim()) return [];
    if (serverResults) return serverResults.slice(0, 12);
    const q = query.toLowerCase();
    return products
      .filter((p: any) => p.is_active !== false && (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)))
      .slice(0, 12);
  }, [query, products, serverResults]);

  useEffect(() => {
    if (results.length > 0 && highlight >= results.length) {
      setHighlight(Math.max(0, results.length - 1));
    }
  }, [results, highlight]);

  const updatePosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [open, updatePosition]);

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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && results[highlight]) { e.preventDefault(); selectProduct(results[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  const dropdown = open && query && results.length > 0 && createPortal(
    <div
      ref={listRef}
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg max-h-96 overflow-y-auto"
      style={{ zIndex: 99999, top: pos.top, left: pos.left, width: pos.width }}
    >
      {results.map((p: any, idx: number) => {
        const price = getPrice(p);
        return (
          <div
            key={p.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectProduct(p)}
            onMouseEnter={() => setHighlight(idx)}
            className={`flex justify-between items-center px-3 py-2 cursor-pointer text-xs border-b border-gray-100 last:border-0 ${idx === highlight ? 'bg-blue-200 font-medium' : 'hover:bg-blue-50'}`}
          >
            <div>
              <span className="font-medium">{p.name}</span>
              <span className="text-gray-400 ml-1">({p.sku})</span>
              {p.store_stock > 0 && <span className="text-green-500 ml-2">{p.store_stock} in stock</span>}
            </div>
            <span className="text-gray-400">{formatCurrency(price || 0)}</span>
          </div>
        );
      })}
    </div>,
    document.body
  );

  const emptyPortal = open && query && results.length === 0 && createPortal(
    <div className="fixed bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-3 text-xs text-gray-400 text-center" style={{ zIndex: 99999, top: pos.top, left: pos.left, width: pos.width }}>
      No products found
    </div>,
    document.body
  );

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedName}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 200)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Search product...'}
        className="w-full px-2 py-1 border border-gray-200 rounded text-xs outline-none focus:ring-1 focus:ring-blue-400"
      />
      {dropdown}
      {emptyPortal}
    </div>
  );
}
