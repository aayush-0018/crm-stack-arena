import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code as a crisp PNG (rendered at 2× for print). */
export function useQrDataUrl(text: string, size = 220) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } })
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [text, size]);
  return url;
}

export default function QrImage({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const url = useQrDataUrl(text, size);
  return url ? (
    <img src={url} width={size} height={size} alt={label} className="block" style={{ width: size, height: size, imageRendering: 'pixelated' }} />
  ) : (
    <span className="block animate-pulse rounded bg-hover" style={{ width: size, height: size }} />
  );
}
