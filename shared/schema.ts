import { pgTable, text, serial, integer, real, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User role enum
export const UserRoleEnum = pgEnum("user_role", ["admin", "manager", "warehouse_staff", "viewer"]);

// Permission Type enum - defines the type of permission
export const PermissionTypeEnum = pgEnum("permission_type", [
  "create", "read", "update", "delete", "approve", "export", "import", "assign"
]);

// Resource enum - defines resources that can have permissions
export const ResourceEnum = pgEnum("resource", [
  "inventory", "purchases", "suppliers", "categories", "warehouses", 
  "reports", "users", "settings", "reorder_requests", "stock_movements"
]);

// Permissions schema
export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  role: UserRoleEnum("role").notNull(),
  resource: ResourceEnum("resource").notNull(),
  permissionType: PermissionTypeEnum("permission_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User schema for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  fullName: text("full_name"),
  role: UserRoleEnum("role").default("viewer"),
  warehouseId: integer("warehouse_id"),
  active: boolean("active").default(true),
  lastLogin: timestamp("last_login"),
  profilePicture: text("profile_picture"),
  preferences: jsonb("preferences"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  lastLogin: true,
  profilePicture: true,
  preferences: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Category schema for organizing inventory
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
});

export const insertCategorySchema = createInsertSchema(categories).pick({
  name: true,
  description: true,
});

// Supplier schema
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Inventory item schema
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  description: text("description"),
  categoryId: integer("category_id"),
  quantity: integer("quantity").default(0).notNull(),
  price: real("price").notNull(),
  cost: real("cost"),
  lowStockThreshold: integer("low_stock_threshold").default(10),
  location: text("location"),
  supplierId: integer("supplier_id"),
  barcode: text("barcode"),
  barcodeType: text("barcode_type").default("CODE128"),
  dimensions: text("dimensions"),
  weight: real("weight"),
  unitOfMeasure: text("unit_of_measure").default("each"),
  defaultWarehouseId: integer("default_warehouse_id"),
  minOrderQuantity: integer("min_order_quantity").default(1),
  leadTime: integer("lead_time"), // In days
  reorderPoint: integer("reorder_point"),
  maxStockLevel: integer("max_stock_level"),
  taxable: boolean("taxable").default(true),
  status: text("status").default("active"),
  expiryDate: timestamp("expiry_date"),
  lastCountDate: timestamp("last_count_date"),
  images: jsonb("images"),
  tags: text("tags").array(),
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Purchase Requisition Status enum
export const purchaseRequisitionStatusEnum = pgEnum("purchase_requisition_status", [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CONVERTED"
]);

// Purchase Requisition schema
export const purchaseRequisitions = pgTable("purchase_requisitions", {
  id: serial("id").primaryKey(),
  requisitionNumber: text("requisition_number").notNull().unique(),
  requestorId: integer("requestor_id"),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  requiredDate: timestamp("required_date"),
  supplierId: integer("supplier_id"),
  totalAmount: real("total_amount").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  approverId: integer("approver_id"),
  approvalDate: timestamp("approval_date"),
  rejectionReason: text("rejection_reason"),
});

export const insertPurchaseRequisitionSchema = createInsertSchema(purchaseRequisitions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Purchase Requisition Item schema
export const purchaseRequisitionItems = pgTable("purchase_requisition_items", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").notNull(),
  itemId: integer("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  totalPrice: real("total_price").notNull(),
  notes: text("notes"),
});

export const insertPurchaseRequisitionItemSchema = createInsertSchema(purchaseRequisitionItems).omit({
  id: true,
});

// Purchase Order Status enum
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "DRAFT",
  "SENT",
  "ACKNOWLEDGED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
  "COMPLETED"
]);

// Purchase Order schema
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  supplierId: integer("supplier_id").notNull(),
  requisitionId: integer("requisition_id"),
  status: text("status").notNull().default("DRAFT"),
  orderDate: timestamp("order_date").defaultNow().notNull(),
  expectedDeliveryDate: timestamp("expected_delivery_date"),
  deliveryAddress: text("delivery_address"),
  totalAmount: real("total_amount").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  paymentStatus: text("payment_status").default("UNPAID"),
  paymentDate: timestamp("payment_date"),
  paymentReference: text("payment_reference"),
  emailSent: boolean("email_sent").default(false),
  emailSentDate: timestamp("email_sent_date"),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Purchase Order Item schema
export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  itemId: integer("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  totalPrice: real("total_price").notNull(),
  receivedQuantity: integer("received_quantity").default(0),
  notes: text("notes"),
});

export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItems).omit({
  id: true,
});

// Activity log schema for tracking changes
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  itemId: integer("item_id"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: integer("user_id"),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  timestamp: true,
});

// Custom zod schemas for validation
export const inventoryItemFormSchema = insertInventoryItemSchema.extend({
  name: z.string().min(3, "Name must be at least 3 characters"),
  sku: z.string().min(2, "SKU must be at least 2 characters"),
  quantity: z.coerce.number().int().min(0, "Quantity must be a positive number"),
  price: z.coerce.number().min(0, "Price must be a positive number"),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  barcode: z.string().optional(),
  barcodeType: z.enum(["CODE128", "EAN13", "EAN8", "UPC", "QR", "DATAMATRIX"]).optional(),
  dimensions: z.string().optional(),
  weight: z.coerce.number().min(0).optional(),
  unitOfMeasure: z.string().optional(),
  defaultWarehouseId: z.coerce.number().int().optional(),
  minOrderQuantity: z.coerce.number().int().min(1).optional(),
  leadTime: z.coerce.number().int().min(0).optional(),
  reorderPoint: z.coerce.number().int().min(0).optional(),
  maxStockLevel: z.coerce.number().int().min(0).optional(),
  taxable: z.boolean().optional(),
  status: z.enum(["active", "inactive", "discontinued"]).default("active").optional(),
  tags: z.array(z.string()).optional(),
  images: z.any().optional(),
  customFields: z.any().optional(),
});

export const supplierFormSchema = insertSupplierSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().nullable(),
  phone: z.string().optional().nullable(),
});

export const purchaseRequisitionFormSchema = insertPurchaseRequisitionSchema.extend({
  supplierId: z.number().optional(),
  items: z.array(
    z.object({
      itemId: z.number(),
      quantity: z.number().int().min(1, "Quantity must be at least 1"),
      unitPrice: z.number().min(0, "Unit price must be a positive number"),
      notes: z.string().optional(),
    })
  ),
});

export const purchaseOrderFormSchema = insertPurchaseOrderSchema.extend({
  supplierId: z.number(),
  items: z.array(
    z.object({
      itemId: z.number(),
      quantity: z.number().int().min(1, "Quantity must be at least 1"),
      unitPrice: z.number().min(0, "Unit price must be a positive number"),
      notes: z.string().optional(),
    })
  ),
});

// Bulk import schema for inventory items
export const bulkImportInventorySchema = z.array(
  z.object({
    sku: z.string().min(2, "SKU must be at least 2 characters"),
    name: z.string().min(3, "Name must be at least 3 characters"),
    description: z.string().optional(),
    category: z.string().optional(),
    quantity: z.number().int().min(0, "Quantity must be a positive number"),
    price: z.number().min(0, "Price must be a positive number"),
    cost: z.number().optional(),
    lowStockThreshold: z.number().int().min(0).optional(),
    location: z.string().optional(),
    supplier: z.string().optional(),
  })
);

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

// Role-based permissions
export enum UserRole {
  ADMIN = "admin",
  MANAGER = "manager",
  WAREHOUSE_STAFF = "warehouse_staff",
  VIEWER = "viewer"
}

export enum PermissionType {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
  APPROVE = "approve",
  EXPORT = "export",
  IMPORT = "import",
  ASSIGN = "assign"
}

export enum Resource {
  INVENTORY = "inventory",
  PURCHASES = "purchases",
  SUPPLIERS = "suppliers",
  CATEGORIES = "categories",
  WAREHOUSES = "warehouses",
  REPORTS = "reports",
  USERS = "users",
  SETTINGS = "settings",
  REORDER_REQUESTS = "reorder_requests",
  STOCK_MOVEMENTS = "stock_movements"
}

export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItemForm = z.infer<typeof inventoryItemFormSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type SupplierForm = z.infer<typeof supplierFormSchema>;

export type PurchaseRequisition = typeof purchaseRequisitions.$inferSelect;
export type InsertPurchaseRequisition = z.infer<typeof insertPurchaseRequisitionSchema>;
export type PurchaseRequisitionForm = z.infer<typeof purchaseRequisitionFormSchema>;

export type PurchaseRequisitionItem = typeof purchaseRequisitionItems.$inferSelect;
export type InsertPurchaseRequisitionItem = z.infer<typeof insertPurchaseRequisitionItemSchema>;

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrderForm = z.infer<typeof purchaseOrderFormSchema>;

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type InsertPurchaseOrderItem = z.infer<typeof insertPurchaseOrderItemSchema>;

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

export type BulkImportInventory = z.infer<typeof bulkImportInventorySchema>;

// Inventory stats type for dashboard
export type InventoryStats = {
  totalItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  inventoryValue: number;
};

// Item status types for UI
export enum ItemStatus {
  IN_STOCK = "In Stock",
  LOW_STOCK = "Low Stock",
  OUT_OF_STOCK = "Out of Stock"
}

// Export types for document generation
export type DocumentType = "pdf" | "csv" | "excel";
export type ReportType = "inventory" | "low-stock" | "value" | "purchase-orders" | "purchase-requisitions" | "suppliers" | "reorder-requests";

// Purchase Requisition Status
export enum PurchaseRequisitionStatus {
  DRAFT = "DRAFT",
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  CONVERTED = "CONVERTED"
}

// Purchase Order Status
export enum PurchaseOrderStatus {
  DRAFT = "DRAFT",
  SENT = "SENT",
  ACKNOWLEDGED = "ACKNOWLEDGED",
  PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED",
  RECEIVED = "RECEIVED",
  CANCELLED = "CANCELLED",
  COMPLETED = "COMPLETED"
}

// Payment Status
export enum PaymentStatus {
  UNPAID = "UNPAID",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  PAID = "PAID"
}

// Reorder Request schema
export const reorderRequests = pgTable("reorder_requests", {
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull().unique(),
  itemId: integer("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  supplierId: integer("supplier_id"), // Added for auto-reordering
  warehouseId: integer("warehouse_id"), // Added to track which warehouse needs the reorder
  requestorId: integer("requestor_id"),
  approverId: integer("approver_id"),
  status: text("status").notNull().default("PENDING"),
  notes: text("notes"),
  isAutoGenerated: boolean("is_auto_generated").default(false), // Flag for auto-generated requests
  requestDate: timestamp("request_date"), // When the request was made
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  approvalDate: timestamp("approval_date"),
  rejectionReason: text("rejection_reason"),
  convertedToRequisition: boolean("converted_to_requisition").default(false),
  requisitionId: integer("requisition_id")
});

export const insertReorderRequestSchema = createInsertSchema(reorderRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvalDate: true,
}).partial({
  requestNumber: true,
  supplierId: true,
  warehouseId: true,
  isAutoGenerated: true,
  requestDate: true,
});

export const reorderRequestFormSchema = insertReorderRequestSchema.extend({
  itemId: z.number().int().positive("Item ID must be a positive number"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  supplierId: z.number().int().positive("Supplier ID must be a positive number").optional(),
  warehouseId: z.number().int().positive("Warehouse ID must be a positive number").optional(),
});

// App Settings schema
export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull().default("InvTrack"),
  companyLogo: text("company_logo"),
  primaryColor: text("primary_color").default("#0F172A"),
  dateFormat: text("date_format").default("YYYY-MM-DD"),
  timeFormat: text("time_format").default("HH:mm"),
  currencySymbol: text("currency_symbol").default("$"),
  // Inventory settings
  lowStockDefaultThreshold: integer("low_stock_default_threshold").default(10),
  allowNegativeInventory: boolean("allow_negative_inventory").default(false),
  // Real-time inventory settings
  realTimeUpdatesEnabled: boolean("real_time_updates_enabled").default(true),
  lowStockAlertFrequency: integer("low_stock_alert_frequency").default(30), // Minutes between alerts
  autoReorderEnabled: boolean("auto_reorder_enabled").default(false),
  // Forecasting settings
  forecastingEnabled: boolean("forecasting_enabled").default(true),
  forecastDays: integer("forecast_days").default(30),
  seasonalAdjustmentEnabled: boolean("seasonal_adjustment_enabled").default(true),
  // Warehouse settings
  defaultWarehouseId: integer("default_warehouse_id"),
  requireLocationForItems: boolean("require_location_for_items").default(false),
  allowTransfersBetweenWarehouses: boolean("allow_transfers_between_warehouses").default(true),
  // Tax settings
  enableVat: boolean("enable_vat").default(false),
  defaultVatCountry: text("default_vat_country").default("US"),
  showPricesWithVat: boolean("show_prices_with_vat").default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
  updatedAt: true
});

export const appSettingsFormSchema = insertAppSettingsSchema.extend({
  companyName: z.string().min(2, "Company name must be at least 2 characters"),
  companyLogo: z.string().optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, "Must be a valid hex color"),
});

// Supplier Logo schema to store supplier logos
export const supplierLogos = pgTable("supplier_logos", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().unique(),
  logoUrl: text("logo_url").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const insertSupplierLogoSchema = createInsertSchema(supplierLogos).omit({
  id: true,
  updatedAt: true
});

// VAT Rate schema for different countries
export const vatRates = pgTable("vat_rates", {
  id: serial("id").primaryKey(),
  countryCode: text("country_code").notNull().unique(),
  countryName: text("country_name").notNull(),
  standardRate: real("standard_rate").notNull(),
  reducedRate: real("reduced_rate"),
  superReducedRate: real("super_reduced_rate"),
  active: boolean("active").default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const insertVatRateSchema = createInsertSchema(vatRates).omit({
  id: true,
  updatedAt: true
});

export const vatRateFormSchema = insertVatRateSchema.extend({
  countryCode: z.string().min(2, "Country code must be at least 2 characters"),
  countryName: z.string().min(2, "Country name must be at least 2 characters"),
  standardRate: z.number().min(0, "Rate must be a positive number").max(100, "Rate cannot exceed 100%"),
});

// App settings extension for VAT
export const appSettingsFormSchemaWithVat = appSettingsFormSchema.extend({
  // Inventory settings
  lowStockDefaultThreshold: z.number().int().min(1, "Threshold must be at least 1"),
  allowNegativeInventory: z.boolean(),
  
  // Real-time inventory settings
  realTimeUpdatesEnabled: z.boolean(),
  lowStockAlertFrequency: z.number().int().min(1, "Alert frequency must be at least 1 minute"),
  autoReorderEnabled: z.boolean(),
  
  // Forecasting settings
  forecastingEnabled: z.boolean(),
  forecastDays: z.number().int().min(1, "Forecast period must be at least 1 day").max(365, "Forecast period cannot exceed 365 days"),
  seasonalAdjustmentEnabled: z.boolean(),
  
  // Warehouse settings
  defaultWarehouseId: z.number().int().positive().optional().nullable(),
  requireLocationForItems: z.boolean(),
  allowTransfersBetweenWarehouses: z.boolean(),
  
  // Tax settings
  enableVat: z.boolean().default(false),
  defaultVatCountry: z.string().min(2, "Default country code must be valid").optional(),
  showPricesWithVat: z.boolean().default(true),
});

// Types for settings
export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettingsForm = z.infer<typeof appSettingsFormSchema>;
export type AppSettingsFormWithVat = z.infer<typeof appSettingsFormSchemaWithVat>;

export type VatRate = typeof vatRates.$inferSelect;
export type InsertVatRate = z.infer<typeof insertVatRateSchema>;
export type VatRateForm = z.infer<typeof vatRateFormSchema>;

export type SupplierLogo = typeof supplierLogos.$inferSelect;
export type InsertSupplierLogo = z.infer<typeof insertSupplierLogoSchema>;

// Warehouse schema for multi-warehouse management
export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  address: text("address"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWarehouseSchema = createInsertSchema(warehouses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const warehouseFormSchema = insertWarehouseSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

// Stock Movement Types enum
export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "PURCHASE", 
  "SALE", 
  "ADJUSTMENT", 
  "TRANSFER", 
  "RETURN", 
  "DAMAGE", 
  "EXPIRE", 
  "RECOUNT",
  "RECEIPT",
  "ISSUE"
]);

// Stock movements schema for tracking inventory changes
export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  warehouseId: integer("warehouse_id"),
  type: stockMovementTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"),
  notes: text("notes"),
  userId: integer("user_id"),
  previousQuantity: integer("previous_quantity"),
  newQuantity: integer("new_quantity"),
  unitCost: real("unit_cost"),
  sourceWarehouseId: integer("source_warehouse_id"),
  destinationWarehouseId: integer("destination_warehouse_id"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStockMovementSchema = createInsertSchema(stockMovements).omit({
  id: true,
  createdAt: true,
});

export const stockMovementFormSchema = insertStockMovementSchema.extend({
  itemId: z.number().int().positive("Item ID must be positive"),
  quantity: z.number().int().min(1, "Quantity must be at least 1").or(z.number().int().max(-1, "Quantity must be at most -1")),
  type: z.enum(["PURCHASE", "SALE", "ADJUSTMENT", "TRANSFER", "RETURN", "DAMAGE", "EXPIRE", "RECOUNT", "RECEIPT", "ISSUE"]),
});

// Warehouse Inventory schema for tracking inventory per warehouse
export const warehouseInventory = pgTable("warehouse_inventory", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  warehouseId: integer("warehouse_id").notNull(),
  quantity: integer("quantity").default(0).notNull(),
  location: text("location"),
  aisle: text("aisle"),
  bin: text("bin"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWarehouseInventorySchema = createInsertSchema(warehouseInventory).omit({
  id: true,
  updatedAt: true,
});

// Barcode schema for product identification
export const barcodes = pgTable("barcodes", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  type: text("type").default("CODE128"),
  value: text("value").notNull().unique(),
  isPrimary: boolean("is_primary").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBarcodeSchema = createInsertSchema(barcodes).omit({
  id: true,
  createdAt: true,
});

export const barcodeFormSchema = insertBarcodeSchema.extend({
  value: z.string().min(1, "Barcode value is required"),
  type: z.enum(["CODE128", "EAN13", "EAN8", "UPC", "QR", "DATAMATRIX"]),
});

// AI prediction settings
export const demandForecasts = pgTable("demand_forecasts", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  forecastedDemand: real("forecasted_demand").notNull(),
  confidenceLevel: real("confidence_level"),
  forecastPeriod: text("forecast_period").notNull(), // daily, weekly, monthly
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  algorithmUsed: text("algorithm_used"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDemandForecastSchema = createInsertSchema(demandForecasts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Integration schema for external systems
export const externalIntegrations = pgTable("external_integrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // accounting, ecommerce, erp, pos
  apiKey: text("api_key"),
  configData: jsonb("config_data"),
  isActive: boolean("is_active").default(true),
  lastSyncTime: timestamp("last_sync_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertExternalIntegrationSchema = createInsertSchema(externalIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Audit log for security tracking
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

// User preferences for dashboard customization
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  dashboardLayout: jsonb("dashboard_layout"),
  notifications: jsonb("notifications"),
  theme: text("theme").default("light"),
  language: text("language").default("en"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  updatedAt: true,
});

// Export types for new schemas
export type Warehouse = typeof warehouses.$inferSelect;
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type WarehouseForm = z.infer<typeof warehouseFormSchema>;

export type StockMovement = typeof stockMovements.$inferSelect;
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovementForm = z.infer<typeof stockMovementFormSchema>;

export type WarehouseInventory = typeof warehouseInventory.$inferSelect;
export type InsertWarehouseInventory = z.infer<typeof insertWarehouseInventorySchema>;

export type Barcode = typeof barcodes.$inferSelect;
export type InsertBarcode = z.infer<typeof insertBarcodeSchema>;
export type BarcodeForm = z.infer<typeof barcodeFormSchema>;

export type DemandForecast = typeof demandForecasts.$inferSelect;
export type InsertDemandForecast = z.infer<typeof insertDemandForecastSchema>;

export type ExternalIntegration = typeof externalIntegrations.$inferSelect;
export type InsertExternalIntegration = z.infer<typeof insertExternalIntegrationSchema>;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = z.infer<typeof insertUserPreferencesSchema>;

// Reorder Request Types
export type ReorderRequest = typeof reorderRequests.$inferSelect;
export type InsertReorderRequest = z.infer<typeof insertReorderRequestSchema>;
export type ReorderRequestForm = z.infer<typeof reorderRequestFormSchema>;

// Reorder Request Status Enum
export enum ReorderRequestStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  CONVERTED = "CONVERTED"
}
