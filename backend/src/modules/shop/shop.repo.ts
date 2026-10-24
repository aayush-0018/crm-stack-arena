import { Db } from '../../db/pool';

export interface Shop {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
}

export const SHOP_COLS = `id, name, phone, email,
  address_line1 AS "addressLine1", address_line2 AS "addressLine2",
  city, state, pincode, gstin`;

export async function findShop(db: Db, shopId: number): Promise<Shop | null> {
  const { rows } = await db.query(`SELECT ${SHOP_COLS} FROM shops WHERE id = $1`, [shopId]);
  return rows[0] ?? null;
}
