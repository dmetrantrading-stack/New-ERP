import React from 'react';

/** Full-viewport wrapper for POS — no ERP sidebar or global header. */
export default function PosShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-100">
      {children}
    </div>
  );
}
