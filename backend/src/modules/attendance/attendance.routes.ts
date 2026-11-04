import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { assertOwner } from '../../lib/guards';
import { moneyInput } from '../../lib/money';
import { todayIST } from '../../lib/numbering';
import { normalisePhone } from '../../lib/phone';
import { dateInput, idParam, optionalText } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { membershipRole } from '../shop/shop.repo';

/** The staff register (owners add and edit people) and daily attendance (anyone on the branch marks it). */
export const staffRouter = Router();
export const attendanceRouter = Router();

export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent', 'leave', 'week_off'] as const;
type Status = (typeof ATTENDANCE_STATUSES)[number];

const EMP_COLS = `e.id, e.name, e.phone, e.job_title AS "jobTitle", e.daily_wage_paise AS "dailyWagePaise",
  to_char(e.joined_on, 'YYYY-MM-DD') AS "joinedOn", e.active, e.created_at AS "createdAt"`;

const optionalPhone = z
  .string()
  .nullish()
  .transform((v) => (v ? normalisePhone(v) : null))
  .refine((v) => v === null || /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

const employeeInput = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(80),
  phone: optionalPhone,
  jobTitle: optionalText(60),
  dailyWage: z
    .union([z.literal(''), z.null(), moneyInput])
    .optional()
    .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  joinedOn: z
    .union([z.literal(''), z.null(), dateInput])
    .optional()
    .transform((v) => (v ? v : null)),
});

/** Wages are for owners' eyes only. */
async function isOwner(userId: number, shopId: number) {
  return (await membershipRole(pool, userId, shopId)) === 'owner';
}
const hideWage = <T extends { dailyWagePaise: number | null }>(rows: T[], owner: boolean) => (owner ? rows : rows.map((r) => ({ ...r, dailyWagePaise: null })));

async function findEmployee(shopId: number, id: number) {
  const { rows } = await pool.query(`SELECT ${EMP_COLS} FROM employees e WHERE e.id = $1 AND e.shop_id = $2`, [id, shopId]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Staff member not found');
  return rows[0];
}

staffRouter.get(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const { rows } = await pool.query(`SELECT ${EMP_COLS} FROM employees e WHERE e.shop_id = $1 ORDER BY e.active DESC, lower(e.name), e.id`, [shopId]);
    res.json(hideWage(rows, await isOwner(userId, shopId)));
  }),
);

staffRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'add staff');
    const b = employeeInput.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO employees (shop_id, name, phone, job_title, daily_wage_paise, joined_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [shopId, b.name, b.phone, b.jobTitle, b.dailyWage, b.joinedOn],
    );
    res.status(201).json(await findEmployee(shopId, rows[0].id));
  }),
);

staffRouter.put(
  '/:id',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'edit staff');
    const { id } = idParam.parse(req.params);
    const b = employeeInput.parse(req.body);
    await findEmployee(shopId, id);
    await pool.query(
      `UPDATE employees SET name = $3, phone = $4, job_title = $5, daily_wage_paise = $6, joined_on = $7, updated_at = now() WHERE id = $1 AND shop_id = $2`,
      [id, shopId, b.name, b.phone, b.jobTitle, b.dailyWage, b.joinedOn],
    );
    res.json(await findEmployee(shopId, id));
  }),
);

/** Someone who has left: kept with their past attendance, but no longer listed for marking. */
staffRouter.patch(
  '/:id/active',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'change staff');
    const { id } = idParam.parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    await findEmployee(shopId, id);
    await pool.query(`UPDATE employees SET active = $3, updated_at = now() WHERE id = $1 AND shop_id = $2`, [id, shopId, active]);
    res.json(await findEmployee(shopId, id));
  }),
);

/** Removes the person and all their attendance. */
staffRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'remove staff');
    const { id } = idParam.parse(req.params);
    await findEmployee(shopId, id);
    await pool.query(`DELETE FROM employees WHERE id = $1 AND shop_id = $2`, [id, shopId]);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const MARK_COLS = `a.employee_id AS "employeeId", to_char(a.day, 'YYYY-MM-DD') AS date, a.status,
  to_char(a.check_in, 'HH24:MI') AS "checkIn", to_char(a.check_out, 'HH24:MI') AS "checkOut", a.note, a.updated_at AS "updatedAt"`;

const timeInput = z
  .union([z.literal(''), z.null(), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')])
  .optional()
  .transform((v) => (v ? v : null));

const markInput = z.object({
  employeeId: z.coerce.number().int().positive(),
  /** null clears the day's mark. */
  status: z.enum(ATTENDANCE_STATUSES).nullable(),
  checkIn: timeInput,
  checkOut: timeInput,
  note: optionalText(200),
});

const daySchema = z.object({
  date: dateInput,
  marks: z.array(markInput).min(1).max(500),
});

/** Everyone to list for a day: active staff, plus anyone who has left but was marked that day. */
async function daySheet(shopId: number, date: string, owner: boolean) {
  const { rows } = await pool.query(
    `SELECT ${EMP_COLS},
       CASE WHEN m."employeeId" IS NULL THEN NULL
         ELSE jsonb_build_object('status', m.status, 'checkIn', m."checkIn", 'checkOut', m."checkOut", 'note', m.note, 'updatedAt', m."updatedAt") END AS mark
     FROM employees e
     LEFT JOIN LATERAL (SELECT ${MARK_COLS} FROM attendance a WHERE a.employee_id = e.id AND a.day = $2::date) m ON true
     WHERE e.shop_id = $1 AND (e.active OR m."employeeId" IS NOT NULL)
     ORDER BY e.active DESC, lower(e.name), e.id`,
    [shopId, date],
  );
  const staff = hideWage(rows, owner);
  const counts = Object.fromEntries([...ATTENDANCE_STATUSES, 'unmarked'].map((s) => [s, 0])) as Record<Status | 'unmarked', number>;
  for (const s of staff) counts[(s.mark?.status as Status) ?? 'unmarked'] += 1;
  return { date, today: await todayIST(pool), staff, counts };
}

attendanceRouter.get(
  '/day',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const q = z.object({ date: dateInput.optional() }).parse(req.query);
    const date = q.date ?? (await todayIST(pool));
    res.json(await daySheet(shopId, date, await isOwner(userId, shopId)));
  }),
);

/** Saves marks for one day (one person or the whole team). A future day can't be marked. */
attendanceRouter.put(
  '/day',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const b = daySchema.parse(req.body);
    const today = await todayIST(pool);
    if (b.date > today) throw new AppError(400, 'VALIDATION_ERROR', "Attendance can't be marked for a future day", { date: "Attendance can't be marked for a future day" });
    for (const m of b.marks) {
      if (m.checkIn && m.checkOut && m.checkOut < m.checkIn) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Check-out is before check-in', { checkOut: 'Check-out is before check-in' });
      }
    }
    const ids = [...new Set(b.marks.map((m) => m.employeeId))];
    const { rows: found } = await pool.query(`SELECT id FROM employees WHERE shop_id = $1 AND id = ANY($2::bigint[])`, [shopId, ids]);
    if (found.length !== ids.length) throw new AppError(404, 'NOT_FOUND', 'Staff member not found');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const m of b.marks) {
        if (m.status === null) {
          await client.query(`DELETE FROM attendance WHERE employee_id = $1 AND day = $2::date`, [m.employeeId, b.date]);
          continue;
        }
        // Absent, leave and week off have no working hours.
        const worked = m.status === 'present' || m.status === 'half_day';
        await client.query(
          `INSERT INTO attendance (employee_id, shop_id, day, status, check_in, check_out, note, marked_by)
           VALUES ($1, $2, $3::date, $4, $5::time, $6::time, $7, $8)
           ON CONFLICT (employee_id, day) DO UPDATE SET status = EXCLUDED.status, check_in = EXCLUDED.check_in,
             check_out = EXCLUDED.check_out, note = EXCLUDED.note, marked_by = EXCLUDED.marked_by, updated_at = now()`,
          [m.employeeId, shopId, b.date, m.status, worked ? m.checkIn : null, worked ? m.checkOut : null, m.note, userId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json(await daySheet(shopId, b.date, await isOwner(userId, shopId)));
  }),
);

/**
 * A month at a glance: each person's mark for every day, and their totals. Worked days =
 * present + half days × 0.5; estimated pay = worked days × daily wage (owners only).
 */
attendanceRouter.get(
  '/month',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const today = await todayIST(pool);
    const q = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional() }).parse(req.query);
    const month = q.month ?? today.slice(0, 7);
    const owner = await isOwner(userId, shopId);

    const { rows: days } = await pool.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS d FROM generate_series($1::date, ($1::date + interval '1 month' - interval '1 day'), interval '1 day') d`,
      [`${month}-01`],
    );
    const { rows: people } = await pool.query(
      `SELECT ${EMP_COLS} FROM employees e
       WHERE e.shop_id = $1 AND (e.active OR EXISTS (
         SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.day >= $2::date AND a.day < $2::date + interval '1 month'))
       ORDER BY e.active DESC, lower(e.name), e.id`,
      [shopId, `${month}-01`],
    );
    const { rows: marks } = await pool.query(
      `SELECT ${MARK_COLS} FROM attendance a WHERE a.shop_id = $1 AND a.day >= $2::date AND a.day < $2::date + interval '1 month'`,
      [shopId, `${month}-01`],
    );

    const dates: string[] = days.map((r) => r.d);
    // Days that can have been marked: up to today.
    const markable = dates.filter((d) => d <= today).length;
    const staff = people.map((p) => {
      const own = marks.filter((m) => Number(m.employeeId) === Number(p.id));
      const byDay = Object.fromEntries(own.map((m) => [m.date, { status: m.status, checkIn: m.checkIn, checkOut: m.checkOut, note: m.note }]));
      const n = (s: Status) => own.filter((m) => m.status === s).length;
      const worked = n('present') + n('half_day') / 2;
      return {
        ...p,
        dailyWagePaise: owner ? p.dailyWagePaise : null,
        marks: byDay,
        present: n('present'),
        halfDay: n('half_day'),
        absent: n('absent'),
        leave: n('leave'),
        weekOff: n('week_off'),
        unmarked: Math.max(0, markable - own.filter((m) => m.date <= today).length),
        workedDays: worked,
        payPaise: owner && p.dailyWagePaise !== null ? Math.round(worked * Number(p.dailyWagePaise)) : null,
      };
    });
    res.json({ month, today, days: dates, staff });
  }),
);
