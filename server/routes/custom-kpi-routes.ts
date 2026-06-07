import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../storage";
import { ensureAuthenticated, ensureRole } from "../auth";
import { sendOk, sendError } from "../api-response";

/**
 * Custom KPI Routes
 * Handles CRUD operations for user-defined dashboard KPIs
 */
export function registerCustomKpiRoutes(app: Router) {
  // GET all custom KPIs for authenticated user
  app.get("/api/dashboard/custom-kpis", ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // For now, store in session/memory (production would use DB table)
      // This is a simplified implementation
      const kpis = (req as any).session?.customKpis || [];
      
      return sendOk(res, kpis, {
        count: kpis.length,
      });
    } catch (error: any) {
      return sendError(res, 500, error.message || "Failed to fetch custom KPIs");
    }
  });

  // POST create new custom KPI
  app.post("/api/dashboard/custom-kpis", ensureAuthenticated, async (req: Request, res: Response) => {
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

      // Store in session
      if (!(req as any).session) {
        (req as any).session = {};
      }
      if (!(req as any).session.customKpis) {
        (req as any).session.customKpis = [];
      }

      const newKpi = {
        id,
        ...validated,
      };

      (req as any).session.customKpis.push(newKpi);

      return sendOk(res, newKpi, { action: "created" });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "Validation failed", {
          errors: error.errors,
        });
      }
      return sendError(res, 500, error.message || "Failed to create KPI");
    }
  });

  // DELETE custom KPI
  app.delete("/api/dashboard/custom-kpis/:id", ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!(req as any).session?.customKpis) {
        return sendError(res, 404, "KPI not found");
      }

      const index = (req as any).session.customKpis.findIndex((k: any) => k.id === id);
      if (index === -1) {
        return sendError(res, 404, "KPI not found");
      }

      (req as any).session.customKpis.splice(index, 1);

      return sendOk(res, { id }, { action: "deleted" });
    } catch (error: any) {
      return sendError(res, 500, error.message || "Failed to delete KPI");
    }
  });
}
