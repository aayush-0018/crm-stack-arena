import { Link } from 'react-router-dom';
import { BUSINESS, LEGAL_LINKS } from '../../lib/legal';
import ComplaintLink from './ComplaintLink';

/** Footer links to the legal pages. */
export default function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3 ${className}`}>
      <span>© {new Date().getFullYear()} {BUSINESS.brand}</span>
      {LEGAL_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="underline-offset-2 hover:text-ink hover:underline">
          {l.label}
        </Link>
      ))}
      <ComplaintLink />
    </nav>
  );
}
