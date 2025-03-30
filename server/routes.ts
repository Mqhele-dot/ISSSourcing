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
  UserRole,
  Resource,
  PermissionType,
  createCustomRoleSchema,
  type DocumentType,
  type ReportType
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
  setupAuth(app);
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
      const reportType = req.params.reportType as ReportType;
      const format = req.params.format as DocumentType;
      
      // Get optional date range parameters
      const startDateParam = req.query.startDate as string;
      const endDateParam = req.query.endDate as string;
      
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      
      // If both date parameters are provided, parse them
      if (startDateParam && endDateParam) {
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
        
        // Set end date to end of day
        endDate.setHours(23, 59, 59, 999);
        
        // Validate dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid date format. Please use ISO format (YYYY-MM-DD)." });
        }
      }
      
      // All report types should be defined in the ReportType type in schema.ts
      const reportTypes: ReportType[] = ['inventory', 'low-stock', 'value', 'purchase-orders', 'purchase-requisitions', 'suppliers', 'reorder-requests'];
      if (!reportTypes.includes(reportType)) {
        return res.status(400).json({ message: "Invalid report type" });
      }
      
      if (!['pdf', 'csv', 'excel'].includes(format)) {
        return res.status(400).json({ message: "Invalid format" });
      }
      
      let items;
      let title;
      let dateRangeText = startDate && endDate ? ` (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})` : '';
      
      switch (reportType) {
        case 'inventory':
          items = await storage.getAllInventoryItems();
          title = 'Inventory Report' + dateRangeText;
          break;
        case 'low-stock':
          items = await storage.getLowStockItems();
          title = 'Low Stock Items Report' + dateRangeText;
          break;
        case 'value':
          items = await storage.getAllInventoryItems();
          title = 'Inventory Value Report' + dateRangeText;
          break;
        case 'purchase-orders':
          if (startDate && endDate) {
            // Get orders within date range (based on createdAt)
            items = (await storage.getAllPurchaseOrders()).filter(order => 
              order.createdAt >= startDate! && order.createdAt <= endDate!
            );
          } else {
            items = await storage.getAllPurchaseOrders();
          }
          title = 'Purchase Orders Report' + dateRangeText;
          break;
        case 'purchase-requisitions':
          if (startDate && endDate) {
            // Get requisitions within date range (based on createdAt)
            items = (await storage.getAllPurchaseRequisitions()).filter(req => 
              req.createdAt >= startDate! && req.createdAt <= endDate!
            );
          } else {
            items = await storage.getAllPurchaseRequisitions();
          }
          title = 'Purchase Requisitions Report' + dateRangeText;
          break;
        case 'suppliers':
          items = await storage.getAllSuppliers();
          title = 'Suppliers Report' + dateRangeText;
          break;
        case 'reorder-requests':
          if (startDate && endDate) {
            items = await storage.getReorderRequestsByDateRange(startDate, endDate);
          } else {
            items = await storage.getAllReorderRequests();
          }
          title = 'Reorder Requests Report' + dateRangeText;
          break;
      }
      
      let buffer;
      
      // Make sure we have items and a title
      if (!items || !title) {
        return res.status(404).json({ message: "No data found for report" });
      }
      
      // Determine which generator to use based on report type
      let generator;
      
      switch (reportType) {
        case 'inventory':
        case 'low-stock':
        case 'value':
          generator = {
            pdf: generateInventoryPdfReport,
            csv: generateInventoryCsvReport,
            excel: generateInventoryExcelReport
          };
          break;
        case 'purchase-orders':
          generator = {
            pdf: generatePurchaseOrdersPdfReport,
            csv: generatePurchaseOrdersCsvReport,
            excel: generatePurchaseOrdersExcelReport
          };
          break;
        case 'purchase-requisitions':
          generator = {
            pdf: generatePurchaseRequisitionsPdfReport,
            csv: generatePurchaseRequisitionsCsvReport,
            excel: generatePurchaseRequisitionsExcelReport
          };
          break;
        case 'suppliers':
          generator = {
            pdf: generateSuppliersPdfReport,
            csv: generateSuppliersCsvReport,
            excel: generateSuppliersExcelReport
          };
          break;
        case 'reorder-requests':
          generator = {
            pdf: generateReorderRequestsPdfReport,
            csv: generateReorderRequestsCsvReport,
            excel: generateReorderRequestsExcelReport
          };
          break;
      }
      
      // Generate the report
      switch (format) {
        case 'pdf':
          buffer = await generator.pdf(items, title);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '-').toLowerCase()}.pdf"`);
          break;
        case 'csv':
          buffer = await generator.csv(items, title);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '-').toLowerCase()}.csv"`);
          break;
        case 'excel':
          buffer = await generator.excel(items, title);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '-').toLowerCase()}.xlsx"`);
          break;
      }
      
      // Ensure buffer is a proper Buffer instance
      if (!(buffer instanceof Buffer)) {
        buffer = Buffer.from(buffer);
      }
      
      res.send(buffer);
    } catch (error) {
      console.error(`Error generating ${req.params.format} report:`, error);
      res.status(500).json({ message: `Failed to generate ${req.params.format} report` });
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
      const updatedItem = await storage.updateWarehouseInventory(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
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
      const { sourceWarehouseId, destinationWarehouseId, itemId, quantity, userId } = req.body;
      
      if (!sourceWarehouseId || !destinationWarehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      if (sourceWarehouseId === destinationWarehouseId) {
        return res.status(400).json({ message: "Source and destination warehouses must be different" });
      }
      
      const movement = await storage.transferStock(
        Number(sourceWarehouseId),
        Number(destinationWarehouseId),
        Number(itemId),
        Number(quantity),
        userId ? Number(userId) : undefined
      );
      
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
  const httpServer = createServer(app);
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
