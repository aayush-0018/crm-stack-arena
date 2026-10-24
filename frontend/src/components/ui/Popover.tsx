import { ReactNode, useEffect, useRef, useState } from 'react';

/** Click-to-open dropdown. Closes on outside click and Escape. */
export default function Popover({
  trigger,
  children,
  align = 'start',
  width = 240,
  placement = 'bottom',
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
  placement?: 'bottom' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          style={{ width }}
          className={`absolute z-40 rounded-xl border border-line bg-white p-1.5 shadow-pop ${align === 'end' ? 'right-0' : 'left-0'} ${
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-1.5'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  active,
  danger,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13.5px] hover:bg-hover ${
        danger ? 'text-[#b42318]' : 'text-ink'
      } ${active ? 'font-medium' : ''}`}
    >
      {icon && <span className="flex w-4 justify-center text-ink-2">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{children}</p>
);
