import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { activityLogs, mobileSyncEvents } from "@shared/schema";
import { getActiveOrganizationId } from "../../organization-context";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";
import { sendOk } from "../../api-response";
import { syncBatchBodySchema } from "./validators";
import { registerMobileScanRoutes } from "./register-mobile-scan-routes";
import { resolveMobileScanValue } from "./mobile-scan-service";
import { scanResolveBodySchema } from "./scan-validators";
import {
  addMobileCountLine,
  createMobileCountSession,
  createMobileCountSessionSchema,
  createMobileRecountSession,
  mobileCountLineSchema,
  MobileCountDomainError,
  submitMobileCountSession,
} from "../mobile-counts/mobile-count-service";

type Auth = {
  ensureAuthenticated: RequestHandler;
};

const processedKeys = new Set<string>();
type SyncReplayStatus = "accepted" | "applied" | "duplicate" | "failed";

type SyncReplayResult = {
  idempotencyKey: string;
  type: string;
  status: SyncReplayStatus;
  message?: string;
};

/**
 * Mobile offline queue flush: accepts idempotent batches (in-memory dedupe for this process).
 */
export function registerSyncRoutes(app: Express, auth: Auth): void {
  registerMobileScanRoutes(app, auth);
  app.post(
    "/api/sync/batch",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      const flags = await getFeatureFlagsForActiveOrg();
      if (!isOrgFeatureEnabled(flags, "offline_sync")) {
        return sendOrgFeatureDisabled(res, "offline_sync");
      }

      const parsed = syncBatchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.flatten() });
      }

      const orgId = getActiveOrganizationId();
      const userId = (req as Request & { user?: { id?: number } }).user?.id ?? null;
      const accepted: string[] = [];
      const duplicates: string[] = [];
      const applied: string[] = [];
      const failed: Array<{ idempotencyKey: string; message: string }> = [];
      const results: SyncReplayResult[] = [];

      for (const action of parsed.data.actions) {
        const key = `${orgId}:${action.idempotencyKey}`;
        if (processedKeys.has(key)) {
          duplicates.push(action.idempotencyKey);
          results.push({ idempotencyKey: action.idempotencyKey, type: action.type, status: "duplicate", message: "Already processed in this server process." });
          continue;
        }

        try {
          const [existing] = await db
            .select()
            .from(mobileSyncEvents)
            .where(and(eq(mobileSyncEvents.organizationId, orgId), eq(mobileSyncEvents.idempotencyKey, action.idempotencyKey)))
            .limit(1);
          if (existing && ["applied", "duplicate"].includes(existing.status)) {
            processedKeys.add(key);
            duplicates.push(action.idempotencyKey);
            results.push({ idempotencyKey: action.idempotencyKey, type: action.type, status: "duplicate", message: "Already applied." });
            continue;
          }

          accepted.push(action.idempotencyKey);
          let replayMessage = "Recorded offline action.";
          let replaySummary: Record<string, unknown> | null = null;
          if (action.type === "mobile_count_line") {
            const sessionId = Number(action.payload.sessionId);
            if (!Number.isFinite(sessionId)) throw new MobileCountDomainError("MOBILE_SYNC_SESSION_REQUIRED", "Queued count line is missing sessionId.", 400);
            const data = mobileCountLineSchema.parse({ ...action.payload, syncStatus: "replayed" });
            await addMobileCountLine({ organizationId: orgId, sessionId, data, idempotencyKey: action.idempotencyKey, userId });
            replayMessage = "Count line replayed.";
          } else if (action.type === "mobile_count_submit") {
            const sessionId = Number(action.payload.sessionId);
            if (!Number.isFinite(sessionId)) throw new MobileCountDomainError("MOBILE_SYNC_SESSION_REQUIRED", "Queued submit is missing sessionId.", 400);
            await submitMobileCountSession({
              organizationId: orgId,
              sessionId,
              idempotencyKey: action.idempotencyKey,
              deviceId: String(action.payload.deviceId ?? "offline-device"),
            });
            replayMessage = "Count submission replayed.";
          } else if (action.type === "mobile_count_recount") {
            const sourceId = Number(action.payload.sourceId ?? action.payload.sessionId);
            if (!Number.isFinite(sourceId)) throw new MobileCountDomainError("MOBILE_SYNC_SESSION_REQUIRED", "Queued recount is missing sourceId.", 400);
            await createMobileRecountSession({
              organizationId: orgId,
              sourceId,
              idempotencyKey: action.idempotencyKey,
              userId,
              deviceId: String(action.payload.deviceId ?? "offline-device"),
            });
            replayMessage = "Recount replayed.";
          } else if (action.type === "mobile_count_spot") {
            const data = createMobileCountSessionSchema.parse({ ...action.payload, mode: "spot" });
            await createMobileCountSession({ organizationId: orgId, data, idempotencyKey: action.idempotencyKey, userId });
            replayMessage = "Spot count replayed.";
          } else if (action.type === "scan") {
            const data = scanResolveBodySchema.parse(action.payload);
            const result = await resolveMobileScanValue({
              organizationId: orgId,
              value: data.value,
              intent: data.intent ?? null,
            });
            replaySummary =
              result.kind === "item"
                ? { kind: result.kind, itemId: result.item?.id ?? null, sku: result.item?.sku ?? null }
                : result.kind === "asset"
                  ? { kind: result.kind, assetId: result.asset.id, serialNumber: result.asset.serialNumber }
                  : { kind: result.kind, value: result.value };
            replayMessage =
              result.kind === "item"
                ? `Scan replayed for item ${result.item?.sku ?? result.barcode.value}.`
                : result.kind === "asset"
                  ? `Scan replayed for asset ${result.asset.serialNumber ?? result.asset.id}.`
                  : `Scan replayed with no linked record for ${result.value}.`;
          }

          const desc = JSON.stringify({
            idempotencyKey: action.idempotencyKey,
            ...action.payload,
            ...(replaySummary ? { replaySummary } : {}),
          }).slice(0, 1900);
          await db
            .insert(mobileSyncEvents)
            .values({
              organizationId: orgId,
              deviceId: String(action.payload.deviceId ?? "unknown-device"),
              eventType: action.type,
              body: action.payload,
              idempotencyKey: action.idempotencyKey,
              status: "applied",
              ackedAt: new Date(),
              appliedAt: new Date(),
              retryCount: Number(action.payload.retryCount ?? 0),
            })
            .onConflictDoNothing();
          await db.insert(activityLogs).values({
            organizationId: orgId,
            action: `offline_sync:${action.type}`,
            description: desc,
            userId,
            referenceType: "offline_sync",
            referenceId: null,
          });
          processedKeys.add(key);
          applied.push(action.idempotencyKey);
          results.push({ idempotencyKey: action.idempotencyKey, type: action.type, status: "applied", message: replayMessage });
        } catch (e) {
          console.error("[sync/batch] activity log insert failed:", e);
          const message = e instanceof Error ? e.message : "Replay failed.";
          failed.push({ idempotencyKey: action.idempotencyKey, message });
          results.push({ idempotencyKey: action.idempotencyKey, type: action.type, status: "failed", message });
          await db
            .insert(mobileSyncEvents)
            .values({
              organizationId: orgId,
              deviceId: String(action.payload.deviceId ?? "unknown-device"),
              eventType: action.type,
              body: action.payload,
              idempotencyKey: action.idempotencyKey,
              status: "failed",
              failureReason: message,
              failedAt: new Date(),
              retryCount: Number(action.payload.retryCount ?? 0),
            })
            .onConflictDoNothing();
        }
      }

      return sendOk(res, {
        organizationId: orgId,
        accepted,
        applied,
        duplicates,
        failed,
        results,
        processed: accepted.length,
      });
    },
  );
}
