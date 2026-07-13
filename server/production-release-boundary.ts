import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { sendError, sendOk } from "./api-response";
import { getFeatureFlagsForActiveOrg } from "./org-features";

export type ProductionArea = "procurement" | "inventory" | "receiving" | "logistics" | "finance" | "mobile_operations";

type Auth = { ensureAuthenticated: RequestHandler };

function configuredBoundary(): "procurement" | "full" {
  const value = String(process.env.PRODUCTION_RELEASE_SCOPE ?? "procurement").trim().toLowerCase();
  return value === "full" ? "full" : "procurement";
}

async function areaEnabled(area: ProductionArea): Promise<boolean> {
  if (area === "procurement") return true;
  if (configuredBoundary() === "full") return true;
  if (process.env.NODE_ENV !== "production") return true;
  const flags = await getFeatureFlagsForActiveOrg();
  return flags[`production_${area}`] === true;
}

function gate(area: ProductionArea): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.isAuthenticated?.()) return next();
      if (await areaEnabled(area)) return next();
      return sendError(
        res,
        403,
        "FEATURE_NOT_PRODUCTION_APPROVED",
        `${area.replace(/_/g, " ")} is not enabled in this procurement-only production release.`,
        {
          hint: "Use the approved procurement workflow or ask an administrator about a controlled preview entitlement.",
          details: { area, productionReleaseScope: configuredBoundary() },
        },
      );
    } catch (error) {
      console.error("Production boundary check failed:", error);
      return sendError(res, 503, "PRODUCTION_BOUNDARY_UNAVAILABLE", "The production feature boundary could not be verified.");
    }
  };
}

function gateMutations(area: ProductionArea): RequestHandler {
  const areaGate = gate(area);
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    return areaGate(req, res, next);
  };
}

export function registerProductionReleaseBoundary(app: Express, auth: Auth): void {
  app.get("/api/release-scope", auth.ensureAuthenticated, async (_req, res) => {
    const areas: ProductionArea[] = ["procurement", "inventory", "receiving", "logistics", "finance", "mobile_operations"];
    const entries = await Promise.all(areas.map(async (area) => [area, await areaEnabled(area)] as const));
    const productionRuntime = process.env.NODE_ENV === "production";
    return sendOk(res, {
      boundary: configuredBoundary(),
      productionRuntime,
      modules: Object.fromEntries(entries),
      previewMode: !productionRuntime,
      message: productionRuntime && configuredBoundary() === "procurement"
        ? "Procurement-only commercial release. Operational and finance modules require an explicit production entitlement."
        : "Non-production modules are available for controlled preview and verification.",
    });
  });

  // Procurement still needs read access to item, warehouse, tax, and currency reference data.
  // These gates protect operational mutations and finance execution, while Master Data remains available.
  app.use("/api/stock-movements", gate("inventory"));
  app.use("/api/warehouse-inventory", gate("inventory"));
  app.use("/api/warehouse-transfers", gate("inventory"));
  app.use("/api/cycle-counts", gate("inventory"));
  app.use("/api/cycle-count-lines", gate("inventory"));
  app.use("/api/reorder-requests", gate("inventory"));
  app.use("/api/inventory-batches", gate("inventory"));
  app.use("/api/inventory-serials", gate("inventory"));
  app.use("/api/inventory-allocations", gate("inventory"));
  app.use("/api/inventory-sync", gate("inventory"));
  app.use("/api/inventory", gateMutations("inventory"));
  app.use("/api/mobile/receive", gate("receiving"));
  app.use("/api/mobile/counts", gate("mobile_operations"));
  app.use("/api/mobile/scan", gate("mobile_operations"));
  app.use("/api/sync/batch", gate("mobile_operations"));
  app.use("/api/shipments", gate("logistics"));
  app.use("/api/logistics", gate("logistics"));
  app.use("/api/exceptions", gate("logistics"));
  app.use("/api/accounts-payable", gate("finance"));
  app.use("/api/ap", gate("finance"));
  app.use("/api/invoices", gate("finance"));
  app.use("/api/payments", gate("finance"));
  app.use("/api/billing", gate("finance"));
}
