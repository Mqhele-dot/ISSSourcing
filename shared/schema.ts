import {
  pgTable,
  text,
  serial,
  integer,
  real,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Report types enum
export const reportTypeEnum = [
  'inventory',
  'categories',
  'suppliers',
  'warehouses',
  'stock_movements',
  'users',
  'reorder_requests',
  'purchase_orders',
  'purchase_requisitions',
  'activity_logs',
  'invoices',
  'shipments',
] as const;

export type ReportType = typeof reportTypeEnum[number];

// Report formats enum
export const reportFormatEnum = ['pdf', 'csv', 'excel', 'docx'] as const;
export type ReportFormat = typeof reportFormatEnum[number];

// User role enum with expanded roles
export const userRoleEnum = pgEnum("user_role", [
  "admin",            // Full access to all features
  "manager",          // Approvals, reports, supplier management
  "planner",          // Procurement planning, PO approve/send (operational workflow)
  "warehouse_staff",  // Stock updates, scanning, inventory requests
  "sales",            // View inventory, create orders
  "auditor",          // Read-only access to inventory history and reports
  "supplier",         // View purchase orders, update delivery status
  "custom",           // For user-defined custom roles
  "viewer"            // Basic view access (legacy/default)
]);

// Permission Type enum - defines the type of permission
export const permissionTypeEnum = pgEnum("permission_type", [
  "create", "read", "update", "delete", "approve", "export", "import", "assign",
  "manage", "execute", "transfer", "print", "scan", "view_reports", "admin", 
  "configure", "restrict", "download", "upload", "audit", "verify"
]);

// Resource enum - defines resources that can have permissions
export const resourceEnum = pgEnum("resource", [
  "inventory", "purchases", "suppliers", "categories", "warehouses", 
  "reports", "users", "settings", "reorder_requests", "stock_movements",
  "analytics", "dashboards", "notifications", "audit_logs", "user_profiles",
  "documents", "custom_roles", "activity_logs", "import_export", "system"
]);

// Permissions schema
export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  role: userRoleEnum("role").notNull(),
  resource: resourceEnum("resource").notNull(),
  permissionType: permissionTypeEnum("permission_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Multi-tenant root: all operational data is scoped to an organization. */
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Per-organization branding, plan, and feature flags (Phase 4 selling readiness). */
export const organizationSettings = pgTable("organization_settings", {
  organizationId: integer("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  logoUrl: text("logo_url"),
  reportFooter: text("report_footer"),
  planTier: text("plan_tier").default("standard"),
  featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User schema for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  role: userRoleEnum("role").default("viewer"),
  warehouseId: integer("warehouse_id"),
  /** When role is `supplier`, scopes portal APIs to this supplier PK */
  supplierId: integer("supplier_id"),
  /** Max requisition total (same currency as requisition) this user may approve; null = no extra cap */
  approverAmountLimit: real("approver_amount_limit"),
  /** E.164 or local digits; used for optional SMS notification mirror */
  phone: text("phone"),
  /**
   * Persona label for UX/RBAC docs (Requester, Buyer, Approver, Inventory, Logistics, Finance).
   * Does not replace `role`; use with coarse `user_role` enum.
   */
  workPersona: text("work_persona"),
  active: boolean("active").default(true),
  emailVerified: boolean("email_verified").default(false),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  accountLocked: boolean("account_locked").default(false),
  lockoutUntil: timestamp("lockout_until"),
  lastLogin: timestamp("last_login"),
  lastPasswordChange: timestamp("last_password_change"),
  profilePicture: text("profile_picture"),
  preferences: jsonb("preferences"),
  /** Default org for new sessions; resolved with organization_members. */
  defaultOrganizationId: integer("default_organization_id").references(() => organizations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Links users to organizations with a membership role. */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("organization_members_org_user_uidx").on(t.organizationId, t.userId)],
);

// User verification token schema
export const userVerificationTokens = pgTable("user_verification_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull(),
  type: text("type").notNull(), // 'email', 'password-reset', etc.
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  used: boolean("used").default(false),
});

// Session schema for managing user sessions
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastActivity: timestamp("last_activity").defaultNow().notNull(),
  isValid: boolean("is_valid").default(true),
  /** Active org for this session (multi-tenant). */
  activeOrganizationId: integer("active_organization_id").references(() => organizations.id),
});

export const insertUserSchema = createInsertSchema(users)
  .omit({
    id: true,
    defaultOrganizationId: true,
    emailVerified: true,
    twoFactorEnabled: true,
    twoFactorSecret: true,
    failedLoginAttempts: true,
    accountLocked: true,
    lockoutUntil: true,
    profilePicture: true,
    preferences: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    passwordResetToken: z.string().nullable().optional(),
    passwordResetExpires: z.date().nullable().optional(),
    lastLogin: z.date().nullable().optional(),
    lastPasswordChange: z.date().nullable().optional(),
  });

// User registration form schema with validation
export const userRegistrationSchema = insertUserSchema.extend({
  username: z.string().min(4, "Username must be at least 4 characters").max(50, "Username cannot exceed 50 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  confirmPassword: z.string(),
  fullName: z.string().min(2, "Full name must be at least 2 characters").max(100, "Full name cannot exceed 100 characters"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

// User login schema
export const userLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false),
});

// User password change schema
export const userPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  confirmNewPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"]
});

// Password reset request schema
export const passwordResetRequestSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

// Password reset schema
export const passwordResetSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  confirmNewPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"]
});

// Two-factor authentication setup schema
export const twoFactorSetupSchema = z.object({
  totpCode: z.string().min(6, "TOTP code must be at least 6 digits").max(6, "TOTP code cannot exceed 6 digits"),
});

// Two-factor authentication verification schema
export const twoFactorVerificationSchema = z.object({
  totpCode: z.string().min(6, "TOTP code must be at least 6 digits").max(6, "TOTP code cannot exceed 6 digits"),
});

export const insertVerificationTokenSchema = createInsertSchema(userVerificationTokens).omit({
  id: true,
  createdAt: true,
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  createdAt: true,
  lastActivity: true,
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Category schema for organizing inventory
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("categories_org_name_uidx").on(t.organizationId, t.name)],
);

export const insertCategorySchema = createInsertSchema(categories).pick({
  name: true,
  description: true,
});

// Master data tables used across procurement and finance
export const unitsOfMeasure = pgTable("units_of_measure", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  symbol: text("symbol"),
  baseUnitId: integer("base_unit_id"),
  system: text("system").default("custom"), // metric, imperial, custom
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const currencies = pgTable("currencies", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimalPlaces: integer("decimal_places").default(2).notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const taxCodes = pgTable("tax_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  rate: real("rate").notNull().default(0),
  type: text("type").notNull().default("vat"), // vat, sales, withholding
  countryCode: text("country_code"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const commodityCodes = pgTable("commodity_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  description: text("description"),
  category: text("category"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const incoterms = pgTable("incoterms", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const paymentTerms = pgTable("payment_terms", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  netDays: integer("net_days").default(30).notNull(),
  discountDays: integer("discount_days"),
  discountPercent: real("discount_percent"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const departments = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    costCenterId: text("cost_center_id"),
    active: boolean("active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("departments_org_code_uidx").on(t.organizationId, t.code)],
);

export const carriers = pgTable(
  "carriers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    contact: text("contact"),
    active: boolean("active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("carriers_org_code_uidx").on(t.organizationId, t.code)],
);

export const insertUnitOfMeasureSchema = createInsertSchema(unitsOfMeasure).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCurrencySchema = createInsertSchema(currencies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertTaxCodeSchema = createInsertSchema(taxCodes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommodityCodeSchema = createInsertSchema(commodityCodes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertIncotermSchema = createInsertSchema(incoterms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPaymentTermSchema = createInsertSchema(paymentTerms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDepartmentSchema = createInsertSchema(departments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCarrierSchema = createInsertSchema(carriers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Supplier schema
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  taxIdentificationNumber: text("tax_identification_number"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankSwift: text("bank_swift"),
  paymentTermsId: integer("payment_terms_id"),
  defaultCurrencyCode: text("default_currency_code"),
  insuranceExpiry: timestamp("insurance_expiry"),
  complianceNotes: text("compliance_notes"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Supplier contract schema - manage contracts with each supplier
export const supplierContracts = pgTable("supplier_contracts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  supplierId: integer("supplier_id").notNull(),
  title: text("title").notNull(),
  contractType: text("contract_type").notNull().default("master"), // master, framework, one-off, renewal
  referenceNumber: text("reference_number"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  value: real("value"),
  currency: text("currency").default("USD"),
  summary: text("summary"),
  status: text("status").notNull().default("active"), // draft, active, expired, terminated
  notes: text("notes"),
  attachments: jsonb("attachments").$type<{ name: string; url: string }[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierContractSchema = createInsertSchema(supplierContracts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const supplierContractFormSchema = insertSupplierContractSchema.extend({
  title: z.string().min(2, "Title must be at least 2 characters"),
  supplierId: z.number().int().positive("Supplier is required"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  value: z.number().min(0).nullable().optional(),
  contractType: z.enum(["master", "framework", "one-off", "renewal"]).default("master"),
  status: z.enum(["draft", "active", "expired", "terminated"]).default("active"),
}).refine(
  (data) => !data.endDate || !data.startDate || new Date(data.endDate) >= new Date(data.startDate),
  { message: "End date must be on or after start date", path: ["endDate"] }
);

// Inventory item schema
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
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
    supplierPartNumber: text("supplier_part_number"),
    commodityCodeId: integer("commodity_code_id"),
    defaultWarehouseId: integer("default_warehouse_id"),
    minOrderQuantity: integer("min_order_quantity").default(1),
    leadTime: integer("lead_time"), // In days
    reorderPoint: integer("reorder_point"),
    maxStockLevel: integer("max_stock_level"),
    taxable: boolean("taxable").default(true),
    status: text("status").default("active"),
    expiryDate: timestamp("expiry_date"),
    manufacturingDate: timestamp("manufacturing_date"),
    lastCountDate: timestamp("last_count_date"),
    images: jsonb("images"),
    tags: text("tags").array(),
    customFields: jsonb("custom_fields"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("inventory_items_org_sku_uidx").on(t.organizationId, t.sku)],
);

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
export const purchaseRequisitions = pgTable(
  "purchase_requisitions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    requisitionNumber: text("requisition_number").notNull(),
    requestorId: integer("requestor_id"),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  requiredDate: timestamp("required_date"),
  departmentId: integer("department_id"),
  justification: text("justification"),
  supplierId: integer("supplier_id"),
  totalAmount: real("total_amount").notNull().default(0),
  sharedWithUserIds: jsonb("shared_with_user_ids").$type<number[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  approverId: integer("approver_id"),
    approvalDate: timestamp("approval_date"),
    rejectionReason: text("rejection_reason"),
    /** Optional construction / project tag (extensions demo); validated in API against `projects`. */
    projectId: integer("project_id"),
  },
  (t) => [uniqueIndex("purchase_req_org_number_uidx").on(t.organizationId, t.requisitionNumber)],
);

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
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    orderNumber: text("order_number").notNull(),
    supplierId: integer("supplier_id").notNull(),
  requisitionId: integer("requisition_id"),
  departmentId: integer("department_id"),
  contractId: integer("contract_id"),
  paymentTermsId: integer("payment_terms_id"),
  incotermId: integer("incoterm_id"),
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
    /** Optional construction / project tag (extensions demo); validated in API against `projects`. */
    projectId: integer("project_id"),
  },
  (t) => [uniqueIndex("purchase_orders_org_number_uidx").on(t.organizationId, t.orderNumber)],
);

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

export const approvalPolicies = pgTable("approval_policies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  name: text("name").notNull(),
  entityType: text("entity_type").notNull(), // requisition, purchase_order
  amountMin: real("amount_min").notNull().default(0),
  amountMax: real("amount_max"),
  approvalLevel: integer("approval_level").notNull().default(1),
  approverRole: text("approver_role"),
  approverUserId: integer("approver_user_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const approvalHistory = pgTable("approval_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  entityType: text("entity_type").notNull(), // requisition, purchase_order
  entityId: integer("entity_id").notNull(),
  level: integer("level").notNull().default(1),
  action: text("action").notNull(), // submitted, approved, rejected, returned
  performedBy: integer("performed_by").notNull(),
  comment: text("comment"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  performedAt: timestamp("performed_at").defaultNow().notNull(),
});

export const purchaseOrderRevisions = pgTable("purchase_order_revisions", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Activity log schema for tracking changes
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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

export const insertApprovalPolicySchema = createInsertSchema(approvalPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertApprovalHistorySchema = createInsertSchema(approvalHistory).omit({
  id: true,
  performedAt: true,
});
export const insertPurchaseOrderRevisionSchema = createInsertSchema(purchaseOrderRevisions).omit({
  id: true,
  createdAt: true,
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

// Role-based permissions and enums
export enum UserRoleEnum {
  ADMIN = "admin",
  MANAGER = "manager",
  WAREHOUSE_STAFF = "warehouse_staff",
  SALES = "sales",
  AUDITOR = "auditor",
  SUPPLIER = "supplier",
  CUSTOM = "custom",
  VIEWER = "viewer"
}

export enum PermissionTypeEnum {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
  APPROVE = "approve",
  EXPORT = "export",
  IMPORT = "import",
  ASSIGN = "assign"
}

export enum ResourceEnum {
  INVENTORY = "inventory",
  PURCHASES = "purchases",
  SUPPLIERS = "suppliers",
  CATEGORIES = "categories",
  WAREHOUSES = "warehouses",
  REPORTS = "reports",
  USERS = "users",
  SETTINGS = "settings",
  REORDER_REQUESTS = "reorder_requests",
  STOCK_MOVEMENTS = "stock_movements",
  INVOICES = "invoices",
  BILLING = "billing",
  TAXES = "taxes",
  PAYMENTS = "payments"
}

// Types
export type UserRoleString = keyof typeof UserRoleEnum;
export type UserRole = UserRoleString;
export type Resource = keyof typeof ResourceEnum;
export type PermissionType = keyof typeof PermissionTypeEnum;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserVerificationToken = typeof userVerificationTokens.$inferSelect;
export type InsertUserVerificationToken = z.infer<typeof insertVerificationTokenSchema>;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

// Auth schemas types
export type UserRegistration = z.infer<typeof userRegistrationSchema>;
export type UserLogin = z.infer<typeof userLoginSchema>;
export type UserPasswordChange = z.infer<typeof userPasswordChangeSchema>;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;
export type PasswordReset = z.infer<typeof passwordResetSchema>;
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;
export type TwoFactorVerification = z.infer<typeof twoFactorVerificationSchema>;

// Note: Enums already defined above

export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;

export type UnitOfMeasure = typeof unitsOfMeasure.$inferSelect;
export type InsertUnitOfMeasure = z.infer<typeof insertUnitOfMeasureSchema>;
export type Currency = typeof currencies.$inferSelect;
export type InsertCurrency = z.infer<typeof insertCurrencySchema>;
export type TaxCode = typeof taxCodes.$inferSelect;
export type InsertTaxCode = z.infer<typeof insertTaxCodeSchema>;
export type CommodityCode = typeof commodityCodes.$inferSelect;
export type InsertCommodityCode = z.infer<typeof insertCommodityCodeSchema>;
export type Incoterm = typeof incoterms.$inferSelect;
export type InsertIncoterm = z.infer<typeof insertIncotermSchema>;
export type PaymentTerm = typeof paymentTerms.$inferSelect;
export type InsertPaymentTerm = z.infer<typeof insertPaymentTermSchema>;
export type Department = typeof departments.$inferSelect;
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItemForm = z.infer<typeof inventoryItemFormSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type SupplierForm = z.infer<typeof supplierFormSchema>;

export type SupplierContract = typeof supplierContracts.$inferSelect;
export type InsertSupplierContract = z.infer<typeof insertSupplierContractSchema>;
export type SupplierContractForm = z.infer<typeof supplierContractFormSchema>;

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

/** Optional GRN metadata for `POST /api/purchase-order-items/:id/receive` (receiver / put-away hints). */
export type PurchaseOrderItemReceiveMeta = {
  receiverUserId?: number | null;
  receiverName?: string | null;
  warehouseLocation?: string | null;
  receivedAt?: string | null;
};

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ApprovalPolicy = typeof approvalPolicies.$inferSelect;
export type InsertApprovalPolicy = z.infer<typeof insertApprovalPolicySchema>;
export type ApprovalHistory = typeof approvalHistory.$inferSelect;
export type InsertApprovalHistory = z.infer<typeof insertApprovalHistorySchema>;
export type PurchaseOrderRevision = typeof purchaseOrderRevisions.$inferSelect;
export type InsertPurchaseOrderRevision = z.infer<typeof insertPurchaseOrderRevisionSchema>;

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
export type DocumentType = "pdf" | "csv" | "excel" | "docx";
// ReportType is already defined at the top of the file

// Report filter interface for customizable report filtering
export interface ReportFilter {
  startDate?: Date;
  endDate?: Date;
  categoryId?: number;
  warehouseId?: number;
  supplierId?: number;
  /** Filter PO / requisition exports by project (construction extensions). */
  projectId?: number;
  status?: string;
  tags?: string[];
  search?: string;
  /** Shipment list export: partial PO number (matches logistics filters). */
  shipmentPo?: string;
  shipmentCarrier?: string;
  shipmentRisk?: string;
}

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
export const reorderRequests = pgTable(
  "reorder_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    requestNumber: text("request_number").notNull(),
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
    requisitionId: integer("requisition_id"),
  },
  (t) => [uniqueIndex("reorder_requests_org_reqnum_uidx").on(t.organizationId, t.requestNumber)],
);

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

// App Settings schema (one logical row per organization)
export const appSettings = pgTable(
  "app_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    companyName: text("company_name").notNull().default("InvTrack"),
  companyLogo: text("company_logo"),
  primaryColor: text("primary_color").default("#0F172A"),
  dateFormat: text("date_format").default("YYYY-MM-DD"),
  timeFormat: text("time_format").default("HH:mm"),
  currencySymbol: text("currency_symbol").default("$"),
  /** ISO 4217 code for Intl currency formatting and reporting (e.g. USD, EUR). */
  currencyCode: text("currency_code").notNull().default("USD"),
  // Inventory settings
  lowStockDefaultThreshold: integer("low_stock_default_threshold").default(10),
  allowNegativeInventory: boolean("allow_negative_inventory").default(false),
  // Units of measure settings
  availableUnits: jsonb("available_units").default(["each", "kg", "liters", "boxes", "pieces", "meters", "pairs", "sets"]),
  defaultUnit: text("default_unit").default("each"),
  // Item categories settings
  enableCustomTags: boolean("enable_custom_tags").default(true),
  defaultTags: jsonb("default_tags").default(["featured", "seasonal", "sale", "new", "discontinued"]),
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
  /** ISO 3166-1 alpha-2 country for business locale (reporting, tax hints). */
  businessCountryCode: text("business_country_code").default("US"),
  /**
   * Product tax posture: `none` (no VAT), `vat` (enableVat true), `us_sales_tax` (US-style, VAT off).
   * Kept in sync with enableVat/defaultVatCountry when possible.
   */
  taxMode: text("tax_mode").notNull().default("none"),
  /** First-run product onboarding: null until an admin completes the setup wizard. */
  productOnboardingCompletedAt: timestamp("product_onboarding_completed_at"),
  /** Wizard checkpoint JSON for interrupted onboarding (step id + draft fields). */
  productOnboardingState: jsonb("product_onboarding_state"),
  // Database settings (for Electron app)
    databaseSettings: jsonb("database_settings"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("app_settings_org_uidx").on(t.organizationId)],
);

export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
  updatedAt: true
});

export const appSettingsFormSchema = insertAppSettingsSchema.extend({
  companyName: z.string().min(2, "Company name must be at least 2 characters"),
  companyLogo: z.string().optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, "Must be a valid hex color"),
  currencyCode: z
    .string()
    .length(3, "Use a 3-letter ISO 4217 code")
    .regex(/^[A-Za-z]{3}$/, "Invalid currency code")
    .transform((s) => s.toUpperCase()),
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
  
  // Units of measure settings
  availableUnits: z.array(z.string()).min(1, "At least one unit of measure must be defined"),
  defaultUnit: z.string().min(1, "Default unit must be specified"),
  
  // Item categories settings
  enableCustomTags: z.boolean(),
  defaultTags: z.array(z.string()).optional(),
  
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
  
  // Database settings (for Electron app)
  databaseSettings: z.object({
    host: z.string().optional(),
    port: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    database: z.string().optional(),
    autoConnect: z.boolean().optional().default(true),
    useLocalDB: z.boolean().optional().default(true)
  }).optional(),
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
export const warehouses = pgTable(
  "warehouses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    name: text("name").notNull(),
  location: text("location"),
  address: text("address"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  isDefault: boolean("is_default").default(false),
  // Detailed location info: aisles, bins, storage locations
  aisle: text("aisle"),
  aisles: jsonb("aisles").$type<string[]>().default([]),
  bins: jsonb("bins").$type<{ code: string; aisle?: string; row?: string; shelf?: string }[]>().default([]),
  locationDetails: jsonb("location_details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("warehouses_org_name_uidx").on(t.organizationId, t.name)],
);

export const insertWarehouseSchema = createInsertSchema(warehouses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const warehouseFormSchema = insertWarehouseSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
  aisle: z.string().optional().nullable(),
  aisles: z.array(z.string()).optional().nullable(),
  bins: z.array(z.object({
    code: z.string(),
    aisle: z.string().optional(),
    row: z.string().optional(),
    shelf: z.string().optional(),
  })).optional().nullable(),
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
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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
  receiverUserId: integer("receiver_user_id"),
  receiverName: text("receiver_name"),
  warehouseLocation: text("warehouse_location"),
  receivedAt: timestamp("received_at"),
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
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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

export const inventoryBatches = pgTable("inventory_batches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  itemId: integer("item_id").notNull(),
  warehouseId: integer("warehouse_id"),
  batchNumber: text("batch_number").notNull(),
  manufacturingDate: timestamp("manufacturing_date"),
  expiryDate: timestamp("expiry_date"),
  quantityReceived: integer("quantity_received").default(0).notNull(),
  quantityOnHand: integer("quantity_on_hand").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const inventorySerials = pgTable(
  "inventory_serials",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    itemId: integer("item_id").notNull(),
    warehouseId: integer("warehouse_id"),
    serialNumber: text("serial_number").notNull(),
    status: text("status").default("available").notNull(), // available, allocated, sold
    currentLocation: text("current_location"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("inventory_serials_org_sn_uidx").on(t.organizationId, t.serialNumber)],
);

export const inventoryAllocations = pgTable("inventory_allocations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  itemId: integer("item_id").notNull(),
  warehouseId: integer("warehouse_id"),
  quantity: integer("quantity").notNull(),
  orderId: integer("order_id"),
  requisitionId: integer("requisition_id"),
  shipmentId: integer("shipment_id"),
  status: text("status").default("reserved").notNull(), // reserved, fulfilled, cancelled
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const cycleCounts = pgTable("cycle_counts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  warehouseId: integer("warehouse_id").notNull(),
  zone: text("zone"),
  status: text("status").default("planned").notNull(), // planned, in_progress, completed
  countDate: timestamp("count_date").defaultNow().notNull(),
  countedBy: integer("counted_by"),
  variance: integer("variance"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const cycleCountLines = pgTable("cycle_count_lines", {
  id: serial("id").primaryKey(),
  cycleCountId: integer("cycle_count_id").notNull(),
  itemId: integer("item_id").notNull(),
  location: text("location"),
  systemQuantity: integer("system_quantity").notNull().default(0),
  countedQuantity: integer("counted_quantity").notNull().default(0),
  variance: integer("variance").notNull().default(0),
});

export const insertInventoryBatchSchema = createInsertSchema(inventoryBatches)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .superRefine((val, ctx) => {
    const recv = val.quantityReceived ?? 0;
    const oh = val.quantityOnHand ?? 0;
    if (recv < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "quantityReceived must be at least 1",
        path: ["quantityReceived"],
      });
    }
    if (oh < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "quantityOnHand must be at least 1",
        path: ["quantityOnHand"],
      });
    }
  });
export const insertInventorySerialSchema = createInsertSchema(inventorySerials)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .superRefine((val, ctx) => {
    if (typeof val.itemId !== "number" || !Number.isFinite(val.itemId) || val.itemId < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "itemId must be a positive integer",
        path: ["itemId"],
      });
    }
    const sn = String(val.serialNumber ?? "").trim();
    if (!sn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "serialNumber is required",
        path: ["serialNumber"],
      });
    }
  });
export const insertInventoryAllocationSchema = createInsertSchema(inventoryAllocations)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .superRefine((val, ctx) => {
    if (typeof val.itemId !== "number" || !Number.isFinite(val.itemId) || val.itemId < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "itemId must be a positive integer",
        path: ["itemId"],
      });
    }
    const q = val.quantity;
    if (typeof q !== "number" || !Number.isFinite(q) || q < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "quantity must be at least 1",
        path: ["quantity"],
      });
    }
  });
export const insertCycleCountSchema = createInsertSchema(cycleCounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCycleCountLineSchema = createInsertSchema(cycleCountLines).omit({
  id: true,
});

// Barcode schema for product identification
export const barcodes = pgTable(
  "barcodes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    itemId: integer("item_id").notNull(),
    type: text("type").default("CODE128"),
    value: text("value").notNull(),
    isPrimary: boolean("is_primary").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("barcodes_org_value_uidx").on(t.organizationId, t.value)],
);

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
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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
// Custom Roles - For creating user-defined roles with specific permissions
export const customRoles = pgTable(
  "custom_roles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: integer("created_by").notNull(), // Reference to user who created this role
    isActive: boolean("is_active").default(true),
    isSystemRole: boolean("is_system_role").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("custom_roles_org_name_uidx").on(t.organizationId, t.name)],
);

export const insertCustomRoleSchema = createInsertSchema(customRoles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Custom role creation schema with defaults
export const createCustomRoleSchema = insertCustomRoleSchema.extend({
  isSystemRole: z.boolean().default(false),
});

// Custom Role Permissions - Maps permissions to custom roles
export const customRolePermissions = pgTable("custom_role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull(),
  resource: resourceEnum("resource").notNull(),
  permissionType: permissionTypeEnum("permission_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomRolePermissionSchema = createInsertSchema(customRolePermissions).omit({
  id: true,
  createdAt: true,
});

// User Access Logs - For tracking login attempts, session activities
export const userAccessLogs = pgTable("user_access_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(), // "login", "logout", "failed_login", etc.
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  geolocation: text("geolocation"), // Country/city info based on IP
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  details: jsonb("details"), // Additional info like device type, success/failure reason
  sessionId: text("session_id"), // Reference to the session if applicable
});

export const insertUserAccessLogSchema = createInsertSchema(userAccessLogs).omit({
  id: true,
  timestamp: true,
});

// User Contact Information - Extended profile details
export const userContacts = pgTable("user_contacts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  phoneWork: text("phone_work"),
  phoneMobile: text("phone_mobile"),
  phoneHome: text("phone_home"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserContactSchema = createInsertSchema(userContacts).omit({
  id: true,
  updatedAt: true,
});

// User Security Settings - Enhanced security controls
export const userSecuritySettings = pgTable("user_security_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  allowedIpAddresses: text("allowed_ip_addresses").array(), // IP whitelist
  allowedTimeWindows: jsonb("allowed_time_windows"), // JSON with time restrictions
  allowedGeolocations: text("allowed_geolocations").array(), // Country/region restrictions
  securityQuestions: jsonb("security_questions"), // Stored securely
  securityAnswers: jsonb("security_answers"), // Hashed answers
  biometricEnabled: boolean("biometric_enabled").default(false),
  biometricType: text("biometric_type"), // "fingerprint", "face", etc.
  ssoEnabled: boolean("sso_enabled").default(false),
  ssoProvider: text("sso_provider"), // "google", "microsoft", etc.
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSecuritySettingSchema = createInsertSchema(userSecuritySettings).omit({
  id: true,
  updatedAt: true,
});

// User Performance Metrics - For tracking warehouse staff efficiency
export const userPerformanceMetrics = pgTable("user_performance_metrics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  metricType: text("metric_type").notNull(), // "items_processed", "accuracy", "speed", etc.
  value: real("value").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserPerformanceMetricSchema = createInsertSchema(userPerformanceMetrics).omit({
  id: true,
  createdAt: true,
});

// Time-based access restrictions for users
export const timeRestrictions = pgTable("time_restrictions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0-6 (Sunday-Saturday)
  startTime: text("start_time").notNull(), // Format: "HH:MM"
  endTime: text("end_time").notNull(), // Format: "HH:MM"
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTimeRestrictionSchema = createInsertSchema(timeRestrictions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  entityType: text("entity_type").notNull(), // contract, invoice, delivery_note, compliance_certificate
  entityId: integer("entity_id").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  checksum: text("checksum"),
  version: integer("version").default(1).notNull(),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  archivedAt: timestamp("archived_at"),
});

export const retentionPolicies = pgTable("retention_policies", {
  id: serial("id").primaryKey(),
  documentType: text("document_type").notNull().unique(), // purchase_order, invoice, contract
  retentionYears: integer("retention_years").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  emailEnabled: boolean("email_enabled").default(true),
  smsEnabled: boolean("sms_enabled").default(false),
  inAppEnabled: boolean("in_app_enabled").default(true),
  lowStock: boolean("low_stock").default(true),
  approvalRequest: boolean("approval_request").default(true),
  contractExpiry: boolean("contract_expiry").default(true),
  shipmentDelay: boolean("shipment_delay").default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  organizationId: true,
  uploadedAt: true,
});
export const insertRetentionPolicySchema = createInsertSchema(retentionPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});
export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  updatedAt: true,
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
export type InventoryBatch = typeof inventoryBatches.$inferSelect;
export type InsertInventoryBatch = z.infer<typeof insertInventoryBatchSchema>;
export type InventorySerial = typeof inventorySerials.$inferSelect;
export type InsertInventorySerial = z.infer<typeof insertInventorySerialSchema>;
export type InventoryAllocation = typeof inventoryAllocations.$inferSelect;
export type InsertInventoryAllocation = z.infer<typeof insertInventoryAllocationSchema>;
export type CycleCount = typeof cycleCounts.$inferSelect;
export type InsertCycleCount = z.infer<typeof insertCycleCountSchema>;
export type CycleCountLine = typeof cycleCountLines.$inferSelect;
export type InsertCycleCountLine = z.infer<typeof insertCycleCountLineSchema>;
export type Carrier = typeof carriers.$inferSelect;
export type InsertCarrier = z.infer<typeof insertCarrierSchema>;

export type Barcode = typeof barcodes.$inferSelect;
export type InsertBarcode = z.infer<typeof insertBarcodeSchema>;
export type BarcodeForm = z.infer<typeof barcodeFormSchema>;

export type DemandForecast = typeof demandForecasts.$inferSelect;
export type InsertDemandForecast = z.infer<typeof insertDemandForecastSchema>;

export type ExternalIntegration = typeof externalIntegrations.$inferSelect;
export type InsertExternalIntegration = z.infer<typeof insertExternalIntegrationSchema>;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type InsertRetentionPolicy = z.infer<typeof insertRetentionPolicySchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

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

// New types for enhanced user access control
export type CustomRole = typeof customRoles.$inferSelect;
export type InsertCustomRole = z.infer<typeof insertCustomRoleSchema>;
export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;

export type CustomRolePermission = typeof customRolePermissions.$inferSelect;
export type InsertCustomRolePermission = z.infer<typeof insertCustomRolePermissionSchema>;

export type UserAccessLog = typeof userAccessLogs.$inferSelect;
export type InsertUserAccessLog = z.infer<typeof insertUserAccessLogSchema>;

export type UserContact = typeof userContacts.$inferSelect;
export type InsertUserContact = z.infer<typeof insertUserContactSchema>;

export type UserSecuritySetting = typeof userSecuritySettings.$inferSelect;
export type InsertUserSecuritySetting = z.infer<typeof insertUserSecuritySettingSchema>;

export type UserPerformanceMetric = typeof userPerformanceMetrics.$inferSelect;
export type InsertUserPerformanceMetric = z.infer<typeof insertUserPerformanceMetricSchema>;

export type TimeRestriction = typeof timeRestrictions.$inferSelect;
export type InsertTimeRestriction = z.infer<typeof insertTimeRestrictionSchema>;

// Invoice Status Enum
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "DISPUTED",
  "OVERDUE",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "VOID"
]);

export const apCaptureStatusEnum = pgEnum("ap_capture_status", [
  "STAGED",
  "REVIEW_REQUIRED",
  "READY_TO_PROMOTE",
  "PROMOTED",
  "REJECTED",
]);

export const apMatchStatusEnum = pgEnum("ap_match_status", [
  "PENDING",
  "MATCHED",
  "MATCHED_WITH_TOLERANCE",
  "EXCEPTION",
  "WAIVED",
]);

export const apReceiptStatusEnum = pgEnum("ap_receipt_status", [
  "DRAFT",
  "POSTED",
  "CANCELLED",
]);

export const apPaymentBatchStatusEnum = pgEnum("ap_payment_batch_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "RELEASED",
  "CANCELLED",
]);

// Invoice Table Schema
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    invoiceNumber: text("invoice_number").notNull(),
    customerId: integer("customer_id"), // Optional when invoice is supplier-side AP
  supplierId: integer("supplier_id"),
  status: invoiceStatusEnum("status").notNull().default("DRAFT"),
  issueDate: timestamp("issue_date").defaultNow().notNull(),
  dueDate: timestamp("due_date").notNull(),
  subtotal: real("subtotal").notNull().default(0),
  tax: real("tax").default(0),
  discount: real("discount").default(0),
  total: real("total").notNull().default(0),
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  purchaseOrderId: integer("purchase_order_id"), // Optional reference to a purchase order
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  paidAmount: real("paid_amount").default(0),
  dueAmount: real("due_amount").default(0),
  sentDate: timestamp("sent_date"),
  paidDate: timestamp("paid_date"),
    createdBy: integer("created_by").notNull(), // User who created the invoice
  },
  (t) => [uniqueIndex("invoices_org_number_uidx").on(t.organizationId, t.invoiceNumber)],
);

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentDate: true,
  paidDate: true,
}).partial({
  invoiceNumber: true,
  tax: true,
  discount: true,
  notes: true,
  termsAndConditions: true,
  purchaseOrderId: true,
  paidAmount: true,
  dueAmount: true,
});

export const invoiceFormSchema = insertInvoiceSchema.extend({
  customerId: z.number().int().positive("Customer ID must be a positive number").optional(),
  supplierId: z.number().int().positive("Supplier ID must be a positive number").optional(),
  subtotal: z.number().min(0, "Subtotal must be a positive number"),
  total: z.number().min(0, "Total must be a positive number"),
  dueDate: z.date().min(new Date(), "Due date must be in the future"),
}).refine(
  (d) => d.customerId != null || d.supplierId != null,
  { message: "Either customer or supplier is required", path: ["supplierId"] }
);

// Invoice Items Table Schema
export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  itemId: integer("item_id").notNull(),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  discount: real("discount").default(0),
  taxRate: real("tax_rate").default(0),
  taxAmount: real("tax_amount").default(0),
  glCode: text("gl_code"),
  costCenter: text("cost_center"),
  projectCode: text("project_code"),
  taxCode: text("tax_code"),
  totalPrice: real("total_price").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  description: true,
  discount: true,
  taxRate: true,
  taxAmount: true,
});

export const invoiceItemFormSchema = insertInvoiceItemSchema.extend({
  itemId: z.number().int().positive("Item ID must be a positive number"),
  quantity: z.number().min(0.01, "Quantity must be greater than 0"),
  unitPrice: z.number().min(0, "Unit price must be a positive number"),
  totalPrice: z.number().min(0, "Total price must be a positive number"),
});

export const apInvoiceCaptures = pgTable("ap_invoice_captures", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  source: text("source").notNull().default("manual_upload"),
  status: apCaptureStatusEnum("status").notNull().default("STAGED"),
  documentId: integer("document_id"),
  supplierId: integer("supplier_id"),
  invoiceNumber: text("invoice_number"),
  issueDate: timestamp("issue_date"),
  dueDate: timestamp("due_date"),
  currencyCode: text("currency_code"),
  subtotalAmount: real("subtotal_amount").default(0),
  taxAmount: real("tax_amount").default(0),
  totalAmount: real("total_amount").default(0),
  confidenceScore: real("confidence_score").default(0),
  duplicateCheckKey: text("duplicate_check_key"),
  extractedHeader: jsonb("extracted_header").$type<Record<string, unknown>>().default({}),
  extractedLines: jsonb("extracted_lines").$type<Array<Record<string, unknown>>>().default([]),
  warnings: jsonb("warnings").$type<string[]>().default([]),
  reviewerNotes: text("reviewer_notes"),
  promotedInvoiceId: integer("promoted_invoice_id"),
  createdBy: integer("created_by"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertApInvoiceCaptureSchema = createInsertSchema(apInvoiceCaptures).omit({
  id: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  documentId: true,
  supplierId: true,
  invoiceNumber: true,
  issueDate: true,
  dueDate: true,
  currencyCode: true,
  subtotalAmount: true,
  taxAmount: true,
  totalAmount: true,
  confidenceScore: true,
  duplicateCheckKey: true,
  extractedHeader: true,
  extractedLines: true,
  warnings: true,
  reviewerNotes: true,
  promotedInvoiceId: true,
  createdBy: true,
  reviewedBy: true,
});

export const apReceipts = pgTable(
  "ap_receipts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    receiptNumber: text("receipt_number").notNull(),
    purchaseOrderId: integer("purchase_order_id").notNull(),
    supplierId: integer("supplier_id"),
    status: apReceiptStatusEnum("status").notNull().default("POSTED"),
    receivedDate: timestamp("received_date").defaultNow().notNull(),
    receivedBy: integer("received_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ap_receipts_org_number_uidx").on(t.organizationId, t.receiptNumber)],
);

export const apReceiptItems = pgTable("ap_receipt_items", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").notNull(),
  purchaseOrderItemId: integer("purchase_order_item_id"),
  itemId: integer("item_id").notNull(),
  quantity: real("quantity").notNull().default(0),
  acceptedQuantity: real("accepted_quantity").notNull().default(0),
  rejectedQuantity: real("rejected_quantity").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertApReceiptSchema = createInsertSchema(apReceipts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  supplierId: true,
  receivedBy: true,
  notes: true,
});

export const insertApReceiptItemSchema = createInsertSchema(apReceiptItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  purchaseOrderItemId: true,
  acceptedQuantity: true,
  rejectedQuantity: true,
  notes: true,
});

export const apInvoiceMatchResults = pgTable("ap_invoice_match_results", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  invoiceId: integer("invoice_id").notNull(),
  purchaseOrderId: integer("purchase_order_id"),
  receiptId: integer("receipt_id"),
  status: apMatchStatusEnum("status").notNull().default("PENDING"),
  matchType: text("match_type").notNull().default("3_way"),
  priceTolerancePct: real("price_tolerance_pct").notNull().default(0),
  quantityTolerancePct: real("quantity_tolerance_pct").notNull().default(0),
  taxTolerancePct: real("tax_tolerance_pct").notNull().default(0),
  matchedLineCount: integer("matched_line_count").notNull().default(0),
  mismatchCount: integer("mismatch_count").notNull().default(0),
  mismatchSummary: jsonb("mismatch_summary").$type<Array<Record<string, unknown>>>().default([]),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertApInvoiceMatchResultSchema = createInsertSchema(apInvoiceMatchResults).omit({
  id: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  purchaseOrderId: true,
  receiptId: true,
  priceTolerancePct: true,
  quantityTolerancePct: true,
  taxTolerancePct: true,
  matchedLineCount: true,
  mismatchCount: true,
  mismatchSummary: true,
  reviewedBy: true,
});

// Payment Methods Enum
export const paymentMethodEnum = pgEnum("payment_method", [
  "CASH",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "BANK_TRANSFER",
  "CHECK",
  "PAYPAL",
  "OTHER"
]);

// Payments Table Schema
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  amount: real("amount").notNull(),
  method: paymentMethodEnum("method").notNull().default("CASH"),
  transactionReference: text("transaction_reference"),
  paymentDate: timestamp("payment_date").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  receivedBy: integer("received_by").notNull(), // User who received the payment
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  notes: true,
  transactionReference: true,
});

export const paymentFormSchema = insertPaymentSchema.extend({
  invoiceId: z.number().int().positive("Invoice ID must be a positive number"),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  method: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "CHECK", "PAYPAL", "OTHER"]),
});

export const apPaymentBatches = pgTable(
  "ap_payment_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    batchNumber: text("batch_number").notNull(),
    status: apPaymentBatchStatusEnum("status").notNull().default("DRAFT"),
    scheduledDate: timestamp("scheduled_date"),
    approvedAt: timestamp("approved_at"),
    releasedAt: timestamp("released_at"),
    totalAmount: real("total_amount").notNull().default(0),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("BANK_TRANSFER"),
    exportMetadata: jsonb("export_metadata").$type<Record<string, unknown>>().default({}),
    notes: text("notes"),
    createdBy: integer("created_by"),
    approvedBy: integer("approved_by"),
    releasedBy: integer("released_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ap_payment_batches_org_number_uidx").on(t.organizationId, t.batchNumber)],
);

export const apPaymentBatchItems = pgTable("ap_payment_batch_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  paymentId: integer("payment_id"),
  amount: real("amount").notNull().default(0),
  status: text("status").notNull().default("PENDING"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertApPaymentBatchSchema = createInsertSchema(apPaymentBatches).omit({
  id: true,
  approvedAt: true,
  releasedAt: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  organizationId: true,
  batchNumber: true,
  status: true,
  totalAmount: true,
  paymentMethod: true,
  scheduledDate: true,
  exportMetadata: true,
  notes: true,
  createdBy: true,
  approvedBy: true,
  releasedBy: true,
});

export const insertApPaymentBatchItemSchema = createInsertSchema(apPaymentBatchItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  paymentId: true,
  notes: true,
});

// Billing Settings Table Schema
export const billingSettings = pgTable("billing_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  companyAddress: text("company_address"),
  companyPhone: text("company_phone"),
  companyEmail: text("company_email"),
  companyWebsite: text("company_website"),
  companyLogo: text("company_logo"),
  taxIdentificationNumber: text("tax_identification_number"),
  defaultTaxRate: real("default_tax_rate").default(0),
  defaultPaymentTerms: integer("default_payment_terms").default(30), // Days
  invoicePrefix: text("invoice_prefix").default("INV-"),
  invoiceFooter: text("invoice_footer"),
  enableAutomaticReminders: boolean("enable_automatic_reminders").default(true),
  reminderDays: jsonb("reminder_days").default([7, 3, 1]), // Days before due date to send reminders
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBillingSettingsSchema = createInsertSchema(billingSettings).omit({
  id: true,
  updatedAt: true,
}).partial({
  companyAddress: true,
  companyPhone: true,
  companyEmail: true,
  companyWebsite: true,
  companyLogo: true,
  taxIdentificationNumber: true,
  invoiceFooter: true,
});

export const billingSettingsFormSchema = insertBillingSettingsSchema.extend({
  companyName: z.string().min(2, "Company name must be at least 2 characters"),
  defaultTaxRate: z.number().min(0, "Tax rate must be a positive number").max(100, "Tax rate cannot exceed 100%"),
  defaultPaymentTerms: z.number().int().min(1, "Payment terms must be at least 1 day"),
});

// Tax Rates Table Schema
export const taxRates = pgTable("tax_rates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rate: real("rate").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaxRateSchema = createInsertSchema(taxRates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  description: true,
  isActive: true,
  isDefault: true,
});

export const taxRateFormSchema = insertTaxRateSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
  rate: z.number().min(0, "Rate must be a positive number").max(100, "Rate cannot exceed 100%"),
});

// Discounts Table Schema
export const discounts = pgTable("discounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("PERCENTAGE"), // PERCENTAGE or FIXED
  value: real("value").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDiscountSchema = createInsertSchema(discounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  description: true,
  isActive: true,
  startDate: true,
  endDate: true,
});

export const discountFormSchema = insertDiscountSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
  type: z.enum(["PERCENTAGE", "FIXED"], {
    errorMap: () => ({ message: "Type must be either PERCENTAGE or FIXED" }),
  }),
  value: z.number().min(0, "Value must be a positive number"),
});

// Billing Reminder Logs Table Schema
export const billingReminderLogs = pgTable("billing_reminder_logs", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  reminderType: text("reminder_type").notNull(), // PRE_DUE, OVERDUE, etc.
  sentDate: timestamp("sent_date").defaultNow().notNull(),
  sentTo: text("sent_to").notNull(),
  sentMethod: text("sent_method").notNull().default("EMAIL"), // EMAIL, SMS, etc.
  messageContent: text("message_content"),
  status: text("status").notNull().default("SENT"), // SENT, FAILED, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBillingReminderLogSchema = createInsertSchema(billingReminderLogs).omit({
  id: true,
  createdAt: true,
}).partial({
  messageContent: true,
});

// Types for billing schemas
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceForm = z.infer<typeof invoiceFormSchema>;

export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItemForm = z.infer<typeof invoiceItemFormSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type PaymentForm = z.infer<typeof paymentFormSchema>;

export type ApInvoiceCapture = typeof apInvoiceCaptures.$inferSelect;
export type InsertApInvoiceCapture = z.infer<typeof insertApInvoiceCaptureSchema>;

export type ApReceipt = typeof apReceipts.$inferSelect;
export type InsertApReceipt = z.infer<typeof insertApReceiptSchema>;

export type ApReceiptItem = typeof apReceiptItems.$inferSelect;
export type InsertApReceiptItem = z.infer<typeof insertApReceiptItemSchema>;

export type ApInvoiceMatchResult = typeof apInvoiceMatchResults.$inferSelect;
export type InsertApInvoiceMatchResult = z.infer<typeof insertApInvoiceMatchResultSchema>;

export type ApPaymentBatch = typeof apPaymentBatches.$inferSelect;
export type InsertApPaymentBatch = z.infer<typeof insertApPaymentBatchSchema>;

export type ApPaymentBatchItem = typeof apPaymentBatchItems.$inferSelect;
export type InsertApPaymentBatchItem = z.infer<typeof insertApPaymentBatchItemSchema>;

export type BillingSetting = typeof billingSettings.$inferSelect;
export type InsertBillingSetting = z.infer<typeof insertBillingSettingsSchema>;
export type BillingSettingForm = z.infer<typeof billingSettingsFormSchema>;

export type TaxRate = typeof taxRates.$inferSelect;
export type InsertTaxRate = z.infer<typeof insertTaxRateSchema>;
export type TaxRateForm = z.infer<typeof taxRateFormSchema>;

export type Discount = typeof discounts.$inferSelect;
export type InsertDiscount = z.infer<typeof insertDiscountSchema>;
export type DiscountForm = z.infer<typeof discountFormSchema>;

export type BillingReminderLog = typeof billingReminderLogs.$inferSelect;
export type InsertBillingReminderLog = z.infer<typeof insertBillingReminderLogSchema>;

// Image Analysis Logs Table Schema
export const imageAnalysisLogs = pgTable("image_analysis_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  imageHash: text("image_hash").notNull(), // Store a hash of the image, not the image itself
  recognitionResults: jsonb("recognition_results"), // Store the AI recognition results as JSON
  itemId: integer("item_id").references(() => inventoryItems.id), // Optional reference to the created inventory item
  confidence: real("confidence").default(0), // Confidence score from the AI model
  isTrainingData: boolean("is_training_data").default(false), // Whether this entry is used for training
  notes: text("notes"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertImageAnalysisLogSchema = createInsertSchema(imageAnalysisLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  notes: true,
  isTrainingData: true,
  itemId: true,
  recognitionResults: true,
});

export type ImageAnalysisLog = typeof imageAnalysisLogs.$inferSelect;
export type InsertImageAnalysisLog = z.infer<typeof insertImageAnalysisLogSchema>;

// --- Multi-tenant core (types) ---
export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type OrganizationSettingsRow = typeof organizationSettings.$inferSelect;

/** Industry extensions: projects/sites (construction) and tracked assets (gas, equipment). */
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("projects_org_code_uidx").on(t.organizationId, t.code)],
);

export const sites = pgTable(
  "sites",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    projectId: integer("project_id").references(() => projects.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sites_org_code_uidx").on(t.organizationId, t.code)],
);

export const trackedAssets = pgTable("tracked_assets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  assetType: text("asset_type").notNull(),
  serialNumber: text("serial_number"),
  status: text("status").default("active"),
  warehouseId: integer("warehouse_id"),
  siteId: integer("site_id").references(() => sites.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const assetEvents = pgTable("asset_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  assetId: integer("asset_id")
    .notNull()
    .references(() => trackedAssets.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  performedBy: integer("performed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Gas-industry extension: physical specs keyed to tracked_assets. */
export const gasAssetProfiles = pgTable(
  "gas_asset_profiles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    trackedAssetId: integer("tracked_asset_id")
      .notNull()
      .references(() => trackedAssets.id),
    technologyType: text("technology_type"),
    gasFamily: text("gas_family"),
    pressureClass: text("pressure_class"),
    tareWeightKg: real("tare_weight_kg"),
    waterCapacityL: real("water_capacity_l"),
    testDueDate: timestamp("test_due_date"),
    complianceStatus: text("compliance_status").default("unknown"),
    condition: text("condition"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("gas_asset_profiles_asset_uidx").on(t.trackedAssetId)],
);

export const gasProducts = pgTable(
  "gas_products",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    gasFamily: text("gas_family"),
    hazardClass: text("hazard_class"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("gas_products_org_code_uidx").on(t.organizationId, t.code)],
);

export const gasExchangeTransactions = pgTable("gas_exchange_transactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
  deliveredAssetId: integer("delivered_asset_id").references(() => trackedAssets.id),
  collectedAssetId: integer("collected_asset_id").references(() => trackedAssets.id),
  customerId: integer("customer_id"),
  status: text("status").notNull().default("pending"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type TrackedAsset = typeof trackedAssets.$inferSelect;
export type AssetEvent = typeof assetEvents.$inferSelect;
export type GasAssetProfile = typeof gasAssetProfiles.$inferSelect;
export type GasProduct = typeof gasProducts.$inferSelect;
export type GasExchangeTransaction = typeof gasExchangeTransactions.$inferSelect;
