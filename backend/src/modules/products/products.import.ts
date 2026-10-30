import { z } from 'zod';
import { importId, RowError, runImport } from '../../lib/importRows';
import * as repo from './products.repo';
import { createProductSchema, PRODUCT_UNITS } from './products.schemas';

const yesNo = z
  .union([z.boolean(), z.string(), z.undefined(), z.null()])
  .transform((v, ctx) => {
    if (typeof v === 'boolean') return v;
    const s = (v ?? '').trim().toLowerCase();
    if (!s || ['yes', 'y', 'true', '1'].includes(s)) return true;
    if (['no', 'n', 'false', '0'].includes(s)) return false;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use yes or no' });
    return z.NEVER;
  });

const unitCell = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => (v ?? '').trim().toLowerCase() || 'pcs')
  .pipe(z.enum(PRODUCT_UNITS, { errorMap: () => ({ message: `Unit must be one of: ${PRODUCT_UNITS.join(', ')}` }) }));

export const productImportRow = createProductSchema.extend({ id: importId, unit: unitCell, trackStock: yesNo });

/**
 * Products from a CSV. A row with the ID of one of this shop's products updates it; a row without an ID
 * creates one (with its opening stock). Stock of existing products is never changed by an import.
 */
export function importProducts(shopId: number, userId: number, rows: Record<string, unknown>[], dryRun: boolean) {
  const seenIds = new Map<number, string>();
  return runImport(rows, dryRun, async (c, raw) => {
    const { id, openingStock, ...input } = productImportRow.parse(raw);
    const existing = id ? await repo.findProduct(c, shopId, id) : null;
    if (id) {
      if (seenIds.has(id)) throw new RowError({ id: `ID ${id} is already used by ${seenIds.get(id)} in this file` });
      if (!existing) throw new RowError({ id: `No product with ID ${id} in this shop` });
    }
    // Names and SKUs are unique among active products (archived ones may repeat them).
    if (!existing || existing.active) {
      const { rows: clash } = await c.query(
        `SELECT id, lower(name) = lower($3) AS "sameName" FROM products
         WHERE shop_id = $1 AND active AND id <> $2 AND (lower(name) = lower($3) OR ($4::text IS NOT NULL AND lower(sku) = lower($4)))
         LIMIT 1`,
        [shopId, id ?? 0, input.name, input.sku],
      );
      if (clash[0]?.sameName) throw new RowError({ name: `Product ID ${clash[0].id} already has this name` });
      if (clash[0]) throw new RowError({ sku: `Product ID ${clash[0].id} already uses this SKU` });
    }

    if (id) {
      await repo.updateProduct(c, shopId, id, input);
      seenIds.set(id, input.name);
      return {
        action: 'update',
        id,
        name: input.name,
        note: openingStock ? 'Opening stock ignored for an existing product. Use "Update stock" on its page.' : undefined,
      };
    }
    const pid = await repo.insertProduct(c, shopId, input);
    if (openingStock && input.trackStock) {
      await repo.insertMovement(c, { shopId, productId: pid, kind: 'opening', qtyMilli: openingStock, userId });
    }
    return { action: 'create', id: pid, name: input.name };
  });
}
