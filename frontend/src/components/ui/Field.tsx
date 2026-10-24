import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useId } from 'react';

export const controlClass = (invalid?: boolean, extra = '') =>
  `block w-full rounded-lg border bg-white px-3 text-[14px] text-ink placeholder:text-ink-4 shadow-soft transition focus:outline-none focus:ring-[3px] ${
    invalid ? 'border-[#e5a59e] focus:ring-[#b42318]/10' : 'border-line focus:border-ink-4 focus:ring-ink/5'
  } ${extra}`;

interface WrapProps {
  label?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
}

function Wrap({ id, label, error, hint, required, className = '', children }: WrapProps & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
          {label}
          {required && <span className="text-ink-3"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-[12px] text-[#b42318]">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>
      )}
    </div>
  );
}

export function TextField({ label, error, hint, required, className, ...rest }: WrapProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className={controlClass(!!error, 'h-9')}
        {...rest}
      />
    </Wrap>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  required,
  className,
  ...rest
}: WrapProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <textarea id={id} aria-invalid={!!error} rows={3} className={controlClass(!!error, 'py-2')} {...rest} />
    </Wrap>
  );
}

export function SelectField({
  label,
  error,
  hint,
  required,
  className,
  children,
  ...rest
}: WrapProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <select id={id} aria-invalid={!!error} className={controlClass(!!error, 'h-9 pr-8')} {...rest}>
        {children}
      </select>
    </Wrap>
  );
}
