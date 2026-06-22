import type { Express, Request, RequestHandler, Response } from "express";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";
import { sendError, sendOk } from "../../api-response";
import { getGasDashboardSummary, runGasComplianceAlerts } from "./gas-service";

type Auth = {
  ensureAuthenticated: RequestHandler;
};

/** Gas vertical JSON APIs (schema: gas_* tables). Gated by `feature_flags.gas !== false`. */
export function registerGasRoutes(app: Express, auth: Auth): void {
  app.get("/api/gas/dashboard-summary", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    const flags = await getFeatureFlagsForActiveOrg();
    if (!isOrgFeatureEnabled(flags, "gas")) {
      return sendOrgFeatureDisabled(res, "gas");
    }
    const summary = await getGasDashboardSummary();
    return sendOk(res, summary);
  });

  app.post("/api/gas/run-compliance-alerts", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    const flags = await getFeatureFlagsForActiveOrg();
    if (!isOrgFeatureEnabled(flags, "gas")) {
      return sendOrgFeatureDisabled(res, "gas");
    }
    const role = String((req as Request & { user?: { role?: string } }).user?.role ?? "").toLowerCase();
    if (role !== "admin" && role !== "manager") {
      return sendError(res, 403, "FORBIDDEN", "Manager or admin required");
    }
    const result = await runGasComplianceAlerts();
    return sendOk(res, result);
  });
}
