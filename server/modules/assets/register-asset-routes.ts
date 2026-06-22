import type { Express, Request, RequestHandler, Response } from "express";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";
import { requireExtensionsEnabled } from "../extensions/extension-guard";
import { trackedAssetService } from "./service";
import {
  createAssetEventBodySchema,
  createTrackedAssetBodySchema,
  patchTrackedAssetBodySchema,
} from "./validators";

type Auth = {
  ensureAuthenticated: RequestHandler;
};

/**
 * Tracked assets under `/api/extensions/assets` (requires org feature `extensions`).
 * Response shape: `{ ok, data, meta: { requestId } }` for JSON bodies.
 */
export function registerTrackedAssetExtensionRoutes(app: Express, auth: Auth): void {
  app.get("/api/extensions/assets", auth.ensureAuthenticated, requireExtensionsEnabled, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const rows = await trackedAssetService.list(orgId);
      return sendOk(res, rows);
    } catch (e) {
      console.error("extensions/assets list:", e);
      return sendError(res, 500, "ASSETS_LIST_FAILED", "Failed to list assets");
    }
  });

  app.post("/api/extensions/assets", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    const parsed = createTrackedAssetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body", {
        details: parsed.error.flatten(),
      });
    }
    const orgId = getActiveOrganizationId();
    const result = await trackedAssetService.create(orgId, parsed.data);
    if (!result.ok) {
      return sendError(res, 400, result.code, result.message);
    }
    return sendOk(res, result.data, 201);
  });

  app.patch("/api/extensions/assets/:assetId", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    const assetId = Number(req.params.assetId);
    if (Number.isNaN(assetId)) {
      return sendError(res, 400, "INVALID_ID", "Invalid asset id");
    }
    const parsed = patchTrackedAssetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body", {
        details: parsed.error.flatten(),
      });
    }
    const orgId = getActiveOrganizationId();
    const result = await trackedAssetService.update(orgId, assetId, parsed.data);
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : 400;
      return sendError(res, status, result.code, result.message);
    }
    return sendOk(res, result.data);
  });

  app.delete("/api/extensions/assets/:assetId", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
      if (Number.isNaN(assetId)) {
        return sendError(res, 400, "INVALID_ID", "Invalid asset id");
      }
      const orgId = getActiveOrganizationId();
      const result = await trackedAssetService.remove(orgId, assetId);
      if (!result.ok) {
        return sendError(res, 404, result.code, result.message);
      }
      return res.status(204).send();
    } catch (e) {
      console.error("extensions/assets delete:", e);
      return sendError(res, 500, "ASSET_DELETE_FAILED", "Failed to delete asset");
    }
  });

  app.post(
    "/api/extensions/assets/:assetId/events",
    auth.ensureAuthenticated,
    requireExtensionsEnabled,
    async (req: Request, res: Response) => {
      const assetId = Number(req.params.assetId);
      if (Number.isNaN(assetId)) {
        return sendError(res, 400, "INVALID_ID", "Invalid asset id");
      }
      const parsed = createAssetEventBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body", {
          details: parsed.error.flatten(),
        });
      }
      const orgId = getActiveOrganizationId();
      const userId = (req as Request & { user?: { id?: number } }).user?.id ?? null;
      const result = await trackedAssetService.addEvent(orgId, assetId, parsed.data, userId);
      if (!result.ok) {
        return sendError(res, 404, result.code, result.message);
      }
      return sendOk(res, result.data, 201);
    },
  );
}
