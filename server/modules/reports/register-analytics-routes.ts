import type { Express, Request, RequestHandler, Response } from "express";
import { pool } from "../../db";
import { storage } from "../../storage";
import { sendError, sendOk } from "../../api-response";
import { buildSupplyInsights } from "../../supply-insights";
import { emitNotificationToRoles } from "../../services/notification-emitter";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

/**
 * Reports/analytics JSON endpoints (not `/api/export` file download — that stays in routes until split).
 */
export function registerAnalyticsRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated, auth.ensurePermission("reports", "read")];
  const masterWrite = [auth.ensureAuthenticated, auth.ensurePermission("reports", "update")];

  app.get("/api/reports/analytics", ...masterRead, async (req: Request, res: Response) => {
    try {
      const supplierList = await storage.getAllSuppliers();
      const poList = await storage.getAllPurchaseOrders();
      const inventoryList = await storage.getAllInventoryItems();
      const movementList = await storage.getAllStockMovements();
      const warehouseList = await storage.getAllWarehouses();
      const fromDate = typeof req.query.from === "string" && req.query.from ? new Date(req.query.from) : null;
      const toDate = typeof req.query.to === "string" && req.query.to ? new Date(req.query.to) : null;
      const departmentId =
        typeof req.query.departmentId === "string" && req.query.departmentId
          ? Number(req.query.departmentId)
          : null;
      const filteredPoList = poList.filter((po) => {
        const createdAt = po.createdAt ? new Date(po.createdAt) : null;
        if (fromDate && createdAt && createdAt < fromDate) return false;
        if (toDate && createdAt && createdAt > toDate) return false;
        if (departmentId && Number(po.departmentId ?? 0) !== departmentId) return false;
        return true;
      });
      const warehouseInventoryGroups = await Promise.all(
        warehouseList.map(async (warehouse) => ({
          warehouseId: warehouse.id,
          records: await storage.getWarehouseInventory(warehouse.id),
        })),
      );

      const spendBySupplier = supplierList.map((supplier) => ({
        supplierName: supplier.name,
        totalSpend: filteredPoList
          .filter((po) => po.supplierId === supplier.id)
          .reduce((sum, po) => sum + Number(po.totalAmount ?? 0), 0),
      }));

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

      const warehouseUtilization = warehouseList.map((warehouse) => {
        const records = warehouseInventoryGroups.find((group) => group.warehouseId === warehouse.id)?.records ?? [];
        const used = records.reduce((sum, wi) => sum + Number(wi.quantity ?? 0), 0);
        const capacity = Math.max(used * 1.25, 1);
        return {
          warehouseName: warehouse.name,
          utilization: Number(((used / capacity) * 100).toFixed(1)),
        };
      });
      const supplierPerformance = supplierList.map((supplier) => {
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
           FROM ops_exceptions
           WHERE status IN ('open', 'in_progress')
           GROUP BY type
           ORDER BY open_count DESC`,
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
