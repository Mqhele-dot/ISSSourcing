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
import { sendEmail } from "./services/email-service";
import type { ReportFormat, ReportType} from "@shared/schema";
import { reportTypeEnum, reportFormatEnum } from "@shared/schema";
import { registerOperationalRoutes } from "./operations-routes";
import { readiness } from "./readiness";
import { sendError, sendOk } from "./api-response";
import { createContractRepository, createSupplierRepository, createWarehouseRepository } from "./repositories";
import { createContractService, ContractDateError } from "./services/contract-service";
import { createSupplierService } from "./services/supplier-service";
import { eq, and, isNull, gte, lte } from "drizzle-orm";
import { 
  insertInventoryItemSchema, 
  insertCategorySchema, 
  insertActivityLogSchema,
  insertSupplierSchema,
  insertSupplierContractSchema,
  insertPurchaseRequisitionSchema,
  insertPurchaseRequisitionItemSchema,
  insertPurchaseOrderSchema,
  insertPurchaseOrderItemSchema,
  bulkImportInventorySchema,
  insertAppSettingsSchema,
  insertSupplierLogoSchema,
  appSettingsFormSchema,
  insertReorderRequestSchema,
  reorderRequestFormSchema,
  insertBarcodeSchema,
  barcodeFormSchema,
  insertWarehouseSchema,
  warehouseFormSchema,
  insertWarehouseInventorySchema,
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
  purchaseOrderRevisions,
  notifications,
  notificationPreferences,
  documents,
  retentionPolicies,
  inventoryBatches,
  inventorySerials,
  inventoryAllocations,
  cycleCounts,
  cycleCountLines,
  invoices,
  purchaseOrders,
  purchaseOrderItems,
  purchaseRequisitions,
  stockMovements,
  users,
  PurchaseRequisitionStatus,
  PurchaseOrderStatus,
  PaymentStatus,
  ReorderRequestStatus,
  userRoleEnum,
  resourceEnum,
  permissionTypeEnum,
  UserRoleEnum,
  type UserRole,
  type Resource,
  type PermissionType,
  createCustomRoleSchema,
  type DocumentType
} from "@shared/schema";

import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import Excel from 'exceljs';
import { createObjectCsvWriter } from 'csv-writer';

// Multer config for custom PDF template upload (stores to uploads/custom-pdf-template.pdf)
const uploadsDir = path.join(process.cwd(), 'uploads');
const documentsDir = path.join(uploadsDir, "documents");
const pdfTemplateUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (_req, _file, cb) => cb(null, 'custom-pdf-template.pdf'),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed for the template.'));
  },
});
const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
      cb(null, documentsDir);
    },
    filename: (_req, file, cb) => {
      const safeBase = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safeBase}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Helper function to convert Excel workbook to Buffer safely
async function workbookToBuffer(workbook: Excel.Workbook): Promise<Buffer> {
  const excelBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(excelBuffer);
}

/** Prepend UTF-8 BOM + sep=, and use CRLF so Excel opens CSV as a clean table */
function csvBufferForExcel(buffer: Buffer): Buffer {
  const content = buffer.toString("utf8").replace(/\r?\n/g, "\r\n");
  return Buffer.from("\uFEFFsep=,\r\n" + content, "utf8");
}

function sendFunctionError(
  res: Response,
  status: number,
  functionName: string,
  message: string,
  details?: unknown,
) {
  const normalizedMessage = `${functionName}: ${message}`;
  return sendError(
    res,
    status,
    functionName.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
    normalizedMessage,
    {
      details: {
        functionName,
        ...(details !== undefined ? { details } : {}),
      },
    },
  );
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/uploads", express.static(uploadsDir));
  // Set up authentication routes and middleware
  const auth = setupAuth(app);
  const contractRepo = createContractRepository(storage);
  const contractService = createContractService(contractRepo, storage);
  const supplierRepo = createSupplierRepository(storage);
  const supplierService = createSupplierService(supplierRepo, storage);
  const warehouseRepo = createWarehouseRepository(storage);
  registerOperationalRoutes(app, auth);
  
  // Role and permission routes
  
  // Get all system roles
  app.get('/api/roles', async (req, res) => {
    try {
      const roles = await storage.getSystemRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching system roles:", error);
      res.status(500).json({ message: "Error fetching system roles" });
    }
  });
  
  // Get all permissions for a role
  app.get('/api/roles/:role/permissions', async (req, res) => {
    try {
      const role = req.params.role as UserRole;
      
      // Validate that this is a valid role
      const validRoles = await storage.getSystemRoles();
      if (!validRoles.includes(role)) {
        return res.status(404).json({ message: "Role not found" });
      }
      
      const permissions = await storage.getRolePermissions(role);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      res.status(500).json({ message: "Error fetching role permissions" });
    }
  });
  
  // Custom roles management
  
  // Get all custom roles
  app.get('/api/custom-roles', auth.ensureAuthenticated, async (req, res) => {
    try {
      const roles = await storage.getCustomRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching custom roles:", error);
      res.status(500).json({ message: "Error fetching custom roles" });
    }
  });
  
  // Get a specific custom role
  app.get('/api/custom-roles/:id', auth.ensureAuthenticated, async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      const role = await storage.getCustomRole(roleId);
      if (!role) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      res.json(role);
    } catch (error) {
      console.error("Error fetching custom role:", error);
      res.status(500).json({ message: "Error fetching custom role" });
    }
  });
  
  // Create a new custom role
  app.post('/api/custom-roles', auth.ensurePermission('custom_roles', 'create'), async (req, res) => {
    try {
      const { name, description, isActive } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      // Check if role with this name already exists
      const existingRole = await storage.getCustomRoleByName(name);
      if (existingRole) {
        return res.status(400).json({ message: "A role with this name already exists" });
      }
      
      const newRole = await storage.createCustomRole({
        name,
        description,
        isActive,
        createdBy: req.user!.id,
        isSystemRole: false
      });
      
      res.status(201).json(newRole);
    } catch (error) {
      console.error("Error creating custom role:", error);
      res.status(500).json({ message: "Error creating custom role" });
    }
  });
  
  // Update a custom role
  app.put('/api/custom-roles/:id', auth.ensurePermission('custom_roles', 'update'), async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      const { name, description, isActive } = req.body;
      
      // Check if role exists
      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      // Check if updating to a name that already exists
      if (name && name !== existingRole.name) {
        const duplicateRole = await storage.getCustomRoleByName(name);
        if (duplicateRole && duplicateRole.id !== roleId) {
          return res.status(400).json({ message: "A role with this name already exists" });
        }
      }
      
      const updatedRole = await storage.updateCustomRole(roleId, {
        name,
        description,
        isActive
      });
      
      res.json(updatedRole);
    } catch (error) {
      console.error("Error updating custom role:", error);
      res.status(500).json({ message: "Error updating custom role" });
    }
  });
  
  // Delete a custom role
  app.delete('/api/custom-roles/:id', auth.ensurePermission('custom_roles', 'delete'), async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      // Check if role exists
      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      // Check if any users are using this role
      // This would require a new method in the storage interface to check user-role associations
      
      const deleted = await storage.deleteCustomRole(roleId);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete custom role" });
      }
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting custom role:", error);
      res.status(500).json({ message: "Error deleting custom role" });
    }
  });
  
  // Get permissions for a custom role
  app.get('/api/custom-roles/:id/permissions', auth.ensureAuthenticated, async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      // Check if role exists
      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      const permissions = await storage.getCustomRolePermissions(roleId);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching custom role permissions:", error);
      res.status(500).json({ message: "Error fetching custom role permissions" });
    }
  });
  
  // Add a permission to a custom role
  app.post('/api/custom-roles/:id/permissions', auth.ensurePermission('custom_roles', 'update'), async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      const { resource, permissionType } = req.body;
      
      if (!resource || !permissionType) {
        return res.status(400).json({ message: "Resource and permissionType are required" });
      }
      
      // Validate resource and permissionType
      const validResources = [
        "inventory", "purchases", "suppliers", "categories", "warehouses", 
        "reports", "users", "settings", "reorder_requests", "stock_movements",
        "analytics", "dashboards", "notifications", "audit_logs", "user_profiles",
        "documents", "custom_roles", "activity_logs", "import_export", "system"
      ];
      
      const validPermissionTypes = [
        "create", "read", "update", "delete", "approve", "export", "import", "assign",
        "manage", "execute", "transfer", "print", "scan", "view_reports", "admin", 
        "configure", "restrict", "download", "upload", "audit", "verify"
      ];
      
      if (!validResources.includes(resource)) {
        return res.status(400).json({ message: "Invalid resource" });
      }
      
      if (!validPermissionTypes.includes(permissionType)) {
        return res.status(400).json({ message: "Invalid permission type" });
      }
      
      // Check if role exists
      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      const newPermission = await storage.addCustomRolePermission(roleId, resource, permissionType);
      res.status(201).json(newPermission);
    } catch (error) {
      console.error("Error adding permission to custom role:", error);
      res.status(500).json({ message: "Error adding permission to custom role" });
    }
  });
  
  // Remove a permission from a custom role
  app.delete('/api/custom-roles/:roleId/permissions/:permissionId', auth.ensurePermission('custom_roles', 'update'), async (req, res) => {
    try {
      const roleId = parseInt(req.params.roleId);
      const permissionId = parseInt(req.params.permissionId);
      
      if (isNaN(roleId) || isNaN(permissionId)) {
        return res.status(400).json({ message: "Invalid role ID or permission ID" });
      }
      
      // Check if role exists
      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      const removed = await storage.removeCustomRolePermission(roleId, permissionId);
      if (!removed) {
        return res.status(404).json({ message: "Permission not found or already removed" });
      }
      
      res.status(204).end();
    } catch (error) {
      console.error("Error removing permission from custom role:", error);
      res.status(500).json({ message: "Error removing permission from custom role" });
    }
  });
  
  // Check if a user has a specific permission
  app.get('/api/check-permission', auth.ensureAuthenticated, async (req, res) => {
    try {
      const { resource, permissionType } = req.query;
      
      if (!resource || !permissionType) {
        return res.status(400).json({ message: "Resource and permissionType are required" });
      }
      
      const user = req.user!;
      let hasPermission = false;
      
      // Admin has all permissions
      if (user.role === 'admin') {
        hasPermission = true;
      } 
      // Custom role permissions
      else if (user.role === 'custom') {
        const customRoleId = await storage.getUserCustomRoleId(user.id);
        if (customRoleId) {
          hasPermission = await storage.checkCustomRolePermission(
            customRoleId,
            resource as Resource,
            permissionType as PermissionType
          );
        }
      } 
      // System role permissions
      else {
        hasPermission = await storage.checkPermission(
          user.role as string, 
          resource as string, 
          permissionType as string
        );
      }
      
      res.json({ hasPermission });
    } catch (error) {
      console.error("Error checking permission:", error);
      res.status(500).json({ message: "Error checking permission" });
    }
  });
  // Categories — RBAC: read for authenticated; manager/admin for write
  const categoryRead = [auth.ensureAuthenticated];
  const categoryWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  // Categories endpoints
  app.get("/api/categories", ...categoryRead, async (_req: Request, res: Response) => {
    try {
      const categories = await storage.getAllCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(200).json([]);
    }
  });

  app.post("/api/categories", ...categoryWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = insertCategorySchema.parse(req.body);
      
      // Check if category with this name already exists
      const existingCategory = await storage.getCategoryByName(validatedData.name);
      if (existingCategory) {
        return res.status(400).json({ message: "Category with this name already exists" });
      }
      
      const newCategory = await storage.createCategory(validatedData);
      res.status(201).json(newCategory);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating category:", error);
        res.status(500).json({ message: "Failed to create category" });
      }
    }
  });

  app.put("/api/categories/:id", ...categoryWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      const validatedData = insertCategorySchema.parse(req.body);
      const updatedCategory = await storage.updateCategory(id, validatedData);
      
      if (!updatedCategory) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      res.json(updatedCategory);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating category:", error);
        res.status(500).json({ message: "Failed to update category" });
      }
    }
  });

  app.delete("/api/categories/:id", ...categoryWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      const success = await storage.deleteCategory(id);
      
      if (!success) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Failed to delete category" });
    }
  });

  // Inventory — RBAC: viewer read-only; manager/admin for create/update/delete/bulk-import
  const invRead = [auth.ensureAuthenticated];
  const invWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  // Inventory items endpoints (return 200 + empty/safe payload on error so UI never 502s)
  app.get("/api/inventory", ...invRead, async (req: Request, res: Response) => {
    try {
      const query = req.query.search as string | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      if (query) {
        const items = await storage.searchInventoryItems(query, categoryId);
        return res.json(items);
      }
      const items = await storage.getAllInventoryItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching inventory items:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/inventory/low-stock", ...invRead, async (_req: Request, res: Response) => {
    try {
      const items = await storage.getLowStockItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching low stock items:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/inventory/out-of-stock", ...invRead, async (_req: Request, res: Response) => {
    try {
      const items = await storage.getOutOfStockItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching out of stock items:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/inventory/stats", ...invRead, async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getInventoryStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching inventory stats:", error);
      res.status(200).json({
        totalItems: 0,
        lowStockItems: 0,
        outOfStockItems: 0,
        inventoryValue: 0,
      });
    }
  });

  app.get("/api/inventory/:id", ...invRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }

      const item = await storage.getInventoryItem(id);

      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      const qty = Number((item as { quantity?: number }).quantity ?? 0);
      const payload = {
        ...item,
        onHand: qty,
        allocated: 0,
        available: qty,
        summary: {
          onHand: qty,
          allocated: 0,
          available: qty,
        },
        positions: [{ location: (item as { location?: string }).location ?? "Main Warehouse", onHand: qty, allocated: 0, available: qty, updatedAt: (item as { updatedAt?: Date }).updatedAt }],
        movements: [] as unknown[],
      };
      res.json(payload);
    } catch (error) {
      console.error("Error fetching inventory item:", error);
      res.status(500).json({ message: "Failed to fetch inventory item" });
    }
  });

  app.post("/api/inventory", ...invWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = insertInventoryItemSchema.parse(req.body);
      
      // Check if item with this SKU already exists
      const existingItem = await storage.getInventoryItemBySku(validatedData.sku);
      if (existingItem) {
        return res.status(400).json({ message: "Item with this SKU already exists" });
      }
      
      const newItem = await storage.createInventoryItem(validatedData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating inventory item:", error);
        res.status(500).json({ message: "Failed to create inventory item" });
      }
    }
  });

  app.put("/api/inventory/:id", ...invWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }
      
      const validatedData = insertInventoryItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updateInventoryItem(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Inventory item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating inventory item:", error);
        res.status(500).json({ message: "Failed to update inventory item" });
      }
    }
  });

  app.delete("/api/inventory/:id", ...invWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }
      
      const success = await storage.deleteInventoryItem(id);
      
      if (!success) {
        return res.status(404).json({ message: "Inventory item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting inventory item:", error);
      res.status(500).json({ message: "Failed to delete inventory item" });
    }
  });

  // Activity logs endpoints
  app.get("/api/activity-logs", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const logs = await storage.getAllActivityLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  app.post("/api/activity-logs", async (req: Request, res: Response) => {
    try {
      const validatedData = insertActivityLogSchema.parse(req.body);
      const newLog = await storage.createActivityLog(validatedData);
      res.status(201).json(newLog);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating activity log:", error);
        res.status(500).json({ message: "Failed to create activity log" });
      }
    }
  });

  // Master data endpoints — foundational reference data
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  const emitNotification = async (payload: {
    userId: number;
    type: string;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: number;
  }) => {
    await db.insert(notifications).values({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
    } as any);
  };

  const emitNotificationToRoles = async (
    roles: string[],
    payload: Omit<Parameters<typeof emitNotification>[0], "userId">,
  ) => {
    const roleUsers = (await db.select().from(users)) as any[];
    const targets = roleUsers.filter((user) =>
      roles.some((role) => String(user.role ?? "").toLowerCase() === role.toLowerCase()),
    );
    for (const user of targets) {
      if (!user.id) continue;
      await emitNotification({ userId: Number(user.id), ...payload });
    }
  };

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

  // Notifications
  app.get("/api/notifications", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications/:id/read", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid notification ID" });
      const updatedRows = (await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, id))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return res.status(404).json({ message: "Notification not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error marking notification read:", error);
      res.status(500).json({ message: "Failed to update notification" });
    }
  });

  app.get("/api/notification-preferences", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const prefRows = (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId))) as any[];
      const prefs = prefRows[0];
      if (!prefs) {
        const createdRows = (await db
          .insert(notificationPreferences)
          .values({ userId } as any)
          .returning()) as any[];
        const created = createdRows[0];
        return res.json(created);
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ message: "Failed to fetch notification preferences" });
    }
  });

  app.patch("/api/notification-preferences", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const existingRows = (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId))) as any[];
      const existing = existingRows[0];
      if (!existing) {
        const createdRows = (await db
          .insert(notificationPreferences)
          .values({ userId, ...(req.body || {}) } as any)
          .returning()) as any[];
        const created = createdRows[0];
        return res.json(created);
      }
      const updatedRows = (await db
        .update(notificationPreferences)
        .set(req.body || {})
        .where(eq(notificationPreferences.userId, userId))
        .returning()) as any[];
      const updated = updatedRows[0];
      res.json(updated);
    } catch (error) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Failed to update notification preferences" });
    }
  });

  app.post("/api/notifications/send", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        userId: number;
        type: string;
        title: string;
        body?: string;
        entityType?: string;
        entityId?: number;
      };
      if (!payload?.userId || !payload?.type || !payload?.title) {
        return res.status(400).json({ message: "userId, type and title are required" });
      }
      const createdRows = (await db
        .insert(notifications)
        .values({
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
          body: payload.body ?? null,
          entityType: payload.entityType ?? null,
          entityId: payload.entityId ?? null,
        } as any)
        .returning()) as any[];
      const created = createdRows[0];

      const prefRows = (await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, payload.userId))) as any[];
      const prefs = prefRows[0];
      const userRows = (await db.select().from(users).where(eq(users.id, payload.userId))) as any[];
      const user = userRows[0];

      if (user?.email && prefs?.emailEnabled !== false) {
        await sendEmail({
          to: user.email,
          subject: payload.title,
          html: `<p>${payload.body ?? ""}</p>`,
          text: payload.body ?? payload.title,
        }).catch(() => {});
      }
      // Optional SMS hook: keep as integration point for providers like Twilio.
      if (prefs?.smsEnabled === true) {
        console.log("[sms-hook]", "send", { userId: payload.userId, title: payload.title });
      }

      res.status(201).json(created);
    } catch (error) {
      console.error("Error sending notification:", error);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });

  // Retention policies (admin)
  registerMasterDataCrud("/api/retention-policies", retentionPolicies, insertRetentionPolicySchema as any);

  // Document metadata routes (versioned attachments by entity)
  app.get("/api/documents", ...masterRead, async (req: Request, res: Response) => {
    try {
      const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
      const entityId = typeof req.query.entityId === "string" ? Number(req.query.entityId) : undefined;
      let rows = await db.select().from(documents);
      if (entityType) {
        rows = await db.select().from(documents).where(eq(documents.entityType, entityType));
      }
      if (entityType && entityId != null && !isNaN(entityId)) {
        rows = await db
          .select()
          .from(documents)
          .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId)));
      }
      res.json(rows);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/documents", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        entityType: string;
        entityId: number;
        fileUrl: string;
        fileName: string;
        mimeType?: string;
        fileSize?: number;
        checksum?: string;
      };
      if (!payload?.entityType || !payload?.entityId || !payload?.fileUrl || !payload?.fileName) {
        return res.status(400).json({ message: "entityType, entityId, fileUrl and fileName are required" });
      }
      const existing = await db
        .select()
        .from(documents)
        .where(and(eq(documents.entityType, payload.entityType), eq(documents.entityId, payload.entityId)));
      const version = existing.length > 0 ? Math.max(...existing.map((d) => Number(d.version ?? 1))) + 1 : 1;
      const createdRows = (await db
        .insert(documents)
        .values({
          ...payload,
          version,
          uploadedBy: (req as Request & { user?: { id: number } }).user?.id,
        } as any)
        .returning()) as any[];
      const created = createdRows[0];
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating document record:", error);
      res.status(500).json({ message: "Failed to create document record" });
    }
  });

  app.post("/api/documents/upload", ...masterWrite, documentUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "File is required" });
      const entityType = typeof req.body?.entityType === "string" ? req.body.entityType : "";
      const entityId = Number(req.body?.entityId);
      if (!entityType || !Number.isFinite(entityId)) {
        return res.status(400).json({ message: "entityType and entityId are required" });
      }

      const fileUrl = `/uploads/documents/${req.file.filename}`;
      const existing = await db
        .select()
        .from(documents)
        .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId)));
      const version = existing.length > 0 ? Math.max(...existing.map((d) => Number(d.version ?? 1))) + 1 : 1;
      const createdRows = (await db
        .insert(documents)
        .values({
          entityType,
          entityId,
          fileUrl,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          version,
          uploadedBy: (req as Request & { user?: { id: number } }).user?.id ?? null,
        } as any)
        .returning()) as any[];
      res.status(201).json(createdRows[0]);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete("/api/documents/:id", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid document ID" });
      const updatedRows = (await db
        .update(documents)
        .set({ archivedAt: new Date() } as any)
        .where(eq(documents.id, id))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return res.status(404).json({ message: "Document not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error archiving document:", error);
      res.status(500).json({ message: "Failed to archive document" });
    }
  });

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

  // Supplier endpoints — RBAC: viewer read-only; manager/admin can create/update/delete
  const supplierRead = [auth.ensureAuthenticated];
  const supplierWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  const resolveSupplierIdForUser = async (req: Request): Promise<number | null> => {
    const user = (req as Request & { user?: { id: number; role?: string; email?: string } }).user;
    if (!user) return null;
    const explicit = Number(req.query.supplierId ?? req.body?.supplierId);
    const hasExplicit = Number.isFinite(explicit) && explicit > 0;
    if (user.role === "supplier") {
      const supplierRows = await supplierRepo.findAll();
      const fallback = supplierRows.find((supplier) => supplier.email && user.email && supplier.email.toLowerCase() === user.email.toLowerCase());
      // Supplier users are always scoped to their own mapped supplier, even if query/body includes supplierId.
      return fallback?.id ?? null;
    }
    if (user.role === "admin" || user.role === "manager") {
      return hasExplicit ? explicit : null;
    }
    return null;
  };

  app.get("/api/suppliers", ...supplierRead, async (_req: Request, res: Response) => {
    try {
      const suppliers = await supplierRepo.findAll();
      res.json(suppliers);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/suppliers/performance", ...supplierRead, async (_req: Request, res: Response) => {
    try {
      const supplierList = await supplierRepo.findAll();
      const purchaseOrders = await storage.getAllPurchaseOrders();
      const stockMovements = await storage.getAllStockMovements();
      const invoices = await storage.getAllInvoices();

      const performance = supplierList.map((supplier) => {
        const supplierOrders = purchaseOrders.filter((po) => po.supplierId === supplier.id);
        const supplierInvoices = invoices.filter((invoice) => Number((invoice as any).supplierId ?? 0) === supplier.id);

        let onTimeCount = 0;
        let measuredOrders = 0;
        for (const order of supplierOrders) {
          if (!order.expectedDeliveryDate) continue;
          const receipts = stockMovements
            .filter(
              (movement) =>
                movement.referenceType === "purchase_order" &&
                Number(movement.referenceId ?? 0) === order.id &&
                movement.type === "RECEIPT",
            )
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          if (receipts.length === 0) continue;
          measuredOrders += 1;
          const eta = new Date(order.expectedDeliveryDate);
          const firstReceipt = new Date(receipts[0].receivedAt ?? receipts[0].timestamp);
          if (!Number.isNaN(eta.getTime()) && !Number.isNaN(firstReceipt.getTime()) && firstReceipt <= eta) {
            onTimeCount += 1;
          }
        }

        const disputeCount = supplierInvoices.filter((invoice) => String(invoice.status).toUpperCase() === "DISPUTED").length;
        const invoiceMeasured = supplierInvoices.length;
        const priceComplianceRate =
          invoiceMeasured > 0 ? Number((((invoiceMeasured - disputeCount) / invoiceMeasured) * 100).toFixed(1)) : 100;
        const onTimeDeliveryRate =
          measuredOrders > 0 ? Number(((onTimeCount / measuredOrders) * 100).toFixed(1)) : 0;
        const overallRating = Number(((onTimeDeliveryRate * 0.6 + priceComplianceRate * 0.4) / 20).toFixed(1)); // /5 scale

        return {
          supplierId: supplier.id,
          supplierName: supplier.name,
          onTimeDeliveryRate,
          priceComplianceRate,
          ordersMeasured: measuredOrders,
          invoicesMeasured: invoiceMeasured,
          overallRating,
        };
      });

      res.json(performance);
    } catch (error) {
      console.error("Error fetching supplier performance:", error);
      res.status(500).json({ message: "Failed to fetch supplier performance" });
    }
  });

  app.get("/api/suppliers/:id", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const supplier = await supplierRepo.findById(id);
      
      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      
      res.json(supplier);
    } catch (error) {
      console.error("Error fetching supplier:", error);
      res.status(500).json({ message: "Failed to fetch supplier" });
    }
  });

  app.post("/api/suppliers", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = insertSupplierSchema.parse(req.body);
      
      // Check if supplier with this name already exists
      const existingSupplier = await supplierRepo.findByName(validatedData.name);
      if (existingSupplier) {
        return res.status(400).json({ message: "Supplier with this name already exists" });
      }
      
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const newSupplier = await supplierService.create(validatedData, userId);
      res.status(201).json(newSupplier);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating supplier:", error);
        res.status(500).json({ message: "Failed to create supplier" });
      }
    }
  });

  const handleUpdateSupplier = async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      const validatedData = insertSupplierSchema.partial().parse(req.body);
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const updatedSupplier = await supplierService.update(id, validatedData, userId);
      if (!updatedSupplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      res.json(updatedSupplier);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating supplier:", error);
        res.status(500).json({ message: "Failed to update supplier" });
      }
    }
  };

  app.put("/api/suppliers/:id", ...supplierWrite, handleUpdateSupplier);
  app.patch("/api/suppliers/:id", ...supplierWrite, handleUpdateSupplier);

  app.delete("/api/suppliers/:id", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const success = await supplierService.delete(id, userId);
      
      if (!success) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting supplier:", error);
      res.status(500).json({ message: "Failed to delete supplier" });
    }
  });

  // Supplier portal APIs
  app.get("/api/supplier/orders", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!user) return sendFunctionError(res, 401, "getSupplierPortalOrders", "Unauthorized");
      if (!["supplier", "admin", "manager"].includes(String(user.role ?? ""))) {
        return sendFunctionError(res, 403, "getSupplierPortalOrders", "Forbidden");
      }
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "getSupplierPortalOrders", "Supplier mapping not found for user");
      const orders = await storage.getAllPurchaseOrders();
      res.json(orders.filter((order) => order.supplierId === supplierId));
    } catch (error) {
      console.error("Error fetching supplier orders:", error);
      return sendFunctionError(res, 500, "getSupplierPortalOrders", "Failed to fetch supplier orders", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/supplier/orders/:id/confirm", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "confirmSupplierPortalOrder", "Forbidden");
      }
      const id = Number(req.params.id);
      if (isNaN(id)) return sendFunctionError(res, 400, "confirmSupplierPortalOrder", "Invalid order ID");
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "confirmSupplierPortalOrder", "Supplier mapping not found for user");
      const order = await storage.getPurchaseOrder(id);
      if (!order || order.supplierId !== supplierId) return sendFunctionError(res, 404, "confirmSupplierPortalOrder", "Order not found");
      const updated = await storage.updatePurchaseOrderStatus(id, PurchaseOrderStatus.ACKNOWLEDGED);
      if (!updated) return sendFunctionError(res, 404, "confirmSupplierPortalOrder", "Unable to update order status");
      await storage.createActivityLog({
        action: "Supplier PO Confirmed",
        description: `Supplier acknowledged PO ${order.orderNumber}`,
        referenceType: "purchase_order",
        referenceId: id,
        userId: (req as Request & { user?: { id: number } }).user?.id ?? null,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error confirming supplier order:", error);
      return sendFunctionError(res, 500, "confirmSupplierPortalOrder", "Failed to confirm order", error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/supplier/orders/:id/delivery", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "updateSupplierPortalDelivery", "Forbidden");
      }
      const id = Number(req.params.id);
      if (isNaN(id)) return sendFunctionError(res, 400, "updateSupplierPortalDelivery", "Invalid order ID");
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "updateSupplierPortalDelivery", "Supplier mapping not found for user");
      const order = await storage.getPurchaseOrder(id);
      if (!order || order.supplierId !== supplierId) return sendFunctionError(res, 404, "updateSupplierPortalDelivery", "Order not found");
      const expectedDeliveryDate = req.body?.expectedDeliveryDate ? new Date(req.body.expectedDeliveryDate) : null;
      if (!expectedDeliveryDate || Number.isNaN(expectedDeliveryDate.getTime())) {
        return sendFunctionError(res, 400, "updateSupplierPortalDelivery", "Valid expectedDeliveryDate is required");
      }
      const updated = await storage.updatePurchaseOrder(id, { expectedDeliveryDate });
      if (!updated) return sendFunctionError(res, 404, "updateSupplierPortalDelivery", "Unable to update purchase order delivery date");
      await storage.createActivityLog({
        action: "Supplier Delivery Updated",
        description: `Supplier updated delivery for PO ${order.orderNumber}`,
        referenceType: "purchase_order",
        referenceId: id,
        userId: (req as Request & { user?: { id: number } }).user?.id ?? null,
      });
      await emitNotificationToRoles(["manager", "admin"], {
        type: "shipment_delay",
        title: `Supplier updated ETA for PO ${order.orderNumber}`,
        body: `Expected delivery changed to ${expectedDeliveryDate.toISOString().slice(0, 10)}.`,
        entityType: "purchase_order",
        entityId: id,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating supplier delivery:", error);
      return sendFunctionError(res, 500, "updateSupplierPortalDelivery", "Failed to update delivery", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/supplier/invoices", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "createSupplierPortalInvoice", "Forbidden");
      }
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "createSupplierPortalInvoice", "Supplier mapping not found for user");
      const payload = req.body as any;
      const poId = Number(payload?.purchaseOrderId);
      if (!Number.isFinite(poId)) return sendFunctionError(res, 400, "createSupplierPortalInvoice", "purchaseOrderId is required");
      const order = await storage.getPurchaseOrder(poId);
      if (!order || order.supplierId !== supplierId) return sendFunctionError(res, 404, "createSupplierPortalInvoice", "Purchase order not found");
      const now = new Date();
      const due = payload?.dueDate ? new Date(payload.dueDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const total = Number(payload?.total ?? order.totalAmount ?? 0);
      if (!Number.isFinite(total) || total <= 0) {
        return sendFunctionError(res, 400, "createSupplierPortalInvoice", "Invoice total must be a positive number");
      }
      const invoice = await storage.createInvoice(
        {
          invoiceNumber: payload?.invoiceNumber || `INV-SUP-${Date.now().toString().slice(-8)}`,
          issueDate: payload?.issueDate ? new Date(payload.issueDate) : now,
          dueDate: due,
          customerId: null,
          supplierId,
          purchaseOrderId: poId,
          subtotal: Number(payload?.subtotal ?? total),
          tax: Number(payload?.tax ?? 0),
          discount: Number(payload?.discount ?? 0),
          total,
          paidAmount: 0,
          dueAmount: total,
          currency: payload?.currency ?? "USD",
          status: "DRAFT",
          notes: payload?.notes ?? null,
          createdBy: Number((req as Request & { user?: { id?: number } }).user?.id ?? 1),
        } as any,
        Array.isArray(payload?.items) ? payload.items : [],
      );
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error creating supplier invoice:", error);
      return sendFunctionError(res, 500, "createSupplierPortalInvoice", "Failed to create supplier invoice", error instanceof Error ? error.message : String(error));
    }
  });

  // Supplier contracts — RBAC: viewer read-only; manager/admin can create/update/delete
  const contractRead = [auth.ensureAuthenticated];
  const contractWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/contracts", ...contractRead, async (req: Request, res: Response) => {
    try {
      const supplierId = req.query.supplierId;
      const id = typeof supplierId === "string" ? Number(supplierId) : undefined;
      const contracts = await contractRepo.findAll(isNaN(id as number) ? undefined : id);
      res.json(contracts);
    } catch (error) {
      console.error("Error fetching contracts:", error);
      res.status(500).json({ message: "Failed to fetch contracts" });
    }
  });

  app.get("/api/contracts/:id", ...contractRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contract ID" });
      const contract = await contractRepo.findById(id);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      res.json(contract);
    } catch (error) {
      console.error("Error fetching contract:", error);
      res.status(500).json({ message: "Failed to fetch contract" });
    }
  });

  app.post("/api/contracts", ...contractWrite, async (req: Request, res: Response) => {
    try {
      const body = { ...req.body };
      if (typeof body.startDate === "string") body.startDate = new Date(body.startDate);
      if (body.endDate != null && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
      const validated = insertSupplierContractSchema.parse(body);
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const contract = await contractService.create(validated, userId);
      res.status(201).json(contract);
    } catch (error) {
      if (error instanceof ContractDateError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error("Error creating contract:", error);
      res.status(500).json({ message: "Failed to create contract" });
    }
  });

  app.patch("/api/contracts/:id", ...contractWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contract ID" });
      const body = { ...req.body };
      if (typeof body.startDate === "string") body.startDate = new Date(body.startDate);
      if (body.endDate != null && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
      const validated = insertSupplierContractSchema.partial().parse(body);
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const contract = await contractService.update(id, validated, userId);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      res.json(contract);
    } catch (error) {
      if (error instanceof ContractDateError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error("Error updating contract:", error);
      res.status(500).json({ message: "Failed to update contract" });
    }
  });

  app.delete("/api/contracts/:id", ...contractWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contract ID" });
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const ok = await contractService.delete(id, userId);
      if (!ok) return res.status(404).json({ message: "Contract not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting contract:", error);
      res.status(500).json({ message: "Failed to delete contract" });
    }
  });

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

  // Purchase Requisition & Purchase Order — RBAC: viewer read-only; manager/admin for create/update/delete/approve
  const poRead = [auth.ensureAuthenticated];
  const poWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];
  const roleMatchesPolicy = (policyRole: string | null | undefined, actorRole: string) => {
    if (!policyRole) return true;
    const normalizedActor = actorRole.trim().toLowerCase();
    if (!normalizedActor) return false;
    if (normalizedActor === "admin") return true;
    const allowedRoles = policyRole
      .split(/[,\s|/]+/)
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean);
    if (allowedRoles.length === 0) return true;
    return allowedRoles.includes(normalizedActor);
  };

  app.get("/api/purchase-requisitions", ...poRead, async (_req: Request, res: Response) => {
    try {
      const requisitions = await storage.getAllPurchaseRequisitions();
      res.json(requisitions);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Error fetching purchase requisitions:", error);
      res.status(500).json({
        message: "Failed to fetch purchase requisitions",
        ...(process.env.NODE_ENV !== "production" && { detail: errMsg }),
      });
    }
  });

  app.get("/api/purchase-requisitions/:id", ...poRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const requisition = await storage.getRequisitionWithDetails(id);
      
      if (!requisition) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.json(requisition);
    } catch (error) {
      console.error("Error fetching purchase requisition:", error);
      res.status(500).json({ message: "Failed to fetch purchase requisition" });
    }
  });

  app.post("/api/purchase-requisitions", ...poWrite, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "At least one item is required");
      }
      for (let i = 0; i < req.body.items.length; i++) {
        const it = req.body.items[i];
        if (Number(it?.quantity) <= 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: quantity must be greater than zero`);
        }
        const price = Number(it?.unitPrice);
        if (price < 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: unit price cannot be negative`);
        }
        if (price === 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: unit price must be greater than zero`);
        }
      }
      
      const validatedReqData = insertPurchaseRequisitionSchema.parse(req.body);
      const validatedItemsData = req.body.items.map((item: any) => 
        insertPurchaseRequisitionItemSchema.omit({ requisitionId: true }).parse(item)
      );
      if (!validatedReqData.supplierId) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Supplier is required");
      }
      const supplier = await storage.getSupplier(Number(validatedReqData.supplierId));
      if (!supplier) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Supplier does not exist");
      }
      if (validatedReqData.departmentId) {
        const deptRows = await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, Number(validatedReqData.departmentId)))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", "Department does not exist");
        }
      }
      
      // Generate a unique requisition number
      if (!validatedReqData.requisitionNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        validatedReqData.requisitionNumber = `REQ-${year}${month}-${random}`;
      }
      
      // Default to PENDING so requisitions immediately enter approval workflow.
      if (!validatedReqData.status) {
        validatedReqData.status = PurchaseRequisitionStatus.PENDING;
      }
      
      const newRequisition = await storage.createPurchaseRequisition(
        validatedReqData, 
        validatedItemsData
      );
      
      res.status(201).json(newRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendFunctionError(res, 400, "createPurchaseRequisition", validationError.message);
      } else {
        console.error("Error creating purchase requisition:", error);
        return sendFunctionError(
          res,
          500,
          "createPurchaseRequisition",
          "Failed to create purchase requisition",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  });

  app.put("/api/purchase-requisitions/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "updatePurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const validatedData = insertPurchaseRequisitionSchema.partial().parse(req.body);
      if (validatedData.supplierId != null) {
        const supplier = await storage.getSupplier(Number(validatedData.supplierId));
        if (!supplier) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Supplier does not exist");
        }
      }
      if (validatedData.departmentId != null) {
        const deptRows = await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, Number(validatedData.departmentId)))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Department does not exist");
        }
      }
      const updatedRequisition = await storage.updatePurchaseRequisition(id, validatedData);
      
      if (!updatedRequisition) {
        return sendFunctionError(res, 404, "updatePurchaseRequisition", "Purchase requisition not found");
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendFunctionError(res, 400, "updatePurchaseRequisition", validationError.message);
      } else {
        console.error("Error updating purchase requisition:", error);
        return sendFunctionError(
          res,
          500,
          "updatePurchaseRequisition",
          "Failed to update purchase requisition",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  });

  app.delete("/api/purchase-requisitions/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const success = await storage.deletePurchaseRequisition(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase requisition:", error);
      res.status(500).json({ message: "Failed to delete purchase requisition" });
    }
  });

  app.post("/api/purchase-requisitions/:id/approve", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "approvePurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const approverId = req.body?.approverId != null ? Number(req.body.approverId) : (req as any).user?.id ?? 0;
      const approverRole = String((req as any).user?.role ?? "");
      const existing = await storage.getPurchaseRequisition(id);
      if (!existing) return sendFunctionError(res, 404, "approvePurchaseRequisition", "Purchase requisition not found");
      if (![PurchaseRequisitionStatus.PENDING, PurchaseRequisitionStatus.DRAFT].includes(existing.status as PurchaseRequisitionStatus)) {
        return sendFunctionError(
          res,
          409,
          "approvePurchaseRequisition",
          `Requisition must be PENDING or DRAFT before approval; current status is ${existing.status}`,
        );
      }
      if (existing.requestorId != null && approverId === existing.requestorId && approverRole.toLowerCase() !== "admin") {
        return sendFunctionError(res, 403, "approvePurchaseRequisition", "Requester cannot approve their own requisition");
      }
      const requisitionTotal = Number(existing.totalAmount ?? 0);
      const policies = await db.select().from(approvalPolicies).where(eq(approvalPolicies.entityType, "requisition"));
      const applicable = policies
        .filter((policy) => {
          if (!policy.isActive) return false;
          const min = Number(policy.amountMin ?? 0);
          const max = policy.amountMax == null ? Number.POSITIVE_INFINITY : Number(policy.amountMax);
          return requisitionTotal >= min && requisitionTotal <= max;
        })
        .sort((a, b) => Number(b.approvalLevel ?? 0) - Number(a.approvalLevel ?? 0))[0];
      if (applicable) {
        if (applicable.approverUserId != null && Number(applicable.approverUserId) !== approverId) {
          return sendFunctionError(res, 403, "approvePurchaseRequisition", "Only the configured approver can approve this requisition");
        }
        if (!roleMatchesPolicy(applicable.approverRole, approverRole)) {
          return sendFunctionError(res, 403, "approvePurchaseRequisition", "Your role is not allowed to approve this requisition amount");
        }
      }
      
      const updatedRequisition = await storage.approvePurchaseRequisition(id, approverId);
      
      if (!updatedRequisition) return sendFunctionError(res, 404, "approvePurchaseRequisition", "Purchase requisition not found");
      await db.insert(approvalHistory).values({
        entityType: "requisition",
        entityId: id,
        level: Number(applicable?.approvalLevel ?? 1),
        action: "approved",
        performedBy: approverId,
        previousStatus: existing.status,
        newStatus: updatedRequisition.status,
        comment: typeof req.body?.comment === "string" ? req.body.comment : null,
      } as any);
      if (existing.requestorId) {
        await emitNotification({
          userId: Number(existing.requestorId),
          type: "approval_request",
          title: `Requisition ${existing.requisitionNumber ?? `#${id}`} approved`,
          body: `Your requisition has been approved.`,
          entityType: "requisition",
          entityId: id,
        });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      console.error("Error approving purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "approvePurchaseRequisition",
        "Failed to approve purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/reject", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "rejectPurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const approverId = req.body?.approverId != null ? Number(req.body.approverId) : (req as any).user?.id ?? 0;
      const approverRole = String((req as any).user?.role ?? "");
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const existing = await storage.getPurchaseRequisition(id);
      if (!existing) return sendFunctionError(res, 404, "rejectPurchaseRequisition", "Purchase requisition not found");
      if (existing.requestorId != null && approverId === existing.requestorId && approverRole.toLowerCase() !== "admin") {
        return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Requester cannot reject their own requisition");
      }
      const requisitionTotal = Number(existing.totalAmount ?? 0);
      const policies = await db.select().from(approvalPolicies).where(eq(approvalPolicies.entityType, "requisition"));
      const applicable = policies
        .filter((policy) => {
          if (!policy.isActive) return false;
          const min = Number(policy.amountMin ?? 0);
          const max = policy.amountMax == null ? Number.POSITIVE_INFINITY : Number(policy.amountMax);
          return requisitionTotal >= min && requisitionTotal <= max;
        })
        .sort((a, b) => Number(b.approvalLevel ?? 0) - Number(a.approvalLevel ?? 0))[0];
      if (applicable) {
        if (applicable.approverUserId != null && Number(applicable.approverUserId) !== approverId) {
          return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Only the configured approver can reject this requisition");
        }
        if (!roleMatchesPolicy(applicable.approverRole, approverRole)) {
          return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Your role is not allowed to reject this requisition amount");
        }
      }
      
      const updatedRequisition = await storage.rejectPurchaseRequisition(id, approverId, reason);
      
      if (!updatedRequisition) return sendFunctionError(res, 404, "rejectPurchaseRequisition", "Purchase requisition not found");
      await db.insert(approvalHistory).values({
        entityType: "requisition",
        entityId: id,
        level: Number(applicable?.approvalLevel ?? 1),
        action: "rejected",
        performedBy: approverId,
        previousStatus: existing.status,
        newStatus: updatedRequisition.status,
        comment: reason || null,
      } as any);
      if (existing.requestorId) {
        await emitNotification({
          userId: Number(existing.requestorId),
          type: "approval_request",
          title: `Requisition ${existing.requisitionNumber ?? `#${id}`} rejected`,
          body: reason || "Your requisition has been rejected.",
          entityType: "requisition",
          entityId: id,
        });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      console.error("Error rejecting purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "rejectPurchaseRequisition",
        "Failed to reject purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/convert", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "convertPurchaseRequisitionToPO", "Invalid purchase requisition ID");
      }
      
      const purchaseOrder = await storage.createPurchaseOrderFromRequisition(id);
      
      if (!purchaseOrder) {
        return sendFunctionError(
          res,
          404,
          "convertPurchaseRequisitionToPO",
          "Failed to convert requisition to purchase order. Make sure the requisition exists and is approved.",
        );
      }
      
      res.status(201).json(purchaseOrder);
    } catch (error) {
      console.error("Error converting requisition to purchase order:", error);
      return sendFunctionError(
        res,
        500,
        "convertPurchaseRequisitionToPO",
        "Failed to convert requisition to purchase order",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/share", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      const { userIds } = req.body as { userIds?: number[] };
      if (!Array.isArray(userIds)) {
        return res.status(400).json({ message: "userIds must be an array of user IDs" });
      }
      const updated = await storage.updatePurchaseRequisition(id, { sharedWithUserIds: userIds });
      if (!updated) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error sharing requisition:", error);
      res.status(500).json({ message: "Failed to share requisition" });
    }
  });

  // Purchase Requisition Items endpoints
  app.get("/api/purchase-requisitions/:reqId/items", ...poRead, async (req: Request, res: Response) => {
    try {
      const reqId = Number(req.params.reqId);
      if (isNaN(reqId)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const items = await storage.getPurchaseRequisitionItems(reqId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching purchase requisition items:", error);
      res.status(500).json({ message: "Failed to fetch purchase requisition items" });
    }
  });

  app.post("/api/purchase-requisitions/:reqId/items", ...poWrite, async (req: Request, res: Response) => {
    try {
      const reqId = Number(req.params.reqId);
      if (isNaN(reqId)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const validatedData = insertPurchaseRequisitionItemSchema.parse({
        ...req.body,
        requisitionId: reqId
      });
      
      const newItem = await storage.addPurchaseRequisitionItem(validatedData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error adding purchase requisition item:", error);
        res.status(500).json({ message: "Failed to add purchase requisition item" });
      }
    }
  });

  app.put("/api/purchase-requisitions-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition item ID" });
      }
      
      const validatedData = insertPurchaseRequisitionItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updatePurchaseRequisitionItem(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Purchase requisition item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating purchase requisition item:", error);
        res.status(500).json({ message: "Failed to update purchase requisition item" });
      }
    }
  });

  app.delete("/api/purchase-requisitions-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition item ID" });
      }
      
      const success = await storage.deletePurchaseRequisitionItem(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase requisition item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase requisition item:", error);
      res.status(500).json({ message: "Failed to delete purchase requisition item" });
    }
  });

  // Purchase Order endpoints (same RBAC as requisitions)
  app.get("/api/purchase-orders", ...poRead, async (_req: Request, res: Response) => {
    try {
      const orders = await storage.getAllPurchaseOrders();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching purchase orders:", error);
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });

  app.get("/api/purchase-orders/:id", ...poRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const order = await storage.getPurchaseOrderWithDetails(id);
      
      if (!order) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.json(order);
    } catch (error) {
      console.error("Error fetching purchase order:", error);
      res.status(500).json({ message: "Failed to fetch purchase order" });
    }
  });

  app.post("/api/purchase-orders", ...poWrite, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }
      
      const validatedOrderData = insertPurchaseOrderSchema.parse(req.body);
      const validatedItemsData = req.body.items.map((item: any) => 
        insertPurchaseOrderItemSchema.omit({ orderId: true }).parse(item)
      );
      
      // Generate a unique order number
      if (!validatedOrderData.orderNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        validatedOrderData.orderNumber = `PO-${year}${month}-${random}`;
      }
      
      // Set default status if not provided
      if (!validatedOrderData.status) {
        validatedOrderData.status = PurchaseOrderStatus.DRAFT;
      }
      
      const newOrder = await storage.createPurchaseOrder(
        validatedOrderData, 
        validatedItemsData
      );
      const creatorId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      await db.insert(purchaseOrderRevisions).values({
        orderId: newOrder.id,
        revisionNumber: 1,
        snapshot: {
          order: newOrder,
          items: validatedItemsData,
          source: "create",
        },
        createdBy: creatorId,
      } as any);
      
      res.status(201).json(newOrder);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating purchase order:", error);
        res.status(500).json({ message: "Failed to create purchase order" });
      }
    }
  });

  app.put("/api/purchase-orders/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const validatedData = insertPurchaseOrderSchema.partial().parse(req.body);
      const updatedOrder = await storage.updatePurchaseOrder(id, validatedData);
      
      if (!updatedOrder) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      const rev = await pool.query<{ max: number }>(
        "SELECT COALESCE(MAX(revision_number), 0) AS max FROM purchase_order_revisions WHERE order_id = $1",
        [id],
      );
      const nextRevision = Number(rev.rows[0]?.max ?? 0) + 1;
      const updaterId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      await db.insert(purchaseOrderRevisions).values({
        orderId: id,
        revisionNumber: nextRevision,
        snapshot: {
          update: validatedData,
          orderAfterUpdate: updatedOrder,
          source: "update",
        },
        createdBy: updaterId,
      } as any);
      res.json(updatedOrder);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating purchase order:", error);
        res.status(500).json({ message: "Failed to update purchase order" });
      }
    }
  });

  app.get("/api/purchase-orders/:id/revisions", ...poRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid purchase order ID" });
      const rows = await db.select().from(purchaseOrderRevisions).where(eq(purchaseOrderRevisions.orderId, id));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching purchase order revisions:", error);
      res.status(500).json({ message: "Failed to fetch purchase order revisions" });
    }
  });

  app.delete("/api/purchase-orders/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const success = await storage.deletePurchaseOrder(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase order:", error);
      res.status(500).json({ message: "Failed to delete purchase order" });
    }
  });

  app.post("/api/purchase-orders/:id/update-status", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const { status } = req.body;
      if (!status || !Object.values(PurchaseOrderStatus).includes(status as PurchaseOrderStatus)) {
        return res.status(400).json({ message: "Valid status is required" });
      }
      
      const updatedOrder = await storage.updatePurchaseOrderStatus(id, status);
      
      if (!updatedOrder) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.json(updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order status:", error);
      res.status(500).json({ message: "Failed to update purchase order status" });
    }
  });

  app.post("/api/purchase-orders/:id/update-payment", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const { paymentStatus, reference } = req.body;
      if (!paymentStatus || !Object.values(PaymentStatus).includes(paymentStatus as PaymentStatus)) {
        return res.status(400).json({ message: "Valid payment status is required" });
      }
      
      const updatedOrder = await storage.updatePurchaseOrderPaymentStatus(id, paymentStatus, reference);
      
      if (!updatedOrder) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.json(updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order payment status:", error);
      res.status(500).json({ message: "Failed to update purchase order payment status" });
    }
  });

  app.post("/api/purchase-orders/:id/send-email", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Recipient email is required" });
      }
      
      const success = await storage.sendPurchaseOrderEmail(id, email);
      
      if (!success) {
        return res.status(500).json({ message: "Failed to send purchase order email" });
      }
      
      // Update the order status to SENT if successful
      await storage.updatePurchaseOrderStatus(id, PurchaseOrderStatus.SENT);
      
      res.json({ message: "Purchase order email sent successfully" });
    } catch (error) {
      console.error("Error sending purchase order email:", error);
      res.status(500).json({ message: "Failed to send purchase order email" });
    }
  });

  // Purchase Order Items endpoints
  app.get("/api/purchase-orders/:orderId/items", ...poRead, async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const items = await storage.getPurchaseOrderItems(orderId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching purchase order items:", error);
      res.status(500).json({ message: "Failed to fetch purchase order items" });
    }
  });

  app.post("/api/purchase-orders/:orderId/items", ...poWrite, async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const validatedData = insertPurchaseOrderItemSchema.parse({
        ...req.body,
        orderId
      });
      
      const newItem = await storage.addPurchaseOrderItem(validatedData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error adding purchase order item:", error);
        res.status(500).json({ message: "Failed to add purchase order item" });
      }
    }
  });

  app.put("/api/purchase-order-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order item ID" });
      }
      
      const validatedData = insertPurchaseOrderItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updatePurchaseOrderItem(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Purchase order item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating purchase order item:", error);
        res.status(500).json({ message: "Failed to update purchase order item" });
      }
    }
  });

  app.delete("/api/purchase-order-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order item ID" });
      }
      
      const success = await storage.deletePurchaseOrderItem(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase order item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase order item:", error);
      res.status(500).json({ message: "Failed to delete purchase order item" });
    }
  });

  app.post("/api/purchase-order-items/:id/receive", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order item ID" });
      }
      
      const { receivedQuantity } = req.body;
      if (receivedQuantity === undefined || isNaN(Number(receivedQuantity)) || Number(receivedQuantity) < 0) {
        return res.status(400).json({ message: "Valid received quantity is required" });
      }
      
      const updatedItem = await storage.recordPurchaseOrderItemReceived(id, Number(receivedQuantity));
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Purchase order item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      console.error("Error recording received quantity:", error);
      res.status(500).json({ message: "Failed to record received quantity" });
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
      const statusParam = req.query.status as string;
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
      
      if (statusParam) {
        filter.status = statusParam;
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
      
      if (filter.status) {
        filterTexts.push(`Status: ${filter.status}`);
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
          
          data = reorderRequests;
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

          const reqSuppliers = await storage.getAllSuppliers();
          const reqSupplierNames = new Map(reqSuppliers.map((s) => [s.id, s.name]));
          const reqUsers = await storage.getAllUsers();
          const reqUserDisplay = new Map(
            reqUsers.map((u) => [u.id, (u.fullName || u.username || "").trim()]),
          );
          if (format === "pdf") {
            const enrichedReq: unknown[] = [];
            for (const r of requisitions) {
              const d = await storage.getRequisitionWithDetails(r.id);
              if (d) enrichedReq.push(d);
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
      const buffer = await generateDocument(
        normalizedReportType as ReportType,
        format as ReportFormat,
        normalizedData,
        title,
        {
          pdfTemplate: templateParam as "standard" | "compact" | "custom",
          customTemplateBuffer,
          metadataLines,
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

  // Supplier Logo endpoints (same RBAC as suppliers)
  app.get("/api/suppliers/:id/logo", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const logo = await storage.getSupplierLogo(supplierId);
      if (!logo) {
        return res.status(404).json({ message: "Supplier logo not found" });
      }
      
      res.json(logo);
    } catch (error) {
      console.error("Error fetching supplier logo:", error);
      res.status(500).json({ message: "Failed to fetch supplier logo" });
    }
  });

  app.post("/api/suppliers/:id/logo", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      // Check if the supplier exists
      const supplier = await storage.getSupplier(supplierId);
      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      
      const validatedData = insertSupplierLogoSchema.parse({
        ...req.body,
        supplierId
      });
      
      const logo = await storage.createSupplierLogo(validatedData);
      res.status(201).json(logo);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating supplier logo:", error);
        res.status(500).json({ message: "Failed to create supplier logo" });
      }
    }
  });

  app.put("/api/suppliers/:id/logo", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      if (!req.body.logoUrl) {
        return res.status(400).json({ message: "Logo URL is required" });
      }
      
      const updatedLogo = await storage.updateSupplierLogo(supplierId, req.body.logoUrl);
      if (!updatedLogo) {
        return res.status(404).json({ message: "Supplier logo not found" });
      }
      
      res.json(updatedLogo);
    } catch (error) {
      console.error("Error updating supplier logo:", error);
      res.status(500).json({ message: "Failed to update supplier logo" });
    }
  });

  app.delete("/api/suppliers/:id/logo", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const success = await storage.deleteSupplierLogo(supplierId);
      if (!success) {
        return res.status(404).json({ message: "Supplier logo not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting supplier logo:", error);
      res.status(500).json({ message: "Failed to delete supplier logo" });
    }
  });

  // Warehouse endpoints — RBAC: viewer read-only; manager/admin can create/update/delete
  const warehouseRead = [auth.ensureAuthenticated];
  const warehouseWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/warehouses", ...warehouseRead, async (_req: Request, res: Response) => {
    try {
      const warehouses = await warehouseRepo.findAll();
      res.json(warehouses);
    } catch (error) {
      console.error("Error fetching warehouses:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/warehouses/default", ...warehouseRead, async (_req: Request, res: Response) => {
    try {
      const warehouse = await warehouseRepo.findDefault();
      if (!warehouse) {
        return res.status(404).json({ message: "No default warehouse found" });
      }
      res.json(warehouse);
    } catch (error) {
      console.error("Error fetching default warehouse:", error);
      res.status(500).json({ message: "Failed to fetch default warehouse" });
    }
  });

  app.get("/api/warehouses/:id", ...warehouseRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const warehouse = await warehouseRepo.findById(id);
      
      if (!warehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.json(warehouse);
    } catch (error) {
      console.error("Error fetching warehouse:", error);
      res.status(500).json({ message: "Failed to fetch warehouse" });
    }
  });

  app.post("/api/warehouses", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = insertWarehouseSchema.parse(req.body);
      const newWarehouse = await warehouseRepo.create(validatedData);
      res.status(201).json(newWarehouse);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating warehouse:", error);
        res.status(500).json({ message: "Failed to create warehouse" });
      }
    }
  });

  app.put("/api/warehouses/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const validatedData = insertWarehouseSchema.partial().parse(req.body);
      const updatedWarehouse = await warehouseRepo.update(id, validatedData);
      
      if (!updatedWarehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.json(updatedWarehouse);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating warehouse:", error);
        res.status(500).json({ message: "Failed to update warehouse" });
      }
    }
  });
  
  // Add PATCH endpoint for warehouse updates - serves the same purpose as PUT
  app.patch("/api/warehouses/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const validatedData = insertWarehouseSchema.partial().parse(req.body);
      const updatedWarehouse = await warehouseRepo.update(id, validatedData);
      
      if (!updatedWarehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.json(updatedWarehouse);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating warehouse:", error);
        res.status(500).json({ message: "Failed to update warehouse" });
      }
    }
  });

  app.delete("/api/warehouses/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const success = await warehouseRepo.delete(id);
      
      if (!success) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting warehouse:", error);
      res.status(500).json({ message: "Failed to delete warehouse" });
    }
  });

  app.put("/api/warehouses/:id/set-default", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const warehouse = await warehouseRepo.setDefault(id);
      
      if (!warehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.json(warehouse);
    } catch (error) {
      console.error("Error setting default warehouse:", error);
      res.status(500).json({ message: "Failed to set default warehouse" });
    }
  });

  // Warehouse inventory endpoints
  app.get("/api/warehouse-inventory/:warehouseId", async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      if (isNaN(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const inventory = await storage.getWarehouseInventory(warehouseId);
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching warehouse inventory:", error);
      res.status(500).json({ message: "Failed to fetch warehouse inventory" });
    }
  });

  app.get("/api/warehouse-inventory/:warehouseId/:itemId", async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      const itemId = Number(req.params.itemId);
      if (isNaN(warehouseId) || isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid warehouse or item ID" });
      }
      
      const inventoryItem = await storage.getWarehouseInventoryItem(warehouseId, itemId);
      
      if (!inventoryItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }
      
      res.json(inventoryItem);
    } catch (error) {
      console.error("Error fetching warehouse inventory item:", error);
      res.status(500).json({ message: "Failed to fetch warehouse inventory item" });
    }
  });

  app.post("/api/warehouse-inventory", async (req: Request, res: Response) => {
    try {
      const validatedData = insertWarehouseInventorySchema.parse(req.body);
      const newInventoryItem = await storage.createWarehouseInventory(validatedData);
      res.status(201).json(newInventoryItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating warehouse inventory item:", error);
        res.status(500).json({ message: "Failed to create warehouse inventory item" });
      }
    }
  });

  app.put("/api/warehouse-inventory/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }
      
      const validatedData = insertWarehouseInventorySchema.partial().parse(req.body);
      
      // Get the previous state for comparison
      const previousItem = await storage.getWarehouseInventoryById(id);
      if (!previousItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }
      
      const previousQuantity = previousItem.quantity;
      const updatedItem = await storage.updateWarehouseInventory(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }
      
      // If quantity changed, notify via WebSocket
      if (validatedData.quantity !== undefined && validatedData.quantity !== previousQuantity) {
        try {
          const { notifyInventoryUpdate } = await import('./websocket-service');
          notifyInventoryUpdate(
            updatedItem.itemId, 
            updatedItem.warehouseId, 
            updatedItem.quantity, 
            previousQuantity
          );
        } catch (wsError) {
          console.error("Failed to notify inventory update via WebSocket:", wsError);
          // Continue with the response even if WebSocket notification fails
        }
      }
      
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating warehouse inventory item:", error);
        res.status(500).json({ message: "Failed to update warehouse inventory item" });
      }
    }
  });

  app.delete("/api/warehouse-inventory/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }
      
      const success = await storage.deleteWarehouseInventory(id);
      
      if (!success) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting warehouse inventory item:", error);
      res.status(500).json({ message: "Failed to delete warehouse inventory item" });
    }
  });
  
  // Get inventory of an item across all warehouses
  app.get("/api/inventory/:itemId/warehouses", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }
      
      const inventory = await storage.getItemWarehouseInventory(itemId);
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching item warehouse inventory:", error);
      res.status(500).json({ message: "Failed to fetch item warehouse inventory" });
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

  // Reorder request endpoints
  app.get("/api/reorder-requests", async (req: Request, res: Response) => {
    try {
      const startDateParam = req.query.startDate as string;
      const endDateParam = req.query.endDate as string;
      
      if (startDateParam && endDateParam) {
        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid date format" });
        }
        
        const requests = await storage.getReorderRequestsByDateRange(startDate, endDate);
        return res.json(requests);
      }
      
      const requests = await storage.getAllReorderRequests();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching reorder requests:", error);
      res.status(500).json({ message: "Failed to fetch reorder requests" });
    }
  });
  
  app.get("/api/reorder-requests/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }
      
      const request = await storage.getReorderRequestWithDetails(id);
      
      if (!request) {
        return res.status(404).json({ message: "Reorder request not found" });
      }
      
      res.json(request);
    } catch (error) {
      console.error("Error fetching reorder request:", error);
      res.status(500).json({ message: "Failed to fetch reorder request" });
    }
  });
  
  app.post("/api/reorder-requests", async (req: Request, res: Response) => {
    try {
      const validatedData = reorderRequestFormSchema.parse(req.body);
      
      // Set status to PENDING if not specified
      if (!validatedData.status) {
        validatedData.status = ReorderRequestStatus.PENDING;
      }
      
      // Generate request number if not provided
      if (!validatedData.requestNumber) {
        const date = new Date();
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        validatedData.requestNumber = `RO-${year}${month}${day}-${random}`;
      }
      
      const newRequest = await storage.createReorderRequest(validatedData);
      res.status(201).json(newRequest);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating reorder request:", error);
        res.status(500).json({ message: "Failed to create reorder request" });
      }
    }
  });
  
  app.put("/api/reorder-requests/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }
      
      const validatedData = reorderRequestFormSchema.partial().parse(req.body);
      const updatedRequest = await storage.updateReorderRequest(id, validatedData);
      
      if (!updatedRequest) {
        return res.status(404).json({ message: "Reorder request not found" });
      }
      
      res.json(updatedRequest);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating reorder request:", error);
        res.status(500).json({ message: "Failed to update reorder request" });
      }
    }
  });
  
  app.delete("/api/reorder-requests/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }
      
      const success = await storage.deleteReorderRequest(id);
      
      if (!success) {
        return res.status(404).json({ message: "Reorder request not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting reorder request:", error);
      res.status(500).json({ message: "Failed to delete reorder request" });
    }
  });
  
  app.post("/api/reorder-requests/:id/approve", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }
      
      // In a real application, we would get the current user ID from authentication
      const approverId = req.body.approverId || 1; // Using default admin user ID
      
      const approvedRequest = await storage.approveReorderRequest(id, approverId);
      
      if (!approvedRequest) {
        return res.status(404).json({ message: "Reorder request not found" });
      }
      
      res.json(approvedRequest);
    } catch (error) {
      console.error("Error approving reorder request:", error);
      res.status(500).json({ message: "Failed to approve reorder request" });
    }
  });
  
  app.post("/api/reorder-requests/:id/reject", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }
      
      const { approverId = 1, reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ message: "Rejection reason is required" });
      }
      
      const rejectedRequest = await storage.rejectReorderRequest(id, approverId, reason);
      
      if (!rejectedRequest) {
        return res.status(404).json({ message: "Reorder request not found" });
      }
      
      res.json(rejectedRequest);
    } catch (error) {
      console.error("Error rejecting reorder request:", error);
      res.status(500).json({ message: "Failed to reject reorder request" });
    }
  });
  
  app.post("/api/reorder-requests/:id/convert", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }
      
      const requisition = await storage.convertReorderRequestToRequisition(id);
      
      if (!requisition) {
        return res.status(404).json({ message: "Reorder request not found or cannot be converted" });
      }
      
      res.json(requisition);
    } catch (error) {
      console.error("Error converting reorder request to requisition:", error);
      res.status(500).json({ message: "Failed to convert reorder request to requisition" });
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
  
  // ================== ROLE MANAGEMENT ENDPOINTS ==================
  
  // System Roles and Permissions
  app.get("/api/roles", async (_req: Request, res: Response) => {
    try {
      // Return a list of all available roles from UserRole enum
      res.json(Object.values(UserRoleEnum));
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });
  
  app.get("/api/roles/:role/permissions", async (req: Request, res: Response) => {
    try {
      const role = req.params.role as keyof typeof UserRoleEnum;
      
      // Validate role exists
      if (!Object.values(UserRoleEnum).includes(role as UserRoleEnum)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      
      const permissions = await storage.getPermissionsByRole(role);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      res.status(500).json({ message: "Failed to fetch role permissions" });
    }
  });
  
  // Custom Roles
  app.get("/api/custom-roles", async (_req: Request, res: Response) => {
    try {
      const roles = await storage.getAllCustomRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching custom roles:", error);
      res.status(500).json({ message: "Failed to fetch custom roles" });
    }
  });
  
  app.get("/api/custom-roles/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      const role = await storage.getCustomRole(id);
      
      if (!role) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      res.json(role);
    } catch (error) {
      console.error("Error fetching custom role:", error);
      res.status(500).json({ message: "Failed to fetch custom role" });
    }
  });
  
  app.post("/api/custom-roles", async (req: Request, res: Response) => {
    try {
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      // Parse request using the schema with defaults
      const validatedData = createCustomRoleSchema.safeParse({
        ...req.body,
        createdBy: req.user ? req.user.id : 1 // Use authenticated user's ID if available
      });
      
      if (!validatedData.success) {
        return res.status(400).json({ 
          message: "Invalid role data", 
          errors: validatedData.error.errors 
        });
      }
      
      const roleData = validatedData.data;
      
      const newRole = await storage.createCustomRole(roleData);
      res.status(201).json(newRole);
    } catch (error) {
      console.error("Error creating custom role:", error);
      res.status(500).json({ message: "Failed to create custom role" });
    }
  });
  
  app.put("/api/custom-roles/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      // Check if it's a system role
      const role = await storage.getCustomRole(id);
      if (role && role.isSystemRole) {
        return res.status(403).json({ message: "Cannot modify system roles" });
      }
      
      const roleData = {
        ...req.body,
        updatedById: req.user ? req.user.id : undefined // Use authenticated user's ID if available
      };
      
      const updatedRole = await storage.updateCustomRole(id, roleData);
      
      if (!updatedRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      res.json(updatedRole);
    } catch (error) {
      console.error("Error updating custom role:", error);
      res.status(500).json({ message: "Failed to update custom role" });
    }
  });
  
  app.delete("/api/custom-roles/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      // Check if it's a system role
      const role = await storage.getCustomRole(id);
      if (role && role.isSystemRole) {
        return res.status(403).json({ message: "Cannot delete system roles" });
      }
      
      const success = await storage.deleteCustomRole(id);
      
      if (!success) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting custom role:", error);
      res.status(500).json({ message: "Failed to delete custom role" });
    }
  });
  
  // Custom Role Permissions
  app.get("/api/custom-roles/:id/permissions", async (req: Request, res: Response) => {
    try {
      const roleId = Number(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      const permissions = await storage.getAllCustomRolePermissions(roleId);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching custom role permissions:", error);
      res.status(500).json({ message: "Failed to fetch custom role permissions" });
    }
  });
  
  app.post("/api/custom-roles/:id/permissions", async (req: Request, res: Response) => {
    try {
      const roleId = Number(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      const permissionData = {
        ...req.body,
        roleId
      };
      
      const newPermission = await storage.createCustomRolePermission(permissionData);
      res.status(201).json(newPermission);
    } catch (error) {
      console.error("Error creating custom role permission:", error);
      res.status(500).json({ message: "Failed to create custom role permission" });
    }
  });
  
  app.delete("/api/custom-roles/:roleId/permissions/:permissionId", async (req: Request, res: Response) => {
    try {
      const roleId = Number(req.params.roleId);
      const permissionId = Number(req.params.permissionId);
      
      if (isNaN(roleId) || isNaN(permissionId)) {
        return res.status(400).json({ message: "Invalid role or permission ID" });
      }
      
      // Admin only endpoint
      if (req.user && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to access this resource" });
      }
      
      // Check if the permission belongs to the role
      const permission = await storage.getCustomRolePermission(permissionId);
      if (!permission || permission.roleId !== roleId) {
        return res.status(404).json({ message: "Permission not found for this role" });
      }
      
      const success = await storage.deleteCustomRolePermission(permissionId);
      
      if (!success) {
        return res.status(404).json({ message: "Permission not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting custom role permission:", error);
      res.status(500).json({ message: "Failed to delete custom role permission" });
    }
  });

  // Create the HTTP server
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
