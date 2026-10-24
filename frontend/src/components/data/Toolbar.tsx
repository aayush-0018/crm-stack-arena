import { ListFilter, Search, SlidersHorizontal, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import Popover, { MenuLabel } from '../ui/Popover';

export function Toolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="no-print flex min-h-[52px] flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-5">{children}</div>
      {right && <div className="flex items-center gap-4">{right}</div>}
    </div>
  );
}

const toolBtn = 'inline-flex h-8 items-center gap-1.5 rounded-md text-[14px] text-ink-2 hover:text-ink';

export function FilterButton({ count, children }: { count: number; children: (close: () => void) => ReactNode }) {
  return (
    <Popover
      width={260}
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} className={`${toolBtn} ${count ? 'text-ink' : ''}`}>
          <ListFilter size={16} strokeWidth={1.75} />
          Filters
          {count > 0 && <span className="rounded border border-line px-1.5 text-[11px] font-medium leading-[18px] text-ink">{count}</span>}
        </button>
      )}
    >
      {(close) => children(close)}
    </Popover>
  );
}

/** Borderless search input; debounces onChange by 300ms. */
export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 text-ink-3 focus-within:text-ink-2 sm:max-w-sm">
      <Search size={16} strokeWidth={1.75} className="shrink-0" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
      />
      {text && (
        <button type="button" onClick={() => { setText(''); onChange(''); }} aria-label="Clear search" className="text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      )}
    </label>
  );
}

export function CustomizeButton({
  columns,
  hidden,
  onToggle,
}: {
  columns: { key: string; header: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <Popover
      align="end"
      width={220}
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} className={toolBtn}>
          <SlidersHorizontal size={16} strokeWidth={1.75} />
          <span className="hidden sm:inline">Customize</span>
        </button>
      )}
    >
      {() => (
        <>
          <MenuLabel>Columns</MenuLabel>
          {columns.map((c) => (
            <label key={c.key} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13.5px] hover:bg-hover">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[#171717]" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.header}
            </label>
          ))}
        </>
      )}
    </Popover>
  );
}

/** Chip-style option row used inside the Filters popover. */
export function FilterOptions<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | '';
  onChange: (v: T | '') => void;
}) {
  return (
    <div className="px-1 pb-2">
      <MenuLabel>{label}</MenuLabel>
      <div className="flex flex-wrap gap-1.5 px-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? '' : o.value)}
            className={`h-7 rounded-md border px-2.5 text-[13px] ${
              value === o.value ? 'border-ink bg-ink text-white' : 'border-line text-ink-2 hover:bg-hover'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Persisted set of hidden column keys (per table, per browser). */
export function useHiddenColumns(storageKey: string, defaults: string[] = []) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* storage unavailable */
    }
    return new Set(defaults);
  });
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  return { hidden, toggle };
}
