import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import {
  PRIMARY, FINANCE_FONT, financeTabClass,
  ProductsTabKey,
  filterProductsTabs, parseProductsTab, PRODUCTS_TABS,
} from '../../lib/productsUtils';
import ProductList from './ProductList';
import CategoryList from '../categories/CategoryList';
import BrandList from '../brands/BrandList';
import { Package, Tags, Bookmark, RefreshCw } from 'lucide-react';

const TAB_ICONS: Record<ProductsTabKey, React.ElementType> = {
  products: Package,
  categories: Tags,
  brands: Bookmark,
};

function KpiPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs whitespace-nowrap">
      <span className="text-white/70">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export default function ProductsPage() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState({ products: 0, categories: 0, brands: 0 });
  const [catalogFormOpen, setCatalogFormOpen] = useState(false);

  const tabs = useMemo(() => filterProductsTabs(hasPerm), [hasPerm]);
  const initialTab = parseProductsTab(searchParams.get('tab')) || tabs[0]?.key || 'products';
  const [activeTab, setActiveTab] = useState<ProductsTabKey>(initialTab);

  const activeDef = useMemo(
    () => PRODUCTS_TABS.find((t) => t.key === activeTab),
    [activeTab],
  );

  const setTab = useCallback((key: ProductsTabKey) => {
    setActiveTab(key);
    setSearchParams(key === 'products' ? {} : { tab: key }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTab)) {
      setTab(tabs[0].key);
    }
  }, [tabs, activeTab, setTab]);

  useEffect(() => {
    const fromUrl = parseProductsTab(searchParams.get('tab'));
    if (fromUrl && fromUrl !== activeTab && tabs.some((t) => t.key === fromUrl)) {
      setActiveTab(fromUrl);
    }
  }, [searchParams, tabs, activeTab]);

  const loadStats = useCallback(() => {
    Promise.all([
      api.get('/products?limit=1').then((r) => r.data.total || 0).catch(() => 0),
      api.get('/categories/all').then((r) => (Array.isArray(r.data) ? r.data.length : 0)).catch(() => 0),
      api.get('/brands/all').then((r) => (Array.isArray(r.data) ? r.data.length : 0)).catch(() => 0),
    ]).then(([products, categories, brands]) => setStats({ products, categories, brands }));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const headerKpis = useMemo(() => [
    { label: 'Products', value: String(stats.products) },
    { label: 'Categories', value: String(stats.categories) },
    { label: 'Brands', value: String(stats.brands) },
  ], [stats]);

  const renderTab = () => {
    switch (activeTab) {
      case 'categories': return <CategoryList embedded onChanged={loadStats} />;
      case 'brands': return <BrandList embedded onChanged={loadStats} />;
      default: return <ProductList embedded onChanged={loadStats} onFormOpenChange={setCatalogFormOpen} />;
    }
  };

  if (tabs.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
        <div className="text-center text-gray-500">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No product catalog access</p>
          <p className="text-sm mt-1">Contact an administrator to assign inventory permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      {!catalogFormOpen && (
        <>
          {/* SAP shell bar */}
          <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
            <div className="flex items-center gap-3 min-w-0">
              <Package size={18} className="text-white/90 flex-shrink-0" />
              <h1 className="text-white font-semibold text-sm tracking-wide flex-shrink-0 hidden sm:block">Product Master</h1>
            </div>
            <div className="hidden md:flex items-center gap-2 flex-shrink-0 overflow-x-auto max-w-[50%]">
              {headerKpis.map((k) => <KpiPill key={k.label} label={k.label} value={k.value} />)}
            </div>
            <button
              type="button"
              onClick={loadStats}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20 flex-shrink-0"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          {/* Sub-navigation (SAP object page tabs) */}
          <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {tabs.map((t) => {
                const Icon = TAB_ICONS[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      activeTab === t.key
                        ? 'bg-blue-700 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Icon size={13} />
                    {t.label}
                  </button>
                );
              })}
            </div>
            {activeDef && (
              <p className="text-[11px] text-gray-400 mt-2">
                {activeDef.label}
                {activeDef.description ? ` — ${activeDef.description}` : ''}
              </p>
            )}
          </div>
        </>
      )}

      <div className={`flex-1 min-h-0 overflow-hidden flex flex-col ${catalogFormOpen ? '' : 'p-4'}`}>
        {renderTab()}
      </div>
    </div>
  );
}
