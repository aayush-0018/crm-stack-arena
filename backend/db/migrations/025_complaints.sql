-- 025_complaints.sql — complaints sent from the app's small "Complaints" form (DPDP grievance redressal).
-- Each is kept here and emailed to the Grievance Officer. Additive only.
CREATE TABLE complaints (
  id         BIGSERIAL   PRIMARY KEY,
  topic      TEXT        NOT NULL CHECK (topic IN ('privacy', 'billing', 'other')),
  name       TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  email      TEXT        NOT NULL CHECK (length(email) <= 254),
  message    TEXT        NOT NULL CHECK (length(trim(message)) BETWEEN 10 AND 2000),
  status     TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX complaints_created_idx ON complaints (created_at DESC);
