import { AlertTriangle } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { reservationsApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import type { FloorPlan, Reservation } from '../../types';
import Button from '../ui/Button';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { clock, dateOf, durationLabel, holdsTable, hhmm, toInstant } from './reservations';

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360];

interface Form {
  name: string;
  phone: string;
  email: string;
  partySize: string;
  date: string;
  time: string;
  durationMinutes: number;
  tableIds: number[];
  notes: string;
}

/** New booking, or changes to one. Tables are optional: with none picked the server gives the best free one. */
export default function ReservationForm({
  open,
  existing,
  date,
  time,
  tableId,
  defaultDuration,
  plan,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: Reservation | null;
  date: string;
  time?: string;
  tableId?: number;
  defaultDuration: number;
  plan: FloorPlan | null;
  onClose: () => void;
  onSaved: (r: Reservation, isNew: boolean) => void;
}) {
  const toast = useToast();
  const blank = (): Form => ({
    name: '',
    phone: '',
    email: '',
    partySize: '2',
    date,
    time: time ?? '19:00',
    durationMinutes: defaultDuration,
    tableIds: tableId ? [tableId] : [],
    notes: '',
  });
  const [form, setForm] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dayList, setDayList] = useState<Reservation[]>([]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      existing
        ? {
            name: existing.name,
            phone: existing.phone,
            email: existing.email ?? '',
            partySize: String(existing.partySize),
            date: dateOf(existing.startsAt),
            time: hhmm(existing.startsAt),
            durationMinutes: Math.round((new Date(existing.endsAt).getTime() - new Date(existing.startsAt).getTime()) / 60_000),
            tableIds: existing.tableIds,
            notes: existing.notes ?? '',
          }
        : blank(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  // The chosen day's bookings, to show which tables are taken at the chosen time.
  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return;
    let live = true;
    reservationsApi.day(form.date).then((l) => live && setDayList(l), () => live && setDayList([]));
    return () => {
      live = false;
    };
  }, [open, form.date]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const busyTables = useMemo(() => {
    const m = new Map<number, Reservation>();
    if (!/^\d{2}:\d{2}$/.test(form.time)) return m;
    const start = toInstant(form.date, form.time).getTime();
    const end = start + form.durationMinutes * 60_000;
    for (const r of dayList) {
      if (r.id === existing?.id || !holdsTable(r)) continue;
      if (new Date(r.startsAt).getTime() < end && new Date(r.endsAt).getTime() > start) for (const id of r.tableIds) m.set(id, r);
    }
    return m;
  }, [dayList, form.date, form.time, form.durationMinutes, existing]);

  const floors = plan?.floors.filter((f) => f.tables.length) ?? [];
  const seatsById = new Map(floors.flatMap((f) => f.tables.map((t) => [t.id, t.seats] as const)));
  const party = Number(form.partySize) || 0;
  const chosenSeats = form.tableIds.reduce((s, id) => s + (seatsById.get(id) ?? 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!form.name.trim()) err.name = 'Name is required';
    if (!/^(\+?91|0)?[6-9]\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) err.phone = 'Enter a 10-digit mobile number';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) err.email = 'Enter a valid email';
    if (!(party >= 1 && party <= 100)) err.partySize = 'Between 1 and 100';
    if (!form.date) err.date = 'Pick a date';
    if (!/^\d{2}:\d{2}$/.test(form.time)) err.time = 'Pick a time';
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        partySize: party,
        date: form.date,
        time: form.time,
        durationMinutes: form.durationMinutes,
        tableIds: form.tableIds.filter((id) => seatsById.has(id)),
        notes: form.notes.trim() || null,
      };
      const r = existing ? await reservationsApi.update(existing.id, body) : await reservationsApi.create(body);
      onSaved(r, !existing);
    } catch (e2) {
      if (e2 instanceof ApiError) {
        setErrors(e2.fieldErrors);
        toast('error', e2.message);
      } else toast('error', 'Could not save the booking');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={existing ? 'Change booking' : 'New booking'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reservation-form" loading={busy}>
            {existing ? 'Save changes' : 'Book table'}
          </Button>
        </>
      }
    >
      <form id="reservation-form" onSubmit={submit} noValidate className="space-y-4 pb-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Guest name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} maxLength={60} autoFocus />
          <TextField label="Mobile number" required type="tel" inputMode="numeric" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} placeholder="98765 43210" maxLength={16} />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            hint="Optional. We'll email the confirmation."
            className="sm:col-span-2"
            maxLength={254}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="People" required type="number" min={1} max={100} value={form.partySize} onChange={(e) => set('partySize', e.target.value)} error={errors.partySize} />
          <TextField label="Date" required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} error={errors.date} />
          <TextField label="Time" required type="time" step={300} value={form.time} onChange={(e) => set('time', e.target.value)} error={errors.time} />
          <SelectField label="Table held for" value={form.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))}>
            {[...new Set([...DURATIONS, form.durationMinutes])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {durationLabel(d)}
                </option>
              ))}
          </SelectField>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">Tables</p>
          {!floors.length ? (
            <p className="text-[13px] text-ink-3">Draw your floor plan to give bookings a table.</p>
          ) : (
            <div className="space-y-2">
              {floors.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-1.5">
                  {floors.length > 1 && <span className="w-full text-[11.5px] uppercase tracking-[0.05em] text-ink-3">{f.name}</span>}
                  {f.tables.map((t) => {
                    const on = form.tableIds.includes(t.id);
                    const taken = busyTables.get(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        title={taken ? `Booked ${clock(taken.startsAt)} – ${clock(taken.endsAt)} · ${taken.name}` : `${t.seats} seats`}
                        onClick={() => set('tableIds', on ? form.tableIds.filter((id) => id !== t.id) : [...form.tableIds, t.id])}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors ${
                          on
                            ? taken
                              ? 'border-danger-line-2 bg-danger-bg-2 text-danger-text'
                              : 'border-ink bg-ink text-on-ink'
                            : taken
                              ? 'border-line text-ink-4 line-through'
                              : 'border-line text-ink-2 hover:bg-hover hover:text-ink'
                        }`}
                      >
                        {t.label}
                        <span className={on && !taken ? 'opacity-70' : 'text-ink-4'}>{t.seats}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <p className="text-[12px] text-ink-3">
                {form.tableIds.length ? `${chosenSeats} seats picked.` : 'None picked: the smallest free table that fits is given.'} Crossed out = booked at that time.
              </p>
              {form.tableIds.length > 0 && chosenSeats < party && (
                <p className="flex items-center gap-1.5 text-[12.5px] text-warn-text">
                  <AlertTriangle size={13} /> These tables seat {chosenSeats}, fewer than {party} people.
                </p>
              )}
              {errors.tableIds && <p className="text-[12px] text-danger">{errors.tableIds}</p>}
            </div>
          )}
        </div>

        <TextAreaField label="Note" value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} placeholder="Birthday, high chair, window seat…" rows={2} />
      </form>
    </Modal>
  );
}
