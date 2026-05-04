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
import { generateDocument, generateOperationalInventoryCsvFromRows } from "./services/document-generator-service";
import { listOperationalInventory } from "./operations-core";
import { recordExportHistory } from "./modules/exports/export-history-service";
import { loadLogoBytesForPdf } from "./services/pdf-logo-loader";
import type { ReportFormat, ReportType} from "@shared/schema";
import { reportTypeEnum, reportFormatEnum } from "@shared/schema";
import { registerOperationsRoutes as registerOperationalRoutes } from "./modules/operations/register-operations-routes";
import { registerDomainModules } from "./modules/register-domain-modules";
import { registerRbacRoutes } from "./modules/rbac/register-rbac-routes";
import { registerCatalogRoutes } from "./modules/catalog/register-catalog-routes";
import { registerMasterDataRoutes } from "./modules/master-data/register-master-data-routes";
import { registerAnalyticsRoutes } from "./modules/reports/register-analytics-routes";
import { registerSetupRoutes } from "./modules/setup/register-setup-routes";
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
  insertInventoryBatchSchema,
  insertInventorySerialSchema,
  insertInventoryAllocationSchema,
  approvalHistory,
  documents,
  inventoryItems,
  inventoryBatches,
  inventorySerials,
  inventoryAllocations,
  warehouseInventory,
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
import { appEnv } from "./config/env";
import { getProductBootstrapHints } from "./lib/product-bootstrap";
import { getBuildInfo } from "./lib/build-info";
import { getReportingCurrencyCode } from "./lib/org-reporting-money";
import { allowDevOnlyRoutes } from "./lib/deployment-behavior";
import { analyticsRateLimiter, exportRateLimiter, uploadRateLimiter } from "./services/security-service";

function isInternalExportRequest(req: Request): boolean {
  return req.get("x-internal-export-key") === appEnv.sessionSecret;
}

export async function registerRoutes(app: Express): Promise<Server> {
  mountUploadsStatic(app);
  app.use("/api/reports/analytics", analyticsRateLimiter);
  app.use("/api/export", exportRateLimiter);
  app.use("/api/export-jobs", exportRateLimiter);
  app.use("/api/documents/upload", uploadRateLimiter);
  app.use("/api/settings/pdf-template", uploadRateLimiter);
  app.use("/api/document-extractor/upload", uploadRateLimiter);
  app.use("/api/document-extractor/batch-upload", uploadRateLimiter);
  app.use("/api/profile/picture", uploadRateLimiter);
  app.use("/api/image-recognition/analyze", uploadRateLimiter);
  app.use("/api/inventory/image-recognition/analyze", uploadRateLimiter);
  // Set up authentication routes and middleware
  const auth = setupAuth(app);
  registerOperationalRoutes(app, auth);
  registerDomainModules(app, auth);
  registerRbacRoutes(app, auth);
  registerCatalogRoutes(app, auth);
  registerMasterDataRoutes(app, auth);
  registerAnalyticsRoutes(app, auth);
  registerSetupRoutes(app, auth);

  const invWrite = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "update")];
  const exportAccess = [auth.ensureAuthenticated, auth.ensurePermission("reports", "export")];
  const analyticsAccess = [auth.ensureAuthenticated, auth.ensurePermission("analytics", "read")];

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
  app.post(
    "/api/settings/pdf-template",
    ...exportAccess,
    uploadRateLimiter,
    pdfTemplateUpload.single("template"),
    (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: "No PDF file uploaded. Please select a PDF file." });
    }
    return res.json({ ok: true, message: "Custom PDF template uploaded. Use template 'Custom' when exporting PDF reports." });
    },
  );

  // Document generation endpoints
  app.get("/api/export/:reportType/:format", exportRateLimiter, async (req: Request, res: Response) => {
    try {
      if (!isInternalExportRequest(req)) {
        const guarded = exportAccess as unknown as Array<(req: Request, res: Response, next: (err?: unknown) => void) => void>;
        let middlewareIndex = 0;
        await new Promise<void>((resolve, reject) => {
          const run = (err?: unknown) => {
            if (err) {
              reject(err);
              return;
            }
            const middleware = guarded[middlewareIndex++];
            if (!middleware) {
              resolve();
              return;
            }
            middleware(req, res, run);
          };
          run();
        });
      }
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
                    and(
                      eq(approvalHistory.organizationId, getActiveOrganizationId()),
                      eq(approvalHistory.entityType, "requisition"),
                      eq(approvalHistory.entityId, r.id),
                    ),
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

      const parseExportBool = (value: unknown): boolean => {
        if (value === true) return true;
        const s = typeof value === "string" ? value.trim().toLowerCase() : "";
        return s === "true" || s === "1" || s === "yes" || s === "on";
      };
      
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

      let exportRowCount = normalizedData.length;
      let buffer: Buffer;

      const invExportQ = typeof req.query.q === "string" ? req.query.q : "";
      const invExportLocation = typeof req.query.location === "string" ? req.query.location : "";
      const invExportCategory =
        typeof req.query.category === "string"
          ? req.query.category
          : categoryIdParam
            ? String(categoryIdParam)
            : "";
      const invExportLow = parseExportBool(req.query.low) || parseExportBool(req.query.lowStock);

      if (normalizedReportType === "inventory" && format === "csv") {
        const opsItems = await listOperationalInventory({
          q: invExportQ,
          location: invExportLocation,
          category: invExportCategory,
          low: invExportLow,
        });
        const opsMeta: string[] = [];
        if (invExportQ.trim()) opsMeta.push(`q=${invExportQ.trim()}`);
        if (invExportLocation.trim()) opsMeta.push(`location=${invExportLocation.trim()}`);
        if (invExportCategory.trim()) opsMeta.push(`category=${invExportCategory.trim()}`);
        if (invExportLow) opsMeta.push("lowStock=true");
        const titleFiltered = opsMeta.length ? `${title} (${opsMeta.join("; ")})` : title;
        buffer = generateOperationalInventoryCsvFromRows(opsItems, titleFiltered);
        exportRowCount = opsItems.length;
      } else {
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
        const reportingCurrencyCode = await getReportingCurrencyCode(storage);
        buffer = await generateDocument(
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
            reportingCurrencyCode,
          },
        );
      }

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
      const sourcePage = typeof req.query.sourcePage === "string" ? req.query.sourcePage : null;
      const requestUrl = req.originalUrl || req.url;
      const userId = Number((req as Request & { user?: { id?: number } }).user?.id);
      res.setHeader("Content-Type", meta.contentType);
      res.setHeader("X-Export-Format", String(format));
      res.setHeader("X-Export-Row-Count", String(exportRowCount));
      res.setHeader("Content-Disposition", `attachment; filename="${normalizedTitle}.${meta.extension}"`);

      console.info(
        JSON.stringify({
          event: "export.document_generated",
          organizationId: getActiveOrganizationId(),
          dataset: normalizedReportType,
          format,
          rowCount: exportRowCount,
          userId: Number.isFinite(userId) && userId > 0 ? userId : null,
        }),
      );

      await recordExportHistory({
        userId: Number.isFinite(userId) && userId > 0 ? userId : null,
        dataset: normalizedReportType,
        format,
        filters: {
          startDate: startDateParam,
          endDate: endDateParam,
          categoryId: categoryIdParam,
          warehouseId: warehouseIdParam,
          supplierId: supplierIdParam,
          projectId: projectIdParam,
          status: statusParam,
          po: poParam,
          carrier: carrierParam,
          risk: riskParam,
          inventoryQ: invExportQ || undefined,
          inventoryLocation: invExportLocation || undefined,
          inventoryCategory: invExportCategory || undefined,
          inventoryLowStock: invExportLow || undefined,
          template: templateParam,
        },
        status: "completed",
        fileName: `${normalizedTitle}.${meta.extension}`,
        fileSize: buffer.length,
        mimeType: meta.contentType,
        rowCount: exportRowCount,
        sourcePage,
        requestUrl,
      });
      
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

  // Analytics and forecasting endpoints
  app.get("/api/analytics/demand-forecast/:itemId", ...analyticsAccess, async (req: Request, res: Response) => {
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

  app.get("/api/analytics/top-items", ...analyticsAccess, async (req: Request, res: Response) => {
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

  app.get("/api/analytics/inventory-value", ...analyticsAccess, async (req: Request, res: Response) => {
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

  app.get("/api/analytics/stock-usage", ...analyticsAccess, async (req: Request, res: Response) => {
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
    build: getBuildInfo(),
    runtimeProfile: appEnv.runtimeProfile,
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
  // Legacy bare paths + /api/* aliases share one implementation (response envelope differs).
  const sendShallowHealth = (req: Request, res: Response): void => {
    const payload = getHealthPayload();
    if (req.path.startsWith("/api")) {
      sendOk(res, payload);
      return;
    }
    res.json(payload);
  };
  app.get("/health", sendShallowHealth);
  app.get("/api/health", sendShallowHealth);

  const sendReadyPayload = async (res: Response) => {
    let buildPayload: ReturnType<typeof getBuildInfo>;
    let uploadOk = false;
    let emailOk = false;
    try {
      buildPayload = getBuildInfo();
    } catch (e) {
      console.error("[READY] BUILD_INFO_FAILED", e instanceof Error ? e.message : e);
      buildPayload = {
        version: "unknown",
        commitSha: null,
        buildId: null,
        builtAt: null,
        runtimeProfile: appEnv.runtimeProfile,
        deploymentMode: appEnv.deploymentMode,
      };
    }
    try {
      uploadOk = uploadPathReady();
    } catch (e) {
      console.error("[READY] UPLOAD_PATH_PROBE_FAILED", e instanceof Error ? e.message : e);
      uploadOk = false;
    }
    try {
      emailOk = emailServiceReady();
    } catch (e) {
      console.error("[READY] EMAIL_READY_PROBE_FAILED", e instanceof Error ? e.message : e);
      emailOk = false;
    }

    const basePayload = {
      runtimeProfile: appEnv.runtimeProfile,
      deploymentMode: appEnv.deploymentMode,
      build: buildPayload,
      dbReady: readiness.dbReady,
      schemaReady: readiness.schemaReady,
      sessionStoreReady: readiness.sessionStoreReady,
      websocketReady: readiness.websocketReady,
      uploadPathReady: uploadOk,
      emailServiceReady: emailOk,
      productBootstrap: null as Awaited<ReturnType<typeof getProductBootstrapHints>> | null,
    };
    try {
      basePayload.productBootstrap =
        readiness.dbReady ? await getProductBootstrapHints().catch(() => null) : null;
      sendOk(res, basePayload);
    } catch (e) {
      console.error("[READY] SETUP_STATUS_READY_PAYLOAD_FAILED", e instanceof Error ? e.message : e);
      sendOk(res, {
        ...basePayload,
        productBootstrap: null,
        uploadPathReady: false,
        emailServiceReady: false,
      });
    }
  };

  const sendReadyHandler = (_req: Request, res: Response): void => {
    void sendReadyPayload(res);
  };
  app.get("/ready", sendReadyHandler);
  app.get("/api/ready", sendReadyHandler);

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
      runtimeProfile: appEnv.runtimeProfile,
      deploymentMode: appEnv.deploymentMode,
      build: getBuildInfo(),
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
  const sendDeepHealth = async (req: Request, res: Response): Promise<void> => {
    const payload = await getDeepHealthPayload();
    const code = payload.status === "ok" ? 200 : 503;
    if (req.path.startsWith("/api")) {
      sendOk(res, payload, code);
      return;
    }
    res.status(code).json(payload);
  };
  app.get("/health/deep", (req, res) => void sendDeepHealth(req, res));
  app.get("/api/health/deep", (req, res) => void sendDeepHealth(req, res));

  const handleDemoReset = async (_req: Request, res: Response) => {
    if (!allowDevOnlyRoutes()) {
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

  for (const demoResetPath of ["/admin/demo/reset", "/api/admin/demo/reset"] as const) {
    app.post(demoResetPath, auth.ensureAuthenticated, auth.ensureAdmin, handleDemoReset);
  }
  app.use("/api/image-recognition", auth.ensureAuthenticated);
  app.use("/api/inventory/image-recognition", auth.ensureAuthenticated);
  app.use("/api/document-extractor", auth.ensureAuthenticated);
  
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
