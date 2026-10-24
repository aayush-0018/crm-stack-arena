import { AtSign, Calendar, IndianRupee, MapPin, Phone, ShoppingBag, Tag } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { customersApi } from '../../api/endpoints';
import { relativeDays } from '../../lib/date';
import { formatINR } from '../../lib/money';
import type { Customer } from '../../types';
import Avatar from '../ui/Avatar';
import { SegmentBadge } from '../ui/Badge';
import Button, { ButtonLink } from '../ui/Button';
import MessageComposer from './MessageComposer';

type CardData = Customer & { outstandingPaise?: number };
const cache = new Map<number, CardData>();

/**
 * Wraps a customer name. Hovering shows a details card (like a contact preview) with
 * "Message" (WhatsApp composer) and "New order". Touch users just follow the link.
 */
export default function CustomerHoverCard({
  customerId,
  customer,
  children,
}: {
  customerId: number;
  customer?: Customer;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean }>({ top: 0, left: 0, above: false });
  const [data, setData] = useState<CardData | null>(customer ?? cache.get(customerId) ?? null);
  const [composing, setComposing] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();

  useEffect(() => () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!open || data) return;
    customersApi
      .get(customerId)
      .then((c) => {
        const d: CardData = { ...c, orderCount: c.stats.orderCount, totalSpentPaise: c.stats.totalSpentPaise, outstandingPaise: c.stats.outstandingPaise };
        cache.set(customerId, d);
        setData(d);
      })
      .catch(() => setOpen(false));
  }, [open, data, customerId]);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    if (open) return;
    openTimer.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const above = r.bottom + 420 > window.innerHeight && r.top > 440;
      setPos({ top: above ? r.top - 8 : r.bottom + 8, left: Math.min(r.left - 12, window.innerWidth - 400), above });
      setOpen(true);
    }, 350);
  };
  const hide = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setComposing(false);
    }, 220);
  };

  const due = data?.duePaise ?? data?.outstandingPaise ?? 0;
  const rows: { icon: ReactNode; label: string; value: ReactNode }[] = data
    ? [
        ...(data.segment ? [{ icon: <Tag size={15} />, label: 'Status', value: <SegmentBadge segment={data.segment} /> }] : []),
        { icon: <Phone size={15} />, label: 'Phone', value: data.phone },
        { icon: <AtSign size={15} />, label: 'Email', value: data.email || '—' },
        { icon: <MapPin size={15} />, label: 'Address', value: data.address || '—' },
        { icon: <ShoppingBag size={15} />, label: 'Orders', value: String(data.orderCount ?? 0) },
        { icon: <IndianRupee size={15} />, label: 'Total spent', value: formatINR(data.totalSpentPaise ?? 0) },
        ...(data.lastOrderDate !== undefined ? [{ icon: <Calendar size={15} />, label: 'Last order', value: relativeDays(data.lastOrderDate) }] : []),
      ]
    : [];

  return (
    <span ref={anchor} className="inline-flex min-w-0" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {open && (
        <div
          role="dialog"
          aria-label={data ? `${data.name} details` : 'Customer details'}
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-[380px] max-w-[calc(100vw-24px)] cursor-default whitespace-normal"
          style={{ top: pos.top, left: Math.max(12, pos.left), transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <div className="rounded-2xl border border-line bg-white shadow-pop">
            {!data ? (
              <p className="px-4 py-6 text-[13px] text-ink-3">Loading…</p>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 pb-2 pt-4">
                  <Avatar name={data.name} size={32} />
                  <span className="truncate text-[15px] font-medium text-ink">{data.name}</span>
                </div>
                <dl className="px-4 pb-3">
                  {rows.map((r) => (
                    <div key={r.label} className="flex h-9 items-center gap-2 text-[14px]">
                      <dt className="flex w-36 shrink-0 items-center gap-2.5 text-ink-2">
                        <span className="text-ink-3">{r.icon}</span>
                        {r.label}
                      </dt>
                      <dd className="min-w-0 truncate text-ink">{r.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex gap-2 border-t border-line px-4 py-3">
                  <Button size="sm" onClick={() => setComposing((c) => !c)}>
                    Message
                  </Button>
                  <ButtonLink size="sm" variant="secondary" to={`/orders/new?customerId=${data.id}`}>
                    New order
                  </ButtonLink>
                  <ButtonLink size="sm" variant="ghost" to={`/customers/${data.id}`} className="ml-auto">
                    View profile
                  </ButtonLink>
                </div>
              </>
            )}
          </div>
          {composing && data && (
            <div className="ml-6 mt-2 w-[340px] max-w-full shadow-pop">
              <MessageComposer name={data.name} phone={data.phone} duePaise={due} autoFocus compact />
            </div>
          )}
        </div>
      )}
    </span>
  );
}
