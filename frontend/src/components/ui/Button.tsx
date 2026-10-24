import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import Spinner from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-black',
  secondary: 'border border-line bg-white text-ink shadow-soft hover:bg-hover',
  danger: 'bg-[#b42318] text-white hover:bg-[#9a1f15]',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'h-9 px-3.5 text-[14px]',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra = '') =>
  `${base} ${variants[variant]} ${sizes[size]} ${extra}`;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});
export default Button;

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
