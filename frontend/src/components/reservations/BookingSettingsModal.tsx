import { Check, Copy, Download, ExternalLink, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { reservationsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { ReservationSettings } from '../../types';
import QrImage, { useQrDataUrl } from '../tables/QrImage';
import Button from '../ui/Button';
import { controlClass, SelectField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Alert } from '../ui/States';
import { DAY_SHORT, durationLabel, timeLabel } from './reservations';

export const bookingLink = (token: string) => `${window.location.origin}/book/${token}`;

type Rules = Omit<ReservationSettings, 'bookingToken'>;
const NOTICE = [0, 30, 60, 120, 240, 1440];
const noticeLabel = (m: number) => (m === 0 ? 'None' : m === 1440 ? '1 day' : durationLabel(m));

function LinkBox({ url, shopName }: { url: string; shopName: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const png = useQrDataUrl(url, 400);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('error', 'Could not copy — select the link and copy it manually');
    }
  };
  return (
    <div className="flex gap-4 rounded-xl border border-line p-3.5">
      <div className="hidden shrink-0 self-start rounded-lg border border-line bg-white p-1.5 sm:block">
        <QrImage text={url} size={96} label="QR code for the booking link" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <input readOnly value={url} aria-label="Booking link" onFocus={(e) => e.target.select()} className={controlClass(false, 'h-9 flex-1 truncate text-[13px] text-ink-2')} />
          <Button size="sm" variant="secondary" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Book a table at ${shopName}: ${url}`)}`, '_blank', 'noopener,noreferrer')}>
            <MessageCircle size={14} /> Share on WhatsApp
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-ink hover:bg-hover">
            <ExternalLink size={14} /> Open
          </a>
          {png && (
            <a href={png} download="book-a-table-qr.png" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-ink hover:bg-hover">
              <Download size={14} /> QR code
            </a>
          )}
        </div>
        <p className="text-[12px] text-ink-3">Put it on Instagram, Google Maps or a poster at the counter.</p>
      </div>
    </div>
  );
}

/** Opening hours, booking rules and the public booking link. Owners change them; staff can see them. */
export default function BookingSettingsModal({ open, onClose, onChange }: { open: boolean; onClose: () => void; onChange: (s: ReservationSettings) => void }) {
  const { shop, user } = useAuth();
  const toast = useToast();
  const isOwner = user?.role === 'owner';
  const [s, setS] = useState<ReservationSettings | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setConfirmOff(false);
    reservationsApi.settings().then(
      (r) => {
        setS(r);
        const { bookingToken: _, ...rest } = r;
        setRules(rest);
      },
      () => toast('error', 'Could not load the booking settings'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = async (key: string, fn: () => Promise<ReservationSettings>, done: string) => {
    setBusy(key);
    try {
      const r = await fn();
      setS(r);
      onChange(r);
      toast('success', done);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast('error', e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => {
    setRules((r) => (r ? { ...r, [k]: v } : r));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const lastStart = rules ? Math.max(0, Number(rules.closesAt.slice(0, 2)) * 60 + Number(rules.closesAt.slice(3)) - rules.durationMinutes) : 0;

  return (
    <Modal
      open={open}
      title="Online booking"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {isOwner && rules && (
            <Button loading={busy === 'save'} onClick={() => run('save', () => reservationsApi.saveSettings(rules), 'Booking rules saved')}>
              Save rules
            </Button>
          )}
        </>
      }
    >
      {!s || !rules ? (
        <div className="h-40 animate-pulse rounded-xl bg-hover" />
      ) : (
        <div className="space-y-5 pb-1">
          {s.bookingToken ? (
            <div className="space-y-2">
              <p className="text-[13.5px] text-ink-2">Guests pick a day, time and party size and confirm their email. Their booking shows up here without a table: you choose which table to give them.</p>
              <LinkBox url={bookingLink(s.bookingToken)} shopName={shop?.name ?? ''} />
              {isOwner && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                  <button type="button" className="text-ink-3 hover:text-ink" disabled={!!busy} onClick={() => run('new', reservationsApi.newLink, 'New link ready. The old one no longer works.')}>
                    Get a new link
                  </button>
                  <button
                    type="button"
                    className="text-ink-3 hover:text-danger-text"
                    disabled={!!busy}
                    onClick={() => (confirmOff ? run('off', reservationsApi.turnOff, 'Online booking is off') : setConfirmOff(true))}
                  >
                    {confirmOff ? 'Click again to turn off online booking' : 'Turn off online booking'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-4">
              <p className="text-[14px] font-medium text-ink">Let guests book a table themselves</p>
              <p className="mt-1 text-[13px] text-ink-3">You get a link and QR code to share. Guests only see times when a table that fits is free; you choose the actual table. The guest is emailed a confirmation.</p>
              {isOwner ? (
                <Button className="mt-3" loading={busy === 'on'} onClick={() => run('on', reservationsApi.newLink, 'Online booking is on')}>
                  Turn on online booking
                </Button>
              ) : (
                <p className="mt-2 text-[12.5px] text-ink-3">Ask an owner to turn it on.</p>
              )}
            </div>
          )}

          <fieldset disabled={!isOwner} className="space-y-4">
            <legend className="mb-2 text-[13px] font-medium uppercase tracking-[0.05em] text-ink-3">Booking rules</legend>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Opens" type="time" value={rules.opensAt} onChange={(e) => set('opensAt', e.target.value)} error={errors.opensAt} />
              <TextField
                label="Closes"
                type="time"
                value={rules.closesAt}
                onChange={(e) => set('closesAt', e.target.value)}
                error={errors.closesAt}
                hint={lastStart > 0 ? `Last booking at ${timeLabel(`${String(Math.floor(lastStart / 60)).padStart(2, '0')}:${String(lastStart % 60).padStart(2, '0')}`)}` : undefined}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Closed on</p>
              <div className="flex flex-wrap gap-1.5">
                {DAY_SHORT.map((d, i) => {
                  const closed = rules.closedDays.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={closed}
                      onClick={() => set('closedDays', closed ? rules.closedDays.filter((x) => x !== i) : [...rules.closedDays, i].sort())}
                      className={`h-8 w-12 rounded-lg border text-[13px] ${closed ? 'border-ink bg-ink text-on-ink' : 'border-line text-ink-2 hover:bg-hover'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              {errors.closedDays && <p className="mt-1.5 text-[12px] text-danger">{errors.closedDays}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SelectField label="Table held for" value={rules.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} error={errors.durationMinutes}>
                {[...new Set([45, 60, 75, 90, 120, 150, 180, 240, rules.durationMinutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {durationLabel(m)}
                    </option>
                  ))}
              </SelectField>
              <SelectField label="Times every" value={rules.slotMinutes} onChange={(e) => set('slotMinutes', Number(e.target.value) as Rules['slotMinutes'])}>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
              </SelectField>
              <TextField label="Largest group online" type="number" min={1} max={50} value={rules.maxParty} onChange={(e) => set('maxParty', Number(e.target.value))} error={errors.maxParty} />
              <TextField label="Days ahead" type="number" min={1} max={180} value={rules.daysAhead} onChange={(e) => set('daysAhead', Number(e.target.value))} error={errors.daysAhead} hint="How far ahead guests can book" />
              <SelectField label="At least this early" value={rules.minNoticeMinutes} onChange={(e) => set('minNoticeMinutes', Number(e.target.value))}>
                {[...new Set([...NOTICE, rules.minNoticeMinutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {noticeLabel(m)}
                    </option>
                  ))}
              </SelectField>
            </div>
            <p className="text-[12px] text-ink-3">Online, one table seats the whole group. Bigger groups are asked to call you; you can still book them here across several tables.</p>
          </fieldset>
          {!isOwner && <Alert tone="info">Only an owner can change these.</Alert>}
        </div>
      )}
    </Modal>
  );
}
