import { Db } from '../../db/pool';

export const CATALOGUE_TEMPLATES = ['classic'] as const;
export type CatalogueTemplate = (typeof CATALOGUE_TEMPLATES)[number];

export interface CatalogueSettings {
  token: string | null;
  template: CatalogueTemplate;
  title: string | null;
  tagline: string | null;
  showPrices: boolean;
  hideOutOfStock: boolean;
  showBranches: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLS = `token, template, title, tagline, show_prices AS "showPrices", hide_out_of_stock AS "hideOutOfStock",
  show_branches AS "showBranches", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function findCatalogue(db: Db, shopId: number): Promise<CatalogueSettings | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM catalogues WHERE shop_id = $1`, [shopId]);
  return rows[0] ?? null;
}

/** Creates the branch's catalogue, or turns its link back on. An existing link is kept. */
export async function enableCatalogue(db: Db, shopId: number, userId: number, token: string): Promise<CatalogueSettings> {
  const { rows } = await db.query(
    `INSERT INTO catalogues (shop_id, token, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (shop_id) DO UPDATE SET token = COALESCE(catalogues.token, EXCLUDED.token), updated_at = now()
     RETURNING ${COLS}`,
    [shopId, token, userId],
  );
  return rows[0];
}

export async function updateCatalogue(
  db: Db,
  shopId: number,
  s: Pick<CatalogueSettings, 'template' | 'title' | 'tagline' | 'showPrices' | 'hideOutOfStock' | 'showBranches'>,
): Promise<CatalogueSettings | null> {
  const { rows } = await db.query(
    `UPDATE catalogues SET template = $2, title = $3, tagline = $4, show_prices = $5, hide_out_of_stock = $6,
       show_branches = $7, updated_at = now()
     WHERE shop_id = $1 RETURNING ${COLS}`,
    [shopId, s.template, s.title, s.tagline, s.showPrices, s.hideOutOfStock, s.showBranches],
  );
  return rows[0] ?? null;
}

/** A new token (reset) or NULL (link off). Either way every link handed out before stops working. */
export async function setToken(db: Db, shopId: number, token: string | null): Promise<CatalogueSettings | null> {
  const { rows } = await db.query(`UPDATE catalogues SET token = $2, updated_at = now() WHERE shop_id = $1 RETURNING ${COLS}`, [
    shopId,
    token,
  ]);
  return rows[0] ?? null;
}

export async function findByToken(db: Db, token: string): Promise<(CatalogueSettings & { shopId: number }) | null> {
  const { rows } = await db.query(`SELECT shop_id AS "shopId", ${COLS} FROM catalogues WHERE token = $1`, [token]);
  return rows[0] ?? null;
}

export interface CatalogueProduct {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  pricePaise: number;
  available: boolean;
}

/** Up to this many products are shown; a branch with more should split its catalogue later. */
export const CATALOGUE_MAX_PRODUCTS = 2000;

/** Active products by category (uncategorised last), then name. Never includes cost or stock levels. */
export async function catalogueProducts(db: Db, shopId: number, hideOutOfStock: boolean): Promise<CatalogueProduct[]> {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.sku, p.category, p.unit, p.price_paise AS "pricePaise",
       (NOT p.track_stock OR COALESCE(s.qty, 0) > 0) AS available
     FROM products p
     LEFT JOIN (SELECT product_id, sum(qty_milli) AS qty FROM stock_movements WHERE shop_id = $1 GROUP BY product_id) s
       ON s.product_id = p.id
     WHERE p.shop_id = $1 AND p.active
       AND ($2::boolean IS FALSE OR NOT p.track_stock OR COALESCE(s.qty, 0) > 0)
     ORDER BY p.category IS NULL, lower(p.category), lower(p.name), p.id
     LIMIT ${CATALOGUE_MAX_PRODUCTS}`,
    [shopId, hideOutOfStock],
  );
  return rows;
}

export interface CatalogueBranch {
  id: number;
  name: string;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

const BRANCH_COLS = `s.id, s.name, s.phone, s.address_line1 AS "addressLine1", s.address_line2 AS "addressLine2",
  s.city, s.state, s.pincode`;

/**
 * The other branches run by this branch's owners, oldest first. Staff memberships don't count, and
 * branches with no address, city or phone are left out (nothing to show a customer).
 */
export async function siblingBranches(db: Db, shopId: number): Promise<CatalogueBranch[]> {
  const { rows } = await db.query(
    `SELECT ${BRANCH_COLS} FROM shops s
     WHERE s.id <> $1
       AND s.id IN (
         SELECT b.shop_id FROM shop_members a JOIN shop_members b ON b.user_id = a.user_id AND b.role = 'owner'
         WHERE a.shop_id = $1 AND a.role = 'owner'
       )
       AND COALESCE(s.address_line1, s.address_line2, s.city, s.phone) IS NOT NULL
     ORDER BY s.created_at, s.id`,
    [shopId],
  );
  return rows;
}
