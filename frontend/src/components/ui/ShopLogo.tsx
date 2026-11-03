import { Store, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { logoUrl } from '../../lib/logo';

/** The logo full size over the page; a click anywhere or Escape closes it. */
function LogoZoom({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={alt} onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25">
        <X size={18} />
      </button>
      <img src={src} alt={alt} className="max-h-[80vh] w-[min(80vw,420px)] rounded-2xl bg-white object-contain p-4 shadow-2xl" />
    </div>
  );
}

/**
 * The shop's logo, or the default store mark when there isn't one (or it fails to load).
 * `zoom`: tapping the logo shows it big. Leave it off where the logo sits inside another button.
 */
export default function ShopLogo({ logoKey, name, size = 32, zoom }: { logoKey: string | null | undefined; name?: string; size?: number; zoom?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const src = logoUrl(logoKey);
  if (src && failed !== src) {
    const alt = name ? `${name} logo` : 'Shop logo';
    if (zoom) {
      return (
        <>
          <button type="button" onClick={() => setOpen(true)} aria-label={`Show ${alt} larger`} className="shrink-0 rounded-[9px] focus-visible:ring-2 focus-visible:ring-ink/30">
            <img
              src={src}
              alt={alt}
              width={size}
              height={size}
              onError={() => setFailed(src)}
              style={{ width: size, height: size }}
              className="cursor-zoom-in rounded-[9px] border border-line bg-white object-contain"
            />
          </button>
          {open && <LogoZoom src={src} alt={alt} onClose={() => setOpen(false)} />}
        </>
      );
    }
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
