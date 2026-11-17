-- Prospective evidence only. Do not reconstruct links for historical orders.
CREATE TABLE IF NOT EXISTS public.purchase_order_budget_provenance (
  organization_id integer NOT NULL REFERENCES organizations(id),
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id),
  requisition_id integer NOT NULL,
  approved_at timestamp NOT NULL,
  conversion_kind text NOT NULL CHECK (conversion_kind IN ('requisition','agreement_release','sourcing_award')),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  exception_revision jsonb,
  PRIMARY KEY (organization_id,purchase_order_id),
  FOREIGN KEY (organization_id,requisition_id,approved_at)
    REFERENCES purchase_budget_policy_evidence(organization_id,requisition_id,approved_at)
);
DROP TRIGGER IF EXISTS purchase_order_budget_provenance_immutable ON public.purchase_order_budget_provenance;
CREATE TRIGGER purchase_order_budget_provenance_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.purchase_order_budget_provenance
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_purchase_budget_evidence_rewrite();
