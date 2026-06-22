import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { sendOk, sendError } from "../api-response";

type SessionWithCustomKpis = Request["session"] & { customKpis?: CustomKpi[] };

type CustomKpi = {
  id: string;
  name: string;
  description?: string;
  metric: "revenue" | "orders" | "inventory_value" | "supplier_count" | "on_time_delivery" | "stock_turnover";
  period: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  target?: number;
  threshold?: "warning" | "critical";
  compareToLastPeriod?: boolean;
};

const requireAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated?.()) return next();
  return sendError(res, 401, "UNAUTHORIZED", "Authentication is required.");
};

/**
 * Custom KPI Routes
 * Handles CRUD operations for user-defined dashboard KPIs
 */
export function registerCustomKpiRoutes(app: Router) {
  // GET all custom KPIs for authenticated user
  app.get("/api/dashboard/custom-kpis", requireAuthenticated, async (req: Request, res: Response) => {
    try {
      const session = req.session as SessionWithCustomKpis | undefined;
      const kpis = session?.customKpis ?? [];

      return sendOk(res, kpis, 200, { count: kpis.length });
    } catch (error) {
      return sendError(
        res,
        500,
        "CUSTOM_KPIS_FETCH_FAILED",
        error instanceof Error ? error.message : "Failed to fetch custom KPIs",
      );
    }
  });

  // POST create new custom KPI
  app.post("/api/dashboard/custom-kpis", requireAuthenticated, async (req: Request, res: Response) => {
    try {
      const kpiSchema = z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        metric: z.enum(["revenue", "orders", "inventory_value", "supplier_count", "on_time_delivery", "stock_turnover"]),
        period: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]),
        target: z.number().optional(),
        threshold: z.enum(["warning", "critical"]).optional(),
        compareToLastPeriod: z.boolean().optional(),
      });

      const validated = kpiSchema.parse(req.body);
      const id = `kpi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const session = req.session as SessionWithCustomKpis | undefined;
      if (!session) return sendError(res, 500, "SESSION_UNAVAILABLE", "Session storage is unavailable.");
      session.customKpis ??= [];

      const newKpi = {
        id,
        ...validated,
      };

      session.customKpis.push(newKpi);

      return sendOk(res, newKpi, 201, { action: "created" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", "Validation failed", {
          details: { errors: error.errors },
        });
      }
      return sendError(
        res,
        500,
        "CUSTOM_KPI_CREATE_FAILED",
        error instanceof Error ? error.message : "Failed to create KPI",
      );
    }
  });

  // DELETE custom KPI
  app.delete("/api/dashboard/custom-kpis/:id", requireAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = req.session as SessionWithCustomKpis | undefined;

      if (!session?.customKpis) {
        return sendError(res, 404, "CUSTOM_KPI_NOT_FOUND", "KPI not found");
      }

      const index = session.customKpis.findIndex((k) => k.id === id);
      if (index === -1) {
        return sendError(res, 404, "CUSTOM_KPI_NOT_FOUND", "KPI not found");
      }

      session.customKpis.splice(index, 1);

      return sendOk(res, { id }, 200, { action: "deleted" });
    } catch (error) {
      return sendError(
        res,
        500,
        "CUSTOM_KPI_DELETE_FAILED",
        error instanceof Error ? error.message : "Failed to delete KPI",
      );
    }
  });
}
