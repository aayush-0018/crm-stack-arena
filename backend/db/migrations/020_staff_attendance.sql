-- 020_staff_attendance.sql — a staff register and daily attendance for each branch.
-- Additive: nothing existing reads these tables.

-- ---------------------------------------------------------------------------
-- The people who work at the branch. They don't need a login: the owner (or a staff member
-- with a login) marks attendance for them.
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
  id               BIGSERIAL   PRIMARY KEY,
  shop_id          BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  phone            TEXT,
  job_title        TEXT        CHECK (length(job_title) <= 60),
  -- Optional; used only to estimate pay for the month (present = 1 day, half day = 0.5).
  daily_wage_paise BIGINT      CHECK (daily_wage_paise >= 0),
  joined_on        DATE,
  active           BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employees_shop_idx ON employees (shop_id, active, name);

-- ---------------------------------------------------------------------------
-- One mark per person per day. No row = not marked yet.
-- ---------------------------------------------------------------------------
CREATE TABLE attendance (
  employee_id BIGINT      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shop_id     BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day         DATE        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('present', 'half_day', 'absent', 'leave', 'week_off')),
  check_in    TIME,
  check_out   TIME,
  note        TEXT        CHECK (length(note) <= 200),
  marked_by   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, day)
);
CREATE INDEX attendance_shop_day_idx ON attendance (shop_id, day);
