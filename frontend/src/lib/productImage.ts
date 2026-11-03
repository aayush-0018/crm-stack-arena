import { apiOrigin } from '../api/client';

export const productImageUrl = (key: string | null | undefined) => (key ? `${apiOrigin()}/api/public/product-images/${key}` : null);

const MAX_BYTES = 400_000;

/**
 * Turns any photo the browser can open into a JPEG of at most 900px on its longest side (on white,
 * so transparent PNGs don't go black), small enough to upload and quick to load on a phone.
 */
export async function imageFileToPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > 15_000_000) throw new Error('That image is too large (max 15 MB)');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image"));
      el.src = url;
    });
    for (const [max, quality] of [
      [900, 0.82],
      [720, 0.78],
      [560, 0.72],
      [420, 0.68],
    ] as const) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const w = Math.max(1, Math.round((img.naturalWidth || max) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || max) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Couldn't process that image");
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (Math.ceil(((dataUrl.length - 23) * 3) / 4) <= MAX_BYTES) return dataUrl;
    }
    throw new Error('That image is too detailed to store. Try a smaller one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
