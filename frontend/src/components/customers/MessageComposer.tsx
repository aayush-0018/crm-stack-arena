import { Maximize2, Send } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatINR } from '../../lib/money';
import Button from '../ui/Button';

/**
 * Writes a message and opens it in WhatsApp (click-to-chat) from the owner's own account.
 * Nothing is sent by this app; the browser just opens wa.me with the text filled in.
 */
export default function MessageComposer({
  name,
  phone,
  duePaise = 0,
  autoFocus,
  compact,
}: {
  name: string;
  phone: string;
  duePaise?: number;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { shop } = useAuth();
  const [text, setText] = useState('');
  const first = name.split(' ')[0];
  const shopName = shop?.name ?? 'our shop';

  const templates = [
    ...(duePaise > 0
      ? [{ label: 'Payment reminder', text: `Namaste ${first} ji, a gentle reminder that ${formatINR(duePaise)} is pending at ${shopName}. Thank you!` }]
      : []),
    { label: 'Thank you', text: `Namaste ${first} ji, thank you for shopping at ${shopName}! See you again soon.` },
    { label: 'Fresh stock', text: `Namaste ${first} ji, fresh stock has arrived at ${shopName}. Reply with your list and we'll keep it ready.` },
    { label: 'We miss you', text: `Namaste ${first} ji, it's been a while! Drop by ${shopName} — we'd love to see you.` },
  ];

  const open = () => {
    const url = `https://wa.me/91${phone}?text=${encodeURIComponent(text.trim())}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="rounded-xl border border-line bg-white shadow-soft">
      <div className="relative">
        <textarea
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message"
          rows={compact ? 3 : 4}
          className="block w-full resize-none rounded-t-xl bg-transparent px-3.5 pb-2 pt-3 text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <Maximize2 size={14} className="pointer-events-none absolute right-3 top-3.5 text-ink-4" aria-hidden="true" />
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <span className="text-[12px] text-ink-3">Opens in WhatsApp</span>
        <Button size="sm" onClick={open} disabled={!text.trim()}>
          <Send size={13} />
          Send
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2.5">
        {templates.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setText(t.text)}
            className="h-7 rounded-md border border-line bg-white px-2.5 text-[13px] text-ink hover:bg-hover"
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
