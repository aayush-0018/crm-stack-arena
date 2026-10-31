import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { bookingApi } from '../../api/endpoints';
import type { BookingFloor } from '../../types';
import FloorCanvas from '../tables/FloorCanvas';
import { usePolling } from '../tables/dinein';
import Spinner from '../ui/Spinner';

type Table = BookingFloor['tables'][number];

const TONE: Record<Table['state'] | 'picked', string> = {
  picked: 'border-[#1f1b16] bg-[#1f1b16] text-white',
  free: 'border-[#7fb77e] bg-[#e9f3e8] text-[#24572a]',
  booked: 'border-[#e6dfd2] bg-[#efebe4] text-[#b7ad9c]',
  small: 'border-[#ece6da] bg-white text-[#cfc6b6]',
};

const LEGEND: [keyof typeof TONE, string][] = [
  ['free', 'Free'],
  ['picked', 'Your table'],
  ['booked', 'Booked'],
  ['small', 'Too small'],
];

/**
 * The café's floor plan for the chosen time. Free tables (big enough for the party) can be tapped;
 * the rest show as booked or too small. Refreshes every 10 seconds, so a table someone else just
 * booked turns grey (and is unpicked, with a note) while the guest is still deciding.
 */
export default function TablePicker({
  token,
  date,
  time,
  party,
  value,
  onChange,
}: {
  token: string;
  date: string;
  time: string;
  party: number;
  value: number | null;
  onChange: (table: { id: number; label: string } | null) => void;
}) {
  const [floors, setFloors] = useState<BookingFloor[] | null>(null);
  const [floorIdx, setFloorIdx] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    bookingApi.floor(token, date, time, party).then(
      (f) => {
        setFloors(f);
        if (value === null) return;
        const picked = f.flatMap((x) => x.tables).find((t) => t.id === value);
        if (picked?.state !== 'free') {
          onChange(null);
          setNotice(picked ? `${picked.label} was just booked by someone else. Please pick another table.` : 'Your table is no longer available. Please pick another.');
        }
      },
      () => setFloors((cur) => cur ?? []),
    );
  }, [token, date, time, party, value, onChange]);

  // Right away when the time or party changes, then every 10 seconds.
  useEffect(() => {
    setNotice(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, date, time, party]);
  usePolling(load, 10_000);

  if (!floors) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (!floors.length) return <p className="mt-3 text-[14px] text-[#5e574c]">We'll give you the best free table.</p>;

  const floor = floors[Math.min(floorIdx, floors.length - 1)];
  const freeCount = floors.reduce((n, f) => n + f.tables.filter((t) => t.state === 'free').length, 0);

  return (
    <div className="mt-3 space-y-3">
      {floors.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Floors">
          {floors.map((f, i) => {
            const free = f.tables.filter((t) => t.state === 'free').length;
            const hasPick = f.tables.some((t) => t.id === value);
            return (
              <button
                key={f.name}
                type="button"
                role="tab"
                aria-selected={f === floor}
                onClick={() => setFloorIdx(i)}
                className={`h-9 shrink-0 rounded-xl border px-3 text-[13.5px] ${f === floor ? 'border-[#1f1b16] bg-[#1f1b16] text-white' : 'border-[#e6dfd2] bg-white'}`}
              >
                {hasPick && '● '}
                {f.name} <span className={f === floor ? 'text-white/70' : 'text-[#8a8276]'}>· {free} free</span>
              </button>
            );
          })}
        </div>
      )}

      {notice && <p className="rounded-xl bg-[#fdf3e2] px-3.5 py-2.5 text-[13.5px] text-[#8a5a0a]">{notice}</p>}

      <FloorCanvas
        width={floor.width}
        height={floor.height}
        decor={floor.decor}
        tables={floor.tables}
        selected={null}
        tableTone={(t) => TONE[(t as Table).id === value ? 'picked' : (t as Table).state]}
        tableBadge={(t) => ((t as Table).state === 'booked' && (t as Table).id !== value ? <span className="mt-0.5 text-[9px] font-medium uppercase leading-none tracking-wide">Booked</span> : null)}
        onTableClick={(t) => {
          const table = t as Table;
          if (table.state === 'free') {
            setNotice(null);
            onChange(table.id === value ? null : { id: table.id, label: table.label });
          } else setNotice(table.state === 'booked' ? `${table.label} is booked at this time.` : `${table.label} seats ${table.seats}, too small for ${party}.`);
        }}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#8a8276]">
        {LEGEND.map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[4px] border ${TONE[k]}`} /> {label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1">
          <RefreshCw size={11} /> Live
        </span>
      </div>
      <p className="text-[13px] text-[#5e574c]">
        {value === null
          ? freeCount
            ? `Tap a green table to choose it, or skip and we'll give you the best one.`
            : 'No table is free at this time. Please pick another time.'
          : `Table ${floors.flatMap((f) => f.tables).find((t) => t.id === value)?.label} is yours if you confirm. Tap it again to unpick.`}
      </p>
    </div>
  );
}
