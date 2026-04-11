import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { activityLogs } from "@shared/schema";
import { getActiveOrganizationId } from "../../organization-context";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";
import { sendOk } from "../../api-response";
import { syncBatchBodySchema } from "./validators";
import { registerMobileScanRoutes } from "./register-mobile-scan-routes";

type Auth = {
  ensureAuthenticated: import("express").RequestHandler;
};

const processedKeys = new Set<string>();

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

      for (const action of parsed.data.actions) {
        const key = `${orgId}:${action.idempotencyKey}`;
        if (processedKeys.has(key)) {
          duplicates.push(action.idempotencyKey);
          continue;
        }
        processedKeys.add(key);
        accepted.push(action.idempotencyKey);

        try {
          const desc = JSON.stringify({
            idempotencyKey: action.idempotencyKey,
            ...action.payload,
          }).slice(0, 1900);
          await db.insert(activityLogs).values({
            organizationId: orgId,
            action: `offline_sync:${action.type}`,
            description: desc,
            userId,
            referenceType: "offline_sync",
            referenceId: null,
          });
        } catch (e) {
          console.error("[sync/batch] activity log insert failed:", e);
        }
      }

      return sendOk(res, {
        organizationId: orgId,
        accepted,
        duplicates,
        processed: accepted.length,
      });
    },
  );
}
