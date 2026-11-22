import type { PoolClient } from "pg";

/** Must run inside the goods-receipt transaction, after locking its PO and lines. */
export async function captureReceiptValue(client:PoolClient,organizationId:number,receiptItemId:number,actorUserId:number) {
  const inserted=await client.query(`INSERT INTO receipt_value_evidence
    (organization_id,receipt_item_id,quantity,unit_price,currency_code,source_price_reference,posted_at,actor_user_id)
    SELECT r.organization_id,l.id,l.accepted_quantity::numeric,p.unit_price::numeric,o.currency_code,
      'purchase_order:'||o.id||':revision:'||o.revision_number||':line:'||p.id,r.received_date,$3
    FROM ap_receipt_items l JOIN ap_receipts r ON r.id=l.receipt_id
    JOIN purchase_orders o ON o.id=r.purchase_order_id AND o.organization_id=r.organization_id
    JOIN purchase_order_items p ON p.id=l.purchase_order_item_id AND p.order_id=o.id
    WHERE r.organization_id=$1 AND l.id=$2 AND r.status::text='POSTED'
      AND o.currency_code ~ '^[A-Z]{3}$' AND p.unit_price>=0
      AND p.unit_price::text NOT IN ('NaN','Infinity','-Infinity')
    ON CONFLICT (organization_id,receipt_item_id) DO NOTHING RETURNING id`,[organizationId,receiptItemId,actorUserId]);
  if(!inserted.rowCount) {
    const existing=await client.query('SELECT id FROM receipt_value_evidence WHERE organization_id=$1 AND receipt_item_id=$2',[organizationId,receiptItemId]);
    if(!existing.rowCount) throw new Error('RECEIPT_PRICE_EVIDENCE_REQUIRED');
  }
}

/** Historical receipts without an original snapshot remain unavailable; never use today's PO price. */
export async function captureReceiptReversalValue(client:PoolClient,organizationId:number,reversalId:number,actorUserId:number) {
  await client.query(`INSERT INTO receipt_value_reversal_evidence
    (organization_id,reversal_id,original_evidence_id,quantity,posted_at,actor_user_id)
    SELECT g.organization_id,g.id,e.id,-e.quantity,g.created_at,$3
    FROM goods_receipt_reversals g JOIN ap_receipts r ON r.id=g.receipt_id AND r.organization_id=g.organization_id
    JOIN ap_receipt_items l ON l.receipt_id=r.id
    JOIN receipt_value_evidence e ON e.organization_id=r.organization_id AND e.receipt_item_id=l.id
    WHERE g.organization_id=$1 AND g.id=$2
    ON CONFLICT (organization_id,reversal_id,original_evidence_id) DO NOTHING`,[organizationId,reversalId,actorUserId]);
}
