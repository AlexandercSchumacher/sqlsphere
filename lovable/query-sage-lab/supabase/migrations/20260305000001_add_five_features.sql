-- Migration: Add tables for 5 new features
-- 1. Scheduled Queries/Reports
-- 2. Query History & Favorites
-- 3. Natural Language Dashboards
-- 4. Data Alerts
-- 5. Shareable Query Links

-- Helper: reusable updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- Feature 2: Query History & Favorites
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES connections(id) ON DELETE SET NULL,
  sql_text text NOT NULL,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  execution_time_ms integer,
  row_count integer,
  error_message text,
  is_favorite boolean NOT NULL DEFAULT false,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_query_history_user_created ON query_history(user_id, created_at DESC);
CREATE INDEX idx_query_history_user_favorite ON query_history(user_id, is_favorite) WHERE is_favorite = true;

ALTER TABLE query_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own query history"
  ON query_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_query_history_updated_at
  BEFORE UPDATE ON query_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- Feature 1: Scheduled Queries / Reports
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  sql_text text NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
  schedule_time time NOT NULL DEFAULT '08:00',
  schedule_day_of_week integer CHECK (schedule_day_of_week BETWEEN 0 AND 6),
  schedule_day_of_month integer CHECK (schedule_day_of_month BETWEEN 1 AND 28),
  timezone text NOT NULL DEFAULT 'UTC',
  email_recipients text[] NOT NULL DEFAULT '{}',
  output_format text NOT NULL DEFAULT 'csv' CHECK (output_format IN ('csv', 'json')),
  is_active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_queries_user ON scheduled_queries(user_id);
CREATE INDEX idx_scheduled_queries_next_run ON scheduled_queries(next_run_at) WHERE is_active = true;

ALTER TABLE scheduled_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own scheduled queries"
  ON scheduled_queries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_scheduled_queries_updated_at
  BEFORE UPDATE ON scheduled_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Run history
CREATE TABLE IF NOT EXISTS scheduled_query_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  row_count integer,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_query_runs_schedule ON scheduled_query_runs(schedule_id, started_at DESC);

ALTER TABLE scheduled_query_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedule runs"
  ON scheduled_query_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scheduled_queries sq
      WHERE sq.id = scheduled_query_runs.schedule_id
      AND sq.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- Feature 3: Natural Language Dashboards
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboards_user ON dashboards(user_id);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dashboards"
  ON dashboards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_dashboards_updated_at
  BEFORE UPDATE ON dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  title text NOT NULL,
  nl_prompt text,
  sql_text text NOT NULL,
  chart_type text NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'line', 'area', 'pie', 'table')),
  chart_config jsonb NOT NULL DEFAULT '{}',
  cached_data jsonb,
  cached_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id, position);

ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dashboard widgets"
  ON dashboard_widgets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id = dashboard_widgets.dashboard_id
      AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id = dashboard_widgets.dashboard_id
      AND d.user_id = auth.uid()
    )
  );

CREATE TRIGGER set_dashboard_widgets_updated_at
  BEFORE UPDATE ON dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- Feature 4: Data Alerts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  nl_condition text NOT NULL,
  sql_text text NOT NULL,
  check_interval_minutes integer NOT NULL DEFAULT 60,
  email_recipients text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_alerts_user ON data_alerts(user_id);
CREATE INDEX idx_data_alerts_active ON data_alerts(is_active, last_checked_at) WHERE is_active = true;

ALTER TABLE data_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own data alerts"
  ON data_alerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_data_alerts_updated_at
  BEFORE UPDATE ON data_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- In-app notifications
CREATE TABLE IF NOT EXISTS alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES data_alerts(id) ON DELETE SET NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_notifications_user ON alert_notifications(user_id, created_at DESC);
CREATE INDEX idx_alert_notifications_unread ON alert_notifications(user_id, is_read) WHERE is_read = false;

ALTER TABLE alert_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own notifications"
  ON alert_notifications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE alert_notifications;

-- ─────────────────────────────────────────────────────────────
-- Feature 5: Shareable Query Links
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  title text NOT NULL,
  sql_text text NOT NULL,
  result_columns text[] NOT NULL DEFAULT '{}',
  result_data jsonb NOT NULL DEFAULT '[]',
  row_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_shared_queries_token ON shared_queries(token);
CREATE INDEX idx_shared_queries_user ON shared_queries(user_id);

ALTER TABLE shared_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shared queries"
  ON shared_queries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Public access function (SECURITY DEFINER — bypasses RLS)
CREATE OR REPLACE FUNCTION get_shared_query(p_token text)
RETURNS TABLE (
  title text,
  sql_text text,
  result_columns text[],
  result_data jsonb,
  row_count integer,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      sq.title,
      sq.sql_text,
      sq.result_columns,
      sq.result_data,
      sq.row_count,
      sq.created_at,
      sq.expires_at
    FROM shared_queries sq
    WHERE sq.token = p_token
      AND sq.expires_at > now();
END;
$$;
