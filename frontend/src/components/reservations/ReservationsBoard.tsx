import { ChevronLeft, ChevronRight, Globe, Phone, Plus, StickyNote, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { reservationsApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { todayIST } from '../../lib/date';
import type { FloorPlan, Reservation, ReservationSettings, ReservationStatus } from '../../types';
import { usePolling, useNow } from '../tables/dinein';
import { Pill } from '../ui/Badge';
import Button from '../ui/Button';
import { controlClass } from '../ui/Field';
import { ConfirmDialog } from '../ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import BookingSettingsModal from './BookingSettingsModal';
import ReservationForm from './ReservationForm';
import { addDays, clock, dayTitle, hhmm, holdsTable, minutesOf, people, STATUS_LABEL, STATUS_TONE } from './reservations';

type View = 'list' | 'timeline';

const ACTIONS: Record<ReservationStatus, { status: ReservationStatus; label: string; primary?: boolean }[]> = {
  booked: [
    { status: 'seated', label: 'Seat', primary: true },
    { status: 'no_show', label: 'No-show' },
    { status: 'cancelled', label: 'Cancel' },
  ],
  seated: [
    { status: 'finished', label: 'Finish', primary: true },
    { status: 'booked', label: 'Undo seat' },
  ],
  finished: [],
  cancelled: [],
  no_show: [],
};
const DONE: Partial<Record<ReservationStatus, string>> = { seated: 'Seated', finished: 'Table freed', no_show: 'Marked as no-show', cancelled: 'Booking cancelled', booked: 'Back to booked' };

function Row({ r, now, busy, onAct, onEdit }: { r: Reservation; now: number; busy: boolean; onAct: (s: ReservationStatus) => void; onEdit: () => void }) {
  const open = holdsTable(r);
  const late = r.status === 'booked' && new Date(r.startsAt).getTime() < now - 15 * 60_000;
  return (
    <li className={`flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center ${open ? '' : 'opacity-60'}`}>
      <div className="w-24 shrink-0">
        <p className="text-[15px] font-medium tabular-nums text-ink">{clock(r.startsAt)}</p>
        <p className="text-[12px] text-ink-3">to {clock(r.endsAt)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={onEdit} disabled={!open} className="truncate text-left text-[14.5px] font-medium text-ink enabled:hover:underline">
            {r.name}
          </button>
          <span className="inline-flex items-center gap-1 text-[13px] text-ink-2">
            <Users size={13} /> {r.partySize}
          </span>
          <Pill tone={late ? 'amber' : STATUS_TONE[r.status]}>{late ? 'Late' : STATUS_LABEL[r.status]}</Pill>
          {r.source === 'online' && (
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-3" title="Booked online">
              <Globe size={12} /> Online
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
          <span className={r.tables.length ? 'text-ink-2' : 'text-warn-text'}>{r.tables.length ? r.tables.map((t) => t.label).join(' + ') : 'No table yet'}</span>
          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-ink">
            <Phone size={12} /> {r.phone.replace(/^(\d{5})(\d{5})$/, '$1 $2')}
          </a>
          {r.notes && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <StickyNote size={12} className="shrink-0" /> <span className="truncate">{r.notes}</span>
            </span>
          )}
        </div>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS[r.status].map((a) => (
            <Button key={a.status} size="sm" variant={a.primary ? 'primary' : 'secondary'} disabled={busy} onClick={() => onAct(a.status)}>
              {a.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
            Change
          </Button>
        </div>
      )}
    </li>
  );
}

const BAR: Record<ReservationStatus, string> = {
  booked: 'border-info-line bg-info-bg-2 text-info-strong',
  seated: 'border-success-line bg-success-bg-2 text-success-strong',
  finished: 'border-line bg-hover text-ink-3',
  cancelled: 'border-line bg-hover text-ink-4 line-through',
  no_show: 'border-danger-line-2 bg-danger-bg-2 text-danger-text line-through',
};

/** Tables down the side, the day's hours across: gaps are free tables. */
function Timeline({
  plan,
  list,
  settings,
  date,
  now,
  onEdit,
  onNew,
}: {
  plan: FloorPlan;
  list: Reservation[];
  settings: ReservationSettings;
  date: string;
  now: number;
  onEdit: (r: Reservation) => void;
  onNew: (tableId: number, time: string) => void;
}) {
  const shown = list.filter((r) => r.status !== 'cancelled');
  // Every booking listed starts on this day (India time).
  const startsMin = (r: Reservation) => minutesOf(hhmm(r.startsAt));
  const from = Math.floor(Math.min(minutesOf(settings.opensAt), ...shown.map(startsMin)) / 60) * 60;
  const to = Math.ceil(Math.max(minutesOf(settings.closesAt), ...shown.map((r) => startsMin(r) + (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 60_000)) / 60) * 60;
  const span = Math.max(60, Math.min(24 * 60, to) - from);
  const pct = (m: number) => `${((m - from) / span) * 100}%`;
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => from + i * 60);
  const nowMin = date === todayIST() ? minutesOf(hhmm(new Date(now).toISOString())) : null;
  const unassigned = shown.filter((r) => !r.tableIds.length);

  const lane = (key: string, label: string, sub: string | null, items: Reservation[], tableId?: number) => (
    <div key={key} className="flex border-t border-line">
      <div className="w-24 shrink-0 px-3 py-2">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {sub && <p className="text-[11.5px] text-ink-3">{sub}</p>}
      </div>
      <div
        className={`relative h-12 flex-1 ${tableId ? 'cursor-copy' : ''}`}
        onClick={(e) => {
          if (!tableId) return;
          const box = e.currentTarget.getBoundingClientRect();
          const m = from + Math.floor((((e.clientX - box.left) / box.width) * span) / settings.slotMinutes) * settings.slotMinutes;
          onNew(tableId, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
        }}
        title={tableId ? 'Click an empty spot to book this table' : undefined}
      >
        {hours.map((h) => (
          <span key={h} className="absolute inset-y-0 border-l border-line/70" style={{ left: pct(h) }} />
        ))}
        {items.map((r) => {
          const s = startsMin(r);
          const len = (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 60_000;
          return (
            <button
              key={r.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (holdsTable(r)) onEdit(r);
              }}
              className={`absolute inset-y-1.5 flex min-w-0 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-[11.5px] font-medium ${BAR[r.status]}`}
              style={{ left: pct(s), width: `calc(${(len / span) * 100}% - 2px)` }}
              title={`${clock(r.startsAt)} – ${clock(r.endsAt)} · ${r.name} · ${people(r.partySize)} · ${STATUS_LABEL[r.status]}`}
            >
              <span className="truncate">
                {r.name} · {r.partySize}
              </span>
            </button>
          );
        })}
        {nowMin !== null && nowMin >= from && nowMin <= from + span && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger" style={{ left: pct(nowMin) }} />}
      </div>
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div className="min-w-[720px]">
        <div className="flex">
          <div className="w-24 shrink-0" />
          <div className="relative h-7 flex-1">
            {hours.map((h, i) => (
              <span
                key={h}
                className={`absolute top-1.5 text-[11px] tabular-nums text-ink-3 ${i === 0 ? '' : i === hours.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
                style={{ left: pct(h) }}
              >
                {`${((Math.floor(h / 60) + 11) % 12) + 1}${h % 1440 < 720 ? 'am' : 'pm'}`}
              </span>
            ))}
          </div>
        </div>
        {plan.floors
          .filter((f) => f.tables.length)
          .map((f) => (
            <div key={f.id}>
              {plan.floors.filter((x) => x.tables.length).length > 1 && <p className="border-t border-line bg-canvas px-3 py-1 text-[11.5px] uppercase tracking-[0.05em] text-ink-3">{f.name}</p>}
              {f.tables.map((t) =>
                lane(
                  `t${t.id}`,
                  t.label,
                  `${t.seats} seats`,
                  shown.filter((r) => r.tableIds.includes(t.id)),
                  t.id,
                ),
              )}
            </div>
          ))}
        {unassigned.length > 0 && lane('none', 'No table', null, unassigned)}
      </div>
    </div>
  );
}

/** The Reservations tab: one day's bookings, as a list or across the tables. */
export default function ReservationsBoard({ plan }: { plan: FloorPlan | null }) {
  const toast = useToast();
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const today = todayIST();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today;
  const view: View = params.get('view') === 'timeline' ? 'timeline' : 'list';
  const [list, setList] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [settings, setSettings] = useState<ReservationSettings | null>(null);
  const [form, setForm] = useState<{ existing: Reservation | null; tableId?: number; time?: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ r: Reservation; status: ReservationStatus } | null>(null);

  const go = (next: Partial<{ date: string; view: View }>) => {
    const p = new URLSearchParams(params);
    p.set('tab', 'bookings');
    for (const [k, v] of Object.entries(next)) {
      if ((k === 'date' && v === today) || (k === 'view' && v === 'list')) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const load = useCallback(
    () =>
      reservationsApi.day(date).then(
        (l) => {
          setList(l);
          setError(null);
        },
        (e: Error) => setError(e),
      ),
    [date],
  );
  useEffect(() => setList(null), [date]);
  usePolling(load, 30_000);
  useEffect(() => {
    reservationsApi.settings().then(setSettings, () => undefined);
  }, []);

  const act = async (r: Reservation, status: ReservationStatus) => {
    if ((status === 'cancelled' || status === 'no_show') && confirm?.r.id !== r.id) return setConfirm({ r, status });
    setConfirm(null);
    setBusy(r.id);
    try {
      const updated = await reservationsApi.setStatus(r.id, status);
      setList((l) => l?.map((x) => (x.id === r.id ? updated : x)) ?? l);
      toast('success', DONE[status] ?? 'Saved');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Something went wrong');
      load();
    } finally {
      setBusy(null);
    }
  };

  const totals = useMemo(() => {
    const active = (list ?? []).filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');
    return { count: active.length, guests: active.reduce((s, r) => s + r.partySize, 0) };
  }, [list]);

  const sorted = useMemo(() => {
    // Still to come first, then finished/cancelled at the bottom.
    const rank = (r: Reservation) => (holdsTable(r) ? 0 : 1);
    return [...(list ?? [])].sort((a, b) => rank(a) - rank(b) || a.startsAt.localeCompare(b.startsAt));
  }, [list]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" aria-label="Previous day" onClick={() => go({ date: addDays(date, -1) })}>
            <ChevronLeft size={15} />
          </Button>
          <Button size="sm" variant={date === today ? 'primary' : 'secondary'} onClick={() => go({ date: today })}>
            Today
          </Button>
          <Button size="sm" variant="secondary" aria-label="Next day" onClick={() => go({ date: addDays(date, 1) })}>
            <ChevronRight size={15} />
          </Button>
        </div>
        <div className="w-[150px]">
          <input type="date" aria-label="Day" value={date} onChange={(e) => e.target.value && go({ date: e.target.value })} className={controlClass(false, 'h-8 text-[13px]')} />
        </div>
        <p className="text-[14px] text-ink">
          <span className="font-medium">{dayTitle(date, today)}</span>
          {list && (
            <span className="ml-2 text-ink-3">
              {totals.count} {totals.count === 1 ? 'booking' : 'bookings'} · {people(totals.guests)}
            </span>
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line p-0.5" role="tablist" aria-label="View">
            {(['list', 'timeline'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => go({ view: v })}
                className={`h-7 rounded-md px-2.5 text-[13px] ${view === v ? 'bg-ink text-on-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {v === 'list' ? 'List' : 'Timeline'}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowSettings(true)}>
            <Globe size={14} /> Online booking
            {settings && <span className={`h-1.5 w-1.5 rounded-full ${settings.bookingToken ? 'bg-success-strong' : 'bg-ink-4'}`} />}
          </Button>
          <Button size="sm" onClick={() => setForm({ existing: null })}>
            <Plus size={14} /> New booking
          </Button>
        </div>
      </div>

      {error && !list ? (
        <ErrorState error={error} onRetry={load} />
      ) : !list ? (
        <LoadingState />
      ) : view === 'timeline' && plan && settings ? (
        <Timeline
          plan={plan}
          list={list}
          settings={settings}
          date={date}
          now={now}
          onEdit={(r) => setForm({ existing: r })}
          onNew={(tableId, time) => setForm({ existing: null, tableId, time })}
        />
      ) : !list.length ? (
        <EmptyState
          title={`No bookings ${date === today ? 'today' : `on ${dayTitle(date, today)}`}`}
          description="Take a booking from a phone call, or turn on online booking so guests can book themselves."
          action={<Button onClick={() => setForm({ existing: null })}>New booking</Button>}
        />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sorted.map((r) => (
            <Row key={r.id} r={r} now={now} busy={busy === r.id} onAct={(s) => act(r, s)} onEdit={() => setForm({ existing: r })} />
          ))}
        </ul>
      )}

      <ReservationForm
        open={!!form}
        existing={form?.existing ?? null}
        date={date}
        time={form?.time}
        tableId={form?.tableId}
        defaultDuration={settings?.durationMinutes ?? 90}
        plan={plan}
        onClose={() => setForm(null)}
        onSaved={(r, isNew) => {
          setForm(null);
          toast('success', isNew ? (r.tables.length ? `Booked ${r.tables.map((t) => t.label).join(' + ')} for ${r.name}` : 'Booked. No free table fits yet: give one later.') : 'Booking updated');
          load();
        }}
      />
      <BookingSettingsModal open={showSettings} onClose={() => setShowSettings(false)} onChange={setSettings} />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.status === 'no_show' ? 'Mark as no-show?' : 'Cancel this booking?'}
        message={
          confirm &&
          (confirm.status === 'no_show'
            ? `${confirm.r.name} (${people(confirm.r.partySize)}, ${clock(confirm.r.startsAt)}) didn't come. Their table is freed.`
            : `${confirm.r.name}'s booking for ${people(confirm.r.partySize)} at ${clock(confirm.r.startsAt)} is cancelled and the table freed.${confirm.r.email ? ' We will email them.' : ''}`)
        }
        confirmLabel={confirm?.status === 'no_show' ? 'Mark no-show' : 'Cancel booking'}
        danger
        onConfirm={() => {
          if (confirm) act(confirm.r, confirm.status);
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
