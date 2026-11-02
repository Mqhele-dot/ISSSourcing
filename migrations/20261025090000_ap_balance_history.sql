-- Additive reporting evidence only. Existing invoices are NOT baselined here.
ALTER TABLE financial_reporting_runs DROP CONSTRAINT IF EXISTS financial_reporting_runs_measure_check;
ALTER TABLE financial_reporting_runs ADD CONSTRAINT financial_reporting_runs_measure_check
  CHECK(measure IN ('ordered','open_commitment','received','invoiced','recorded_payments','ap_outstanding','ap_disputed','ap_unapproved'));
CREATE TABLE IF NOT EXISTS ap_balance_baselines (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  created_by integer NOT NULL REFERENCES users(id),
  submitted_by integer REFERENCES users(id),
  approved_by integer REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPLIED')),
  reason text NOT NULL CHECK(length(trim(reason))>0),
  proposal jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_at timestamptz,
  applied_at timestamptz,
  request_kind text NOT NULL DEFAULT 'OPENING_BASELINE' CHECK(request_kind IN ('OPENING_BASELINE','CORRECTION')),
  target_event_id bigint,
  document_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_effective_at timestamptz,
  UNIQUE(organization_id,id),
  CHECK(approved_by IS NULL OR (approved_by<>created_by AND approved_by<>submitted_by))
);
CREATE TABLE IF NOT EXISTS ap_balance_events (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  invoice_id integer NOT NULL,
  event_kind text NOT NULL CHECK(event_kind IN ('CREATED','OBSERVED','DELETED','OPENING_BASELINE','CORRECTION')),
  source_revision text NOT NULL,
  source_command_ref text NOT NULL,
  source_transaction_id bigint NOT NULL DEFAULT txid_current(),
  previous_event_id bigint,
  baseline_id bigint,
  correction_request_id bigint,
  target_event_id bigint,
  actor_user_id integer REFERENCES users(id),
  actor_provenance text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  snapshot jsonb NOT NULL,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,source_command_ref),
  FOREIGN KEY(organization_id,previous_event_id) REFERENCES ap_balance_events(organization_id,id),
  FOREIGN KEY(organization_id,baseline_id) REFERENCES ap_balance_baselines(organization_id,id)
);
CREATE INDEX IF NOT EXISTS ap_balance_history_lookup ON ap_balance_events(organization_id,invoice_id,effective_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS ap_balance_history_observed ON ap_balance_events(organization_id,recorded_at,id);
ALTER TABLE ap_balance_events ADD COLUMN IF NOT EXISTS source_transaction_id bigint NOT NULL DEFAULT txid_current();
CREATE INDEX IF NOT EXISTS ap_balance_transaction_lookup ON ap_balance_events(organization_id,source_transaction_id);
ALTER TABLE ap_balance_baselines ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'OPENING_BASELINE';
ALTER TABLE ap_balance_baselines ADD COLUMN IF NOT EXISTS target_event_id bigint;
ALTER TABLE ap_balance_baselines ADD COLUMN IF NOT EXISTS document_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ap_balance_baselines ADD COLUMN IF NOT EXISTS requested_effective_at timestamptz;
ALTER TABLE ap_balance_events ADD COLUMN IF NOT EXISTS correction_request_id bigint;
ALTER TABLE ap_balance_events ADD COLUMN IF NOT EXISTS target_event_id bigint;
CREATE INDEX IF NOT EXISTS ap_balance_correction_target ON ap_balance_events(organization_id,target_event_id,recorded_at);
DROP TRIGGER IF EXISTS ap_balance_event_immutable ON ap_balance_events;
CREATE TRIGGER ap_balance_event_immutable BEFORE UPDATE OR DELETE ON ap_balance_events
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();

CREATE OR REPLACE FUNCTION ap_reporting_invoice_snapshot(src jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('invoiceNumber',src->>'invoice_number','supplierId',src->>'supplier_id',
    'currencyCode',src->>'currency_code','total',src->>'total','paidAmount',src->>'paid_amount',
    'remainingBalance',src->>'due_amount','status',upper(src->>'status'),
    'issueDate',src->>'issue_date','dueDate',src->>'due_date')
$$;

CREATE OR REPLACE FUNCTION capture_ap_invoice_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src jsonb; prior bigint; event_id bigint; org integer; invoice integer; actor text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.organization_id<>NEW.organization_id THEN
    RAISE EXCEPTION 'Invoice organization ownership cannot be changed';
  END IF;
  src:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF src->>'supplier_id' IS NULL AND (TG_OP<>'UPDATE' OR to_jsonb(OLD)->>'supplier_id' IS NULL) THEN
    RETURN NULL;
  END IF;
  IF TG_OP='UPDATE' AND ap_reporting_invoice_snapshot(to_jsonb(OLD))=ap_reporting_invoice_snapshot(src) THEN RETURN NULL; END IF;
  org:=(src->>'organization_id')::integer; invoice:=(src->>'id')::integer;
  SELECT id INTO prior FROM ap_balance_events WHERE organization_id=org AND invoice_id=invoice ORDER BY id DESC LIMIT 1;
  event_id:=nextval(pg_get_serial_sequence('ap_balance_events','id'));
  actor:=nullif(current_setting('app.ap_reporting_actor',true),'');
  INSERT INTO ap_balance_events(id,organization_id,invoice_id,event_kind,source_revision,source_command_ref,previous_event_id,actor_user_id,actor_provenance,snapshot)
  VALUES(event_id,org,invoice,CASE TG_OP WHEN 'INSERT' THEN 'CREATED' WHEN 'DELETE' THEN 'DELETED' ELSE 'OBSERVED' END,
    md5(src::text),'invoice:'||invoice||':tx:'||txid_current()||':event:'||event_id,prior,
    CASE WHEN actor ~ '^[1-9][0-9]*$' THEN actor::integer ELSE NULL END,
    CASE WHEN actor ~ '^[1-9][0-9]*$' THEN 'authenticated_command' ELSE 'database_observation_actor_unverified' END,
    ap_reporting_invoice_snapshot(src)||jsonb_build_object('deleted',TG_OP='DELETE'));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ap_invoice_balance_capture ON invoices;
CREATE TRIGGER ap_invoice_balance_capture AFTER INSERT OR UPDATE OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION capture_ap_invoice_balance();

CREATE OR REPLACE FUNCTION protect_ap_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='APPLIED' OR NEW.proposal IS DISTINCT FROM OLD.proposal
    OR NEW.organization_id<>OLD.organization_id OR NEW.created_by<>OLD.created_by OR NEW.reason<>OLD.reason
    OR NEW.request_kind IS DISTINCT FROM OLD.request_kind OR NEW.target_event_id IS DISTINCT FROM OLD.target_event_id
    OR NEW.document_evidence IS DISTINCT FROM OLD.document_evidence OR NEW.requested_effective_at IS DISTINCT FROM OLD.requested_effective_at
    OR NOT ((OLD.status='DRAFT' AND NEW.status='SUBMITTED') OR (OLD.status='SUBMITTED' AND NEW.status='APPLIED')) THEN
    RAISE EXCEPTION 'Baseline evidence is immutable; prepare a new reviewed proposal';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ap_baseline_guard ON ap_balance_baselines;
CREATE TRIGGER ap_baseline_guard BEFORE UPDATE OR DELETE ON ap_balance_baselines
FOR EACH ROW EXECUTE FUNCTION protect_ap_baseline();
