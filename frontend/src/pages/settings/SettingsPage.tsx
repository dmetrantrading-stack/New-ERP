import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import {
  PRIMARY, FINANCE_FONT, financeTabClass, SETTINGS_TABS, SettingsTabKey,
  canAccessSettingsTab, parseSettingsTab, parseSettingsSection, settingsTabHasSections,
} from '../../lib/settingsUtils';
import SettingsCompanyTab from './SettingsCompanyTab';
import SettingsPosTab from './SettingsPosTab';
import SettingsSalesTab from './SettingsSalesTab';
import SettingsUsersTab from './SettingsUsersTab';
import SettingsDataToolsTab from './SettingsDataToolsTab';
import {
  Settings, Building2, Monitor, ShoppingCart, Shield, Database, RefreshCw,
} from 'lucide-react';

const TAB_ICONS: Record<SettingsTabKey, React.ElementType> = {
  company: Building2,
  pos: Monitor,
  sales: ShoppingCart,
  users: Shield,
  system: Database,
};

export default function SettingsPage() {
  const { hasPerm, hasAnyPerm } = useAuth();
  const canEdit = hasPerm('system.settings.edit');
  const [searchParams, setSearchParams] = useSearchParams();

  const tabs = useMemo(
    () => SETTINGS_TABS.filter((t) => canAccessSettingsTab(hasAnyPerm, t.key)),
    [hasAnyPerm],
  );

  const tabParam = searchParams.get('tab');
  const initialTab = parseSettingsTab(tabParam) || tabs[0]?.key || 'company';
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);
  const [activeSection, setActiveSection] = useState(() =>
    parseSettingsSection(initialTab, searchParams.get('section'), tabParam),
  );

  const setTab = useCallback((key: SettingsTabKey) => {
    const section = parseSettingsSection(key, null, null);
    setActiveTab(key);
    setActiveSection(section);
    const params: Record<string, string> = { tab: key };
    if (section) params.section = section;
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const setSection = useCallback((section: string) => {
    setActiveSection(section);
    setSearchParams({ tab: activeTab, section }, { replace: true });
  }, [activeTab, setSearchParams]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTab)) {
      setTab(tabs[0].key);
    }
  }, [tabs, activeTab, setTab]);

  useEffect(() => {
    const fromUrlTab = parseSettingsTab(searchParams.get('tab'));
    if (!fromUrlTab || !tabs.some((t) => t.key === fromUrlTab)) return;
    const fromUrlSection = parseSettingsSection(fromUrlTab, searchParams.get('section'), searchParams.get('tab'));
    if (fromUrlTab !== activeTab) setActiveTab(fromUrlTab);
    if (fromUrlSection !== activeSection) setActiveSection(fromUrlSection);
  }, [searchParams, tabs, activeTab, activeSection]);

  if (tabs.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
        <p className="text-sm text-gray-600">You do not have permission to view Settings.</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Settings size={18} className="text-white/90 flex-shrink-0" />
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
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20 flex-shrink-0"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {!canEdit && activeTab !== 'users' && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
          Read-only mode — you have view access only. Contact an administrator to change settings.
        </div>
      )}

      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        {activeTab === 'company' && <SettingsCompanyTab />}

        {activeTab === 'pos' && settingsTabHasSections('pos') && (
          <SettingsPosTab section={activeSection} onSectionChange={setSection} />
        )}

        {activeTab === 'sales' && settingsTabHasSections('sales') && (
          <SettingsSalesTab section={activeSection} onSectionChange={setSection} />
        )}

        {activeTab === 'users' && settingsTabHasSections('users') && (
          <SettingsUsersTab section={activeSection} onSectionChange={setSection} />
        )}

        {activeTab === 'system' && settingsTabHasSections('system') && (
          <SettingsDataToolsTab section={activeSection} onSectionChange={setSection} />
        )}
      </div>
    </div>
  );
}
