import { ChevronLeft, ChevronRight, Download, LogIn, LogOut, Pencil, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { attendanceApi, staffApi, type EmployeePayload } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { Pill, type Tone } from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { SectionHeader } from '../../components/ui/Card';
import { controlClass, TextField } from '../../components/ui/Field';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { downloadCsv } from '../../lib/csv';
import { formatDate, todayIST } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR, paiseToInput } from '../../lib/money';
import type { AttendanceDay, AttendanceMark, AttendanceStatus, Employee } from '../../types';

type Tab = 'day' | 'month' | 'staff';

export const STATUS_TEXT: Record<AttendanceStatus, { label: string; short: string; tone: Tone }> = {
  present: { label: 'Present', short: 'P', tone: 'green' },
  half_day: { label: 'Half day', short: 'H', tone: 'yellow' },
  absent: { label: 'Absent', short: 'A', tone: 'red' },
  leave: { label: 'Leave', short: 'L', tone: 'blue' },
  week_off: { label: 'Week off', short: 'WO', tone: 'gray' },
};
const STATUSES = Object.keys(STATUS_TEXT) as AttendanceStatus[];
const CELL: Record<AttendanceStatus, string> = {
  present: 'bg-success-bg-2 text-success-text',
  half_day: 'bg-yellow-bg text-yellow-text',
  absent: 'bg-danger-bg-2 text-danger-text',
  leave: 'bg-info-bg-2 text-info-text',
  week_off: 'bg-hover text-neutral-text',
};
const worksThatDay = (s: AttendanceStatus | undefined) => s === 'present' || s === 'half_day';

const nowHHMM = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date());
const shiftDay = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (ym: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Could not save. Please try again.');

/** Staff attendance: mark the day, see the month, keep the staff list. */
export default function AttendancePage() {
  const [tab, setTab] = useState<Tab>('day');
  const [date, setDate] = useState(todayIST());
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [adding, setAdding] = useState(false);
  // Bumped after adding someone, so the list showing reloads.
  const [version, setVersion] = useState(0);
  const isOwner = useAuth().user?.role === 'owner';

  const openDay = (d: string) => {
    setDate(d);
    setTab('day');
  };

  return (
    <>
      <PageTop
        tabs={[
          { key: 'day', label: 'Daily register' },
          { key: 'month', label: 'Month' },
          { key: 'staff', label: 'Staff' },
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        actions={
          isOwner && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add staff
            </Button>
          )
        }
      />
      {tab === 'day' && <DayRegister key={version} date={date} setDate={setDate} onAdd={isOwner ? () => setAdding(true) : undefined} />}
      {tab === 'month' && <MonthView key={version} month={month} setMonth={setMonth} onOpenDay={openDay} isOwner={isOwner} />}
      {tab === 'staff' && <StaffList key={version} isOwner={isOwner} onAdd={() => setAdding(true)} />}
      <EmployeeModal
        open={adding}
        employee={null}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          setVersion((v) => v + 1);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Daily register
// ---------------------------------------------------------------------------

type Draft = { checkIn?: string; checkOut?: string; note?: string };

function DayRegister({ date, setDate, onAdd }: { date: string; setDate: (d: string) => void; onAdd?: () => void }) {
  const toast = useToast();
  const sheet = useAsync(() => attendanceApi.day(date), [date]);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const today = sheet.data?.today ?? todayIST();
  const isToday = date === today;

  const save = async (marks: Parameters<typeof attendanceApi.save>[1], who: number | 'all') => {
    setBusy(who);
    try {
      sheet.setData(await attendanceApi.save(date, marks));
      if (who !== 'all') setDrafts(({ [who]: _, ...rest }) => rest);
    } catch (err) {
      toast('error', errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const markOf = (id: number) => sheet.data?.staff.find((s) => s.id === id)?.mark ?? null;
  const fields = (id: number) => {
    const m = markOf(id);
    const d = drafts[id] ?? {};
    return { checkIn: d.checkIn ?? m?.checkIn ?? '', checkOut: d.checkOut ?? m?.checkOut ?? '', note: d.note ?? m?.note ?? '' };
  };

  const setStatus = (id: number, status: AttendanceStatus) => {
    const m = markOf(id);
    // Tapping the chosen status again clears the day.
    if (m?.status === status) return save([{ employeeId: id, status: null }], id);
    const f = fields(id);
    // Marking someone in today stamps the time, unless one is already there.
    const checkIn = worksThatDay(status) && !f.checkIn && isToday ? nowHHMM() : f.checkIn;
    save([{ employeeId: id, status, checkIn: checkIn || null, checkOut: f.checkOut || null, note: f.note || null }], id);
  };

  const saveFields = (id: number, patch: Draft) => {
    const m = markOf(id);
    const f = { ...fields(id), ...patch };
    if (!m) return setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    if (f.checkIn === (m.checkIn ?? '') && f.checkOut === (m.checkOut ?? '') && f.note === (m.note ?? '')) return;
    save([{ employeeId: id, status: m.status, checkIn: f.checkIn || null, checkOut: f.checkOut || null, note: f.note || null }], id);
  };

  const unmarked = sheet.data?.staff.filter((s) => !s.mark) ?? [];
  const allPresent = () =>
    save(
      unmarked.map((s) => ({ employeeId: s.id, status: 'present' as const, checkIn: isToday ? nowHHMM() : null })),
      'all',
    );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
      <Button size="sm" variant="ghost" aria-label="Previous day" onClick={() => setDate(shiftDay(date, -1))}>
        <ChevronLeft size={15} />
      </Button>
      <input
        type="date"
        aria-label="Day"
        value={date}
        max={today}
        onChange={(e) => e.target.value && e.target.value <= today && setDate(e.target.value)}
        className={controlClass(false, 'h-8 w-auto')}
      />
      <Button size="sm" variant="ghost" aria-label="Next day" disabled={date >= today} onClick={() => setDate(shiftDay(date, 1))}>
        <ChevronRight size={15} />
      </Button>
      {!isToday && (
        <Button size="sm" variant="secondary" onClick={() => setDate(today)}>
          Today
        </Button>
      )}
      <span className="text-[13px] text-ink-3">{isToday ? 'Today' : formatDate(date)}</span>
      {unmarked.length > 0 && (
        <Button size="sm" variant="secondary" className="ml-auto" loading={busy === 'all'} disabled={busy !== null} onClick={allPresent}>
          <UserCheck size={14} /> Mark {unmarked.length === sheet.data?.staff.length ? 'everyone' : `the other ${unmarked.length}`} present
        </Button>
      )}
    </div>
  );

  if (!sheet.data) {
    return (
      <>
        {toolbar}
        {sheet.error ? <ErrorState error={sheet.error} onRetry={sheet.reload} /> : <LoadingState label="Loading attendance…" />}
      </>
    );
  }

  const d: AttendanceDay = sheet.data;
  if (!d.staff.length) {
    return (
      <>
        {toolbar}
        <EmptyState
          title="No staff yet"
          description="Add the people who work here, then mark them present, absent or on leave each day."
          action={
            onAdd && (
              <Button onClick={onAdd}>
                <Plus size={14} /> Add staff
              </Button>
            )
          }
        />
      </>
    );
  }

  return (
    <div className={sheet.loading ? 'opacity-60 transition-opacity' : ''}>
      {toolbar}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-line px-4 py-3 text-[13px] sm:px-6">
        {STATUSES.map((s) => (
          <span key={s} className="text-ink-2">
            {STATUS_TEXT[s].label} <span className="tabular-nums text-ink">{d.counts[s]}</span>
          </span>
        ))}
        <span className={d.counts.unmarked ? 'text-warn-text' : 'text-ink-3'}>
          Not marked <span className="tabular-nums">{d.counts.unmarked}</span>
        </span>
      </div>
      <ul className="divide-y divide-line">
        {d.staff.map((s) => {
          const f = fields(s.id);
          const status = s.mark?.status;
          const hours = worksThatDay(status);
          return (
            <li key={s.id} className={`flex flex-col gap-3 px-4 py-3.5 sm:px-6 lg:flex-row lg:items-center ${busy === s.id ? 'opacity-60' : ''}`}>
              <div className="min-w-0 lg:w-56">
                <p className="truncate text-[14.5px] text-ink">
                  {s.name}
                  {!s.active && <span className="ml-2 text-[12px] text-ink-3">(left)</span>}
                </p>
                {s.jobTitle && <p className="truncate text-[12.5px] text-ink-3">{s.jobTitle}</p>}
              </div>
              <div role="radiogroup" aria-label={`${s.name}: attendance`} className="flex flex-wrap gap-1.5">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    role="radio"
                    aria-checked={status === st}
                    disabled={busy !== null}
                    title={status === st ? 'Tap again to clear' : undefined}
                    onClick={() => setStatus(s.id, st)}
                    className={`h-8 rounded-md border px-2.5 text-[13px] transition-colors disabled:cursor-wait ${
                      status === st ? `border-transparent font-medium ${CELL[st]}` : 'border-line text-ink-2 hover:bg-hover'
                    }`}
                  >
                    {STATUS_TEXT[st].label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                <TimeBox
                  label="In"
                  value={f.checkIn}
                  disabled={!hours}
                  onChange={(v) => setDrafts((x) => ({ ...x, [s.id]: { ...x[s.id], checkIn: v } }))}
                  onCommit={(v) => saveFields(s.id, { checkIn: v })}
                  onNow={isToday ? () => saveFields(s.id, { checkIn: nowHHMM() }) : undefined}
                  icon={<LogIn size={13} />}
                />
                <TimeBox
                  label="Out"
                  value={f.checkOut}
                  disabled={!hours}
                  onChange={(v) => setDrafts((x) => ({ ...x, [s.id]: { ...x[s.id], checkOut: v } }))}
                  onCommit={(v) => saveFields(s.id, { checkOut: v })}
                  onNow={isToday ? () => saveFields(s.id, { checkOut: nowHHMM() }) : undefined}
                  icon={<LogOut size={13} />}
                />
                <input
                  aria-label={`${s.name}: note`}
                  placeholder="Note"
                  maxLength={200}
                  value={f.note}
                  disabled={!status}
                  onChange={(e) => setDrafts((x) => ({ ...x, [s.id]: { ...x[s.id], note: e.target.value } }))}
                  onBlur={(e) => saveFields(s.id, { note: e.target.value.trim() })}
                  className={controlClass(false, 'h-8 w-36 disabled:opacity-40')}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TimeBox({
  label,
  value,
  disabled,
  onChange,
  onCommit,
  onNow,
  icon,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  onNow?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <span className={`flex items-center gap-1 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-[12px] text-ink-3">{label}</span>
      <input
        type="time"
        aria-label={label === 'In' ? 'Check-in time' : 'Check-out time'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        className={controlClass(false, 'h-8 w-[104px] px-2')}
      />
      {onNow && !value && (
        <button
          type="button"
          disabled={disabled}
          onClick={onNow}
          title={label === 'In' ? 'Checked in now' : 'Checked out now'}
          className="flex h-8 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-ink-2 hover:bg-hover"
        >
          {icon} Now
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Month at a glance
// ---------------------------------------------------------------------------

function MonthView({ month, setMonth, onOpenDay, isOwner }: { month: string; setMonth: (m: string) => void; onOpenDay: (d: string) => void; isOwner: boolean }) {
  const m = useAsync(() => attendanceApi.month(month), [month]);
  const thisMonth = todayIST().slice(0, 7);

  const exportCsv = () => {
    if (!m.data) return;
    const d = m.data;
    downloadCsv(`attendance-${d.month}.csv`, d.staff, [
      { header: 'Name', value: (s) => s.name },
      { header: 'Role', value: (s) => s.jobTitle },
      ...d.days.map((day) => ({ header: day.slice(8), value: (s: (typeof d.staff)[number]) => (s.marks[day] ? STATUS_TEXT[s.marks[day].status].short : '') })),
      { header: 'Present', value: (s) => s.present },
      { header: 'Half days', value: (s) => s.halfDay },
      { header: 'Absent', value: (s) => s.absent },
      { header: 'Leave', value: (s) => s.leave },
      { header: 'Week off', value: (s) => s.weekOff },
      { header: 'Not marked', value: (s) => s.unmarked },
      { header: 'Days worked', value: (s) => s.workedDays },
      ...(isOwner ? [{ header: 'Estimated pay (₹)', value: (s: (typeof d.staff)[number]) => (s.payPaise === null ? '' : (s.payPaise / 100).toFixed(2)) }] : []),
    ]);
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
      <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
        <ChevronLeft size={15} />
      </Button>
      <span className="min-w-[130px] text-center text-[14px] text-ink">{monthName(month)}</span>
      <Button size="sm" variant="ghost" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
        <ChevronRight size={15} />
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <span className="hidden flex-wrap gap-2 text-[12px] text-ink-3 sm:flex">
          {STATUSES.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10.5px] font-medium ${CELL[s]}`}>{STATUS_TEXT[s].short}</span>
              {STATUS_TEXT[s].label}
            </span>
          ))}
        </span>
        <Button size="sm" variant="secondary" disabled={!m.data?.staff.length} onClick={exportCsv}>
          <Download size={14} /> CSV
        </Button>
      </div>
    </div>
  );

  if (!m.data) {
    return (
      <>
        {toolbar}
        {m.error ? <ErrorState error={m.error} onRetry={m.reload} /> : <LoadingState label="Loading the month…" />}
      </>
    );
  }
  const d = m.data;
  if (!d.staff.length) {
    return (
      <>
        {toolbar}
        <EmptyState title="Nothing for this month" description="Staff and their attendance will show here once you add them." />
      </>
    );
  }

  const th = 'px-2 py-2 text-[11.5px] font-medium text-ink-3';
  return (
    <div className={m.loading ? 'opacity-60 transition-opacity' : ''}>
      {toolbar}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <th className={`${th} sticky left-0 z-10 bg-surface pl-4 text-left sm:pl-6`}>Staff</th>
              {d.days.map((day) => {
                const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
                return (
                  <th key={day} className={`${th} min-w-[30px] text-center ${wd === 0 ? 'text-ink-3' : ''}`}>
                    <span className="block">{Number(day.slice(8))}</span>
                    <span className="block text-[10px] font-normal">{'SMTWTFS'[wd]}</span>
                  </th>
                );
              })}
              <th className={`${th} text-right`}>Worked</th>
              <th className={`${th} text-right`}>Absent</th>
              <th className={`${th} text-right`}>Leave</th>
              <th className={`${th} text-right`}>Not marked</th>
              {isOwner && <th className={`${th} pr-4 text-right sm:pr-6`}>Est. pay</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.staff.map((s) => (
              <tr key={s.id}>
                <td className="sticky left-0 z-10 max-w-[180px] truncate bg-surface py-2 pl-4 pr-3 text-ink sm:pl-6">
                  {s.name}
                  {!s.active && <span className="ml-1.5 text-[11.5px] text-ink-3">(left)</span>}
                </td>
                {d.days.map((day) => {
                  const mark = s.marks[day] as AttendanceMark | undefined;
                  const future = day > d.today;
                  return (
                    <td key={day} className="px-0.5 py-1.5 text-center">
                      {future ? (
                        <span className="text-ink-4">·</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenDay(day)}
                          title={`${formatDate(day)}: ${mark ? STATUS_TEXT[mark.status].label : 'not marked'}${mark?.checkIn ? `, in ${mark.checkIn}` : ''}${mark?.checkOut ? `, out ${mark.checkOut}` : ''}${mark?.note ? ` (${mark.note})` : ''}`}
                          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded px-1 text-[10.5px] font-medium hover:ring-1 hover:ring-ink/20 ${
                            mark ? CELL[mark.status] : 'text-ink-4'
                          }`}
                        >
                          {mark ? STATUS_TEXT[mark.status].short : '–'}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 text-right tabular-nums text-ink">{s.workedDays}</td>
                <td className="px-2 text-right tabular-nums text-ink-2">{s.absent}</td>
                <td className="px-2 text-right tabular-nums text-ink-2">{s.leave}</td>
                <td className={`px-2 text-right tabular-nums ${s.unmarked ? 'text-warn-text' : 'text-ink-3'}`}>{s.unmarked}</td>
                {isOwner && <td className="pr-4 text-right tabular-nums text-ink sm:pr-6">{s.payPaise === null ? '—' : formatINR(s.payPaise)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-[12px] text-ink-3 sm:px-6">
        Worked = present days + half days × ½.{isOwner && ' Estimated pay = days worked × daily wage (set on the Staff tab).'} Tap a day to change it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff list
// ---------------------------------------------------------------------------

function StaffList({ isOwner, onAdd }: { isOwner: boolean; onAdd: () => void }) {
  const toast = useToast();
  const list = useAsync(() => staffApi.list(), []);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [removing, setRemoving] = useState<Employee | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  if (!list.data) return list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <LoadingState label="Loading staff…" />;
  if (!list.data.length) {
    return (
      <EmptyState
        title="No staff yet"
        description={isOwner ? 'Add the people who work here. They don’t need a login.' : 'An owner can add staff here.'}
        action={
          isOwner && (
            <Button onClick={onAdd}>
              <Plus size={14} /> Add staff
            </Button>
          )
        }
      />
    );
  }

  const toggle = async (e: Employee) => {
    setBusy(e.id);
    try {
      await staffApi.setActive(e.id, !e.active);
      toast('success', e.active ? `${e.name} marked as left` : `${e.name} is back on the register`);
      list.reload();
    } catch (err) {
      toast('error', errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const active = list.data.filter((e) => e.active);
  const left = list.data.filter((e) => !e.active);
  const rows = (people: Employee[]) => (
    <ul className="divide-y divide-line">
      {people.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] text-ink">
              {e.name} {!e.active && <Pill tone="gray">Left</Pill>}
            </p>
            <p className="truncate text-[12.5px] text-ink-3">
              {[e.jobTitle, e.phone, e.joinedOn && `Joined ${formatDate(e.joinedOn)}`].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          {isOwner && <span className="text-[13px] tabular-nums text-ink-2">{e.dailyWagePaise === null ? 'No wage set' : `${formatINR(e.dailyWagePaise)} / day`}</span>}
          {isOwner && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                <Pencil size={13} /> Edit
              </Button>
              <Button size="sm" variant="ghost" loading={busy === e.id} onClick={() => toggle(e)}>
                {e.active ? <UserX size={13} /> : <UserCheck size={13} />} {e.active ? 'Mark as left' : 'Bring back'}
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove ${e.name}`} onClick={() => setRemoving(e)}>
                <Trash2 size={13} />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {rows(active)}
      {left.length > 0 && (
        <>
          <SectionHeader title={`Left (${left.length})`} />
          {rows(left)}
        </>
      )}
      <EmployeeModal
        open={!!editing}
        employee={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          list.reload();
        }}
      />
      <ConfirmDialog
        open={!!removing}
        danger
        title={`Remove ${removing?.name ?? ''}?`}
        message="This deletes them and all their attendance. To keep their history, use “Mark as left” instead."
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await staffApi.remove(removing.id);
            toast('success', `${removing.name} removed`);
            setRemoving(null);
            list.reload();
          } catch (err) {
            toast('error', errorText(err));
          }
        }}
      />
    </>
  );
}

function EmployeeModal({ open, employee, onClose, onSaved }: { open: boolean; employee: Employee | null; onClose: () => void; onSaved: (e: Employee) => void }) {
  const toast = useToast();
  const blank: EmployeePayload = { name: '', phone: '', jobTitle: '', dailyWage: '', joinedOn: '' };
  const [form, setForm] = useState<EmployeePayload>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setErrors({});
      setForm(
        employee
          ? {
              name: employee.name,
              phone: employee.phone ?? '',
              jobTitle: employee.jobTitle ?? '',
              dailyWage: employee.dailyWagePaise === null ? '' : paiseToInput(employee.dailyWagePaise),
              joinedOn: employee.joinedOn ?? '',
            }
          : blank,
      );
    }
  }
  const set = (k: keyof EmployeePayload) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) return setErrors({ name: 'Name is required' });
    setBusy(true);
    setErrors({});
    try {
      const saved = employee ? await staffApi.update(employee.id, form) : await staffApi.create(form);
      toast('success', employee ? 'Saved' : `${saved.name} added`);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={employee ? `Edit ${employee.name}` : 'Add staff'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {employee ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label="Name" required value={form.name} maxLength={80} onChange={set('name')} error={errors.name} autoFocus />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <TextField label="Role" placeholder="e.g. Cook, Waiter" value={form.jobTitle} maxLength={60} onChange={set('jobTitle')} error={errors.jobTitle} />
          <TextField label="Mobile" type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} />
          <TextField
            label="Daily wage (₹)"
            inputMode="decimal"
            value={form.dailyWage}
            onChange={set('dailyWage')}
            error={errors.dailyWage}
            hint="Optional. Used to estimate pay for the month."
          />
          <TextField label="Joined on" type="date" value={form.joinedOn} max={todayIST()} onChange={set('joinedOn')} error={errors.joinedOn} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
