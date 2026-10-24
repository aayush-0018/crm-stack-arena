import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} aria-label={label} className="-ml-1.5 rounded-md p-1.5 text-ink-2 hover:bg-hover hover:text-ink">
      <ArrowLeft size={17} strokeWidth={1.75} />
    </Link>
  );
}
