import { useMemo, useState } from 'react';
import { useWidth } from './useWidth';

export interface PeriodBar {
  key: string;
  label: string;
  value: number;
  /** The same period a year earlier. */
  compare: number;
  partial?: boolean;
}

const HEIGHT = 240;
const M = { top: 16, right: 8, bottom: 28, left: 52 };

function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { max: step * Math.ceil(max / step), step };
}

/**
 * Paired bars per period: this year (ink) beside the same period a year earlier (muted).
 * Hover or arrow keys show both values; the table under the chart prints every number.
 */
export default function PeriodBars({
  data,
  formatAxis,
  formatValue,
  label,
  compareLabel = 'A year earlier',
}: {
  data: PeriodBar[];
  formatAxis: (v: number) => string;
  formatValue: (v: number) => string;
  label: string;
  compareLabel?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    const innerW = Math.max(0, width - M.left - M.right);
    const innerH = HEIGHT - M.top - M.bottom;
    const { max, step } = niceScale(Math.max(0, ...data.flatMap((d) => [d.value, d.compare])));
    const band = data.length ? innerW / data.length : 0;
    const bar = Math.max(2, Math.min(22, band * 0.32));
    const y = (v: number) => M.top + innerH - (Math.max(0, v) / max) * innerH;
    const yTicks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    // Thin out x labels when the bands get narrow.
    const every = Math.max(1, Math.ceil(60 / Math.max(1, band)));
    return { innerW, innerH, band, bar, y, yTicks, every, base: M.top + innerH };
  }, [data, width]);

  const point = active !== null ? data[active] : null;
  const tipX = active !== null ? M.left + geo.band * (active + 0.5) : 0;

  return (
    <div ref={ref} className="relative w-full select-none">
      <div className="mb-2 flex gap-4 text-[12px] text-ink-3" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--chart-series-1)' }} /> This period
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--chart-muted)', opacity: 0.45 }} /> {compareLabel}
        </span>
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${label} chart. Use left and right arrow keys to read values.`}
          tabIndex={0}
          className="block touch-pan-y focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - rect.left - M.left) / Math.max(1, geo.band));
            setActive(i >= 0 && i < data.length ? i : null);
          }}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(data.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const d = e.key === 'ArrowRight' ? 1 : -1;
            setActive((a) => Math.min(data.length - 1, Math.max(0, (a ?? data.length - 1) + d)));
          }}
        >
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line
                x1={M.left}
                x2={M.left + geo.innerW}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tabular-nums">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = M.left + geo.band * (i + 0.5);
            return (
              <g key={d.key} opacity={active === null || active === i ? 1 : 0.55}>
                <rect
                  x={cx - geo.bar - 1}
                  y={geo.y(d.compare)}
                  width={geo.bar}
                  height={Math.max(0, geo.base - geo.y(d.compare))}
                  rx={2}
                  fill="var(--chart-muted)"
                  fillOpacity={0.45}
                />
                <rect
                  x={cx + 1}
                  y={geo.y(d.value)}
                  width={geo.bar}
                  height={Math.max(0, geo.base - geo.y(d.value))}
                  rx={2}
                  fill="var(--chart-series-1)"
                  fillOpacity={d.partial ? 0.5 : 1}
                />
                {i % geo.every === (data.length - 1) % geo.every && (
                  <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {point && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-pop"
          style={tipX > width * 0.6 ? { right: width - tipX + 12 } : { left: tipX + 12 }}
        >
          <p className="font-medium text-ink">
            {point.label}
            {point.partial && <span className="font-normal text-ink-3"> (so far)</span>}
          </p>
          <p className="mt-1 tabular-nums text-ink">{formatValue(point.value)}</p>
          <p className="tabular-nums text-ink-3">
            {compareLabel}: {formatValue(point.compare)}
          </p>
        </div>
      )}
    </div>
  );
}
