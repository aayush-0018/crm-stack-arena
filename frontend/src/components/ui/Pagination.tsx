import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button';

export default function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-[13px] text-ink-3 sm:px-6">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft size={15} />
        </Button>
        <span className="px-1 tabular-nums text-ink-2">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight size={15} />
        </Button>
      </div>
    </div>
  );
}
