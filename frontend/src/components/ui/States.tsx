import { ReactNode } from 'react';
import Button from './Button';
import Spinner from './Spinner';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-ink-3" role="status">
      <Spinner className="h-4 w-4" />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : error.message;
  return (
    <div className="px-6 py-14 text-center" role="alert">
      <p className="text-[15px] font-medium text-ink">Something went wrong</p>
      <p className="mt-1 text-[13px] text-ink-3">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'border-[#d6e2f5] bg-[#f3f7fd] text-[#28508f]',
    warning: 'border-[#f1dcb5] bg-[#fdf7ec] text-[#7a4c09]',
    error: 'border-[#f2cdc8] bg-[#fdf3f2] text-[#93291a]',
    success: 'border-[#d3e8cd] bg-[#f3f9f1] text-[#2a6a2d]',
  };
  return <div className={`rounded-lg border px-3.5 py-2.5 text-[13.5px] ${styles[tone]}`}>{children}</div>;
}
