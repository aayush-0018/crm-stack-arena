import { CalendarDays, Clock, Mail, Minus, Phone, Plus, Users } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { bookingApi } from '../../api/endpoints';
import { addDays, DAY_LONG, DAY_SHORT, durationLabel, people, timeLabel, weekdayOf } from '../../components/reservations/reservations';
import ShopLogo from '../../components/ui/ShopLogo';
import Spinner from '../../components/ui/Spinner';
import type { BookingPage, BookingTimes } from '../../types';

const input = 'h-12 w-full rounded-xl border border-[#e6dfd2] bg-white px-3.5 text-[16px] text-[#1f1b16] outline-none focus:border-[#8a8276]';
const primary = 'flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#1f1b16] text-[16px] font-semibold text-white disabled:opacity-50';
const card = 'mt-4 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]';
const DETAILS_KEY = 'cw.guestDetails';

function readDetails() {
  try {
    return { name: '', phone: '', email: '', ...JSON.parse(localStorage.getItem(DETAILS_KEY) ?? '{}') } as { name: string; phone: string; email: string };
  } catch {
    return { name: '', phone: '', email: '' };
  }
}

const dayNum = (d: string) => Number(d.slice(8));
const monthShort = (d: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/** The branch's public page: pick party size, day and time; confirm by email code; done. */
export default function BookTablePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<BookingPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<'pick' | 'details' | 'code'>('pick');
  const [party, setParty] = useState(2);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [times, setTimes] = useState<BookingTimes | null>(null);
  const [notes, setNotes] = useState('');
  const [form, setForm] = useState(readDetails);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ challenge: string; sentTo: string; at: number } | null>(null);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    bookingApi.page(token).then(
      (p) => {
        setPage(p);
        setParty((n) => Math.min(n, Math.max(1, p.maxParty)));
        // First open day.
        for (let i = 0; i <= p.daysAhead; i++) {
          const d = addDays(p.today, i);
          if (!p.closedDays.includes(weekdayOf(d))) return setDate(d);
        }
      },
      () => setMissing(true),
    );
  }, [token]);

  useEffect(() => {
    if (!date || !page?.maxParty) return;
    let live = true;
    setTimes(null);
    bookingApi.times(token, date, party).then(
      (t) => {
        if (!live) return;
        setTimes(t);
        setTime((cur) => (cur && t.times.some((x) => x.time === cur && x.available) ? cur : null));
      },
      () => live && setTimes({ times: [], reason: 'full' }),
    );
    return () => {
      live = false;
    };
  }, [token, date, party, page]);

  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const days = useMemo(() => (page ? Array.from({ length: Math.min(page.daysAhead, 60) + 1 }, (_, i) => addDays(page.today, i)) : []), [page]);

  if (missing) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4] px-6 text-center text-[15px] text-[#5e574c]">
        This booking link isn't working. Please contact the café directly.
      </div>
    );
  }
  if (!page) {
    return (
      <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4]">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const call = page.shop.phone ? (
    <a href={`tel:${page.shop.phone}`} className="inline-flex items-center gap-1 font-medium text-[#8c2f1b]">
      <Phone size={13} /> {page.shop.phone}
    </a>
  ) : null;

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
      try {
        localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
      } catch {
        /* private mode */
      }
      const r = await bookingApi.requestCode(token, details);
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

  const confirm = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!sent || !date || !time) return;
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email');
    setBusy(true);
    setError(null);
    try {
      const r = await bookingApi.confirm(token, { challenge: sent.challenge, code, date, time, partySize: party, notes: notes.trim() || null });
      navigate(`/b/${r.manageToken}`, { replace: true });
    } catch (e2) {
      if (e2 instanceof ApiError && (e2.code === 'SLOT_TAKEN' || e2.code === 'ALREADY_BOOKED' || e2.code === 'TOO_MANY_BOOKINGS')) {
        // Back to the times; the code still works for another time if it was only the slot.
        setStep('pick');
        setTime(null);
        setTimes(null);
        bookingApi.times(token, date, party).then(setTimes, () => undefined);
      }
      setError(e2 instanceof ApiError ? e2.message : "Couldn't confirm. Check your connection.");
      if (e2 instanceof ApiError && e2.code === 'CODE_EXPIRED') setCode('');
    } finally {
      setBusy(false);
    }
  };

  const summary = date && time && (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-[#f3efe7] px-4 py-3 text-[14px]">
      <span className="inline-flex items-center gap-1.5">
        <Users size={15} /> {people(party)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays size={15} /> {DAY_SHORT[weekdayOf(date)]}, {dayNum(date)} {monthShort(date)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock size={15} /> {timeLabel(time)}
      </span>
      <button type="button" className="ml-auto text-[13px] text-[#8c2f1b]" onClick={() => setStep('pick')}>
        Change
      </button>
    </div>
  );

  const wait = sent ? Math.max(0, 30 - Math.floor((now - sent.at) / 1000)) : 0;

  return (
    <div className="theme-light min-h-screen bg-[#faf8f4] px-4 pb-10 pt-6 text-[#1f1b16]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <ShopLogo logoKey={page.shop.logoKey} name={page.shop.name} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-semibold leading-tight">{page.shop.name}</h1>
            <p className="text-[13px] text-[#8a8276]">Book a table</p>
          </div>
        </div>

        {page.maxParty < 1 ? (
          <div className={card}>
            <p className="text-[15px]">Online booking isn't open right now.</p>
            {call && <p className="mt-2 text-[14px] text-[#5e574c]">Please call us on {call}.</p>}
          </div>
        ) : step === 'pick' ? (
          <>
            {error && <p className="mt-4 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}
            <div className={card}>
              <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-[#8a8276]">How many people?</p>
              <div className="mt-3 flex items-center justify-between">
                <button type="button" aria-label="Fewer people" disabled={party <= 1} onClick={() => setParty(party - 1)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e6dfd2] disabled:opacity-40">
                  <Minus size={18} />
                </button>
                <span className="text-[22px] font-semibold tabular-nums" aria-live="polite">
                  {people(party)}
                </span>
                <button type="button" aria-label="More people" disabled={party >= page.maxParty} onClick={() => setParty(party + 1)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e6dfd2] disabled:opacity-40">
                  <Plus size={18} />
                </button>
              </div>
              {party >= page.maxParty && call && <p className="mt-2 text-center text-[12.5px] text-[#8a8276]">More than {page.maxParty}? Call us on {call}.</p>}
            </div>

            <div className={card}>
              <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-[#8a8276]">Which day?</p>
              <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1" role="listbox" aria-label="Day">
                {days.map((d) => {
                  const closed = page.closedDays.includes(weekdayOf(d));
                  const on = d === date;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="option"
                      aria-selected={on}
                      disabled={closed}
                      onClick={() => setDate(d)}
                      className={`flex w-[58px] shrink-0 flex-col items-center rounded-xl border py-2 ${
                        on ? 'border-[#1f1b16] bg-[#1f1b16] text-white' : closed ? 'border-[#f0ebe1] text-[#cfc6b6]' : 'border-[#e6dfd2] bg-white'
                      }`}
                    >
                      <span className={`text-[11.5px] ${on ? 'text-white/70' : 'text-[#8a8276]'}`}>{d === page.today ? 'Today' : DAY_SHORT[weekdayOf(d)]}</span>
                      <span className="text-[18px] font-semibold leading-tight">{dayNum(d)}</span>
                      <span className={`text-[11px] ${on ? 'text-white/70' : 'text-[#8a8276]'}`}>{closed ? 'Closed' : monthShort(d)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={card}>
              <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-[#8a8276]">What time?</p>
              {!times ? (
                <div className="flex justify-center py-6">
                  <Spinner className="h-5 w-5" />
                </div>
              ) : !times.times.some((t) => t.available) ? (
                <p className="mt-3 text-[14px] text-[#5e574c]">
                  {times.reason === 'closed' && date
                    ? `We're closed on ${DAY_LONG[weekdayOf(date)]}.`
                    : times.reason === 'too_big'
                      ? `We can't seat ${people(party)} at one table online.`
                      : times.times.length
                        ? `Fully booked for ${people(party)} on this day. Please try another day.`
                        : 'No times left on this day. Please try another day.'}
                  {call && <> You can also call us on {call}.</>}
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {times.times.map((t) => (
                    <button
                      key={t.time}
                      type="button"
                      disabled={!t.available}
                      aria-pressed={time === t.time}
                      onClick={() => setTime(t.time)}
                      className={`h-11 rounded-xl border text-[14px] font-medium tabular-nums ${
                        time === t.time ? 'border-[#1f1b16] bg-[#1f1b16] text-white' : t.available ? 'border-[#e6dfd2] bg-white' : 'border-[#f0ebe1] text-[#cfc6b6] line-through'
                      }`}
                    >
                      {timeLabel(t.time).replace(' ', ' ')}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[12.5px] text-[#8a8276]">Your table is kept for {durationLabel(page.durationMinutes)}.</p>
            </div>

            <div className={card}>
              <label className="block">
                <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-[#8a8276]">Anything we should know?</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Birthday, high chair, window seat… (optional)"
                  className="mt-2 w-full rounded-xl border border-[#e6dfd2] bg-white px-3.5 py-2.5 text-[16px] outline-none focus:border-[#8a8276]"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={!date || !time}
              onClick={() => {
                setError(null);
                setStep(sent && Date.now() - sent.at < 9 * 60_000 ? 'code' : 'details');
              }}
              className={`${primary} mt-5`}
            >
              {time ? `Continue · ${timeLabel(time)}` : 'Pick a time'}
            </button>
          </>
        ) : step === 'details' ? (
          <>
            {summary}
            <form onSubmit={send} noValidate className={card}>
              <h2 className="text-[18px] font-semibold">Your details</h2>
              <p className="mt-1 text-[13.5px] text-[#8a8276]">We'll email you a code to confirm, then your booking.</p>
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
          </>
        ) : (
          <>
            {summary}
            <form onSubmit={confirm} noValidate className={card}>
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
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                className={`${input} mt-4 text-center text-[26px] font-semibold tracking-[0.5em]`}
                placeholder="••••••"
              />
              {error && <p className="mt-3 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}
              <button type="submit" disabled={busy || code.length !== 6} className={`${primary} mt-4`}>
                {busy && <Spinner className="h-4 w-4" />} Confirm booking
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
          </>
        )}
        <p className="mt-6 text-center text-[11.5px] text-[#a39a8c]">Powered by CartWell</p>
      </div>
    </div>
  );
}
