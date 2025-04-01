import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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
  getTopItems
} from "./forecast-service";
import { initializeWebSocketService } from "./websocket-service";
import { initializeRealTimeSyncService, getConnectedClientInfo, notifyDataChange } from "./real-time-sync-service";
import { registerImageRecognitionRoutes } from "./controllers/image-recognition-controller";
import { uploadProfilePicture, removeProfilePicture, updateProfilePictureUrl } from "./controllers/profile-picture-controller";
import { profilePictureUpload } from "./services/cloudinary-service";
import { generateDocument } from "./services/document-generator-service";
import { ReportFormat, ReportType, reportTypeEnum, reportFormatEnum } from "@shared/schema";
import { 
  insertInventoryItemSchema, 
  insertCategorySchema, 
  insertActivityLogSchema,
  insertSupplierSchema,
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
  PurchaseRequisitionStatus,
  PurchaseOrderStatus,
  PaymentStatus,
  ReorderRequestStatus,
  userRoleEnum,
  resourceEnum,
  permissionTypeEnum,
  type UserRole,
  type Resource,
  type PermissionType,
  createCustomRoleSchema,
  type DocumentType
} from "@shared/schema";

import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import Excel from 'exceljs';
import { createObjectCsvWriter } from 'csv-writer';

// Helper function to convert Excel workbook to Buffer safely
async function workbookToBuffer(workbook: Excel.Workbook): Promise<Buffer> {
  const excelBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(excelBuffer);
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication routes and middleware
  const auth = setupAuth(app);
  
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
            resource as string, 
            permissionType as string
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
  // Categories endpoints
  app.get("/api/categories", async (_req: Request, res: Response) => {
    try {
      const categories = await storage.getAllCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", async (req: Request, res: Response) => {
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

  app.put("/api/categories/:id", async (req: Request, res: Response) => {
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

  app.delete("/api/categories/:id", async (req: Request, res: Response) => {
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

  // Inventory items endpoints
  app.get("/api/inventory", async (req: Request, res: Response) => {
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
      res.status(500).json({ message: "Failed to fetch inventory items" });
    }
  });

  app.get("/api/inventory/low-stock", async (_req: Request, res: Response) => {
    try {
      const items = await storage.getLowStockItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching low stock items:", error);
      res.status(500).json({ message: "Failed to fetch low stock items" });
    }
  });

  app.get("/api/inventory/out-of-stock", async (_req: Request, res: Response) => {
    try {
      const items = await storage.getOutOfStockItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching out of stock items:", error);
      res.status(500).json({ message: "Failed to fetch out of stock items" });
    }
  });

  app.get("/api/inventory/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getInventoryStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching inventory stats:", error);
      res.status(500).json({ message: "Failed to fetch inventory stats" });
    }
  });

  app.get("/api/inventory/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }
      
      const item = await storage.getInventoryItem(id);
      
      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }
      
      res.json(item);
    } catch (error) {
      console.error("Error fetching inventory item:", error);
      res.status(500).json({ message: "Failed to fetch inventory item" });
    }
  });

  app.post("/api/inventory", async (req: Request, res: Response) => {
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

  app.put("/api/inventory/:id", async (req: Request, res: Response) => {
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

  app.delete("/api/inventory/:id", async (req: Request, res: Response) => {
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

  // Supplier endpoints
  app.get("/api/suppliers", async (_req: Request, res: Response) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      res.json(suppliers);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      res.status(500).json({ message: "Failed to fetch suppliers" });
    }
  });

  app.get("/api/suppliers/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const supplier = await storage.getSupplier(id);
      
      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      
      res.json(supplier);
    } catch (error) {
      console.error("Error fetching supplier:", error);
      res.status(500).json({ message: "Failed to fetch supplier" });
    }
  });

  app.post("/api/suppliers", async (req: Request, res: Response) => {
    try {
      const validatedData = insertSupplierSchema.parse(req.body);
      
      // Check if supplier with this name already exists
      const existingSupplier = await storage.getSupplierByName(validatedData.name);
      if (existingSupplier) {
        return res.status(400).json({ message: "Supplier with this name already exists" });
      }
      
      const newSupplier = await storage.createSupplier(validatedData);
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

  app.put("/api/suppliers/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const validatedData = insertSupplierSchema.partial().parse(req.body);
      const updatedSupplier = await storage.updateSupplier(id, validatedData);
      
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
  });

  app.delete("/api/suppliers/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      
      const success = await storage.deleteSupplier(id);
      
      if (!success) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting supplier:", error);
      res.status(500).json({ message: "Failed to delete supplier" });
    }
  });

  // Bulk import inventory items
  app.post("/api/inventory/bulk-import", async (req: Request, res: Response) => {
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

  // Purchase Requisition endpoints
  app.get("/api/purchase-requisitions", async (_req: Request, res: Response) => {
    try {
      const requisitions = await storage.getAllPurchaseRequisitions();
      res.json(requisitions);
    } catch (error) {
      console.error("Error fetching purchase requisitions:", error);
      res.status(500).json({ message: "Failed to fetch purchase requisitions" });
    }
  });

  app.get("/api/purchase-requisitions/:id", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-requisitions", async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }
      
      const validatedReqData = insertPurchaseRequisitionSchema.parse(req.body);
      const validatedItemsData = req.body.items.map((item: any) => 
        insertPurchaseRequisitionItemSchema.omit({ requisitionId: true }).parse(item)
      );
      
      // Generate a unique requisition number
      if (!validatedReqData.requisitionNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        validatedReqData.requisitionNumber = `REQ-${year}${month}-${random}`;
      }
      
      // Set default status if not provided
      if (!validatedReqData.status) {
        validatedReqData.status = PurchaseRequisitionStatus.DRAFT;
      }
      
      const newRequisition = await storage.createPurchaseRequisition(
        validatedReqData, 
        validatedItemsData
      );
      
      res.status(201).json(newRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating purchase requisition:", error);
        res.status(500).json({ message: "Failed to create purchase requisition" });
      }
    }
  });

  app.put("/api/purchase-requisitions/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const validatedData = insertPurchaseRequisitionSchema.partial().parse(req.body);
      const updatedRequisition = await storage.updatePurchaseRequisition(id, validatedData);
      
      if (!updatedRequisition) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating purchase requisition:", error);
        res.status(500).json({ message: "Failed to update purchase requisition" });
      }
    }
  });

  app.delete("/api/purchase-requisitions/:id", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-requisitions/:id/approve", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const { approverId } = req.body;
      if (!approverId) {
        return res.status(400).json({ message: "Approver ID is required" });
      }
      
      const updatedRequisition = await storage.approvePurchaseRequisition(id, approverId);
      
      if (!updatedRequisition) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      console.error("Error approving purchase requisition:", error);
      res.status(500).json({ message: "Failed to approve purchase requisition" });
    }
  });

  app.post("/api/purchase-requisitions/:id/reject", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const { approverId, reason } = req.body;
      if (!approverId) {
        return res.status(400).json({ message: "Approver ID is required" });
      }
      
      if (!reason) {
        return res.status(400).json({ message: "Rejection reason is required" });
      }
      
      const updatedRequisition = await storage.rejectPurchaseRequisition(id, approverId, reason);
      
      if (!updatedRequisition) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      console.error("Error rejecting purchase requisition:", error);
      res.status(500).json({ message: "Failed to reject purchase requisition" });
    }
  });

  app.post("/api/purchase-requisitions/:id/convert", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const purchaseOrder = await storage.createPurchaseOrderFromRequisition(id);
      
      if (!purchaseOrder) {
        return res.status(404).json({ 
          message: "Failed to convert requisition to purchase order. Make sure the requisition exists and is approved." 
        });
      }
      
      res.status(201).json(purchaseOrder);
    } catch (error) {
      console.error("Error converting requisition to purchase order:", error);
      res.status(500).json({ message: "Failed to convert requisition to purchase order" });
    }
  });

  // Purchase Requisition Items endpoints
  app.get("/api/purchase-requisitions/:reqId/items", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-requisitions/:reqId/items", async (req: Request, res: Response) => {
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

  app.put("/api/purchase-requisitions-items/:id", async (req: Request, res: Response) => {
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

  app.delete("/api/purchase-requisitions-items/:id", async (req: Request, res: Response) => {
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

  // Purchase Order endpoints
  app.get("/api/purchase-orders", async (_req: Request, res: Response) => {
    try {
      const orders = await storage.getAllPurchaseOrders();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching purchase orders:", error);
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });

  app.get("/api/purchase-orders/:id", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-orders", async (req: Request, res: Response) => {
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

  app.put("/api/purchase-orders/:id", async (req: Request, res: Response) => {
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

  app.delete("/api/purchase-orders/:id", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-orders/:id/update-status", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-orders/:id/update-payment", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-orders/:id/send-email", async (req: Request, res: Response) => {
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
  app.get("/api/purchase-orders/:orderId/items", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-orders/:orderId/items", async (req: Request, res: Response) => {
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

  app.put("/api/purchase-order-items/:id", async (req: Request, res: Response) => {
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

  app.delete("/api/purchase-order-items/:id", async (req: Request, res: Response) => {
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

  app.post("/api/purchase-order-items/:id/receive", async (req: Request, res: Response) => {
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
        case 'inventory':
          // Apply category filter if provided
          if (filter.categoryId) {
            data = (await storage.getAllInventoryItems()).filter(item => item.categoryId === filter.categoryId);
          } else {
            data = await storage.getAllInventoryItems();
          }
          title = 'Inventory Report' + filterText;
          break;
          
        case 'categories':
          data = await storage.getAllCategories();
          title = 'Categories Report' + filterText;
          break;
          
        case 'suppliers':
          data = await storage.getAllSuppliers();
          title = 'Suppliers Report' + filterText;
          break;
          
        case 'warehouses':
          data = await storage.getAllWarehouses();
          title = 'Warehouses Report' + filterText;
          break;
          
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
            stockMovements = stockMovements.filter(movement => 
              movement.fromWarehouseId === filter.warehouseId || movement.toWarehouseId === filter.warehouseId
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
          
        case 'purchase_orders':
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
          
          data = orders;
          title = 'Purchase Orders Report' + filterText;
          break;
          
        case 'purchase_requisitions':
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
          
          data = requisitions;
          title = 'Purchase Requisitions Report' + filterText;
          break;
          
        case 'activity_logs':
          let activityLogs = await storage.getAllActivityLogs();
          
          // Apply date range filter if provided
          if (filter.startDate && filter.endDate) {
            activityLogs = activityLogs.filter(log => 
              log.timestamp >= filter.startDate && log.timestamp <= filter.endDate
            );
          }
          
          data = activityLogs;
          title = 'Activity Logs Report' + filterText;
          break;
          
        default:
          return res.status(400).json({ message: "Unsupported report type" });
      }
      
      // Make sure we have data for the report
      if (!data || data.length === 0) {
        return res.status(404).json({ message: "No data found for report" });
      }
      
      // Generate the document using the centralized document generation service
      const buffer = await generateDocument(normalizedReportType as ReportType, format as ReportFormat, data, title);
      
      // Set appropriate headers
      switch (format) {
        case 'pdf':
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '-').toLowerCase()}.pdf"`);
          break;
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '-').toLowerCase()}.csv"`);
          break;
        case 'excel':
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '-').toLowerCase()}.xlsx"`);
          break;
      }
      
      // Send the document
      res.send(buffer);
      
    } catch (error) {
      console.error(`Error generating ${req.params.format} report for ${req.params.reportType}:`, error);
      res.status(500).json({ 
        message: `Failed to generate ${req.params.format} report for ${req.params.reportType}`,
        error: error instanceof Error ? error.message : String(error)
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

  // Supplier Logo endpoints
  app.get("/api/suppliers/:id/logo", async (req: Request, res: Response) => {
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

  app.post("/api/suppliers/:id/logo", async (req: Request, res: Response) => {
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

  app.put("/api/suppliers/:id/logo", async (req: Request, res: Response) => {
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

  app.delete("/api/suppliers/:id/logo", async (req: Request, res: Response) => {
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

  // Warehouse endpoints
  app.get("/api/warehouses", async (_req: Request, res: Response) => {
    try {
      const warehouses = await storage.getAllWarehouses();
      res.json(warehouses);
    } catch (error) {
      console.error("Error fetching warehouses:", error);
      res.status(500).json({ message: "Failed to fetch warehouses" });
    }
  });

  app.get("/api/warehouses/default", async (_req: Request, res: Response) => {
    try {
      const warehouse = await storage.getDefaultWarehouse();
      if (!warehouse) {
        return res.status(404).json({ message: "No default warehouse found" });
      }
      res.json(warehouse);
    } catch (error) {
      console.error("Error fetching default warehouse:", error);
      res.status(500).json({ message: "Failed to fetch default warehouse" });
    }
  });

  app.get("/api/warehouses/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const warehouse = await storage.getWarehouse(id);
      
      if (!warehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.json(warehouse);
    } catch (error) {
      console.error("Error fetching warehouse:", error);
      res.status(500).json({ message: "Failed to fetch warehouse" });
    }
  });

  app.post("/api/warehouses", async (req: Request, res: Response) => {
    try {
      const validatedData = insertWarehouseSchema.parse(req.body);
      const newWarehouse = await storage.createWarehouse(validatedData);
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

  app.put("/api/warehouses/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const validatedData = insertWarehouseSchema.partial().parse(req.body);
      const updatedWarehouse = await storage.updateWarehouse(id, validatedData);
      
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
  app.patch("/api/warehouses/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const validatedData = insertWarehouseSchema.partial().parse(req.body);
      const updatedWarehouse = await storage.updateWarehouse(id, validatedData);
      
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

  app.delete("/api/warehouses/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const success = await storage.deleteWarehouse(id);
      
      if (!success) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting warehouse:", error);
      res.status(500).json({ message: "Failed to delete warehouse" });
    }
  });

  app.put("/api/warehouses/:id/set-default", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      
      const warehouse = await storage.setDefaultWarehouse(id);
      
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
      const warehouseInventory = await storage.getWarehouseInventory();
      const previousItem = warehouseInventory.find(item => item.id === id);
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
      
      // Get current inventory state for this item/warehouse
      const warehouseInventory = await storage.getWarehouseInventoryItem(
        Number(warehouseId), 
        Number(itemId)
      );
      
      const previousQuantity = warehouseInventory ? warehouseInventory.quantity : 0;
      
      const movement = await storage.createStockMovement({
        itemId: Number(itemId),
        quantity: Number(quantity),
        type: "RECEIPT",
        warehouseId: null,
        destinationWarehouseId: Number(warehouseId),
        sourceWarehouseId: null,
        referenceId: referenceId ? Number(referenceId) : null,
        referenceType: referenceType || null,
        notes: notes || null,
        userId: userId ? Number(userId) : null,
        unitCost: unitCost ? Number(unitCost) : null
      });
      
      // Notify via WebSocket
      try {
        const { notifyInventoryUpdate } = await import('./websocket-service');
        
        // Notify for warehouse (increase)
        notifyInventoryUpdate(
          Number(itemId),
          Number(warehouseId),
          previousQuantity + Number(quantity),
          previousQuantity
        );
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
      
      // Get current inventory state for this item/warehouse
      const warehouseInventory = await storage.getWarehouseInventoryItem(
        Number(warehouseId), 
        Number(itemId)
      );
      
      if (!warehouseInventory || warehouseInventory.quantity < Number(quantity)) {
        return res.status(400).json({ message: "Insufficient stock in warehouse" });
      }
      
      const previousQuantity = warehouseInventory.quantity;
      
      const movement = await storage.createStockMovement({
        itemId: Number(itemId),
        quantity: Number(quantity),
        type: "ISSUE",
        warehouseId: null,
        sourceWarehouseId: Number(warehouseId),
        destinationWarehouseId: null,
        referenceId: referenceId ? Number(referenceId) : null,
        referenceType: referenceType || null,
        notes: notes || null,
        userId: userId ? Number(userId) : null
      });
      
      // Notify via WebSocket
      try {
        const { notifyInventoryUpdate } = await import('./websocket-service');
        
        // Notify for warehouse (decrease)
        notifyInventoryUpdate(
          Number(itemId),
          Number(warehouseId),
          previousQuantity - Number(quantity),
          previousQuantity
        );
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

      const topItems = await getTopItems(items, movements, limit);
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
        // Use item.quantity and item.cost (instead of quantityInStock and costPrice)
        const costPrice = item.cost || 0;
        const itemValue = item.quantity * costPrice;
        totalValue += itemValue;
        totalItems += item.quantity;
        
        itemValues.push({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          cost: costPrice,
          value: itemValue
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
      res.json(Object.values(UserRole));
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });
  
  app.get("/api/roles/:role/permissions", async (req: Request, res: Response) => {
    try {
      const role = req.params.role as UserRole;
      
      // Validate role exists
      if (!Object.values(UserRole).includes(role)) {
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
      const { type, itemId, warehouseId, quantity, reason, userId } = req.body;

      if (!type || !itemId || !warehouseId) {
        return res.status(400).json({ message: "Missing required fields: type, itemId, warehouseId" });
      }

      // Get the item and warehouse to ensure they exist
      const item = await storage.getInventoryItem(itemId);
      const warehouse = await storage.getWarehouse(warehouseId);

      if (!item) {
        return res.status(404).json({ message: `Inventory item #${itemId} not found` });
      }

      if (!warehouse) {
        return res.status(404).json({ message: `Warehouse #${warehouseId} not found` });
      }

      // Update the inventory if data is valid
      if (type === 'update') {
        if (quantity === undefined) {
          return res.status(400).json({ message: "Quantity is required for inventory updates" });
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

        res.json({ 
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

        res.json({
          message: "Low stock alert triggered successfully",
          item: alertItem,
          warehouse
        });
      } else {
        return res.status(400).json({ message: `Unknown test type: ${type}. Supported types: update, alert` });
      }
    } catch (error) {
      console.error("Error in inventory sync test:", error);
      res.status(500).json({ message: "Failed to process inventory sync test" });
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
          return res.status(400).json({ error: "Invalid dueInDays parameter" });
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
      
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getInvoice(id);
      
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Get invoice items
      const items = await storage.getInvoiceItems(id);
      
      // Get payments
      const payments = await storage.getPaymentsByInvoiceId(id);
      
      res.json({
        ...invoice,
        items,
        payments
      });
    } catch (error) {
      console.error("Error fetching invoice:", error);
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const invoiceData = req.body;
      const items = invoiceData.items || [];
      
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
      
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoiceData = req.body;
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Update invoice
      const updatedInvoice = await storage.updateInvoice(id, invoiceData);
      
      res.json(updatedInvoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be deleted (e.g., not in PAID status)
      if (existingInvoice.status === "PAID" || existingInvoice.status === "PARTIALLY_PAID") {
        return res.status(400).json({ 
          error: "Cannot delete a paid invoice. Consider cancelling it instead." 
        });
      }
      
      // Delete invoice
      await storage.deleteInvoice(id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting invoice:", error);
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  });

  // Invoice status update endpoints
  app.post("/api/invoices/:id/send", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be sent (must be in DRAFT status)
      if (existingInvoice.status !== "DRAFT") {
        return res.status(400).json({ 
          error: "Only invoices in DRAFT status can be sent" 
        });
      }
      
      // Update invoice status to SENT
      const updatedInvoice = await storage.updateInvoice(id, {
        status: "SENT",
        sentDate: new Date()
      });
      
      res.json(updatedInvoice);
    } catch (error) {
      console.error("Error sending invoice:", error);
      res.status(500).json({ error: "Failed to send invoice" });
    }
  });

  app.post("/api/invoices/:id/cancel", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be cancelled (not in PAID or CANCELLED status)
      if (existingInvoice.status === "PAID" || existingInvoice.status === "CANCELLED" || existingInvoice.status === "VOID") {
        return res.status(400).json({ 
          error: "Cannot cancel an invoice that is already paid, cancelled, or void" 
        });
      }
      
      // Update invoice status to CANCELLED
      const updatedInvoice = await storage.updateInvoice(id, {
        status: "CANCELLED"
      });
      
      res.json(updatedInvoice);
    } catch (error) {
      console.error("Error cancelling invoice:", error);
      res.status(500).json({ error: "Failed to cancel invoice" });
    }
  });

  app.post("/api/invoices/:id/void", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be voided (not in VOID status)
      if (existingInvoice.status === "VOID") {
        return res.status(400).json({ 
          error: "Invoice is already void" 
        });
      }
      
      // Update invoice status to VOID
      const updatedInvoice = await storage.updateInvoice(id, {
        status: "VOID"
      });
      
      res.json(updatedInvoice);
    } catch (error) {
      console.error("Error voiding invoice:", error);
      res.status(500).json({ error: "Failed to void invoice" });
    }
  });

  // Invoice items routes
  app.get("/api/invoices/:invoiceId/items", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Get invoice items
      const items = await storage.getInvoiceItems(invoiceId);
      
      res.json(items);
    } catch (error) {
      console.error("Error fetching invoice items:", error);
      res.status(500).json({ error: "Failed to fetch invoice items" });
    }
  });

  app.post("/api/invoices/:invoiceId/items", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be modified (not in PAID, CANCELLED, or VOID status)
      if (["PAID", "CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return res.status(400).json({ 
          error: "Cannot modify a paid, cancelled, or void invoice" 
        });
      }
      
      const itemData = req.body;
      itemData.invoiceId = invoiceId;
      
      // Create invoice item
      const item = await storage.addInvoiceItem(itemData);
      
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating invoice item:", error);
      res.status(500).json({ error: "Failed to create invoice item" });
    }
  });

  app.patch("/api/invoices/:invoiceId/items/:itemId", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const itemId = parseInt(req.params.itemId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be modified
      if (["PAID", "CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return res.status(400).json({ 
          error: "Cannot modify a paid, cancelled, or void invoice" 
        });
      }
      
      // Validate item exists and belongs to the invoice
      const existingItem = await storage.getInvoiceItem(itemId);
      if (!existingItem || existingItem.invoiceId !== invoiceId) {
        return res.status(404).json({ error: "Invoice item not found" });
      }
      
      // Update invoice item
      const updatedItem = await storage.updateInvoiceItem(itemId, req.body);
      
      res.json(updatedItem);
    } catch (error) {
      console.error("Error updating invoice item:", error);
      res.status(500).json({ error: "Failed to update invoice item" });
    }
  });

  app.delete("/api/invoices/:invoiceId/items/:itemId", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const itemId = parseInt(req.params.itemId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can be modified
      if (["PAID", "CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return res.status(400).json({ 
          error: "Cannot modify a paid, cancelled, or void invoice" 
        });
      }
      
      // Validate item exists and belongs to the invoice
      const existingItem = await storage.getInvoiceItem(itemId);
      if (!existingItem || existingItem.invoiceId !== invoiceId) {
        return res.status(404).json({ error: "Invoice item not found" });
      }
      
      // Delete invoice item
      await storage.deleteInvoiceItem(itemId);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting invoice item:", error);
      res.status(500).json({ error: "Failed to delete invoice item" });
    }
  });

  // Payment routes
  app.get("/api/payments", async (req, res) => {
    try {
      const payments = await storage.getAllPayments();
      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  });

  app.get("/api/invoices/:invoiceId/payments", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Get payments for invoice
      const payments = await storage.getPaymentsByInvoiceId(invoiceId);
      
      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  });

  app.post("/api/invoices/:invoiceId/payments", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      
      // Validate invoice exists
      const existingInvoice = await storage.getInvoice(invoiceId);
      if (!existingInvoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // Check if invoice can accept payments
      if (["CANCELLED", "VOID"].includes(existingInvoice.status)) {
        return res.status(400).json({ 
          error: "Cannot add payments to a cancelled or void invoice" 
        });
      }
      
      const paymentData = req.body;
      paymentData.invoiceId = invoiceId;
      
      // Create payment
      const payment = await storage.createPayment(paymentData);
      
      res.status(201).json(payment);
    } catch (error) {
      console.error("Error creating payment:", error);
      res.status(500).json({ error: "Failed to create payment" });
    }
  });

  app.patch("/api/payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate payment exists
      const existingPayment = await storage.getPayment(id);
      if (!existingPayment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      
      // Update payment
      const updatedPayment = await storage.updatePayment(id, req.body);
      
      res.json(updatedPayment);
    } catch (error) {
      console.error("Error updating payment:", error);
      res.status(500).json({ error: "Failed to update payment" });
    }
  });

  app.delete("/api/payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate payment exists
      const existingPayment = await storage.getPayment(id);
      if (!existingPayment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      
      // Delete payment
      await storage.deletePayment(id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting payment:", error);
      res.status(500).json({ error: "Failed to delete payment" });
    }
  });

  // Billing settings routes
  app.get("/api/billing-settings", async (req, res) => {
    try {
      const settings = await storage.getBillingSettings();
      res.json(settings || {});
    } catch (error) {
      console.error("Error fetching billing settings:", error);
      res.status(500).json({ error: "Failed to fetch billing settings" });
    }
  });

  app.post("/api/billing-settings", async (req, res) => {
    try {
      const settings = await storage.updateBillingSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating billing settings:", error);
      res.status(500).json({ error: "Failed to update billing settings" });
    }
  });

  // Tax rates routes
  app.get("/api/tax-rates", async (req, res) => {
    try {
      const taxRates = await storage.getAllTaxRates();
      res.json(taxRates);
    } catch (error) {
      console.error("Error fetching tax rates:", error);
      res.status(500).json({ error: "Failed to fetch tax rates" });
    }
  });

  app.get("/api/tax-rates/default", async (req, res) => {
    try {
      const defaultTaxRate = await storage.getDefaultTaxRate();
      if (!defaultTaxRate) {
        return res.status(404).json({ error: "No default tax rate set" });
      }
      res.json(defaultTaxRate);
    } catch (error) {
      console.error("Error fetching default tax rate:", error);
      res.status(500).json({ error: "Failed to fetch default tax rate" });
    }
  });

  app.get("/api/tax-rates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const taxRate = await storage.getTaxRate(id);
      
      if (!taxRate) {
        return res.status(404).json({ error: "Tax rate not found" });
      }
      
      res.json(taxRate);
    } catch (error) {
      console.error("Error fetching tax rate:", error);
      res.status(500).json({ error: "Failed to fetch tax rate" });
    }
  });

  app.post("/api/tax-rates", async (req, res) => {
    try {
      const taxRate = await storage.createTaxRate(req.body);
      res.status(201).json(taxRate);
    } catch (error) {
      console.error("Error creating tax rate:", error);
      res.status(500).json({ error: "Failed to create tax rate" });
    }
  });

  app.patch("/api/tax-rates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate tax rate exists
      const existingTaxRate = await storage.getTaxRate(id);
      if (!existingTaxRate) {
        return res.status(404).json({ error: "Tax rate not found" });
      }
      
      // Update tax rate
      const updatedTaxRate = await storage.updateTaxRate(id, req.body);
      
      res.json(updatedTaxRate);
    } catch (error) {
      console.error("Error updating tax rate:", error);
      res.status(500).json({ error: "Failed to update tax rate" });
    }
  });

  app.delete("/api/tax-rates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate tax rate exists
      const existingTaxRate = await storage.getTaxRate(id);
      if (!existingTaxRate) {
        return res.status(404).json({ error: "Tax rate not found" });
      }
      
      // Check if it's the default tax rate
      if (existingTaxRate.isDefault) {
        return res.status(400).json({ 
          error: "Cannot delete the default tax rate. Set another tax rate as default first." 
        });
      }
      
      // Delete tax rate
      await storage.deleteTaxRate(id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting tax rate:", error);
      res.status(500).json({ error: "Failed to delete tax rate" });
    }
  });

  app.post("/api/tax-rates/:id/set-default", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate tax rate exists
      const existingTaxRate = await storage.getTaxRate(id);
      if (!existingTaxRate) {
        return res.status(404).json({ error: "Tax rate not found" });
      }
      
      // Set as default
      const updatedTaxRate = await storage.setDefaultTaxRate(id);
      
      res.json(updatedTaxRate);
    } catch (error) {
      console.error("Error setting default tax rate:", error);
      res.status(500).json({ error: "Failed to set default tax rate" });
    }
  });

  // Discount routes
  app.get("/api/discounts", async (req, res) => {
    try {
      const activeOnly = req.query.activeOnly === "true";
      const discounts = activeOnly ? await storage.getActiveDiscounts() : await storage.getAllDiscounts();
      res.json(discounts);
    } catch (error) {
      console.error("Error fetching discounts:", error);
      res.status(500).json({ error: "Failed to fetch discounts" });
    }
  });

  app.get("/api/discounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const discount = await storage.getDiscount(id);
      
      if (!discount) {
        return res.status(404).json({ error: "Discount not found" });
      }
      
      res.json(discount);
    } catch (error) {
      console.error("Error fetching discount:", error);
      res.status(500).json({ error: "Failed to fetch discount" });
    }
  });

  app.post("/api/discounts", async (req, res) => {
    try {
      const discount = await storage.createDiscount(req.body);
      res.status(201).json(discount);
    } catch (error) {
      console.error("Error creating discount:", error);
      res.status(500).json({ error: "Failed to create discount" });
    }
  });

  app.patch("/api/discounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate discount exists
      const existingDiscount = await storage.getDiscount(id);
      if (!existingDiscount) {
        return res.status(404).json({ error: "Discount not found" });
      }
      
      // Update discount
      const updatedDiscount = await storage.updateDiscount(id, req.body);
      
      res.json(updatedDiscount);
    } catch (error) {
      console.error("Error updating discount:", error);
      res.status(500).json({ error: "Failed to update discount" });
    }
  });

  app.delete("/api/discounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate discount exists
      const existingDiscount = await storage.getDiscount(id);
      if (!existingDiscount) {
        return res.status(404).json({ error: "Discount not found" });
      }
      
      // Delete discount
      await storage.deleteDiscount(id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting discount:", error);
      res.status(500).json({ error: "Failed to delete discount" });
    }
  });

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  
  // Initialize image recognition routes
  registerImageRecognitionRoutes(app);
  
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
      res.json(connectionInfo);
    } catch (error) {
      console.error("Error getting WebSocket connection status:", error);
      res.status(500).json({ message: "Error getting WebSocket connection status" });
    }
  });
  
  // Test real-time sync functionality
  app.post("/api/inventory-sync/test", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const { entity, action, data } = req.body;
      
      if (!entity || !action || !data) {
        return res.status(400).json({ message: "Missing required parameters: entity, action, data" });
      }
      
      // Use the notifyDataChange function from real-time-sync-service if available
      if (typeof notifyDataChange === 'function') {
        const clientsNotified = notifyDataChange(entity, action, data);
        return res.json({ 
          success: true, 
          message: `Notified ${clientsNotified} clients about the data change`,
          clientsNotified
        });
      } else {
        return res.status(501).json({ message: "Real-time sync notification service not available" });
      }
    } catch (error) {
      console.error("Error testing real-time sync:", error);
      res.status(500).json({ message: "Failed to test real-time sync" });
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
  
  // Read the file and return as buffer
  const buffer = fs.readFileSync(filePath);
  
  // Clean up the temporary file
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
  
  // Read the file and return as buffer
  const buffer = fs.readFileSync(filePath);
  
  // Clean up the temporary file
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
  
  // Read the file and return as buffer
  const buffer = fs.readFileSync(filePath);
  
  // Clean up the temporary file
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
  
  // Read the file and return as buffer
  const buffer = fs.readFileSync(filePath);
  
  // Clean up the temporary file
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
