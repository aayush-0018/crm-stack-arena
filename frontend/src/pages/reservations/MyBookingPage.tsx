import { Armchair, CalendarCheck, CalendarDays, CalendarX, Clock, Phone, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { bookingApi } from '../../api/endpoints';
import { clock, longDay, people } from '../../components/reservations/reservations';
import ShopLogo from '../../components/ui/ShopLogo';
import Spinner from '../../components/ui/Spinner';
import type { GuestBooking, ReservationStatus } from '../../types';

const HEAD: Record<ReservationStatus, { title: string; tone: string }> = {
  booked: { title: 'Your table is booked', tone: 'bg-[#e9f3e8] text-[#2e7031]' },
  seated: { title: 'Enjoy your meal!', tone: 'bg-[#e9f3e8] text-[#2e7031]' },
  finished: { title: 'Thanks for visiting', tone: 'bg-[#f3efe7] text-[#5e574c]' },
  cancelled: { title: 'This booking is cancelled', tone: 'bg-[#fdecea] text-[#a8321f]' },
  no_show: { title: 'This booking has lapsed', tone: 'bg-[#f3efe7] text-[#5e574c]' },
};

/** The guest's own booking, from the link in their email: see it, or cancel it. */
export default function MyBookingPage() {
  const { token = '' } = useParams();
  const [b, setB] = useState<GuestBooking | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bookingApi.view(token).then(setB, () => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4] px-6 text-center text-[15px] text-[#5e574c]">
        We couldn't find this booking. Please check the link in your email.
      </div>
    );
  }
  if (!b) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4]">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      setB(await bookingApi.cancel(token));
      setConfirming(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't cancel. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const head = HEAD[b.status];
  const Icon = b.status === 'cancelled' ? CalendarX : CalendarCheck;

  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] px-4 pb-10 pt-6 text-[#1f1b16]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <ShopLogo logoKey={b.shop.logoKey} name={b.shop.name} size={40} />
          <p className="min-w-0 flex-1 truncate text-[17px] font-semibold">{b.shop.name}</p>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ${head.tone}`}>
            <Icon size={22} />
          </span>
          <h1 className="mt-3 text-[21px] font-semibold">{head.title}</h1>
          <p className="mt-0.5 text-[14px] text-[#8a8276]">Booked for {b.name}</p>
          <ul className={`mt-4 space-y-2.5 text-[15.5px] ${b.status === 'cancelled' ? 'text-[#8a8276] line-through' : ''}`}>
            <li className="flex items-center gap-3">
              <CalendarDays size={18} className="text-[#8a8276]" /> {longDay(b.startsAt)}
            </li>
            <li className="flex items-center gap-3">
              <Clock size={18} className="text-[#8a8276]" /> {clock(b.startsAt)}
              <span className="text-[13px] text-[#8a8276]">· table kept till {clock(b.endsAt)}</span>
            </li>
            <li className="flex items-center gap-3">
              <Users size={18} className="text-[#8a8276]" /> {people(b.partySize)}
            </li>
            {b.tables.length > 0 && (
              <li className="flex items-center gap-3">
                <Armchair size={18} className="text-[#8a8276]" /> Table {b.tables.join(' + ')}
              </li>
            )}
          </ul>
          {b.notes && <p className="mt-3 rounded-xl bg-[#f8f5ef] px-3.5 py-2.5 text-[14px] text-[#5e574c]">“{b.notes}”</p>}
        </div>

        {b.status === 'booked' && (
          <p className="mt-3 px-1 text-[13px] text-[#8a8276]">Please arrive on time. If you're running late, give us a call so we can hold your table.</p>
        )}

        {b.shop.phone && (
          <a href={`tel:${b.shop.phone}`} className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#1f1b16] text-[15px] font-medium">
            <Phone size={16} /> Call {b.shop.name}
          </a>
        )}

        {b.canCancel &&
          (confirming ? (
            <div className="mt-4 rounded-2xl border border-[#f2cdc8] bg-[#fdf3f2] p-4">
              <p className="text-[14.5px]">Cancel your booking for {people(b.partySize)} at {clock(b.startsAt)}?</p>
              {error && <p className="mt-2 text-[13.5px] text-[#a8321f]">{error}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="h-11 rounded-xl border border-[#e6dfd2] bg-white text-[14.5px] font-medium">
                  Keep it
                </button>
                <button type="button" onClick={cancel} disabled={busy} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#a8321f] text-[14.5px] font-medium text-white">
                  {busy && <Spinner className="h-4 w-4" />} Yes, cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="mt-3 h-11 w-full text-[14px] text-[#a8321f]">
              Cancel booking
            </button>
          ))}
        <p className="mt-6 text-center text-[11.5px] text-[#a39a8c]">Powered by CartWell</p>
      </div>
    </div>
  );
}
