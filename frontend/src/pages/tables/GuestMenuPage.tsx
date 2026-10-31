import { ChevronDown, Lock, Mail, Minus, Plus, Search, ShoppingBag, Sparkles, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { tableGuestApi } from '../../api/endpoints';
import { KITCHEN_LABEL, qty } from '../../components/tables/dinein';
import ShopLogo from '../../components/ui/ShopLogo';
import Spinner from '../../components/ui/Spinner';
import { formatINR } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import type { GuestOrder, TableMenu } from '../../types';

type Product = TableMenu['products'][number];

/** Remembered on this phone: the guest's session (12 hours), the cart until ordered, and the welcome seen. */
const SESSION_KEY = 'cw.guestSession';
const cartKey = (t: string) => `cw.cart.${t}`;
function read<T>(store: Storage, key: string, fallback: T): T {
  try {
    const v = store.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function write(store: Storage, key: string, value: unknown) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: works for this visit only */
  }
}

const rupees = (paise: number) => formatINR(paise).replace(/\.00$/, '');
const price = (p: Product) => `${rupees(p.pricePaise)}${p.unit === 'pcs' ? '' : ` / ${p.unit}`}`;
/** Same rounding as the server (half-up, in paise). */
const discountFor = (subtotal: number, pct: number) => Math.round((subtotal * pct) / 100);

const input = 'h-12 w-full rounded-xl border border-[#e6dfd2] bg-white px-3.5 text-[16px] text-[#1f1b16] outline-none focus:border-[#8a8276]';
const primary = 'flex h-13 min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#1f1b16] text-[16px] font-semibold text-white disabled:opacity-60';

function Shell({ menu, children }: { menu: TableMenu; children: React.ReactNode }) {
  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] px-4 pb-10 pt-6 text-[#1f1b16]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <ShopLogo logoKey={menu.shop.logoKey} name={menu.shop.name} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-semibold leading-tight">{menu.shop.name}</h1>
            <p className="text-[13px] text-[#8a8276]">{menu.table.floorName ? `${menu.table.floorName} · ` : ''}Table {menu.table.label}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Before the menu: name, mobile and email, then the 6-digit code sent to that email. */
function Gate({ token, menu, onVerified }: { token: string; menu: TableMenu; onVerified: (session: string, discountPct: number) => void }) {
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [form, setForm] = useState(() => read(localStorage, 'cw.guestDetails', { name: '', phone: '', email: '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ challenge: string; sentTo: string; at: number } | null>(null);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const err: Record<string, string> = {};
    if (!form.name.trim()) err.name = 'Please enter your name';
    if (!/^(\+?91|0)?[6-9]\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) err.phone = 'Enter a 10-digit mobile number';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) err.email = 'Enter a valid email';
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    setError(null);
    try {
      const details = { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() };
      write(localStorage, 'cw.guestDetails', details);
      const r = await tableGuestApi.requestCode(token, details);
      setSent({ challenge: r.challenge, sentTo: r.sentTo, at: Date.now() });
      setCode('');
      setStep('code');
    } catch (e2) {
      if (e2 instanceof ApiError) {
        setErrors(e2.fieldErrors);
        setError(Object.keys(e2.fieldErrors).length ? null : e2.message);
      } else setError("Couldn't send the code. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!sent) return;
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email');
    setBusy(true);
    setError(null);
    try {
      const r = await tableGuestApi.verify(token, { challenge: sent.challenge, code });
      onVerified(r.sessionToken, r.discountPct);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : "Couldn't check the code. Check your connection.");
      if (e2 instanceof ApiError && e2.code === 'CODE_EXPIRED') setCode('');
    } finally {
      setBusy(false);
    }
  };

  const wait = sent ? Math.max(0, 30 - Math.floor((now - sent.at) / 1000)) : 0;

  return (
    <Shell menu={menu}>
      {menu.firstOrderDiscountPct > 0 && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-[#1f1b16] px-4 py-3.5 text-white">
          <Sparkles size={20} className="shrink-0 text-[#f6d48a]" />
          <p className="text-[14px] leading-snug">
            First time here? Get <strong>{menu.firstOrderDiscountPct}% off</strong> your first order.
          </p>
        </div>
      )}

      {step === 'details' ? (
        <form onSubmit={send} noValidate className="mt-6 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <h2 className="text-[18px] font-semibold">Welcome! Who's ordering?</h2>
          <p className="mt-1 text-[13.5px] text-[#8a8276]">We'll email you a code to open the menu, and your bill after the meal.</p>
          <div className="mt-4 space-y-3">
            {(
              [
                ['name', 'Your name', 'text', 'name', undefined],
                ['phone', 'Mobile number', 'tel', 'tel', 'numeric'],
                ['email', 'Email', 'email', 'email', 'email'],
              ] as const
            ).map(([k, label, type, auto, mode]) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[13px] font-medium text-[#5e574c]">
                  {label} <span className="text-[#a8321f]">*</span>
                </span>
                <input
                  type={type}
                  autoComplete={auto}
                  inputMode={mode}
                  required
                  maxLength={k === 'name' ? 60 : k === 'phone' ? 16 : 254}
                  value={form[k]}
                  onChange={(e) => {
                    setForm({ ...form, [k]: e.target.value });
                    if (errors[k]) setErrors({ ...errors, [k]: '' });
                  }}
                  aria-invalid={!!errors[k]}
                  className={`${input} ${errors[k] ? 'border-[#e5a59e]' : ''}`}
                  placeholder={k === 'phone' ? '98765 43210' : k === 'email' ? 'you@example.com' : ''}
                />
                {errors[k] && <span className="mt-1 block text-[12.5px] text-[#a8321f]">{errors[k]}</span>}
              </label>
            ))}
          </div>
          {error && <p className="mt-3 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}
          <button type="submit" disabled={busy} className={`${primary} mt-5`}>
            {busy && <Spinner className="h-4 w-4" />} Email me a code
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate className="mt-6 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f3efe7]">
            <Mail size={20} />
          </span>
          <h2 className="mt-3 text-[18px] font-semibold">Check your email</h2>
          <p className="mt-1 text-[14px] text-[#5e574c]">
            We sent a 6-digit code to <strong>{sent?.sentTo}</strong>. It works for 10 minutes.
          </p>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              setError(null);
            }}
            className={`${input} mt-4 text-center text-[26px] font-semibold tracking-[0.5em]`}
            placeholder="••••••"
          />
          {error && <p className="mt-3 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className={`${primary} mt-4`}>
            {busy && <Spinner className="h-4 w-4" />} Open the menu
          </button>
          <div className="mt-4 flex items-center justify-between text-[13.5px]">
            <button type="button" className="text-[#5e574c] underline-offset-2 hover:underline" onClick={() => setStep('details')}>
              Change details
            </button>
            <button type="button" disabled={wait > 0 || busy} onClick={() => send()} className="text-[#8c2f1b] disabled:text-[#b7ad9c]">
              {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
            </button>
          </div>
          <p className="mt-3 text-[12px] text-[#a39a8c]">Can't find it? Check spam or promotions.</p>
        </form>
      )}
    </Shell>
  );
}

function Stepper({ n, onChange, name }: { n: number; onChange: (n: number) => void; name: string }) {
  if (!n) {
    return (
      <button type="button" onClick={() => onChange(1)} className="h-9 rounded-full border border-[#1f1b16] px-4 text-[14px] font-medium text-[#1f1b16] active:scale-95" aria-label={`Add ${name}`}>
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

/** An order already placed: shown for reference only. */
function PlacedOrder({ o }: { o: GuestOrder }) {
  const [open, setOpen] = useState(false);
  const count = o.items.reduce((s, it) => s + Number(it.quantity), 0);
  return (
    <li className="rounded-xl border border-[#ece6da] bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left" aria-expanded={open}>
        <Lock size={14} className="shrink-0 text-[#b7ad9c]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px]">
            {count} {count === 1 ? 'item' : 'items'} · {rupees(o.totalPaise)}
          </span>
          <span className="block text-[12.5px] text-[#8a8276]">
            {o.status === 'cancelled' ? 'Cancelled' : KITCHEN_LABEL[o.kitchenStatus]} · {o.paymentStatus === 'paid' ? 'Paid' : 'Not paid yet'}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-[#8a8276] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-[#f0ebe1] px-3.5 pb-3 pt-2 text-[13.5px]">
          <ul className="space-y-1">
            {o.items.map((it, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular-nums text-[#8a8276]">{qty(it.quantity)}×</span>
                <span className="flex-1">{it.itemName}</span>
                <span className="tabular-nums">{rupees(it.lineTotalPaise)}</span>
              </li>
            ))}
            {o.discountPaise > 0 && (
              <li className="flex justify-between text-[#2e7031]">
                <span>First-order discount</span>
                <span className="tabular-nums">−{rupees(o.discountPaise)}</span>
              </li>
            )}
          </ul>
          <Link to={`/o/${o.guestToken}`} className="mt-2 inline-block text-[13px] text-[#8c2f1b]">
            Track this order →
          </Link>
        </div>
      )}
    </li>
  );
}

/** What a guest sees after scanning the table's QR code: confirm email, then the menu, a cart and "Place order". */
export default function GuestMenuPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<string | null>(() => read(localStorage, SESSION_KEY, null));
  const [menu, setMenu] = useState<TableMenu | null>(null);
  const [loadError, setLoadError] = useState<'missing' | 'network' | null>(null);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [cart, setCart] = useState<Record<number, number>>(() => read(sessionStorage, cartKey(token), {}));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [note, setNote] = useState('');
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(uuid());

  const signOut = useCallback(() => {
    write(localStorage, SESSION_KEY, null);
    setSession(null);
    setOrders([]);
  }, []);

  const load = useCallback(() => {
    tableGuestApi.menu(token, session).then(
      (m) => {
        setMenu(m);
        setLoadError(null);
        // An expired session: back to the email step.
        if (session && !m.guest) signOut();
        if (m.guest) {
          setCart((c) => Object.fromEntries(Object.entries(c).filter(([id]) => m.products.some((p) => p.id === Number(id)))));
          tableGuestApi.myOrders(token, session!).then(setOrders, () => undefined);
        }
      },
      (e) => setLoadError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'missing' : 'network'),
    );
  }, [token, session, signOut]);
  useEffect(load, [load]);
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

  if (!menu.guest || !session) {
    return (
      <Gate
        token={token}
        menu={menu}
        onVerified={(s, pct) => {
          write(localStorage, SESSION_KEY, s);
          setSession(s);
          if (pct > 0) setWelcome(true);
        }}
      />
    );
  }

  const guest = menu.guest;
  const lines = menu.products.filter((p) => cart[p.id]).map((p) => ({ p, n: cart[p.id] }));
  const count = lines.reduce((s, l) => s + l.n, 0);
  const subtotal = lines.reduce((s, l) => s + l.n * l.p.pricePaise, 0);
  const discount = discountFor(subtotal, guest.discountPct);
  const total = subtotal - discount;
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
      const { guestToken } = await tableGuestApi.order(token, session, {
        items: lines.map((l) => ({ productId: l.p.id, quantity: l.n })),
        note: note.trim() || null,
        paid,
        idempotencyKey: attempt,
      });
      // Saved now: the page is left right away, before the effect that stores the cart would run.
      write(sessionStorage, cartKey(token), {});
      setCart({});
      setNote('');
      setPaid(false);
      setAttempt(uuid());
      navigate(`/o/${guestToken}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'GUEST_SESSION') return signOut();
      setError(e instanceof ApiError ? e.message : "Couldn't send your order. Check your connection and try again.");
      if (e instanceof ApiError && e.code === 'ITEM_UNAVAILABLE') load();
      if (e instanceof ApiError) setAttempt(uuid()); // the server refused it: a corrected order is a new one
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] pb-28 text-[#1f1b16]">
      <header className="mx-auto max-w-2xl px-4 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <ShopLogo logoKey={menu.shop.logoKey} name={menu.shop.name} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-semibold leading-tight">{menu.shop.name}</h1>
            <p className="truncate text-[13px] text-[#8a8276]">
              Hi {guest.name.split(' ')[0]} ·{' '}
              <button type="button" onClick={signOut} className="underline-offset-2 hover:underline">
                Not you?
              </button>
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[#1f1b16] px-3 py-1.5 text-[13px] font-semibold text-white">Table {menu.table.label}</span>
        </div>

        {guest.discountPct > 0 && (
          <button type="button" onClick={() => setWelcome(true)} className="mt-4 flex w-full items-center gap-2.5 rounded-xl bg-[#fdf3e3] px-3.5 py-2.5 text-left text-[14px] text-[#7a4c09]">
            <Sparkles size={16} className="shrink-0" />
            <span>
              <strong>{guest.discountPct}% off</strong> your first order, applied at checkout.
            </span>
          </button>
        )}

        {orders.length > 0 && (
          <section className="mt-4" aria-label="Your orders">
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8a8276]">Your orders</p>
            <ul className="space-y-2">
              {orders.map((o) => (
                <PlacedOrder key={o.guestToken} o={o} />
              ))}
            </ul>
            <p className="mt-2 text-[12.5px] text-[#a39a8c]">Orders already placed can't be changed. To add something, order it below; for anything else, ask the staff.</p>
          </section>
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
        {sections.length === 0 && <p className="py-16 text-center text-[15px] text-[#8a8276]">{query ? 'Nothing matches your search.' : 'The menu is empty right now. Please ask the staff.'}</p>}
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
          <button type="button" onClick={() => setOpen(true)} className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 rounded-2xl bg-[#1f1b16] px-5 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]">
            <ShoppingBag size={18} />
            <span className="text-[15px]">
              {count} {count === 1 ? 'item' : 'items'}
            </span>
            <span className="ml-auto text-[16px] font-semibold tabular-nums">{rupees(total)}</span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[13.5px]">View order</span>
          </button>
        </div>
      )}

      {/* Cart */}
      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Your order" onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[19px] font-semibold">New order · Table {menu.table.label}</h2>
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
                        <p className="text-[13px] tabular-nums text-[#8a8276]">{rupees(p.pricePaise * n)}</p>
                      </div>
                      <Stepper n={n} onChange={(v) => setQty(p.id, v)} name={p.name} />
                    </li>
                  ))}
                </ul>

                <dl className="mt-2 space-y-1 border-t border-[#f0ebe1] pt-3 text-[14.5px]">
                  {discount > 0 && (
                    <>
                      <div className="flex justify-between text-[#5e574c]">
                        <dt>Subtotal</dt>
                        <dd className="tabular-nums">{formatINR(subtotal)}</dd>
                      </div>
                      <div className="flex justify-between text-[#2e7031]">
                        <dt>First-order discount ({guest.discountPct}%)</dt>
                        <dd className="tabular-nums">−{formatINR(discount)}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-[16px] font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{formatINR(total)}</dd>
                  </div>
                </dl>

                <div className="mt-4 space-y-3">
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
                  <p className="text-[12.5px] text-[#a39a8c]">Once placed, this order can't be changed. Your bill will be emailed to {guest.email}.</p>
                </div>

                {error && <p className="mt-3 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}

                <button type="button" disabled={busy} onClick={place} className={`${primary} mt-4 h-14`}>
                  {busy && <Spinner className="h-4 w-4" />}
                  Place order · {formatINR(total)}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* First-order welcome */}
      {welcome && guest.discountPct > 0 && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={() => setWelcome(false)}>
          <div role="dialog" aria-modal="true" aria-label="Welcome offer" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center">
            <div className="bg-[#1f1b16] px-6 pb-6 pt-8 text-white">
              <Sparkles size={28} className="mx-auto text-[#f6d48a]" />
              <p className="mt-3 text-[15px] opacity-80">Welcome to {menu.shop.name}</p>
              <p className="mt-1 text-[44px] font-bold leading-none">{guest.discountPct}% off</p>
              <p className="mt-2 text-[15px]">your first order</p>
            </div>
            <div className="p-6">
              <p className="text-[14.5px] text-[#5e574c]">It's taken off automatically when you place your order, and shows on your bill.</p>
              <button type="button" onClick={() => setWelcome(false)} className={`${primary} mt-5 h-12`}>
                Start ordering
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
