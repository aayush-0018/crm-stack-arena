import { Check, ListFilter } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { todayIST } from '../../lib/date';
import { controlClass } from '../ui/Field';

/** A filter that lives in a table column's header. */
export type ColumnFilter =
  | { kind: 'options'; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }
  | { kind: 'date'; from: string; to: string; onChange: (from: string, to: string) => void };

export const isFilterActive = (f: ColumnFilter) => (f.kind === 'options' ? !!f.value : !!(f.from || f.to));

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function datePresets() {
  const today = todayIST();
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: shift(today, -1), to: shift(today, -1) },
    { label: 'Last 7 days', from: shift(today, -6), to: today },
    { label: 'Last 30 days', from: shift(today, -29), to: today },
    { label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
  ];
}

/**
 * The small filter button in a column header, and its menu. The menu is fixed-positioned
 * so the table's horizontal scroll area can't clip it.
 */
export default function HeaderFilter({ filter, label }: { filter: ColumnFilter; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = isFilterActive(filter);
  const width = filter.kind === 'date' ? 300 : 230;

  useEffect(() => {
    if (!open) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.min(Math.max(12, r.left - 8), window.innerWidth - width - 12) });
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, width]);

  const row = 'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover';

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={active ? `Filter ${label} (active)` : `Filter ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Filter ${label.toLowerCase()}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          active ? 'bg-ink text-on-ink hover:bg-ink-strong' : 'text-ink-4 hover:bg-hover hover:text-ink'
        }`}
      >
        <ListFilter size={12} strokeWidth={2.25} />
      </button>

      {open && (
        <div
          ref={menu}
          role="dialog"
          aria-label={`Filter by ${label}`}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          className="z-50 rounded-xl border border-line bg-surface p-1.5 text-left text-[13.5px] font-normal normal-case tracking-normal text-ink shadow-pop"
        >
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{label}</p>

          {filter.kind === 'options' ? (
            <>
              {[{ value: '', label: 'All' }, ...filter.options].map((o) => (
                <button
                  key={o.value || 'all'}
                  type="button"
                  className={row}
                  onClick={() => {
                    filter.onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className="flex w-4 justify-center">{filter.value === o.value && <Check size={14} strokeWidth={2.5} />}</span>
                  {o.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {datePresets().map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={row}
                  onClick={() => {
                    filter.onChange(p.from, p.to);
                    setOpen(false);
                  }}
                >
                  <span className="flex w-4 justify-center">{filter.from === p.from && filter.to === p.to && <Check size={14} strokeWidth={2.5} />}</span>
                  {p.label}
                </button>
              ))}
              <div className="mt-1 border-t border-line px-2 pb-1 pt-2.5">
                <p className="mb-1.5 text-[12px] text-ink-3">Custom range</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="From date"
                    value={filter.from}
                    max={filter.to || undefined}
                    onChange={(e) => filter.onChange(e.target.value, filter.to)}
                    className={controlClass(false, 'h-8 px-2 text-[13px]')}
                  />
                  <input
                    type="date"
                    aria-label="To date"
                    value={filter.to}
                    min={filter.from || undefined}
                    onChange={(e) => filter.onChange(filter.from, e.target.value)}
                    className={controlClass(false, 'h-8 px-2 text-[13px]')}
                  />
                </div>
              </div>
            </>
          )}

          {active && (
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                className={`${row} text-ink-2`}
                onClick={() => {
                  if (filter.kind === 'options') filter.onChange('');
                  else filter.onChange('', '');
                  setOpen(false);
                }}
              >
                <span className="w-4" />
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
