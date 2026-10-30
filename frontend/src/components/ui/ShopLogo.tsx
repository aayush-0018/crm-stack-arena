import { Store } from 'lucide-react';
import { useState } from 'react';
import { logoUrl } from '../../lib/logo';

/** The shop's logo, or the default store mark when there isn't one (or it fails to load). */
export default function ShopLogo({ logoKey, name, size = 32 }: { logoKey: string | null | undefined; name?: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = logoUrl(logoKey);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={name ? `${name} logo` : 'Shop logo'}
        width={size}
        height={size}
        onError={() => setFailed(src)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[9px] border border-line bg-white object-contain"
      />
    );
  }
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-[9px] bg-ink text-on-ink" aria-hidden="true">
      <Store size={Math.round(size / 2)} strokeWidth={1.8} />
    </span>
  );
}
