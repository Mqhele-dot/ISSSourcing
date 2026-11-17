import type {Pool,PoolClient} from "pg";
import {rm} from "node:fs/promises";
import {createCompactSupplierReader} from "./compact-supplier-reader";
import {captureCompactDataset} from "./capture-compact-dataset";
import {createCompactProcurementReader} from "./compact-procurement-reader";
import {createCompactActivityReader} from "./compact-activity-reader";
import {createCompactLogisticsReader} from "./compact-logistics-reader";
import {createCompactRecordReader} from "./compact-record-reader";

/** Owns and closes the source observation before returning a completed capture.
 * No compression, worker launch, export-job mutation or publication occurs here.
 */
export async function captureOperationalCompact(database:Pool,input:{dataset:string;organizationId:number;actorId:number;root:string;filters:Record<string,unknown>;columns?:string[];authorize:(client?:PoolClient)=>Promise<void>;signal?:AbortSignal;quotaBytes?:number;utcTimestampEvidence?:string}){
  if(!['suppliers','purchase_orders','purchase_requisitions','activity_logs','shipments','po_delivery_comparison','inventory','reorder_requests','invoices'].includes(input.dataset))throw new Error("This operational dataset does not have a verified compact reader yet.");
  input.signal?.throwIfAborted();await input.authorize();
  const client=await database.connect();let capture:Awaited<ReturnType<typeof captureCompactDataset>>|undefined;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
    const scoped={...input,authorize:()=>input.authorize(client)};
    const reader=input.dataset==='suppliers'?await createCompactSupplierReader(client,scoped):input.dataset==='activity_logs'?await createCompactActivityReader(client,scoped):['shipments','po_delivery_comparison'].includes(input.dataset)?await createCompactLogisticsReader(client,scoped):['inventory','reorder_requests','invoices'].includes(input.dataset)?await createCompactRecordReader(client,scoped):await createCompactProcurementReader(client,scoped);
    capture=await captureCompactDataset(reader,input);input.signal?.throwIfAborted();
    await client.query('COMMIT');await input.authorize(client);input.signal?.throwIfAborted();return capture;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(capture)await rm(capture.directory,{recursive:true,force:true});throw error;}
  finally{client.release();}
}
