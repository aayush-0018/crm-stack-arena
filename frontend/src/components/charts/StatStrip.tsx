import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { ReactNode } from 'react';

/** Row of headline numbers at the top of a page. */
export function StatStrip({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={`grid grid-cols-2 gap-x-6 gap-y-7 border-b border-line px-4 py-6 transition-opacity sm:grid-cols-3 sm:px-6 lg:grid-cols-5 lg:gap-x-10 ${
        dim ? 'opacity-50' : ''
      }`}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  suffix,
  trend,
  visual,
}: {
  label: string;
  value: string;
  suffix?: string;
  trend?: 'up' | 'down';
  visual?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 truncate text-[14.5px] text-ink">
        {label}
        {trend === 'up' && <ArrowUpRight size={14} strokeWidth={2} className="text-[#2e7d32]" aria-label="up" />}
        {trend === 'down' && <ArrowDownRight size={14} strokeWidth={2} className="text-[#b42318]" aria-label="down" />}
      </p>
      <p className="mt-3 flex items-start gap-1.5">
        <span className="text-[28px] font-normal leading-none tracking-[-0.02em] text-ink sm:text-[30px]">{value}</span>
        {suffix && <span className="mt-0.5 whitespace-nowrap text-[11.5px] text-ink-3">{suffix}</span>}
      </p>
      <div className="mt-5 h-8">{visual}</div>
    </div>
  );
}

/** Thin ink sparkline with an end dot. Scales to its box without distorting the stroke. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const y = (v: number) => 28 - ((v - min) / span) * 24; // 4px top room, 0..32 box
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const endTop = (y(values[values.length - 1]) / 32) * 100;
  return (
    <div className="relative h-8 w-full max-w-[220px]" role="img" aria-label={label}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <polyline
          points={pts}
          fill="none"
          stroke="var(--chart-series-1)"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="absolute -mr-[3px] -mt-[3px] h-[6px] w-[6px] rounded-full bg-ink" style={{ right: 0, top: `${endTop}%` }} />
    </div>
  );
}

/** Tick gauge: ticks up to the value are ink, the rest light, with a marker above the value. */
export function TickGauge({ value, reference, label }: { value: number; reference?: number; label: string }) {
  const v = Math.min(1, Math.max(0, value));
  const N = 56;
  const refIdx = reference === undefined ? -1 : Math.round(Math.min(1, Math.max(0, reference)) * (N - 1));
  return (
    <div className="relative h-8 w-full max-w-[220px] pt-3" role="img" aria-label={label}>
      <span
        className="absolute top-0 -ml-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-ink"
        style={{ left: `${v * 100}%` }}
      />
      <div className="flex h-2.5 items-start justify-between">
        {Array.from({ length: N }, (_, i) => (
          <span
            key={i}
            className={`w-px ${i === refIdx ? 'h-[15px]' : 'h-2.5'} ${i / (N - 1) <= v ? 'bg-ink' : 'bg-line-strong'}`}
          />
        ))}
      </div>
    </div>
  );
}
