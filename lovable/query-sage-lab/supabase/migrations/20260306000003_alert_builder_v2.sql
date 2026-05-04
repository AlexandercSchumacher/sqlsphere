-- Alert Builder v2: NL SQL generation + preview-ready query persistence (no chart options)

ALTER TABLE data_alerts
  ADD COLUMN IF NOT EXISTS query_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS nl_prompt text,
  ADD COLUMN IF NOT EXISTS generated_sql text,
  ADD COLUMN IF NOT EXISTS sql_final text;

UPDATE data_alerts
SET sql_final = COALESCE(NULLIF(sql_final, ''), sql_text)
WHERE sql_final IS NULL OR sql_final = '';

ALTER TABLE data_alerts
  ALTER COLUMN sql_final SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'data_alerts_query_mode_check'
  ) THEN
    ALTER TABLE data_alerts
      ADD CONSTRAINT data_alerts_query_mode_check
      CHECK (query_mode IN ('manual', 'nl'));
  END IF;
END $$;
