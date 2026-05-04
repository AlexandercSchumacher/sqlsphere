-- Report Builder v2: NL-driven schedules, preview metadata, and enriched run records

ALTER TABLE scheduled_queries
  ADD COLUMN IF NOT EXISTS query_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS nl_prompt text,
  ADD COLUMN IF NOT EXISTS generated_sql text,
  ADD COLUMN IF NOT EXISTS sql_final text,
  ADD COLUMN IF NOT EXISTS report_description text,
  ADD COLUMN IF NOT EXISTS include_chart boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chart_type text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS chart_title text;

UPDATE scheduled_queries
SET sql_final = COALESCE(NULLIF(sql_final, ''), sql_text)
WHERE sql_final IS NULL OR sql_final = '';

ALTER TABLE scheduled_queries
  ALTER COLUMN sql_final SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_queries_query_mode_check'
  ) THEN
    ALTER TABLE scheduled_queries
      ADD CONSTRAINT scheduled_queries_query_mode_check
      CHECK (query_mode IN ('manual', 'nl'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_queries_chart_type_check'
  ) THEN
    ALTER TABLE scheduled_queries
      ADD CONSTRAINT scheduled_queries_chart_type_check
      CHECK (chart_type IN ('auto', 'bar', 'line', 'area', 'pie', 'table'));
  END IF;
END $$;

ALTER TABLE scheduled_query_runs
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS chart_generated boolean NOT NULL DEFAULT false;
