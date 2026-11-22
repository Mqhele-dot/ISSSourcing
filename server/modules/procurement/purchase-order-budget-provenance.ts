import type { PoolClient } from "pg";

export async function hasPurchaseOrderBudgetProvenance(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query("SELECT to_regclass('public.purchase_order_budget_provenance') IS NOT NULL AS installed");
  return rows[0]?.installed === true;
}

/** Called only by a conversion that already holds the requisition row lock. */
export async function bindPurchaseOrderBudgetProvenance(
  client: PoolClient, organizationId: number, requisitionId: number, orderIds: number[],
  kind: "requisition" | "agreement_release" | "sourcing_award",
) {
  if (!orderIds.length || !await hasPurchaseOrderBudgetProvenance(client)) return;
  await client.query(`INSERT INTO purchase_order_budget_provenance
      (organization_id,purchase_order_id,requisition_id,approved_at,conversion_kind,exception_revision)
    SELECT p.organization_id,p.id,r.id,e.approved_at,$4,
      CASE WHEN x.id IS NOT NULL THEN jsonb_build_object('id',x.id::text,'type',x.type,
        'observedRevision',x.updated_at::text,'relatedRefs',x.related_refs) END
    FROM purchase_requisitions r
    JOIN purchase_orders p ON p.organization_id=r.organization_id AND p.requisition_id=r.id AND p.id=ANY($3::int[])
    JOIN purchase_budget_policy_evidence e ON e.organization_id=r.organization_id AND e.requisition_id=r.id
      AND e.approved_at=r.approval_date AND e.approver_user_id=r.approver_id AND e.approved_at<=p.created_at
    LEFT JOIN LATERAL (
      SELECT x.id,x.type,x.updated_at,x.related_refs FROM operational_exceptions x
      WHERE x.organization_id=e.organization_id AND x.id=e.exception_id
        AND x.related_refs @> jsonb_build_object('requisitionId',r.id)
        AND (e.outcome<>'over_budget' OR x.related_refs->>'budgetId'=e.budget_id::text)
        AND x.type=CASE e.outcome WHEN 'over_budget' THEN 'procurement_budget_override'
                                  WHEN 'no_matching_budget' THEN 'procurement_budget_missing' END
      FOR SHARE OF x
    ) x ON true
    WHERE r.organization_id=$1 AND r.id=$2 AND r.requestor_id IS NOT NULL AND r.requestor_id<>e.approver_user_id
      AND (e.outcome='within_budget' OR x.id IS NOT NULL)`, [organizationId,requisitionId,orderIds,kind]);
}
