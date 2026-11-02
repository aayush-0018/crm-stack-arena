import { Check, ChefHat, CookingPot, Download, Gamepad2, HandPlatter, MessageCircle, Receipt, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { tableGuestApi } from '../../api/endpoints';
import { qty, read, SESSION_KEY, usePolling } from '../../components/tables/dinein';
import ShopLogo from '../../components/ui/ShopLogo';
import Spinner from '../../components/ui/Spinner';
import { formatDateTime } from '../../lib/date';
import { formatINR } from '../../lib/money';
import type { GameState, GuestOrderView, KitchenStatus } from '../../types';

/** Seconds on the "rate us" screen before Google's review page opens by itself. */
const REVIEW_COUNTDOWN = 4;

const STEPS: { status: KitchenStatus; label: string; hint: string; Icon: typeof Check }[] = [
  { status: 'new', label: 'Order received', hint: 'The kitchen has your order.', Icon: Receipt },
  { status: 'preparing', label: 'Preparing', hint: 'Your food is being made.', Icon: CookingPot },
  { status: 'ready', label: 'Ready', hint: 'Coming to your table now.', Icon: ChefHat },
  { status: 'served', label: 'Served', hint: 'Enjoy your meal!', Icon: HandPlatter },
];

/** The guest's view of one order: progress, items and whether it's paid. Refreshes itself. */
export default function GuestOrderPage() {
  const { guestToken = '' } = useParams();
  const [o, setO] = useState<GuestOrderView | null>(null);
  const [missing, setMissing] = useState(false);
  // Stop refreshing once it's over: cancelled, or served, paid and the bill sent.
  const done = o && (o.status === 'cancelled' || (o.kitchenStatus === 'served' && o.paymentStatus === 'paid' && !!o.billToken));

  const load = useCallback(() => {
    if (done) return;
    tableGuestApi.view(guestToken).then(setO, (e) => e instanceof ApiError && e.status < 500 && setMissing(true));
  }, [guestToken, done]);
  usePolling(load, 5000);

  // The review step and the game need the guest's session from the menu (same phone).
  const location = useLocation();
  const navigate = useNavigate();
  const [session] = useState<string | null>(() => read(localStorage, SESSION_KEY, null));
  const [game, setGame] = useState<GameState | null>(null);
  const [justOrdered, setJustOrdered] = useState(() => !!(location.state as { justOrdered?: boolean } | null)?.justOrdered);
  const [countdown, setCountdown] = useState(REVIEW_COUNTDOWN);
  const tableToken = o?.tableToken ?? null;
  useEffect(() => {
    if (tableToken && session) tableGuestApi.game(tableToken, session).then(setGame, () => undefined);
  }, [tableToken, session]);

  const askReview = justOrdered && !!game?.review && !game.review.done;
  // Leaves the "just ordered" state behind, so coming back from Google doesn't ask again.
  const settle = useCallback(() => {
    setJustOrdered(false);
    navigate(location.pathname, { replace: true, state: null });
  }, [navigate, location.pathname]);

  const openReview = useCallback(async () => {
    if (!game?.review || !tableToken || !session) return;
    const url = game.review.url;
    try {
      setGame(await tableGuestApi.reviewOpened(tableToken, session));
    } catch {
      /* still send them; the game opens next time they look */
    }
    settle();
    window.location.assign(url);
  }, [game, tableToken, session, settle]);

  useEffect(() => {
    if (!askReview) return;
    if (countdown <= 0) {
      openReview();
      return;
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [askReview, countdown, openReview]);

  if (missing) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4] px-6 text-center text-[15px] text-[#5e574c]">
        This order link isn't valid. Please ask the staff for help.
      </div>
    );
  }
  if (!o) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4]">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const at = STEPS.findIndex((s) => s.status === o.kitchenStatus);
  const owed = o.totalPaise - o.amountPaidPaise;

  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] px-4 pb-10 pt-6 text-[#1f1b16]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <ShopLogo logoKey={o.logoKey} name={o.shopName} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{o.shopName}</p>
            <p className="text-[13px] text-[#8a8276]">
              {o.tableLabel ? `Table ${o.tableLabel} · ` : ''}
              {o.orderNumber}
            </p>
          </div>
        </div>

        {o.status === 'cancelled' ? (
          <div className="mt-6 rounded-2xl border border-[#f2cdc8] bg-[#fdf3f2] p-5 text-[15px] text-[#a8321f]">This order was cancelled. Please ask the staff if this is a mistake.</div>
        ) : (
          <ol className="mt-6 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            {STEPS.map((s, i) => {
              const state = i < at ? 'done' : i === at ? 'now' : 'later';
              return (
                <li key={s.status} className="relative flex gap-3.5 pb-5 last:pb-0">
                  {i < STEPS.length - 1 && <span className={`absolute left-[17px] top-9 h-[calc(100%-36px)] w-0.5 ${i < at ? 'bg-[#1f1b16]' : 'bg-[#ece6da]'}`} />}
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      state === 'later' ? 'bg-[#f3efe7] text-[#b7ad9c]' : state === 'now' ? 'bg-[#1f1b16] text-white ring-4 ring-[#1f1b16]/10' : 'bg-[#1f1b16] text-white'
                    }`}
                  >
                    {state === 'done' ? <Check size={17} /> : <s.Icon size={17} />}
                  </span>
                  <div className="pt-1.5">
                    <p className={`text-[15.5px] ${state === 'later' ? 'text-[#b7ad9c]' : 'font-medium'}`}>{s.label}</p>
                    {state === 'now' && <p className="mt-0.5 text-[13.5px] text-[#8a8276]">{s.hint}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {game && o.status !== 'cancelled' && tableToken && (
          game.review && !game.review.done ? (
            <div className="mt-4 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <p className="flex items-center gap-2 text-[15px] font-medium">
                <Star size={17} className="text-[#e0a21b]" fill="#e0a21b" /> Enjoying {o.shopName}?
              </p>
              <p className="mt-0.5 text-[13.5px] text-[#8a8276]">Rate us on Google, then play the table game while you wait.</p>
              <button type="button" onClick={openReview} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1f1b16] text-[14px] font-medium text-white">
                <Star size={16} /> Rate us on Google
              </button>
            </div>
          ) : (
            !game.locked && (
              <Link to={`/t/${tableToken}/game`} className="mt-4 flex items-center gap-3 rounded-2xl bg-[#1f1b16] p-5 text-white">
                <Gamepad2 size={22} className="shrink-0 text-[#f6d48a]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">Play while you wait</span>
                  <span className="block text-[13px] opacity-75">Take on the other tables. The winner gets {game.prizePct}% off.</span>
                </span>
                <span aria-hidden>→</span>
              </Link>
            )
          )
        )}

        <div className="mt-4 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <ul className="space-y-2 text-[15px]">
            {o.items.map((it, i) => (
              <li key={i} className="flex gap-3">
                <span className="tabular-nums text-[#8a8276]">{qty(it.quantity)}×</span>
                <span className="flex-1">{it.itemName}</span>
                <span className="tabular-nums">{formatINR(it.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
          {o.notes && <p className="mt-3 text-[13.5px] text-[#8a8276]">Note: {o.notes}</p>}
          {o.discountPaise > 0 && (
            <div className="mt-3 space-y-1 border-t border-[#f0ebe1] pt-3 text-[14.5px]">
              <div className="flex justify-between text-[#5e574c]">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatINR(o.subtotalPaise)}</span>
              </div>
              {o.discountPaise - o.prizePaise > 0 && (
                <div className="flex justify-between text-[#2e7031]">
                  <span>First-order discount</span>
                  <span className="tabular-nums">−{formatINR(o.discountPaise - o.prizePaise)}</span>
                </div>
              )}
              {o.prizePaise > 0 && (
                <div className="flex justify-between text-[#2e7031]">
                  <span>Table game prize</span>
                  <span className="tabular-nums">−{formatINR(o.prizePaise)}</span>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-[#f0ebe1] pt-3 text-[16px] font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatINR(o.totalPaise)}</span>
          </div>
          <p className={`mt-1.5 text-right text-[13.5px] ${o.paymentStatus === 'paid' ? 'text-[#2e7031]' : 'text-[#9a5a0a]'}`}>
            {o.paymentStatus === 'paid' ? 'Paid · thank you!' : `${formatINR(owed)} to pay at the counter`}
          </p>
        </div>

        {o.billToken && (
          <div className="mt-4 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <p className="text-[15px] font-medium">Your bill is ready</p>
            <p className="mt-0.5 text-[13.5px] text-[#8a8276]">We've emailed it to you. Keep a copy here too:</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`/bill/${o.billToken}`} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1f1b16] text-[14px] font-medium text-white">
                <Download size={16} /> Download
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`My bill from ${o.shopName} (${o.orderNumber}): ${window.location.origin}/bill/${o.billToken}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#1f1b16] text-[14px] font-medium"
              >
                <MessageCircle size={16} /> WhatsApp
              </a>
            </div>
          </div>
        )}

        <p className="mt-3 text-center text-[12px] text-[#a39a8c]">Placed {formatDateTime(o.createdAt)} · this page updates by itself</p>

        {o.tableToken && o.status !== 'cancelled' && (
          <Link to={`/t/${o.tableToken}`} className="mt-5 flex h-12 items-center justify-center rounded-2xl border border-[#1f1b16] text-[15px] font-medium">
            Order something else
          </Link>
        )}
      </div>

      {/* Straight after ordering: off to Google's review box (stars and the text box), unless they say not now. */}
      {askReview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6">
          <div role="dialog" aria-modal="true" aria-label="Rate us on Google" className="w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center">
            <div className="bg-[#1f1b16] px-6 pb-6 pt-8 text-white">
              <Check size={28} className="mx-auto text-[#f6d48a]" />
              <p className="mt-3 text-[15px] opacity-80">Your order is with the kitchen</p>
              <div className="mt-3 flex justify-center gap-1" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} size={26} className="text-[#f6d48a]" fill="#f6d48a" />
                ))}
              </div>
              <p className="mt-3 text-[19px] font-semibold">Rate {o.shopName} on Google?</p>
            </div>
            <div className="p-6">
              <p className="text-[14.5px] text-[#5e574c]">It takes a few seconds and helps us a lot. Then come back here to play the table game.</p>
              <button type="button" onClick={openReview} className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-[#1f1b16] text-[16px] font-semibold text-white">
                Rate us now ({countdown})
              </button>
              <button type="button" onClick={settle} className="mt-2 h-10 w-full text-[14px] text-[#5e574c]">
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
