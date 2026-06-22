import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../store/auth';
import {
  PRIMARY, FINANCE_FONT, financeTabClass,
  StockOpsTabKey,
  filterStockOpsTabs, parseStockOpsTab,
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

  const tabs = useMemo(() => filterStockOpsTabs(hasPerm), [hasPerm]);
  const initialTab = parseStockOpsTab(searchParams.get('tab')) || tabs[0]?.key || 'inventory';
  const [activeTab, setActiveTab] = useState<StockOpsTabKey>(initialTab);
  const [invSummary, setInvSummary] = useState({ total_skus: 0, low_stock: 0, inventory_value: 0 });

  const setTab = useCallback((key: StockOpsTabKey) => {
    setActiveTab(key);
    setSearchParams({ tab: key }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTab)) {
      setTab(tabs[0].key);
    }
  }, [tabs, activeTab, setTab]);

  useEffect(() => {
    const fromUrl = parseStockOpsTab(searchParams.get('tab'));
    if (fromUrl && fromUrl !== activeTab && tabs.some((t) => t.key === fromUrl)) {
      setActiveTab(fromUrl);
    }
  }, [searchParams, tabs, activeTab]);

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

  if (tabs.length === 0) {
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
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto max-w-full">
            {tabs.map((t) => {
              const Icon = TAB_ICONS[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={financeTabClass(activeTab === t.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon size={13} />
                    {t.label}
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

      <div className="flex-1 min-h-0 p-4 overflow-auto">
        {renderTab()}
      </div>
    </div>
  );
}
