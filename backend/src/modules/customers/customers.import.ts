import { importId, RowError, runImport } from '../../lib/importRows';
import * as repo from './customers.repo';
import { customerInput } from './customers.schemas';

export const customerImportRow = customerInput.extend({ id: importId });

/**
 * Customers from a CSV. A row with the ID of one of this shop's customers updates that customer;
 * a row without an ID creates a new one. Phones stay unique, including between rows of the same file.
 */
export function importCustomers(shopId: number, rows: Record<string, unknown>[], dryRun: boolean) {
  const seenIds = new Map<number, string>();
  return runImport(rows, dryRun, async (c, raw) => {
    const { id, ...input } = customerImportRow.parse(raw);
    if (id) {
      if (seenIds.has(id)) throw new RowError({ id: `ID ${id} is already used by ${seenIds.get(id)} in this file` });
      if (!(await repo.findCustomer(c, shopId, id))) throw new RowError({ id: `No customer with ID ${id} in this shop` });
    }
    const taken = await repo.findActiveByPhone(c, shopId, input.phone, id ?? undefined);
    if (taken) throw new RowError({ phone: `This phone is already used by customer ID ${taken}` });

    if (id) {
      await repo.updateCustomer(c, shopId, id, input);
      seenIds.set(id, input.name);
      return { action: 'update', id, name: input.name };
    }
    const created = await repo.insertCustomer(c, shopId, input);
    return { action: 'create', id: created.id, name: input.name };
  });
}
