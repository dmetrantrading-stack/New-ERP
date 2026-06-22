import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, AlertOctagon, FileWarning, Package, Clock, ClipboardList,
  FileText, Truck, ShoppingCart, Wallet, Building2, type LucideIcon,
} from 'lucide-react';
import api from '../lib/api';

interface Notification {
  type: string;
  title: string;
  message: string;
  reference_type?: string;
  reference_id?: string;
  path?: string;
}

type NotificationPriority = 'critical' | 'warning' | 'info';

const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const NOTIFICATION_META: Record<string, { priority: NotificationPriority; Icon: LucideIcon }> = {
  gl_integrity: { priority: 'critical', Icon: AlertOctagon },
  overdue_invoice: { priority: 'critical', Icon: FileWarning },
  low_stock: { priority: 'warning', Icon: Package },
  expiring: { priority: 'warning', Icon: Clock },
  pending_pr: { priority: 'warning', Icon: ClipboardList },
  draft_apv: { priority: 'warning', Icon: FileText },
  pending_dr: { priority: 'warning', Icon: Truck },
  pending_po: { priority: 'warning', Icon: ShoppingCart },
  overdue_ar: { priority: 'info', Icon: Wallet },
  overdue_ap: { priority: 'info', Icon: Building2 },
};

const PRIORITY_STYLES: Record<NotificationPriority, { border: string; icon: string; title: string; hover: string }> = {
  critical: {
    border: 'border-l-red-500',
    icon: 'text-red-600 bg-red-50',
    title: 'text-red-800',
    hover: 'hover:bg-red-50/60',
  },
  warning: {
    border: 'border-l-amber-500',
    icon: 'text-amber-600 bg-amber-50',
    title: 'text-amber-900',
    hover: 'hover:bg-amber-50/60',
  },
  info: {
    border: 'border-l-blue-400',
    icon: 'text-blue-600 bg-blue-50',
    title: 'text-gray-800',
    hover: 'hover:bg-gray-50',
  },
};

function getNotificationMeta(type: string) {
  return NOTIFICATION_META[type] ?? { priority: 'info' as const, Icon: Bell };
}

function sortNotifications(items: Notification[]) {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_ORDER[getNotificationMeta(a.type).priority];
    const pb = PRIORITY_ORDER[getNotificationMeta(b.type).priority];
    return pa - pb;
  });
}

export default function NotificationsPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => {
    api.get('/notifications')
      .then((r) => {
        const data: Notification[] = r.data.data || [];
        setItems(sortNotifications(data));
        setCount(r.data.unread_count || 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleClick = (n: Notification) => {
    setOpen(false);
    if (n.path) navigate(n.path);
  };

  const criticalCount = items.filter((n) => getNotificationMeta(n.type).priority === 'critical').length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open) load(); }}
        className="relative text-gray-500 hover:text-gray-700"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {count > 0 && (
          <span className={`absolute -top-1 -right-1 text-white text-xs rounded-full min-w-[1rem] h-4 px-0.5 flex items-center justify-center ${criticalCount > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-lg shadow-lg border z-50">
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="font-semibold text-sm">Notifications</span>
            {criticalCount > 0 && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                {criticalCount} urgent
              </span>
            )}
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-sm text-gray-400 text-center">No alerts</p>
          ) : (
            items.map((n, i) => {
              const { priority, Icon } = getNotificationMeta(n.type);
              const styles = PRIORITY_STYLES[priority];
              return (
                <button
                  key={`${n.type}-${n.reference_id ?? i}`}
                  type="button"
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-3 py-2.5 border-b border-l-4 last:border-0 flex gap-2.5 ${styles.border} ${styles.hover}`}
                >
                  <span className={`shrink-0 mt-0.5 p-1.5 rounded-md ${styles.icon}`}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0">
                    <p className={`text-xs font-semibold ${styles.title}`}>{n.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
