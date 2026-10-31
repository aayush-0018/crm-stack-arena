import { ArrowLeft, Bell, BellOff, ChefHat, Maximize, Minimize, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { kitchenApi } from '../../api/endpoints';
import { KITCHEN_LABEL, minutesSince, NEXT_STATUS, PREV_STATUS, qty, since, usePolling, useNow } from '../../components/tables/dinein';
import Spinner from '../../components/ui/Spinner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { KitchenOrder, KitchenStatus } from '../../types';

const COLUMNS: { status: KitchenStatus; title: string; action: string; accent: string }[] = [
  { status: 'new', title: 'New', action: 'Start preparing', accent: 'bg-amber-400' },
  { status: 'preparing', title: 'Preparing', action: 'Mark ready', accent: 'bg-sky-400' },
  { status: 'ready', title: 'Ready to serve', action: 'Served', accent: 'bg-emerald-400' },
];

const SOUND_KEY = 'crm.kitchenSound';

/** A short two-note chime. Browsers only allow sound after someone has clicked on the page. */
function useChime() {
  const ctx = useRef<AudioContext | null>(null);
  const unlock = () => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx.current && AC) ctx.current = new AC();
    void ctx.current?.resume();
  };
  const play = () => {
    const c = ctx.current;
    if (!c || c.state !== 'running') return;
    [880, 1320].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = c.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  };
  return { unlock, play };
}

function Ticket({
  o,
  now,
  fresh,
  busy,
  onMove,
}: {
  o: KitchenOrder;
  now: number;
  fresh: boolean;
  busy: boolean;
  onMove: (o: KitchenOrder, to: KitchenStatus) => void;
}) {
  const age = minutesSince(o.createdAt, now);
  const late = age >= 20 ? 'border-l-red-500' : age >= 10 ? 'border-l-amber-400' : 'border-l-zinc-600';
  const next = NEXT_STATUS[o.kitchenStatus];
  const prev = PREV_STATUS[o.kitchenStatus];
  const action = COLUMNS.find((c) => c.status === o.kitchenStatus)?.action;
  return (
    <article className={`rounded-xl border border-zinc-800 border-l-[6px] bg-zinc-900 p-4 ${late} ${fresh ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-950 animate-[pulse_1.2s_ease-in-out_3]' : ''}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[26px] font-semibold leading-none text-white">{o.tableLabel ? `Table ${o.tableLabel}` : 'Counter'}</p>
          <p className="mt-1.5 truncate text-[12.5px] text-zinc-400">
            {o.orderNumber}
            {o.guestName ? ` · ${o.guestName}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[15px] font-semibold tabular-nums ${age >= 20 ? 'text-red-400' : age >= 10 ? 'text-amber-300' : 'text-zinc-200'}`}>{since(o.createdAt, now)}</p>
          <p className={`mt-1 text-[11.5px] font-medium ${o.paymentStatus === 'paid' ? 'text-emerald-400' : 'text-zinc-500'}`}>{o.paymentStatus === 'paid' ? 'Paid' : 'Not paid'}</p>
        </div>
      </header>
      <ul className="mt-3 space-y-1.5 border-t border-zinc-800 pt-3">
        {o.items.map((it, i) => (
          <li key={i} className="flex gap-2.5 text-[17px] leading-snug text-zinc-100">
            <span className="min-w-[2.2ch] font-semibold tabular-nums text-white">{qty(it.quantity)}×</span>
            <span>{it.itemName}</span>
          </li>
        ))}
      </ul>
      {o.notes && <p className="mt-3 rounded-lg bg-amber-300/10 px-3 py-2 text-[14px] text-amber-200">“{o.notes}”</p>}
      <div className="mt-4 flex gap-2">
        {prev && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(o, prev)}
            title={`Back to ${KITCHEN_LABEL[prev].toLowerCase()}`}
            aria-label={`Move back to ${KITCHEN_LABEL[prev]}`}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
          >
            <Undo2 size={18} />
          </button>
        )}
        {next && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(o, next)}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-white text-[16px] font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-60"
          >
            {busy && <Spinner className="h-4 w-4" />} {action}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * The screen in the kitchen: every table order in the order it came in. Tap to move it along;
 * new orders chime and glow. Works on a tablet or a TV with a mouse.
 */
export default function KitchenPage() {
  const { shop } = useAuth();
  const toast = useToast();
  const now = useNow(10_000);
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [full, setFull] = useState(false);
  const seen = useRef<Set<number> | null>(null);
  const chime = useChime();

  const load = useCallback(() => {
    kitchenApi
      .list()
      .then((list) => {
        setOffline(false);
        setOrders(list);
        const ids = new Set(list.map((o) => o.id));
        if (seen.current) {
          const added = list.filter((o) => o.kitchenStatus === 'new' && !seen.current!.has(o.id)).map((o) => o.id);
          if (added.length) {
            if (sound) chime.play();
            setFresh((f) => new Set([...f, ...added]));
            setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.includes(id)))), 12_000);
          }
        }
        seen.current = ids;
      })
      .catch(() => setOffline(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound]);
  usePolling(load, 4000);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const move = async (o: KitchenOrder, to: KitchenStatus) => {
    setBusy(o.id);
    // Move it right away; the server's answer replaces the list.
    setOrders((list) => list?.map((x) => (x.id === o.id ? { ...x, kitchenStatus: to, kitchenUpdatedAt: new Date().toISOString() } : x)) ?? null);
    try {
      setOrders(await kitchenApi.setStatus(o.id, to));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not update. Check the connection.');
      load();
    } finally {
      setBusy(null);
    }
  };

  const toggleSound = () => {
    const next = !sound;
    if (next) {
      chime.unlock();
      setTimeout(chime.play, 50);
    }
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      /* per device only */
    }
  };

  // The sound setting survives a reload, but the browser still needs one click to allow audio.
  useEffect(() => {
    if (!sound) return;
    const once = () => chime.unlock();
    window.addEventListener('pointerdown', once, { once: true });
    return () => window.removeEventListener('pointerdown', once);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound]);

  const served = (orders ?? []).filter((o) => o.kitchenStatus === 'served').reverse();
  const headBtn = 'flex h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-[13.5px] text-zinc-300 hover:bg-zinc-900 hover:text-white';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:px-6">
        <Link to="/tables" className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Back to tables">
          <ArrowLeft size={18} />
        </Link>
        <ChefHat size={22} className="text-amber-300" />
        <div className="mr-auto min-w-0">
          <h1 className="text-[18px] font-semibold leading-tight text-white">Kitchen</h1>
          <p className="truncate text-[12.5px] text-zinc-500">{shop?.name}</p>
        </div>
        {offline && <span className="rounded-md bg-red-500/15 px-2.5 py-1 text-[12.5px] text-red-300">Connection lost · retrying</span>}
        <span className="hidden text-[15px] tabular-nums text-zinc-400 sm:block">
          {new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(now)}
        </span>
        <button type="button" onClick={toggleSound} className={headBtn} aria-pressed={sound}>
          {sound ? <Bell size={16} className="text-amber-300" /> : <BellOff size={16} />} <span className="hidden sm:inline">{sound ? 'Sound on' : 'Sound off'}</span>
        </button>
        <button
          type="button"
          className={headBtn}
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()).catch?.(() => undefined)}
          aria-label={full ? 'Exit full screen' : 'Full screen'}
        >
          {full ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </header>

      {!orders ? (
        <div className="flex justify-center py-24 text-zinc-500">{offline ? "Can't reach the server. Retrying…" : <Spinner className="h-6 w-6" />}</div>
      ) : (
        <main className="grid gap-4 p-4 sm:p-6 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = orders.filter((o) => o.kitchenStatus === col.status);
            return (
              <section key={col.status} aria-label={col.title} className="min-w-0">
                <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.accent}`} />
                  {col.title}
                  <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[12px] tabular-nums text-zinc-200">{list.length}</span>
                </h2>
                <div className="space-y-3">
                  {list.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-[14px] text-zinc-600">
                      {col.status === 'new' ? 'No new orders' : col.status === 'preparing' ? 'Nothing cooking' : 'Nothing waiting'}
                    </p>
                  ) : (
                    list.map((o) => <Ticket key={o.id} o={o} now={now} fresh={fresh.has(o.id)} busy={busy === o.id} onMove={move} />)
                  )}
                </div>
              </section>
            );
          })}
          {served.length > 0 && (
            <section className="lg:col-span-3" aria-label="Recently served">
              <h2 className="mb-2 mt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Served in the last 30 minutes</h2>
              <div className="flex flex-wrap gap-2">
                {served.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => move(o, 'ready')}
                    title="Served by mistake? Move it back to Ready"
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-[13px] text-zinc-400 hover:bg-zinc-900 hover:text-white"
                  >
                    {o.tableLabel ? `Table ${o.tableLabel}` : o.orderNumber} · {o.items.length} {o.items.length === 1 ? 'item' : 'items'}
                    <Undo2 size={13} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  );
}
