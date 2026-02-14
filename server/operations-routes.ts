import type { Express, NextFunction, Request, Response } from "express";
import {
  adjustOperationalInventory,
  getOperationalInventoryDetail,
  listOperationalInventory,
} from "./operations-core";

type AuthGuards = {
  ensureAuthenticated: (req: Request, res: Response, next: NextFunction) => void;
};

const INVENTORY_ROUTE_RESERVED_SEGMENTS = new Set([
  "low-stock",
  "out-of-stock",
  "stats",
  "bulk-import",
  "find-by-barcode",
]);

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

export function registerOperationalRoutes(app: Express, auth: AuthGuards) {
  app.get("/api/inventory", async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string"
          ? req.query.q
          : typeof req.query.search === "string"
            ? req.query.search
            : "";
      const location =
        typeof req.query.location === "string"
          ? req.query.location
          : "";
      const category =
        typeof req.query.category === "string"
          ? req.query.category
          : typeof req.query.categoryId === "string"
            ? req.query.categoryId
            : "";
      const low = parseBooleanFlag(req.query.low) || parseBooleanFlag(req.query.lowStock);

      const items = await listOperationalInventory({ q, location, category, low });
      res.json(items);
    } catch (error) {
      console.error("Operational inventory list error:", error);
      res.status(500).json({ message: "Failed to fetch operational inventory data" });
    }
  });

  app.post(
    "/api/inventory/:sku/adjust",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const sku = req.params.sku;
        const location = typeof req.body?.location === "string" ? req.body.location : "";
        const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
        const ref = typeof req.body?.ref === "string" ? req.body.ref : undefined;
        const delta = Number(req.body?.delta);
        const createdBy = req.user?.username || req.user?.email || "system";

        if (!reason.trim()) {
          return res.status(400).json({ message: "reason is required" });
        }

        const result = await adjustOperationalInventory({
          skuOrId: sku,
          location,
          delta,
          reason,
          ref,
          createdBy,
        });

        res.status(200).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "adjust_failed";

        if (message === "delta_must_be_non_zero") {
          return res.status(400).json({ message: "delta must be non-zero" });
        }
        if (message === "location_required") {
          return res.status(400).json({ message: "location is required" });
        }
        if (message === "sku_not_found") {
          return res.status(404).json({ message: "sku not found" });
        }
        if (message === "location_not_found") {
          return res.status(400).json({ message: "location not found" });
        }

        console.error("Inventory adjust error:", error);
        return res.status(500).json({ message: "Failed to adjust inventory" });
      }
    },
  );

  app.get("/api/inventory/:sku", async (req: Request, res: Response, next: NextFunction) => {
    const sku = req.params.sku;
    if (INVENTORY_ROUTE_RESERVED_SEGMENTS.has(sku)) {
      return next();
    }

    try {
      const detail = await getOperationalInventoryDetail(sku);
      if (!detail) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      return res.json(detail);
    } catch (error) {
      console.error("Operational inventory detail error:", error);
      return res.status(500).json({ message: "Failed to fetch inventory detail" });
    }
  });
}
