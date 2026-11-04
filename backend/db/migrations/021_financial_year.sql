-- 021_financial_year.sql — the month each branch's financial year starts in (4 = April for India's Apr–Mar year).
-- Default 1 (January) keeps everything as it was: calendar years in reports and document numbers.
ALTER TABLE shops ADD COLUMN fy_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (fy_start_month BETWEEN 1 AND 12);
