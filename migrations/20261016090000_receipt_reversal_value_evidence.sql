-- Separate immutable reversal identities preserve the original receipt snapshot.
CREATE TABLE IF NOT EXISTS receipt_value_reversal_evidence (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  reversal_id integer NOT NULL,
  original_evidence_id bigint NOT NULL,
  quantity numeric NOT NULL CHECK (quantity <= 0 AND quantity::text NOT IN ('NaN','Infinity','-Infinity')),
  posted_at timestamptz NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  UNIQUE (organization_id,reversal_id,original_evidence_id),
  UNIQUE (organization_id,original_evidence_id),
  FOREIGN KEY (organization_id,original_evidence_id) REFERENCES receipt_value_evidence(organization_id,id)
);
DROP TRIGGER IF EXISTS receipt_reversal_value_immutable ON receipt_value_reversal_evidence;
CREATE TRIGGER receipt_reversal_value_immutable BEFORE UPDATE OR DELETE ON receipt_value_reversal_evidence
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();
