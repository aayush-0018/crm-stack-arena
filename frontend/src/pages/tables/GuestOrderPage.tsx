import { Check, ChefHat, CookingPot, HandPlatter, Receipt } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { tableGuestApi } from '../../api/endpoints';
import { qty, usePolling } from '../../components/tables/dinein';
import ShopLogo from '../../components/ui/ShopLogo';
import Spinner from '../../components/ui/Spinner';
import { formatDateTime } from '../../lib/date';
import { formatINR } from '../../lib/money';
import type { GuestOrderView, KitchenStatus } from '../../types';

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
  const done = o && (o.status === 'cancelled' || (o.kitchenStatus === 'served' && o.paymentStatus === 'paid'));

  const load = useCallback(() => {
    if (done) return;
    tableGuestApi.view(guestToken).then(setO, (e) => e instanceof ApiError && e.status < 500 && setMissing(true));
  }, [guestToken, done]);
  usePolling(load, 5000);

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
          <div className="mt-3 flex items-center justify-between border-t border-[#f0ebe1] pt-3 text-[16px] font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatINR(o.totalPaise)}</span>
          </div>
          <p className={`mt-1.5 text-right text-[13.5px] ${o.paymentStatus === 'paid' ? 'text-[#2e7031]' : 'text-[#9a5a0a]'}`}>
            {o.paymentStatus === 'paid' ? 'Paid · thank you!' : `${formatINR(owed)} to pay at the counter`}
          </p>
        </div>

        <p className="mt-3 text-center text-[12px] text-[#a39a8c]">Placed {formatDateTime(o.createdAt)} · this page updates by itself</p>

        {o.tableToken && o.status !== 'cancelled' && (
          <Link to={`/t/${o.tableToken}`} className="mt-5 flex h-12 items-center justify-center rounded-2xl border border-[#1f1b16] text-[15px] font-medium">
            Order something else
          </Link>
        )}
      </div>
    </div>
  );
}
