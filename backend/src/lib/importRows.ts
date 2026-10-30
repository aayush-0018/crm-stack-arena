import { PoolClient } from 'pg';
import { z, ZodError } from 'zod';
import { withTransaction } from '../db/tx';
import { AppError } from './errors';

export const MAX_IMPORT_ROWS = 1000;

const importBody = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'The file has no rows to import')
    .max(MAX_IMPORT_ROWS, `Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows at a time`),
  dryRun: z.boolean().default(true),
});

/** The request body of an import: the file's rows (already read from CSV by the browser) and whether this is a preview. */
export function parseImportBody(body: unknown) {
  const r = importBody.safeParse(body);
  if (!r.success) throw new AppError(400, 'IMPORT_INVALID', r.error.issues[0].message);
  return r.data;
}

/** An optional ID column: blank means a new record, a number means update that record. */
export const importId = z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v, ctx) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (!s) return null;
  if (!/^\d{1,15}$/.test(s) || Number(s) < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ID must be a whole number, or blank for a new record' });
    return z.NEVER;
  }
  return Number(s);
});

export interface ImportRowResult {
  /** Line in the file (the header is line 1). */
  row: number;
  action: 'create' | 'update' | 'error';
  id?: number;
  name?: string;
  errors?: Record<string, string>;
  note?: string;
}

export interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}

/** Thrown by a row handler to reject that row with field messages. */
export class RowError extends Error {
  constructor(public errors: Record<string, string>) {
    super('Row rejected');
  }
}

class DryRunDone {
  constructor(public result: ImportResult) {}
}

const fieldErrors = (err: ZodError) => {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
};

const nameOf = (raw: Record<string, unknown>) => (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : undefined);

/**
 * Runs every row through `apply` in one transaction, each behind a savepoint, so a rejected row is skipped
 * without undoing the others. A dry run does exactly the same work and then rolls everything back, so the
 * preview always matches what the real import will do.
 */
export async function runImport(
  rows: Record<string, unknown>[],
  dryRun: boolean,
  apply: (c: PoolClient, raw: Record<string, unknown>) => Promise<Omit<ImportRowResult, 'row'>>,
): Promise<ImportResult> {
  const run = async (c: PoolClient): Promise<ImportResult> => {
    const results: ImportRowResult[] = [];
    for (const [i, raw] of rows.entries()) {
      const row = i + 2;
      await c.query('SAVEPOINT import_row');
      try {
        const r = await apply(c, raw);
        await c.query('RELEASE SAVEPOINT import_row');
        // A new record's ID only exists once the import is saved for real.
        results.push({ row, ...r, id: dryRun && r.action === 'create' ? undefined : r.id });
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT import_row');
        if (err instanceof ZodError) results.push({ row, action: 'error', name: nameOf(raw), errors: fieldErrors(err) });
        else if (err instanceof RowError) results.push({ row, action: 'error', name: nameOf(raw), errors: err.errors });
        else throw err;
      }
    }
    const count = (a: ImportRowResult['action']) => results.filter((r) => r.action === a).length;
    return { dryRun, created: count('create'), updated: count('update'), failed: count('error'), rows: results };
  };

  if (!dryRun) return withTransaction(run);
  try {
    await withTransaction(async (c) => {
      throw new DryRunDone(await run(c));
    });
  } catch (e) {
    if (e instanceof DryRunDone) return e.result;
    throw e;
  }
  throw new Error('Dry run finished without a result');
}
