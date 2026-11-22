import type { PoolClient } from "pg";

/** Move the existing reservation, not the PO price. Caller locks the requisition and owns the transaction. */
export async function transferRequisitionBudget(client: PoolClient, organizationId: number, requisitionId: number, purchaseOrderId: number) {
  const { rows: [transferred] } = await client.query<{
    id: string; budget_id: string | null; amount: string; currency_code: string;
  }>(
    `UPDATE budget_commitments SET status='TRANSFERRED',updated_at=now()
     WHERE organization_id=$1 AND source_type='REQUISITION' AND source_id=$2 AND status='ACTIVE'
     RETURNING id,budget_id,amount::text,currency_code`,
    [organizationId, requisitionId],
  );
  if (!transferred) return null;
  const { rows: [child] } = await client.query<{ id: string }>(
    `INSERT INTO budget_commitments
       (organization_id,budget_id,source_type,source_id,parent_commitment_id,amount,currency_code,status)
     VALUES ($1,$2,'PURCHASE_ORDER',$3,$4,$5,$6,'ACTIVE') RETURNING id`,
    [organizationId, transferred.budget_id, purchaseOrderId, transferred.id, transferred.amount, transferred.currency_code],
  );
  return { sourceCommitmentId: transferred.id, purchaseOrderCommitmentId: child.id };
}
