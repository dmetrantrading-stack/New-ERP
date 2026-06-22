import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, ChevronDown } from 'lucide-react';
import {
  getSalesCopyTargets,
  type SalesCopySourceType,
} from '../lib/salesCopy';

type CopyToMenuProps = {
  sourceType: SalesCopySourceType;
  docId: string;
  doc: any;
  hasPerm: (perm: string) => boolean;
  onNavigate?: () => void;
  variant?: 'header' | 'list';
};

export default function CopyToMenu({
  sourceType,
  docId,
  doc,
  hasPerm,
  onNavigate,
  variant = 'header',
}: CopyToMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const targets = getSalesCopyTargets(sourceType, doc, hasPerm);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (targets.length === 0) return null;

  const handleSelect = (target: (typeof targets)[0]) => {
    setOpen(false);
    onNavigate?.();
    target.navigate(navigate, docId);
  };

  if (variant === 'list') {
    return (
      <div className="relative inline-block" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="p-1 hover:bg-purple-50 rounded text-purple-600"
          title="Copy to"
        >
          <Copy size={14} />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase">Copy to</div>
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => handleSelect(target)}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700"
              >
                {target.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"
      >
        <Copy size={13} />
        Copy to
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-xl py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase border-b border-gray-100">
            Create from this document
          </div>
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => handleSelect(target)}
              className="w-full text-left px-3 py-2.5 text-xs font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700"
            >
              {target.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
