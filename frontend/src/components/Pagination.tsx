import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  limit?: number;
  onLimitChange?: (limit: number) => void;
  showSizeChanger?: boolean;
}

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'ellipsis')[] = [1];
  if (current > 3) pages.push('ellipsis');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push('ellipsis');
  if (total > 1) pages.push(total);
  return pages;
}

export default function Pagination({ page, totalPages, total, onPageChange, limit, onLimitChange, showSizeChanger }: PaginationProps) {
  if (totalPages <= 1 && !showSizeChanger) return null;
  const from = (page - 1) * (limit || 1) + 1;
  const to = Math.min(page * (limit || 1), total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white rounded-b-lg">
      <div className="flex items-center gap-4">
        <p className="text-sm text-gray-500">
          Showing <span className="font-medium">{from}–{to}</span> of <span className="font-medium">{total}</span>
        </p>
        {showSizeChanger && onLimitChange && (
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
        </button>
        {getPageNumbers(page, totalPages).map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e${i}`} className="px-2 py-1 text-sm text-gray-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={
                'min-w-[32px] px-2 py-1 text-sm rounded border ' +
                (p === page
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50')
              }
            >
              {p}
            </button>
          )
        )}
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
