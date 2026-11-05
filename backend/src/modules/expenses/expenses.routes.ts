import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { assertOwner } from '../../lib/guards';
import { moneyInput } from '../../lib/money';
import { todayIST } from '../../lib/numbering';
import { dateInput, idParam, optionalText } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { PAYMENT_METHODS } from '../payments/payments.schemas';

/** Money the branch spends. Anyone on the branch can add one; only an owner can change or remove it. */
export const expensesRouter = Router();

/** Offered in the app before a shop has its own; shops can type any other name. */
export const DEFAULT_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Stock purchase', 'Transport', 'Repairs', 'Tea & snacks', 'Other'];

const COLS = `e.id, to_char(e.spent_on, 'YYYY-MM-DD') AS "spentOn", e.category, e.amount_paise AS "amountPaise", e.method, e.note,
  u.name AS "createdByName", e.created_at AS "createdAt"`;

const expenseInput = z.object({
  spentOn: dateInput,
  category: z.string({ required_error: 'Choose a category' }).trim().min(1, 'Choose a category').max(40),
  amount: moneyInput.refine((p) => p > 0, 'Enter the amount').refine((p) => p <= 1_00_00_000_00, 'Amount is too large'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  note: optionalText(200),
});

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional() });

async function checkDate(spentOn: string) {
  if (spentOn > (await todayIST(pool))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The date can’t be in the future', { spentOn: 'The date can’t be in the future' });
  }
}

async function findExpense(shopId: number, id: number) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM expenses e LEFT JOIN users u ON u.id = e.created_by WHERE e.shop_id = $1 AND e.id = $2`, [shopId, id]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  return rows[0];
}

/** One month's expenses, with totals by category and the month's sales to compare against. */
expensesRouter.get(
  '/',
  ah(async (req, res) => {
    const { shopId } = auth(req);
    const today = await todayIST(pool);
    const month = monthQuery.parse(req.query).month ?? today.slice(0, 7);
    const start = `${month}-01`;
    const range = `$2::date AND ($2::date + interval '1 month' - interval '1 day')::date`;

    const { rows } = await pool.query(
      `SELECT ${COLS} FROM expenses e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.shop_id = $1 AND e.spent_on BETWEEN ${range}
       ORDER BY e.spent_on DESC, e.id DESC`,
      [shopId, start],
    );
    const { rows: sales } = await pool.query(
      `SELECT COALESCE(sum(total_paise), 0)::bigint AS "salesPaise" FROM orders
       WHERE shop_id = $1 AND status <> 'cancelled' AND order_date BETWEEN ${range}`,
      [shopId, start],
    );
    const { rows: used } = await pool.query(
      `SELECT category FROM expenses WHERE shop_id = $1 GROUP BY category ORDER BY count(*) DESC, category LIMIT 30`,
      [shopId],
    );

    const byCat = new Map<string, { category: string; totalPaise: number; count: number }>();
    for (const r of rows) {
      const c = byCat.get(r.category) ?? { category: r.category, totalPaise: 0, count: 0 };
      c.totalPaise += r.amountPaise;
      c.count += 1;
      byCat.set(r.category, c);
    }
    const totalPaise = rows.reduce((s, r) => s + r.amountPaise, 0);
    const seen = new Set(used.map((u) => u.category.toLowerCase()));
    res.json({
      month,
      today,
      rows,
      totalPaise,
      salesPaise: sales[0].salesPaise,
      byCategory: [...byCat.values()].sort((a, b) => b.totalPaise - a.totalPaise),
      categories: [...used.map((u) => u.category as string), ...DEFAULT_CATEGORIES.filter((c) => !seen.has(c.toLowerCase()))],
    });
  }),
);

expensesRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const b = expenseInput.parse(req.body);
    await checkDate(b.spentOn);
    const { rows } = await pool.query(
      `INSERT INTO expenses (shop_id, spent_on, category, amount_paise, method, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [shopId, b.spentOn, b.category, b.amount, b.method, b.note, userId],
    );
    res.status(201).json(await findExpense(shopId, rows[0].id));
  }),
);

expensesRouter.put(
  '/:id',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'edit expenses');
    const { id } = idParam.parse(req.params);
    const b = expenseInput.parse(req.body);
    await findExpense(shopId, id);
    await checkDate(b.spentOn);
    await pool.query(
      `UPDATE expenses SET spent_on = $3, category = $4, amount_paise = $5, method = $6, note = $7, updated_at = now() WHERE shop_id = $1 AND id = $2`,
      [shopId, id, b.spentOn, b.category, b.amount, b.method, b.note],
    );
    res.json(await findExpense(shopId, id));
  }),
);

expensesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'delete expenses');
    const { id } = idParam.parse(req.params);
    await findExpense(shopId, id);
    await pool.query(`DELETE FROM expenses WHERE shop_id = $1 AND id = $2`, [shopId, id]);
    res.status(204).end();
  }),
);
