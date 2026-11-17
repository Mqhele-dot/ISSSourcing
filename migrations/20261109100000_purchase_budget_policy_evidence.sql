-- Evidence of actual policy decisions, not a reconstruction from today's policy.
CREATE TABLE IF NOT EXISTS purchase_budget_policy_evidence (
  organization_id integer NOT NULL REFERENCES organizations(id),
  requisition_id integer NOT NULL,
  approved_at timestamp NOT NULL,
  approver_user_id integer NOT NULL,
  policy_revision text NOT NULL,
  policy_mode text NOT NULL CHECK (policy_mode IN ('WARNING_ONLY','WARN_APPROVAL','HARD_BLOCK')),
  outcome text NOT NULL CHECK (outcome IN ('within_budget','over_budget','no_matching_budget')),
  budget_id bigint,
  exception_id bigint,
  PRIMARY KEY (organization_id, requisition_id, approved_at),
  CHECK ((outcome='no_matching_budget') = (budget_id IS NULL)),
  CHECK ((outcome='within_budget') = (exception_id IS NULL))
);
CREATE OR REPLACE FUNCTION refuse_purchase_budget_evidence_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase budget policy evidence is immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS purchase_budget_evidence_immutable ON purchase_budget_policy_evidence;
CREATE TRIGGER purchase_budget_evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON purchase_budget_policy_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_purchase_budget_evidence_rewrite();
