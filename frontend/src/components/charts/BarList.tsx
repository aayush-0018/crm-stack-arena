import { ReactNode } from 'react';

export interface BarRow {
  key: string | number;
  label: ReactNode;
  value: number;
  valueLabel: string;
  detail?: string;
}

/**
 * Ranked horizontal bars: label, bar from a shared baseline, value at the tip.
 * Every value is printed, so nothing depends on hover.
 */
export default function BarList({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={ariaLabel} className="space-y-4">
      {rows.map((r) => (
        <li key={r.key} className="group">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            {r.detail && <span className="shrink-0 text-[12px] text-ink-3">{r.detail}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 min-w-0 flex-1">
              <div
                className="h-full rounded-r-[3px] transition-opacity group-hover:opacity-70"
                style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: 'var(--chart-series-1)' }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-[13.5px] tabular-nums text-ink">{r.valueLabel}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
