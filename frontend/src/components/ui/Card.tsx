import { ReactNode } from 'react';

/** Bordered white block, used for forms and side panels inside the page panel. */
export default function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2">
          {title && <h2 className="text-[15px] font-medium text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Section heading row used inside the panel (matches the table toolbar height). */
export function SectionHeader({ title, actions, className = '' }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`flex h-12 items-center justify-between gap-3 border-b border-line px-4 sm:px-6 ${className}`}>
      <h2 className="text-[15px] font-medium text-ink">{title}</h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
