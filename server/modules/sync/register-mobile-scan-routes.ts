import type { Express, Request, RequestHandler, Response } from "express";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { resolveMobileScanValue } from "./mobile-scan-service";
import { scanResolveBodySchema } from "./scan-validators";

type Auth = {
  ensureAuthenticated: RequestHandler;
};

/**
 * Scan-to-action: resolve a scanned code to an inventory item and/or tracked asset.
 * Pairs with offline queue `type: "scan"` in `/api/sync/batch`.
 */
export function registerMobileScanRoutes(app: Express, auth: Auth): void {
  app.post("/api/mobile/scan/resolve", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    const parsed = scanResolveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid scan body", {
        details: parsed.error.flatten(),
      });
    }
    const orgId = getActiveOrganizationId();
    const result = await resolveMobileScanValue({
      organizationId: orgId,
      value: parsed.data.value,
      intent: parsed.data.intent ?? null,
    });
    return sendOk(res, result);
  });
}
