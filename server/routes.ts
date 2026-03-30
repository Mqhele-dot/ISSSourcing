import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { db } from "./db";
import { getDemoDataSummary, getSchemaStatus, resetAndSeedDemoData } from "./seed";
import { seedOperationalIfEmpty } from "./seed-operational";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { Buffer } from "buffer";
import { setupAuth } from "./auth";
import {
  generateReorderRequestsPdfReport,
  generateReorderRequestsCsvReport,
  generateReorderRequestsExcelReport
} from "./reorder-request-generators";
import {
  generateDemandForecast,
  getTopItems,
  inventoryLineValue,
  effectiveUnitCost,
} from "./forecast-service";
import { initializeWebSocketService } from "./websocket-service";
import { initializeRealTimeSyncService, getConnectedClientInfo, notifyDataChange } from "./real-time-sync-service";
import { registerImageRecognitionRoutes } from "./controllers/image-recognition-controller";
import { registerDocumentExtractorRoutes } from "./controllers/document-extractor-controller";
import { uploadProfilePicture, removeProfilePicture, updateProfilePictureUrl } from "./controllers/profile-picture-controller";
import { profilePictureUpload } from "./services/cloudinary-service";
import { generateDocument } from "./services/document-generator-service";
import { loadLogoBytesForPdf } from "./services/pdf-logo-loader";
import { getApprovalSuggestions } from "./approval-suggestions";
import { buildSupplyInsights } from "./supply-insights";
import type { ReportFormat, ReportType} from "@shared/schema";
import { reportTypeEnum, reportFormatEnum } from "@shared/schema";
import { registerOperationsRoutes as registerOperationalRoutes } from "./modules/operations/register-operations-routes";
import { registerDomainModules } from "./modules/register-domain-modules";
import { registerRbacRoutes } from "./modules/rbac/register-rbac-routes";
import { registerCatalogRoutes } from "./modules/catalog/register-catalog-routes";
import { getActiveOrganizationId } from "./organization-context";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "./org-features";
import { readiness } from "./readiness";
import { sendError, sendOk, sendFunctionError } from "./api-response";
import { emitNotification, emitNotificationToRoles } from "./services/notification-emitter";
import { eq, and, isNull, gte, lte, asc } from "drizzle-orm";
import { 
  insertInventoryItemSchema, 
  bulkImportInventorySchema,
  insertAppSettingsSchema,
  appSettingsFormSchema,
  insertBarcodeSchema,
  barcodeFormSchema,
  insertStockMovementSchema,
  stockMovementFormSchema,
  insertUnitOfMeasureSchema,
  insertCurrencySchema,
  insertTaxCodeSchema,
  insertCommodityCodeSchema,
  insertIncotermSchema,
  insertPaymentTermSchema,
  insertDepartmentSchema,
  insertCarrierSchema,
  insertApprovalPolicySchema,
  insertRetentionPolicySchema,
  insertInventoryBatchSchema,
  insertInventorySerialSchema,
  insertInventoryAllocationSchema,
  insertCycleCountSchema,
  insertCycleCountLineSchema,
  unitsOfMeasure,
  currencies,
  taxCodes,
  commodityCodes,
  incoterms,
  paymentTerms,
  departments,
  carriers,
  approvalPolicies,
  approvalHistory,
  documents,
  retentionPolicies,
  inventoryItems,
  inventoryBatches,
  inventorySerials,
  inventoryAllocations,
  warehouseInventory,
  cycleCounts,
  cycleCountLines,
  invoices,
  purchaseOrders,
  purchaseOrderItems,
  purchaseRequisitions,
  stockMovements,
  PurchaseRequisitionStatus,
  PurchaseOrderStatus,
  PaymentStatus,
  userRoleEnum,
  resourceEnum,
  permissionTypeEnum,
  type DocumentType,
  organizationSettings,
  projects,
} from "@shared/schema";

import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import Excel from 'exceljs';
import { createObjectCsvWriter } from 'csv-writer';
import {
  mountUploadsStatic,
  pdfTemplateUpload,
  uploadsDir,
} from "./http/upload-config";
import { csvBufferForExcel, workbookToBuffer } from "./http/export-helpers";

export async function registerRoutes(app: Express): Promise<Server> {
  mountUploadsStatic(app);
  // Set up authentication routes and middleware
  const auth = setupAuth(app);
  registerOperationalRoutes(app, auth);
  registerDomainModules(app, auth);
  registerRbacRoutes(app, auth);
  registerCatalogRoutes(app, auth);

  // Master data endpoints — foundational reference data
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  const registerMasterDataCrud = <TInsert>(
    basePath: string,
    table: any,
    insertSchema: { parse: (input: unknown) => TInsert },
  ) => {
    app.get(basePath, ...masterRead, async (_req: Request, res: Response) => {
      try {
        const rows = await db.select().from(table);
        res.json(rows);
      } catch (error) {
        console.error(`Error fetching ${basePath}:`, error);
        res.status(500).json({ message: "Failed to fetch records" });
      }
    });

    app.get(`${basePath}/:id`, ...masterRead, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
        const rows = (await db.select().from(table).where(eq(table.id, id))) as any[];
        const row = rows[0];
        if (!row) return res.status(404).json({ message: "Record not found" });
        res.json(row);
      } catch (error) {
        console.error(`Error fetching ${basePath} item:`, error);
        res.status(500).json({ message: "Failed to fetch record" });
      }
    });

    app.post(basePath, ...masterWrite, async (req: Request, res: Response) => {
      try {
        const normalizedBody =
          basePath === "/api/currencies" &&
          req.body &&
          typeof req.body === "object" &&
          (!("symbol" in req.body) || !String((req.body as { symbol?: unknown }).symbol ?? "").trim())
            ? {
                ...(req.body as Record<string, unknown>),
                symbol: String((req.body as { code?: unknown }).code ?? "").trim().slice(0, 3) || "$",
              }
            : req.body;
        const payload = insertSchema.parse(normalizedBody) as any;
        const createdRows = (await db.insert(table).values(payload).returning()) as any[];
        const created = createdRows[0];
        res.status(201).json(created);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ message: fromZodError(error).message });
        }
        console.error(`Error creating ${basePath}:`, error);
        res.status(500).json({ message: "Failed to create record" });
      }
    });

    app.patch(`${basePath}/:id`, ...masterWrite, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
        let patchBody = req.body;
        if (basePath === "/api/currencies" && patchBody && typeof patchBody === "object") {
          const rows = (await db.select().from(table).where(eq(table.id, id))) as Array<{
            code?: string;
            symbol?: string;
          }>;
          const existing = rows[0];
          if (!existing) return res.status(404).json({ message: "Record not found" });
          const incoming = { ...(patchBody as Record<string, unknown>) };
          if (!("symbol" in incoming) || !String(incoming.symbol ?? "").trim()) {
            const codeStr = String(incoming.code ?? existing.code ?? "").trim();
            incoming.symbol = codeStr.slice(0, 3) || String(existing.symbol ?? "").trim() || "$";
          }
          patchBody = incoming;
        }
        const payload = (insertSchema as any).partial().parse(patchBody);
        const updatedRows = (await db.update(table).set(payload).where(eq(table.id, id)).returning()) as any[];
        const updated = updatedRows[0];
        if (!updated) return res.status(404).json({ message: "Record not found" });
        res.json(updated);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ message: fromZodError(error).message });
        }
        console.error(`Error updating ${basePath}:`, error);
        res.status(500).json({ message: "Failed to update record" });
      }
    });

    app.delete(`${basePath}/:id`, ...masterWrite, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
        const deleted = (await db.delete(table).where(eq(table.id, id)).returning({ id: table.id })) as any[];
        if (deleted.length === 0) return res.status(404).json({ message: "Record not found" });
        res.status(204).send();
      } catch (error) {
        console.error(`Error deleting ${basePath}:`, error);
        res.status(500).json({ message: "Failed to delete record" });
      }
    });
  };

  registerMasterDataCrud("/api/units-of-measure", unitsOfMeasure, insertUnitOfMeasureSchema as any);
  registerMasterDataCrud("/api/currencies", currencies, insertCurrencySchema as any);
  registerMasterDataCrud("/api/tax-codes", taxCodes, insertTaxCodeSchema as any);
  registerMasterDataCrud("/api/commodity-codes", commodityCodes, insertCommodityCodeSchema as any);
  registerMasterDataCrud("/api/incoterms", incoterms, insertIncotermSchema as any);
  registerMasterDataCrud("/api/payment-terms", paymentTerms, insertPaymentTermSchema as any);
  registerMasterDataCrud("/api/departments", departments, insertDepartmentSchema as any);
  registerMasterDataCrud("/api/carriers", carriers, insertCarrierSchema as any);
  registerMasterDataCrud("/api/inventory-batches", inventoryBatches, insertInventoryBatchSchema as any);
  registerMasterDataCrud("/api/inventory-serials", inventorySerials, insertInventorySerialSchema as any);
  registerMasterDataCrud("/api/inventory-allocations", inventoryAllocations, insertInventoryAllocationSchema as any);
  registerMasterDataCrud("/api/cycle-counts", cycleCounts, insertCycleCountSchema as any);
  registerMasterDataCrud("/api/cycle-count-lines", cycleCountLines, insertCycleCountLineSchema as any);

  app.post("/api/cycle-counts/:id/post", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid cycle count ID" });

      const cycleCountRows = await db.select().from(cycleCounts).where(eq(cycleCounts.id, id));
      const cycleCount = cycleCountRows[0];
      if (!cycleCount) return res.status(404).json({ message: "Cycle count not found" });

      const lines = await db.select().from(cycleCountLines).where(eq(cycleCountLines.cycleCountId, id));
      if (lines.length === 0) {
        return res.status(400).json({ message: "Cycle count has no lines to post" });
      }

      let totalVariance = 0;
      const adjustments: Array<{ itemId: number; variance: number; movementId: number }> = [];
      for (const line of lines) {
        const counted = Number(line.countedQuantity ?? 0);
        const system = Number(line.systemQuantity ?? 0);
        const variance = counted - system;
        totalVariance += variance;

        await db
          .update(cycleCountLines)
          .set({ variance })
          .where(eq(cycleCountLines.id, line.id));

        if (variance !== 0) {
          const movement = await storage.createStockMovement({
            itemId: line.itemId,
            warehouseId: cycleCount.warehouseId,
            type: "ADJUSTMENT",
            quantity: variance,
            destinationWarehouseId: cycleCount.warehouseId,
            notes: `Cycle count #${id} adjustment`,
            referenceId: id,
            referenceType: "cycle_count",
            userId: (req as Request & { user?: { id: number } }).user?.id ?? null,
          } as any);
          adjustments.push({ itemId: line.itemId, variance, movementId: movement.id });
        }
      }

      const updatedRows = (await db
        .update(cycleCounts)
        .set({
          status: "completed",
          variance: totalVariance,
          countedBy: (req as Request & { user?: { id: number } }).user?.id ?? null,
          countDate: new Date(),
        } as any)
        .where(eq(cycleCounts.id, id))
        .returning()) as any[];
      const updated = updatedRows[0];

      res.json({
        cycleCount: updated,
        adjustments,
        totalVariance,
      });
    } catch (error) {
      console.error("Error posting cycle count:", error);
      res.status(500).json({ message: "Failed to post cycle count" });
    }
  });

  // Approval policy + history
  app.get("/api/approval-policies", ...masterRead, async (_req, res) => {
    try {
      const rows = await db.select().from(approvalPolicies);
      res.json(rows);
    } catch (error) {
      console.error("Error fetching approval policies:", error);
      res.status(500).json({ message: "Failed to fetch approval policies" });
    }
  });

  app.get("/api/approval-suggestions", ...masterRead, async (req: Request, res: Response) => {
    try {
      const entityType = String(req.query.entityType ?? "");
      const amount = Number(req.query.amount ?? NaN);
      if (entityType !== "requisition" && entityType !== "purchase_order") {
        return sendError(res, 400, "INVALID_ENTITY", "entityType must be requisition or purchase_order");
      }
      if (!Number.isFinite(amount) || amount < 0) {
        return sendError(res, 400, "INVALID_AMOUNT", "amount must be a non-negative number");
      }
      const out = await getApprovalSuggestions(entityType, amount);
      return sendOk(res, out);
    } catch (error) {
      console.error("Error building approval suggestions:", error);
      return sendError(res, 500, "SUGGESTIONS_FAILED", "Failed to load approval suggestions");
    }
  });

  app.post("/api/approval-policies", ...masterWrite, async (req, res) => {
    try {
      const payload = insertApprovalPolicySchema.parse(req.body);
      const createdRows = (await db.insert(approvalPolicies).values(payload).returning()) as any[];
      const created = createdRows[0];
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating approval policy:", error);
      res.status(500).json({ message: "Failed to create approval policy" });
    }
  });

  app.patch("/api/approval-policies/:id", ...masterWrite, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid policy ID" });
      const payload = insertApprovalPolicySchema.partial().parse(req.body);
      const updatedRows = (await db.update(approvalPolicies).set(payload).where(eq(approvalPolicies.id, id)).returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return res.status(404).json({ message: "Approval policy not found" });
      res.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating approval policy:", error);
      res.status(500).json({ message: "Failed to update approval policy" });
    }
  });

  app.delete("/api/approval-policies/:id", ...masterWrite, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid policy ID" });
      const deleted = await db.delete(approvalPolicies).where(eq(approvalPolicies.id, id)).returning({ id: approvalPolicies.id });
      if (deleted.length === 0) return res.status(404).json({ message: "Approval policy not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting approval policy:", error);
      res.status(500).json({ message: "Failed to delete approval policy" });
    }
  });

  app.get("/api/approval-history/:entityType/:entityId", ...masterRead, async (req, res) => {
    try {
      const entityType = String(req.params.entityType);
      const entityId = Number(req.params.entityId);
      if (isNaN(entityId)) return res.status(400).json({ message: "Invalid entity ID" });
      const rows = await db
        .select()
        .from(approvalHistory)
        .where(and(eq(approvalHistory.entityType, entityType), eq(approvalHistory.entityId, entityId)));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching approval history:", error);
      res.status(500).json({ message: "Failed to fetch approval history" });
    }
  });

  // Retention policies (admin)
  registerMasterDataCrud("/api/retention-policies", retentionPolicies, insertRetentionPolicySchema as any);

  app.post("/api/retention-policies/run", ...masterWrite, async (_req: Request, res: Response) => {
    try {
      const policies = await db.select().from(retentionPolicies);
      let archivedCount = 0;
      for (const policy of policies as any[]) {
        const years = Number(policy.retentionYears ?? 0);
        if (!Number.isFinite(years) || years <= 0) continue;
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - years);
        const updatedRows = (await db
          .update(documents)
          .set({ archivedAt: new Date() } as any)
          .where(
            and(
              eq(documents.entityType, String(policy.documentType ?? "")),
              isNull(documents.archivedAt),
              lte(documents.uploadedAt, cutoff),
            ),
          )
          .returning({ id: documents.id })) as any[];
        archivedCount += updatedRows.length;
      }
      res.json({ archivedCount });
    } catch (error) {
      console.error("Error running retention policy job:", error);
      res.status(500).json({ message: "Failed to run retention policies" });
    }
  });

  /** Supplier portal: maps authenticated supplier user → suppliers.id (see users.supplier_id). */
  app.get("/api/supplier/context", ...masterRead, async (req: Request, res: Response) => {
    const sessionUser = (req as Request & { user?: { id?: number; role?: string } }).user;
    const role = String(sessionUser?.role ?? "").toLowerCase();
    if (role !== "supplier") {
      return res.status(403).json({ message: "Supplier role required" });
    }
    const uid = sessionUser?.id;
    if (uid == null) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const u = await storage.getUser(Number(uid));
    const mappedSupplierId = u?.supplierId != null ? Number(u.supplierId) : null;
    res.json({
      mappedSupplierId,
      note:
        mappedSupplierId == null
          ? "Set Supplier ID on this user in Employee Profiles to scope portal orders."
          : null,
    });
  });

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

      res.json({
        spendBySupplier,
        inventoryTurnover,
        warehouseUtilization,
        supplierPerformance,
        exceptionSummary,
      });
    } catch (error) {
      console.error("Error generating analytics report:", error);
      res.status(500).json({ message: "Failed to generate analytics report" });
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

      res.json({
        insuranceExpiring: insuranceExpiring.length,
        contractsExpiring: contractsExpiring.length,
        notificationsCreated,
      });
    } catch (error) {
      console.error("Error running compliance reminders:", error);
      res.status(500).json({ message: "Failed to run compliance reminders" });
    }
  });

  const invWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  // Bulk import inventory items
  app.post("/api/inventory/bulk-import", ...invWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = bulkImportInventorySchema.parse(req.body);
      const result = await storage.bulkImportInventory(validatedData);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error bulk importing inventory:", error);
        res.status(500).json({ message: "Failed to bulk import inventory" });
      }
    }
  });

  // Custom PDF template upload (for report export with template=custom)
  app.post("/api/settings/pdf-template", pdfTemplateUpload.single("template"), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: "No PDF file uploaded. Please select a PDF file." });
    }
    return res.json({ ok: true, message: "Custom PDF template uploaded. Use template 'Custom' when exporting PDF reports." });
  });

  // Document generation endpoints
  app.get("/api/export/:reportType/:format", async (req: Request, res: Response) => {
    try {
      const flags = await getFeatureFlagsForActiveOrg();
      if (!isOrgFeatureEnabled(flags, "exports")) {
        return sendOrgFeatureDisabled(res, "exports");
      }

      const reportType = req.params.reportType;
      const format = req.params.format;
      
      // Validate report type
      const validReportTypes = reportTypeEnum;
      const normalizedReportType = reportType.replace(/-/g, '_');
      
      if (!validReportTypes.includes(normalizedReportType as ReportType)) {
        return res.status(400).json({ 
          message: "Invalid report type. Valid types are: " + validReportTypes.join(', ')
        });
      }
      
      // Validate format
      const validFormats = reportFormatEnum;
      if (!validFormats.includes(format as ReportFormat)) {
        return res.status(400).json({ 
          message: "Invalid format. Valid formats are: " + validFormats.join(', ')
        });
      }
      
      // Get optional filter parameters
      const startDateParam = req.query.startDate as string;
      const endDateParam = req.query.endDate as string;
      const categoryIdParam = req.query.categoryId as string;
      const warehouseIdParam = req.query.warehouseId as string;
      const supplierIdParam = req.query.supplierId as string;
      const projectIdParam = req.query.projectId as string;
      const statusParam = req.query.status as string;
      const poParam = typeof req.query.po === "string" ? req.query.po : undefined;
      const carrierParam = typeof req.query.carrier === "string" ? req.query.carrier : undefined;
      const riskParam = typeof req.query.risk === "string" ? req.query.risk : undefined;
      const templateParam = (req.query.template as string) || "standard";

      // Create filter object
      const filter: any = {};
      
      // Parse date range if provided
      if (startDateParam && endDateParam) {
        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);
        
        // Set end date to end of day
        endDate.setHours(23, 59, 59, 999);
        
        // Validate dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid date format. Please use ISO format (YYYY-MM-DD)." });
        }
        
        filter.startDate = startDate;
        filter.endDate = endDate;
      }
      
      // Parse filters if provided
      if (categoryIdParam) {
        const categoryId = parseInt(categoryIdParam);
        if (!isNaN(categoryId)) {
          filter.categoryId = categoryId;
        }
      }
      
      if (warehouseIdParam) {
        const warehouseId = parseInt(warehouseIdParam);
        if (!isNaN(warehouseId)) {
          filter.warehouseId = warehouseId;
        }
      }
      
      if (supplierIdParam) {
        const supplierId = parseInt(supplierIdParam);
        if (!isNaN(supplierId)) {
          filter.supplierId = supplierId;
        }
      }

      if (projectIdParam) {
        const projectId = parseInt(projectIdParam);
        if (!isNaN(projectId)) {
          filter.projectId = projectId;
        }
      }
      
      if (statusParam) {
        filter.status = statusParam;
      }
      if (poParam) {
        filter.po = poParam;
      }
      if (carrierParam) {
        filter.carrier = carrierParam;
      }
      if (riskParam) {
        filter.risk = riskParam;
      }
      
      // Build filter text for title
      let filterTexts = [];
      if (filter.startDate && filter.endDate) {
        filterTexts.push(`${filter.startDate.toISOString().split('T')[0]} to ${filter.endDate.toISOString().split('T')[0]}`);
      }
      
      if (filter.categoryId) {
        const category = await storage.getCategory(filter.categoryId);
        if (category) {
          filterTexts.push(`Category: ${category.name}`);
        }
      }
      
      if (filter.warehouseId) {
        const warehouse = await storage.getWarehouse(filter.warehouseId);
        if (warehouse) {
          filterTexts.push(`Warehouse: ${warehouse.name}`);
        }
      }
      
      if (filter.supplierId) {
        const supplier = await storage.getSupplier(filter.supplierId);
        if (supplier) {
          filterTexts.push(`Supplier: ${supplier.name}`);
        }
      }

      if (filter.projectId) {
        const [proj] = await db
          .select({ name: projects.name, code: projects.code })
          .from(projects)
          .where(
            and(eq(projects.id, filter.projectId), eq(projects.organizationId, getActiveOrganizationId())),
          )
          .limit(1);
        if (proj) {
          filterTexts.push(`Project: ${proj.code} — ${proj.name}`);
        }
      }
      
      if (filter.status) {
        filterTexts.push(`Status: ${filter.status}`);
      }
      if (filter.po) {
        filterTexts.push(`PO: ${filter.po}`);
      }
      if (filter.carrier) {
        filterTexts.push(`Carrier: ${filter.carrier}`);
      }
      if (filter.risk) {
        filterTexts.push(`Risk: ${filter.risk}`);
      }
      
      const filterText = filterTexts.length > 0 ? ` (${filterTexts.join(', ')})` : '';
      
      // Get data based on report type
      let data: any[] = [];
      let title: string;
      
      switch (normalizedReportType) {
        case 'inventory': {
          // Apply category filter if provided
          let inventoryItems;
          if (filter.categoryId) {
            inventoryItems = (await storage.getAllInventoryItems()).filter(item => item.categoryId === filter.categoryId);
          } else {
            inventoryItems = await storage.getAllInventoryItems();
          }
          const categories = await storage.getAllCategories();
          const categoryById = new Map(categories.map((c) => [c.id, c.name]));
          data = inventoryItems.map((item) => ({
            ...item,
            categoryName: item.categoryId != null ? (categoryById.get(item.categoryId) ?? '—') : '—',
          }));
          title = 'Inventory Report' + filterText;
          break;
        }
          
        case 'categories':
          data = await storage.getAllCategories();
          title = 'Categories Report' + filterText;
          break;
          
        case 'suppliers': {
          let suppliersList = await storage.getAllSuppliers();
          if (filter.supplierId) {
            suppliersList = suppliersList.filter((s) => s.id === filter.supplierId);
          }
          data = suppliersList;
          title = 'Suppliers Report' + filterText;
          break;
        }
          
        case 'warehouses': {
          let warehousesList = await storage.getAllWarehouses();
          if (filter.warehouseId) {
            warehousesList = warehousesList.filter((w) => w.id === filter.warehouseId);
          }
          data = warehousesList;
          title = 'Warehouses Report' + filterText;
          break;
        }
          
        case 'stock_movements':
          let stockMovements = await storage.getAllStockMovements();
          
          // Apply date range filter if provided
          if (filter.startDate && filter.endDate) {
            stockMovements = stockMovements.filter(movement => 
              movement.createdAt >= filter.startDate && movement.createdAt <= filter.endDate
            );
          }
          
          // Apply warehouse filters if provided
          if (filter.warehouseId) {
            stockMovements =             stockMovements.filter((movement) =>
              movement.warehouseId === filter.warehouseId || movement.sourceWarehouseId === filter.warehouseId || movement.destinationWarehouseId === filter.warehouseId
            );
          }
          
          data = stockMovements;
          title = 'Stock Movements Report' + filterText;
          break;
          
        case 'users':
          data = await storage.getAllUsers();
          title = 'Users Report' + filterText;
          break;
          
        case 'reorder_requests':
          // Get reorder requests with date range filter
          let reorderRequests;
          if (filter.startDate && filter.endDate) {
            reorderRequests = await storage.getReorderRequestsByDateRange(filter.startDate, filter.endDate);
          } else {
            reorderRequests = await storage.getAllReorderRequests();
          }
          
          // Apply supplier filter if provided
          if (filter.supplierId) {
            reorderRequests = reorderRequests.filter(req => req.supplierId === filter.supplierId);
          }
          
          // Apply warehouse filter if provided
          if (filter.warehouseId) {
            reorderRequests = reorderRequests.filter(req => req.warehouseId === filter.warehouseId);
          }
          
          // Apply status filter if provided
          if (filter.status) {
            reorderRequests = reorderRequests.filter(req => req.status === filter.status);
          }

          const rrItems = await storage.getAllInventoryItems();
          const rrItemById = new Map(rrItems.map((i) => [i.id, i]));
          const rrUsers = await storage.getAllUsers();
          const rrUserLabel = new Map(
            rrUsers.map((u) => [u.id, (u.fullName || u.username || "").trim() || `User #${u.id}`]),
          );
          const rrSuppliers = await storage.getAllSuppliers();
          const rrSupplierNames = new Map(rrSuppliers.map((s) => [s.id, s.name]));
          const rrWarehouses = await storage.getAllWarehouses();
          const rrWarehouseNames = new Map(rrWarehouses.map((w) => [w.id, w.name]));
          data = reorderRequests.map((req) => ({
            ...req,
            itemName: rrItemById.get(req.itemId)?.name ?? `Item #${req.itemId}`,
            requestorName:
              req.requestorId != null ? (rrUserLabel.get(req.requestorId) ?? "") : "",
            supplierName:
              req.supplierId != null ? (rrSupplierNames.get(req.supplierId) ?? "") : "",
            warehouseName:
              req.warehouseId != null ? (rrWarehouseNames.get(req.warehouseId) ?? "") : "",
          }));
          title = 'Reorder Requests Report' + filterText;
          break;
          
        case 'purchase_orders': {
          // Get all orders
          let orders = await storage.getAllPurchaseOrders();
          
          // Apply date range filter if provided
          if (filter.startDate && filter.endDate) {
            orders = orders.filter(order => 
              order.createdAt >= filter.startDate && order.createdAt <= filter.endDate
            );
          }
          
          // Apply supplier filter if provided
          if (filter.supplierId) {
            orders = orders.filter(order => order.supplierId === filter.supplierId);
          }
          
          // Apply status filter if provided
          if (filter.status) {
            orders = orders.filter(order => order.status === filter.status);
          }
          if (filter.projectId) {
            orders = orders.filter(
              (order) => (order as { projectId?: number | null }).projectId === filter.projectId,
            );
          }

          const poSuppliers = await storage.getAllSuppliers();
          const poSupplierNames = new Map(poSuppliers.map((s) => [s.id, s.name]));
          if (format === "pdf") {
            const enriched: unknown[] = [];
            for (const o of orders) {
              const d = await storage.getPurchaseOrderWithDetails(o.id);
              if (d) enriched.push(d);
            }
            data = enriched;
          } else {
            data = orders.map((o) => ({
              ...o,
              supplierName: poSupplierNames.get(o.supplierId) ?? "",
            }));
          }
          title = 'Purchase Orders Report' + filterText;
          break;
        }
          
        case 'purchase_requisitions': {
          // Get all requisitions
          let requisitions = await storage.getAllPurchaseRequisitions();
          
          // Apply date range filter if provided
          if (filter.startDate && filter.endDate) {
            requisitions = requisitions.filter(req => 
              req.createdAt >= filter.startDate && req.createdAt <= filter.endDate
            );
          }
          
          // Apply supplier filter if provided
          if (filter.supplierId) {
            requisitions = requisitions.filter(req => req.supplierId === filter.supplierId);
          }
          
          // Apply status filter if provided
          if (filter.status) {
            requisitions = requisitions.filter(req => req.status === filter.status);
          }
          if (filter.projectId) {
            requisitions = requisitions.filter(
              (req) => (req as { projectId?: number | null }).projectId === filter.projectId,
            );
          }

          const reqSuppliers = await storage.getAllSuppliers();
          const reqSupplierNames = new Map(reqSuppliers.map((s) => [s.id, s.name]));
          const reqUsers = await storage.getAllUsers();
          const reqUserDisplay = new Map(
            reqUsers.map((u) => [u.id, (u.fullName || u.username || "").trim()]),
          );
          if (format === "pdf") {
            const enrichedReq: unknown[] = [];
            const allUsersForReqPdf = await storage.getAllUsers();
            const userLabelForReqPdf = new Map(
              allUsersForReqPdf.map((u) => [
                u.id,
                `${(u.fullName || u.username || "").trim() || `User #${u.id}`}`,
              ]),
            );
            for (const r of requisitions) {
              const d = await storage.getRequisitionWithDetails(r.id);
              if (d) {
                const hist = await db
                  .select()
                  .from(approvalHistory)
                  .where(
                    and(eq(approvalHistory.entityType, "requisition"), eq(approvalHistory.entityId, r.id)),
                  )
                  .orderBy(asc(approvalHistory.performedAt));
                const approvalHistoryForPdf = hist.map((row) => ({
                  ...row,
                  performedByLabel: userLabelForReqPdf.get(row.performedBy) ?? `User #${row.performedBy}`,
                }));
                enrichedReq.push({ ...d, approvalHistoryForPdf });
              }
            }
            data = enrichedReq;
          } else {
            data = requisitions.map((r) => ({
              ...r,
              supplierName: r.supplierId != null ? (reqSupplierNames.get(r.supplierId) ?? "") : "",
              requestorName: r.requestorId != null ? (reqUserDisplay.get(r.requestorId) ?? "") : "",
            }));
          }
          title = 'Purchase Requisitions Report' + filterText;
          break;
        }
          
        case 'activity_logs': {
          let activityLogs = await storage.getAllActivityLogs();
          
          // Apply date range filter if provided
          if (filter.startDate && filter.endDate) {
            activityLogs = activityLogs.filter(log => 
              log.timestamp >= filter.startDate && log.timestamp <= filter.endDate
            );
          }

          const logUsers = await storage.getAllUsers();
          const logUserDisplay = new Map(
            logUsers.map((u) => [u.id, (u.fullName || u.username || "").trim()]),
          );
          data = activityLogs.map((log) => ({
            ...log,
            userName: log.userId != null ? (logUserDisplay.get(log.userId) ?? "") : "",
          }));
          title = 'Activity Logs Report' + filterText;
          break;
        }

        case "invoices": {
          let invList = await storage.getAllInvoices();
          if (filter.startDate && filter.endDate) {
            invList = invList.filter((inv) => {
              const t = inv.issueDate ? new Date(inv.issueDate).getTime() : 0;
              return t >= filter.startDate.getTime() && t <= filter.endDate.getTime();
            });
          }
          if (filter.supplierId) {
            invList = invList.filter((inv) => inv.supplierId === filter.supplierId);
          }
          if (filter.status) {
            const st = String(filter.status).toUpperCase();
            invList = invList.filter((inv) => String(inv.status).toUpperCase() === st);
          }
          const allSuppliers = await storage.getAllSuppliers();
          const supNames = new Map(allSuppliers.map((s) => [s.id, s.name]));
          const fmtInvDate = (d: Date | null | undefined) =>
            d && !Number.isNaN(new Date(d).getTime())
              ? new Date(d).toISOString().slice(0, 10)
              : "";
          data = invList.map((inv) => ({
            ...inv,
            supplierName: inv.supplierId != null ? (supNames.get(inv.supplierId) ?? "") : "",
            issueDate: fmtInvDate(inv.issueDate),
            dueDate: fmtInvDate(inv.dueDate),
            subtotal: inv.subtotal ?? 0,
            tax: inv.tax ?? 0,
            total: inv.total ?? 0,
            paidAmount: inv.paidAmount ?? 0,
            dueAmount: inv.dueAmount ?? 0,
            purchaseOrderId: inv.purchaseOrderId ?? "",
          }));
          title = "Invoices Report" + filterText;
          break;
        }

        case "shipments": {
          const params: string[] = [];
          const whereParts: string[] = [];
          if (filter.status?.trim()) {
            params.push(filter.status.trim().toLowerCase());
            whereParts.push(`lower(s.status) = $${params.length}`);
          }
          if (filter.po?.trim()) {
            params.push(`%${filter.po.trim().toLowerCase()}%`);
            whereParts.push(`lower(s.po_number) LIKE $${params.length}`);
          }
          if (filter.carrier?.trim()) {
            params.push(`%${filter.carrier.trim().toLowerCase()}%`);
            whereParts.push(`lower(COALESCE(s.carrier, '')) LIKE $${params.length}`);
          }
          if (filter.startDate && filter.endDate) {
            params.push(filter.startDate.toISOString(), filter.endDate.toISOString());
            whereParts.push(
              `s.updated_at >= $${params.length - 1}::timestamptz AND s.updated_at <= $${params.length}::timestamptz`,
            );
          }
          const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
          const shResult = await pool.query<{
            id: number;
            po_number: string;
            carrier: string | null;
            status: string;
            eta: Date | null;
            drift_minutes: number;
            created_at: Date | null;
            updated_at: Date | null;
            tracking_number: string | null;
          }>(
            `
            SELECT id, po_number, carrier, status, eta, drift_minutes, created_at, updated_at, tracking_number
            FROM shipments s
            ${whereSql}
            ORDER BY s.updated_at DESC NULLS LAST
            `,
            params,
          );
          const fmtTs = (d: Date | null | undefined) =>
            d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace("T", " ") : "";
          let shipRows = shResult.rows.map((row) => {
            const statusLower = row.status.toLowerCase();
            const eta = row.eta;
            const atRisk = Boolean(
              eta && eta.getTime() < Date.now() && statusLower !== "delivered",
            );
            return {
              id: row.id,
              poNumber: row.po_number,
              carrier: row.carrier ?? "",
              status: statusLower,
              eta: fmtTs(row.eta),
              trackingNumber: row.tracking_number ?? "",
              driftMinutes: row.drift_minutes ?? 0,
              lateRisk: atRisk ? "Yes" : "No",
              atRisk,
              createdAt: fmtTs(row.created_at),
              updatedAt: fmtTs(row.updated_at),
            };
          });
          if (filter.risk?.trim().toLowerCase() === "late") {
            shipRows = shipRows.filter((r) => r.atRisk);
          }
          data = shipRows.map(({ atRisk: _ar, ...rest }) => rest);
          title = "Shipments Report" + filterText;
          break;
        }
          
        default:
          return res.status(400).json({ message: "Unsupported report type" });
      }
      
      const normalizedData = Array.isArray(data) ? data : [];
      
      // For PDF with template=custom, load uploaded template from uploads/custom-pdf-template.pdf if present
      let customTemplateBuffer: Buffer | undefined;
      if (format === 'pdf' && templateParam === 'custom') {
        const templatePath = path.join(process.cwd(), 'uploads', 'custom-pdf-template.pdf');
        try {
          if (fs.existsSync(templatePath)) {
            customTemplateBuffer = fs.readFileSync(templatePath);
          }
        } catch {
          // Fall back to standard layout if custom template cannot be read
        }
      }
      const requestId =
        res.locals && typeof (res.locals as { requestId?: unknown }).requestId === "string"
          ? (res.locals as { requestId: string }).requestId
          : undefined;
      const metadataLines = [
        `Exported at (UTC): ${new Date().toISOString()}`,
        `Rows: ${normalizedData.length}`,
        ...(filterTexts.length ? [`Filters: ${filterTexts.join("; ")}`] : []),
        ...(requestId ? [`Request ID: ${requestId}`] : []),
      ];
      let organizationFooter: string | undefined;
      let organizationDisplayName: string | undefined;
      let organizationLogoUrl: string | undefined;
      try {
        const [osRow] = await db
          .select({
            reportFooter: organizationSettings.reportFooter,
            displayName: organizationSettings.displayName,
            logoUrl: organizationSettings.logoUrl,
          })
          .from(organizationSettings)
          .where(eq(organizationSettings.organizationId, getActiveOrganizationId()))
          .limit(1);
        organizationFooter = osRow?.reportFooter?.trim() || undefined;
        organizationDisplayName = osRow?.displayName?.trim() || undefined;
        organizationLogoUrl = osRow?.logoUrl?.trim() || undefined;
      } catch {
        organizationFooter = undefined;
        organizationDisplayName = undefined;
        organizationLogoUrl = undefined;
      }
      let organizationLogoPng: Uint8Array | undefined;
      if (format === "pdf" && organizationLogoUrl) {
        organizationLogoPng = await loadLogoBytesForPdf(organizationLogoUrl);
      }
      const buffer = await generateDocument(
        normalizedReportType as ReportType,
        format as ReportFormat,
        normalizedData,
        title,
        {
          pdfTemplate: templateParam as "standard" | "compact" | "custom",
          customTemplateBuffer,
          metadataLines,
          organizationFooter,
          organizationDisplayName,
          ...(organizationLogoPng?.length ? { organizationLogoPng } : {}),
        },
      );

      const normalizedTitle = title.replace(/\s+/g, "-").toLowerCase();
      const formatMeta: Record<ReportFormat, { contentType: string; extension: string }> = {
        pdf: {
          contentType: "application/pdf",
          extension: "pdf",
        },
        csv: {
          contentType: "text/csv; charset=utf-8",
          extension: "csv",
        },
        excel: {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          extension: "xlsx",
        },
        docx: {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          extension: "docx",
        },
      };
      const meta = formatMeta[format as ReportFormat];
      res.setHeader("Content-Type", meta.contentType);
      res.setHeader("X-Export-Row-Count", String(normalizedData.length));
      res.setHeader("Content-Disposition", `attachment; filename="${normalizedTitle}.${meta.extension}"`);
      
      // Send the document
      res.send(buffer);
      
    } catch (error) {
      console.error(`Error generating ${req.params.format} report for ${req.params.reportType}:`, error);
      return res.status(500).json({
        message: `Failed to generate ${req.params.reportType} report as ${req.params.format}.`,
      });
    }
  });

  // App Settings endpoints
  app.get("/api/settings", async (_req: Request, res: Response) => {
    try {
      const settings = await storage.getAppSettings();
      if (!settings) {
        // Return default settings if none exist
        const defaultSettings = await storage.updateAppSettings({});
        return res.json(defaultSettings);
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching app settings:", error);
      res.status(500).json({ message: "Failed to fetch app settings" });
    }
  });

  app.put("/api/settings", async (req: Request, res: Response) => {
    try {
      const validatedData = appSettingsFormSchema.parse(req.body);
      const updatedSettings = await storage.updateAppSettings(validatedData);
      res.json(updatedSettings);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating app settings:", error);
        res.status(500).json({ message: "Failed to update app settings" });
      }
    }
  });

  // Diagnostics: scan for issues
  app.get("/api/diagnostics/scan", async (_req: Request, res: Response) => {
    const result: { database: string[]; configuration: string[]; data: string[]; system: string[] } = {
      database: [],
      configuration: [],
      data: [],
      system: [],
    };
    try {
      // Database
      try {
        await storage.getAppSettings();
      } catch {
        result.database.push("Corrupted settings schema");
      }
      try {
        const indexCheck = await pool.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_items' LIMIT 1"
        );
        if (indexCheck.rows.length === 0) {
          result.database.push("Missing index on inventory table");
        }
      } catch {
        // Not PostgreSQL or table doesn't exist yet; skip index check
      }

      // Configuration
      if (!process.env.STRIPE_SECRET_KEY?.trim()) {
        result.configuration.push("Stripe API key not set");
      }
      if (!process.env.EMAIL_HOST?.trim() || !process.env.EMAIL_USER?.trim() || !process.env.EMAIL_PASS?.trim()) {
        result.configuration.push("Email configuration incomplete");
      }

      // Data
      const items = await storage.getAllInventoryItems();
      const bySku = new Map<string, { id: number; sku: string }[]>();
      for (const item of items) {
        const sku = String(item.sku ?? "").trim();
        if (!sku) continue;
        const list = bySku.get(sku) ?? [];
        list.push({ id: item.id, sku });
        bySku.set(sku, list);
      }
      const duplicateSkus = Array.from(bySku.values()).filter((list) => list.length > 1);
      if (duplicateSkus.length > 0) {
        const totalDuplicates = duplicateSkus.reduce((sum, list) => sum + list.length - 1, 0);
        result.data.push(`${totalDuplicates} duplicate SKU(s) found`);
      }
      const settings = await storage.getAppSettings();
      const allowNegative = settings?.allowNegativeInventory ?? false;
      if (!allowNegative) {
        const negativeCount = items.filter((i) => Number(i.quantity) < 0).length;
        if (negativeCount > 0) {
          result.data.push(`${negativeCount} item(s) with negative stock`);
        }
      }

      const filtered: Record<string, string[]> = {};
      for (const [key, arr] of Object.entries(result)) {
        if (Array.isArray(arr) && arr.length > 0) filtered[key] = arr;
      }
      res.json(filtered);
    } catch (err) {
      console.error("Diagnostics scan error:", err);
      res.status(500).json({ message: "Scan failed", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Diagnostics: fix issues by category
  app.post("/api/diagnostics/fix", async (req: Request, res: Response) => {
    const category = typeof req.body?.category === "string" ? req.body.category : "";
    const result: { success: boolean; message?: string; fixed?: string[] } = { success: false };

    try {
      if (category === "database") {
        const fixed: string[] = [];
        try {
          const settings = await storage.getAppSettings();
          if (!settings) {
            await storage.updateAppSettings({});
            fixed.push("Initialized app settings");
          }
        } catch (e) {
          result.message = "Could not repair settings. Check database connection and schema.";
          return res.status(200).json(result);
        }
        try {
          await pool.query(
            "CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku)"
          );
          await pool.query(
            "CREATE INDEX IF NOT EXISTS idx_inventory_items_quantity ON inventory_items(quantity)"
          );
          fixed.push("Ensured inventory indexes exist");
        } catch {
          // Ignore if not PostgreSQL or already exist
        }
        result.success = fixed.length > 0;
        result.fixed = fixed;
        return res.json(result);
      }

      if (category === "configuration") {
        result.message =
          "Set Stripe API key (STRIPE_SECRET_KEY) and email (EMAIL_HOST, EMAIL_USER, EMAIL_PASS) in environment or in Settings.";
        return res.json(result);
      }

      if (category === "data") {
        const fixed: string[] = [];
        const items = await storage.getAllInventoryItems();
        const bySku = new Map<string, { id: number; sku: string }[]>();
        for (const item of items) {
          const sku = String(item.sku ?? "").trim();
          if (!sku) continue;
          const list = bySku.get(sku) ?? [];
          list.push({ id: item.id, sku });
          bySku.set(sku, list);
        }
        for (const list of Array.from(bySku.values())) {
          if (list.length <= 1) continue;
          for (let i = 1; i < list.length; i++) {
            const { id, sku } = list[i];
            const newSku = `${sku}_dedup_${id}`;
            await storage.updateInventoryItem(id, { sku: newSku });
            fixed.push(`Renamed duplicate SKU to ${newSku}`);
          }
        }
        const settings = await storage.getAppSettings();
        const allowNegative = settings?.allowNegativeInventory ?? false;
        if (!allowNegative) {
          for (const item of items) {
            if (Number(item.quantity) < 0) {
              await storage.updateInventoryItem(item.id, { quantity: 0 });
              fixed.push(`Set quantity to 0 for item ${item.sku} (id ${item.id})`);
            }
          }
        }
        result.success = fixed.length > 0;
        result.fixed = fixed;
        return res.json(result);
      }

      if (category === "system") {
        result.message =
          "Camera: grant permission in browser. Local storage: clear site data or old keys in Application/Storage.";
        return res.json(result);
      }

      result.message = "Unknown category. Use: database, configuration, data, or system.";
      res.status(400).json(result);
    } catch (err) {
      console.error("Diagnostics fix error:", err);
      result.message = err instanceof Error ? err.message : String(err);
      res.status(500).json(result);
    }
  });

  // Stock movement endpoints
  app.get("/api/stock-movements", async (_req: Request, res: Response) => {
    try {
      const movements = await storage.getAllStockMovements();
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements:", error);
      res.status(500).json({ message: "Failed to fetch stock movements" });
    }
  });

  app.get("/api/stock-movements/item/:itemId", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }
      
      const movements = await storage.getStockMovementsByItemId(itemId);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements for item:", error);
      res.status(500).json({ message: "Failed to fetch stock movements for item" });
    }
  });

  app.get("/api/stock-movements/warehouse/:warehouseId", async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      if (isNaN(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const movements = await storage.getStockMovementsByWarehouseId(warehouseId);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements for warehouse:", error);
      res.status(500).json({ message: "Failed to fetch stock movements for warehouse" });
    }
  });

  app.post("/api/stock-movements", async (req: Request, res: Response) => {
    try {
      const validatedData = insertStockMovementSchema.parse(req.body);
      if (Number(validatedData.quantity) === 0) {
        return sendFunctionError(res, 400, "createStockMovement", "Stock movement quantity must be non-zero");
      }
      const warehouseIds = [
        validatedData.warehouseId,
        validatedData.sourceWarehouseId,
        validatedData.destinationWarehouseId,
      ]
        .map((v) => (v == null ? null : Number(v)))
        .filter((v): v is number => Number.isFinite(v));
      for (const warehouseId of warehouseIds) {
        const warehouse = await storage.getWarehouse(warehouseId);
        if (!warehouse) {
          return sendFunctionError(
            res,
            400,
            "createStockMovement",
            `Warehouse ID ${warehouseId} does not exist`,
          );
        }
      }
      const movement = await storage.createStockMovement(validatedData);
      res.status(201).json(movement);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating stock movement:", error);
        res.status(500).json({ message: "Failed to create stock movement" });
      }
    }
  });

  app.post("/api/stock-movements/transfer", async (req: Request, res: Response) => {
    try {
      const { sourceWarehouseId, destinationWarehouseId, itemId, quantity, userId, reason } = req.body;
      
      if (!sourceWarehouseId || !destinationWarehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      if (sourceWarehouseId === destinationWarehouseId) {
        return res.status(400).json({ message: "Source and destination warehouses must be different" });
      }
      
      // Get previous inventory state for reporting
      const sourceInventory = await storage.getWarehouseInventoryItem(
        Number(sourceWarehouseId), 
        Number(itemId)
      );
      
      const destinationInventory = await storage.getWarehouseInventoryItem(
        Number(destinationWarehouseId), 
        Number(itemId)
      );
      
      if (!sourceInventory || sourceInventory.quantity < Number(quantity)) {
        return res.status(400).json({ message: "Insufficient stock in source warehouse" });
      }
      
      const movement = await storage.transferStock(
        Number(sourceWarehouseId),
        Number(destinationWarehouseId),
        Number(itemId),
        Number(quantity),
        userId ? Number(userId) : undefined,
        reason
      );
      
      // Notify via WebSocket
      try {
        const { notifyInventoryUpdate } = await import('./websocket-service');
        
        // Notify for source warehouse (decrease)
        notifyInventoryUpdate(
          Number(itemId),
          Number(sourceWarehouseId),
          sourceInventory.quantity - Number(quantity),
          sourceInventory.quantity
        );
        
        // Notify for destination warehouse (increase)
        const prevDestQuantity = destinationInventory ? destinationInventory.quantity : 0;
        notifyInventoryUpdate(
          Number(itemId),
          Number(destinationWarehouseId),
          prevDestQuantity + Number(quantity),
          prevDestQuantity
        );
      } catch (wsError) {
        console.error("Failed to notify inventory update via WebSocket:", wsError);
        // Continue with the response even if WebSocket notification fails
      }
      
      res.status(201).json(movement);
    } catch (error) {
      console.error("Error transferring stock:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to transfer stock" });
    }
  });
  
  // Stock receipt endpoint - for receiving goods into a warehouse
  app.post("/api/stock-movements/receipt", async (req: Request, res: Response) => {
    try {
      const { warehouseId, itemId, quantity, referenceId, referenceType, notes, userId, unitCost } = req.body;
      
      if (!warehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be positive for receipt" });
      }
      
      const whId = Number(warehouseId);
      const itId = Number(itemId);
      const qty = Number(quantity);
      let warehouseInventory = await storage.getWarehouseInventoryItem(whId, itId);
      if (!warehouseInventory) {
        warehouseInventory = await storage.createWarehouseInventory({
          warehouseId: whId,
          itemId: itId,
          quantity: 0,
        });
      }
      const previousQuantity = warehouseInventory.quantity ?? 0;
      await storage.updateWarehouseInventory(warehouseInventory.id, { quantity: previousQuantity + qty });

      const movement = await storage.createStockMovement({
        itemId: itId,
        quantity: qty,
        type: "RECEIPT",
        warehouseId: null,
        destinationWarehouseId: whId,
        sourceWarehouseId: null,
        referenceId: referenceId ? Number(referenceId) : null,
        referenceType: referenceType || null,
        notes: notes || null,
        userId: userId ? Number(userId) : null,
        unitCost: unitCost ? Number(unitCost) : null,
        previousQuantity,
        newQuantity: previousQuantity + qty,
      });
      
      // Notify via WebSocket
      try {
        const { notifyInventoryUpdate } = await import('./websocket-service');
        
        // Notify for warehouse (increase)
        notifyInventoryUpdate(itId, whId, previousQuantity + qty, previousQuantity);
      } catch (wsError) {
        console.error("Failed to notify inventory update via WebSocket:", wsError);
        // Continue with the response even if WebSocket notification fails
      }
      
      res.status(201).json(movement);
    } catch (error) {
      console.error("Error recording stock receipt:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to record stock receipt" });
    }
  });
  
  // Stock issue endpoint - for removing goods from a warehouse
  app.post("/api/stock-movements/issue", async (req: Request, res: Response) => {
    try {
      const { warehouseId, itemId, quantity, referenceId, referenceType, notes, userId } = req.body;
      
      if (!warehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be positive for issue" });
      }
      
      const whId = Number(warehouseId);
      const itId = Number(itemId);
      const qty = Number(quantity);
      const warehouseInventory = await storage.getWarehouseInventoryItem(whId, itId);
      if (!warehouseInventory || (warehouseInventory.quantity ?? 0) < qty) {
        return res.status(400).json({ message: "Insufficient stock in warehouse" });
      }
      const previousQuantity = warehouseInventory.quantity ?? 0;
      await storage.updateWarehouseInventory(warehouseInventory.id, { quantity: previousQuantity - qty });

      const movement = await storage.createStockMovement({
        itemId: itId,
        quantity: -qty,
        type: "ISSUE",
        warehouseId: null,
        sourceWarehouseId: whId,
        destinationWarehouseId: null,
        referenceId: referenceId ? Number(referenceId) : null,
        referenceType: referenceType || null,
        notes: notes || null,
        userId: userId ? Number(userId) : null,
        previousQuantity,
        newQuantity: previousQuantity - qty,
      });
      
      // Notify via WebSocket
      try {
        const { notifyInventoryUpdate } = await import('./websocket-service');
        
        // Notify for warehouse (decrease)
        notifyInventoryUpdate(itId, whId, previousQuantity - qty, previousQuantity);
      } catch (wsError) {
        console.error("Failed to notify inventory update via WebSocket:", wsError);
        // Continue with the response even if WebSocket notification fails
      }
      
      res.status(201).json(movement);
    } catch (error) {
      console.error("Error issuing stock:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to issue stock" });
    }
  });

  /**
   * Issue quantity from a tracked batch: decrements batch on-hand, warehouse row (if any), master item qty, and records ISSUE movement.
   */
  app.post("/api/inventory-batches/:id/issue", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return sendError(res, 400, "INVALID_ID", "Invalid batch id");
      }
      const qty = Number(req.body?.quantity);
      const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
      if (!Number.isFinite(qty) || qty < 1) {
        return sendError(res, 400, "INVALID_QTY", "quantity must be a positive integer");
      }

      const userId = req.user && "id" in req.user ? (req.user as { id: number }).id : null;

      const result = await db.transaction(async (tx) => {
        const [batchRow] = await tx.select().from(inventoryBatches).where(eq(inventoryBatches.id, id));
        if (!batchRow) {
          throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
        }
        if ((batchRow.quantityOnHand ?? 0) < qty) {
          throw Object.assign(new Error("Insufficient quantity on batch"), { status: 400 });
        }

        const newOh = (batchRow.quantityOnHand ?? 0) - qty;
        await tx
          .update(inventoryBatches)
          .set({ quantityOnHand: newOh, updatedAt: new Date() })
          .where(eq(inventoryBatches.id, id));

        const [itemRow] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, batchRow.itemId));
        if (!itemRow) {
          throw Object.assign(new Error("Item not found for batch"), { status: 400 });
        }
        if ((itemRow.quantity ?? 0) < qty) {
          throw Object.assign(new Error("Insufficient master item quantity"), { status: 400 });
        }

        if (batchRow.warehouseId != null) {
          const [wiRow] = await tx
            .select()
            .from(warehouseInventory)
            .where(
              and(
                eq(warehouseInventory.warehouseId, batchRow.warehouseId),
                eq(warehouseInventory.itemId, batchRow.itemId),
              ),
            );
          if (!wiRow || (wiRow.quantity ?? 0) < qty) {
            throw Object.assign(new Error("Insufficient warehouse quantity for this batch"), { status: 400 });
          }
          await tx
            .update(warehouseInventory)
            .set({ quantity: (wiRow.quantity ?? 0) - qty, updatedAt: new Date() })
            .where(eq(warehouseInventory.id, wiRow.id));
        }

        const prevItemQty = itemRow.quantity ?? 0;
        await tx
          .update(inventoryItems)
          .set({ quantity: prevItemQty - qty, updatedAt: new Date() })
          .where(eq(inventoryItems.id, batchRow.itemId));

        const noteStr = `Batch issue ${batchRow.batchNumber}${notes ? `: ${notes}` : ""}`.slice(0, 900);
        const [mov] = await tx
          .insert(stockMovements)
          .values({
            itemId: batchRow.itemId,
            quantity: -qty,
            type: "ISSUE",
            sourceWarehouseId: batchRow.warehouseId,
            notes: noteStr,
            userId,
            previousQuantity: prevItemQty,
            newQuantity: prevItemQty - qty,
          })
          .returning();

        return { movement: mov, batch: { ...batchRow, quantityOnHand: newOh } };
      });

      if (result.batch.warehouseId != null) {
        try {
          const { notifyInventoryUpdate } = await import("./websocket-service");
          const wi = await storage.getWarehouseInventoryItem(result.batch.warehouseId, result.batch.itemId);
          const newQ = wi?.quantity ?? 0;
          await notifyInventoryUpdate(result.batch.itemId, result.batch.warehouseId, newQ, newQ + qty);
        } catch (wsError) {
          console.error("WebSocket notify after batch issue:", wsError);
        }
      }

      return sendOk(res, result, 201);
    } catch (error: unknown) {
      const e = error as { status?: number; message?: string };
      if (e?.status === 404) {
        return sendError(res, 404, "NOT_FOUND", "Batch not found");
      }
      if (e?.status === 400) {
        return sendError(res, 400, "BATCH_ISSUE_INVALID", e.message ?? "Cannot issue from batch");
      }
      console.error("Error in batch issue:", error);
      return sendError(res, 500, "BATCH_ISSUE_FAILED", "Failed to issue from batch");
    }
  });

  /** Issue a single serial unit (available or allocated): marks serial issued, decrements stock, records movement. */
  app.post("/api/inventory-serials/:id/issue", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return sendError(res, 400, "INVALID_ID", "Invalid serial id");
      }
      const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
      const userId = req.user && "id" in req.user ? (req.user as { id: number }).id : null;

      const result = await db.transaction(async (tx) => {
        const [ser] = await tx.select().from(inventorySerials).where(eq(inventorySerials.id, id));
        if (!ser) {
          throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
        }
        const st = String(ser.status ?? "").toLowerCase();
        if (st !== "available" && st !== "allocated") {
          throw Object.assign(new Error("Serial is not available to issue"), { status: 400 });
        }

        const [itemRow] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, ser.itemId));
        if (!itemRow) {
          throw Object.assign(new Error("Item not found"), { status: 400 });
        }
        if ((itemRow.quantity ?? 0) < 1) {
          throw Object.assign(new Error("Insufficient master item quantity"), { status: 400 });
        }

        if (ser.warehouseId != null) {
          const [wiRow] = await tx
            .select()
            .from(warehouseInventory)
            .where(
              and(eq(warehouseInventory.warehouseId, ser.warehouseId), eq(warehouseInventory.itemId, ser.itemId)),
            );
          if (!wiRow || (wiRow.quantity ?? 0) < 1) {
            throw Object.assign(new Error("Insufficient warehouse quantity for this serial"), { status: 400 });
          }
          await tx
            .update(warehouseInventory)
            .set({ quantity: (wiRow.quantity ?? 0) - 1, updatedAt: new Date() })
            .where(eq(warehouseInventory.id, wiRow.id));
        }

        await tx
          .update(inventorySerials)
          .set({ status: "issued", updatedAt: new Date() })
          .where(eq(inventorySerials.id, id));

        const prevItemQty = itemRow.quantity ?? 0;
        await tx
          .update(inventoryItems)
          .set({ quantity: prevItemQty - 1, updatedAt: new Date() })
          .where(eq(inventoryItems.id, ser.itemId));

        const noteStr = `Serial issue ${ser.serialNumber}${notes ? `: ${notes}` : ""}`.slice(0, 900);
        const [mov] = await tx
          .insert(stockMovements)
          .values({
            itemId: ser.itemId,
            quantity: -1,
            type: "ISSUE",
            sourceWarehouseId: ser.warehouseId,
            referenceType: "inventory_serial",
            referenceId: ser.id,
            notes: noteStr,
            userId,
            previousQuantity: prevItemQty,
            newQuantity: prevItemQty - 1,
          })
          .returning();

        return { movement: mov, serial: { ...ser, status: "issued" as const } };
      });

      if (result.serial.warehouseId != null) {
        try {
          const { notifyInventoryUpdate } = await import("./websocket-service");
          const wi = await storage.getWarehouseInventoryItem(result.serial.warehouseId, result.serial.itemId);
          const newQ = wi?.quantity ?? 0;
          await notifyInventoryUpdate(result.serial.itemId, result.serial.warehouseId, newQ, newQ + 1);
        } catch (wsError) {
          console.error("WebSocket notify after serial issue:", wsError);
        }
      }

      return sendOk(res, result, 201);
    } catch (error: unknown) {
      const e = error as { status?: number; message?: string };
      if (e?.status === 404) {
        return sendError(res, 404, "NOT_FOUND", "Serial not found");
      }
      if (e?.status === 400) {
        return sendError(res, 400, "SERIAL_ISSUE_INVALID", e.message ?? "Cannot issue serial");
      }
      console.error("Error in serial issue:", error);
      return sendError(res, 500, "SERIAL_ISSUE_FAILED", "Failed to issue serial");
    }
  });

  // Barcode endpoints
  app.get("/api/barcodes", async (_req: Request, res: Response) => {
    try {
      const barcodes = await storage.getAllBarcodes();
      res.json(barcodes);
    } catch (error) {
      console.error("Error fetching barcodes:", error);
      res.status(500).json({ message: "Failed to fetch barcodes" });
    }
  });

  app.get("/api/barcodes/item/:itemId", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }
      
      const barcodes = await storage.getBarcodesByItemId(itemId);
      res.json(barcodes);
    } catch (error) {
      console.error("Error fetching barcodes for item:", error);
      res.status(500).json({ message: "Failed to fetch barcodes for item" });
    }
  });

  app.get("/api/barcodes/value/:value", async (req: Request, res: Response) => {
    try {
      const value = req.params.value;
      const barcode = await storage.getBarcodeByValue(value);
      
      if (!barcode) {
        return res.status(404).json({ message: "Barcode not found" });
      }
      
      res.json(barcode);
    } catch (error) {
      console.error("Error fetching barcode by value:", error);
      res.status(500).json({ message: "Failed to fetch barcode by value" });
    }
  });

  app.get("/api/inventory/find-by-barcode/:value", async (req: Request, res: Response) => {
    try {
      const value = req.params.value;
      const item = await storage.findItemByBarcode(value);
      
      if (!item) {
        return res.status(404).json({ message: "No item found with the provided barcode" });
      }
      
      res.json(item);
    } catch (error) {
      console.error("Error finding item by barcode:", error);
      res.status(500).json({ message: "Failed to find item by barcode" });
    }
  });

  app.post("/api/barcodes", async (req: Request, res: Response) => {
    try {
      const validatedData = insertBarcodeSchema.parse(req.body);
      
      // Check if barcode with this value already exists
      const existingBarcode = await storage.getBarcodeByValue(validatedData.value);
      if (existingBarcode) {
        return res.status(400).json({ message: "Barcode value already exists" });
      }
      
      const newBarcode = await storage.createBarcode(validatedData);
      res.status(201).json(newBarcode);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating barcode:", error);
        res.status(500).json({ message: "Failed to create barcode" });
      }
    }
  });

  app.put("/api/barcodes/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid barcode ID" });
      }
      
      const validatedData = insertBarcodeSchema.partial().parse(req.body);
      
      // Check if updating the value and if it already exists
      if (validatedData.value) {
        const existingBarcode = await storage.getBarcodeByValue(validatedData.value);
        if (existingBarcode && existingBarcode.id !== id) {
          return res.status(400).json({ message: "Barcode value already exists" });
        }
      }
      
      const updatedBarcode = await storage.updateBarcode(id, validatedData);
      
      if (!updatedBarcode) {
        return res.status(404).json({ message: "Barcode not found" });
      }
      
      res.json(updatedBarcode);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating barcode:", error);
        res.status(500).json({ message: "Failed to update barcode" });
      }
    }
  });

  app.delete("/api/barcodes/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid barcode ID" });
      }
      
      const success = await storage.deleteBarcode(id);
      
      if (!success) {
        return res.status(404).json({ message: "Barcode not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting barcode:", error);
      res.status(500).json({ message: "Failed to delete barcode" });
    }
  });

  // Analytics and forecasting endpoints
  app.get("/api/analytics/demand-forecast/:itemId", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const daysToForecast = req.query.days ? Number(req.query.days) : 30;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const item = await storage.getInventoryItem(itemId);
      if (!item) {
        return res.status(404).json({ message: "Item not found" });
      }

      // Get stock movements for the item
      let movements = await storage.getStockMovementsByItemId(itemId);

      // Filter by date range if specified
      if (startDate && endDate) {
        movements = movements.filter((m: any) => {
          const movementDate = new Date(m.timestamp);
          return movementDate >= startDate && movementDate <= endDate;
        });
      }

      const forecast = await generateDemandForecast(item, movements, daysToForecast, startDate, endDate);
      res.json(forecast);
    } catch (error) {
      console.error("Error generating demand forecast:", error);
      res.status(500).json({ message: "Failed to generate demand forecast" });
    }
  });

  app.get("/api/analytics/top-items", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 10;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const items = await storage.getAllInventoryItems();
      let movements = await storage.getAllStockMovements();

      // Filter by date range if specified
      if (startDate && endDate) {
        movements = movements.filter((m: any) => {
          const movementDate = new Date(m.timestamp);
          return movementDate >= startDate && movementDate <= endDate;
        });
      }

      let topItems = await getTopItems(items, movements, limit);
      // Fallback: when no demand data, show top items by inventory value (qty × cost, else price)
      if (topItems.length === 0 && items.length > 0) {
        const byValue = [...items]
          .filter((i) => (i.quantity ?? 0) > 0)
          .sort((a, b) => inventoryLineValue(b) - inventoryLineValue(a))
          .slice(0, limit);
        topItems = byValue;
      }
      res.json(topItems);
    } catch (error) {
      console.error("Error getting top items:", error);
      res.status(500).json({ message: "Failed to get top items" });
    }
  });

  app.get("/api/analytics/inventory-value", async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllInventoryItems();
      
      // Calculate total inventory value
      let totalValue = 0;
      let totalItems = 0;
      const itemValues = [];

      for (const item of items) {
        const unit = effectiveUnitCost(item);
        const itemValue = inventoryLineValue(item);
        totalValue += itemValue;
        totalItems += 1; // Count unique SKUs, not total units

        itemValues.push({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          cost: unit,
          value: itemValue,
        });
      }

      // Sort by value (highest first)
      itemValues.sort((a, b) => b.value - a.value);

      res.json({
        totalValue,
        totalItems,
        items: itemValues
      });
    } catch (error) {
      console.error("Error calculating inventory value:", error);
      res.status(500).json({ message: "Failed to calculate inventory value" });
    }
  });

  app.get("/api/analytics/stock-usage", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 20) : 10;
      const items = await storage.getAllInventoryItems();
      const movements = await storage.getAllStockMovements();

      const demandByItem: Map<number, number> = new Map();
      const OUT_TYPES = new Set(["SALE", "ISSUE", "DAMAGE", "EXPIRE"]);
      movements.forEach((m: { itemId: number; type: string; quantity: number }) => {
        const t = String(m.type ?? "").toUpperCase();
        const qty = Math.abs(Number(m.quantity));
        if (!Number.isFinite(qty) || qty === 0) return;
        if (OUT_TYPES.has(t)) {
          const current = demandByItem.get(m.itemId) || 0;
          demandByItem.set(m.itemId, current + qty);
        } else if (t === "ADJUSTMENT" && Number(m.quantity) < 0) {
          const current = demandByItem.get(m.itemId) || 0;
          demandByItem.set(m.itemId, current + qty);
        }
      });

      let byItem = items
        .filter((item: { id: number }) => demandByItem.has(item.id))
        .map((item: { id: number; name: string }) => ({
          itemId: item.id,
          itemName: item.name,
          quantityUsed: demandByItem.get(item.id) || 0,
        }))
        .sort((a: { quantityUsed: number }, b: { quantityUsed: number }) => b.quantityUsed - a.quantityUsed)
        .slice(0, limit);

      let source: "movements" | "on_hand" = "movements";
      if (byItem.length === 0 && items.length > 0) {
        source = "on_hand";
        byItem = [...items]
          .filter((i: { quantity?: number }) => Number(i.quantity) > 0)
          .sort(
            (a: { quantity?: number }, b: { quantity?: number }) =>
              Number(b.quantity ?? 0) - Number(a.quantity ?? 0),
          )
          .slice(0, limit)
          .map((item: { id: number; name: string; quantity?: number }) => ({
            itemId: item.id,
            itemName: item.name,
            quantityUsed: Number(item.quantity ?? 0),
          }));
      }

      res.json({ byItem, source });
    } catch (error) {
      console.error("Error getting stock usage:", error);
      res.status(500).json({ message: "Failed to get stock usage" });
    }
  });

  // ================== USER MANAGEMENT ENDPOINTS ==================
  
  app.get("/api/users", async (_req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  
  app.get("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  
  app.put("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Validate and update the user
      const updatedUser = await storage.updateUser(id, req.body);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // If user role is changed, log it
      if (req.body.role && req.user) {
        await storage.createActivityLog({
          action: "User Role Updated",
          description: `Updated user role to ${req.body.role} for user ${updatedUser.username}`,
          userId: req.user.id,
          referenceType: "user",
          referenceId: id
        });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });
  
  app.delete("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Don't allow users to delete themselves
      if (req.user && req.user.id === id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      const success = await storage.deleteUser(id);
      
      if (!success) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (req.user) {
        await storage.createActivityLog({
          action: "User Deleted",
          description: `Deleted user with ID ${id}`,
          userId: req.user.id,
          referenceType: "user",
          referenceId: id
        });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });
  
  // ================== USER PROFILE MANAGEMENT ENDPOINTS ==================
  
  // User contact information
  app.get("/api/users/:id/contacts", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Security check: users can only access their own contacts unless admin
      if (req.user && req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const contacts = await storage.getAllUserContacts(userId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching user contacts:", error);
      res.status(500).json({ message: "Failed to fetch user contacts" });
    }
  });
  
  app.post("/api/users/:id/contacts", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Security check: users can only modify their own contacts unless admin
      if (req.user && req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const contactData = { ...req.body, userId };
      const newContact = await storage.createUserContact(contactData);
      res.status(201).json(newContact);
    } catch (error) {
      console.error("Error creating user contact:", error);
      res.status(500).json({ message: "Failed to create user contact" });
    }
  });
  
  app.put("/api/users/contacts/:id", async (req: Request, res: Response) => {
    try {
      const contactId = Number(req.params.id);
      if (isNaN(contactId)) {
        return res.status(400).json({ message: "Invalid contact ID" });
      }
      
      // Get the contact to check ownership
      const contact = await storage.getUserContact(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      
      // Security check: users can only modify their own contacts unless admin
      if (req.user && req.user.id !== contact.userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const updatedContact = await storage.updateUserContact(contactId, req.body);
      res.json(updatedContact);
    } catch (error) {
      console.error("Error updating user contact:", error);
      res.status(500).json({ message: "Failed to update user contact" });
    }
  });
  
  app.delete("/api/users/contacts/:id", async (req: Request, res: Response) => {
    try {
      const contactId = Number(req.params.id);
      if (isNaN(contactId)) {
        return res.status(400).json({ message: "Invalid contact ID" });
      }
      
      // Get the contact to check ownership
      const contact = await storage.getUserContact(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      
      // Security check: users can only delete their own contacts unless admin
      if (req.user && req.user.id !== contact.userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const success = await storage.deleteUserContact(contactId);
      
      if (!success) {
        return res.status(404).json({ message: "Contact not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user contact:", error);
      res.status(500).json({ message: "Failed to delete user contact" });
    }
  });
  
  // User security settings
  app.get("/api/users/:id/security-settings", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Security check: users can only access their own security settings unless admin
      if (req.user && req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const settings = await storage.getUserSecuritySettings(userId);
      if (!settings) {
        return res.status(404).json({ message: "Security settings not found" });
      }
      
      res.json(settings);
    } catch (error) {
      console.error("Error fetching security settings:", error);
      res.status(500).json({ message: "Failed to fetch security settings" });
    }
  });
  
  app.post("/api/users/:id/security-settings", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Security check: users can only modify their own security settings unless admin
      if (req.user && req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      // Check if settings already exist
      const existingSettings = await storage.getUserSecuritySettings(userId);
      
      let securitySettings;
      if (existingSettings) {
        securitySettings = await storage.updateUserSecuritySettings(userId, req.body);
      } else {
        securitySettings = await storage.createUserSecuritySettings({
          ...req.body,
          userId
        });
      }
      
      res.status(201).json(securitySettings);
    } catch (error) {
      console.error("Error creating/updating security settings:", error);
      res.status(500).json({ message: "Failed to create/update security settings" });
    }
  });
  
  // User access logs
  app.get("/api/users/:id/access-logs", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Security check: users can only access their own access logs unless admin
      if (req.user && req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const logs = await storage.getAllUserAccessLogs(userId);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching user access logs:", error);
      res.status(500).json({ message: "Failed to fetch user access logs" });
    }
  });
  
  app.post("/api/users/:id/access-logs", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const logData = {
        ...req.body,
        userId,
        timestamp: new Date()
      };
      
      const log = await storage.createUserAccessLog(logData);
      res.status(201).json(log);
    } catch (error) {
      console.error("Error creating user access log:", error);
      res.status(500).json({ message: "Failed to create user access log" });
    }
  });
  
  // Time restrictions
  app.get("/api/users/:id/time-restrictions", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const restrictions = await storage.getAllTimeRestrictions(userId);
      res.json(restrictions);
    } catch (error) {
      console.error("Error fetching time restrictions:", error);
      res.status(500).json({ message: "Failed to fetch time restrictions" });
    }
  });
  
  app.post("/api/users/:id/time-restrictions", async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const restrictionData = {
        ...req.body,
        userId
      };
      
      const restriction = await storage.createTimeRestriction(restrictionData);
      res.status(201).json(restriction);
    } catch (error) {
      console.error("Error creating time restriction:", error);
      res.status(500).json({ message: "Failed to create time restriction" });
    }
  });
  
  app.put("/api/time-restrictions/:id", async (req: Request, res: Response) => {
    try {
      const restrictionId = Number(req.params.id);
      if (isNaN(restrictionId)) {
        return res.status(400).json({ message: "Invalid restriction ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const updatedRestriction = await storage.updateTimeRestriction(restrictionId, req.body);
      
      if (!updatedRestriction) {
        return res.status(404).json({ message: "Time restriction not found" });
      }
      
      res.json(updatedRestriction);
    } catch (error) {
      console.error("Error updating time restriction:", error);
      res.status(500).json({ message: "Failed to update time restriction" });
    }
  });
  
  app.delete("/api/time-restrictions/:id", async (req: Request, res: Response) => {
    try {
      const restrictionId = Number(req.params.id);
      if (isNaN(restrictionId)) {
        return res.status(400).json({ message: "Invalid restriction ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const success = await storage.deleteTimeRestriction(restrictionId);
      
      if (!success) {
        return res.status(404).json({ message: "Time restriction not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting time restriction:", error);
      res.status(500).json({ message: "Failed to delete time restriction" });
    }
  });

  // WebSocket test endpoint for real-time inventory updates
  app.post("/api/inventory-sync/test", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const { type, itemId, warehouseId, quantity, reason, userId, entity, action, data } =
        req.body as {
          type?: string;
          itemId?: number;
          warehouseId?: number;
          quantity?: number;
          reason?: string;
          userId?: number;
          entity?: string;
          action?: string;
          data?: unknown;
        };

      // Mode 1: notify broadcast simulation used by sync integration checks
      if (entity && action && data) {
        if (typeof notifyDataChange !== "function") {
          return sendError(
            res,
            501,
            "SYNC_NOTIFICATION_UNAVAILABLE",
            "Real-time sync notification service not available",
          );
        }
        const clientsNotified = await notifyDataChange(entity, action, data);
        return sendOk(res, {
          success: true,
          message: `Notified ${clientsNotified} clients about the data change`,
          clientsNotified,
        });
      }

      if (!type || !itemId || !warehouseId) {
        return sendError(
          res,
          400,
          "MISSING_INVENTORY_SYNC_FIELDS",
          "Missing required fields: type, itemId, warehouseId",
        );
      }

      // Get the item and warehouse to ensure they exist
      const item = await storage.getInventoryItem(itemId);
      const warehouse = await storage.getWarehouse(warehouseId);

      if (!item) {
        return sendError(res, 404, "INVENTORY_ITEM_NOT_FOUND", `Inventory item #${itemId} not found`);
      }

      if (!warehouse) {
        return sendError(res, 404, "WAREHOUSE_NOT_FOUND", `Warehouse #${warehouseId} not found`);
      }

      // Update the inventory if data is valid
      if (type === 'update') {
        if (quantity === undefined) {
          return sendError(res, 400, "MISSING_QUANTITY", "Quantity is required for inventory updates");
        }

        // Get current warehouse inventory
        let warehouseInventory = await storage.getWarehouseInventoryItem(warehouseId, itemId);
        
        if (!warehouseInventory) {
          // Create it if it doesn't exist
          warehouseInventory = await storage.createWarehouseInventory({
            itemId,
            warehouseId,
            quantity: quantity
          });
        } else {
          // Update existing inventory
          warehouseInventory = await storage.updateWarehouseInventory(warehouseInventory.id, {
            quantity
          }) as any;
        }

        // Create a stock movement record
        const movement = await storage.createStockMovement({
          itemId,
          quantity,
          warehouseId,
          type: 'ADJUSTMENT',
          notes: reason || 'Test update via API',
          userId: userId || req.user?.id || null,
          sourceWarehouseId: warehouseId,
          destinationWarehouseId: null
        });

        // Log the activity
        await storage.createActivityLog({
          action: 'INVENTORY_UPDATE',
          userId: userId || req.user?.id || null,
          description: `Test API: Updated inventory for ${item.name} in ${warehouse.name}: quantity ${quantity}${reason ? ` (${reason})` : ''}`,
          itemId,
          referenceId: warehouseId,
          referenceType: 'warehouse'
        });

        return sendOk(res, { 
          message: "Inventory updated successfully", 
          item, 
          warehouse, 
          updatedQuantity: quantity,
          movement
        });
      } else if (type === 'alert') {
        // Manually trigger a low stock alert for testing
        const alertItem = {
          ...item,
          quantity: quantity || item.quantity, // Use provided quantity or current quantity
          lowStockThreshold: item.lowStockThreshold || 10
        };

        await storage.createActivityLog({
          action: 'LOW_STOCK_ALERT_TEST',
          userId: userId || req.user?.id || null,
          description: `Test API: Low stock alert for ${item.name} in ${warehouse.name}: ${alertItem.quantity} units remaining (threshold: ${alertItem.lowStockThreshold})`,
          itemId,
          referenceId: warehouseId,
          referenceType: 'warehouse'
        });

        return sendOk(res, {
          message: "Low stock alert triggered successfully",
          item: alertItem,
          warehouse
        });
      } else {
        return sendError(
          res,
          400,
          "INVALID_SYNC_TEST_TYPE",
          `Unknown test type: ${type}. Supported types: update, alert`,
        );
      }
    } catch (error) {
      console.error("Error in inventory sync test:", error);
      return sendError(res, 500, "INVENTORY_SYNC_TEST_FAILED", "Failed to process inventory sync test");
    }
  });

  // Billing Routes
  
  // Invoice routes
  app.get("/api/invoices", async (req, res) => {
    try {
      let invoices;
      
      // Handle filtering options
      const { customerId, status, fromDate, toDate, overdue, dueInDays } = req.query;
      
      if (overdue === "true") {
        invoices = await storage.getOverdueInvoices();
      } else if (dueInDays) {
        const days = parseInt(dueInDays as string);
        if (isNaN(days)) {
          return sendError(res, 400, "INVALID_DUE_IN_DAYS", "Invalid dueInDays parameter");
        }
        invoices = await storage.getInvoiceDueInDays(days);
      } else if (customerId) {
        invoices = await storage.getInvoicesByCustomerId(parseInt(customerId as string));
      } else if (status) {
        invoices = await storage.getInvoicesByStatus(status as string);
      } else if (fromDate && toDate) {
        invoices = await storage.getInvoicesByDateRange(
          new Date(fromDate as string),
          new Date(toDate as string)
        );
      } else {
        invoices = await storage.getAllInvoices();
      }
      
      return sendOk(res, invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      return sendError(res, 500, "FETCH_INVOICES_FAILED", "Failed to fetch invoices");
    }
  });

  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getInvoice(id);
      
      if (!invoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Get invoice items
      const items = await storage.getInvoiceItems(id);
      
      // Get payments
      const payments = await storage.getPaymentsByInvoiceId(id);
      
      return sendOk(res, {
        ...invoice,
        items,
        payments
      });
    } catch (error) {
      console.error("Error fetching invoice:", error);
      return sendError(res, 500, "FETCH_INVOICE_FAILED", "Failed to fetch invoice");
    }
  });

  // 3-way match: PO vs received (GRN proxy) vs invoice
  app.post("/api/invoices/:id/match", async (req, res) => {
    try {
      const invoiceId = Number(req.params.id);
      if (isNaN(invoiceId)) return sendError(res, 400, "INVALID_INVOICE_ID", "Invalid invoice ID");

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (!invoice.purchaseOrderId) {
        return sendError(res, 400, "INVOICE_PO_REQUIRED", "Invoice is not linked to a purchase order");
      }

      const po = await storage.getPurchaseOrder(invoice.purchaseOrderId);
      if (!po) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Linked purchase order not found");

      const poItems = await storage.getPurchaseOrderItems(po.id);
      const invItems = await storage.getInvoiceItems(invoiceId);

      const mismatches: Array<{ type: string; itemId: number; message: string }> = [];
      for (const invItem of invItems) {
        const poItem = poItems.find((x) => x.itemId === invItem.itemId);
        if (!poItem) {
          mismatches.push({ type: "MISSING_PO_LINE", itemId: invItem.itemId, message: "Item not found on PO" });
          continue;
        }
        if (Number(invItem.unitPrice) !== Number(poItem.unitPrice)) {
          mismatches.push({
            type: "PRICE_MISMATCH",
            itemId: invItem.itemId,
            message: `Invoice unit price ${invItem.unitPrice} differs from PO ${poItem.unitPrice}`,
          });
        }
        const receivedQty = Number(poItem.receivedQuantity ?? 0);
        const invoicedQty = Number(invItem.quantity ?? 0);
        if (invoicedQty > receivedQty) {
          mismatches.push({
            type: "QTY_MISMATCH",
            itemId: invItem.itemId,
            message: `Invoice quantity ${invoicedQty} exceeds received quantity ${receivedQty}`,
          });
        }
      }

      const targetStatus = mismatches.length > 0 ? "DISPUTED" : "SENT";
      await storage.updateInvoice(invoiceId, { status: targetStatus as any });
      if (mismatches.length > 0) {
        await storage.createActivityLog({
          action: "INVOICE_3_WAY_MATCH_FAILED",
          description: `Invoice ${invoice.invoiceNumber} mismatch count: ${mismatches.length}`,
          referenceType: "invoice",
          referenceId: invoiceId,
          userId: (req as Request & { user?: { id: number } }).user?.id,
        }).catch(() => {});
      } else {
        await storage.createActivityLog({
          action: "INVOICE_3_WAY_MATCH_PASSED",
          description: `Invoice ${invoice.invoiceNumber} matched with PO ${po.orderNumber}`,
          referenceType: "invoice",
          referenceId: invoiceId,
          userId: (req as Request & { user?: { id: number } }).user?.id,
        }).catch(() => {});
      }

      return sendOk(res, {
        invoiceId,
        purchaseOrderId: po.id,
        matched: mismatches.length === 0,
        status: targetStatus,
        mismatches,
      });
    } catch (error) {
      console.error("Error running 3-way match:", error);
      return sendError(res, 500, "INVOICE_MATCH_FAILED", "Failed to run 3-way match");
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const invoiceData = req.body;
      const items = invoiceData.items || [];
      if (!invoiceData.supplierId) {
        return sendFunctionError(res, 400, "createInvoice", "Supplier is required");
      }
      const supplier = await storage.getSupplier(Number(invoiceData.supplierId));
      if (!supplier) {
        return sendFunctionError(res, 400, "createInvoice", "Supplier does not exist");
      }
      if (invoiceData.purchaseOrderId) {
        const po = await storage.getPurchaseOrder(Number(invoiceData.purchaseOrderId));
        if (!po) {
          return sendFunctionError(res, 400, "createInvoice", "Purchase order does not exist");
        }
        if (Number(po.supplierId) !== Number(invoiceData.supplierId)) {
          return sendFunctionError(
            res,
            400,
            "createInvoice",
            "Invoice supplier must match purchase order supplier",
          );
        }
      }
      if (Array.isArray(items)) {
        const invalidLine = items.findIndex((line: { unitPrice?: number; quantity?: number }) =>
          Number(line.quantity) <= 0 || Number(line.unitPrice) <= 0,
        );
        if (invalidLine >= 0) {
          return sendFunctionError(
            res,
            400,
            "createInvoice",
            `Invoice item ${invalidLine + 1} must have positive quantity and unit price`,
          );
        }
        for (let i = 0; i < items.length; i++) {
          const itemId = Number(items[i]?.itemId);
          if (!Number.isFinite(itemId) || itemId <= 0) {
            return sendFunctionError(
              res,
              400,
              "createInvoice",
              `Invoice item ${i + 1} must include a valid itemId`,
            );
          }
          const inventoryItem = await storage.getInventoryItem(itemId);
          if (!inventoryItem) {
            return sendFunctionError(
              res,
              400,
              "createInvoice",
              `Invoice item ${i + 1} references an inventory item that does not exist`,
            );
          }
        }
      }
      
      // Delete items from invoice data as we'll handle them separately
      delete invoiceData.items;
      
      // Validate invoice data
      const now = new Date();
      if (!invoiceData.issueDate) {
        invoiceData.issueDate = now;
      }
      
      if (!invoiceData.dueDate) {
        // Default to 30 days from issue date
        const dueDate = new Date(invoiceData.issueDate);
        dueDate.setDate(dueDate.getDate() + 30);
        invoiceData.dueDate = dueDate;
      }
      
      if (!invoiceData.status) {
        invoiceData.status = "DRAFT";
      }
      
      // Create invoice
      const invoice = await storage.createInvoice(invoiceData, items);
      
      return sendOk(res, invoice, 201);
    } catch (error) {
      console.error("Error creating invoice:", error);
      return sendError(res, 500, "CREATE_INVOICE_FAILED", "Failed to create invoice");
    }
  });

  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoiceData = req.body;
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Update invoice
      const updatedInvoice = await storage.updateInvoice(id, invoiceData);
      if (!updatedInvoice) {
        return sendError(res, 500, "UPDATE_INVOICE_FAILED", "Invoice update returned no row");
      }

      try {
        const uid = (req as Request & { user?: { id: number } }).user?.id;
        await storage.createActivityLog({
          action: "Invoice header updated",
          description: `Invoice #${id} (${updatedInvoice.invoiceNumber}) updated`,
          userId: uid,
          referenceType: "invoice",
          referenceId: id,
        });
      } catch (logErr) {
        console.warn("[invoice patch] activity log:", logErr);
      }

      return sendOk(res, updatedInvoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      return sendError(res, 500, "UPDATE_INVOICE_FAILED", "Failed to update invoice");
    }
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be deleted (e.g., not in PAID status)
      if (existingInvoice.status === "PAID" || existingInvoice.status === "PARTIALLY_PAID") {
        return sendError(
          res,
          400,
          "INVOICE_DELETE_NOT_ALLOWED",
          "Cannot delete a paid invoice. Consider cancelling it instead.",
        );
      }
      
      // Delete invoice
      await storage.deleteInvoice(id);
      
      return sendOk(res, { success: true });
    } catch (error) {
      console.error("Error deleting invoice:", error);
      return sendError(res, 500, "DELETE_INVOICE_FAILED", "Failed to delete invoice");
    }
  });

  // Invoice status update endpoints
  app.post("/api/invoices/:id/send", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be sent (must be in DRAFT status)
      if (existingInvoice.status !== "DRAFT") {
        return sendError(res, 400, "INVOICE_SEND_NOT_ALLOWED", "Only invoices in DRAFT status can be sent");
      }
      
      // Update invoice status to SENT
      const updatedInvoice = await storage.updateInvoice(id, {
        status: "SENT" as const
      });
      
      return sendOk(res, updatedInvoice);
    } catch (error) {
      console.error("Error sending invoice:", error);
      return sendError(res, 500, "SEND_INVOICE_FAILED", "Failed to send invoice");
    }
  });

  app.post("/api/invoices/:id/cancel", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be cancelled (not in PAID or CANCELLED status)
      if (existingInvoice.status === "PAID" || existingInvoice.status === "CANCELLED" || existingInvoice.status === "VOID") {
        return sendError(
          res,
          400,
          "INVOICE_CANCEL_NOT_ALLOWED",
          "Cannot cancel an invoice that is already paid, cancelled, or void",
        );
      }
      
      // Update invoice status to CANCELLED
      const updatedInvoice = await storage.updateInvoice(id, {
        status: "CANCELLED"
      });
      
      return sendOk(res, updatedInvoice);
    } catch (error) {
      console.error("Error cancelling invoice:", error);
      return sendError(res, 500, "CANCEL_INVOICE_FAILED", "Failed to cancel invoice");
    }
  });

  app.post("/api/invoices/:id/void", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be voided (not in VOID status)
      if (existingInvoice.status === "VOID") {
        return sendError(res, 400, "INVOICE_ALREADY_VOID", "Invoice is already void");
      }
      
      // Update invoice status to VOID
      const updatedInvoice = await storage.updateInvoice(id, {
        status: "VOID"
      });
      
      return sendOk(res, updatedInvoice);
    } catch (error) {
      console.error("Error voiding invoice:", error);
      return sendError(res, 500, "VOID_INVOICE_FAILED", "Failed to void invoice");
    }
  });

  // Invoice items routes
  app.get("/api/invoices/:invoiceId/items", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Get invoice items
      const items = await storage.getInvoiceItems(invoiceId);
      
      return sendOk(res, items);
    } catch (error) {
      console.error("Error fetching invoice items:", error);
      return sendError(res, 500, "FETCH_INVOICE_ITEMS_FAILED", "Failed to fetch invoice items");
    }
  });

  app.post("/api/invoices/:invoiceId/items", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be modified (not in PAID, CANCELLED, or VOID status)
      if (["PAID", "CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      
      const itemData = req.body;
      itemData.invoiceId = invoiceId;
      
      // Create invoice item
      const item = await storage.addInvoiceItem(itemData);
      
      return sendOk(res, item, 201);
    } catch (error) {
      console.error("Error creating invoice item:", error);
      return sendError(res, 500, "CREATE_INVOICE_ITEM_FAILED", "Failed to create invoice item");
    }
  });

  app.patch("/api/invoices/:invoiceId/items/:itemId", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const itemId = parseInt(req.params.itemId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be modified
      if (["PAID", "CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      
      // Validate item exists and belongs to the invoice
      const existingItem = await storage.getInvoiceItem(itemId);
      if (!existingItem || existingItem.invoiceId !== invoiceId) {
        return sendError(res, 404, "INVOICE_ITEM_NOT_FOUND", "Invoice item not found");
      }
      
      // Update invoice item
      const updatedItem = await storage.updateInvoiceItem(itemId, req.body);
      
      return sendOk(res, updatedItem);
    } catch (error) {
      console.error("Error updating invoice item:", error);
      return sendError(res, 500, "UPDATE_INVOICE_ITEM_FAILED", "Failed to update invoice item");
    }
  });

  app.delete("/api/invoices/:invoiceId/items/:itemId", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const itemId = parseInt(req.params.itemId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can be modified
      if (["PAID", "CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      
      // Validate item exists and belongs to the invoice
      const existingItem = await storage.getInvoiceItem(itemId);
      if (!existingItem || existingItem.invoiceId !== invoiceId) {
        return sendError(res, 404, "INVOICE_ITEM_NOT_FOUND", "Invoice item not found");
      }
      
      // Delete invoice item
      await storage.deleteInvoiceItem(itemId);
      
      return sendOk(res, { success: true });
    } catch (error) {
      console.error("Error deleting invoice item:", error);
      return sendError(res, 500, "DELETE_INVOICE_ITEM_FAILED", "Failed to delete invoice item");
    }
  });

  // Payment routes
  app.get("/api/payments", async (req, res) => {
    try {
      const payments = await storage.getAllPayments();
      return sendOk(res, payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      return sendError(res, 500, "FETCH_PAYMENTS_FAILED", "Failed to fetch payments");
    }
  });

  app.get("/api/invoices/:invoiceId/payments", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Get payments for invoice
      const payments = await storage.getPaymentsByInvoiceId(invoiceId);
      
      return sendOk(res, payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      return sendError(res, 500, "FETCH_INVOICE_PAYMENTS_FAILED", "Failed to fetch payments");
    }
  });

  app.post("/api/invoices/:invoiceId/payments", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      }
      
      // Check if invoice can accept payments
      if (["CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return sendFunctionError(
          res,
          400,
          "createPayment",
          "Cannot add payments to a cancelled or void invoice",
        );
      }
      
      const paymentData = req.body;
      paymentData.invoiceId = invoiceId;
      const paymentAmount = Number(paymentData.amount ?? paymentData.paymentAmount ?? 0);
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        return sendFunctionError(res, 400, "createPayment", "Payment amount must be greater than zero");
      }
      const total = Number((existingInvoice as { totalAmount?: number | string }).totalAmount ?? existingInvoice.total ?? 0);
      const paid = Number(existingInvoice.paidAmount ?? 0);
      const balance = Number.isFinite(total - paid) ? total - paid : 0;
      if (paymentAmount > balance && balance > 0) {
        return sendFunctionError(
          res,
          400,
          "createPayment",
          `Payment amount (${paymentAmount}) cannot exceed invoice balance (${balance})`,
        );
      }
      
      // Create payment
      const payment = await storage.createPayment(paymentData);
      
      return sendOk(res, payment, 201);
    } catch (error) {
      console.error("Error creating payment:", error);
      return sendError(res, 500, "CREATE_PAYMENT_FAILED", "Failed to create payment");
    }
  });

  app.patch("/api/payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate payment exists
      const existingPayment = await storage.getPayment(id);
      if (!existingPayment) {
        return sendError(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
      }
      
      // Update payment
      const updatedPayment = await storage.updatePayment(id, req.body);
      
      return sendOk(res, updatedPayment);
    } catch (error) {
      console.error("Error updating payment:", error);
      return sendError(res, 500, "UPDATE_PAYMENT_FAILED", "Failed to update payment");
    }
  });

  app.delete("/api/payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate payment exists
      const existingPayment = await storage.getPayment(id);
      if (!existingPayment) {
        return sendError(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
      }
      
      // Delete payment
      await storage.deletePayment(id);
      
      return sendOk(res, { success: true });
    } catch (error) {
      console.error("Error deleting payment:", error);
      return sendError(res, 500, "DELETE_PAYMENT_FAILED", "Failed to delete payment");
    }
  });

  // Billing settings routes
  app.get("/api/billing-settings", async (req, res) => {
    try {
      const settings = await storage.getBillingSettings();
      return sendOk(res, settings || {});
    } catch (error) {
      console.error("Error fetching billing settings:", error);
      return sendError(res, 500, "FETCH_BILLING_SETTINGS_FAILED", "Failed to fetch billing settings");
    }
  });

  app.post("/api/billing-settings", async (req, res) => {
    try {
      const settings = await storage.updateBillingSettings(req.body);
      return sendOk(res, settings);
    } catch (error) {
      console.error("Error updating billing settings:", error);
      return sendError(res, 500, "UPDATE_BILLING_SETTINGS_FAILED", "Failed to update billing settings");
    }
  });

  // Tax rates routes
  app.get("/api/tax-rates", async (req, res) => {
    try {
      const taxRates = await storage.getAllTaxRates();
      return sendOk(res, taxRates);
    } catch (error) {
      console.error("Error fetching tax rates:", error);
      return sendError(res, 500, "FETCH_TAX_RATES_FAILED", "Failed to fetch tax rates");
    }
  });

  app.get("/api/tax-rates/default", async (req, res) => {
    try {
      const defaultTaxRate = await storage.getDefaultTaxRate();
      if (!defaultTaxRate) {
        return sendError(res, 404, "DEFAULT_TAX_RATE_NOT_FOUND", "No default tax rate set");
      }
      return sendOk(res, defaultTaxRate);
    } catch (error) {
      console.error("Error fetching default tax rate:", error);
      return sendError(res, 500, "FETCH_DEFAULT_TAX_RATE_FAILED", "Failed to fetch default tax rate");
    }
  });

  app.get("/api/tax-rates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const taxRate = await storage.getTaxRate(id);
      
      if (!taxRate) {
        return sendError(res, 404, "TAX_RATE_NOT_FOUND", "Tax rate not found");
      }
      
      return sendOk(res, taxRate);
    } catch (error) {
      console.error("Error fetching tax rate:", error);
      return sendError(res, 500, "FETCH_TAX_RATE_FAILED", "Failed to fetch tax rate");
    }
  });

  app.post("/api/tax-rates", async (req, res) => {
    try {
      const taxRate = await storage.createTaxRate(req.body);
      return sendOk(res, taxRate, 201);
    } catch (error) {
      console.error("Error creating tax rate:", error);
      return sendError(res, 500, "CREATE_TAX_RATE_FAILED", "Failed to create tax rate");
    }
  });

  app.patch("/api/tax-rates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate tax rate exists
      const existingTaxRate = await storage.getTaxRate(id);
      if (!existingTaxRate) {
        return sendError(res, 404, "TAX_RATE_NOT_FOUND", "Tax rate not found");
      }
      
      // Update tax rate
      const updatedTaxRate = await storage.updateTaxRate(id, req.body);
      
      return sendOk(res, updatedTaxRate);
    } catch (error) {
      console.error("Error updating tax rate:", error);
      return sendError(res, 500, "UPDATE_TAX_RATE_FAILED", "Failed to update tax rate");
    }
  });

  app.delete("/api/tax-rates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate tax rate exists
      const existingTaxRate = await storage.getTaxRate(id);
      if (!existingTaxRate) {
        return sendError(res, 404, "TAX_RATE_NOT_FOUND", "Tax rate not found");
      }
      
      // Check if it's the default tax rate
      if (existingTaxRate.isDefault) {
        return sendError(
          res,
          400,
          "DELETE_DEFAULT_TAX_RATE_NOT_ALLOWED",
          "Cannot delete the default tax rate. Set another tax rate as default first.",
        );
      }
      
      // Delete tax rate
      await storage.deleteTaxRate(id);
      
      return sendOk(res, { success: true });
    } catch (error) {
      console.error("Error deleting tax rate:", error);
      return sendError(res, 500, "DELETE_TAX_RATE_FAILED", "Failed to delete tax rate");
    }
  });

  app.post("/api/tax-rates/:id/set-default", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate tax rate exists
      const existingTaxRate = await storage.getTaxRate(id);
      if (!existingTaxRate) {
        return sendError(res, 404, "TAX_RATE_NOT_FOUND", "Tax rate not found");
      }
      
      // Set as default
      const updatedTaxRate = await storage.setDefaultTaxRate(id);
      
      return sendOk(res, updatedTaxRate);
    } catch (error) {
      console.error("Error setting default tax rate:", error);
      return sendError(res, 500, "SET_DEFAULT_TAX_RATE_FAILED", "Failed to set default tax rate");
    }
  });

  // Discount routes
  app.get("/api/discounts", async (req, res) => {
    try {
      const activeOnly = req.query.activeOnly === "true";
      const discounts = activeOnly ? await storage.getActiveDiscounts() : await storage.getAllDiscounts();
      return sendOk(res, discounts);
    } catch (error) {
      console.error("Error fetching discounts:", error);
      return sendError(res, 500, "FETCH_DISCOUNTS_FAILED", "Failed to fetch discounts");
    }
  });

  app.get("/api/discounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const discount = await storage.getDiscount(id);
      
      if (!discount) {
        return sendError(res, 404, "DISCOUNT_NOT_FOUND", "Discount not found");
      }
      
      return sendOk(res, discount);
    } catch (error) {
      console.error("Error fetching discount:", error);
      return sendError(res, 500, "FETCH_DISCOUNT_FAILED", "Failed to fetch discount");
    }
  });

  app.post("/api/discounts", async (req, res) => {
    try {
      const discount = await storage.createDiscount(req.body);
      return sendOk(res, discount, 201);
    } catch (error) {
      console.error("Error creating discount:", error);
      return sendError(res, 500, "CREATE_DISCOUNT_FAILED", "Failed to create discount");
    }
  });

  app.patch("/api/discounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate discount exists
      const existingDiscount = await storage.getDiscount(id);
      if (!existingDiscount) {
        return sendError(res, 404, "DISCOUNT_NOT_FOUND", "Discount not found");
      }
      
      // Update discount
      const updatedDiscount = await storage.updateDiscount(id, req.body);
      
      return sendOk(res, updatedDiscount);
    } catch (error) {
      console.error("Error updating discount:", error);
      return sendError(res, 500, "UPDATE_DISCOUNT_FAILED", "Failed to update discount");
    }
  });

  app.delete("/api/discounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate discount exists
      const existingDiscount = await storage.getDiscount(id);
      if (!existingDiscount) {
        return sendError(res, 404, "DISCOUNT_NOT_FOUND", "Discount not found");
      }
      
      // Delete discount
      await storage.deleteDiscount(id);
      
      return sendOk(res, { success: true });
    } catch (error) {
      console.error("Error deleting discount:", error);
      return sendError(res, 500, "DELETE_DISCOUNT_FAILED", "Failed to delete discount");
    }
  });

  // Lightweight payload: no DB or other deps — always returns 200 for proxy/CI.
  const uploadPathReady = () => fs.existsSync(uploadsDir);
  const emailServiceReady = () => {
    if (process.env.NODE_ENV !== "production") {
      return true;
    }
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  };
  const getHealthPayload = () => ({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    readiness: {
      dbReady: readiness.dbReady,
      schemaReady: readiness.schemaReady,
      sessionStoreReady: readiness.sessionStoreReady,
      websocketReady: readiness.websocketReady,
      uploadPathReady: uploadPathReady(),
      emailServiceReady: emailServiceReady(),
    },
  });

  // Health checks for app monitors and CI smoke tests. /health must never fail (no DB).
  app.get("/health", (_req, res) => {
    res.json(getHealthPayload());
  });

  app.get("/api/health", (_req, res) => {
    sendOk(res, getHealthPayload());
  });

  app.get("/ready", (_req, res) => {
    sendOk(res, {
      dbReady: readiness.dbReady,
      schemaReady: readiness.schemaReady,
      sessionStoreReady: readiness.sessionStoreReady,
      websocketReady: readiness.websocketReady,
      uploadPathReady: uploadPathReady(),
      emailServiceReady: emailServiceReady(),
    });
  });
  app.get("/api/ready", (_req, res) => {
    sendOk(res, {
      dbReady: readiness.dbReady,
      schemaReady: readiness.schemaReady,
      sessionStoreReady: readiness.sessionStoreReady,
      websocketReady: readiness.websocketReady,
      uploadPathReady: uploadPathReady(),
      emailServiceReady: emailServiceReady(),
    });
  });

  const getDeepHealthPayload = async () => {
    const startedAt = Date.now();
    let databaseOk = true;
    let databaseError: string | null = null;

    try {
      await pool.query("SELECT 1");
    } catch (error) {
      databaseOk = false;
      databaseError = error instanceof Error ? error.message : "Unknown database error";
    }

    let schemaStatus: { ok: boolean; status: string; missingTables: string[] } = {
      ok: false,
      status: "schema_incomplete",
      missingTables: [],
    };
    let seedSummary = {
      users: 0,
      warehouses: 0,
      suppliers: 0,
      items: 0,
      settings: 0,
    };

    if (databaseOk) {
      schemaStatus = await getSchemaStatus();
      seedSummary = await getDemoDataSummary();
    }

    const overallStatus = databaseOk && schemaStatus?.ok ? "ok" : "degraded";

    return {
      status: overallStatus as "ok" | "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt,
      checks: {
        database: {
          ok: databaseOk,
          error: databaseError,
        },
        sessionStore: {
          ok: readiness.sessionStoreReady,
        },
        websocket: {
          ok: readiness.websocketReady,
        },
        uploadPath: {
          ok: uploadPathReady(),
          path: uploadsDir,
        },
        emailService: {
          ok: emailServiceReady(),
        },
        schema: schemaStatus,
        seed: seedSummary,
      },
      migrationsStatus: (schemaStatus as { status?: string }).status ?? "schema_incomplete",
    };
  };

  // Deep health: reports DB status; returns 503 when degraded.
  app.get("/health/deep", async (_req, res) => {
    const payload = await getDeepHealthPayload();
    res.status(payload.status === "ok" ? 200 : 503).json(payload);
  });

  app.get("/api/health/deep", async (_req, res) => {
    const payload = await getDeepHealthPayload();
    sendOk(res, payload, payload.status === "ok" ? 200 : 503);
  });

  const handleDemoReset = async (_req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      return sendError(res, 404, "NOT_FOUND", "Not found");
    }

    try {
      const summary = await resetAndSeedDemoData();
      const operational = await seedOperationalIfEmpty();
      return sendOk(res, { ...summary, operational });
    } catch (error) {
      console.error("Failed to reset demo data:", error);
      return sendError(res, 500, "DEMO_RESET_FAILED", "Failed to reset demo data", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  app.post("/admin/demo/reset", auth.ensureAuthenticated, auth.ensureAdmin, handleDemoReset);
  app.post("/api/admin/demo/reset", auth.ensureAuthenticated, auth.ensureAdmin, handleDemoReset);
  
  // Initialize image recognition routes
  registerImageRecognitionRoutes(app);
  
  // Register document extractor routes
  registerDocumentExtractorRoutes(app);
  
  // Profile picture routes
  app.post('/api/profile/picture', auth.ensureAuthenticated, profilePictureUpload.single('profilePicture'), uploadProfilePicture);
  app.delete('/api/profile/picture', auth.ensureAuthenticated, removeProfilePicture);
  app.put('/api/profile/picture/url', auth.ensureAuthenticated, updateProfilePictureUrl);

  const httpServer = createServer(app);
  
  // Initialize WebSocket service for real-time inventory synchronization
  // This creates a WebSocket server on the /ws path
  // Initialize WebSocket services
  const wss = initializeWebSocketService(httpServer, storage);
  const syncWss = initializeRealTimeSyncService(httpServer, storage);
  console.log("WebSocket servers initialized for real-time inventory synchronization");
  
  // WebSocket connection status endpoint
  app.get("/api/sync/status", auth.ensureAuthenticated, (_req: Request, res: Response) => {
    try {
      const connectionInfo = {
        standardConnections: wss ? wss.clients.size : 0,
        syncConnections: syncWss ? syncWss.clients.size : 0,
        syncClientsInfo: typeof getConnectedClientInfo === 'function' ? getConnectedClientInfo() : []
      };
      return sendOk(res, connectionInfo);
    } catch (error) {
      console.error("Error getting WebSocket connection status:", error);
      return sendError(res, 500, "SYNC_STATUS_FAILED", "Error getting WebSocket connection status");
    }
  });
  
  return httpServer;
}

// Document generation functions
// Inventory reports
async function generateInventoryPdfReport(items: any[], title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Add title
  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  // Add date
  const dateStr = new Date().toLocaleDateString();
  page.drawText(`Generated on: ${dateStr}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Add headers
  const headers = ['Name', 'SKU', 'Category', 'Quantity', 'Price', 'Value'];
  const colWidths = [200, 100, 80, 50, 60, 60];
  let yPos = height - 100;
  let xPos = 50;
  
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: xPos,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[i];
  });
  
  // Draw a line
  page.drawLine({
    start: { x: 50, y: yPos - 5 },
    end: { x: width - 50, y: yPos - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  // Add data rows
  yPos -= 20;
  const categories = await storage.getAllCategories();
  const categoryMap = new Map(categories.map(c => [c.id, c.name]));
  
  for (const item of items) {
    if (yPos < 50) {
      // Add a new page if we're running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPos = height - 50;
      
      // Add headers to new page
      xPos = 50;
      headers.forEach((header, i) => {
        newPage.drawText(header, {
          x: xPos,
          y: yPos,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        xPos += colWidths[i];
      });
      
      // Draw a line
      newPage.drawLine({
        start: { x: 50, y: yPos - 5 },
        end: { x: width - 50, y: yPos - 5 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 20;
    }
    
    const categoryName = item.categoryId ? categoryMap.get(item.categoryId) || 'None' : 'None';
    const value = (item.price * item.quantity).toFixed(2);
    const currentPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
    
    xPos = 50;
    
    // Truncate name if too long
    let itemName = item.name;
    if (itemName.length > 25) {
      itemName = itemName.substring(0, 22) + '...';
    }
    
    currentPage.drawText(itemName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[0];
    
    currentPage.drawText(item.sku, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[1];
    
    currentPage.drawText(categoryName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[2];
    
    currentPage.drawText(item.quantity.toString(), {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[3];
    
    currentPage.drawText(`$${item.price.toFixed(2)}`, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[4];
    
    currentPage.drawText(`$${value}`, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    yPos -= 15;
  }
  
  // Add totals
  const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
  const totalValue = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalItems = items.length;
  
  lastPage.drawLine({
    start: { x: 50, y: yPos + 5 },
    end: { x: width - 50, y: yPos + 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Items: ${totalItems}`, {
    x: 50,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Value: $${totalValue.toFixed(2)}`, {
    x: width - 150,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  return Buffer.from(await pdfDoc.save());
}

async function generateInventoryCsvReport(items: any[], title: string): Promise<Buffer> {
  const categories = await storage.getAllCategories();
  const categoryMap = new Map(categories.map(c => [c.id, c.name]));
  
  // Create a temporary file path
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  
  const filePath = path.join(tmpDir, `${title.replace(/\s+/g, '-').toLowerCase()}.csv`);
  
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      {id: 'name', title: 'Name'},
      {id: 'sku', title: 'SKU'},
      {id: 'category', title: 'Category'},
      {id: 'quantity', title: 'Quantity'},
      {id: 'price', title: 'Price'},
      {id: 'value', title: 'Value'}
    ]
  });
  
  const records = items.map(item => ({
    name: item.name,
    sku: item.sku,
    category: item.categoryId ? categoryMap.get(item.categoryId) || 'None' : 'None',
    quantity: item.quantity,
    price: `$${item.price.toFixed(2)}`,
    value: `$${(item.price * item.quantity).toFixed(2)}`
  }));
  
  await csvWriter.writeRecords(records);
  
  const buffer = csvBufferForExcel(fs.readFileSync(filePath));
  fs.unlinkSync(filePath);
  return buffer;
}

async function generateInventoryExcelReport(items: any[], title: string): Promise<Buffer> {
  const categories = await storage.getAllCategories();
  const categoryMap = new Map(categories.map(c => [c.id, c.name]));
  
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet(title);
  
  // Add title row
  worksheet.mergeCells('A1:F1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = {
    size: 16,
    bold: true
  };
  titleCell.alignment = { horizontal: 'center' };
  
  // Add date row
  worksheet.mergeCells('A2:F2');
  const dateCell = worksheet.getCell('A2');
  dateCell.value = `Generated on: ${new Date().toLocaleDateString()}`;
  dateCell.font = {
    size: 10,
    italic: true
  };
  dateCell.alignment = { horizontal: 'center' };
  
  // Add headers
  worksheet.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'SKU', key: 'sku', width: 15 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Price', key: 'price', width: 12 },
    { header: 'Value', key: 'value', width: 12 }
  ];
  
  // Style the header row
  worksheet.getRow(3).font = { bold: true };
  worksheet.getRow(3).alignment = { horizontal: 'center' };
  
  // Add data
  items.forEach(item => {
    worksheet.addRow({
      name: item.name,
      sku: item.sku,
      category: item.categoryId ? categoryMap.get(item.categoryId) || 'None' : 'None',
      quantity: item.quantity,
      price: item.price,
      value: item.price * item.quantity
    });
  });
  
  // Format price and value columns
  worksheet.getColumn('price').numFmt = '$#,##0.00';
  worksheet.getColumn('value').numFmt = '$#,##0.00';
  
  // Add totals row
  const totalRowIndex = items.length + 4;
  const totalRow = worksheet.getRow(totalRowIndex);
  totalRow.getCell(1).value = 'Total';
  totalRow.getCell(6).value = { formula: `SUM(F4:F${totalRowIndex - 1})` };
  totalRow.font = { bold: true };
  
  // Add a border to the total row
  totalRow.eachCell(cell => {
    cell.border = {
      top: { style: 'thin' }
    };
  });
  
  // Write to buffer
  return await workbookToBuffer(workbook);
}

// Purchase Orders Reports
async function generatePurchaseOrdersPdfReport(items: any[], title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Add title
  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  // Add date
  const dateStr = new Date().toLocaleDateString();
  page.drawText(`Generated on: ${dateStr}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Add headers
  const headers = ['Order #', 'Supplier', 'Status', 'Total Amount', 'Date Created'];
  const colWidths = [90, 180, 80, 100, 100];
  let yPos = height - 100;
  let xPos = 50;
  
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: xPos,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[i];
  });
  
  // Draw a line
  page.drawLine({
    start: { x: 50, y: yPos - 5 },
    end: { x: width - 50, y: yPos - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  // Add data rows
  yPos -= 20;
  const suppliers = await storage.getAllSuppliers();
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  
  for (const order of items) {
    if (yPos < 50) {
      // Add a new page if we're running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPos = height - 50;
      
      // Add headers to new page
      xPos = 50;
      headers.forEach((header, i) => {
        newPage.drawText(header, {
          x: xPos,
          y: yPos,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        xPos += colWidths[i];
      });
      
      // Draw a line
      newPage.drawLine({
        start: { x: 50, y: yPos - 5 },
        end: { x: width - 50, y: yPos - 5 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 20;
    }
    
    const supplierName = order.supplierId ? supplierMap.get(order.supplierId) || 'None' : 'None';
    const amount = `$${order.totalAmount.toFixed(2)}`;
    const created = new Date(order.createdAt).toLocaleDateString();
    const currentPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
    
    xPos = 50;
    
    currentPage.drawText(order.orderNumber, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[0];
    
    currentPage.drawText(supplierName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[1];
    
    currentPage.drawText(order.status, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[2];
    
    currentPage.drawText(amount, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[3];
    
    currentPage.drawText(created, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    yPos -= 15;
  }
  
  // Add totals
  const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
  const totalAmount = items.reduce((sum, order) => sum + order.totalAmount, 0);
  const totalOrders = items.length;
  
  lastPage.drawLine({
    start: { x: 50, y: yPos + 5 },
    end: { x: width - 50, y: yPos + 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Orders: ${totalOrders}`, {
    x: 50,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Value: $${totalAmount.toFixed(2)}`, {
    x: width - 150,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  return Buffer.from(await pdfDoc.save());
}

async function generatePurchaseOrdersCsvReport(items: any[], title: string): Promise<Buffer> {
  const suppliers = await storage.getAllSuppliers();
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  
  // Create a temporary file path
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  
  const filePath = path.join(tmpDir, `${title.replace(/\s+/g, '-').toLowerCase()}.csv`);
  
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      {id: 'orderNumber', title: 'Order #'},
      {id: 'supplier', title: 'Supplier'},
      {id: 'status', title: 'Status'},
      {id: 'totalAmount', title: 'Total Amount'},
      {id: 'date', title: 'Date Created'},
      {id: 'paymentStatus', title: 'Payment Status'}
    ]
  });
  
  const records = items.map(order => ({
    orderNumber: order.orderNumber,
    supplier: order.supplierId ? supplierMap.get(order.supplierId) || 'None' : 'None',
    status: order.status,
    totalAmount: `$${order.totalAmount.toFixed(2)}`,
    date: new Date(order.createdAt).toLocaleDateString(),
    paymentStatus: order.paymentStatus || 'UNPAID'
  }));
  
  await csvWriter.writeRecords(records);
  
  const buffer = csvBufferForExcel(fs.readFileSync(filePath));
  fs.unlinkSync(filePath);
  return buffer;
}

async function generatePurchaseOrdersExcelReport(items: any[], title: string): Promise<Buffer> {
  const suppliers = await storage.getAllSuppliers();
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet(title);
  
  // Add title row
  worksheet.mergeCells('A1:F1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = {
    size: 16,
    bold: true
  };
  titleCell.alignment = { horizontal: 'center' };
  
  // Add date row
  worksheet.mergeCells('A2:F2');
  const dateCell = worksheet.getCell('A2');
  dateCell.value = `Generated on: ${new Date().toLocaleDateString()}`;
  dateCell.font = {
    size: 10,
    italic: true
  };
  dateCell.alignment = { horizontal: 'center' };
  
  // Add headers
  worksheet.columns = [
    { header: 'Order #', key: 'orderNumber', width: 15 },
    { header: 'Supplier', key: 'supplier', width: 30 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Total Amount', key: 'totalAmount', width: 15 },
    { header: 'Date Created', key: 'date', width: 15 },
    { header: 'Payment Status', key: 'paymentStatus', width: 15 }
  ];
  
  // Style the header row
  worksheet.getRow(3).font = { bold: true };
  worksheet.getRow(3).alignment = { horizontal: 'center' };
  
  // Add data
  items.forEach(order => {
    worksheet.addRow({
      orderNumber: order.orderNumber,
      supplier: order.supplierId ? supplierMap.get(order.supplierId) || 'None' : 'None',
      status: order.status,
      totalAmount: order.totalAmount,
      date: new Date(order.createdAt),
      paymentStatus: order.paymentStatus || 'UNPAID'
    });
  });
  
  // Format columns
  worksheet.getColumn('totalAmount').numFmt = '$#,##0.00';
  worksheet.getColumn('date').numFmt = 'mm/dd/yyyy';
  
  // Add totals row
  const totalRowIndex = items.length + 4;
  const totalRow = worksheet.getRow(totalRowIndex);
  totalRow.getCell(1).value = 'Total';
  totalRow.getCell(4).value = { formula: `SUM(D4:D${totalRowIndex - 1})` };
  totalRow.font = { bold: true };
  
  // Add a border to the total row
  totalRow.eachCell(cell => {
    cell.border = {
      top: { style: 'thin' }
    };
  });
  
  // Write to buffer
  return await workbookToBuffer(workbook);
}

// Purchase Requisitions Reports
async function generatePurchaseRequisitionsPdfReport(items: any[], title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Add title
  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  // Add date
  const dateStr = new Date().toLocaleDateString();
  page.drawText(`Generated on: ${dateStr}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Add headers
  const headers = ['Req #', 'Supplier', 'Status', 'Total Amount', 'Date Created'];
  const colWidths = [90, 180, 80, 100, 100];
  let yPos = height - 100;
  let xPos = 50;
  
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: xPos,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[i];
  });
  
  // Draw a line
  page.drawLine({
    start: { x: 50, y: yPos - 5 },
    end: { x: width - 50, y: yPos - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  // Add data rows
  yPos -= 20;
  const suppliers = await storage.getAllSuppliers();
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  
  for (const req of items) {
    if (yPos < 50) {
      // Add a new page if we're running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPos = height - 50;
      
      // Add headers to new page
      xPos = 50;
      headers.forEach((header, i) => {
        newPage.drawText(header, {
          x: xPos,
          y: yPos,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        xPos += colWidths[i];
      });
      
      // Draw a line
      newPage.drawLine({
        start: { x: 50, y: yPos - 5 },
        end: { x: width - 50, y: yPos - 5 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 20;
    }
    
    const supplierName = req.supplierId ? supplierMap.get(req.supplierId) || 'None' : 'None';
    const amount = `$${req.totalAmount.toFixed(2)}`;
    const created = new Date(req.createdAt).toLocaleDateString();
    const currentPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
    
    xPos = 50;
    
    currentPage.drawText(req.requisitionNumber, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[0];
    
    currentPage.drawText(supplierName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[1];
    
    currentPage.drawText(req.status, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[2];
    
    currentPage.drawText(amount, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[3];
    
    currentPage.drawText(created, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    yPos -= 15;
  }
  
  // Add totals
  const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
  const totalAmount = items.reduce((sum, req) => sum + req.totalAmount, 0);
  const totalReqs = items.length;
  
  lastPage.drawLine({
    start: { x: 50, y: yPos + 5 },
    end: { x: width - 50, y: yPos + 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Requisitions: ${totalReqs}`, {
    x: 50,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Value: $${totalAmount.toFixed(2)}`, {
    x: width - 150,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  return Buffer.from(await pdfDoc.save());
}

async function generatePurchaseRequisitionsCsvReport(items: any[], title: string): Promise<Buffer> {
  const suppliers = await storage.getAllSuppliers();
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  
  // Create a temporary file path
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  
  const filePath = path.join(tmpDir, `${title.replace(/\s+/g, '-').toLowerCase()}.csv`);
  
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      {id: 'requisitionNumber', title: 'Req #'},
      {id: 'supplier', title: 'Supplier'},
      {id: 'status', title: 'Status'},
      {id: 'totalAmount', title: 'Total Amount'},
      {id: 'date', title: 'Date Created'},
      {id: 'requiredDate', title: 'Required Date'}
    ]
  });
  
  const records = items.map(req => ({
    requisitionNumber: req.requisitionNumber,
    supplier: req.supplierId ? supplierMap.get(req.supplierId) || 'None' : 'None',
    status: req.status,
    totalAmount: `$${req.totalAmount.toFixed(2)}`,
    date: new Date(req.createdAt).toLocaleDateString(),
    requiredDate: req.requiredDate ? new Date(req.requiredDate).toLocaleDateString() : 'N/A'
  }));
  
  await csvWriter.writeRecords(records);
  
  const buffer = csvBufferForExcel(fs.readFileSync(filePath));
  fs.unlinkSync(filePath);
  return buffer;
}

async function generatePurchaseRequisitionsExcelReport(items: any[], title: string): Promise<Buffer> {
  const suppliers = await storage.getAllSuppliers();
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet(title);
  
  // Add title row
  worksheet.mergeCells('A1:F1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = {
    size: 16,
    bold: true
  };
  titleCell.alignment = { horizontal: 'center' };
  
  // Add date row
  worksheet.mergeCells('A2:F2');
  const dateCell = worksheet.getCell('A2');
  dateCell.value = `Generated on: ${new Date().toLocaleDateString()}`;
  dateCell.font = {
    size: 10,
    italic: true
  };
  dateCell.alignment = { horizontal: 'center' };
  
  // Add headers
  worksheet.columns = [
    { header: 'Req #', key: 'requisitionNumber', width: 15 },
    { header: 'Supplier', key: 'supplier', width: 30 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Total Amount', key: 'totalAmount', width: 15 },
    { header: 'Date Created', key: 'date', width: 15 },
    { header: 'Required Date', key: 'requiredDate', width: 15 }
  ];
  
  // Style the header row
  worksheet.getRow(3).font = { bold: true };
  worksheet.getRow(3).alignment = { horizontal: 'center' };
  
  // Add data
  items.forEach(req => {
    worksheet.addRow({
      requisitionNumber: req.requisitionNumber,
      supplier: req.supplierId ? supplierMap.get(req.supplierId) || 'None' : 'None',
      status: req.status,
      totalAmount: req.totalAmount,
      date: new Date(req.createdAt),
      requiredDate: req.requiredDate ? new Date(req.requiredDate) : null
    });
  });
  
  // Format columns
  worksheet.getColumn('totalAmount').numFmt = '$#,##0.00';
  worksheet.getColumn('date').numFmt = 'mm/dd/yyyy';
  worksheet.getColumn('requiredDate').numFmt = 'mm/dd/yyyy';
  
  // Add totals row
  const totalRowIndex = items.length + 4;
  const totalRow = worksheet.getRow(totalRowIndex);
  totalRow.getCell(1).value = 'Total';
  totalRow.getCell(4).value = { formula: `SUM(D4:D${totalRowIndex - 1})` };
  totalRow.font = { bold: true };
  
  // Add a border to the total row
  totalRow.eachCell(cell => {
    cell.border = {
      top: { style: 'thin' }
    };
  });
  
  // Write to buffer
  return await workbookToBuffer(workbook);
}

// Suppliers Reports
async function generateSuppliersPdfReport(items: any[], title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Add title
  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  // Add date
  const dateStr = new Date().toLocaleDateString();
  page.drawText(`Generated on: ${dateStr}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Add headers
  const headers = ['Name', 'Contact', 'Email', 'Phone', 'Address'];
  const colWidths = [150, 100, 120, 100, 130];
  let yPos = height - 100;
  let xPos = 50;
  
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: xPos,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[i];
  });
  
  // Draw a line
  page.drawLine({
    start: { x: 50, y: yPos - 5 },
    end: { x: width - 50, y: yPos - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  // Add data rows
  yPos -= 20;
  
  for (const supplier of items) {
    if (yPos < 50) {
      // Add a new page if we're running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPos = height - 50;
      
      // Add headers to new page
      xPos = 50;
      headers.forEach((header, i) => {
        newPage.drawText(header, {
          x: xPos,
          y: yPos,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        xPos += colWidths[i];
      });
      
      // Draw a line
      newPage.drawLine({
        start: { x: 50, y: yPos - 5 },
        end: { x: width - 50, y: yPos - 5 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 20;
    }
    
    const currentPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
    
    xPos = 50;
    
    // Truncate name if too long
    let supplierName = supplier.name;
    if (supplierName.length > 20) {
      supplierName = supplierName.substring(0, 17) + '...';
    }
    
    currentPage.drawText(supplierName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[0];
    
    currentPage.drawText(supplier.contactName || 'N/A', {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[1];
    
    currentPage.drawText(supplier.email || 'N/A', {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[2];
    
    currentPage.drawText(supplier.phone || 'N/A', {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[3];
    
    let address = supplier.address || 'N/A';
    if (address.length > 15) {
      address = address.substring(0, 12) + '...';
    }
    
    currentPage.drawText(address, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    yPos -= 15;
  }
  
  // Add totals
  const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
  const totalSuppliers = items.length;
  
  lastPage.drawLine({
    start: { x: 50, y: yPos + 5 },
    end: { x: width - 50, y: yPos + 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  lastPage.drawText(`Total Suppliers: ${totalSuppliers}`, {
    x: 50,
    y: yPos - 10,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  return Buffer.from(await pdfDoc.save());
}

async function generateSuppliersCsvReport(items: any[], title: string): Promise<Buffer> {
  // Create a temporary file path
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  
  const filePath = path.join(tmpDir, `${title.replace(/\s+/g, '-').toLowerCase()}.csv`);
  
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      {id: 'name', title: 'Name'},
      {id: 'contactName', title: 'Contact Name'},
      {id: 'email', title: 'Email'},
      {id: 'phone', title: 'Phone'},
      {id: 'address', title: 'Address'},
      {id: 'notes', title: 'Notes'}
    ]
  });
  
  const records = items.map(supplier => ({
    name: supplier.name,
    contactName: supplier.contactName || 'N/A',
    email: supplier.email || 'N/A',
    phone: supplier.phone || 'N/A',
    address: supplier.address || 'N/A',
    notes: supplier.notes || ''
  }));
  
  await csvWriter.writeRecords(records);
  
  const buffer = csvBufferForExcel(fs.readFileSync(filePath));
  fs.unlinkSync(filePath);
  return buffer;
}

async function generateSuppliersExcelReport(items: any[], title: string): Promise<Buffer> {
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet(title);
  
  // Add title row
  worksheet.mergeCells('A1:F1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = {
    size: 16,
    bold: true
  };
  titleCell.alignment = { horizontal: 'center' };
  
  // Add date row
  worksheet.mergeCells('A2:F2');
  const dateCell = worksheet.getCell('A2');
  dateCell.value = `Generated on: ${new Date().toLocaleDateString()}`;
  dateCell.font = {
    size: 10,
    italic: true
  };
  dateCell.alignment = { horizontal: 'center' };
  
  // Add headers
  worksheet.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Contact Name', key: 'contactName', width: 20 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Address', key: 'address', width: 40 },
    { header: 'Notes', key: 'notes', width: 40 }
  ];
  
  // Style the header row
  worksheet.getRow(3).font = { bold: true };
  worksheet.getRow(3).alignment = { horizontal: 'center' };
  
  // Add data
  items.forEach(supplier => {
    worksheet.addRow({
      name: supplier.name,
      contactName: supplier.contactName,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes
    });
  });
  
  // Add totals row
  const totalRowIndex = items.length + 4;
  const totalRow = worksheet.getRow(totalRowIndex);
  totalRow.getCell(1).value = `Total Suppliers: ${items.length}`;
  totalRow.font = { bold: true };
  
  // Add a border to the total row
  totalRow.eachCell(cell => {
    cell.border = {
      top: { style: 'thin' }
    };
  });
  
  // Write to buffer
  return await workbookToBuffer(workbook);
}
