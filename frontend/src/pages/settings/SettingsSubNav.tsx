import React from 'react';

type Section = { key: string; label: string };

export default function SettingsSubNav({
  sections,
  active,
  onChange,
}: {
  sections: readonly Section[];
  active: string;
  onChange: (key: string) => void;
}) {
  if (!sections.length) return null;

  return (
    <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl border border-gray-200 mb-4">
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            active === s.key
              ? 'bg-white text-blue-800 shadow-sm border border-gray-200'
              : 'text-gray-600 hover:bg-white/70'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
