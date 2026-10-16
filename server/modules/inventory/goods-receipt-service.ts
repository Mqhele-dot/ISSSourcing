import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../../db";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";

const lineSchema=z.object({sku:z.string().trim().min(1),purchaseOrderItemId:z.number().int().positive().optional(),qty_received_now:z.number().int().positive().max(2147483647),batch_number:z.string().trim().max(256).optional(),serial_numbers:z.array(z.string().trim().min(1).max(128)).max(200).optional()}).strict();
export const goodsReceiptSchema=z.object({
  orderId:z.number().int().positive(),warehouseId:z.number().int().positive(),key:z.string().min(8).max(128),
  lines:z.array(lineSchema).min(1).max(100),location:z.string().max(500).nullable(),
  notes:z.string().trim().max(2000).optional(),
  receivedAt:z.date().optional(),shipmentId:z.number().int().positive().nullable().optional(),grnNumber:z.string().trim().min(1).max(100).nullable().optional(),
});
export async function postGoodsReceipt(org:number,user:number,input:z.infer<typeof goodsReceiptSchema>) {
  const data=goodsReceiptSchema.parse(input),client=await pool.connect();
  const fingerprint=createHash("sha256").update(JSON.stringify({org,user,data})).digest("hex");
  try {
    await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:receipt:${data.key}`]);
    // A policy save and receipt must not race; absent rules are protected too.
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",[`${org}:inspection-policy`]);
    const replay=await client.query("SELECT response FROM workflow_idempotency WHERE organization_id=$1 AND idempotency_key=$2",[org,data.key]);
    if(replay.rowCount){if(replay.rows[0].response.fingerprint!==fingerprint)throw new Error("RECEIPT_IDEMPOTENCY_CONFLICT");await client.query("COMMIT");return replay.rows[0].response.result as ReceiptResult;}
    const poResult=await client.query("SELECT id,order_number,supplier_id,status,approval_status FROM purchase_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,data.orderId]);
    const po=poResult.rows[0];if(!po)throw new Error("po_not_found");
    if(!["APPROVED","SENT","ACKNOWLEDGED","PARTIALLY_RECEIVED"].includes(String(po.status).toUpperCase())||String(po.approval_status).toUpperCase()!=="APPROVED")throw new Error("invalid_receive_state");
    const wh=await client.query(`SELECT w.id,w.name FROM warehouses w
      JOIN organization_members om ON om.organization_id=w.organization_id AND om.user_id=$3 AND om.active=true AND om.status='active'
      JOIN users u ON u.id=om.user_id
      WHERE w.id=$2 AND w.organization_id=$1 AND (u.warehouse_id IS NULL OR u.warehouse_id=w.id)`,[org,data.warehouseId,user]);
    if(!wh.rowCount)throw new Error("RECEIPT_WAREHOUSE_DENIED");
    const rows=await client.query(`SELECT p.id,p.item_id,p.quantity,COALESCE(p.received_quantity,0) received_quantity,p.line_type,i.sku FROM purchase_order_items p LEFT JOIN inventory_items i ON i.id=p.item_id AND i.organization_id=$1 WHERE p.order_id=$2 ORDER BY p.item_id,p.id FOR UPDATE OF p`,[org,data.orderId]);
    const seen=new Set<string>(),serials=new Set<string>();
    const selected=data.lines.map(line=>{
      const matches=rows.rows.filter(r=>r.sku===line.sku&&r.line_type==="CATALOG"&&(line.purchaseOrderItemId==null||r.id===line.purchaseOrderItemId));
      if(matches.length!==1)throw new Error("RECEIPT_AMBIGUOUS_OR_UNKNOWN_LINE");
      const lineKey=String(matches[0].id);
      if(seen.has(lineKey))throw new Error("RECEIPT_DUPLICATE_LINE");seen.add(lineKey);
      const row=matches[0];if(line.qty_received_now>Number(row.quantity)-Number(row.received_quantity))throw new Error(`receive_exceeds_remaining:${line.sku}`);
      if(line.serial_numbers?.length&&line.serial_numbers.length!==line.qty_received_now)throw new Error("RECEIPT_SERIAL_QUANTITY_MISMATCH");
      for(const serial of line.serial_numbers??[]){if(serials.has(serial))throw new Error("RECEIPT_DUPLICATE_SERIAL");serials.add(serial);}
      return {...line,row};
    }).sort((a,b)=>a.row.item_id-b.row.item_id);
    if(data.shipmentId){const shipment=await client.query("SELECT id FROM shipments WHERE organization_id=$1 AND id=$2 AND po_number=$3 AND lower(status)<>'cancelled' FOR UPDATE",[org,data.shipmentId,po.order_number]);if(!shipment.rowCount)throw new Error("shipment_not_found_for_po");}
    const rec=await client.query("INSERT INTO ap_receipts(organization_id,receipt_number,purchase_order_id,supplier_id,status,received_date,received_by,notes) VALUES($1,$2,$3,$4,'POSTED',$5,$6,$7) RETURNING id",[org,data.grnNumber??`GRN-${data.orderId}-${createHash("sha256").update(data.key).digest("hex").slice(0,20)}`,data.orderId,po.supplier_id,data.receivedAt??new Date(),user,data.notes??"Canonical goods receipt"]);
    const receiptId=Number(rec.rows[0].id),changes:ReceiptResult["inventoryChanges"]=[];
    for(const line of selected){
      await client.query("SELECT id FROM inventory_items WHERE id=$1 AND organization_id=$2 FOR UPDATE",[line.row.item_id,org]);
      const position=await client.query("SELECT id,quantity FROM warehouse_inventory WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 ORDER BY id FOR UPDATE",[org,line.row.item_id,data.warehouseId]);
      if((position.rowCount??0)>1)throw new Error("RECEIPT_POSITION_RECONCILIATION_REQUIRED");
      const before=Number(position.rows[0]?.quantity??0),after=before+line.qty_received_now;
      if(position.rowCount)await client.query("UPDATE warehouse_inventory SET quantity=$1,updated_at=now() WHERE id=$2",[after,position.rows[0].id]);
      else await client.query("INSERT INTO warehouse_inventory(organization_id,warehouse_id,item_id,quantity) VALUES($1,$2,$3,$4)",[org,data.warehouseId,line.row.item_id,after]);
      await client.query("UPDATE inventory_items SET quantity=quantity+$1,updated_at=now() WHERE organization_id=$2 AND id=$3",[line.qty_received_now,org,line.row.item_id]);
      await client.query("UPDATE purchase_order_items SET received_quantity=COALESCE(received_quantity,0)+$1 WHERE id=$2 AND order_id=$3",[line.qty_received_now,line.row.id,data.orderId]);
      const ri=await client.query("INSERT INTO ap_receipt_items(receipt_id,purchase_order_item_id,item_id,quantity,accepted_quantity,rejected_quantity) VALUES($1,$2,$3,$4,$4,0) RETURNING id",[receiptId,line.row.id,line.row.item_id,line.qty_received_now]);
      const rules=await client.query("SELECT subject_type,revision FROM inventory_inspection_rules WHERE organization_id=$1 AND required AND ((subject_type='item' AND subject_id=$2) OR (subject_type='supplier' AND subject_id=$3))",[org,line.row.item_id,po.supplier_id]);
      if(rules.rowCount) {
        const hold=await client.query("INSERT INTO inventory_safety_holds(organization_id,item_id,kind,reason,created_by,request_key) VALUES($1,$2,'INSPECTION',$3,$4,$5) RETURNING id",[org,line.row.item_id,`Receipt ${receiptId}, line ${ri.rows[0].id} requires inspection. Conservative item-wide hold.`,user,randomUUID()]);
        await client.query("INSERT INTO receipt_inspection_evidence(organization_id,receipt_item_id,hold_id,item_rule_revision,supplier_rule_revision) VALUES($1,$2,$3,$4,$5)",[org,ri.rows[0].id,hold.rows[0].id,rules.rows.find(r=>r.subject_type==="item")?.revision??null,rules.rows.find(r=>r.subject_type==="supplier")?.revision??null]);
        await client.query("UPDATE inventory_items SET safety_hold=true WHERE organization_id=$1 AND id=$2",[org,line.row.item_id]);
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"RECEIPT_INSPECTION_REQUIRED",resourceType:"ap_receipt",resourceId:receiptId,after:{itemId:line.row.item_id,receiptItemId:ri.rows[0].id,holdId:hold.rows[0].id,rules:rules.rows,scope:"item_wide"}});
      }
      await client.query("INSERT INTO stock_movements(organization_id,item_id,warehouse_id,type,quantity,reference_id,reference_type,notes,user_id,previous_quantity,new_quantity) VALUES($1,$2,$3,'RECEIPT',$4,$5,'ap_receipt',$6,$7,$8,$9)",[org,line.row.item_id,data.warehouseId,line.qty_received_now,receiptId,`PO ${po.order_number}`,user,before,after]);
      await client.query("INSERT INTO inventory_putaway_tasks(organization_id,task_number,receipt_id,receipt_item_id,warehouse_id,item_id,quantity,from_location,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[org,`PA-${receiptId}-${ri.rows[0].id}`,receiptId,ri.rows[0].id,data.warehouseId,line.row.item_id,line.qty_received_now,data.location??wh.rows[0].name,user]);
      if(line.batch_number){
        const batch=await client.query("SELECT id FROM inventory_batches WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND batch_number=$4 FOR UPDATE",[org,line.row.item_id,data.warehouseId,line.batch_number]);
        if((batch.rowCount??0)>1)throw new Error("RECEIPT_AMBIGUOUS_BATCH");
        if(batch.rowCount)await client.query("UPDATE inventory_batches SET quantity_received=quantity_received+$1,quantity_on_hand=quantity_on_hand+$1,updated_at=now() WHERE id=$2",[line.qty_received_now,batch.rows[0].id]);
        else await client.query("INSERT INTO inventory_batches(organization_id,item_id,warehouse_id,batch_number,quantity_received,quantity_on_hand) VALUES($1,$2,$3,$4,$5,$5)",[org,line.row.item_id,data.warehouseId,line.batch_number,line.qty_received_now]);
      }
      for(const serial of line.serial_numbers??[])await client.query("INSERT INTO inventory_serials(organization_id,item_id,warehouse_id,serial_number,status,current_location) VALUES($1,$2,$3,$4,'available',$5)",[org,line.row.item_id,data.warehouseId,serial,data.location]);
      const eligibility=await client.query("SELECT COALESCE((to_jsonb(i)->>'safety_hold')::boolean,false) held,(SELECT COALESCE(sum(quantity),0) FROM inventory_allocations WHERE organization_id=$1 AND item_id=$2 AND (warehouse_id=$3 OR warehouse_id IS NULL) AND status='reserved') reserved FROM inventory_items i WHERE id=$2 AND organization_id=$1",[org,line.row.item_id,data.warehouseId]);
      changes.push({sku:line.sku,location:data.location??wh.rows[0].name,delta:line.qty_received_now,onHand:after,available:eligibility.rows[0].held?0:after-Number(eligibility.rows[0].reserved)});
    }
    const pending=await client.query("SELECT count(*)::int count FROM purchase_order_items WHERE order_id=$1 AND COALESCE(received_quantity,0)<quantity",[data.orderId]);
    const fullyReceived=pending.rows[0].count===0;
    await client.query("UPDATE purchase_orders SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3",[fullyReceived?"RECEIVED":"PARTIALLY_RECEIVED",data.orderId,org]);
    // Receiving one shipment does not prove that other shipments were delivered.
    if(data.shipmentId&&data.grnNumber)await client.query("UPDATE shipments SET grn_number=$1,updated_at=now() WHERE id=$2 AND organization_id=$3",[data.grnNumber,data.shipmentId,org]);
    const result:ReceiptResult={receiptId,inventoryChanges:changes,shipmentUpdates:[],mismatchExceptions:[]};
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"GOODS_RECEIPT_POSTED",resourceType:"ap_receipt",resourceId:receiptId,after:{...result,purchaseOrderId:data.orderId,warehouseId:data.warehouseId}});
    await client.query("INSERT INTO event_outbox(organization_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'ap_receipt',$2,'GOODS_RECEIPT_POSTED',$3::jsonb)",[org,String(receiptId),JSON.stringify({...result,purchaseOrderId:data.orderId,targetPath:"/procurement/receiving"})]);
    await client.query("INSERT INTO workflow_idempotency(organization_id,idempotency_key,action,resource_type,resource_id,response) VALUES($1,$2,'GOODS_RECEIPT','ap_receipt',$3,$4::jsonb)",[org,data.key,receiptId,JSON.stringify({fingerprint,result})]);
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
type ReceiptResult={receiptId:number;inventoryChanges:Array<{sku:string;location:string;delta:number;onHand:number;available:number}>;shipmentUpdates:Array<{shipmentId:number;toStatus:string}>;mismatchExceptions:Array<{id:number;sku:string;created:boolean}>};
