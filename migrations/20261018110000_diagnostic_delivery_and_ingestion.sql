-- Diagnostic delivery evidence only; no operational transaction data is changed.
CREATE TABLE IF NOT EXISTS diagnostic_client_events (
  organization_id integer NOT NULL REFERENCES organizations(id),
  user_id integer NOT NULL REFERENCES users(id),
  client_event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('browser_error','unhandled_rejection','console_error')),
  route text NOT NULL,
  build_id text,
  request_reference text,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,user_id,client_event_id)
);

CREATE TABLE IF NOT EXISTS diagnostic_notification_intents (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  finding_key text NOT NULL,
  transition text NOT NULL CHECK (transition IN ('opened','worsened','recovered','daily_summary')),
  transition_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (organization_id,transition_key)
);
CREATE INDEX IF NOT EXISTS diagnostic_notification_intents_pending_idx
  ON diagnostic_notification_intents(created_at,id) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS diagnostic_daily_summaries (
  organization_id integer NOT NULL REFERENCES organizations(id),
  local_date date NOT NULL,
  timezone text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  new_count integer NOT NULL DEFAULT 0,
  worsened_count integer NOT NULL DEFAULT 0,
  recovered_count integer NOT NULL DEFAULT 0,
  outstanding_count integer NOT NULL DEFAULT 0,
  monitoring_fresh boolean NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (organization_id,local_date)
);

ALTER TABLE diagnostic_check_runs ADD COLUMN IF NOT EXISTS outcome text
  CHECK (outcome IN ('completed','failed','timed_out','lease_expired','skipped'));
ALTER TABLE diagnostic_check_runs ADD COLUMN IF NOT EXISTS error_code text;

CREATE INDEX IF NOT EXISTS diagnostic_client_events_retention_idx
  ON diagnostic_client_events(received_at);
