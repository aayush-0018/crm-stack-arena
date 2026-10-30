import type { Paged } from '../types';

/** Every row matching a list's filters, fetched page by page (the API caps a page at 100), so exports aren't cut off at the visible page. */
export async function fetchAllPages<T>(fetchPage: (page: number, pageSize: number) => Promise<Paged<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchPage(page, 100);
    rows.push(...res.data);
    if (!res.data.length || rows.length >= res.total) return rows;
  }
}

/** Builds a CSV from rows and downloads it. Runs entirely in the browser. */
export function downloadCsv<T>(filename: string, rows: T[], columns: { header: string; value: (row: T) => string | number | null | undefined }[]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map((c) => esc(c.header)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const rupees = (paise: number | undefined) => (paise === undefined ? '' : (paise / 100).toFixed(2));

/** Parses CSV text: quoted fields, "" escapes, commas or line breaks inside quotes, CRLF and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (s[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

export interface ImportColumn {
  key: string;
  header: string;
  aliases?: string[];
  required?: boolean;
}

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The CSV's rows keyed by field name, matching headers loosely ("Low stock at", "low_stock_at" …).
 * Unknown columns are ignored and blank lines skipped; rowNumbers[i] is rows[i]'s row in the sheet (header = 1).
 */
export function readImportRows(text: string, columns: ImportColumn[]) {
  const [header = [], ...body] = parseCsv(text);
  const keyByHeader = new Map<string, string>();
  for (const c of columns) for (const name of [c.header, c.key, ...(c.aliases ?? [])]) keyByHeader.set(normHeader(name), c.key);
  const keys = header.map((h) => keyByHeader.get(normHeader(h)) ?? null);
  const missing = columns.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.header);
  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  body.forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return;
    const r: Record<string, string> = {};
    keys.forEach((k, j) => {
      if (k && !(k in r)) r[k] = (cells[j] ?? '').trim();
    });
    rows.push(r);
    rowNumbers.push(i + 2);
  });
  return { rows, rowNumbers, missing };
}
