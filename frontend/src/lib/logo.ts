import { apiOrigin } from '../api/client';

export const logoUrl = (key: string | null | undefined) => (key ? `${apiOrigin()}/api/public/logos/${key}` : null);

const MAX_BYTES = 400_000;

/**
 * Turns any image the browser can open (PNG, JPG, WebP, SVG…) into a PNG of at most 512px,
 * keeping transparency. PDFs can only embed PNG/JPEG, and this keeps uploads small.
 */
export async function imageFileToPng(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > 10_000_000) throw new Error('That image is too large (max 10 MB)');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image"));
      el.src = url;
    });
    for (const max of [512, 384, 256, 192]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const w = Math.max(1, Math.round((img.naturalWidth || max) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || max) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Couldn't process that image");
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/png');
      if (Math.ceil(((dataUrl.length - 22) * 3) / 4) <= MAX_BYTES) return dataUrl;
    }
    throw new Error('That logo is too detailed to store — try a simpler or smaller image');
  } finally {
    URL.revokeObjectURL(url);
  }
}
