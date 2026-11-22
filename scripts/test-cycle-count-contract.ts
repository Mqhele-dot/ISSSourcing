import assert from "node:assert/strict";
import { assertCountAction, countCreateSchema, countEntrySchema, countPageSchema } from "../server/modules/cycle-counts/count-contract";
import { wholeStockQuantity } from "../server/modules/inventory-flow/whole-stock-quantity";

assert.deepEqual(countPageSchema.parse({}),{page:1,pageSize:25});
for(const pageSize of [25,50,100]) assert.equal(countPageSchema.parse({pageSize:String(pageSize)}).pageSize,pageSize);
for(const value of [{page:0},{pageSize:500},{pageSize:26},{page:"no"}]) assert.equal(countPageSchema.safeParse(value).success,false);
assert.equal(countCreateSchema.safeParse({warehouseId:1,organizationId:2}).success,false);
for(const value of [{countedQuantity:1,systemQuantity:100},{countedQuantity:1,variance:-99},{countedQuantity:0.25},{countedQuantity:-1},{countedQuantity:Infinity}]) assert.equal(countEntrySchema.safeParse(value).success,false);
assert.equal(countEntrySchema.parse({countedQuantity:0}).countedQuantity,0);
for(const state of ["completed","POSTED","CANCELLED"]) for(const action of ["start","submit","approve","post","recount","cancel"]) assert.throws(()=>assertCountAction(state,action,1,2));
assert.throws(()=>assertCountAction("PENDING_APPROVAL","approve",1,1),/SELF_APPROVAL/);
assert.throws(()=>assertCountAction("COUNTING","submit",1,2),/COUNTER_REQUIRED/);
assertCountAction("COUNTING","submit",1,1);
assertCountAction("PENDING_APPROVAL","approve",1,2);
assertCountAction("APPROVED","post",1,1);
assert.equal(wholeStockQuantity("10.000"),10);
for(const quantity of [0,-1,0.25,"2.9","",null,{},Infinity]) assert.throws(()=>wholeStockQuantity(quantity));
console.log("Cycle count contract checks passed.");
