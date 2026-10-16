import type { Express, Request, RequestHandler, Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { verifyAuditChain } from "../../services/audit-chain-service";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

export function registerAuditRoutes(app: Express, auth: Auth): void {
  const auditRead = [auth.ensureAuthenticated, auth.ensurePermission("audit_logs", "read")];

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
