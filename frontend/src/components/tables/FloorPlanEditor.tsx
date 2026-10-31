import { Copy, Lock, RotateCw, Trash2, Unlock, Wand2 } from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { floorPlanApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import type { DecorBlock, DecorKind, DiningTable, FloorPlan, Rotation, TableShape } from '../../types';
import Button from '../ui/Button';
import { controlClass } from '../ui/Field';
import { Alert } from '../ui/States';
import FloorCanvas, { chairs, DECOR_LOOK, GRID, ItemKey } from './FloorCanvas';

interface Draft {
  width: number;
  height: number;
  tables: DiningTable[];
  decor: DecorBlock[];
}

type Preset =
  | { type: 'table'; name: string; shape: TableShape; seats: number; w: number; h: number }
  | { type: 'decor'; kind: DecorKind; w: number; h: number };

const TABLE_PRESETS: Preset[] = [
  { type: 'table', name: '2 seats', shape: 'square', seats: 2, w: 60, h: 60 },
  { type: 'table', name: '4 seats', shape: 'square', seats: 4, w: 80, h: 80 },
  { type: 'table', name: 'Round 2', shape: 'round', seats: 2, w: 60, h: 60 },
  { type: 'table', name: 'Round 4', shape: 'round', seats: 4, w: 80, h: 80 },
  { type: 'table', name: '6 seats', shape: 'rect', seats: 6, w: 140, h: 70 },
  { type: 'table', name: '8 seats', shape: 'rect', seats: 8, w: 190, h: 80 },
];
const DECOR_PRESETS: Preset[] = [
  { type: 'decor', kind: 'wall', w: 200, h: 10 },
  { type: 'decor', kind: 'counter', w: 200, h: 50 },
  { type: 'decor', kind: 'kitchen', w: 260, h: 180 },
  { type: 'decor', kind: 'door', w: 100, h: 20 },
  { type: 'decor', kind: 'window', w: 140, h: 8 },
  { type: 'decor', kind: 'plant', w: 30, h: 30 },
  { type: 'decor', kind: 'zone', w: 320, h: 220 },
  { type: 'decor', kind: 'text', w: 140, h: 30 },
];

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const rotate = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** The footprint including chairs, so two tables' chairs don't collide either. */
const footprint = (t: DiningTable): Rect => {
  const pad = chairs(t).length ? 20 : 0;
  return { x: t.x - pad, y: t.y - pad, w: t.w + pad * 2, h: t.h + pad * 2 };
};

function nextLabel(tables: DiningTable[]) {
  const nums = tables.map((t) => Number(/^T(\d+)$/i.exec(t.label)?.[1] ?? 0));
  return `T${Math.max(0, ...nums) + 1}`;
}

/** First free spot (scanning rows) where a w×h item with chairs fits; falls back to the top-left. */
function freeSpot(d: Draft, w: number, h: number) {
  const taken = [...d.tables.map(footprint), ...d.decor.filter((x) => x.kind !== 'zone' && x.kind !== 'text')];
  for (let y = 30; y + h + 30 <= d.height; y += GRID * 2) {
    for (let x = 30; x + w + 30 <= d.width; x += GRID * 2) {
      const r = { x: x - 20, y: y - 20, w: w + 40, h: h + 40 };
      if (!taken.some((t) => overlaps(r, t))) return { x, y };
    }
  }
  return { x: 20, y: 20 };
}

/** A ready-made café: N four-seat tables in rows, with a kitchen, counter, entrance and plants. */
function quickLayout(count: number): Draft {
  const cols = 6;
  const rows = Math.ceil(count / cols);
  const height = Math.max(800, 60 + rows * 140 + 160);
  const tables: DiningTable[] = Array.from({ length: count }, (_, i) => ({
    label: `T${i + 1}`,
    seats: 4,
    shape: i % 5 === 4 ? 'round' : 'square',
    x: 60 + (i % cols) * 135,
    y: 60 + Math.floor(i / cols) * 140,
    w: 80,
    h: 80,
    rotation: 0,
  }));
  const decor: DecorBlock[] = [
    { id: uid(), kind: 'kitchen', x: 900, y: 20, w: 280, h: 200, rotation: 0, label: 'Kitchen' },
    { id: uid(), kind: 'counter', x: 900, y: 250, w: 280, h: 60, rotation: 0, label: 'Counter' },
    { id: uid(), kind: 'wall', x: 880, y: 20, w: 10, h: 300, rotation: 0, label: null },
    { id: uid(), kind: 'door', x: 520, y: height - 24, w: 120, h: 24, rotation: 0, label: 'Entrance' },
    { id: uid(), kind: 'plant', x: 20, y: height - 50, w: 30, h: 30, rotation: 0, label: null },
    { id: uid(), kind: 'plant', x: 1150, y: height - 50, w: 30, h: 30, rotation: 0, label: null },
  ];
  return { width: 1200, height, tables, decor };
}

const fromPlan = (p: FloorPlan): Draft => ({ width: p.width, height: p.height, tables: p.tables.map((t) => ({ ...t })), decor: p.decor.map((d) => ({ ...d })) });

/** Drawing and arranging the café. Owners only; saved as a whole, then locked. */
export default function FloorPlanEditor({ plan, onSaved }: { plan: FloorPlan; onSaved: (p: FloorPlan) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => fromPlan(plan));
  const [saved, setSaved] = useState(() => JSON.stringify(fromPlan(plan)));
  const [selected, setSelected] = useState<ItemKey | null>(null);
  const [busy, setBusy] = useState<'save' | 'lock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickCount, setQuickCount] = useState('20');
  const [ghost, setGhost] = useState<{ x: number; y: number; preset: Preset } | null>(null);
  const canvas = useRef<{ el: HTMLDivElement | null; scale: number }>({ el: null, scale: 1 });
  const dirty = JSON.stringify(draft) !== saved;
  const locked = plan.locked;

  useEffect(() => {
    setDraft(fromPlan(plan));
    setSaved(JSON.stringify(fromPlan(plan)));
  }, [plan]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sel = useMemo(() => {
    if (!selected) return null;
    if (selected[0] === 't') {
      const i = Number(selected.slice(1));
      return draft.tables[i] ? ({ kind: 'table', index: i, item: draft.tables[i] } as const) : null;
    }
    const id = selected.slice(1);
    const i = draft.decor.findIndex((d) => d.id === id);
    return i >= 0 ? ({ kind: 'decor', index: i, item: draft.decor[i] } as const) : null;
  }, [selected, draft]);

  const clashing = useMemo(() => {
    const bad = new Set<number>();
    draft.tables.forEach((a, i) =>
      draft.tables.forEach((b, j) => {
        if (i < j && overlaps(a, b)) {
          bad.add(i);
          bad.add(j);
        }
      }),
    );
    return bad;
  }, [draft.tables]);

  const update = useCallback((key: ItemKey, patch: Partial<DiningTable> | Partial<DecorBlock>) => {
    setDraft((d) => {
      if (key[0] === 't') {
        const i = Number(key.slice(1));
        return { ...d, tables: d.tables.map((t, j) => (j === i ? ({ ...t, ...patch } as DiningTable) : t)) };
      }
      const id = key.slice(1);
      return { ...d, decor: d.decor.map((x) => (x.id === id ? ({ ...x, ...patch } as DecorBlock) : x)) };
    });
  }, []);

  const add = (preset: Preset, at?: { x: number; y: number }) => {
    setDraft((d) => {
      const pos = at
        ? { x: clamp(snap(at.x - preset.w / 2), 0, d.width - preset.w), y: clamp(snap(at.y - preset.h / 2), 0, d.height - preset.h) }
        : freeSpot(d, preset.w, preset.h);
      if (preset.type === 'table') {
        const t: DiningTable = { label: nextLabel(d.tables), seats: preset.seats, shape: preset.shape, w: preset.w, h: preset.h, rotation: 0, ...pos };
        setSelected(`t${d.tables.length}`);
        return { ...d, tables: [...d.tables, t] };
      }
      const block: DecorBlock = { id: uid(), kind: preset.kind, w: preset.w, h: preset.h, rotation: 0, label: DECOR_LOOK[preset.kind].defaultLabel, ...pos };
      setSelected(`d${block.id}`);
      return { ...d, decor: [...d.decor, block] };
    });
  };

  const remove = () => {
    if (!sel) return;
    setDraft((d) => (sel.kind === 'table' ? { ...d, tables: d.tables.filter((_, i) => i !== sel.index) } : { ...d, decor: d.decor.filter((_, i) => i !== sel.index) }));
    setSelected(null);
  };

  const duplicate = () => {
    if (!sel) return;
    const { x, y, w, h } = sel.item;
    const at = { x: clamp(x + 30, 0, draft.width - w) + w / 2, y: clamp(y + 30, 0, draft.height - h) + h / 2 };
    if (sel.kind === 'table') add({ type: 'table', name: '', shape: sel.item.shape, seats: sel.item.seats, w, h }, at);
    else {
      const block = { ...sel.item, id: uid(), x: at.x - w / 2, y: at.y - h / 2 };
      setDraft((d) => ({ ...d, decor: [...d.decor, block] }));
      setSelected(`d${block.id}`);
    }
  };

  const turn = () => {
    if (!sel || !selected) return;
    const { x, y, w, h, rotation } = sel.item;
    // Turning swaps width and height around the item's centre.
    const nx = clamp(snap(x + w / 2 - h / 2), 0, draft.width - h);
    const ny = clamp(snap(y + h / 2 - w / 2), 0, draft.height - w);
    update(selected, { w: h, h: w, x: nx, y: ny, rotation: rotate(rotation) });
  };

  // Keyboard: Delete removes, arrows nudge, Ctrl/Cmd+D duplicates.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (!sel || !selected || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const step = e.shiftKey ? GRID * 5 : GRID;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (move) {
        e.preventDefault();
        update(selected, { x: clamp(sel.item.x + move[0], 0, draft.width - sel.item.w), y: clamp(sel.item.y + move[1], 0, draft.height - sel.item.h) });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Moving (or resizing, from the handle) an item with mouse, pen or finger. */
  const startDrag = (key: ItemKey, e: ReactPointerEvent, scale: number, mode: 'move' | 'resize') => {
    if (locked) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(key);
    const item = key[0] === 't' ? draft.tables[Number(key.slice(1))] : draft.decor.find((d) => d.id === key.slice(1));
    if (!item) return;
    const start = { px: e.clientX, py: e.clientY, ...item };
    const round = key[0] === 't' && (item as DiningTable).shape === 'round';
    const min = key[0] === 't' ? 40 : 10;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / scale;
      const dy = (ev.clientY - start.py) / scale;
      if (mode === 'move') {
        update(key, { x: clamp(snap(start.x + dx), 0, draft.width - start.w), y: clamp(snap(start.y + dy), 0, draft.height - start.h) });
      } else {
        let w = clamp(snap(start.w + dx), min, Math.min(1000, draft.width - start.x));
        let h = clamp(snap(start.h + dy), min, Math.min(1000, draft.height - start.y));
        if (round) w = h = Math.min(w, h);
        update(key, { w, h });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Palette: click to add in a free spot, or drag onto the floor to place it exactly. */
  const startPalette = (preset: Preset, e: ReactPointerEvent) => {
    if (locked) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) dragging = true;
      if (dragging) setGhost({ x: ev.clientX, y: ev.clientY, preset });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGhost(null);
      if (!dragging) return add(preset);
      const { el, scale } = canvas.current;
      const r = el?.getBoundingClientRect();
      if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
        add(preset, { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const save = async (): Promise<FloorPlan | null> => {
    setBusy('save');
    setError(null);
    try {
      const p = await floorPlanApi.save({
        width: draft.width,
        height: draft.height,
        decor: draft.decor,
        tables: draft.tables.map(({ qrToken: _q, ...t }) => t),
      });
      onSaved(p);
      toast('success', 'Floor plan saved');
      return p;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const toggleLock = async () => {
    if (!locked && dirty && !(await save())) return;
    setBusy('lock');
    try {
      onSaved(await floorPlanApi.setLocked(!locked));
      setSelected(null);
      toast('success', locked ? 'Unlocked: you can edit the floor plan' : 'Floor plan locked');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the lock.');
    } finally {
      setBusy(null);
    }
  };

  const seats = draft.tables.reduce((s, t) => s + t.seats, 0);
  const paletteBtn = 'flex h-[58px] flex-col items-center justify-center gap-1 rounded-lg border border-line bg-surface text-[11.5px] text-ink-2 hover:border-ink-4 hover:text-ink touch-none';

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13.5px] text-ink-2">
          {draft.tables.length} tables · {seats} seats
          {clashing.size > 0 && <span className="ml-2 text-danger-text">· {clashing.size} tables overlap</span>}
          {dirty && <span className="ml-2 text-warn-text">· Unsaved changes</span>}
        </p>
        {!locked && dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(JSON.parse(saved))}>
            Discard
          </Button>
        )}
        {!locked && (
          <Button size="sm" variant="secondary" onClick={save} loading={busy === 'save'} disabled={!dirty}>
            Save
          </Button>
        )}
        <Button size="sm" variant={locked ? 'secondary' : 'primary'} onClick={toggleLock} loading={busy === 'lock'}>
          {locked ? <Unlock size={14} /> : <Lock size={14} />} {locked ? 'Unlock to edit' : dirty ? 'Save and lock' : 'Lock layout'}
        </Button>
      </div>

      {locked && (
        <Alert tone="info">The layout is locked, so nothing can be moved by accident. Tables keep their QR codes. Unlock it to make changes.</Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[176px_minmax(0,1fr)_220px]">
        {/* Palette */}
        {!locked && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Tables</p>
              <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-2">
                {TABLE_PRESETS.map((p) => p.type === 'table' && (
                  <button key={p.name} type="button" className={paletteBtn} onPointerDown={(e) => startPalette(p, e)} title={`Add a ${p.name} table (click, or drag onto the floor)`}>
                    <span className={`border-2 border-ink-3 ${p.shape === 'round' ? 'rounded-full' : 'rounded-[4px]'}`} style={{ width: p.w / 5, height: p.h / 5 }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Layout</p>
              <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-2">
                {DECOR_PRESETS.map((p) => p.type === 'decor' && (
                  <button key={p.kind} type="button" className={paletteBtn} onPointerDown={(e) => startPalette(p, e)} title={`Add ${DECOR_LOOK[p.kind].name.toLowerCase()}`}>
                    <span className={`${DECOR_LOOK[p.kind].className} ${p.kind === 'text' ? 'text-[10px] font-semibold text-ink' : ''}`} style={{ width: Math.max(10, Math.min(36, p.w / 6)), height: Math.max(4, Math.min(22, p.h / 6)) }}>
                      {p.kind === 'text' ? 'Aa' : null}
                    </span>
                    {DECOR_LOOK[p.kind].name}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[12px] leading-snug text-ink-3">Click to add, or drag onto the floor. Drag to move; drag the corner dot to resize. Arrow keys nudge, Delete removes.</p>
          </div>
        )}

        {/* Floor */}
        <div className={locked ? 'lg:col-span-3' : ''}>
          {draft.tables.length === 0 && draft.decor.length === 0 && !locked ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-wash p-6 text-center">
              <Wand2 className="text-ink-3" size={22} />
              <p className="mt-3 text-[15px] text-ink">Draw your café</p>
              <p className="mt-1 max-w-sm text-[13px] text-ink-3">Add tables and walls from the left, or start from a ready layout and move things to match your place.</p>
              <div className="mt-4 flex items-center gap-2">
                <input
                  aria-label="Number of tables"
                  inputMode="numeric"
                  value={quickCount}
                  onChange={(e) => setQuickCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  className={controlClass(false, 'h-9 w-16 text-center')}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const n = clamp(Number(quickCount) || 0, 1, 60);
                    setDraft(quickLayout(n));
                    setSelected(null);
                  }}
                >
                  Start with {clamp(Number(quickCount) || 0, 1, 60)} tables
                </Button>
              </div>
            </div>
          ) : (
            <FloorCanvas
              width={draft.width}
              height={draft.height}
              decor={draft.decor}
              tables={draft.tables}
              grid={!locked}
              selected={locked ? null : selected}
              onItemPointerDown={locked ? undefined : (key, e, scale) => startDrag(key, e, scale, 'move')}
              onBackgroundPointerDown={() => setSelected(null)}
              tableTone={(_, i) => (clashing.has(i) ? 'border-danger-line-2 bg-danger-bg text-danger-text' : 'border-line-strong bg-wash-2 text-ink')}
              canvasRef={(el, scale) => {
                canvas.current = { el, scale };
              }}
              overlay={(scale) =>
                !locked && sel ? (
                  <span
                    role="presentation"
                    onPointerDown={(e) => startDrag(selected!, e, scale, 'resize')}
                    className="absolute z-10 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-surface bg-ink shadow"
                    style={{ left: (sel.item.x + sel.item.w) * scale - 7, top: (sel.item.y + sel.item.h) * scale - 7 }}
                  />
                ) : null
              }
            />
          )}
        </div>

        {/* Inspector */}
        {!locked && (
          <div className="space-y-4 text-[13.5px]">
            {sel ? (
              <div className="space-y-3 rounded-xl border border-line p-3.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{sel.kind === 'table' ? 'Table' : DECOR_LOOK[sel.item.kind].name}</p>
                {sel.kind === 'table' ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[12.5px] text-ink-2">Name</span>
                      <input className={controlClass(false, 'h-9')} maxLength={20} value={sel.item.label} onChange={(e) => update(selected!, { label: e.target.value })} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[12.5px] text-ink-2">Seats</span>
                        <input
                          className={controlClass(false, 'h-9')}
                          inputMode="numeric"
                          value={sel.item.seats}
                          onChange={(e) => update(selected!, { seats: clamp(Number(e.target.value.replace(/\D/g, '')) || 1, 1, 30) })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12.5px] text-ink-2">Shape</span>
                        <select
                          className={controlClass(false, 'h-9')}
                          value={sel.item.shape}
                          onChange={(e) => {
                            const shape = e.target.value as TableShape;
                            const s = Math.min(sel.item.w, sel.item.h);
                            update(selected!, shape === 'rect' ? { shape, w: Math.max(sel.item.w, s * 2) } : { shape, w: s, h: s });
                          }}
                        >
                          <option value="square">Square</option>
                          <option value="round">Round</option>
                          <option value="rect">Long</option>
                        </select>
                      </label>
                    </div>
                  </>
                ) : (
                  sel.item.kind !== 'wall' &&
                  sel.item.kind !== 'plant' &&
                  sel.item.kind !== 'window' && (
                    <label className="block">
                      <span className="mb-1 block text-[12.5px] text-ink-2">Label</span>
                      <input className={controlClass(false, 'h-9')} maxLength={40} value={sel.item.label ?? ''} onChange={(e) => update(selected!, { label: e.target.value || null })} />
                    </label>
                  )
                )}
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={turn} title="Turn 90°">
                    <RotateCw size={14} /> Turn
                  </Button>
                  <Button size="sm" variant="secondary" onClick={duplicate} title="Duplicate (Ctrl/Cmd+D)">
                    <Copy size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={remove} title="Remove (Delete)" className="text-danger-text">
                    <Trash2 size={14} />
                  </Button>
                </div>
                {sel.kind === 'table' && sel.item.id && (
                  <p className="text-[12px] text-ink-3">Removing a table stops its QR code. Its past orders are kept.</p>
                )}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line p-3.5 text-[12.5px] text-ink-3">Select a table or block to rename, resize or remove it.</p>
            )}

            <div className="space-y-2 rounded-xl border border-line p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Floor size</p>
              <div className="grid grid-cols-2 gap-2">
                {(['width', 'height'] as const).map((k) => (
                  <label key={k} className="block">
                    <span className="mb-1 block text-[12.5px] capitalize text-ink-2">{k}</span>
                    <select
                      className={controlClass(false, 'h-9')}
                      value={draft[k]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const items = [...draft.tables, ...draft.decor];
                        const needed = Math.max(0, ...items.map((it) => (k === 'width' ? it.x + it.w : it.y + it.h)));
                        if (v < needed) return toast('error', `Move things ${k === 'width' ? 'left' : 'up'} first: something sits beyond ${v}.`);
                        setDraft({ ...draft, [k]: v });
                      }}
                    >
                      {Array.from({ length: 27 }, (_, i) => 400 + i * 100).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            {(draft.tables.length > 0 || draft.decor.length > 0) && (
              <button
                type="button"
                className="text-[12.5px] text-ink-3 underline-offset-2 hover:text-danger-text hover:underline"
                onClick={() => {
                  if (window.confirm('Clear the whole floor? Tables already saved lose their QR codes once you save.')) {
                    setDraft({ ...draft, tables: [], decor: [] });
                    setSelected(null);
                  }
                }}
              >
                Clear floor
              </button>
            )}
          </div>
        )}
      </div>

      {ghost && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border-2 border-dashed border-ink bg-surface/70"
          style={{
            left: ghost.x - (ghost.preset.w * canvas.current.scale) / 2,
            top: ghost.y - (ghost.preset.h * canvas.current.scale) / 2,
            width: ghost.preset.w * canvas.current.scale,
            height: ghost.preset.h * canvas.current.scale,
            borderRadius: ghost.preset.type === 'table' && ghost.preset.shape === 'round' ? '999px' : undefined,
          }}
        />
      )}
    </div>
  );
}
