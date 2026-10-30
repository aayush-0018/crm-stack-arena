import { Check, Minus } from 'lucide-react';

export default function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 ${
        on ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-surface hover:border-ink-4'
      }`}
    >
      {indeterminate ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
    </button>
  );
}
