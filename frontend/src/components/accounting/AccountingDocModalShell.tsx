import React from 'react';
import ModalOverlay from '../ModalOverlay';
import { X, ChevronRight } from 'lucide-react';
import { PRIMARY } from '../../lib/financeUtils';

export type Breadcrumb = { label: string; onClick?: () => void };

interface Props {
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: { label: string; className?: string };
  statusBadge?: string;
  breadcrumbs?: Breadcrumb[];
  footer?: React.ReactNode;
  maxWidth?: '2xl' | '3xl' | '4xl' | '5xl' | '6xl';
  children: React.ReactNode;
}

const WIDTH: Record<string, string> = {
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};

export default function AccountingDocModalShell({
  onClose,
  title,
  subtitle,
  badge,
  statusBadge,
  breadcrumbs,
  footer,
  maxWidth = '4xl',
  children,
}: Props) {
  return (
    <ModalOverlay onClose={onClose}>
      <div
        className={`modal-content ${WIDTH[maxWidth]} max-h-[92vh] overflow-hidden flex flex-col shadow-2xl`}
      >
        <div className="flex-shrink-0 text-white" style={{ backgroundColor: PRIMARY }}>
          <div className="px-5 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {breadcrumbs && breadcrumbs.length > 0 && (
                <nav className="flex flex-wrap items-center gap-1 text-[10px] text-white/70 mb-1.5">
                  {breadcrumbs.map((crumb, i) => (
                    <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight size={10} className="text-white/50" />}
                      {crumb.onClick ? (
                        <button type="button" onClick={crumb.onClick} className="hover:text-white underline-offset-2 hover:underline">
                          {crumb.label}
                        </button>
                      ) : (
                        <span className="text-white/90">{crumb.label}</span>
                      )}
                    </span>
                  ))}
                </nav>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {badge && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badge.className || 'bg-white/20 border-white/30'}`}>
                    {badge.label}
                  </span>
                )}
                <h2 className="text-base font-semibold truncate">{title}</h2>
                {statusBadge && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/20">{statusBadge}</span>
                )}
              </div>
              {subtitle && <p className="text-xs text-white/75 mt-0.5 truncate">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-white/15 shrink-0" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50">{children}</div>

        {footer && (
          <div className="flex-shrink-0 px-5 py-3 border-t bg-white flex items-center justify-between gap-3">
            {footer}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
