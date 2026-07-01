import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

export function formatSupplierLabel(s: { supplier_code?: string; supplier_name?: string; entity_type?: string } | null | undefined): string {
  if (!s) return '';
  const code = String(s.supplier_code || '').trim();
  const name = String(s.supplier_name || '').trim();
  const typeTag = s.entity_type === 'Sole Proprietorship' ? 'SP' : s.entity_type === 'Corporation' ? 'Corp' : '';
  const base = code && name ? `${code} · ${name}` : name || code;
  return typeTag ? `${base} [${typeTag}]` : base;
}

interface SupplierAutocompleteProps {
  suppliers: any[];
  value: string;
  selectedName: string;
  onSelect: (supplier: any) => void;
  placeholder?: string;
  searchFn?: (query: string) => Promise<any[]>;
  autoFocus?: boolean;
  disabled?: boolean;
}

export default function SupplierAutocomplete({
  suppliers,
  value,
  selectedName,
  onSelect,
  placeholder,
  searchFn,
  autoFocus,
  disabled = false,
}: SupplierAutocompleteProps) {
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
    if (autoFocus && inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, disabled]);

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
    return suppliers
      .filter((s: any) => s.is_active !== false && (
        s.supplier_name?.toLowerCase().includes(q)
        || s.supplier_code?.toLowerCase().includes(q)
      ))
      .slice(0, 12);
  }, [query, suppliers, searchFn, serverResults]);

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
      width: Math.max(rect.width, 300),
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

  const selectSupplier = (supplier: any) => {
    onSelect(supplier);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    setServerResults(null);
    setSearching(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
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
      selectSupplier(results[highlight]);
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

  const resultsDropdown = showResults && createPortal(
    <div
      ref={listRef}
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 overflow-y-auto"
      style={dropdownStyle}
    >
      {results.map((s: any, idx: number) => (
        <div
          key={s.id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => selectSupplier(s)}
          onMouseEnter={() => setHighlight(idx)}
          className={`px-3 py-2 cursor-pointer text-xs border-b border-gray-100 last:border-0 ${
            idx === highlight ? 'bg-blue-100 font-medium' : 'hover:bg-blue-50'
          }`}
        >
          <div className="font-medium">{formatSupplierLabel(s)}</div>
          {s.contact_person && (
            <div className="text-[10px] text-gray-500 mt-0.5">{s.contact_person}</div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );

  const loadingDropdown = showLoading && createPortal(
    <div
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-3 text-xs text-gray-500 text-center"
      style={dropdownStyle}
    >
      Searching suppliers…
    </div>,
    document.body,
  );

  const emptyDropdown = showEmpty && createPortal(
    <div
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-3 text-xs text-gray-400 text-center"
      style={dropdownStyle}
    >
      No suppliers found
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={open ? query : selectedName}
        onChange={(e) => { if (disabled) return; setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery('');
          setHighlight(0);
          updatePosition();
        }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); setSearching(false); }, 200)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Search supplier…'}
        className={`w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-blue-400 ${
          disabled ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''
        }`}
        autoComplete="off"
      />
      {value && !open && !disabled && (
        <button
          type="button"
          onClick={() => onSelect({ id: '', supplier_name: '' })}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
          title="Clear supplier"
        >
          ×
        </button>
      )}
      {resultsDropdown}
      {loadingDropdown}
      {emptyDropdown}
    </div>
  );
}
