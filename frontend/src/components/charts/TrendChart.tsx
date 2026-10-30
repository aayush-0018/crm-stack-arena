import { KeyboardEvent, PointerEvent, useMemo, useState } from 'react';
import { useWidth } from './useWidth';

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

const HEIGHT = 240;
const M = { top: 16, right: 16, bottom: 28, left: 52 };

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Clean axis maximum + step: 1/2/2.5/5 × 10^n. */
function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { max: step * Math.ceil(max / step), step };
}

/**
 * Single-series line + area wash with a crosshair tooltip.
 * One axis only; switch measures with a control rather than adding a second scale.
 */
export default function TrendChart({
  data,
  formatAxis,
  formatValue,
  label,
}: {
  data: TrendPoint[];
  formatAxis: (v: number) => string;
  formatValue: (v: number) => string;
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    const innerW = Math.max(0, width - M.left - M.right);
    const innerH = HEIGHT - M.top - M.bottom;
    const { max, step } = niceScale(Math.max(0, ...data.map((d) => d.value)));
    const n = data.length;
    const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
    const y = (v: number) => M.top + innerH - (v / max) * innerH;
    const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
    const baseline = M.top + innerH;
    const area = n ? `${line}L${x(n - 1).toFixed(1)},${baseline}L${x(0).toFixed(1)},${baseline}Z` : '';
    const yTicks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    const xTickCount = Math.min(n, Math.max(2, Math.floor(innerW / 90)));
    const xTicks = Array.from(new Set(Array.from({ length: xTickCount }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, xTickCount - 1)))));
    return { innerW, innerH, x, y, line, area, baseline, yTicks, xTicks };
  }, [data, width]);

  const indexAt = (clientX: number, rect: DOMRect) => {
    const n = data.length;
    if (!n || geo.innerW <= 0) return null;
    const rel = (clientX - rect.left - M.left) / geo.innerW;
    return Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1))));
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => setActive(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' ? 1 : -1;
    setActive((a) => Math.min(data.length - 1, Math.max(0, (a ?? data.length - 1) + (a === null ? 0 : d))));
  };

  const point = active !== null ? data[active] : null;
  const tipLeft = active !== null ? geo.x(active) : 0;
  const tipOnLeft = tipLeft > width * 0.6;

  return (
    <div ref={ref} className="relative w-full select-none">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${label} chart. Use left and right arrow keys to read values.`}
          tabIndex={0}
          className="block touch-pan-y focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(data.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {/* gridlines + y ticks */}
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
          {/* x ticks */}
          {geo.xTicks.map((i, k) => (
            <text
              key={i}
              x={geo.x(i)}
              y={HEIGHT - 8}
              textAnchor={k === 0 ? 'start' : k === geo.xTicks.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--chart-muted)"
            >
              {dayFmt.format(asDate(data[i].date))}
            </text>
          ))}

          <path d={geo.area} fill="var(--chart-series-1)" fillOpacity={0.05} />
          <path d={geo.line} fill="none" stroke="var(--chart-series-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

          {point && active !== null && (
            <g pointerEvents="none">
              <line x1={tipLeft} x2={tipLeft} y1={M.top} y2={geo.baseline} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />
              <circle cx={tipLeft} cy={geo.y(point.value)} r={5} fill="var(--chart-series-1)" stroke="rgb(var(--c-surface))" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}

      {point && active !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-pop"
          style={tipOnLeft ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }}
          role="status"
        >
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: 'var(--chart-series-1)' }} />
            <span className="text-[14px] font-medium tabular-nums text-ink">{formatValue(point.value)}</span>
          </div>
          <div className="mt-0.5 text-ink-3">{longFmt.format(asDate(point.date))}</div>
        </div>
      )}
    </div>
  );
}
