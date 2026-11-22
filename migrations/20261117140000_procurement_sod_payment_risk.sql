-- Build 4: additive evidence only. Installation does not enable an organization.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS governance_revision integer NOT NULL DEFAULT 1;
ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS sod_revision integer NOT NULL DEFAULT 1;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS sod_revision integer NOT NULL DEFAULT 1;
ALTER TABLE ap_payment_batches ADD COLUMN IF NOT EXISTS currency_code text;
ALTER TABLE ap_payment_batches ADD COLUMN IF NOT EXISTS approved_risk_assessment_id bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS risk_assessment_id bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_evidence_revision bigint;
ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS payment_risk_assessment_id bigint;

CREATE TABLE IF NOT EXISTS sod_conflict_rules (
 id serial PRIMARY KEY, code text NOT NULL, revision integer NOT NULL DEFAULT 1,
 organization_id integer REFERENCES organizations(id), name text NOT NULL, description text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
 permission_a text[] NOT NULL, permission_b text[] NOT NULL,
 enforcement_mode text NOT NULL CHECK(enforcement_mode IN ('WARN','REQUIRE_MITIGATION','BLOCK_ASSIGNMENT')),
 condition text, mitigation text NOT NULL, active boolean NOT NULL DEFAULT true,
 recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by integer REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sod_rules_revision_uidx ON sod_conflict_rules(coalesce(organization_id,0),code,revision);
INSERT INTO sod_conflict_rules(code,name,description,severity,permission_a,permission_b,enforcement_mode,condition,mitigation)
VALUES
 ('SUPPLIER_CREATE_APPROVE','Supplier creation and approval','One identity can create and approve suppliers.','HIGH',ARRAY['suppliers:create'],ARRAY['suppliers:approve'],'REQUIRE_MITIGATION',NULL,'Use independent onboarding approval; document and approve a time-limited compensating control.'),
 ('BANK_EDIT_RELEASE','Bank editing and payment release','One identity can change supplier banking and release payments.','CRITICAL',ARRAY['suppliers:update','suppliers:manage'],ARRAY['payments:execute'],'BLOCK_ASSIGNMENT',NULL,'Separate bank maintenance from payment release.'),
 ('BANK_APPROVE_RELEASE','Bank approval and payment release','One identity can approve bank changes and release payments.','CRITICAL',ARRAY['master_data:approve','settings:approve'],ARRAY['payments:execute'],'BLOCK_ASSIGNMENT',NULL,'Separate bank change approval from release.'),
 ('INVOICE_CREATE_APPROVE','Invoice creation and approval','One identity can create and approve invoices.','HIGH',ARRAY['invoices:create'],ARRAY['invoices:approve'],'REQUIRE_MITIGATION',NULL,'Require a different invoice approver and independent payment release.'),
 ('PAYMENT_CREATE_APPROVE','Payment creation and approval','One identity can prepare and approve batches.','HIGH',ARRAY['payments:create'],ARRAY['payments:approve'],'REQUIRE_MITIGATION',NULL,'Require independent payment release and an approved expiring mitigation.'),
 ('PAYMENT_CREATE_RELEASE','Payment creation and release','One identity can prepare and release payments.','CRITICAL',ARRAY['payments:create'],ARRAY['payments:execute'],'BLOCK_ASSIGNMENT',NULL,'Assign preparation and release to different people.'),
 ('PAYMENT_APPROVE_RELEASE','Payment approval and release','One identity can approve and release a batch.','CRITICAL',ARRAY['payments:approve'],ARRAY['payments:execute'],'BLOCK_ASSIGNMENT','independent_release','Use independent batch approval and release.'),
 ('PO_CREATE_APPROVE','PO creation and approval','One identity holds both purchase creation and approval permissions.','HIGH',ARRAY['purchases:create'],ARRAY['purchases:approve'],'WARN',NULL,'Transaction-time maker/checker remains mandatory; review delegated approval authority.'),
 ('MDM_EDIT_APPROVE','Master Data editing and approval','One identity can edit and approve Master Data.','HIGH',ARRAY['master_data:update','master_data:manage','settings:update','settings:manage'],ARRAY['master_data:approve','settings:approve'],'REQUIRE_MITIGATION',NULL,'Use independently approved Master Data requests and a time-limited control.'),
 ('ROLE_ADMIN_RELEASE','Role administration and release','One identity can alter access and release payments.','CRITICAL',ARRAY['custom_roles:manage','custom_roles:admin','custom_roles:update','users:manage','users:admin'],ARRAY['payments:execute'],'BLOCK_ASSIGNMENT',NULL,'Separate access administration from release.'),
 ('ROLE_ADMIN_BANK_APPROVE','Role administration and bank approval','One identity can alter access and approve bank changes.','CRITICAL',ARRAY['custom_roles:manage','custom_roles:admin','custom_roles:update','users:manage','users:admin'],ARRAY['master_data:approve','settings:approve'],'BLOCK_ASSIGNMENT',NULL,'Separate access administration from bank approval.')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS sod_conflict_exceptions (
 id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), rule_id integer NOT NULL REFERENCES sod_conflict_rules(id),
 subject_key text NOT NULL, permission_fingerprint text NOT NULL, source_evidence jsonb NOT NULL, reason text NOT NULL, compensating_control text NOT NULL,
 requested_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
 CHECK(expires_at>starts_at AND expires_at<=starts_at+interval '90 days'), CHECK(approved_by IS NULL OR approved_by<>requested_by)
);
CREATE INDEX IF NOT EXISTS sod_exception_scope_idx ON sod_conflict_exceptions(organization_id,subject_key,rule_id,status,expires_at);
CREATE OR REPLACE FUNCTION sod_exception_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SOD_EXCEPTION_EVIDENCE_IMMUTABLE'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at'])
  THEN RAISE EXCEPTION 'SOD_EXCEPTION_EVIDENCE_IMMUTABLE'; END IF;
 IF OLD.status<>'PENDING' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
   OR NEW.status NOT IN (OLD.status,'REVOKED')) THEN RAISE EXCEPTION 'SOD_EXCEPTION_TRANSITION_INVALID'; END IF;
 IF NEW.status='APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_by=NEW.requested_by OR NEW.approved_at IS NULL)
  THEN RAISE EXCEPTION 'SOD_EXCEPTION_INDEPENDENT_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION invoice_governance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.governance_revision:=OLD.governance_revision+1;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS invoice_governance_revision ON invoices;
CREATE TRIGGER invoice_governance_revision BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoice_governance_revision();
DROP TRIGGER IF EXISTS sod_exception_evidence_guard ON sod_conflict_exceptions;
CREATE TRIGGER sod_exception_evidence_guard BEFORE UPDATE OR DELETE ON sod_conflict_exceptions FOR EACH ROW EXECUTE FUNCTION sod_exception_evidence_guard();
CREATE TABLE IF NOT EXISTS sod_conflict_findings (
 id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), subject_key text NOT NULL, rule_id integer NOT NULL REFERENCES sod_conflict_rules(id),
 status text NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(), last_checked_at timestamptz NOT NULL DEFAULT now(),
 evidence jsonb NOT NULL, UNIQUE(organization_id,subject_key,rule_id)
);

CREATE TABLE IF NOT EXISTS supplier_bank_approvals (
 organization_id integer NOT NULL REFERENCES organizations(id), change_request_id integer NOT NULL,
 payload jsonb NOT NULL, source_snapshot jsonb, approved_by integer NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,change_request_id)
);
CREATE TABLE IF NOT EXISTS supplier_bank_revisions (
 id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), supplier_id integer NOT NULL REFERENCES suppliers(id),
 bank_id integer NOT NULL REFERENCES mdm_supplier_bank_accounts(id), change_request_id integer NOT NULL,
 beneficiary_fingerprint text NOT NULL, source_snapshot jsonb NOT NULL, approved_by integer NOT NULL REFERENCES users(id),
 applied_by integer NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,change_request_id)
);
CREATE INDEX IF NOT EXISTS supplier_bank_revision_scope_idx ON supplier_bank_revisions(organization_id,supplier_id,bank_id,id DESC);
CREATE TABLE IF NOT EXISTS payment_risk_policy_approvals (
 organization_id integer NOT NULL REFERENCES organizations(id),change_request_id integer NOT NULL,
 payload jsonb NOT NULL,source_snapshot jsonb,approved_by integer NOT NULL REFERENCES users(id),approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,change_request_id)
);
CREATE TABLE IF NOT EXISTS payment_risk_policy_revisions (
 id bigserial PRIMARY KEY,organization_id integer NOT NULL REFERENCES organizations(id),policy_id integer NOT NULL REFERENCES mdm_procurement_policies(id),
 change_request_id integer NOT NULL,source_snapshot jsonb NOT NULL,approved_by integer NOT NULL REFERENCES users(id),applied_by integer NOT NULL REFERENCES users(id),
 approved_at timestamptz NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,change_request_id)
);
CREATE INDEX IF NOT EXISTS payment_risk_policy_revision_scope_idx ON payment_risk_policy_revisions(organization_id,policy_id,id DESC);
CREATE TABLE IF NOT EXISTS payment_risk_assessments (
 id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), batch_id integer NOT NULL REFERENCES ap_payment_batches(id),
 version integer NOT NULL, assessed_at timestamptz NOT NULL DEFAULT now(), assessed_by integer NOT NULL REFERENCES users(id),
 source_fingerprint text NOT NULL, policy jsonb NOT NULL, source_evidence jsonb NOT NULL,
 amount numeric(24,4) NOT NULL CHECK(amount>0), currency_code text NOT NULL, score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
 risk_level text NOT NULL CHECK(risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 status text NOT NULL CHECK(status IN ('CURRENT','STALE','REVIEW_REQUIRED','APPROVED_RISK','BLOCKED')),
 stale_at timestamptz, stale_reason text, superseded_by bigint REFERENCES payment_risk_assessments(id),
 UNIQUE(organization_id,batch_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_risk_current_uidx ON payment_risk_assessments(organization_id,batch_id) WHERE status<>'STALE';
CREATE TABLE IF NOT EXISTS payment_risk_signals (
 assessment_id bigint NOT NULL REFERENCES payment_risk_assessments(id), code text NOT NULL, resource_key text NOT NULL,
 points integer NOT NULL CHECK(points BETWEEN 0 AND 100), explanation text NOT NULL, evidence jsonb NOT NULL,
 PRIMARY KEY(assessment_id,code,resource_key)
);
CREATE TABLE IF NOT EXISTS payment_risk_reviews (
 id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), assessment_id bigint NOT NULL REFERENCES payment_risk_assessments(id),
 reviewed_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,assessment_id)
);
CREATE INDEX IF NOT EXISTS payment_risk_batch_idx ON payment_risk_assessments(organization_id,batch_id,id DESC);
CREATE INDEX IF NOT EXISTS payments_risk_bank_idx ON payments(bank_evidence_revision,invoice_id,payment_date);

CREATE OR REPLACE FUNCTION build4_enabled(org integer,feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT feature_flags->>feature='true' FROM organization_settings WHERE organization_id=org),false)
$$;
CREATE OR REPLACE FUNCTION governed_invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target integer; org integer; state text;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
 SELECT organization_id,status::text INTO org,state FROM invoices WHERE id=target FOR UPDATE;
 IF NOT build4_enabled(org,'payment_risk') THEN RETURN coalesce(NEW,OLD); END IF;
 IF TG_OP='UPDATE' AND NEW.invoice_id<>OLD.invoice_id THEN RAISE EXCEPTION 'INVOICE_LINE_IDENTITY_IMMUTABLE'; END IF;
 IF state<>'DRAFT' THEN RAISE EXCEPTION 'INVOICE_GOVERNED_CORRECTION_REQUIRED'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS governed_invoice_line_guard ON invoice_items;
CREATE TRIGGER governed_invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION governed_invoice_line_guard();
-- Canonical grant tables, not a new permissions register. A custom role is only
-- effective in its owning tenant; a membership has exactly one application role.
CREATE OR REPLACE FUNCTION sod_role_permissions(org integer,app_role text,custom_id integer) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT coalesce(array_agg(DISTINCT k ORDER BY k),ARRAY[]::text[]) FROM (
   SELECT r::text||':'||a::text k FROM unnest(enum_range(NULL::resource)) r CROSS JOIN unnest(enum_range(NULL::permission_type)) a WHERE app_role='admin'
   UNION SELECT resource::text||':'||permission_type::text FROM permissions WHERE role::text=app_role AND app_role<>'admin'
   UNION SELECT p.resource::text||':'||p.permission_type::text FROM custom_role_permissions p JOIN custom_roles c ON c.id=p.role_id
    WHERE app_role='custom' AND c.id=custom_id AND c.organization_id=org AND c.is_active
 ) grants
$$;
CREATE OR REPLACE FUNCTION sod_matching_rules(org integer,keys text[],subject text,role_subject text DEFAULT NULL)
 RETURNS TABLE(rule_id integer,code text,name text,severity text,enforcement_mode text,permissions text[],explanation text,mitigation text,exception_id bigint,exception_expires_at timestamptz)
 LANGUAGE sql STABLE AS $$
 WITH latest AS (SELECT DISTINCT ON(code) * FROM sod_conflict_rules WHERE organization_id=org OR organization_id IS NULL
 ORDER BY code,organization_id NULLS LAST,revision DESC)
 SELECT r.id,r.code,r.name,r.severity,r.enforcement_mode,
 ARRAY(SELECT k FROM unnest(keys) k WHERE k=ANY(r.permission_a) OR k=ANY(r.permission_b)),r.description,r.mitigation,e.id,e.expires_at
 FROM latest r LEFT JOIN LATERAL(SELECT x.id,x.expires_at FROM sod_conflict_exceptions x WHERE x.organization_id=org AND x.rule_id=r.id
  AND x.subject_key IN (subject,role_subject) AND x.permission_fingerprint=md5(array_to_string(keys,'|')) AND x.status='APPROVED'
  AND x.starts_at<=now() AND x.expires_at>now() ORDER BY x.expires_at DESC,x.id DESC LIMIT 1)e ON true
 WHERE r.active AND keys&&r.permission_a AND keys&&r.permission_b
$$;
CREATE OR REPLACE FUNCTION sod_guard_delta(org integer,subject text,role_subject text,old_keys text[],new_keys text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE failures jsonb;
BEGIN
 IF NOT build4_enabled(org,'sod') THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(723410,org);
 SELECT jsonb_agg(to_jsonb(n)) INTO failures FROM sod_matching_rules(org,new_keys,subject,role_subject)n
 WHERE n.enforcement_mode<>'WARN' AND n.exception_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM sod_matching_rules(org,old_keys,subject,role_subject)o WHERE o.code=n.code);
 IF failures IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SOD_ASSIGNMENT_CONFLICT',DETAIL=failures::text; END IF;
END $$;
CREATE OR REPLACE FUNCTION payment_risk_policy_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org integer; row_data jsonb;
BEGIN
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 org:=(row_data->>'organization_id')::int;
 IF build4_enabled(org,'payment_risk') AND (
   TG_TABLE_NAME='approval_policies' AND row_data->>'entity_type'='payment_batch'
   OR TG_TABLE_NAME='mdm_procurement_policies' AND row_data->>'policy_type'='payment_risk') THEN
  UPDATE payment_risk_assessments a SET status='STALE',stale_at=clock_timestamp(),stale_reason='Applicable payment policy changed'
  FROM ap_payment_batches b WHERE a.organization_id=org AND a.batch_id=b.id AND b.organization_id=org
   AND b.status NOT IN ('RELEASED','CANCELLED') AND a.status<>'STALE';
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS payment_risk_policy_changed ON approval_policies;
CREATE TRIGGER payment_risk_policy_changed AFTER INSERT OR UPDATE OR DELETE ON approval_policies FOR EACH ROW EXECUTE FUNCTION payment_risk_policy_changed();
DROP TRIGGER IF EXISTS payment_risk_policy_changed ON mdm_procurement_policies;
CREATE TRIGGER payment_risk_policy_changed AFTER INSERT OR UPDATE OR DELETE ON mdm_procurement_policies FOR EACH ROW EXECUTE FUNCTION payment_risk_policy_changed();
-- Independent bank approval is the only publication path when enabled.
CREATE OR REPLACE FUNCTION governed_bank_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org integer; request_id integer;
BEGIN
 org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 IF NOT build4_enabled(org,'payment_risk') THEN RETURN coalesce(NEW,OLD); END IF;
 request_id:=nullif(current_setting('app.approved_bank_request',true),'')::int;
 IF TG_OP='DELETE' OR request_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM supplier_bank_approvals a JOIN mdm_change_requests r ON r.id=a.change_request_id AND r.organization_id=a.organization_id
  WHERE a.organization_id=org AND a.change_request_id=request_id AND r.status='approved' AND a.approved_by<>r.submitted_by
 ) THEN RAISE EXCEPTION 'BANK_GOVERNED_CHANGE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS governed_bank_write_guard ON mdm_supplier_bank_accounts;
CREATE TRIGGER governed_bank_write_guard BEFORE INSERT OR UPDATE OR DELETE ON mdm_supplier_bank_accounts FOR EACH ROW EXECUTE FUNCTION governed_bank_write_guard();
CREATE OR REPLACE FUNCTION governed_risk_policy_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org integer; request_id integer; relevant boolean;
BEGIN
 org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 relevant:=CASE WHEN TG_OP='INSERT' THEN NEW.policy_type='payment_risk' WHEN TG_OP='DELETE' THEN OLD.policy_type='payment_risk' ELSE OLD.policy_type='payment_risk' OR NEW.policy_type='payment_risk' END;
 IF NOT relevant OR NOT build4_enabled(org,'payment_risk') THEN RETURN coalesce(NEW,OLD); END IF;
 request_id:=nullif(current_setting('app.approved_risk_policy_request',true),'')::int;
 IF TG_OP='DELETE' OR request_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM payment_risk_policy_approvals a JOIN mdm_change_requests r ON r.id=a.change_request_id AND r.organization_id=a.organization_id
  WHERE a.organization_id=org AND a.change_request_id=request_id AND r.status='approved' AND a.approved_by<>r.submitted_by
 ) THEN RAISE EXCEPTION 'PAYMENT_RISK_POLICY_GOVERNANCE_REQUIRED'; END IF;
 IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.policy_type<>OLD.policy_type) THEN RAISE EXCEPTION 'PAYMENT_RISK_POLICY_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS governed_risk_policy_write_guard ON mdm_procurement_policies;
CREATE TRIGGER governed_risk_policy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON mdm_procurement_policies FOR EACH ROW EXECUTE FUNCTION governed_risk_policy_write_guard();
CREATE OR REPLACE FUNCTION immutable_financial_maker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'FINANCIAL_MAKER_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_financial_maker ON invoices;
CREATE TRIGGER immutable_financial_maker BEFORE UPDATE OF created_by ON invoices FOR EACH ROW EXECUTE FUNCTION immutable_financial_maker();
DROP TRIGGER IF EXISTS immutable_financial_maker ON ap_payment_batches;
CREATE TRIGGER immutable_financial_maker BEFORE UPDATE OF created_by ON ap_payment_batches FOR EACH ROW EXECUTE FUNCTION immutable_financial_maker();
CREATE OR REPLACE FUNCTION sod_guard_role_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org integer; keys text[]; proposed text[]; rid integer; key text;
BEGIN
 rid:=CASE WHEN TG_OP='DELETE' THEN OLD.role_id ELSE NEW.role_id END;
 SELECT organization_id INTO org FROM custom_roles WHERE id=rid FOR UPDATE;
 IF org IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
 SELECT coalesce(array_agg(DISTINCT resource::text||':'||permission_type::text ORDER BY resource::text||':'||permission_type::text),ARRAY[]::text[]) INTO keys FROM custom_role_permissions WHERE role_id=rid;
 IF TG_OP='INSERT' THEN key:=NEW.resource::text||':'||NEW.permission_type::text;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO proposed FROM unnest(array_append(keys,key))k;
 ELSE
  IF TG_OP='UPDATE' AND NEW.role_id<>OLD.role_id THEN RAISE EXCEPTION 'SOD_ROLE_REBINDING_DENIED'; END IF;
  SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[]) INTO proposed FROM unnest(keys)k WHERE k<>OLD.resource::text||':'||OLD.permission_type::text;
  IF TG_OP='UPDATE' THEN SELECT array_agg(DISTINCT k ORDER BY k) INTO proposed FROM unnest(array_append(proposed,NEW.resource::text||':'||NEW.permission_type::text))k; END IF;
 END IF;
 PERFORM sod_guard_delta(org,'custom:'||rid,NULL,keys,proposed);
 UPDATE custom_roles SET sod_revision=sod_revision+1,updated_at=clock_timestamp() WHERE id=rid AND organization_id=org;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS sod_guard_grant ON custom_role_permissions;
CREATE TRIGGER sod_guard_grant BEFORE INSERT OR UPDATE OR DELETE ON custom_role_permissions FOR EACH ROW EXECUTE FUNCTION sod_guard_role_grant();
CREATE OR REPLACE FUNCTION sod_guard_role_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE keys text[];
BEGIN
 IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'SOD_ROLE_REBINDING_DENIED'; END IF;
 IF NEW.is_active AND NOT OLD.is_active THEN
  SELECT coalesce(array_agg(DISTINCT resource::text||':'||permission_type::text ORDER BY resource::text||':'||permission_type::text),ARRAY[]::text[]) INTO keys FROM custom_role_permissions WHERE role_id=NEW.id;
  PERFORM sod_guard_delta(NEW.organization_id,'custom:'||NEW.id,NULL,ARRAY[]::text[],keys);
 END IF;
 NEW.sod_revision:=OLD.sod_revision+1;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sod_guard_role_activation ON custom_roles;
CREATE TRIGGER sod_guard_role_activation BEFORE UPDATE OF is_active,organization_id ON custom_roles FOR EACH ROW EXECUTE FUNCTION sod_guard_role_activation();
CREATE OR REPLACE FUNCTION sod_guard_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer; prior text[]:=ARRAY[]::text[]; proposed text[]:=ARRAY[]::text[];
BEGIN
 IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.user_id<>OLD.user_id) THEN RAISE EXCEPTION 'SOD_MEMBERSHIP_REBINDING_DENIED'; END IF;
 IF NOT build4_enabled(NEW.organization_id,'sod') THEN RETURN NEW; END IF;
 SELECT CASE WHEN preferences->>'customRoleId' ~ '^[0-9]{1,9}$' THEN (preferences->>'customRoleId')::int END INTO cid FROM users WHERE id=NEW.user_id;
 IF TG_OP='UPDATE' AND OLD.active AND OLD.status='active' THEN prior:=sod_role_permissions(OLD.organization_id,OLD.application_role,cid); END IF;
 IF NEW.active AND NEW.status='active' THEN proposed:=sod_role_permissions(NEW.organization_id,NEW.application_role,cid); END IF;
 PERFORM sod_guard_delta(NEW.organization_id,'user:'||NEW.user_id,CASE WHEN NEW.application_role='custom' THEN 'custom:'||cid ELSE 'system:'||NEW.application_role END,prior,proposed);
 IF TG_OP='UPDATE' THEN NEW.sod_revision:=OLD.sod_revision+1; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sod_guard_membership ON organization_members;
CREATE TRIGGER sod_guard_membership BEFORE INSERT OR UPDATE OF application_role,active,status,organization_id,user_id ON organization_members FOR EACH ROW EXECUTE FUNCTION sod_guard_membership();
CREATE OR REPLACE FUNCTION sod_guard_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m record; old_id integer; new_id integer;
BEGIN
 old_id:=CASE WHEN OLD.preferences->>'customRoleId' ~ '^[0-9]{1,9}$' THEN (OLD.preferences->>'customRoleId')::int END;
 new_id:=CASE WHEN NEW.preferences->>'customRoleId' ~ '^[0-9]{1,9}$' THEN (NEW.preferences->>'customRoleId')::int END;
 IF old_id IS NOT DISTINCT FROM new_id AND NEW.active IS NOT DISTINCT FROM OLD.active THEN RETURN NEW; END IF;
 FOR m IN SELECT organization_id,application_role FROM organization_members WHERE user_id=NEW.id AND active AND status='active' ORDER BY organization_id FOR UPDATE LOOP
  PERFORM sod_guard_delta(m.organization_id,'user:'||NEW.id,CASE WHEN m.application_role='custom' THEN 'custom:'||new_id ELSE 'system:'||m.application_role END,
   CASE WHEN OLD.active THEN sod_role_permissions(m.organization_id,m.application_role,old_id) ELSE ARRAY[]::text[] END,
   CASE WHEN NEW.active THEN sod_role_permissions(m.organization_id,m.application_role,new_id) ELSE ARRAY[]::text[] END);
  UPDATE organization_members SET sod_revision=sod_revision+1 WHERE organization_id=m.organization_id AND user_id=NEW.id;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sod_guard_profile ON users;
CREATE TRIGGER sod_guard_profile BEFORE UPDATE OF preferences,active ON users FOR EACH ROW EXECUTE FUNCTION sod_guard_profile();

CREATE OR REPLACE FUNCTION invalidate_open_payment_risk(org integer,supplier integer,batch integer,reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE payment_risk_assessments a SET status='STALE',stale_at=clock_timestamp(),stale_reason=reason
 FROM ap_payment_batches b WHERE b.id=a.batch_id AND b.organization_id=a.organization_id AND a.organization_id=org
 AND b.status NOT IN ('RELEASED','CANCELLED') AND a.status<>'STALE'
 AND b.id IS DISTINCT FROM nullif(current_setting('app.payment_risk_releasing_batch',true),'')::int
 AND (batch IS NULL OR b.id=batch) AND (supplier IS NULL OR EXISTS(
 SELECT 1 FROM ap_payment_batch_items bi JOIN invoices i ON i.id=bi.invoice_id AND i.organization_id=org
 WHERE bi.batch_id=b.id AND i.supplier_id=supplier));
END $$;
CREATE OR REPLACE FUNCTION payment_risk_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; org integer; sid integer; bid integer;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='ap_payment_batch_items' THEN SELECT b.organization_id,i.supplier_id INTO org,sid FROM ap_payment_batches b
   JOIN invoices i ON i.id=(r->>'invoice_id')::int AND i.organization_id=b.organization_id WHERE b.id=(r->>'batch_id')::int;
 ELSIF TG_TABLE_NAME='payments' THEN SELECT organization_id,supplier_id INTO org,sid FROM invoices WHERE id=(r->>'invoice_id')::int;
 ELSIF TG_TABLE_NAME='ap_invoice_match_results' THEN org:=(r->>'organization_id')::int; SELECT supplier_id INTO sid FROM invoices WHERE id=(r->>'invoice_id')::int AND organization_id=org;
 ELSIF TG_TABLE_NAME='mdm_supplier_bank_accounts' THEN org:=(r->>'organization_id')::int;sid:=(r->>'supplier_id')::int;
 ELSIF TG_TABLE_NAME='suppliers' THEN org:=(r->>'organization_id')::int;sid:=(r->>'id')::int;
 ELSIF TG_TABLE_NAME='invoices' THEN org:=(r->>'organization_id')::int;sid:=(r->>'supplier_id')::int;
 ELSE org:=(r->>'organization_id')::int;bid:=(r->>'id')::int; END IF;
 IF org IS NOT NULL AND build4_enabled(org,'payment_risk') THEN PERFORM invalidate_open_payment_risk(org,sid,bid,TG_TABLE_NAME||' changed'); END IF;
 RETURN coalesce(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION governed_payment_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org integer; aid bigint; rid bigint; bid integer;
BEGIN
 SELECT organization_id INTO org FROM invoices WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
 IF NOT build4_enabled(org,'payment_risk') THEN RETURN coalesce(NEW,OLD); END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PAYMENT_GOVERNED_CORRECTION_REQUIRED'; END IF;
 aid:=nullif(current_setting('app.payment_risk_assessment',true),'')::bigint;
 bid:=nullif(current_setting('app.payment_risk_releasing_batch',true),'')::int;
 IF aid IS NULL OR bid IS NULL OR NOT EXISTS(SELECT 1 FROM payment_risk_assessments a JOIN ap_payment_batches b ON b.id=a.batch_id AND b.organization_id=a.organization_id
   JOIN ap_payment_batch_items bi ON bi.batch_id=b.id AND bi.invoice_id=NEW.invoice_id AND bi.amount=NEW.amount AND bi.payment_id IS NULL
   WHERE a.organization_id=org AND a.id=aid AND a.batch_id=bid AND b.approved_risk_assessment_id=a.id AND b.status='APPROVED' AND a.status IN ('CURRENT','APPROVED_RISK'))
 THEN RAISE EXCEPTION 'PAYMENT_GOVERNED_BATCH_REQUIRED'; END IF;
 NEW.risk_assessment_id:=aid;
 SELECT (entry->>'revision_id')::bigint INTO rid FROM payment_risk_assessments a,
   jsonb_array_elements(a.source_evidence->'banks') entry JOIN invoices i ON i.id=NEW.invoice_id AND i.organization_id=org
   WHERE a.id=aid AND a.organization_id=org AND (entry->>'supplier_id')::int=i.supplier_id;
 IF rid IS NULL THEN RAISE EXCEPTION 'PAYMENT_BANK_EVIDENCE_REQUIRED'; END IF;
 NEW.bank_evidence_revision:=rid;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS governed_payment_record_guard ON payments;
CREATE TRIGGER governed_payment_record_guard BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION governed_payment_record_guard();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['invoices','suppliers','mdm_supplier_bank_accounts','ap_invoice_match_results','ap_payment_batch_items','payments'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS payment_risk_source_changed ON %I',t);
  EXECUTE format('CREATE TRIGGER payment_risk_source_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION payment_risk_source_changed()',t);
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS payment_risk_batch_changed ON ap_payment_batches;
CREATE TRIGGER payment_risk_batch_changed AFTER UPDATE OF total_amount,currency_code,payment_method,scheduled_date,export_metadata ON ap_payment_batches FOR EACH ROW EXECUTE FUNCTION payment_risk_source_changed();
CREATE OR REPLACE FUNCTION protect_payment_risk_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Governed evidence is immutable'; END IF;
 IF TG_TABLE_NAME='payment_risk_assessments' AND (to_jsonb(NEW)-ARRAY['status','stale_at','stale_reason','superseded_by'])=(to_jsonb(OLD)-ARRAY['status','stale_at','stale_reason','superseded_by']) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Governed evidence is immutable';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sod_conflict_rules','supplier_bank_approvals','supplier_bank_revisions','payment_risk_policy_approvals','payment_risk_policy_revisions','payment_risk_assessments','payment_risk_signals','payment_risk_reviews'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS immutable_governance_evidence ON %I',t);
  EXECUTE format('CREATE TRIGGER immutable_governance_evidence BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_payment_risk_evidence()',t);
 END LOOP;
END $$;
