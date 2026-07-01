import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import {
  PRIMARY, FINANCE_FONT,
  SUPPLIER_TABS, SupplierTabKey, SupplierEntityType, parseSupplierTab, tabToEntityType, entityTypeToTabKey,
} from '../../lib/suppliersUtils';
import SupplierList from './SupplierList';
import { Building2, User, RefreshCw } from 'lucide-react';

const TAB_ICONS: Record<SupplierTabKey, React.ElementType> = {
  corporation: Building2,
  'sole-prop': User,
};

function KpiPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs whitespace-nowrap">
      <span className="text-white/70">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export default function SuppliersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState({ corporation: 0, soleProp: 0 });

  const initialTab = parseSupplierTab(searchParams.get('tab')) || 'corporation';
  const [activeTab, setActiveTab] = useState<SupplierTabKey>(initialTab);

  const activeDef = useMemo(
    () => SUPPLIER_TABS.find((t) => t.key === activeTab),
    [activeTab],
  );

  const setTab = useCallback((key: SupplierTabKey) => {
    setActiveTab(key);
    setSearchParams(key === 'corporation' ? {} : { tab: key }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const fromUrl = parseSupplierTab(searchParams.get('tab'));
    if (fromUrl && fromUrl !== activeTab) setActiveTab(fromUrl);
  }, [searchParams, activeTab]);

  const loadStats = useCallback(() => {
    Promise.all([
      api.get('/suppliers?limit=1&entity_type=Corporation').then((r) => r.data.total || 0).catch(() => 0),
      api.get('/suppliers?limit=1&entity_type=Sole Proprietorship').then((r) => r.data.total || 0).catch(() => 0),
    ]).then(([corporation, soleProp]) => setStats({ corporation, soleProp }));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const headerKpis = useMemo(() => [
    { label: 'Corporation', value: String(stats.corporation) },
    { label: 'Sole Prop', value: String(stats.soleProp) },
  ], [stats]);

  const handleReclassified = useCallback((newType: SupplierEntityType) => {
    const targetTab = entityTypeToTabKey(newType);
    if (targetTab !== activeTab) setTab(targetTab);
  }, [activeTab, setTab]);

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0">
          <Building2 size={18} className="text-white/90 flex-shrink-0" />
          <h1 className="text-white font-semibold text-sm tracking-wide flex-shrink-0 hidden sm:block">Supplier Master</h1>
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

      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {SUPPLIER_TABS.map((t) => {
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

      <div className="flex-1 min-h-0 p-4 overflow-hidden flex flex-col">
        <SupplierList
          key={activeTab}
          embedded
          entityType={tabToEntityType(activeTab)}
          onChanged={loadStats}
          onReclassified={handleReclassified}
        />
      </div>
    </div>
  );
}
