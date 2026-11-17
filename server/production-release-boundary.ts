import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { sendError, sendOk } from "./api-response";
import { getFeatureFlagsForActiveOrg } from "./org-features";

export type ProductionArea = "procurement" | "inventory" | "receiving" | "logistics" | "finance" | "mobile_operations";
export type ProductionReleaseScope = "procurement" | "full";

export type ProductionBoundaryOptions = {
  productionRuntime?: boolean;
  scope?: ProductionReleaseScope;
  resolveFeatureFlags?: () => Promise<Record<string, boolean>>;
};

export type ProductionBoundaryPolicy = {
  productionRuntime: boolean;
  scope: ProductionReleaseScope;
  areaEnabled: (area: ProductionArea) => Promise<boolean>;
};

type Auth = { ensureAuthenticated: RequestHandler };

function configuredBoundary(): ProductionReleaseScope {
  const value = String(process.env.PRODUCTION_RELEASE_SCOPE ?? "procurement").trim().toLowerCase();
  return value === "full" ? "full" : "procurement";
}

export function createProductionBoundaryPolicy(options: ProductionBoundaryOptions = {}): ProductionBoundaryPolicy {
  const productionRuntime = options.productionRuntime ?? process.env.NODE_ENV === "production";
  const scope = options.scope ?? configuredBoundary();
  const resolveFeatureFlags = options.resolveFeatureFlags ?? getFeatureFlagsForActiveOrg;

  return {
    productionRuntime,
    scope,
    areaEnabled: async (area: ProductionArea) => {
      if (area === "procurement") return true;
      if (scope === "full") return true;
      if (!productionRuntime) return true;
      const flags = await resolveFeatureFlags();
      return flags[`production_${area}`] === true;
    },
  };
}

function gate(area: ProductionArea, policy: ProductionBoundaryPolicy): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.isAuthenticated?.()) return next();
      if (await policy.areaEnabled(area)) return next();
      return sendError(
        res,
        403,
        "FEATURE_NOT_PRODUCTION_APPROVED",
        `${area.replace(/_/g, " ")} is not enabled in this procurement-only production release.`,
        {
          hint: "Use the approved procurement workflow or ask an administrator about a controlled preview entitlement.",
          details: { area, productionReleaseScope: policy.scope },
        },
      );
    } catch (error) {
      console.error("Production boundary check failed:", error);
      return sendError(res, 503, "PRODUCTION_BOUNDARY_UNAVAILABLE", "The production feature boundary could not be verified.");
    }
  };
}

function gateMutations(area: ProductionArea, policy: ProductionBoundaryPolicy): RequestHandler {
  const areaGate = gate(area, policy);
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    return areaGate(req, res, next);
  };
}

export function registerProductionReleaseBoundary(
  app: Express,
  auth: Auth,
  options: ProductionBoundaryOptions = {},
): void {
  const policy = createProductionBoundaryPolicy(options);
  app.get("/api/release-scope", auth.ensureAuthenticated, async (_req, res) => {
    const areas: ProductionArea[] = ["procurement", "inventory", "receiving", "logistics", "finance", "mobile_operations"];
    const entries = await Promise.all(areas.map(async (area) => [area, await policy.areaEnabled(area)] as const));
    return sendOk(res, {
      boundary: policy.scope,
      productionRuntime: policy.productionRuntime,
      modules: Object.fromEntries(entries),
      previewMode: !policy.productionRuntime,
      message: policy.productionRuntime && policy.scope === "procurement"
        ? "Procurement-only commercial release. Operational and finance modules require an explicit production entitlement."
        : "Non-production modules are available for controlled preview and verification.",
    });
  });

  // Procurement still needs read access to item, warehouse, tax, and currency reference data.
  // These gates protect operational mutations and finance execution, while Master Data remains available.
  app.use("/api/stock-movements", gate("inventory", policy));
  app.use("/api/warehouse-inventory", gate("inventory", policy));
  app.use("/api/warehouse-transfers", gate("inventory", policy));
  app.use("/api/cycle-counts", gate("inventory", policy));
  app.use("/api/cycle-count-lines", gate("inventory", policy));
  app.use("/api/reorder-requests", gate("inventory", policy));
  app.use("/api/inventory-batches", gate("inventory", policy));
  app.use("/api/inventory-serials", gate("inventory", policy));
  app.use("/api/inventory-allocations", gate("inventory", policy));
  app.use("/api/inventory-sync", gate("inventory", policy));
  app.use("/api/inventory", gateMutations("inventory", policy));
  app.use("/api/mobile/receive", gate("receiving", policy));
  app.use("/api/mobile/counts", gate("mobile_operations", policy));
  app.use("/api/mobile/scan", gate("mobile_operations", policy));
  app.use("/api/sync/batch", gate("mobile_operations", policy));
  app.use("/api/shipments", gate("logistics", policy));
  app.use("/api/logistics", gate("logistics", policy));
  app.use("/api/exceptions", gate("logistics", policy));
  app.use("/api/accounts-payable", gate("finance", policy));
  app.use("/api/ap", gate("finance", policy));
  app.use("/api/invoices", gate("finance", policy));
  app.use("/api/payments", gate("finance", policy));
  app.use("/api/billing", gate("finance", policy));
}
