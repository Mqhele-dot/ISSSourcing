import assert from 'node:assert/strict';
import {z} from 'zod';
import {fromZodError} from 'zod-validation-error';
import {inventoryItemFormSchema,supplierContractFormSchema,insertInventoryItemSchema,insertSupplierContractSchema,insertPurchaseRequisitionSchema,insertApprovalPolicySchema,insertInvoiceSchema} from '../shared/schema';
import {createTrackedAssetBodySchema,patchTrackedAssetBodySchema} from '../server/modules/assets/validators';
import {syncBatchBodySchema} from '../server/modules/sync/validators';

const item=inventoryItemFormSchema.parse({name:'Migration test item',sku:'MIGRATION-TEST',quantity:'3',price:'12.50'});
assert.equal(item.quantity,3);assert.equal(item.price,12.5);
assert.equal(inventoryItemFormSchema.safeParse({name:'Invalid',sku:'INVALID',quantity:1.5,price:1}).success,false);
assert.equal(inventoryItemFormSchema.safeParse({name:'Invalid',sku:'INVALID',quantity:1,price:Infinity}).success,false);
for(const [name,schema]of Object.entries({inventory:insertInventoryItemSchema,contract:insertSupplierContractSchema,requisition:insertPurchaseRequisitionSchema,approval:insertApprovalPolicySchema,invoice:insertInvoiceSchema})) {
  assert.deepEqual(schema.partial().parse({}),{},`${name}: an empty patch must not invent defaults or reset lifecycle fields`);
}
const contract=supplierContractFormSchema.parse({title:'Migration test agreement',supplierId:1,startDate:'2026-01-01'});
assert.ok(contract.startDate instanceof Date);assert.equal(contract.status,'draft');
assert.equal(supplierContractFormSchema.safeParse({title:'Invalid agreement',supplierId:1,startDate:'2026-02-01',endDate:'2026-01-01'}).success,false);
assert.deepEqual(createTrackedAssetBodySchema.parse({assetType:'test',metadata:{evidence:'kept',count:2}}).metadata,{evidence:'kept',count:2});
assert.deepEqual(patchTrackedAssetBodySchema.parse({}),{});
assert.deepEqual(syncBatchBodySchema.parse({actions:[{type:'scan',idempotencyKey:'test-owned-action'}]}).actions[0].payload,{});
assert.equal(syncBatchBodySchema.safeParse({actions:Array.from({length:51},(_,i)=>({type:'scan',idempotencyKey:`test-owned-${i}`}))}).success,false);
const invalid=z.object({name:z.string().min(2)}).safeParse({name:''});
assert.equal(invalid.success,false);
if(!invalid.success){assert.ok(invalid.error.issues.length);assert.ok(fromZodError(invalid.error).message.length);}
console.log('Zod 4 migration contracts passed: coercion, finite/indivisible values, empty patch/lifecycle preservation, dates, records, bounded offline batches and readable validation errors.');
