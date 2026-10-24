import { ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

/** Underline tabs that sit on the panel's top edge. */
export default function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange?: (key: string) => void }) {
  return (
    <div role="tablist" className="-mb-px flex min-w-0 gap-6 overflow-x-auto">
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(t.key)}
            className={`relative flex h-[52px] shrink-0 items-center gap-1.5 whitespace-nowrap text-[14px] transition-colors ${
              active ? 'font-medium text-ink' : 'text-ink-3 hover:text-ink-2'
            } ${onChange ? '' : 'cursor-default'}`}
          >
            {t.label}
            {t.count !== undefined && <span className="text-[12px] font-normal text-ink-3">{t.count}</span>}
            {active && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-ink" />}
          </button>
        );
      })}
    </div>
  );
}

/** Top row of every page: tabs (or a single title tab) on the left, actions on the right. */
export function PageTop({
  title,
  tabs,
  value,
  onChange,
  actions,
  leading,
}: {
  title?: ReactNode;
  tabs?: TabItem[];
  value?: string;
  onChange?: (key: string) => void;
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  const items = tabs ?? [{ key: 'title', label: title }];
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-x-4 border-b border-line px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <Tabs items={items} value={tabs ? value ?? '' : 'title'} onChange={tabs ? onChange : undefined} />
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 py-2.5">{actions}</div>}
    </div>
  );
}
