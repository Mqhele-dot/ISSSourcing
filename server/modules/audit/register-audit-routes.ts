import type { Express, Request, RequestHandler, Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { verifyAuditChain } from "../../services/audit-chain-service";
import {pool} from "../../db";
import {z} from "zod";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

export function registerAuditRoutes(app: Express, auth: Auth): void {
  const auditRead = [auth.ensureAuthenticated, auth.ensurePermission("audit_logs", "read")];
  app.get("/api/audit/events",...auditRead,async(req:Request,res:Response)=>{
    const parsed=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25),
      actor:z.coerce.number().int().positive().optional(),action:z.string().trim().max(100).optional(),resourceType:z.string().trim().max(100).optional(),resourceId:z.coerce.number().int().positive().optional(),findingKey:z.string().max(500).optional(),
      from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional()}).strict().safeParse(req.query);
    if(!parsed.success)return sendError(res,400,"INVALID_AUDIT_FILTERS","Choose valid filters and 25, 50 or 100 rows.");
    const q=parsed.data;if(q.from&&q.to&&Date.parse(q.from)>Date.parse(q.to))return sendError(res,400,"INVALID_AUDIT_DATES","The start date must be before the end date.");
    const values:unknown[]=[getActiveOrganizationId()],clauses=['organization_id=$1'];
    for(const [column,value]of [['user_id',q.actor],['action',q.action],['resource_type',q.resourceType],['resource_id',q.resourceId]] as const)if(value!==undefined){values.push(value);clauses.push(`${column}=$${values.length}`);}
    if(q.findingKey){values.push(q.findingKey);clauses.push(`details->>'findingKey'=$${values.length}`);}
    for(const [operator,value]of [['>=',q.from],['<=',q.to]] as const)if(value){values.push(value);clauses.push(`created_at${operator}$${values.length}::timestamptz`);}
    const c=await pool.connect();
    try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='10s'");
      const count=await c.query(`SELECT count(*)::int AS total FROM audit_logs WHERE ${clauses.join(' AND ')}`,values);
      const rows=await c.query(`SELECT id,created_at AS "createdAt",user_id AS "actorUserId",action,resource_type AS "resourceType",resource_id AS "resourceId",reason,details->>'findingKey' AS "findingKey",request_id AS "requestId" FROM audit_logs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,q.pageSize,(q.page-1)*q.pageSize]);
      await c.query('COMMIT');return sendOk(res,{items:rows.rows,total:count.rows[0].total,page:q.page,pageSize:q.pageSize});
    }catch{await c.query('ROLLBACK');return sendError(res,503,"AUDIT_EVENTS_UNAVAILABLE","Audit history could not be loaded. Retry or contact your administrator.");}finally{c.release();}
  });

  app.get("/api/audit/verify", ...auditRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await verifyAuditChain(getActiveOrganizationId()));
    } catch (error) {
      console.error("Audit chain verification failed:", error);
      return sendError(res, 500, "AUDIT_CHAIN_VERIFICATION_FAILED", "Audit integrity could not be verified.", {
        hint: "Retry the check and escalate any repeated failure to a system administrator.",
      });
    }
  });

  app.get("/api/audit/entity/:resourceType/:resourceId", ...auditRead, async (req: Request, res: Response) => {
    const resourceType = String(req.params.resourceType ?? "").trim();
    const resourceId = Number(req.params.resourceId);
    if (!resourceType || !Number.isFinite(resourceId)) {
      return sendError(res, 400, "AUDIT_ENTITY_INVALID", "A valid resource type and ID are required.");
    }
    const events = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, getActiveOrganizationId()),
          eq(auditLogs.resourceType, resourceType),
          eq(auditLogs.resourceId, resourceId),
        ),
      )
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
    return sendOk(res, events);
  });
}
