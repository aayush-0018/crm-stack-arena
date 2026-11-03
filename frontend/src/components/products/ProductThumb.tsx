import { Package } from 'lucide-react';
import { useState } from 'react';
import { productImageUrl } from '../../lib/productImage';

/** The product's photo as a small square, or a plain package mark when it has none (or it fails to load). */
export default function ProductThumb({ product, size = 32 }: { product: { name: string; imageKey?: string | null }; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = productImageUrl(product.imageKey);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(src)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-md border border-line bg-white object-cover"
      />
    );
  }
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-md bg-wash-2 text-ink-4" aria-hidden="true">
      <Package size={Math.round(size / 2.2)} strokeWidth={1.6} />
    </span>
  );
}
