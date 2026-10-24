import { ReactNode } from 'react';

/** Icon + label + value rows, as in the contact preview card. */
export default function InfoRows({ rows }: { rows: { icon: ReactNode; label: string; value: ReactNode }[] }) {
  return (
    <dl>
      {rows.map((r) => (
        <div key={r.label} className="flex min-h-[36px] items-center gap-2 py-1 text-[14px]">
          <dt className="flex w-32 shrink-0 items-center gap-2.5 text-ink-2">
            <span className="text-ink-3">{r.icon}</span>
            {r.label}
          </dt>
          <dd className="min-w-0 truncate text-ink" title={typeof r.value === 'string' ? r.value : undefined}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
