import { pool } from '../db/pool';
import { membershipRole } from '../modules/shop/shop.repo';
import { AppError } from './errors';

/** Destructive or branding actions are for owners of the current branch only. */
export async function assertOwner(userId: number, shopId: number, action = 'do this') {
  if ((await membershipRole(pool, userId, shopId)) !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', `Only an owner can ${action}`);
  }
}
