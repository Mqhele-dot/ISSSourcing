/** Compatibility AP smoke: staged capture, independently approved requisition,
 * PO/receipt, invoice matching, approval and recorded-payment release.
 * Enabled Build 4 enforcement is verified separately without legacy overrides.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {pool} from "../server/db";
import {assertMatchedDisposableDatabaseUrls} from "../server/config/database-safety";
import {exitTest} from "./test-exit";
import {apiJsonRequest,loginForTests} from "./test-http";
import {ensureWorkflowFixture,createSentWorkflowPo,receiveWorkflowPo,unwrapData as envelopeData} from "./workflow-proof-fixtures";

function unwrapData<T>(value:unknown,label:string):T{
 // Compatibility reads deliberately retain their original unwrapped contracts.
 if(value&&typeof value==="object"&&"ok" in value)return envelopeData<T>(value,label);
 assert.ok(value&&typeof value==="object",`${label}: expected a JSON object or array`);
 return value as T;
}

async function main(){
 assertMatchedDisposableDatabaseUrls(process.env.DATABASE_URL,process.env.TEST_DATABASE_URL);
 assert.equal((await pool.query("SELECT current_database() name")).rows[0].name,new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
 const cookie=await loginForTests("admin","Admin123!");assert.ok(cookie,"seeded admin login required");
 const fixture=await ensureWorkflowFixture("ap-compat"),suffix=randomUUID();
 const request=async(path:string,status:number,body?:unknown)=>{
  const res=await apiJsonRequest(path,{cookie,...(body===undefined?{}:{method:"POST",body})});
  assert.equal(res.status,status,`${path}: ${res.status} ${JSON.stringify(res.json)}`);assert.ok(res.requestId,`${path} needs a request ID`);
  console.log(`Verified ${path}: ${res.status}`);return res;
 };
 const suppliers=unwrapData<Array<{id:number}>>((await request("/suppliers",200)).json,"suppliers");assert.ok(suppliers.some(s=>s.id===fixture.supplierId));
 const items=unwrapData<Array<{id:number}>>((await request("/inventory",200)).json,"inventory");assert.ok(items.some(i=>i.id===fixture.itemId));
 for(const entityType of ["invoice","payment_batch"]){
  const policy=await apiJsonRequest("/approval-policies",{cookie,method:"POST",body:{name:`AP compatibility ${entityType} ${suffix}`,entityType,amountMin:0,amountMax:1000000,approvalLevel:1,approverRole:"admin",isActive:true}});
  const error=(policy.json as {error?:{code?:string}})?.error;
  assert.ok(policy.status===201||policy.status===409&&error?.code==="APPROVAL_POLICY_OVERLAP",`Configure policy: ${JSON.stringify(policy.json)}`);
 }
 const capture=unwrapData<{id:number}>((await request("/ap/captures",201,{supplierId:fixture.supplierId,source:"document_extractor",invoiceNumber:`CAP-${suffix}`,totalAmount:125,confidenceScore:0.97,reviewerNotes:"Synthetic compatibility capture",extractedHeader:{synthetic:true},extractedLines:[]})).json,"capture");
 assert.ok(capture.id);await request(`/ap/captures/${capture.id}/promote`,200,{});
 // Shared fixture issues real create/submit/independent approval/conversion
 // commands with authoritative dimensions and test-owned dispatch evidence.
 const po=await createSentWorkflowPo(cookie,fixture,2);
 const detail=unwrapData<{items:Array<{id:number}>}>((await request(`/purchase-orders/${po.poId}`,200)).json,"PO detail");
 assert.ok(detail.items.some(line=>line.id===po.poItemId));
 const receipt=await receiveWorkflowPo(cookie,po.poNumber,fixture,2,`GRN-${suffix}`);
 assert.equal(receipt.status,200,`receive PO: ${JSON.stringify(receipt.json)}`);assert.ok(receipt.requestId);
 const invoice=unwrapData<{id:number}>((await request("/invoices",201,{supplierId:fixture.supplierId,purchaseOrderId:po.poId,invoiceNumber:`INV-${suffix}`,issueDate:new Date().toISOString(),dueDate:new Date(Date.now()+14*86400000).toISOString(),status:"DRAFT",subtotal:200,tax:0,total:200,dueAmount:200,
  items:[{itemId:fixture.itemId,description:"Synthetic received goods",quantity:2,unitPrice:100,taxRate:0,taxAmount:0,totalPrice:200}]})).json,"invoice");
 assert.ok(invoice.id);
 const match=unwrapData<{matched:boolean}>((await request(`/ap/invoices/${invoice.id}/match`,200,{priceTolerancePct:0,quantityTolerancePct:0,taxTolerancePct:0})).json,"match");assert.equal(match.matched,true);
 await request(`/ap/invoices/${invoice.id}/submit-approval`,200,{});
 // Compatibility mode is disabled for the independently governed Build 4 tests.
 const override={adminOverride:true,overrideReason:"Disposable compatibility control; not Build 4 enabled authority"};
 await request(`/ap/invoices/${invoice.id}/approve`,200,override);
 assert.equal((await pool.query("SELECT status::text FROM invoices WHERE organization_id=1 AND id=$1",[invoice.id])).rows[0].status,"APPROVED");
 const batch=unwrapData<{id:number}>((await request("/ap/payment-batches",201,{paymentMethod:"BANK_TRANSFER",invoiceIds:[invoice.id]})).json,"payment batch");assert.ok(batch.id);
 await request(`/ap/payment-batches/${batch.id}/approve`,200,override);
 await request(`/ap/payment-batches/${batch.id}/release`,200,override);
 const balance=(await pool.query("SELECT paid_amount,due_amount,status::text FROM invoices WHERE organization_id=1 AND id=$1",[invoice.id])).rows[0];
 assert.deepEqual(balance,{paid_amount:200,due_amount:0,status:"PAID"});
 assert.equal((await pool.query("SELECT count(*)::int n FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.organization_id=1 AND i.id=$1",[invoice.id])).rows[0].n,1);
 await request("/ap/overview",200);
 console.log("AP capture → requisition approval → PO → receipt → matched invoice → recorded payment parity passed. Not proof of bank settlement.");
}
main().then(()=>exitTest(0)).catch(error=>{console.error(error);exitTest(1);}).finally(()=>pool.end());
