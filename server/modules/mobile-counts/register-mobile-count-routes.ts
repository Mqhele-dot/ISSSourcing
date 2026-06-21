import type { Express, Request, RequestHandler, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";
import { sendError, sendOk } from "../../api-response";
import {
  activityLogs,
  inventoryAdjustments,
  inventoryItems,
  mobileSyncEvents,
  stockCountLines,
  stockCountSessions,
  stockCountTargets,
  stockCountVariances,
  stockMovements,
  warehouseInventory,
} from "@shared/schema";
import {
  addMobileCountLine,
  createMobileCountSession,
  createMobileCountSessionSchema,
  createMobileRecountSession,
  mobileCountLineSchema,
  MobileCountDomainError,
  resolveMobileCountScanValue,
  submitMobileCountSession,
} from "./mobile-count-service";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

const syncEventSchema = z.object({
  deviceId: z.string().min(1).max(128),
  eventType: z.string().min(1).max(80),
  body: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(128),
  retryCount: z.coerce.number().int().min(0).default(0),
});

function userId(req: Request): number | null {
  return (req as Request & { user?: { id?: number } }).user?.id ?? null;
}

function requireIdempotencyKey(req: Request, res: Response): string | null {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required for mobile count mutations.");
    return null;
  }
  return key;
}

async function ensureMobileCountFeature(res: Response): Promise<boolean> {
  const flags = await getFeatureFlagsForActiveOrg();
  if (!isOrgFeatureEnabled(flags, "mobile_stock_counts")) {
    sendOrgFeatureDisabled(res, "mobile_stock_counts");
    return false;
  }
  return true;
}

export function registerMobileCountRoutes(app: Express, auth: Auth): void {
  const read = [auth.ensureAuthenticated];
  const write = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "update")];
  const approve = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "approve")];

  app.get("/api/mobile/counts/assigned", ...read, async (req: Request, res: Response) => {
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const orgId = getActiveOrganizationId();
      const uid = userId(req);
      const rows = await db
        .select()
        .from(stockCountSessions)
        .where(eq(stockCountSessions.organizationId, orgId))
        .orderBy(desc(stockCountSessions.createdAt));

      return sendOk(res, {
        sessions: rows.filter((row) => !row.assignedUserId || !uid || row.assignedUserId === uid),
      });
    } catch (error) {
      console.error("GET /api/mobile/counts/assigned:", error);
      return sendError(res, 500, "MOBILE_COUNTS_ASSIGNED_FAILED", "Failed to load assigned mobile counts.");
    }
  });

  app.post("/api/mobile/counts", ...write, async (req: Request, res: Response) => {
    const idempotencyKey = requireIdempotencyKey(req, res);
    if (!idempotencyKey) return;
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const parsed = createMobileCountSessionSchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const result = await createMobileCountSession({ organizationId: orgId, data: parsed, idempotencyKey, userId: userId(req) });

      return sendOk(res, result, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "MOBILE_COUNT_SESSION_INVALID", "Invalid mobile count session.", {
          details: error.flatten(),
        });
      }
      console.error("POST /api/mobile/counts:", error);
      return sendError(res, 500, "MOBILE_COUNT_SESSION_CREATE_FAILED", "Failed to create mobile count session.");
    }
  });

  app.get("/api/mobile/scan/resolve", ...read, async (req: Request, res: Response) => {
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const value = String(req.query.value ?? "").trim();
      if (!value) return sendError(res, 400, "SCAN_VALUE_REQUIRED", "Scan value is required.");
      const result = await resolveMobileCountScanValue(getActiveOrganizationId(), value);
      return sendOk(res, result);
    } catch (error) {
      console.error("GET /api/mobile/scan/resolve:", error);
      return sendError(res, 500, "MOBILE_SCAN_RESOLVE_FAILED", "Failed to resolve scanned value.");
    }
  });

  app.get("/api/mobile/counts/:id", ...read, async (req: Request, res: Response) => {
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const orgId = getActiveOrganizationId();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid mobile count ID.");

      const [session] = await db
        .select()
        .from(stockCountSessions)
        .where(and(eq(stockCountSessions.organizationId, orgId), eq(stockCountSessions.id, id)))
        .limit(1);
      if (!session) return sendError(res, 404, "MOBILE_COUNT_NOT_FOUND", "Mobile count session not found.");

      const [targets, lines, variances] = await Promise.all([
        db.select().from(stockCountTargets).where(and(eq(stockCountTargets.organizationId, orgId), eq(stockCountTargets.sessionId, id))),
        db.select().from(stockCountLines).where(and(eq(stockCountLines.organizationId, orgId), eq(stockCountLines.sessionId, id))),
        db
          .select()
          .from(stockCountVariances)
          .where(and(eq(stockCountVariances.organizationId, orgId), eq(stockCountVariances.sessionId, id))),
      ]);

      return sendOk(res, { session, targets, lines, variances });
    } catch (error) {
      console.error("GET /api/mobile/counts/:id:", error);
      return sendError(res, 500, "MOBILE_COUNT_LOAD_FAILED", "Failed to load mobile count session.");
    }
  });

  app.post("/api/mobile/counts/:id/lines", ...write, async (req: Request, res: Response) => {
    const idempotencyKey = requireIdempotencyKey(req, res);
    if (!idempotencyKey) return;
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const orgId = getActiveOrganizationId();
      const sessionId = Number(req.params.id);
      const parsed = mobileCountLineSchema.parse(req.body);
      const result = await addMobileCountLine({ organizationId: orgId, sessionId, data: parsed, idempotencyKey, userId: userId(req) });

      return sendOk(res, result, result.duplicate ? 200 : 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "MOBILE_COUNT_LINE_INVALID", "Invalid mobile count line.", {
          details: error.flatten(),
        });
      }
      if (error instanceof MobileCountDomainError) {
        return sendError(res, error.status, error.code, error.message, { details: error.details });
      }
      console.error("POST /api/mobile/counts/:id/lines:", error);
      return sendError(res, 500, "MOBILE_COUNT_LINE_CREATE_FAILED", "Failed to add mobile count line.");
    }
  });

  app.post("/api/mobile/counts/:id/submit", ...write, async (req: Request, res: Response) => {
    const idempotencyKey = requireIdempotencyKey(req, res);
    if (!idempotencyKey) return;
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const orgId = getActiveOrganizationId();
      const sessionId = Number(req.params.id);
      const result = await submitMobileCountSession({
        organizationId: orgId,
        sessionId,
        idempotencyKey,
        deviceId: String(req.body?.deviceId ?? "unknown-device"),
      });

      return sendOk(res, result);
    } catch (error) {
      if (error instanceof MobileCountDomainError) {
        return sendError(res, error.status, error.code, error.message, { details: error.details });
      }
      console.error("POST /api/mobile/counts/:id/submit:", error);
      return sendError(res, 500, "MOBILE_COUNT_SUBMIT_FAILED", "Failed to submit mobile count.");
    }
  });

  app.post("/api/mobile/counts/:id/recount", ...write, async (req: Request, res: Response) => {
    const idempotencyKey = requireIdempotencyKey(req, res);
    if (!idempotencyKey) return;
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const orgId = getActiveOrganizationId();
      const sourceId = Number(req.params.id);
      const created = await createMobileRecountSession({
        organizationId: orgId,
        sourceId,
        idempotencyKey,
        userId: userId(req),
        deviceId: String(req.body?.deviceId ?? "unknown-device"),
      });
      return sendOk(res, created, 201);
    } catch (error) {
      if (error instanceof MobileCountDomainError) {
        return sendError(res, error.status, error.code, error.message, { details: error.details });
      }
      console.error("POST /api/mobile/counts/:id/recount:", error);
      return sendError(res, 500, "MOBILE_COUNT_RECOUNT_FAILED", "Failed to create recount.");
    }
  });

  app.post("/api/mobile/counts/:id/approve", ...approve, async (req: Request, res: Response) => {
    const idempotencyKey = requireIdempotencyKey(req, res);
    if (!idempotencyKey) return;
    try {
      if (!(await ensureMobileCountFeature(res))) return;
      const orgId = getActiveOrganizationId();
      const sessionId = Number(req.params.id);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM stock_count_sessions WHERE organization_id = ${orgId} AND id = ${sessionId} FOR UPDATE`);
        const [session] = await tx
          .select()
          .from(stockCountSessions)
          .where(and(eq(stockCountSessions.organizationId, orgId), eq(stockCountSessions.id, sessionId)))
          .limit(1);
        if (!session) throw new Error("MOBILE_COUNT_NOT_FOUND");
        if (session.status === "posted") throw new Error("MOBILE_COUNT_ALREADY_POSTED");
        if (session.status !== "submitted" && session.status !== "approved") throw new Error("MOBILE_COUNT_NOT_SUBMITTED");

        const variances = await tx
          .select()
          .from(stockCountVariances)
          .where(and(eq(stockCountVariances.organizationId, orgId), eq(stockCountVariances.sessionId, sessionId)));

        const adjustments = [];
        for (const variance of variances.filter((row) => Number(row.deltaQty) !== 0)) {
          const [item] = await tx
            .select()
            .from(inventoryItems)
            .where(and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.id, variance.itemId)))
            .limit(1);
          const previousQuantity = Number(item?.quantity ?? 0);
          const newQuantity = previousQuantity + Number(variance.deltaQty);

          await tx
            .update(inventoryItems)
            .set({ quantity: newQuantity, lastCountDate: now, updatedAt: now })
            .where(and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.id, variance.itemId)));

          const [position] = await tx
            .select()
            .from(warehouseInventory)
            .where(
              and(
                eq(warehouseInventory.organizationId, orgId),
                eq(warehouseInventory.itemId, variance.itemId),
                eq(warehouseInventory.warehouseId, session.warehouseId),
              ),
            )
            .limit(1);
          if (position) {
            await tx
              .update(warehouseInventory)
              .set({ quantity: Number(position.quantity ?? 0) + Number(variance.deltaQty), updatedAt: now })
              .where(eq(warehouseInventory.id, position.id));
          } else {
            await tx.insert(warehouseInventory).values({
              organizationId: orgId,
              itemId: variance.itemId,
              warehouseId: session.warehouseId,
              quantity: Number(variance.deltaQty),
            });
          }

          const [movement] = await tx
            .insert(stockMovements)
            .values({
              organizationId: orgId,
              itemId: variance.itemId,
              warehouseId: session.warehouseId,
              type: "ADJUSTMENT",
              quantity: Number(variance.deltaQty),
              referenceId: sessionId,
              referenceType: "stock_count_session",
              notes: `Mobile count #${sessionId} approved adjustment`,
              userId: userId(req),
              previousQuantity,
              newQuantity,
              destinationWarehouseId: session.warehouseId,
            })
            .returning();

          const [adjustment] = await tx
            .insert(inventoryAdjustments)
            .values({
              organizationId: orgId,
              sessionId,
              warehouseId: session.warehouseId,
              targetId: variance.targetId,
              itemId: variance.itemId,
              deltaQty: Number(variance.deltaQty),
              movementId: movement.id,
              postedBy: userId(req),
              postedAt: now,
            })
            .returning();
          adjustments.push(adjustment);
        }

        await tx
          .update(stockCountVariances)
          .set({ disposition: "approved", reviewerId: userId(req), updatedAt: now })
          .where(and(eq(stockCountVariances.organizationId, orgId), eq(stockCountVariances.sessionId, sessionId)));

        const [updated] = await tx
          .update(stockCountSessions)
          .set({ status: "posted", approvedAt: now, postedAt: now, updatedAt: now })
          .where(and(eq(stockCountSessions.organizationId, orgId), eq(stockCountSessions.id, sessionId)))
          .returning();

        await tx.insert(activityLogs).values({
          organizationId: orgId,
          action: "mobile_count:approve",
          description: `Approved and posted mobile count session #${sessionId}`,
          userId: userId(req),
          referenceType: "stock_count_session",
          referenceId: sessionId,
        });
        await tx.insert(mobileSyncEvents).values({
          organizationId: orgId,
          deviceId: String(req.body?.deviceId ?? session.deviceId ?? "unknown-device"),
          eventType: "mobile_count_approve",
          body: { sessionId, adjustments: adjustments.length },
          idempotencyKey,
          ackedAt: now,
        });

        return { session: updated, adjustments };
      });

      return sendOk(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "MOBILE_COUNT_NOT_FOUND") {
        return sendError(res, 404, "MOBILE_COUNT_NOT_FOUND", "Mobile count session not found.");
      }
      if (error instanceof Error && error.message === "MOBILE_COUNT_ALREADY_POSTED") {
        return sendError(res, 409, "MOBILE_COUNT_ALREADY_POSTED", "This count session has already been posted.");
      }
      if (error instanceof Error && error.message === "MOBILE_COUNT_NOT_SUBMITTED") {
        return sendError(res, 409, "MOBILE_COUNT_NOT_SUBMITTED", "Submit the count before approval and posting.");
      }
      console.error("POST /api/mobile/counts/:id/approve:", error);
      return sendError(res, 500, "MOBILE_COUNT_APPROVE_FAILED", "Failed to approve mobile count.");
    }
  });

  app.post("/api/mobile/sync-events", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const flags = await getFeatureFlagsForActiveOrg();
      if (!isOrgFeatureEnabled(flags, "offline_sync")) {
        return sendOrgFeatureDisabled(res, "offline_sync");
      }
      const parsed = syncEventSchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const [existing] = await db
        .select()
        .from(mobileSyncEvents)
        .where(and(eq(mobileSyncEvents.organizationId, orgId), eq(mobileSyncEvents.idempotencyKey, parsed.idempotencyKey)))
        .limit(1);
      if (existing) return sendOk(res, { event: existing, duplicate: true });

      const [event] = await db
        .insert(mobileSyncEvents)
        .values({
          organizationId: orgId,
          deviceId: parsed.deviceId,
          eventType: parsed.eventType,
          body: parsed.body,
          idempotencyKey: parsed.idempotencyKey,
          retryCount: parsed.retryCount,
          ackedAt: new Date(),
        })
        .returning();
      return sendOk(res, { event, duplicate: false }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "MOBILE_SYNC_EVENT_INVALID", "Invalid mobile sync event.", {
          details: error.flatten(),
        });
      }
      console.error("POST /api/mobile/sync-events:", error);
      return sendError(res, 500, "MOBILE_SYNC_EVENT_FAILED", "Failed to record mobile sync event.");
    }
  });
}
