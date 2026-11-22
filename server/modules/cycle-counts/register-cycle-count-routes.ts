import type { Express, Request, RequestHandler, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { assertCountAction, countActionSchema, countCreateSchema, countEntrySchema, countPageSchema } from "./count-contract";

type Auth = {ensureAuthenticated: RequestHandler; ensurePermission: (resource: string, action: string) => RequestHandler};
const idOf = (value: unknown) => z.coerce.number().int().positive().parse(value);
const actorOf = (req: Request) => idOf((req as Request & {user?: {id: number}}).user?.id);
const header = `id,warehouse_id AS "warehouseId",status,current_attempt AS "currentAttempt",counted_by AS "countedBy",count_date AS "countDate",posted_at AS "postedAt"`;
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function warehouse(client: Pick<PoolClient, "query">, org: number, actor: number, id: number) {
  const result = await client.query(`SELECT w.id FROM warehouses w
    JOIN organization_members om ON om.organization_id=w.organization_id AND om.user_id=$3 AND om.active=true AND om.status='active'
    JOIN users u ON u.id=om.user_id
    WHERE w.id=$2 AND w.organization_id=$1 AND (u.warehouse_id IS NULL OR u.warehouse_id=w.id)`, [org,id,actor]);
  if (!result.rowCount) throw new Error("COUNT_WAREHOUSE_DENIED");
}
async function getCount(client: Pick<PoolClient, "query">, org: number, actor: number, id: number, lock = false) {
  const result = await client.query(`SELECT * FROM cycle_counts WHERE id=$1 AND organization_id=$2${lock ? " FOR UPDATE" : ""}`, [id,org]);
  if (!result.rows[0]) throw new Error("COUNT_NOT_FOUND");
  await warehouse(client, org, actor, result.rows[0].warehouse_id);
  return result.rows[0];
}
async function stale(client: PoolClient, org: number, count: Record<string, any>) {
  // Lock every current position; new/deleted positions also invalidate a whole-warehouse count.
  await client.query(`SELECT id FROM warehouse_inventory WHERE organization_id=$1 AND warehouse_id=$2 ORDER BY id FOR UPDATE`, [org,count.warehouse_id]);
  const result = await client.query(`SELECT EXISTS (
    SELECT 1 FROM cycle_count_attempts a LEFT JOIN warehouse_inventory w ON w.id=a.position_id AND w.organization_id=a.organization_id
    WHERE a.organization_id=$1 AND a.cycle_count_id=$2 AND a.attempt=$3
    AND (w.id IS NULL OR w.count_revision<>a.position_revision OR w.item_id<>a.item_id OR w.warehouse_id<>$4)
    UNION ALL SELECT 1 FROM warehouse_inventory w WHERE w.organization_id=$1 AND w.warehouse_id=$4
    AND NOT EXISTS (SELECT 1 FROM cycle_count_attempts a WHERE a.cycle_count_id=$2 AND a.attempt=$3 AND a.position_id=w.id)
  ) AS stale`, [org,count.id,count.current_attempt,count.warehouse_id]);
  return Boolean(result.rows[0].stale);
}
function failure(res: Response, error: unknown) {
  if ((error as {code?:string})?.code === "40001" || (error as {code?:string})?.code === "40P01") return sendError(res,409,"COUNT_CONCURRENT_CHANGE","Another operation changed stock. Refresh and retry with the same posting key.");
  if ((error as {code?:string})?.code === "23505") return sendError(res,409,"COUNT_DUPLICATE_OPERATION","This posting key or stock adjustment has already been used.");
  if (error instanceof z.ZodError) return sendError(res,400,"INVALID_COUNT_REQUEST","Check the count fields. Expected quantities and variances are server-owned.",{details:error.flatten()});
  const code = error instanceof Error ? error.message : "";
  if (code.startsWith("COUNT_")) return sendError(res,code.endsWith("DENIED") ? 403 : code==="COUNT_NOT_FOUND" ? 404 : 409,code,code.replaceAll("_"," "),{hint:"Refresh the count. If stock changed, request a recount; an independent reviewer must approve nonzero variance."});
  return sendError(res,500,"CYCLE_COUNT_OPERATION_FAILED","The count operation could not be completed. No partial posting was committed.");
}
export function registerCycleCountRoutes(app: Express, auth: Auth) {
  const read = [auth.ensureAuthenticated,auth.ensurePermission("inventory","read")];
  const write = [auth.ensureAuthenticated,auth.ensurePermission("inventory","update")];
  const review = [auth.ensureAuthenticated,auth.ensurePermission("inventory","approve")];
  const bases = ["/api/v2/inventory/cycle-counts","/api/cycle-counts"];
  const wrap = (work: (req: Request,res: Response) => Promise<unknown>): RequestHandler => async(req,res) => {try {await work(req,res);} catch(error) {failure(res,error);}};
  for (const base of bases) {
    app.get(base,...read,wrap(async(req,res)=>{
      const {page,pageSize}=countPageSchema.parse(req.query),org=getActiveOrganizationId(),actor=actorOf(req);
      const params=[org,actor];
      const scope=`organization_id=$1 AND EXISTS (SELECT 1 FROM organization_members om JOIN users u ON u.id=om.user_id WHERE om.organization_id=$1 AND om.user_id=$2 AND om.active=true AND om.status='active' AND (u.warehouse_id IS NULL OR u.warehouse_id=cycle_counts.warehouse_id))`;
      const rows=await pool.query(`SELECT ${header} FROM cycle_counts WHERE ${scope} ORDER BY id DESC LIMIT $3 OFFSET $4`,[...params,pageSize,(page-1)*pageSize]);
      const total=await pool.query(`SELECT count(*)::int total FROM cycle_counts WHERE ${scope}`,params);
      sendOk(res,{items:rows.rows,total:total.rows[0].total,page,pageSize});
    }));
    app.post(base,...write,wrap(async(req,res)=>{
      const {warehouseId}=countCreateSchema.parse(req.body),org=getActiveOrganizationId(),actor=actorOf(req);
      const result=await transaction(async client=>{
        await warehouse(client,org,actor,warehouseId);
        const created=await client.query(`INSERT INTO cycle_counts(organization_id,warehouse_id,status) VALUES($1,$2,'PLANNED') RETURNING ${header}`,[org,warehouseId]);
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor},action:"CYCLE_COUNT_CREATED",resourceType:"cycle_count",resourceId:created.rows[0].id});
        return created.rows[0];
      }); sendOk(res,result);
    }));
    app.get(`${base}/:id`,...read,wrap(async(req,res)=>{
      const org=getActiveOrganizationId(),id=idOf(req.params.id); await getCount(pool,org,actorOf(req),id);
      sendOk(res,(await pool.query(`SELECT ${header} FROM cycle_counts WHERE id=$1 AND organization_id=$2`,[id,org])).rows[0]);
    }));
    for(const reviewing of [false,true]) app.get(`${base}/:id/${reviewing?"review":"lines"}`,...(reviewing?review:read),wrap(async(req,res)=>{
      const org=getActiveOrganizationId(),id=idOf(req.params.id),count=await getCount(pool,org,actorOf(req),id);
      if(reviewing&&count.counted_by===actorOf(req)) throw new Error("COUNT_BLIND_REVIEW_DENIED");
      const {page,pageSize}=countPageSchema.parse(req.query);
      const fields=reviewing?`,a.expected_quantity::text AS "expectedQuantity",(a.counted_quantity-a.expected_quantity)::text AS variance,
        ((a.counted_quantity-a.expected_quantity)*a.unit_cost)::text AS "varianceValue",
        ((a.counted_quantity-a.expected_quantity)*100.0/NULLIF(a.expected_quantity,0))::text AS "variancePercent"`:"";
      const rows=await pool.query(`SELECT a.id,a.item_id AS "itemId",i.sku,i.name,a.location,a.counted_quantity::text AS "countedQuantity",a.snapshot_at AS "snapshotAt"${fields}
        FROM cycle_count_attempts a JOIN inventory_items i ON i.id=a.item_id AND i.organization_id=a.organization_id
        WHERE a.organization_id=$1 AND a.cycle_count_id=$2 AND a.attempt=$3 ORDER BY a.id LIMIT $4 OFFSET $5`,[org,id,count.current_attempt,pageSize,(page-1)*pageSize]);
      const total=await pool.query(`SELECT count(*)::int total FROM cycle_count_attempts WHERE organization_id=$1 AND cycle_count_id=$2 AND attempt=$3`,[org,id,count.current_attempt]);
      sendOk(res,{items:rows.rows,total:total.rows[0].total,page,pageSize});
    }));
    app.put(`${base}/:id/lines/:lineId`,...write,wrap(async(req,res)=>{
      const {countedQuantity}=countEntrySchema.parse(req.body),org=getActiveOrganizationId(),actor=actorOf(req),id=idOf(req.params.id);
      await transaction(async client=>{
        const count=await getCount(client,org,actor,id,true);
        if(count.status!=="COUNTING"||count.counted_by!==actor) throw new Error("COUNT_COUNTER_REQUIRED");
        const updated=await client.query(`UPDATE cycle_count_attempts SET counted_quantity=$1,entered_at=now() WHERE id=$2 AND organization_id=$3 AND cycle_count_id=$4 AND attempt=$5 AND counted_quantity IS NULL RETURNING id`,[countedQuantity,idOf(req.params.lineId),org,id,count.current_attempt]);
        if(!updated.rowCount) throw new Error("COUNT_ENTRY_IMMUTABLE");
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor},action:"CYCLE_COUNT_ENTERED",resourceType:"cycle_count",resourceId:id,details:{lineId:idOf(req.params.lineId),countedQuantity}});
      }); sendOk(res,{saved:true});
    }));
    for(const action of ["start","submit","approve","post","recount","cancel"]) app.post(`${base}/:id/${action}`,...(action==="approve"?review:write),wrap(async(req,res)=>{
      const {reason}=countActionSchema.parse(req.body??{}),org=getActiveOrganizationId(),actor=actorOf(req),id=idOf(req.params.id);
      const key=req.get("Idempotency-Key");
      if(action==="post"&&(!key||key.length>120)) throw new Error("COUNT_IDEMPOTENCY_KEY_REQUIRED");
      if(["recount","cancel"].includes(action)&&!reason) throw new Error("COUNT_REASON_REQUIRED");
      const result=await transaction(async client=>{
        const count=await getCount(client,org,actor,id,true);
        if(action==="post"&&count.status==="POSTED") {
          if(count.posting_key!==key) throw new Error("COUNT_ALREADY_POSTED");
          return {id,status:"POSTED",replayed:true};
        }
        assertCountAction(count.status,action,count.counted_by,actor);
        let status=count.status;
        if(action==="start") {
          const snapshot=await client.query(`SELECT w.id FROM warehouse_inventory w JOIN inventory_items i ON i.id=w.item_id AND i.organization_id=w.organization_id WHERE w.organization_id=$1 AND w.warehouse_id=$2 ORDER BY w.id FOR UPDATE OF w`,[org,count.warehouse_id]);
          if(!snapshot.rowCount) throw new Error("COUNT_NO_POSITIONS");
          await client.query(`INSERT INTO cycle_count_attempts(organization_id,cycle_count_id,attempt,position_id,item_id,location,expected_quantity,position_revision,unit_cost,counter_id)
            SELECT w.organization_id,$2,$3,w.id,w.item_id,COALESCE(w.bin,w.location),w.quantity,w.count_revision,i.cost,$4 FROM warehouse_inventory w JOIN inventory_items i ON i.id=w.item_id AND i.organization_id=w.organization_id WHERE w.organization_id=$1 AND w.warehouse_id=$5`,[org,id,count.current_attempt+1,actor,count.warehouse_id]);
          await client.query(`UPDATE cycle_counts SET current_attempt=current_attempt+1,counted_by=$1,count_date=now(),approved_by=NULL WHERE id=$2 AND organization_id=$3`,[actor,id,org]);
          status="COUNTING";
        } else if(["submit","approve","post"].includes(action)) {
          if(await stale(client,org,count)) status="RECOUNT_REQUIRED";
          else {
            const totals=await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE counted_quantity IS NULL)::int missing,count(*) FILTER(WHERE counted_quantity<>expected_quantity)::int changed FROM cycle_count_attempts WHERE organization_id=$1 AND cycle_count_id=$2 AND attempt=$3`,[org,id,count.current_attempt]);
            if(!totals.rows[0].total||totals.rows[0].missing) throw new Error("COUNT_INCOMPLETE");
            if(action==="submit") status=totals.rows[0].changed?"PENDING_APPROVAL":"APPROVED";
            if(action==="approve") {status="APPROVED";await client.query(`UPDATE cycle_counts SET approved_by=$1 WHERE id=$2 AND organization_id=$3`,[actor,id,org]);}
            if(action==="post") {
              if(totals.rows[0].changed&&!count.approved_by) throw new Error("COUNT_APPROVAL_REQUIRED");
              const lines=await client.query(`SELECT *,counted_quantity-expected_quantity AS delta FROM cycle_count_attempts WHERE organization_id=$1 AND cycle_count_id=$2 AND attempt=$3 ORDER BY position_id`,[org,id,count.current_attempt]);
              for(const line of lines.rows) if(line.delta!==0) {
                // The current storage schema is integer-based. Never infer fractional support.
                if(line.counted_quantity<0) throw new Error("COUNT_NEGATIVE_STOCK");
                const reserved=await client.query(`SELECT COALESCE(sum(quantity),0) AS quantity FROM inventory_allocations WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 AND status='reserved'`,[org,count.warehouse_id,line.item_id]);
                if(Number(reserved.rows[0].quantity)>line.counted_quantity) throw new Error("COUNT_RESERVED_STOCK_CONFLICT");
                await client.query(`UPDATE warehouse_inventory SET quantity=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[line.counted_quantity,line.position_id,org]);
                const item=await client.query(`UPDATE inventory_items SET quantity=quantity+$1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND quantity+$1>=0 RETURNING id`,[line.delta,line.item_id,org]);
                if(!item.rowCount) throw new Error("COUNT_ITEM_BALANCE_CONFLICT");
                await client.query(`INSERT INTO stock_movements(organization_id,item_id,warehouse_id,type,quantity,reference_id,reference_type,user_id,previous_quantity,new_quantity,unit_cost,notes) VALUES($1,$2,$3,'ADJUSTMENT',$4,$5,'cycle_count_attempt',$6,$7,$8,$9,$10)`,[org,line.item_id,count.warehouse_id,line.delta,line.id,actor,line.expected_quantity,line.counted_quantity,line.unit_cost,`Cycle count ${id}, attempt ${count.current_attempt}`]);
              }
              await client.query(`UPDATE cycle_counts SET posting_key=$1,posted_at=now() WHERE id=$2 AND organization_id=$3`,[key,id,org]); status="POSTED";
            }
          }
        } else status=action==="cancel"?"CANCELLED":"RECOUNT_REQUIRED";
        await client.query(`UPDATE cycle_counts SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[status,id,org]);
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor},action:`CYCLE_COUNT_${status}`,resourceType:"cycle_count",resourceId:id,reason,details:{requestedAction:action,attempt:count.current_attempt}});
        await client.query(`INSERT INTO ops_activity(organization_id,actor,entity_type,entity_id,action,summary_json) VALUES($1,$2,'cycle_count',$3,$4,$5::jsonb)`,[org,String(actor),String(id),`CYCLE_COUNT_${status}`,JSON.stringify({status})]);
        await client.query(`INSERT INTO event_outbox(organization_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'cycle_count',$2,$3,$4::jsonb)`,[org,String(id),`CYCLE_COUNT_${status}`,JSON.stringify({id,status,actorId:actor,targetPath:"/inventory/cycle-counts"})]);
        return {id,status};
      });
      if(result.status==="RECOUNT_REQUIRED"&&["submit","approve","post"].includes(action)) return sendError(res,409,"COUNT_STALE_SNAPSHOT","Stock changed after the snapshot. Start a fresh count.");
      sendOk(res,result);
    }));
    for(const method of ["patch","delete"] as const) app[method](`${base}/:id`,...write,(_req,res)=>{sendError(res,409,"COUNT_EXPLICIT_TRANSITION_REQUIRED","Use a count lifecycle action. Historical records cannot be edited or deleted.");});
  }
  // Legacy child CRUD cannot accept authoritative quantities or reveal blind evidence.
  app.all(["/api/cycle-count-lines","/api/cycle-count-lines/:id"],...read,(_req,res)=>{sendError(res,409,"COUNT_PARENT_REQUIRED","Use /api/v2/inventory/cycle-counts/:id/lines and the count entry action.");});
}
