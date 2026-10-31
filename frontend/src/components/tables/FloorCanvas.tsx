import { DoorOpen, Flower2 } from 'lucide-react';
import { CSSProperties, PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';
import type { DecorBlock, DecorKind, DiningTable } from '../../types';

export const GRID = 10;

export const DECOR_LOOK: Record<DecorKind, { name: string; className: string; defaultLabel: string | null }> = {
  zone: { name: 'Area', className: 'border-2 border-dashed border-ink-4/70 bg-transparent', defaultLabel: 'Outdoor seating' },
  wall: { name: 'Wall', className: 'bg-ink-2', defaultLabel: null },
  window: { name: 'Window', className: 'border border-info-line bg-info-bg-2', defaultLabel: null },
  door: { name: 'Entrance', className: 'border-2 border-warn-line bg-warn-bg', defaultLabel: 'Entrance' },
  counter: { name: 'Counter', className: 'border border-[#c9a66b] bg-[#ead7b0] dark:bg-[#6b5634] dark:border-[#8a6f45]', defaultLabel: 'Counter' },
  kitchen: { name: 'Kitchen', className: 'border border-line-strong bg-[repeating-linear-gradient(45deg,rgb(var(--c-wash-2)),rgb(var(--c-wash-2))_8px,rgb(var(--c-hover))_8px,rgb(var(--c-hover))_16px)]', defaultLabel: 'Kitchen' },
  plant: { name: 'Plant', className: 'rounded-full border border-success-line bg-success-bg-2', defaultLabel: null },
  text: { name: 'Text', className: 'bg-transparent', defaultLabel: 'Label' },
};

/** Draw order: areas at the back, then walls and fixtures, then tables on top. */
const LAYER: Record<DecorKind, number> = { zone: 0, wall: 1, window: 1, door: 1, counter: 1, kitchen: 1, plant: 2, text: 3 };

const CHAIR = 14;
const GAP = 5;

/** Chair positions around a table (relative to its top-left), spread evenly over its sides. */
export function chairs(t: Pick<DiningTable, 'shape' | 'w' | 'h' | 'seats'>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = t.seats;
  if (t.shape === 'round') {
    const r = Math.min(t.w, t.h) / 2 + GAP + CHAIR / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: t.w / 2 + r * Math.cos(a) - CHAIR / 2, y: t.h / 2 + r * Math.sin(a) - CHAIR / 2 });
    }
    return out;
  }
  // Long tables seat people along the long sides; squares use all four.
  const wide = t.w >= t.h;
  const sides: ('top' | 'bottom' | 'left' | 'right')[] =
    t.shape === 'rect' && n > 2 ? (wide ? ['top', 'bottom'] : ['left', 'right']) : n <= 2 ? (wide ? ['left', 'right'] : ['top', 'bottom']) : ['top', 'bottom', 'left', 'right'];
  const per: Record<string, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let i = 0; i < n; i++) per[sides[i % sides.length]] += 1;
  const along = (count: number, length: number) => Array.from({ length: count }, (_, i) => ((i + 1) * length) / (count + 1) - CHAIR / 2);
  along(per.top, t.w).forEach((x) => out.push({ x, y: -GAP - CHAIR }));
  along(per.bottom, t.w).forEach((x) => out.push({ x, y: t.h + GAP }));
  along(per.left, t.h).forEach((y) => out.push({ x: -GAP - CHAIR, y }));
  along(per.right, t.h).forEach((y) => out.push({ x: t.w + GAP, y }));
  return out;
}

export type ItemKey = `t${number}` | `d${string}`;

/** Fits the plan to its container's width and reports the scale (screen px per plan unit). */
function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1.25, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, scale };
}

/**
 * Draws a floor plan: areas, walls and fixtures, then tables with their chairs. Used read-only (live
 * view, QR sheet) and by the editor, which passes pointer handlers and the selected item.
 */
export default function FloorCanvas({
  width,
  height,
  decor,
  tables,
  grid,
  selected,
  onItemPointerDown,
  onBackgroundPointerDown,
  tableTone,
  tableBadge,
  onTableClick,
  overlay,
  canvasRef,
}: {
  width: number;
  height: number;
  decor: DecorBlock[];
  tables: DiningTable[];
  grid?: boolean;
  selected?: ItemKey | null;
  onItemPointerDown?: (key: ItemKey, e: PointerEvent<HTMLDivElement>, scale: number) => void;
  onBackgroundPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  /** Tailwind classes for a table's top (status colours in the live view). */
  tableTone?: (t: DiningTable, i: number) => string;
  tableBadge?: (t: DiningTable, i: number) => ReactNode;
  onTableClick?: (t: DiningTable, i: number) => void;
  /** Extra layer in plan coordinates (e.g. resize handles). Gets the scale. */
  overlay?: (scale: number) => ReactNode;
  canvasRef?: (el: HTMLDivElement | null, scale: number) => void;
}) {
  const { ref, scale } = useFit(width);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => canvasRef?.(inner.current, scale), [canvasRef, scale]);

  const box = (it: { x: number; y: number; w: number; h: number }): CSSProperties => ({
    position: 'absolute',
    left: it.x * scale,
    top: it.y * scale,
    width: it.w * scale,
    height: it.h * scale,
  });
  const font = (px: number) => Math.max(9, px * scale);
  const ordered = [...decor].sort((a, b) => LAYER[a.kind] - LAYER[b.kind]);

  return (
    <div ref={ref} className="w-full">
      <div
        ref={inner}
        onPointerDown={onBackgroundPointerDown}
        className="relative mx-auto touch-none select-none overflow-hidden rounded-xl border border-line bg-surface"
        style={{
          width: width * scale,
          height: height * scale,
          backgroundImage: grid
            ? `radial-gradient(circle, rgb(var(--c-ink-4) / 0.55) 1px, transparent 1px)`
            : undefined,
          backgroundSize: grid ? `${GRID * 2 * scale}px ${GRID * 2 * scale}px` : undefined,
        }}
      >
        {ordered.map((d) => {
          const key: ItemKey = `d${d.id}`;
          const look = DECOR_LOOK[d.kind];
          return (
            <div
              key={d.id}
              style={box(d)}
              onPointerDown={onItemPointerDown && ((e) => onItemPointerDown(key, e, scale))}
              className={`flex items-center justify-center overflow-hidden rounded-[4px] text-center ${look.className} ${onItemPointerDown ? 'cursor-move' : ''} ${
                selected === key ? 'outline outline-2 outline-offset-2 outline-ink' : ''
              }`}
            >
              {d.kind === 'plant' && <Flower2 className="text-success" style={{ width: Math.min(d.w, d.h) * scale * 0.55, height: Math.min(d.w, d.h) * scale * 0.55 }} />}
              {d.kind === 'door' && d.w * scale > 40 && d.h * scale > 18 && <DoorOpen className="mr-1 shrink-0 text-warn-text" size={font(14)} />}
              {d.label && d.kind !== 'plant' && d.kind !== 'wall' && (
                <span
                  className={`truncate px-1 leading-tight ${d.kind === 'zone' ? 'absolute left-1.5 top-1 text-ink-3' : d.kind === 'door' ? 'text-warn-text' : 'text-ink-2'} ${d.kind === 'text' ? 'font-medium text-ink' : ''}`}
                  style={{ fontSize: font(d.kind === 'text' ? 15 : 12) }}
                >
                  {d.label}
                </span>
              )}
            </div>
          );
        })}

        {tables.map((t, i) => {
          const key: ItemKey = `t${i}`;
          const tone = tableTone?.(t, i) ?? 'border-line-strong bg-wash-2 text-ink';
          return (
            <div
              key={t.id ?? `new-${i}`}
              style={box(t)}
              onPointerDown={onItemPointerDown && ((e) => onItemPointerDown(key, e, scale))}
              onClick={onTableClick && (() => onTableClick(t, i))}
              className={`${onItemPointerDown ? 'cursor-move' : onTableClick ? 'cursor-pointer' : ''} group`}
            >
              {chairs(t).map((c, ci) => (
                <span
                  key={ci}
                  className="absolute rounded-[4px] border border-line-strong bg-surface"
                  style={{ left: c.x * scale, top: c.y * scale, width: CHAIR * scale, height: CHAIR * scale }}
                />
              ))}
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center border-2 shadow-soft transition-colors ${t.shape === 'round' ? 'rounded-full' : 'rounded-[10px]'} ${tone} ${
                  selected === key ? 'outline outline-2 outline-offset-[3px] outline-ink' : ''
                } ${onTableClick ? 'group-hover:brightness-[0.97]' : ''}`}
              >
                <span className="font-semibold leading-none" style={{ fontSize: font(Math.min(18, t.w / 3.4)) }}>
                  {t.label}
                </span>
                {t.w * scale >= 56 && t.h * scale >= 44 && (
                  <span className="mt-0.5 leading-none opacity-60" style={{ fontSize: font(10) }}>
                    {t.seats} seats
                  </span>
                )}
                {tableBadge?.(t, i)}
              </div>
            </div>
          );
        })}
        {overlay?.(scale)}
      </div>
    </div>
  );
}
