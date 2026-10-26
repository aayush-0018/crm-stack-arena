import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { imageFileToPng } from '../../lib/logo';
import Button from './Button';
import ShopLogo from './ShopLogo';

/**
 * Pick / replace / remove a logo. `preview` is a local data URL (not yet saved) or null;
 * `savedKey` is the logo already stored for the shop.
 */
export default function LogoPicker({
  savedKey,
  preview,
  onPick,
  onRemove,
  busy,
  error,
}: {
  savedKey?: string | null;
  preview: string | null;
  onPick: (pngDataUrl: string) => void;
  onRemove?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const has = !!preview || !!savedKey;

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-ink-2">Logo</p>
      <div className="flex items-center gap-3">
        {preview ? (
          <img src={preview} alt="New logo preview" className="h-14 w-14 shrink-0 rounded-[11px] border border-line bg-white object-contain" />
        ) : (
          <ShopLogo logoKey={savedKey} size={56} />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()} loading={busy}>
            <ImageUp size={14} /> {has ? 'Change logo' : 'Upload logo'}
          </Button>
          {has && onRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy} aria-label="Remove logo">
              <Trash2 size={14} /> Remove
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setLocalError(null);
            try {
              onPick(await imageFileToPng(file));
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : "Couldn't use that image");
            }
          }}
        />
      </div>
      {localError || error ? (
        <p className="mt-1.5 text-[12px] text-[#b42318]">{localError || error}</p>
      ) : (
        <p className="mt-1.5 text-[12px] text-ink-3">Shown in the menu, on invoices and on PDFs. PNG, JPG, WebP or SVG — resized automatically.</p>
      )}
    </div>
  );
}
