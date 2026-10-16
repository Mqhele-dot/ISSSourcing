import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../../db";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
export const stockCommandSchema=z.object({
  itemId:z.coerce.number().int().positive(),warehouseId:z.coerce.number().int().positive().optional(),
  sourceWarehouseId:z.coerce.number().int().positive().optional(),destinationWarehouseId:z.coerce.number().int().positive().optional(),
  quantity:z.coerce.number().int().positive().max(2147483647),reason:z.string().trim().max(2000).optional(),notes:z.string().trim().max(2000).optional(),
  referenceId:z.coerce.number().int().positive().nullable().optional(),referenceType:z.string().max(100).nullable().optional(),unitCost:z.coerce.number().nonnegative().nullable().optional(),
});
export async function executeStockCommand(org:number,user:number,key:string,kind:"TRANSFER"|"RECEIPT"|"ISSUE",body:z.infer<typeof stockCommandSchema>) {
  const data=stockCommandSchema.parse(body),client=await pool.connect();
  const fingerprint=createHash("sha256").update(JSON.stringify({user,kind,data})).digest("hex");
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:stock:${key}`]);
    const old=await client.query("SELECT response FROM workflow_idempotency WHERE organization_id=$1 AND idempotency_key=$2",[org,key]);
    if(old.rowCount){if(old.rows[0].response?.fingerprint!==fingerprint)throw new Error("STOCK_IDEMPOTENCY_CONFLICT");await client.query("COMMIT");return old.rows[0].response.movement;}
    if(kind==="RECEIPT")await client.query("SELECT assert_unlinked_receipt_inspection($1,$2)",[org,data.itemId]);
    const from=kind==="TRANSFER"?data.sourceWarehouseId:kind==="ISSUE"?data.warehouseId:null;
    const to=kind==="TRANSFER"?data.destinationWarehouseId:kind==="RECEIPT"?data.warehouseId:null;
    if((kind!=="RECEIPT"&&!from)||(kind!=="ISSUE"&&!to)||from===to)throw new Error("STOCK_INVALID_WAREHOUSE");
    const item=await client.query("SELECT id FROM inventory_items WHERE id=$1 AND organization_id=$2 FOR UPDATE",[data.itemId,org]);
    if(!item.rowCount)throw new Error("STOCK_ITEM_NOT_FOUND");
    for(const id of [from,to].filter((x):x is number=>!!x)) {
      const scope=await client.query(`SELECT w.id FROM warehouses w
        JOIN organization_members om ON om.organization_id=w.organization_id AND om.user_id=$3 AND om.active=true AND om.status='active'
        JOIN users u ON u.id=om.user_id
        WHERE w.organization_id=$1 AND w.id=$2 AND (u.warehouse_id IS NULL OR u.warehouse_id=w.id)`,[org,id,user]);
      if(!scope.rowCount)throw new Error("STOCK_WAREHOUSE_DENIED");
    }
    const positions=await client.query("SELECT id,warehouse_id,quantity FROM warehouse_inventory WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=ANY($3::int[]) ORDER BY warehouse_id,id FOR UPDATE",[org,data.itemId,[from,to].filter(Boolean)]);
    const source=positions.rows.find(x=>x.warehouse_id===from),destination=positions.rows.find(x=>x.warehouse_id===to);
    if(from) {
      const reserved=await client.query("SELECT COALESCE(sum(quantity),0)::numeric::text quantity FROM inventory_allocations WHERE organization_id=$1 AND item_id=$2 AND (warehouse_id=$3 OR warehouse_id IS NULL) AND status='reserved'",[org,data.itemId,from]);
      if(!source||Number(source.quantity)-Number(reserved.rows[0].quantity)<data.quantity)throw new Error("STOCK_INSUFFICIENT_ELIGIBLE");
      await client.query("UPDATE warehouse_inventory SET quantity=quantity-$1,updated_at=now() WHERE id=$2",[data.quantity,source.id]);
    }
    if(to) {
      if(destination)await client.query("UPDATE warehouse_inventory SET quantity=quantity+$1,updated_at=now() WHERE id=$2",[data.quantity,destination.id]);
      else await client.query("INSERT INTO warehouse_inventory(organization_id,warehouse_id,item_id,quantity) VALUES($1,$2,$3,$4)",[org,to,data.itemId,data.quantity]);
    }
    const delta=kind==="TRANSFER"?0:kind==="RECEIPT"?data.quantity:-data.quantity;
    if(delta)await client.query("UPDATE inventory_items SET quantity=quantity+$1,updated_at=now() WHERE id=$2 AND organization_id=$3",[delta,data.itemId,org]);
    const before=Number((from?source:destination)?.quantity??0),after=before+(from?-data.quantity:data.quantity);
    const result=await client.query(`INSERT INTO stock_movements(organization_id,item_id,warehouse_id,source_warehouse_id,destination_warehouse_id,type,quantity,reference_id,reference_type,notes,user_id,previous_quantity,new_quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[org,data.itemId,from??to,from,to,kind,kind==="ISSUE"?-data.quantity:data.quantity,data.referenceId??null,data.referenceType??null,data.reason??data.notes??null,user,before,after,data.unitCost??null]);
    const movement=Object.fromEntries(Object.entries(result.rows[0]).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),v]));
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:`STOCK_${kind}`,resourceType:"stock_movement",resourceId:Number(movement.id),after:movement,reason:data.reason??data.notes});
    await client.query("INSERT INTO event_outbox(organization_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'inventory_item',$2,$3,$4::jsonb)",[org,String(data.itemId),`STOCK_${kind}`,JSON.stringify(movement)]);
    await client.query("INSERT INTO workflow_idempotency(organization_id,idempotency_key,action,resource_type,resource_id,response) VALUES($1,$2,$3,'stock_movement',$4,$5::jsonb)",[org,key,`STOCK_${kind}`,movement.id,JSON.stringify({fingerprint,movement})]);
    await client.query("COMMIT");return movement;
  } catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
