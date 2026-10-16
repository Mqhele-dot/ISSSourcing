-- Opt-in conservative inspection policy until receipt-specific positions exist.
CREATE TABLE IF NOT EXISTS inventory_inspection_rules (
 organization_id integer NOT NULL,
 subject_type text NOT NULL CHECK(subject_type IN ('item','supplier')),
 subject_id integer NOT NULL,
 required boolean NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 updated_by integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,subject_type,subject_id)
);
CREATE TABLE IF NOT EXISTS receipt_inspection_evidence (
 organization_id integer NOT NULL,
 receipt_item_id integer PRIMARY KEY REFERENCES ap_receipt_items(id),
 hold_id bigint NOT NULL UNIQUE REFERENCES inventory_safety_holds(id),
 item_rule_revision integer,
 supplier_rule_revision integer,
 created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS immutable_receipt_inspection ON receipt_inspection_evidence;
CREATE TRIGGER immutable_receipt_inspection BEFORE UPDATE OR DELETE ON receipt_inspection_evidence
 FOR EACH ROW EXECUTE FUNCTION immutable_safety_evidence();
