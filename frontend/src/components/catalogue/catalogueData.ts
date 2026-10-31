import type { CatalogueAddress, PublicCatalogue } from '../../types';

export type CatalogueProduct = PublicCatalogue['products'][number];
export interface CatalogueSection {
  id: string;
  name: string;
  products: CatalogueProduct[];
}

/** Products arrive sorted by category (uncategorised last); this keeps that order. */
export function groupByCategory(products: CatalogueProduct[]): CatalogueSection[] {
  const sections: CatalogueSection[] = [];
  for (const p of products) {
    const name = p.category?.trim() || 'Other items';
    let s = sections[sections.length - 1];
    if (!s || s.name.toLowerCase() !== name.toLowerCase()) {
      s = { id: `cat-${sections.length + 1}`, name, products: [] };
      sections.push(s);
    }
    s.products.push(p);
  }
  return sections;
}

export function addressLines(a: CatalogueAddress): string[] {
  const place = [a.city, a.state].filter(Boolean).join(', ');
  return [a.addressLine1, a.addressLine2, [place, a.pincode].filter(Boolean).join(' – ')].filter((l): l is string => !!l);
}

export const mapsUrl = (name: string, a: CatalogueAddress) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, ...addressLines(a)].join(', '))}`;

/** A WhatsApp-able Indian mobile (10 digits starting 6–9, optionally with 91/0 in front), or null. */
export function whatsappNumber(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `91${d}` : null;
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** "Basmati rice" -> "BR", "Ghee" -> "Gh". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '·';
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  return (words[0][0] + words[1][0]).toUpperCase();
}
