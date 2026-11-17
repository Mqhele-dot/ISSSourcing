import type { Express, Request, RequestHandler, Response } from "express";
import { pool } from "../../db";
import { storage } from "../../storage";
import { sendError, sendOk } from "../../api-response";
import { buildSupplyInsights } from "../../supply-insights";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { z } from "zod";
import { getActiveOrganizationId } from "../../organization-context";
import { buildAnalyticsInsights } from "./analytics-insights-service";
import { registerFinancialMeasureRoutes } from "./register-financial-measure-routes";
import {resolveAnalyticsReadAccess} from './analytics-read-access';

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

/**
 * Reports/analytics JSON endpoints (not `/api/export` file download — that stays in routes until split).
 */
export function registerAnalyticsRoutes(app: Express, auth: AuthBundle): void {
  registerFinancialMeasureRoutes(app, auth);
  const masterRead = [auth.ensureAuthenticated, auth.ensurePermission("reports", "read")];
  const masterWrite = [auth.ensureAuthenticated, auth.ensurePermission("reports", "update")];

  const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
    const date=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  });
  const analyticsQuerySchema = z.object({
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
    businessArea: z.enum(["all", "procurement", "inventory", "warehouse", "logistics", "finance", "suppliers", "exceptions", "diagnostics"]).default("all"),
    supplierId: z.coerce.number().int().positive().optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    ownerId: z.coerce.number().int().positive().optional(),
    departmentId: z.coerce.number().int().positive().optional(),
    risk: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.string().trim().min(1).max(80).optional(),
  }).strict().superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "Date to must be on or after date from." });
    }
  });

  // Keep the public route registry local to registration. This prevents a
  // development-loader module cycle from leaving these routes unregistered and
  // allowing the SPA HTML fallback to answer an API request.
  const insightAreas = ["overview", "procurement", "inventory", "logistics", "suppliers", "finance", "exceptions", "diagnostics", "reports"] as const;
  for (const area of insightAreas) {
    app.get(`/api/analytics/${area}`, ...masterRead, async (req: Request, res: Response) => {
      const parsed = analyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendError(res, 400, "INVALID_ANALYTICS_QUERY", "Analytics filters are invalid.", {
          fieldIssues: parsed.error.flatten().fieldErrors as Record<string, string[]>,
        });
      }
      try {
        const filters = {
          ...parsed.data,
          dateFrom: parsed.data.dateFrom ? new Date(`${parsed.data.dateFrom}T00:00:00.000Z`).toISOString() : undefined,
          dateTo: parsed.data.dateTo ? new Date(`${parsed.data.dateTo}T23:59:59.999Z`).toISOString() : undefined,
        };
        res.setHeader("Cache-Control", "private, no-store");
        return sendOk(res, await buildAnalyticsInsights(getActiveOrganizationId(), area, filters,await resolveAnalyticsReadAccess()));
      } catch {
        return sendError(res, 500, "ANALYTICS_INSIGHTS_FAILED", "Analytics could not be generated.", {
          hint: "Retry the view. If the problem continues, open System Diagnostics with the request ID.",
        });
      }
    });
  }

  const legacyScopeSchema=z.object({from:z.union([dateString,z.string().datetime({offset:true})]).optional(),to:z.union([dateString,z.string().datetime({offset:true})]).optional(),departmentId:z.coerce.number().int().positive().optional()}).strict()
    .refine(q=>!q.from||!q.to||Date.parse(q.from)<=Date.parse(q.to),"Start date must not follow end date.");
  app.get("/api/reports/analytics", ...masterRead,auth.ensurePermission("inventory","read"),auth.ensurePermission("purchases","read"),auth.ensurePermission("suppliers","read"), async (req: Request, res: Response) => {
    const scope=legacyScopeSchema.safeParse(req.query);
    if(!scope.success)return sendError(res,400,"INVALID_ANALYTICS_QUERY","Use valid from/to dates and a department. Other filters are unsupported on this compatibility report; use shared financial reporting.");
    try {
      const supplierList = await storage.getAllSuppliers();
      const poList = await storage.getAllPurchaseOrders();
      const inventoryList = await storage.getAllInventoryItems();
      const movementList = await storage.getAllStockMovements();
      const fromDate = scope.data.from ? new Date(scope.data.from) : null;
      const toDate = scope.data.to ? new Date(scope.data.to) : null;
      const departmentId = scope.data.departmentId??null;
      const filteredPoList = poList.filter((po) => {
        const createdAt = po.createdAt ? new Date(po.createdAt) : null;
        if (fromDate && createdAt && createdAt < fromDate) return false;
        if (toDate && createdAt && createdAt > toDate) return false;
        if (departmentId && Number(po.departmentId ?? 0) !== departmentId) return false;
        return true;
      });

      // No financial aggregation is valid here: these are mutable document
      // values in potentially different currencies, not reporting evidence.
      const spendBySupplier: never[] = [];

      const inventoryTurnover = inventoryList.map((item) => {
        const issued = movementList
          .filter(
            (movement) =>
              movement.itemId === item.id &&
              (movement.type === "ISSUE" || movement.type === "SALE" || movement.type === "TRANSFER"),
          )
          .reduce((sum, movement) => sum + Math.abs(Number(movement.quantity ?? 0)), 0);
        const onHand = Number(item.quantity ?? 0);
        return {
          sku: item.sku,
          turnover: onHand > 0 ? Number((issued / onHand).toFixed(2)) : 0,
        };
      });

      // A stock quantity is not evidence of configured physical bin capacity.
      const warehouseUtilization:never[]=[];
      const companySupplierScope = (await resolveAnalyticsReadAccess()).companySupplierScope === true;
      const supplierPerformance = !companySupplierScope ? [] : supplierList.map((supplier) => {
        const supplierOrders = filteredPoList.filter((po) => po.supplierId === supplier.id);
        let onTimeCount = 0;
        let measured = 0;
        for (const order of supplierOrders) {
          if (!order.expectedDeliveryDate) continue;
          const receipts = movementList
            .filter(
              (movement) =>
                movement.referenceType === "purchase_order" &&
                Number(movement.referenceId ?? 0) === order.id &&
                movement.type === "RECEIPT",
            )
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          if (receipts.length === 0) continue;
          measured += 1;
          const firstReceipt = new Date(receipts[0].receivedAt ?? receipts[0].timestamp);
          const eta = new Date(order.expectedDeliveryDate);
          if (!Number.isNaN(firstReceipt.getTime()) && !Number.isNaN(eta.getTime()) && firstReceipt <= eta) {
            onTimeCount += 1;
          }
        }
        return {
          supplierName: supplier.name,
          onTimeDeliveryRate: measured > 0 ? Number(((onTimeCount / measured) * 100).toFixed(1)) : 0,
          ordersMeasured: measured,
        };
      });

      let exceptionSummary: Array<{ type: string; openCount: number }> = [];
      try {
        const exceptionRows = await pool.query(
          `SELECT type, COUNT(*)::int AS open_count
           FROM operational_exceptions
           WHERE organization_id=$1 AND status IN ('open', 'in_progress')
           GROUP BY type
           ORDER BY open_count DESC`,
          [getActiveOrganizationId()],
        );
        exceptionSummary = (exceptionRows.rows ?? []).map((row: any) => ({
          type: String(row.type ?? "unknown"),
          openCount: Number(row.open_count ?? 0),
        }));
      } catch {
        exceptionSummary = [];
      }

      return sendOk(res, {
        spendBySupplier,
        financialMeasures:{state:"unavailable",deprecatedFields:["spendBySupplier"],summaryEndpoint:"/api/v2/analytics/financial-measures",reason:"Supplier spend requires dated reporting-currency evidence. Legacy document-currency totals are no longer returned."},
        unavailableMetrics:{warehouseUtilization:"Verified capacity evidence is required; capacity is never inferred from current stock.",
          ...(!companySupplierScope ? { supplierPerformance: "Organization-wide supplier evidence is unavailable for the current warehouse assignment." } : {})},
        observationScope:{purchaseOrders:scope.data,inventory:"current snapshot",movements:"recorded movement history",exceptions:"current organization"},
        inventoryTurnover,
        warehouseUtilization,
        supplierPerformance,
        exceptionSummary,
      });
    } catch (error) {
      console.error("Error generating analytics report:", error);
      return sendError(res, 500, "ANALYTICS_FAILED", "Failed to generate analytics report");
    }
  });

  app.get("/api/analytics/supply-insights", ...masterRead, async (_req: Request, res: Response) => {
    try {
      const out = await buildSupplyInsights();
      return sendOk(res, out);
    } catch (error) {
      console.error("Error building supply insights:", error);
      return sendError(res, 500, "INSIGHTS_FAILED", "Failed to build supply insights");
    }
  });

  app.post("/api/compliance/run-reminders", ...masterWrite, async (_req: Request, res: Response) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      const contracts = await storage.getContracts();
      const now = new Date();
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + 30);

      const insuranceExpiring = suppliers.filter((supplier) => {
        const expiry = (supplier as any).insuranceExpiry ? new Date((supplier as any).insuranceExpiry) : null;
        return expiry && !Number.isNaN(expiry.getTime()) && expiry >= now && expiry <= threshold;
      });
      const contractsExpiring = contracts.filter((contract) => {
        const end = contract.endDate ? new Date(contract.endDate) : null;
        return end && !Number.isNaN(end.getTime()) && end >= now && end <= threshold;
      });

      let notificationsCreated = 0;
      for (const supplier of insuranceExpiring) {
        await emitNotificationToRoles(["manager", "admin"], {
          type: "contract_expiry",
          title: `Supplier insurance expiring: ${supplier.name}`,
          body: `Insurance expiry is within 30 days.`,
          entityType: "supplier",
          entityId: supplier.id,
          dueAt: new Date((supplier as { insuranceExpiry?: string | Date }).insuranceExpiry!),
          priority: "high",
        });
        notificationsCreated += 1;
      }
      for (const contract of contractsExpiring) {
        await emitNotificationToRoles(["manager", "admin"], {
          type: "contract_expiry",
          title: `Contract nearing expiry: ${contract.title}`,
          body: `Contract end date is within 30 days.`,
          entityType: "contract",
          entityId: contract.id,
          dueAt: new Date(contract.endDate!),
          priority: "high",
        });
        notificationsCreated += 1;
      }

      return sendOk(res, {
        insuranceExpiring: insuranceExpiring.length,
        contractsExpiring: contractsExpiring.length,
        notificationsCreated,
      });
    } catch (error) {
      console.error("Error running compliance reminders:", error);
      return sendError(res, 500, "COMPLIANCE_REMINDERS_FAILED", "Failed to run compliance reminders");
    }
  });
}
