import { ArrowLeft, Download, Receipt } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { tableGuestApi } from '../../api/endpoints';
import { KITCHEN_LABEL, qty, read, SESSION_KEY, usePolling } from '../../components/tables/dinein';
import Spinner from '../../components/ui/Spinner';
import { formatDateTime } from '../../lib/date';
import { formatINR } from '../../lib/money';
import type { GuestOrder } from '../../types';

const rupees = (paise: number) => formatINR(paise).replace(/\.00$/, '');
const card = 'rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]';
const primary = 'flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f1b16] text-[16px] font-semibold text-white';

const isDone = (o: GuestOrder) => o.status === 'cancelled' || o.kitchenStatus === 'served';
const due = (o: GuestOrder) => (o.status === 'cancelled' ? 0 : Math.max(0, o.totalPaise - o.amountPaidPaise));

function OrderCard({ o }: { o: GuestOrder }) {
  const cancelled = o.status === 'cancelled';
  const firstOrder = o.discountPaise - o.prizePaise;
  return (
    <li className={card}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{o.orderNumber}</p>
          <p className="text-[12.5px] text-[#736b5f]">
            {formatDateTime(o.createdAt)}
            {o.tableLabel ? ` · Table ${o.tableLabel}` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${
            cancelled ? 'bg-[#fdecea] text-[#a8321f]' : o.kitchenStatus === 'served' ? 'bg-[#f3efe7] text-[#5e574c]' : 'bg-[#fdf3e3] text-[#7a4c09]'
          }`}
        >
          {cancelled ? 'Cancelled' : KITCHEN_LABEL[o.kitchenStatus]}
        </span>
      </div>

      <ul className="mt-3 space-y-1 border-t border-[#f0ebe1] pt-3 text-[14px]">
        {o.items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="tabular-nums text-[#736b5f]">{qty(it.quantity)}×</span>
            <span className="flex-1">{it.itemName}</span>
            <span className="tabular-nums">{rupees(it.lineTotalPaise)}</span>
          </li>
        ))}
      </ul>
      {o.notes && <p className="mt-2 text-[13px] text-[#736b5f]">Note: {o.notes}</p>}

      <dl className="mt-3 space-y-1 border-t border-[#f0ebe1] pt-3 text-[13.5px]">
        {o.discountPaise > 0 && (
          <div className="flex justify-between text-[#5e574c]">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{rupees(o.subtotalPaise)}</dd>
          </div>
        )}
        {firstOrder > 0 && (
          <div className="flex justify-between text-[#2e7031]">
            <dt>First-order discount</dt>
            <dd className="tabular-nums">−{rupees(firstOrder)}</dd>
          </div>
        )}
        {o.prizePaise > 0 && (
          <div className="flex justify-between text-[#2e7031]">
            <dt>Table game prize</dt>
            <dd className="tabular-nums">−{rupees(o.prizePaise)}</dd>
          </div>
        )}
        <div className="flex justify-between text-[15px] font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{rupees(o.totalPaise)}</dd>
        </div>
        {!cancelled && (
          <div className="flex justify-between">
            <dt className="text-[#5e574c]">Payment</dt>
            <dd className={o.paymentStatus === 'paid' ? 'text-[#2e7031]' : 'text-[#a8321f]'}>
              {o.paymentStatus === 'paid' ? 'Paid' : o.amountPaidPaise > 0 ? `${rupees(due(o))} still to pay` : 'Not paid yet'}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex gap-2">
        <Link to={`/o/${o.guestToken}`} className="flex h-10 flex-1 items-center justify-center rounded-xl border border-[#1f1b16] text-[14px] font-medium">
          Track order
        </Link>
        {o.billToken && (
          <a
            href={`/bill/${o.billToken}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1f1b16] text-[14px] font-medium text-white"
          >
            <Download size={15} /> Bill
          </a>
        )}
      </div>
    </li>
  );
}

/** All of this guest's table orders from this visit, with every detail, away from the menu. */
export default function GuestOrdersPage() {
  const { token = '' } = useParams();
  const [session] = useState<string | null>(() => read(localStorage, SESSION_KEY, null));
  const [orders, setOrders] = useState<GuestOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    tableGuestApi.myOrders(token, session).then(
      (o) => {
        setOrders(o);
        setLoadError(null);
      },
      (e) => setLoadError(e instanceof ApiError && e.status === 401 ? 'session' : 'network'),
    );
  }, [token, session]);
  // The kitchen moves orders along, so keep the statuses fresh.
  usePolling(load, 15000);

  useEffect(() => {
    document.title = 'Your orders';
  }, []);

  const now = (orders ?? []).filter((o) => !isDone(o));
  const earlier = (orders ?? []).filter(isDone);
  const toPay = (orders ?? []).reduce((s, o) => s + due(o), 0);

  let body: React.ReactNode;
  if (!session || loadError === 'session') {
    body = (
      <div className={`${card} mt-6 text-center`}>
        <p className="text-[15px]">Confirm your email on the menu to see your orders.</p>
        <Link to={`/t/${token}`} className={`${primary} mt-4`}>
          Open the menu
        </Link>
      </div>
    );
  } else if (!orders) {
    body = loadError ? (
      <div className="mt-10 text-center text-[15px] text-[#5e574c]">
        <p>Couldn't load your orders.</p>
        <button type="button" onClick={load} className="mt-3 rounded-full border border-[#1f1b16] px-4 py-2 text-[14px] text-[#1f1b16]">
          Try again
        </button>
      </div>
    ) : (
      <div className="mt-16 flex justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  } else if (orders.length === 0) {
    body = (
      <div className={`${card} mt-6 text-center`}>
        <p className="text-[15px]">No orders yet.</p>
        <Link to={`/t/${token}`} className={`${primary} mt-4`}>
          Open the menu
        </Link>
      </div>
    );
  } else {
    body = (
      <>
        <div className={`${card} mt-5 flex items-center justify-between`}>
          <span className="text-[14px] text-[#5e574c]">
            {orders.length} {orders.length === 1 ? 'order' : 'orders'}
          </span>
          <span className="text-right">
            <span className="block text-[12.5px] text-[#736b5f]">{toPay > 0 ? 'Still to pay' : 'All paid'}</span>
            <span className="block text-[18px] font-semibold tabular-nums">{rupees(toPay)}</span>
          </span>
        </div>
        {now.length > 0 && (
          <section className="mt-5" aria-label="In progress">
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#736b5f]">In progress</p>
            <ul className="space-y-3">
              {now.map((o) => (
                <OrderCard key={o.guestToken} o={o} />
              ))}
            </ul>
          </section>
        )}
        {earlier.length > 0 && (
          <section className="mt-5" aria-label="Earlier">
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#736b5f]">Ready and earlier</p>
            <ul className="space-y-3">
              {earlier.map((o) => (
                <OrderCard key={o.guestToken} o={o} />
              ))}
            </ul>
          </section>
        )}
        <p className="mt-4 text-[12.5px] text-[#736b5f]">
          Orders from the last 12 hours. Orders already placed can't be changed. To add something, order it from the menu; for anything else,
          ask the staff.
        </p>
      </>
    );
  }

  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] px-4 pb-10 pt-5 text-[#1f1b16]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <Link to={`/t/${token}`} className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e6dfd2] bg-white" aria-label="Back to the menu">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="flex flex-1 items-center gap-2 text-[19px] font-semibold leading-tight">
            <Receipt size={20} /> Your orders
          </h1>
        </div>
        {body}
      </div>
    </div>
  );
}
