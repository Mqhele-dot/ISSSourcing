import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool } from 'pg';
type Call=(path:string,method?:string,body?:unknown,actor?:number)=>Promise<{status:number;body:any}>;
export async function testAvailability(app:Express,pool:Pool,call:Call) {
  await pool.query(`ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date timestamp;
    INSERT INTO suppliers VALUES(3,1);
    INSERT INTO inventory_items(id,organization_id,sku,name,quantity,cost) VALUES(91001,1,'PROJECTION-TEST','Projection item',10,1);
    INSERT INTO warehouse_inventory(organization_id,item_id,warehouse_id,quantity) VALUES(1,91001,1,10);
    INSERT INTO inventory_allocations(organization_id,item_id,warehouse_id,quantity,status) VALUES(1,91001,null,2,'reserved');
    INSERT INTO purchase_orders(id,organization_id,order_number,supplier_id,status,approval_status,expected_delivery_date) VALUES
      (10,1,'PO-SUPPLY',3,'SENT','APPROVED','2026-10-01'),(11,1,'PO-INSPECTION-SUPPLY',1,'SENT','APPROVED','2026-10-01'),
      (12,1,'PO-UNDATED',3,'SENT','APPROVED',null),(13,1,'PO-LATER',3,'SENT','APPROVED','2027-01-01'),
      (14,1,'PO-CANCELLED',3,'CANCELLED','APPROVED','2026-10-01'),(15,2,'PO-FOREIGN-SUPPLY',2,'SENT','APPROVED','2026-10-01');
    INSERT INTO purchase_order_items(id,order_id,item_id,quantity,received_quantity,line_type) VALUES(10,10,91001,10,3,'CATALOG'),(11,11,91001,5,0,'CATALOG'),(12,12,91001,4,0,'CATALOG'),(13,13,91001,2,0,'CATALOG'),(14,14,91001,100,0,'CATALOG'),(15,15,91001,100,0,'CATALOG');
    INSERT INTO shipments VALUES(10,1,'PO-SUPPLY','in_transit',null,now()),(11,1,'PO-SUPPLY','in_transit',null,now());`);
  const {registerAvailabilityRoutes}=await import('../server/modules/inventory-positions/register-availability-routes');
  registerAvailabilityRoutes(app,{ensureAuthenticated:(_req,_res,next)=>next(),ensurePermission:()=>(req,res,next)=>{if(req.get('Actor')==='4'){res.status(403).json({denied:true});return;}next();}});
  const base='/api/v2/inventory/items/91001/availability?through=2026-10-31';
  assert.equal((await call(base,'GET',undefined,3)).status,404);
  assert.equal((await call(base,'GET',undefined,4)).status,403);
  assert.equal((await call(base.replace('2026-10-31','2026-02-30'))).status,400);
  const result=(await call(base)).body.data;
  assert.equal(result.onHand,'10');assert.equal(result.reserved,'2');assert.equal(result.availableNow,'8');
  assert.equal(result.datedInbound,'12');assert.equal(result.undatedInbound,'4');assert.equal(result.inspectionInbound,'5');assert.equal(result.knownProjectedAvailable,'15');assert.equal(result.total,4);
  assert.equal(result.items.filter((r:any)=>r.poId===10).length,1,'Shipment mirrors cannot multiply supply');
  await pool.query("UPDATE users SET warehouse_id=1 WHERE id=2");
  assert.equal((await call(base,'GET',undefined,2)).status,403);
  await pool.query("UPDATE users SET warehouse_id=null WHERE id=2");
  await pool.query("INSERT INTO inventory_safety_holds(organization_id,item_id,kind,reason,created_by,request_key) VALUES(1,91001,'INSPECTION','Projection hold test',1,$1)",[randomUUID()]);
  await pool.query("UPDATE inventory_items SET safety_hold=true WHERE id=91001");
  const held=(await call(base)).body.data;assert.equal(held.availableNow,'0');assert.equal(held.knownProjectedAvailable,'0','Held and reserved is not deducted twice');
  await pool.query('UPDATE inventory_items SET quantity=11 WHERE id=91001');
  const unresolved=(await call(base)).body.data;assert.equal(unresolved.unassignedQuantity,'1');assert.equal(unresolved.knownProjectedAvailable,null);
  await pool.query("INSERT INTO purchase_order_items(id,order_id,item_id,quantity,received_quantity,line_type) SELECT 10000+g,10,91001,1,0,'CATALOG' FROM generate_series(1,5000) g");
  const page=(await call(`${base}&page=2&pageSize=25`)).body.data;assert.equal(page.total,5004);assert.equal(page.items.length,25);
  const again=(await call(`${base}&page=2&pageSize=25`)).body.data;assert.deepEqual(page.items.map((r:any)=>r.poLineId),again.items.map((r:any)=>r.poLineId));
  console.log('Availability passed: tenant/scope/date validation, reservation accounting, PO/shipment deduplication, inspection exclusions, undated evidence, held quantities, unreconciled totals and 5,000-line bounded pagination.');
}
