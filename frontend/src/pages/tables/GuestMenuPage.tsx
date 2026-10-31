import { Minus, Plus, Receipt, Search, ShoppingBag, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { tableGuestApi } from '../../api/endpoints';
import ShopLogo from '../../components/ui/ShopLogo';
import Spinner from '../../components/ui/Spinner';
import { formatINR } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import type { TableMenu } from '../../types';

type Product = TableMenu['products'][number];

/** Remembered on this phone: the cart (until ordered) and the orders placed at this table today. */
const cartKey = (t: string) => `cw.cart.${t}`;
export const ordersKey = (t: string) => `cw.orders.${t}`;
function read<T>(store: Storage, key: string, fallback: T): T {
  try {
    return JSON.parse(store.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}
function write(store: Storage, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: works for this visit only */
  }
}

const price = (p: Product) => `${formatINR(p.pricePaise).replace(/\.00$/, '')}${p.unit === 'pcs' ? '' : ` / ${p.unit}`}`;

function Stepper({ n, onChange, name }: { n: number; onChange: (n: number) => void; name: string }) {
  if (!n) {
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        className="h-9 rounded-full border border-[#1f1b16] px-4 text-[14px] font-medium text-[#1f1b16] active:scale-95"
        aria-label={`Add ${name}`}
      >
        Add
      </button>
    );
  }
  return (
    <div className="flex h-9 items-center rounded-full bg-[#1f1b16] text-white">
      <button type="button" onClick={() => onChange(n - 1)} className="flex h-9 w-9 items-center justify-center" aria-label={`One less ${name}`}>
        <Minus size={15} />
      </button>
      <span className="min-w-[1.5ch] text-center text-[14px] font-semibold tabular-nums" aria-live="polite">
        {n}
      </span>
      <button type="button" onClick={() => onChange(Math.min(50, n + 1))} className="flex h-9 w-9 items-center justify-center" aria-label={`One more ${name}`}>
        <Plus size={15} />
      </button>
    </div>
  );
}

/** What a guest sees after scanning the table's QR code: the menu, a cart, and "Place order". */
export default function GuestMenuPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<TableMenu | null>(null);
  const [loadError, setLoadError] = useState<'missing' | 'network' | null>(null);
  const [cart, setCart] = useState<Record<number, number>>(() => read(sessionStorage, cartKey(token), {}));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(uuid());
  const placed = read<{ guestToken: string; at: string }[]>(localStorage, ordersKey(token), []).filter(
    (o) => Date.now() - new Date(o.at).getTime() < 12 * 3600_000,
  );

  const load = () =>
    tableGuestApi.menu(token).then(
      (m) => {
        setMenu(m);
        setLoadError(null);
        // Drop cart lines for items no longer on the menu.
        setCart((c) => Object.fromEntries(Object.entries(c).filter(([id]) => m.products.some((p) => p.id === Number(id)))));
      },
      (e) => setLoadError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'missing' : 'network'),
    );
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => write(sessionStorage, cartKey(token), cart), [cart, token]);
  useEffect(() => {
    if (menu) document.title = `${menu.shop.name} · Table ${menu.table.label}`;
  }, [menu]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { name: string; products: Product[] }[] = [];
    for (const p of menu?.products ?? []) {
      if (q && !`${p.name} ${p.category ?? ''}`.toLowerCase().includes(q)) continue;
      const cat = p.category?.trim() || 'More';
      const last = out[out.length - 1];
      if (last && last.name.toLowerCase() === cat.toLowerCase()) last.products.push(p);
      else out.push({ name: cat, products: [p] });
    }
    return out;
  }, [menu, query]);

  const lines = (menu?.products ?? []).filter((p) => cart[p.id]).map((p) => ({ p, n: cart[p.id] }));
  const count = lines.reduce((s, l) => s + l.n, 0);
  const total = lines.reduce((s, l) => s + l.n * l.p.pricePaise, 0);
  const setQty = (id: number, n: number) =>
    setCart((c) => {
      const next = { ...c };
      if (n > 0) next[id] = n;
      else delete next[id];
      return next;
    });

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const { guestToken } = await tableGuestApi.order(token, {
        items: lines.map((l) => ({ productId: l.p.id, quantity: l.n })),
        name: name.trim() || null,
        note: note.trim() || null,
        paid,
        idempotencyKey: attempt,
      });
      write(localStorage, ordersKey(token), [{ guestToken, at: new Date().toISOString() }, ...placed].slice(0, 20));
      setCart({});
      setAttempt(uuid());
      navigate(`/o/${guestToken}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send your order. Check your connection and try again.");
      if (e instanceof ApiError && e.code === 'ITEM_UNAVAILABLE') load();
      if (e instanceof ApiError) setAttempt(uuid()); // the server refused it: a corrected order is a new one
    } finally {
      setBusy(false);
    }
  };

  if (loadError || !menu) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4] px-6 text-center text-[#5e574c]">
        {loadError === 'missing' ? (
          <div>
            <p className="text-[20px] font-medium text-[#1f1b16]">This table code isn't active</p>
            <p className="mt-2 text-[14.5px]">Please ask the staff for help.</p>
          </div>
        ) : loadError ? (
          <div>
            <p className="text-[15px]">Couldn't load the menu.</p>
            <button type="button" onClick={load} className="mt-3 rounded-full border border-[#1f1b16] px-4 py-2 text-[14px] text-[#1f1b16]">
              Try again
            </button>
          </div>
        ) : (
          <Spinner className="h-6 w-6" />
        )}
      </div>
    );
  }

  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] pb-28 text-[#1f1b16]">
      <header className="mx-auto max-w-2xl px-4 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <ShopLogo logoKey={menu.shop.logoKey} name={menu.shop.name} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-semibold leading-tight">{menu.shop.name}</h1>
            <p className="text-[13px] text-[#8a8276]">Order from your table</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#1f1b16] px-3 py-1.5 text-[13px] font-semibold text-white">Table {menu.table.label}</span>
        </div>
        {placed.length > 0 && (
          <Link to={`/o/${placed[0].guestToken}`} className="mt-4 flex items-center gap-2 rounded-xl border border-[#e6dfd2] bg-white px-3.5 py-2.5 text-[14px]">
            <Receipt size={16} className="text-[#8a8276]" />
            <span className="flex-1">Track your order{placed.length > 1 ? `s (${placed.length})` : ''}</span>
            <span className="text-[#8c2f1b]">View</span>
          </Link>
        )}
      </header>

      <div className="sticky top-0 z-10 border-b border-[#ece6da] bg-[#faf8f4]/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-2.5">
          <label className="flex h-10 items-center gap-2 rounded-full border border-[#e6dfd2] bg-white px-3.5 text-[#8a8276]">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the menu" className="min-w-0 flex-1 bg-transparent text-[15px] text-[#1f1b16] outline-none" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </label>
          {!query && sections.length > 1 && (
            <nav className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              {sections.map((s, i) => (
                <a key={s.name} href={`#sec-${i}`} className="shrink-0 rounded-full border border-[#e6dfd2] bg-white px-3 py-1 text-[13px] text-[#5e574c]">
                  {s.name}
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-4">
        {sections.length === 0 && (
          <p className="py-16 text-center text-[15px] text-[#8a8276]">{query ? 'Nothing matches your search.' : 'The menu is empty right now. Please ask the staff.'}</p>
        )}
        {sections.map((s, i) => (
          <section key={s.name} id={`sec-${i}`} className="scroll-mt-28 pt-6">
            <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8c2f1b]">{s.name}</h2>
            <ul className="divide-y divide-[#ece6da]">
              {s.products.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] leading-snug">{p.name}</p>
                    <p className="mt-0.5 text-[14px] font-medium tabular-nums text-[#5e574c]">{price(p)}</p>
                  </div>
                  <Stepper n={cart[p.id] ?? 0} onChange={(n) => setQty(p.id, n)} name={p.name} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {count > 0 && !open && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 rounded-2xl bg-[#1f1b16] px-5 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]"
          >
            <ShoppingBag size={18} />
            <span className="text-[15px]">
              {count} {count === 1 ? 'item' : 'items'}
            </span>
            <span className="ml-auto text-[16px] font-semibold tabular-nums">{formatINR(total)}</span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[13.5px]">View order</span>
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Your order"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-3xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[19px] font-semibold">Your order · Table {menu.table.label}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1.5 text-[#8a8276] hover:bg-[#f3efe7]">
                <X size={18} />
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="py-10 text-center text-[15px] text-[#8a8276]">Your order is empty.</p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-[#f0ebe1]">
                  {lines.map(({ p, n }) => (
                    <li key={p.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px]">{p.name}</p>
                        <p className="text-[13px] tabular-nums text-[#8a8276]">{formatINR(p.pricePaise * n)}</p>
                      </div>
                      <Stepper n={n} onChange={(v) => setQty(p.id, v)} name={p.name} />
                    </li>
                  ))}
                </ul>

                <div className="mt-3 space-y-3">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder="Your name (optional)"
                    className="h-11 w-full rounded-xl border border-[#e6dfd2] px-3.5 text-[15px] outline-none focus:border-[#8a8276]"
                  />
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="Anything for the kitchen? e.g. less spicy, no onion"
                    className="w-full resize-none rounded-xl border border-[#e6dfd2] px-3.5 py-2.5 text-[15px] outline-none focus:border-[#8a8276]"
                  />
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-dashed border-[#d9cfbd] bg-[#fbf7ef] px-3.5 py-3">
                    <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#1f1b16]" />
                    <span className="text-[14px]">
                      I have paid {formatINR(total)}
                      <span className="block text-[12.5px] text-[#8a8276]">Test mode: online payment isn't connected yet. Leave unticked to pay at the counter.</span>
                    </span>
                  </label>
                </div>

                {error && <p className="mt-3 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}

                <button
                  type="button"
                  disabled={busy}
                  onClick={place}
                  className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f1b16] text-[16px] font-semibold text-white disabled:opacity-60"
                >
                  {busy && <Spinner className="h-4 w-4" />}
                  Place order · {formatINR(total)}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
