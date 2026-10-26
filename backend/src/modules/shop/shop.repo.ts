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
  code: string | null;
  logoKey: string | null;
}

export const SHOP_COLS = `id, name, phone, email,
  address_line1 AS "addressLine1", address_line2 AS "addressLine2",
  city, state, pincode, gstin, code, logo_key AS "logoKey"`;

export async function findShop(db: Db, shopId: number): Promise<Shop | null> {
  const { rows } = await db.query(`SELECT ${SHOP_COLS} FROM shops WHERE id = $1`, [shopId]);
  return rows[0] ?? null;
}

export interface Branch {
  id: number;
  name: string;
  code: string | null;
  city: string | null;
  logoKey: string | null;
  role: 'owner' | 'staff';
}

/** Branches this user may open, oldest first. */
export async function listBranches(db: Db, userId: number): Promise<Branch[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.code, s.city, s.logo_key AS "logoKey", m.role
     FROM shop_members m JOIN shops s ON s.id = m.shop_id
     WHERE m.user_id = $1 ORDER BY m.created_at, s.id`,
    [userId],
  );
  return rows;
}

export async function membershipRole(db: Db, userId: number, shopId: number): Promise<'owner' | 'staff' | null> {
  const { rows } = await db.query(`SELECT role FROM shop_members WHERE user_id = $1 AND shop_id = $2`, [userId, shopId]);
  return rows[0]?.role ?? null;
}

/** Codes must be unique across one user's branches, or their invoice numbers could clash. */
export async function codeTakenByOtherBranch(db: Db, userId: number, code: string, exceptShopId?: number) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM shop_members m JOIN shops s ON s.id = m.shop_id
     WHERE m.user_id = $1 AND s.code = $2 AND ($3::bigint IS NULL OR s.id <> $3)`,
    [userId, code, exceptShopId ?? null],
  );
  return (rowCount ?? 0) > 0;
}
