import type { Express,RequestHandler } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../../db';
import { getActiveOrganizationId } from '../../organization-context';
import { sendError,sendOk } from '../../api-response';

type Auth={ensureAuthenticated:RequestHandler;ensurePermission:(resource:string,action:string)=>RequestHandler};
const query=z.object({through:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const date=new Date(`${s}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===s;}),page:z.coerce.number().int().positive().default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)}).strict();

export function registerAvailabilityRoutes(app:Express,auth:Auth) {
  app.get('/api/v2/inventory/items/:itemId/availability',auth.ensureAuthenticated,auth.ensurePermission('inventory','read'),async(req,res)=>{
    let client:PoolClient|undefined;
    try {
      const q=query.parse(req.query),org=getActiveOrganizationId(),item=z.coerce.number().int().positive().parse(req.params.itemId);
      const user=z.number().int().positive().parse((req as typeof req&{user?:{id:number}}).user?.id);
      client=await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const owned=await client.query('SELECT id FROM inventory_items WHERE organization_id=$1 AND id=$2',[org,item]);
      if(!owned.rowCount){await client.query('ROLLBACK');sendError(res,404,'AVAILABILITY_ITEM_NOT_FOUND','Item not found.');return;}
      const scope=await client.query(`SELECT u.id FROM users u
        JOIN organization_members om ON om.user_id=u.id AND om.organization_id=$1 AND om.active=true AND om.status='active'
        WHERE u.id=$2 AND u.warehouse_id IS NULL`,[org,user]);
      if(!scope.rowCount){await client.query('ROLLBACK');sendError(res,403,'AVAILABILITY_SCOPE_REQUIRED','Organization-wide projection requires all-warehouse access.');return;}
      // Purchase order lines are the inbound authority. ASN/shipment mirrors are
      // deliberately not added as independent supply, even if there are many.
      const source=`FROM purchase_order_items l JOIN purchase_orders p ON p.id=l.order_id
        WHERE p.organization_id=$1 AND l.item_id=$2 AND l.line_type='CATALOG'
        AND upper(p.approval_status)='APPROVED' AND upper(p.status) IN ('APPROVED','SENT','ACKNOWLEDGED','PARTIALLY_RECEIVED')
        AND l.quantity>COALESCE(l.received_quantity,0)`;
      const summary=await client.query(`WITH stock AS (
        SELECT i.quantity::numeric master,COALESCE(i.safety_hold,false) held,
          COALESCE((SELECT sum(w.quantity)::numeric FROM warehouse_inventory w WHERE w.organization_id=$1 AND w.item_id=$2),0) on_hand
        FROM inventory_items i WHERE i.organization_id=$1 AND i.id=$2
      ), demand AS (
        SELECT COALESCE(sum(quantity)::numeric,0) reserved FROM inventory_allocations WHERE organization_id=$1 AND item_id=$2 AND status='reserved'
      ), supply AS (
        SELECT COALESCE(sum((l.quantity-COALESCE(l.received_quantity,0))::numeric) FILTER(WHERE p.expected_delivery_date<($3::date+1)),0) dated,
          COALESCE(sum((l.quantity-COALESCE(l.received_quantity,0))::numeric) FILTER(WHERE p.expected_delivery_date IS NULL),0) undated,
          COALESCE(sum((l.quantity-COALESCE(l.received_quantity,0))::numeric) FILTER(WHERE p.expected_delivery_date<($3::date+1) AND NOT EXISTS(
            SELECT 1 FROM inventory_inspection_rules r WHERE r.organization_id=$1 AND r.required AND ((r.subject_type='item' AND r.subject_id=$2) OR (r.subject_type='supplier' AND r.subject_id=p.supplier_id))
          )),0) eligible ${source}
      ) SELECT on_hand::text AS "onHand",master::text AS "masterQuantity",(master-on_hand)::text AS "unassignedQuantity",
        held AS "itemHeld",reserved::text AS reserved,(CASE WHEN held THEN 0 ELSE on_hand-reserved END)::text AS "availableNow",
        dated::text AS "datedInbound",undated::text AS "undatedInbound",(dated-eligible)::text AS "inspectionInbound",
        CASE WHEN master<>on_hand THEN NULL ELSE (CASE WHEN held THEN 0 ELSE on_hand-reserved+eligible END)::text END AS "knownProjectedAvailable",
        master=on_hand AS "reconciled" FROM stock CROSS JOIN demand CROSS JOIN supply`,[org,item,q.through]);
      const lines=await client.query(`SELECT l.id AS "poLineId",p.id AS "poId",p.order_number AS "poNumber",p.expected_delivery_date AS "expectedDate",(l.quantity-COALESCE(l.received_quantity,0))::text AS quantity,
        EXISTS(SELECT 1 FROM inventory_inspection_rules r WHERE r.organization_id=$1 AND r.required AND ((r.subject_type='item' AND r.subject_id=$2) OR (r.subject_type='supplier' AND r.subject_id=p.supplier_id))) AS "inspectionRequired"
        ${source} ORDER BY p.expected_delivery_date NULLS LAST,l.id LIMIT $3 OFFSET $4`,[org,item,q.pageSize,(q.page-1)*q.pageSize]);
      const count=await client.query(`SELECT count(*)::int total ${source}`,[org,item]);
      await client.query('COMMIT');
      sendOk(res,{...summary.rows[0],through:q.through,items:lines.rows,total:count.rows[0].total,page:q.page,pageSize:q.pageSize,
        scope:'organization',basis:'approved_po_remaining',reservationTiming:'All active reservations are deducted once now; no delivery date is inferred for demand.',
        notice:'Planning estimate, not allocation authority. Excludes undated inbound and inspection-dependent supply; held items remain unavailable. PO/ASN/shipment representations are counted only through PO lines. Receipt, put-away and quality checks still govern actual availability.'});
    }catch(error){await client?.query('ROLLBACK').catch(()=>undefined);sendError(res,error instanceof z.ZodError?400:500,'AVAILABILITY_QUERY_FAILED',error instanceof z.ZodError?'Use a valid date and page size.':'Availability could not be verified. Retry after checking migrations.');}
    finally{client?.release();}
  });
}
