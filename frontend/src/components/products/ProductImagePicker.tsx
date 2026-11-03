import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { productsApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { imageFileToPhoto } from '../../lib/productImage';
import type { ProductDetail } from '../../types';
import Button from '../ui/Button';
import ProductThumb from './ProductThumb';

/** Add, change or remove a product's photo. Saved straight away; shown in the catalogue and the table menu. */
export default function ProductImagePicker({ product, onChange }: { product: ProductDetail; onChange: (p: ProductDetail) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<ProductDetail>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      toast('success', done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <ProductThumb product={product} size={72} />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()} loading={busy}>
            <ImageUp size={14} /> {product.imageKey ? 'Change photo' : 'Add photo'}
          </Button>
          {product.imageKey && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => productsApi.removeImage(product.id), 'Photo removed')}>
              <Trash2 size={14} /> Remove
            </Button>
          )}
        </div>
        {error ? (
          <p className="mt-1.5 text-[12px] text-danger">{error}</p>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-3">Shown in your catalogue and on the table menu. JPG, PNG or WebP, resized automatically.</p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setError(null);
          let dataUrl: string;
          try {
            dataUrl = await imageFileToPhoto(file);
          } catch (err) {
            return setError(err instanceof Error ? err.message : "Couldn't use that image");
          }
          run(() => productsApi.uploadImage(product.id, dataUrl), 'Photo saved');
        }}
      />
    </div>
  );
}
