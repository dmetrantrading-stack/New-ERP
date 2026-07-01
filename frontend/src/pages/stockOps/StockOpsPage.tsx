import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../store/auth';
import {
  PRIMARY, FINANCE_FONT, financeTabClass,
  parseStockOpsTab, sectionForTab, tabsForSection, sectionsForUser, tabDef, filterStockOpsTabs,
  type StockOpsSectionKey, type StockOpsTabKey,
} from '../../lib/stockOpsUtils';
import InventoryPage from '../inventory/InventoryPage';
import UnitConversions from '../inventory/UnitConversions';
import ProductionOrders from '../production/ProductionOrders';
import ProductionBOM from '../production/ProductionBOM';
import InventoryCountPage from '../inventoryCount/InventoryCountPage';
import StockTransferPage from '../stockTransfer/StockTransferPage';
import {
  Warehouse, Package, ArrowLeftRight, Factory, ClipboardList, Truck, RefreshCw, Layers,
} from 'lucide-react';

const SECTION_ICONS: Record<StockOpsSectionKey, React.ElementType> = {
  inventory: Package,
  movement: Truck,
  production: Factory,
};

const TAB_ICONS: Record<StockOpsTabKey, React.ElementType> = {
  inventory: Package,
  'unit-conversions': ArrowLeftRight,
  production: Factory,
  bom: Layers,
  counts: ClipboardList,
  transfers: Truck,
};

function KpiPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs whitespace-nowrap">
      <span className="text-white/70">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export default function StockOpsPage() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const accessibleTabs = useMemo(() => filterStockOpsTabs(hasPerm), [hasPerm]);
  const sections = useMemo(() => sectionsForUser(hasPerm), [hasPerm]);

  const initialTab = parseStockOpsTab(searchParams.get('tab')) || accessibleTabs[0]?.id || 'inventory';
  const [activeTab, setActiveTab] = useState<StockOpsTabKey>(initialTab);
  const [activeSection, setActiveSection] = useState<StockOpsSectionKey>(() => sectionForTab(initialTab));
  const [invSummary, setInvSummary] = useState({ total_skus: 0, low_stock: 0, inventory_value: 0 });

  const sectionTabs = useMemo(() => tabsForSection(activeSection, hasPerm), [activeSection, hasPerm]);
  const activeDef = tabDef(activeTab);

  const setTab = useCallback((tab: StockOpsTabKey) => {
    setActiveTab(tab);
    setActiveSection(sectionForTab(tab));
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);

  const setSection = useCallback((section: StockOpsSectionKey) => {
    setActiveSection(section);
    const first = tabsForSection(section, hasPerm)[0];
    if (first) setTab(first.id);
  }, [hasPerm, setTab]);

  useEffect(() => {
    if (accessibleTabs.length > 0 && !accessibleTabs.some((t) => t.id === activeTab)) {
      setTab(accessibleTabs[0].id);
    }
  }, [accessibleTabs, activeTab, setTab]);

  useEffect(() => {
    if (sections.length > 0 && !sections.some((s) => s.key === activeSection)) {
      setSection(sections[0].key);
    }
  }, [sections, activeSection, setSection]);

  useEffect(() => {
    const fromUrl = parseStockOpsTab(searchParams.get('tab'));
    if (fromUrl && fromUrl !== activeTab && accessibleTabs.some((t) => t.id === fromUrl)) {
      setActiveTab(fromUrl);
      setActiveSection(sectionForTab(fromUrl));
    }
  }, [searchParams, accessibleTabs, activeTab]);

  const loadInvSummary = useCallback(() => {
    if (!hasPerm('inventory.inventory.view')) return;
    api.get('/inventory/stock-list')
      .then((res) => setInvSummary(res.data.summary || { total_skus: 0, low_stock: 0, inventory_value: 0 }))
      .catch(() => {});
  }, [hasPerm]);

  useEffect(() => {
    if (activeTab === 'inventory') loadInvSummary();
  }, [activeTab, loadInvSummary]);

  const headerKpis = useMemo(() => {
    if (activeTab !== 'inventory') return [];
    return [
      { label: 'SKUs', value: String(invSummary.total_skus) },
      { label: 'Low Stock', value: String(invSummary.low_stock) },
      { label: 'Value', value: formatCurrency(invSummary.inventory_value) },
    ];
  }, [activeTab, invSummary]);

  const renderTab = () => {
    switch (activeTab) {
      case 'inventory': return <InventoryPage embedded onRefresh={loadInvSummary} />;
      case 'unit-conversions': return <UnitConversions embedded />;
      case 'production': return <ProductionOrders embedded />;
      case 'bom': return <ProductionBOM embedded />;
      case 'counts': return <InventoryCountPage embedded />;
      case 'transfers': return <StockTransferPage embedded />;
      default: return null;
    }
  };

  if (accessibleTabs.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
        <div className="text-center text-gray-500">
          <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No stock operations available</p>
          <p className="text-sm mt-1">Contact an administrator to assign inventory permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Warehouse size={18} className="text-white/90 flex-shrink-0" />
          <h1 className="text-white font-semibold text-sm tracking-wide flex-shrink-0 hidden sm:block">Stock & Ops</h1>
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto min-w-0 flex-1">
            {sections.map((s) => {
              const Icon = SECTION_ICONS[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSection(s.key)}
                  className={financeTabClass(activeSection === s.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon size={13} />
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 flex-shrink-0 overflow-x-auto max-w-[45%]">
          {headerKpis.map((k) => <KpiPill key={k.label} label={k.label} value={k.value} />)}
        </div>
        {activeTab === 'inventory' && (
          <button
            type="button"
            onClick={loadInvSummary}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20 flex-shrink-0"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        )}
      </div>

      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {sectionTabs.map((t) => {
            const Icon = TAB_ICONS[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === t.id
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
            {activeDef.label} · {sections.find((s) => s.key === activeSection)?.label}
            {activeDef.description ? ` — ${activeDef.description}` : ''}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 p-4 overflow-auto">
        {renderTab()}
      </div>
    </div>
  );
}
