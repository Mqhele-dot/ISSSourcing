import {
  UserRoleEnum, ResourceEnum, PermissionTypeEnum,
  users, type User, type InsertUser,
  categories, type Category, type InsertCategory,
  inventoryItems, type InventoryItem, type InsertInventoryItem,
  suppliers, type Supplier, type InsertSupplier,
  purchaseRequisitions, type PurchaseRequisition, type InsertPurchaseRequisition,
  purchaseRequisitionItems, type PurchaseRequisitionItem, type InsertPurchaseRequisitionItem,
  purchaseOrders, type PurchaseOrder, type InsertPurchaseOrder,
  purchaseOrderItems, type PurchaseOrderItem, type InsertPurchaseOrderItem,
  activityLogs, type ActivityLog, type InsertActivityLog,
  appSettings, type AppSettings, type InsertAppSettings,
  supplierLogos, type SupplierLogo, type InsertSupplierLogo,
  vatRates, type VatRate, type InsertVatRate,
  reorderRequests, type ReorderRequest, type InsertReorderRequest,
  warehouses, type Warehouse, type InsertWarehouse,
  stockMovements, type StockMovement, type InsertStockMovement,
  warehouseInventory, type WarehouseInventory, type InsertWarehouseInventory,
  barcodes, type Barcode, type InsertBarcode,
  demandForecasts, type DemandForecast, type InsertDemandForecast,
  externalIntegrations, type ExternalIntegration, type InsertExternalIntegration,
  auditLogs, type AuditLog, type InsertAuditLog,
  userPreferences, type UserPreference, type InsertUserPreference,
  permissions, type Permission, type InsertPermission,
  userVerificationTokens, type UserVerificationToken, type InsertUserVerificationToken,
  sessions, type Session, type InsertSession,
  customRoles, type CustomRole, type InsertCustomRole,
  customRolePermissions, type CustomRolePermission, type InsertCustomRolePermission,
  userAccessLogs, type UserAccessLog, type InsertUserAccessLog,
  userContacts, type UserContact, type InsertUserContact,
  userSecuritySettings, type UserSecuritySetting, type InsertUserSecuritySetting,
  userPerformanceMetrics, type UserPerformanceMetric, type InsertUserPerformanceMetric,
  timeRestrictions, type TimeRestriction, type InsertTimeRestriction,
  type InventoryStats, ItemStatus, type BulkImportInventory,
  PurchaseRequisitionStatus, PurchaseOrderStatus, PaymentStatus, ReorderRequestStatus,
  stockMovementTypeEnum, userRoleEnum, permissionTypeEnum, resourceEnum,
  type UserLogin, type PasswordResetRequest,
  // Billing related imports
  invoices, type Invoice, type InsertInvoice, 
  invoiceItems, type InvoiceItem, type InsertInvoiceItem,
  payments, type Payment, type InsertPayment,
  billingSettings, type BillingSetting, type InsertBillingSetting,
  taxRates, type TaxRate, type InsertTaxRate,
  discounts, type Discount, type InsertDiscount,
  billingReminderLogs, type BillingReminderLog, type InsertBillingReminderLog,
  imageAnalysisLogs, type ImageAnalysisLog, type InsertImageAnalysisLog
} from "@shared/schema";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import memorystore from "memorystore";
import { db, pool } from "./db";
import { eq, and, or, like, desc, lte, gte, gt, lt, inArray, isNull, isNotNull, ne, sql } from "drizzle-orm";

const MemoryStore = memorystore(session);
const PostgresSessionStore = connectPgSimple(session);
import crypto from "crypto";
import { Pool } from "@neondatabase/serverless";

export interface IStorage {
  // Session store for Express sessions
  sessionStore: session.Store;

  // Settings methods
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;

  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  getUserCustomRoleId(userId: number): Promise<number | null>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  updateProfilePicture(userId: number, profilePictureUrl: string | null): Promise<User>;
  getUserPreferences(userId: number): Promise<UserPreference | undefined>;
  updateUserPreferences(userId: number, preferences: Partial<InsertUserPreference>): Promise<UserPreference | undefined>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;
  
  // Role and permission methods
  checkPermission(role: string, resource: string, permissionType: string): Promise<boolean>;
  checkCustomRolePermission(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<boolean>;
  getSystemRoles(): Promise<string[]>;
  getCustomRoles(): Promise<CustomRole[]>;
  getCustomRole(id: number): Promise<CustomRole | undefined>;
  createCustomRole(role: InsertCustomRole): Promise<CustomRole>;
  updateCustomRole(id: number, role: Partial<InsertCustomRole>): Promise<CustomRole | undefined>;
  deleteCustomRole(id: number): Promise<boolean>;
  getRolePermissions(role: keyof typeof UserRoleEnum): Promise<Permission[]>;
  getCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]>;
  addCustomRolePermission(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<CustomRolePermission>;
  removeCustomRolePermission(roleId: number, permissionId: number): Promise<boolean>;
  
  // User access logging
  logUserAccess(log: InsertUserAccessLog): Promise<UserAccessLog>;
  getUserAccessLogs(userId: number): Promise<UserAccessLog[]>;
  getRecentUserAccessLogs(limit: number): Promise<UserAccessLog[]>;
  
  // Authentication methods
  authenticateUser(credentials: UserLogin): Promise<User | null>;
  recordLoginAttempt(username: string, success: boolean): Promise<void>;
  resetFailedLoginAttempts(userId: number): Promise<void>;
  isAccountLocked(userId: number): Promise<boolean>;
  
  // Email verification methods
  createVerificationToken(userId: number, tokenType: string, expiresInMinutes?: number): Promise<UserVerificationToken>;
  getVerificationToken(token: string, type: string): Promise<UserVerificationToken | undefined>;
  useVerificationToken(token: string, type: string): Promise<UserVerificationToken | undefined>;
  markEmailAsVerified(userId: number): Promise<User | undefined>;
  verifyEmail(token: string): Promise<boolean>;
  
  // Password reset methods
  createPasswordResetToken(email: string): Promise<UserVerificationToken | null>;
  resetPassword(token: string, newPassword: string): Promise<boolean>;
  changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean>;
  
  // Two-factor authentication methods
  generateTwoFactorSecret(userId: number): Promise<string>;
  enableTwoFactorAuth(userId: number, verified: boolean): Promise<User | undefined>;
  disableTwoFactorAuth(userId: number): Promise<User | undefined>;
  verifyTwoFactorToken(userId: number, token: string): Promise<boolean>;
  
  // Image recognition methods
  logImageAnalysis(log: InsertImageAnalysisLog): Promise<ImageAnalysisLog>;
  getItemImageAnalysisHistory(itemId: number): Promise<ImageAnalysisLog[]>;
  getImageAnalysisByUserId(userId: number): Promise<ImageAnalysisLog[]>;
  
  // Session management
  createSession(userId: number, ipAddress?: string, userAgent?: string, expiresInDays?: number): Promise<Session>;
  getSession(token: string): Promise<Session | undefined>;
  invalidateSession(token: string): Promise<boolean>;
  invalidateAllUserSessions(userId: number): Promise<boolean>;
  cleanExpiredSessions(): Promise<void>;
  
  // Permission methods
  getAllPermissions(): Promise<Permission[]>;
  getPermission(id: number): Promise<Permission | undefined>;
  getPermissionsByRole(role: keyof typeof UserRoleEnum): Promise<Permission[]>;
  getPermissionsByResource(resource: keyof typeof ResourceEnum): Promise<Permission[]>;
  checkPermission(role: string, resource: string, permissionType: string): Promise<boolean>;
  createPermission(permission: InsertPermission): Permission;
  updatePermission(id: number, permission: Partial<InsertPermission>): Promise<Permission | undefined>;
  deletePermission(id: number): Promise<boolean>;
  
  // Custom Role methods
  getAllCustomRoles(): Promise<CustomRole[]>;
  getCustomRole(id: number): Promise<CustomRole | undefined>;
  getCustomRoleByName(name: string): Promise<CustomRole | undefined>;
  createCustomRole(role: InsertCustomRole): Promise<CustomRole>;
  updateCustomRole(id: number, role: Partial<InsertCustomRole>): Promise<CustomRole | undefined>;
  deleteCustomRole(id: number): Promise<boolean>;
  getCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]>;
  addPermissionToCustomRole(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<CustomRolePermission>;
  removePermissionFromCustomRole(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<boolean>;
  
  // Enhanced user access methods
  logUserAccess(userId: number, action: string, details?: any, ip?: string, userAgent?: string): Promise<UserAccessLog>;
  getUserAccessLogs(userId: number, limit?: number): Promise<UserAccessLog[]>;
  getRecentUserAccessLogs(limit?: number): Promise<UserAccessLog[]>;
  getFailedLoginAttempts(userId: number, hours?: number): Promise<UserAccessLog[]>;
  
  // User profile methods
  getUserContactInfo(userId: number): Promise<UserContact | undefined>;
  updateUserContactInfo(userId: number, contactInfo: Partial<InsertUserContact>): Promise<UserContact | undefined>;
  
  // User security methods
  getUserSecuritySettings(userId: number): Promise<UserSecuritySetting | undefined>;
  updateUserSecuritySettings(userId: number, settings: Partial<InsertUserSecuritySetting>): Promise<UserSecuritySetting | undefined>;
  checkIpAllowed(userId: number, ipAddress: string): Promise<boolean>;
  checkTimeAllowed(userId: number, timestamp?: Date): Promise<boolean>;
  checkGeoAllowed(userId: number, country: string): Promise<boolean>;
  
  // User performance metrics
  recordUserPerformance(metric: InsertUserPerformanceMetric): Promise<UserPerformanceMetric>;
  getUserPerformanceMetrics(userId: number, metricType?: string, startDate?: Date, endDate?: Date): Promise<UserPerformanceMetric[]>;
  
  // Time restriction methods
  getTimeRestrictions(userId: number): Promise<TimeRestriction[]>;
  addTimeRestriction(restriction: InsertTimeRestriction): Promise<TimeRestriction>;
  updateTimeRestriction(id: number, restriction: Partial<InsertTimeRestriction>): Promise<TimeRestriction | undefined>;
  deleteTimeRestriction(id: number): Promise<boolean>;
  
  // Category methods
  getAllCategories(): Promise<Category[]>;
  getCategory(id: number): Promise<Category | undefined>;
  getCategoryByName(name: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category | undefined>;
  deleteCategory(id: number): Promise<boolean>;
  
  // Supplier methods
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplier(id: number): Promise<Supplier | undefined>;
  getSupplierByName(name: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: number): Promise<boolean>;
  
  // Barcode methods
  getAllBarcodes(): Promise<Barcode[]>;
  getBarcode(id: number): Promise<Barcode | undefined>;
  getBarcodesByItemId(itemId: number): Promise<Barcode[]>;
  getBarcodeByValue(value: string): Promise<Barcode | undefined>;
  createBarcode(barcode: InsertBarcode): Promise<Barcode>;
  updateBarcode(id: number, barcode: Partial<InsertBarcode>): Promise<Barcode | undefined>;
  deleteBarcode(id: number): Promise<boolean>;
  findItemByBarcode(barcodeValue: string): Promise<InventoryItem | undefined>;
  
  // Warehouse methods
  getAllWarehouses(): Promise<Warehouse[]>;
  getWarehouse(id: number): Promise<Warehouse | undefined>;
  getDefaultWarehouse(): Promise<Warehouse | undefined>;
  createWarehouse(warehouse: InsertWarehouse): Promise<Warehouse>;
  updateWarehouse(id: number, warehouse: Partial<InsertWarehouse>): Promise<Warehouse | undefined>;
  deleteWarehouse(id: number): Promise<boolean>;
  setDefaultWarehouse(id: number): Promise<Warehouse | undefined>;
  
  // Warehouse inventory methods
  getWarehouseInventory(warehouseId: number): Promise<WarehouseInventory[]>;
  getWarehouseInventoryItem(warehouseId: number, itemId: number): Promise<WarehouseInventory | undefined>;
  getItemWarehouseInventory(itemId: number): Promise<WarehouseInventory[]>;
  createWarehouseInventory(warehouseInventory: InsertWarehouseInventory): Promise<WarehouseInventory>;
  updateWarehouseInventory(id: number, warehouseInventory: Partial<InsertWarehouseInventory>): Promise<WarehouseInventory | undefined>;
  deleteWarehouseInventory(id: number): Promise<boolean>;
  
  // Stock movement methods
  getAllStockMovements(): Promise<StockMovement[]>;
  getStockMovement(id: number): Promise<StockMovement | undefined>;
  getStockMovementsByItemId(itemId: number): Promise<StockMovement[]>;
  getStockMovementsByWarehouseId(warehouseId: number): Promise<StockMovement[]>;
  createStockMovement(movement: InsertStockMovement): Promise<StockMovement>;
  transferStock(sourceWarehouseId: number, destinationWarehouseId: number, itemId: number, quantity: number, userId?: number, reason?: string): Promise<StockMovement>;
  
  // Reorder request methods
  getAllReorderRequests(): Promise<ReorderRequest[]>;
  getReorderRequestsByDateRange(startDate: Date, endDate: Date): Promise<ReorderRequest[]>;
  getReorderRequest(id: number): Promise<ReorderRequest | undefined>;
  getReorderRequestByNumber(requestNumber: string): Promise<ReorderRequest | undefined>;
  createReorderRequest(request: InsertReorderRequest): Promise<ReorderRequest>;
  updateReorderRequest(id: number, request: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined>;
  deleteReorderRequest(id: number): Promise<boolean>;
  approveReorderRequest(id: number, approverId: number): Promise<ReorderRequest | undefined>;
  rejectReorderRequest(id: number, approverId: number, reason: string): Promise<ReorderRequest | undefined>;
  convertReorderRequestToRequisition(id: number): Promise<PurchaseRequisition | undefined>;
  getReorderRequestWithDetails(id: number): Promise<(ReorderRequest & { 
    item: InventoryItem,
    requestor?: User,
    approver?: User,
  }) | undefined>;
  
  // Settings methods
  getAppSettings(): Promise<AppSettings | undefined>;
  updateAppSettings(settings: Partial<InsertAppSettings>): Promise<AppSettings>;
  
  // Supplier Logo methods
  getSupplierLogo(supplierId: number): Promise<SupplierLogo | undefined>;
  createSupplierLogo(logo: InsertSupplierLogo): Promise<SupplierLogo>;
  updateSupplierLogo(supplierId: number, logoUrl: string): Promise<SupplierLogo | undefined>;
  deleteSupplierLogo(supplierId: number): Promise<boolean>;
  
  // Inventory item methods
  getAllInventoryItems(): Promise<InventoryItem[]>;
  getInventoryItem(id: number): Promise<InventoryItem | undefined>;
  getInventoryItemBySku(sku: string): Promise<InventoryItem | undefined>;
  createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem>;
  updateInventoryItem(id: number, item: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined>;
  deleteInventoryItem(id: number): Promise<boolean>;
  searchInventoryItems(query: string, categoryId?: number): Promise<InventoryItem[]>;
  getLowStockItems(): Promise<InventoryItem[]>;
  getOutOfStockItems(): Promise<InventoryItem[]>;
  getInventoryStats(): Promise<InventoryStats>;
  bulkImportInventory(items: BulkImportInventory): Promise<{
    created: InventoryItem[];
    updated: InventoryItem[];
    errors: { row: number; sku: string; message: string }[];
  }>;
  
  // Purchase Requisition methods
  getAllPurchaseRequisitions(): Promise<PurchaseRequisition[]>;
  getPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined>;
  getPurchaseRequisitionByNumber(requisitionNumber: string): Promise<PurchaseRequisition | undefined>;
  createPurchaseRequisition(requisition: InsertPurchaseRequisition, items: Omit<InsertPurchaseRequisitionItem, "requisitionId">[]): Promise<PurchaseRequisition>;
  updatePurchaseRequisition(id: number, requisition: Partial<InsertPurchaseRequisition>): Promise<PurchaseRequisition | undefined>;
  deletePurchaseRequisition(id: number): Promise<boolean>;
  getPurchaseRequisitionItems(requisitionId: number): Promise<PurchaseRequisitionItem[]>;
  addPurchaseRequisitionItem(item: InsertPurchaseRequisitionItem): Promise<PurchaseRequisitionItem>;
  updatePurchaseRequisitionItem(id: number, item: Partial<InsertPurchaseRequisitionItem>): Promise<PurchaseRequisitionItem | undefined>;
  deletePurchaseRequisitionItem(id: number): Promise<boolean>;
  approvePurchaseRequisition(id: number, approverId: number): Promise<PurchaseRequisition | undefined>;
  rejectPurchaseRequisition(id: number, approverId: number, reason: string): Promise<PurchaseRequisition | undefined>;
  
  // Purchase Order methods
  getAllPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined>;
  getPurchaseOrderByNumber(orderNumber: string): Promise<PurchaseOrder | undefined>;
  createPurchaseOrder(order: InsertPurchaseOrder, items: Omit<InsertPurchaseOrderItem, "orderId">[]): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: number, order: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined>;
  deletePurchaseOrder(id: number): Promise<boolean>;
  getPurchaseOrderItems(orderId: number): Promise<PurchaseOrderItem[]>;
  addPurchaseOrderItem(item: InsertPurchaseOrderItem): Promise<PurchaseOrderItem>;
  updatePurchaseOrderItem(id: number, item: Partial<InsertPurchaseOrderItem>): Promise<PurchaseOrderItem | undefined>;
  deletePurchaseOrderItem(id: number): Promise<boolean>;
  updatePurchaseOrderStatus(id: number, status: PurchaseOrderStatus): Promise<PurchaseOrder | undefined>;
  updatePurchaseOrderPaymentStatus(id: number, paymentStatus: PaymentStatus, reference?: string): Promise<PurchaseOrder | undefined>;
  recordPurchaseOrderItemReceived(itemId: number, receivedQuantity: number): Promise<PurchaseOrderItem | undefined>;
  createPurchaseOrderFromRequisition(requisitionId: number): Promise<PurchaseOrder | undefined>;
  sendPurchaseOrderEmail(id: number, recipientEmail: string): Promise<boolean>;
  
  // Activity log methods
  getAllActivityLogs(limit?: number): Promise<ActivityLog[]>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  
  // ReorderRequest methods
  getAllReorderRequests(): Promise<ReorderRequest[]>;
  getReorderRequestsByDateRange(startDate: Date, endDate: Date): Promise<ReorderRequest[]>;
  getReorderRequest(id: number): Promise<ReorderRequest | undefined>;
  getReorderRequestByNumber(requestNumber: string): Promise<ReorderRequest | undefined>;
  createReorderRequest(insertRequest: InsertReorderRequest): Promise<ReorderRequest>;
  updateReorderRequest(id: number, updateData: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined>;
  deleteReorderRequest(id: number): Promise<boolean>;
  approveReorderRequest(id: number, approverId: number): Promise<ReorderRequest | undefined>;
  rejectReorderRequest(id: number, approverId: number, reason: string): Promise<ReorderRequest | undefined>;
  convertReorderRequestToRequisition(id: number): Promise<PurchaseRequisition | undefined>;
  getReorderRequestWithDetails(id: number): Promise<(ReorderRequest & { 
    item: InventoryItem,
    requestor?: User,
    approver?: User,
  }) | undefined>;

  // VAT rate methods
  getAllVatRates(): Promise<VatRate[]>;
  getVatRate(id: number): Promise<VatRate | undefined>;
  getVatRateByCountryCode(countryCode: string): Promise<VatRate | undefined>;
  createVatRate(vatRate: InsertVatRate): Promise<VatRate>;
  updateVatRate(id: number, vatRate: Partial<InsertVatRate>): Promise<VatRate | undefined>;
  deleteVatRate(id: number): Promise<boolean>;
  
  // VAT calculation methods
  calculateVat(amount: number, countryCode: string, useReducedRate?: boolean): Promise<{
    originalAmount: number;
    vatAmount: number;
    totalAmount: number;
    vatRate: number;
    countryCode: string;
  }>;
  
  // For reference lookup combined methods
  getItemWithSupplierAndCategory(id: number): Promise<(InventoryItem & { 
    supplier?: Supplier, 
    category?: Category 
  }) | undefined>;
  getRequisitionWithDetails(id: number): Promise<(PurchaseRequisition & { 
    items: (PurchaseRequisitionItem & { item: InventoryItem })[];
    requestor?: User;
    approver?: User;
    supplier?: Supplier;
  }) | undefined>;
  getPurchaseOrderWithDetails(id: number): Promise<(PurchaseOrder & { 
    items: (PurchaseOrderItem & { item: InventoryItem })[];
    supplier: Supplier;
    requisition?: PurchaseRequisition;
  }) | undefined>;
  
  // Custom role methods
  getAllCustomRoles(): Promise<CustomRole[]>;
  getCustomRole(id: number): Promise<CustomRole | undefined>;
  getCustomRoleByName(name: string): Promise<CustomRole | undefined>;
  createCustomRole(role: InsertCustomRole): Promise<CustomRole>;
  updateCustomRole(id: number, role: Partial<InsertCustomRole>): Promise<CustomRole | undefined>;
  deleteCustomRole(id: number): Promise<boolean>;
  
  // Custom role permission methods
  getAllCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]>;
  getCustomRolePermission(id: number): Promise<CustomRolePermission | undefined>;
  createCustomRolePermission(permission: InsertCustomRolePermission): Promise<CustomRolePermission>;
  updateCustomRolePermission(id: number, permission: Partial<InsertCustomRolePermission>): Promise<CustomRolePermission | undefined>;
  deleteCustomRolePermission(id: number): Promise<boolean>;
  
  // User access log methods
  getAllUserAccessLogs(userId?: number): Promise<UserAccessLog[]>;
  getUserAccessLog(id: number): Promise<UserAccessLog | undefined>;
  createUserAccessLog(log: InsertUserAccessLog): Promise<UserAccessLog>;
  
  // User contact methods
  getAllUserContacts(userId: number): Promise<UserContact[]>;
  getUserContact(id: number): Promise<UserContact | undefined>;
  createUserContact(contact: InsertUserContact): Promise<UserContact>;
  updateUserContact(id: number, contact: Partial<InsertUserContact>): Promise<UserContact | undefined>;
  deleteUserContact(id: number): Promise<boolean>;
  
  // User security settings methods
  getUserSecuritySettings(userId: number): Promise<UserSecuritySetting | undefined>;
  createUserSecuritySettings(settings: InsertUserSecuritySetting): Promise<UserSecuritySetting>;
  updateUserSecuritySettings(userId: number, settings: Partial<InsertUserSecuritySetting>): Promise<UserSecuritySetting | undefined>;
  
  // User performance metrics methods
  getAllUserPerformanceMetrics(userId: number): Promise<UserPerformanceMetric[]>;
  getUserPerformanceMetric(id: number): Promise<UserPerformanceMetric | undefined>;
  createUserPerformanceMetric(metric: InsertUserPerformanceMetric): Promise<UserPerformanceMetric>;
  updateUserPerformanceMetric(id: number, metric: Partial<InsertUserPerformanceMetric>): Promise<UserPerformanceMetric | undefined>;
  
  // Time restriction methods
  getAllTimeRestrictions(userId?: number): Promise<TimeRestriction[]>;
  getTimeRestriction(id: number): Promise<TimeRestriction | undefined>;
  createTimeRestriction(restriction: InsertTimeRestriction): Promise<TimeRestriction>;
  updateTimeRestriction(id: number, restriction: Partial<InsertTimeRestriction>): Promise<TimeRestriction | undefined>;
  deleteTimeRestriction(id: number): Promise<boolean>;
  
  // Invoice methods
  getAllInvoices(): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined>;
  createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[]): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  deleteInvoice(id: number): Promise<boolean>;
  getInvoicesByCustomerId(customerId: number): Promise<Invoice[]>;
  getInvoicesByDateRange(startDate: Date, endDate: Date): Promise<Invoice[]>;
  getInvoicesByStatus(status: string): Promise<Invoice[]>;
  getOverdueInvoices(): Promise<Invoice[]>;
  getInvoiceDueInDays(days: number): Promise<Invoice[]>;
  
  // Invoice items methods
  getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]>;
  getInvoiceItem(id: number): Promise<InvoiceItem | undefined>;
  addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem>;
  updateInvoiceItem(id: number, item: Partial<InsertInvoiceItem>): Promise<InvoiceItem | undefined>;
  deleteInvoiceItem(id: number): Promise<boolean>;
  
  // Payment methods
  getAllPayments(): Promise<Payment[]>;
  getPayment(id: number): Promise<Payment | undefined>;
  getPaymentsByInvoiceId(invoiceId: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment | undefined>;
  deletePayment(id: number): Promise<boolean>;
  recordInvoicePayment(invoiceId: number, amount: number, method: string, receivedBy: number, reference?: string, notes?: string): Promise<Payment>;
  
  // Billing settings methods
  getBillingSettings(): Promise<BillingSetting | undefined>;
  updateBillingSettings(settings: Partial<InsertBillingSetting>): Promise<BillingSetting>;
  
  // Tax rate methods
  getAllTaxRates(): Promise<TaxRate[]>;
  getTaxRate(id: number): Promise<TaxRate | undefined>;
  getDefaultTaxRate(): Promise<TaxRate | undefined>;
  createTaxRate(taxRate: InsertTaxRate): Promise<TaxRate>;
  updateTaxRate(id: number, taxRate: Partial<InsertTaxRate>): Promise<TaxRate | undefined>;
  deleteTaxRate(id: number): Promise<boolean>;
  setDefaultTaxRate(id: number): Promise<TaxRate | undefined>;
  
  // Discount methods
  getAllDiscounts(): Promise<Discount[]>;
  getDiscount(id: number): Promise<Discount | undefined>;
  getActiveDiscounts(): Promise<Discount[]>;
  createDiscount(discount: InsertDiscount): Promise<Discount>;
  updateDiscount(id: number, discount: Partial<InsertDiscount>): Promise<Discount | undefined>;
  deleteDiscount(id: number): Promise<boolean>;
  
  // Billing reminder logs methods
  getAllBillingReminderLogs(): Promise<BillingReminderLog[]>;
  getBillingReminderLog(id: number): Promise<BillingReminderLog | undefined>;
  getBillingReminderLogsByInvoiceId(invoiceId: number): Promise<BillingReminderLog[]>;
  createBillingReminderLog(log: InsertBillingReminderLog): Promise<BillingReminderLog>;
  deleteBillingReminderLog(id: number): Promise<boolean>;
  
  // Image Analysis methods
  logImageAnalysis(log: InsertImageAnalysisLog): Promise<ImageAnalysisLog>;
  getItemImageAnalysisHistory(itemId: number): Promise<ImageAnalysisLog[]>;
  getImageAnalysisByUserId(userId: number): Promise<ImageAnalysisLog[]>;
}

export class MemStorage implements IStorage {
  sessionStore: session.Store;
  private users: Map<number, User>;
  private categories: Map<number, Category>;
  private inventoryItems: Map<number, InventoryItem>;
  private activityLogs: Map<number, ActivityLog>;
  private suppliers: Map<number, Supplier>;
  private purchaseRequisitions: Map<number, PurchaseRequisition>;
  private purchaseRequisitionItems: Map<number, PurchaseRequisitionItem>;
  private purchaseOrders: Map<number, PurchaseOrder>;
  private purchaseOrderItems: Map<number, PurchaseOrderItem>;
  private appSettings: Map<number, AppSettings>;
  private supplierLogos: Map<number, SupplierLogo>;
  private vatRates: Map<number, VatRate>;
  private reorderRequests: Map<number, ReorderRequest>;
  private warehouses: Map<number, Warehouse>;
  private stockMovements: Map<number, StockMovement>;
  private warehouseInventory: Map<number, WarehouseInventory>;
  private barcodes: Map<number, Barcode>;
  private demandForecasts: Map<number, DemandForecast>;
  private externalIntegrations: Map<number, ExternalIntegration>;
  private auditLogs: Map<number, AuditLog>;
  
  // User-related data structures
  private userPreferences: Map<number, UserPreference>;
  private permissions: Map<number, Permission>;
  private userVerificationTokens: Map<number, UserVerificationToken>;
  private sessions: Map<number, Session>;
  private customRoles: Map<number, CustomRole>;
  private customRolePermissions: Map<number, CustomRolePermission>;
  private userAccessLogs: Map<number, UserAccessLog>;
  private userContacts: Map<number, UserContact>;
  private userSecuritySettings: Map<number, UserSecuritySetting>;
  private userPerformanceMetrics: Map<number, UserPerformanceMetric>;
  private timeRestrictions: Map<number, TimeRestriction>;
  
  // Billing-related data structures
  private invoices: Map<number, Invoice>;
  private invoiceItems: Map<number, InvoiceItem>;
  private payments: Map<number, Payment>;
  private billingSettings: Map<number, BillingSetting>;
  
  // Image recognition data structures
  private imageAnalysisLogs: Map<number, ImageAnalysisLog>;
  private taxRates: Map<number, TaxRate>;
  private discounts: Map<number, Discount>;
  private billingReminderLogs: Map<number, BillingReminderLog>;
  
  // For tracking failed login attempts
  private failedLoginAttempts: Map<number, { count: number, lastAttempt: Date }>;
  
  private userCurrentId: number;
  private categoryCurrentId: number;
  private itemCurrentId: number;
  private logCurrentId: number;
  private supplierCurrentId: number;
  private requisitionCurrentId: number;
  private requisitionItemCurrentId: number;
  private orderCurrentId: number;
  private orderItemCurrentId: number;
  private settingsCurrentId: number;
  private supplierLogoCurrentId: number;
  private vatRateCurrentId: number;
  private reorderRequestCurrentId: number;
  private warehouseCurrentId: number;
  private stockMovementCurrentId: number;
  private warehouseInventoryCurrentId: number;
  private barcodeCurrentId: number;
  private demandForecastCurrentId: number;
  private externalIntegrationCurrentId: number;
  private auditLogCurrentId: number;
  private userPreferenceCurrentId: number;
  private permissionCurrentId: number;
  private userVerificationTokenCurrentId: number;
  private sessionCurrentId: number;
  private customRoleCurrentId: number;
  private customRolePermissionCurrentId: number;
  private userAccessLogCurrentId: number;
  private userContactCurrentId: number;
  private userSecuritySettingCurrentId: number;
  private userPerformanceMetricCurrentId: number;
  private timeRestrictionCurrentId: number;
  private invoiceCurrentId: number;
  private invoiceItemCurrentId: number;
  private paymentCurrentId: number;
  private billingSettingCurrentId: number;
  private taxRateCurrentId: number;
  private discountCurrentId: number;
  private billingReminderLogCurrentId: number;
  private imageAnalysisLogCurrentId: number;
  
  constructor() {
    this.users = new Map();
    this.categories = new Map();
    this.inventoryItems = new Map();
    this.activityLogs = new Map();
    this.suppliers = new Map();
    this.purchaseRequisitions = new Map();
    this.purchaseRequisitionItems = new Map();
    this.purchaseOrders = new Map();
    this.purchaseOrderItems = new Map();
    this.appSettings = new Map();
    this.supplierLogos = new Map();
    this.userVerificationTokens = new Map();
    this.sessions = new Map();
    this.failedLoginAttempts = new Map();
    
    // Initialize the session store for Express
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // Prune expired entries every 24h
    });
    this.vatRates = new Map();
    this.reorderRequests = new Map();
    this.warehouses = new Map();
    this.stockMovements = new Map();
    this.warehouseInventory = new Map();
    this.barcodes = new Map();
    this.demandForecasts = new Map();
    this.externalIntegrations = new Map();
    this.auditLogs = new Map();
    this.userPreferences = new Map();
    this.permissions = new Map();
    this.customRoles = new Map();
    this.customRolePermissions = new Map();
    this.userAccessLogs = new Map();
    this.userContacts = new Map();
    this.userSecuritySettings = new Map();
    this.userPerformanceMetrics = new Map();
    this.timeRestrictions = new Map();
    
    // Initialize billing-related maps
    this.invoices = new Map();
    this.invoiceItems = new Map();
    this.payments = new Map();
    this.billingSettings = new Map();
    this.taxRates = new Map();
    this.discounts = new Map();
    this.billingReminderLogs = new Map();
    
    // Initialize image recognition-related maps
    this.imageAnalysisLogs = new Map();
    
    this.userCurrentId = 1;
    this.categoryCurrentId = 1;
    this.itemCurrentId = 1;
    this.logCurrentId = 1;
    this.supplierCurrentId = 1;
    this.requisitionCurrentId = 1;
    this.requisitionItemCurrentId = 1;
    this.orderCurrentId = 1;
    this.orderItemCurrentId = 1;
    this.settingsCurrentId = 1;
    this.supplierLogoCurrentId = 1;
    this.vatRateCurrentId = 1;
    this.reorderRequestCurrentId = 1;
    this.warehouseCurrentId = 1;
    this.stockMovementCurrentId = 1;
    this.warehouseInventoryCurrentId = 1;
    this.barcodeCurrentId = 1;
    this.demandForecastCurrentId = 1;
    this.externalIntegrationCurrentId = 1;
    this.auditLogCurrentId = 1;
    this.userPreferenceCurrentId = 1;
    this.permissionCurrentId = 1;
    this.userVerificationTokenCurrentId = 1;
    this.sessionCurrentId = 1;
    this.customRoleCurrentId = 1;
    this.customRolePermissionCurrentId = 1;
    this.userAccessLogCurrentId = 1;
    this.userContactCurrentId = 1;
    this.userSecuritySettingCurrentId = 1;
    this.userPerformanceMetricCurrentId = 1;
    this.timeRestrictionCurrentId = 1;
    this.invoiceCurrentId = 1;
    this.invoiceItemCurrentId = 1;
    this.paymentCurrentId = 1;
    this.billingSettingCurrentId = 1;
    this.taxRateCurrentId = 1;
    this.discountCurrentId = 1;
    this.billingReminderLogCurrentId = 1;
    this.imageAnalysisLogCurrentId = 1;
    
    // Add default data
    this.initializeDefaultData();
  }
  
  private initializeDefaultData() {
    // Add default user for system operations
    const defaultUser: InsertUser = {
      username: "admin",
      password: "admin123", // This would be hashed in a real application
      email: "admin@example.com",
      role: "admin"
    };
    this.createUser(defaultUser);
    
    // Add default permissions for different user roles
    this.setupDefaultPermissions();
    
    // Add default VAT rates
    const defaultVatRates: InsertVatRate[] = [
      {
        countryCode: 'GB',
        countryName: 'United Kingdom',
        standardRate: 20,
        reducedRate: 5,
        active: true
      },
      {
        countryCode: 'US',
        countryName: 'United States',
        standardRate: 0,
        active: true
      },
      {
        countryCode: 'DE',
        countryName: 'Germany',
        standardRate: 19,
        reducedRate: 7,
        active: true
      },
      {
        countryCode: 'FR',
        countryName: 'France',
        standardRate: 20,
        reducedRate: 5.5,
        active: true
      }
    ];
    
    defaultVatRates.forEach(vatRate => this.createVatRate(vatRate));

    // Add default categories
    const defaultCategories: InsertCategory[] = [
      { name: "Electronics", description: "Electronic devices and accessories" },
      { name: "Office Supplies", description: "General office supplies and stationery" },
      { name: "Furniture", description: "Office furniture and fixtures" }
    ];
    
    defaultCategories.forEach(category => this.createCategory(category));
    
    // Add default suppliers
    const defaultSuppliers: InsertSupplier[] = [
      {
        name: "Tech Solutions Inc.",
        contactName: "John Smith",
        email: "john@techsolutions.com",
        phone: "555-123-4567",
        address: "123 Tech Blvd, San Francisco, CA 94107",
        notes: "Preferred supplier for all electronic equipment"
      },
      {
        name: "Office Supply Co.",
        contactName: "Jane Doe",
        email: "jane@officesupply.com",
        phone: "555-234-5678",
        address: "456 Office Park, Chicago, IL 60601",
        notes: "Bulk discounts available for orders over $500"
      },
      {
        name: "Furniture Warehouse",
        contactName: "Robert Johnson",
        email: "robert@furniturewarehouse.com",
        phone: "555-345-6789",
        address: "789 Warehouse Ave, Atlanta, GA 30301",
        notes: "Custom furniture available with 4-week lead time"
      }
    ];
    
    const supplierMap = new Map<string, number>();
    
    defaultSuppliers.forEach(supplier => {
      const createdSupplier = this.createSupplier(supplier);
      supplierMap.set(supplier.name, createdSupplier.id);
    });
    
    // Add sample inventory items for demonstration
    const defaultItems: InsertInventoryItem[] = [
      {
        name: "MacBook Pro 16\"",
        sku: "MBP16-2021",
        description: "16-inch MacBook Pro with M1 Pro chip",
        categoryId: 1,
        quantity: 24,
        price: 2399.00,
        cost: 1999.00,
        lowStockThreshold: 10,
        location: "Warehouse A",
        supplierId: supplierMap.get("Tech Solutions Inc.")
      },
      {
        name: "Premium Notebooks",
        sku: "NB-PREM-22",
        description: "High-quality hardcover notebooks",
        categoryId: 2,
        quantity: 7,
        price: 24.99,
        cost: 12.50,
        lowStockThreshold: 15,
        location: "Shelf B5",
        supplierId: supplierMap.get("Office Supply Co.")
      },
      {
        name: "Ergonomic Office Chair",
        sku: "CH-ERG-100",
        description: "Adjustable ergonomic office chair with lumbar support",
        categoryId: 3,
        quantity: 0,
        price: 349.95,
        cost: 199.95,
        lowStockThreshold: 5,
        location: "Warehouse B",
        supplierId: supplierMap.get("Furniture Warehouse")
      },
      {
        name: "Wireless Laser Printer",
        sku: "PRT-WL-2000",
        description: "Color laser printer with wireless connectivity",
        categoryId: 1,
        quantity: 12,
        price: 289.99,
        cost: 189.99,
        lowStockThreshold: 5,
        location: "Warehouse A",
        supplierId: supplierMap.get("Tech Solutions Inc.")
      }
    ];
    
    defaultItems.forEach(item => {
      this.createInventoryItem(item);
    });
    
    // Add sample purchase requisition
    const sampleRequisition: InsertPurchaseRequisition = {
      requisitionNumber: "REQ-2023-001",
      requestorId: 1, // Admin user
      status: PurchaseRequisitionStatus.APPROVED,
      notes: "Urgent order for new office setup",
      requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week from now
      supplierId: supplierMap.get("Tech Solutions Inc."),
      totalAmount: 4999.95,
      approvalDate: new Date(),
      approverId: 1
    };
    
    this.createPurchaseRequisition(sampleRequisition, [
      {
        itemId: 1, // MacBook Pro
        quantity: 2,
        unitPrice: 2399.95,
        totalPrice: 4799.90,
        notes: "For new developers"
      },
      {
        itemId: 4, // Wireless Printer
        quantity: 1,
        unitPrice: 200.05,
        totalPrice: 200.05,
        notes: "For reception area"
      }
    ]);
    
    // Add sample purchase order
    const sampleOrder: InsertPurchaseOrder = {
      orderNumber: "PO-2023-001",
      supplierId: supplierMap.get("Tech Solutions Inc."),
      status: PurchaseOrderStatus.SENT,
      orderDate: new Date(),
      expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks from now
      deliveryAddress: "123 Main St, Suite 101, New York, NY 10001",
      totalAmount: 4999.95,
      notes: "Please deliver between 9 AM and 5 PM on weekdays",
      paymentStatus: PaymentStatus.UNPAID,
      emailSent: true,
      emailSentDate: new Date()
    };
    
    this.createPurchaseOrder(sampleOrder, [
      {
        itemId: 1, // MacBook Pro
        quantity: 2,
        unitPrice: 2399.95,
        totalPrice: 4799.90,
        receivedQuantity: 0,
        notes: "Include power adapters and documentation"
      },
      {
        itemId: 4, // Wireless Printer
        quantity: 1,
        unitPrice: 200.05,
        totalPrice: 200.05,
        receivedQuantity: 0,
        notes: "Include starter toner cartridge set"
      }
    ]);
    
    // Add sample activity logs
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const defaultLogs: InsertActivityLog[] = [
      {
        action: "Purchase Order Created",
        description: "Created PO-2023-001 for $4,999.95",
        referenceType: "purchase_order",
        referenceId: 1,
        userId: 1
      },
      {
        action: "New Supplier Added",
        description: "Added Tech Solutions Inc. as a supplier",
        referenceType: "supplier",
        referenceId: 1,
        userId: 1
      },
      {
        action: "Inventory Updated",
        description: "Added 24 MacBook Pro 16\" to inventory",
        itemId: 1,
        userId: 1
      }
    ];
    
    defaultLogs.forEach(log => {
      this.createActivityLog(log);
    });
  }
  
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }
  
  async getUserByResetToken(token: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.passwordResetToken === token,
    );
  }
  
  async getUserCustomRoleId(userId: number): Promise<number | null> {
    const user = await this.getUser(userId);
    if (!user || user.role !== 'custom') {
      return null;
    }
    
    // Look for a custom role assignment in user preferences
    const userPrefs = await this.getUserPreferences(userId);
    if (userPrefs && userPrefs.preferences && typeof userPrefs.preferences === 'object') {
      const prefs = userPrefs.preferences as any;
      return prefs.customRoleId || null;
    }
    
    return null;
  }
  
  // Role and permission management
  
  // Returns all available system roles
  async getSystemRoles(): Promise<string[]> {
    // Return the predefined system roles
    return Object.values(UserRoleEnum).filter(role => role !== 'custom');
  }
  
  // Check if a system role has a specific permission
  async checkPermission(role: UserRole, resource: Resource, permissionType: PermissionType): Promise<boolean> {
    // Admin role has all permissions
    if (role === 'admin') {
      return true;
    }
    
    // Get predefined permissions for the role
    const permissions = await this.getRolePermissions(role);
    
    // Check if the role has the requested permission
    return permissions.some(
      (p) => p.resource === resource && p.permissionType === permissionType
    );
  }
  
  // Get permissions for a system role
  async getRolePermissions(role: UserRole): Promise<Permission[]> {
    // Predefined permissions for each role
    // In a real DB, these would be fetched from the permissions table
    switch(role) {
      case 'admin':
        // Admin has all permissions on all resources
        return this.getAllPermissions();
        
      case 'manager':
        // Return manager specific permissions
        return Array.from(this.permissions.values()).filter(p => 
          // Managers can do everything except system-level operations
          p.resource !== 'system' || p.permissionType !== 'admin'
        );
        
      case 'warehouse_manager':
        // Warehouse managers can manage inventory and warehouses
        return Array.from(this.permissions.values()).filter(p => 
          ['inventory', 'warehouses', 'stock_movements', 'reorder_requests'].includes(p.resource)
        );
        
      case 'procurement_officer':
        // Procurement officers can manage suppliers and purchases
        return Array.from(this.permissions.values()).filter(p => 
          ['suppliers', 'purchases', 'reorder_requests'].includes(p.resource)
        );
        
      case 'inventory_clerk':
        // Inventory clerks can only work with inventory items
        return Array.from(this.permissions.values()).filter(p => 
          p.resource === 'inventory' && ['read', 'create', 'update'].includes(p.permissionType)
        );
        
      case 'viewer':
        // Viewers can only read data
        return Array.from(this.permissions.values()).filter(p => 
          p.permissionType === 'read'
        );
        
      default:
        return [];
    }
  }
  
  // Custom roles management
  
  // Get all custom roles
  async getCustomRoles(): Promise<CustomRole[]> {
    return Array.from(this.customRoles.values());
  }
  
  // Get specific custom role
  async getCustomRole(id: number): Promise<CustomRole | undefined> {
    return this.customRoles.get(id);
  }
  
  // Get custom role by name
  async getCustomRoleByName(name: string): Promise<CustomRole | undefined> {
    return Array.from(this.customRoles.values()).find(r => r.name === name);
  }
  
  // Create a new custom role
  async createCustomRole(role: InsertCustomRole): Promise<CustomRole> {
    const id = this.customRoleCurrentId++;
    const now = new Date();
    
    const newRole: CustomRole = {
      ...role,
      id,
      createdAt: now,
      updatedAt: now,
      description: role.description || null,
      isActive: role.isActive !== undefined ? role.isActive : true,
      isSystemRole: false
    };
    
    this.customRoles.set(id, newRole);
    
    // Create activity log
    await this.createActivityLog({
      action: "Custom Role Created",
      description: `Created custom role: ${role.name}`,
      referenceType: "custom_role",
      referenceId: id,
      userId: role.createdBy
    });
    
    return newRole;
  }
  
  // Update existing custom role
  async updateCustomRole(id: number, role: Partial<InsertCustomRole>): Promise<CustomRole | undefined> {
    const existingRole = this.customRoles.get(id);
    if (!existingRole) return undefined;
    
    const updatedRole = {
      ...existingRole,
      ...role,
      updatedAt: new Date()
    };
    
    this.customRoles.set(id, updatedRole);
    
    // Create activity log
    await this.createActivityLog({
      action: "Custom Role Updated",
      description: `Updated custom role: ${updatedRole.name}`,
      referenceType: "custom_role",
      referenceId: id
    });
    
    return updatedRole;
  }
  
  // Delete a custom role
  async deleteCustomRole(id: number): Promise<boolean> {
    // First remove all permissions for this role
    const permissions = await this.getCustomRolePermissions(id);
    for (const permission of permissions) {
      await this.removeCustomRolePermission(id, permission.id);
    }
    
    // Create activity log
    const role = this.customRoles.get(id);
    if (role) {
      await this.createActivityLog({
        action: "Custom Role Deleted",
        description: `Deleted custom role: ${role.name}`,
        referenceType: "custom_role",
        referenceId: id
      });
    }
    
    return this.customRoles.delete(id);
  }
  
  // Get all permissions for a custom role
  async getCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]> {
    return Array.from(this.customRolePermissions.values())
      .filter(p => p.roleId === roleId);
  }
  
  // Add a permission to a custom role
  async addCustomRolePermission(roleId: number, resource: Resource, permissionType: PermissionType): Promise<CustomRolePermission> {
    const role = await this.getCustomRole(roleId);
    if (!role) {
      throw new Error(`Custom role with ID ${roleId} not found`);
    }
    
    // Check if permission already exists
    const existing = Array.from(this.customRolePermissions.values())
      .find(p => p.roleId === roleId && p.resource === resource && p.permissionType === permissionType);
      
    if (existing) {
      return existing;
    }
    
    // Create new permission
    const id = this.customRolePermissionCurrentId++;
    const now = new Date();
    
    const newPermission: CustomRolePermission = {
      id,
      roleId,
      resource,
      permissionType,
      createdAt: now
    };
    
    this.customRolePermissions.set(id, newPermission);
    
    // Create activity log
    await this.createActivityLog({
      action: "Custom Role Permission Added",
      description: `Added ${permissionType} permission for ${resource} to role: ${role.name}`,
      referenceType: "custom_role",
      referenceId: roleId
    });
    
    return newPermission;
  }
  
  // Remove a permission from a custom role
  async removeCustomRolePermission(roleId: number, permissionId: number): Promise<boolean> {
    const permission = this.customRolePermissions.get(permissionId);
    if (!permission || permission.roleId !== roleId) {
      return false;
    }
    
    const role = await this.getCustomRole(roleId);
    
    // Create activity log
    if (role) {
      await this.createActivityLog({
        action: "Custom Role Permission Removed",
        description: `Removed ${permission.permissionType} permission for ${permission.resource} from role: ${role.name}`,
        referenceType: "custom_role",
        referenceId: roleId
      });
    }
    
    return this.customRolePermissions.delete(permissionId);
  }
  
  // Check if a custom role has a specific permission
  async checkCustomRolePermission(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<boolean> {
    const permissions = await this.getCustomRolePermissions(roleId);
    
    return permissions.some(
      (p) => p.resource === resource && p.permissionType === permissionType
    );
  }
  
  // User access logging
  
  // Log user access
  async logUserAccess(log: InsertUserAccessLog): Promise<UserAccessLog> {
    const id = this.userAccessLogCurrentId++;
    const userAccessLog: UserAccessLog = {
      ...log,
      id,
      timestamp: new Date()
    };
    
    this.userAccessLogs.set(id, userAccessLog);
    return userAccessLog;
  }
  
  // Get access logs for a specific user
  async getUserAccessLogs(userId: number): Promise<UserAccessLog[]> {
    return Array.from(this.userAccessLogs.values())
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  // Get recent access logs across all users
  async getRecentUserAccessLogs(limit: number = 100): Promise<UserAccessLog[]> {
    return Array.from(this.userAccessLogs.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
  
  // Authentication methods
  async authenticateUser(credentials: UserLogin): Promise<User | null> {
    const user = await this.getUserByUsername(credentials.username);
    if (!user) return null;
    
    // In a real app, we would hash and compare passwords here
    // This is a simplified version for demonstration
    if (user.password === credentials.password) {
      const now = new Date();
      await this.updateUser(user.id, { lastLogin: now });
      await this.resetFailedLoginAttempts(user.id);
      
      // Log successful login
      await this.createActivityLog({
        action: "User Login",
        description: `User ${user.username} logged in successfully`,
        referenceType: "user",
        referenceId: user.id,
        userId: user.id
      });
      
      return user;
    }
    
    // Log failed login attempt
    await this.recordLoginAttempt(credentials.username, false);
    return null;
  }
  
  async recordLoginAttempt(username: string, success: boolean): Promise<void> {
    if (success) return; // Only track failed attempts
    
    const user = await this.getUserByUsername(username);
    if (!user) return; // Username doesn't exist, don't track
    
    const now = new Date();
    const attempts = this.failedLoginAttempts.get(user.id);
    
    if (attempts) {
      // Increment existing attempts
      attempts.count += 1;
      attempts.lastAttempt = now;
    } else {
      // First failed attempt
      this.failedLoginAttempts.set(user.id, {
        count: 1,
        lastAttempt: now
      });
    }
    
    // Log failed attempt
    await this.createActivityLog({
      action: "Failed Login Attempt",
      description: `Failed login attempt for user ${username}`,
      referenceType: "user",
      referenceId: user.id,
      userId: user.id
    });
  }
  
  async resetFailedLoginAttempts(userId: number): Promise<void> {
    this.failedLoginAttempts.delete(userId);
  }
  
  async isAccountLocked(userId: number): Promise<boolean> {
    const attempts = this.failedLoginAttempts.get(userId);
    if (!attempts) return false;
    
    const MAX_FAILED_ATTEMPTS = 5;
    const LOCKOUT_DURATION_MINUTES = 30;
    
    if (attempts.count >= MAX_FAILED_ATTEMPTS) {
      const lockoutTime = new Date(attempts.lastAttempt);
      lockoutTime.setMinutes(lockoutTime.getMinutes() + LOCKOUT_DURATION_MINUTES);
      
      // If current time is before the lockout expires, account is locked
      if (new Date() < lockoutTime) {
        return true;
      } else {
        // Lockout duration has passed, reset attempts
        this.resetFailedLoginAttempts(userId);
        return false;
      }
    }
    
    return false;
  }
  
  // Email verification methods
  async createVerificationToken(userId: number, tokenType: string, expiresInMinutes: number = 60): Promise<UserVerificationToken> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMinutes(now.getMinutes() + expiresInMinutes);
    
    const verificationToken: UserVerificationToken = {
      id: this.userVerificationTokenCurrentId++,
      userId,
      token,
      type: tokenType,
      createdAt: now,
      expiresAt,
      used: null
    };
    
    this.userVerificationTokens.set(verificationToken.id, verificationToken);
    return verificationToken;
  }
  
  async getVerificationToken(token: string, type: string): Promise<UserVerificationToken | undefined> {
    return Array.from(this.userVerificationTokens.values()).find(
      (vt) => vt.token === token && vt.type === type && !vt.used && vt.expiresAt > new Date()
    );
  }
  
  async useVerificationToken(token: string, type: string): Promise<UserVerificationToken | undefined> {
    const verificationToken = await this.getVerificationToken(token, type);
    if (!verificationToken) return undefined;
    
    // Mark token as used
    verificationToken.used = true;
    this.userVerificationTokens.set(verificationToken.id, verificationToken);
    
    return verificationToken;
  }
  
  async markEmailAsVerified(userId: number): Promise<User | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    // In a real app, we'd set an emailVerified field
    // For our demo, we'll just log the action
    await this.createActivityLog({
      action: "Email Verified",
      description: `Email verified for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return user;
  }
  
  // Password reset methods
  async createPasswordResetToken(email: string): Promise<UserVerificationToken | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    
    // Create a password reset token that expires in 30 minutes
    const token = await this.createVerificationToken(user.id, 'password_reset', 30);
    
    // Log the action
    await this.createActivityLog({
      action: "Password Reset Requested",
      description: `Password reset requested for user: ${user.username}`,
      referenceType: "user",
      referenceId: user.id,
      userId: user.id
    });
    
    return token;
  }
  
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const verificationToken = await this.useVerificationToken(token, 'password_reset');
    if (!verificationToken) return false;
    
    const user = await this.getUser(verificationToken.userId);
    if (!user) return false;
    
    // Update the user's password
    await this.updateUser(user.id, { password: newPassword });
    
    // Reset failed login attempts if any
    await this.resetFailedLoginAttempts(user.id);
    
    // Log the action
    await this.createActivityLog({
      action: "Password Reset",
      description: `Password reset for user: ${user.username}`,
      referenceType: "user",
      referenceId: user.id,
      userId: user.id
    });
    
    return true;
  }
  
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;
    
    // In a real app, we'd hash and compare the passwords
    if (user.password !== currentPassword) return false;
    
    // Update the user's password
    await this.updateUser(userId, { password: newPassword });
    
    // Log the action
    await this.createActivityLog({
      action: "Password Changed",
      description: `Password changed for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return true;
  }
  
  // Two-factor authentication methods
  async generateTwoFactorSecret(userId: number): Promise<string> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    // In a real app, we'd use a proper 2FA library like speakeasy
    // Here we're just generating a random string for demonstration
    const secret = crypto.randomBytes(20).toString('hex');
    
    // Store the secret in the user's 2FA token field in the verification tokens
    await this.createVerificationToken(userId, 'two_factor_secret', 0);
    
    // Log the action
    await this.createActivityLog({
      action: "Two-Factor Secret Generated",
      description: `Two-factor authentication secret generated for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return secret;
  }
  
  async enableTwoFactorAuth(userId: number, verified: boolean): Promise<User | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    // In a real app, we'd need to set a field on the user for 2FA enabled
    // Here we're just logging the action
    await this.createActivityLog({
      action: "Two-Factor Authentication Enabled",
      description: `Two-factor authentication enabled for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return user;
  }
  
  async disableTwoFactorAuth(userId: number): Promise<User | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    // In a real app, we'd need to disable 2FA on the user record
    // Here we're just logging the action
    await this.createActivityLog({
      action: "Two-Factor Authentication Disabled",
      description: `Two-factor authentication disabled for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return user;
  }
  
  async verifyTwoFactorToken(userId: number, token: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;
    
    // In a real app, we'd validate the token against the user's secret using a 2FA library
    // Here we're simplifying for demonstration by accepting any non-empty token
    if (!token) return false;
    
    // Log the action
    await this.createActivityLog({
      action: "Two-Factor Token Verified",
      description: `Two-factor token verified for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return true;
  }
  
  // Session management methods
  async createSession(userId: number, ipAddress?: string, userAgent?: string, expiresInDays: number = 30): Promise<Session> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    
    const session: Session = {
      id: this.sessionCurrentId++,
      userId,
      token,
      createdAt: now,
      expiresAt,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      lastActivity: now,
      isValid: true
    };
    
    this.sessions.set(session.id, session);
    
    // Log session creation
    await this.createActivityLog({
      action: "Session Created",
      description: `New session created for user: ${user.username}`,
      referenceType: "session",
      referenceId: session.id,
      userId
    });
    
    return session;
  }
  
  async getSession(token: string): Promise<Session | undefined> {
    const now = new Date();
    
    return Array.from(this.sessions.values()).find(
      (session) => 
        session.token === token && 
        session.isValid && 
        session.expiresAt > now
    );
  }
  
  async invalidateSession(token: string): Promise<boolean> {
    const session = await this.getSession(token);
    if (!session) return false;
    
    // Mark session as invalid
    session.isValid = false;
    session.lastActivity = new Date();
    this.sessions.set(session.id, session);
    
    // Log session invalidation
    await this.createActivityLog({
      action: "Session Invalidated",
      description: `Session invalidated for user: ${session.userId}`,
      referenceType: "session",
      referenceId: session.id,
      userId: session.userId
    });
    
    return true;
  }
  
  async invalidateAllUserSessions(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;
    
    const userSessions = Array.from(this.sessions.values()).filter(
      (session) => session.userId === userId && session.isValid
    );
    
    if (userSessions.length === 0) return false;
    
    for (const session of userSessions) {
      session.isValid = false;
      session.lastActivity = new Date();
      this.sessions.set(session.id, session);
    }
    
    // Log all sessions invalidation
    await this.createActivityLog({
      action: "All Sessions Invalidated",
      description: `All sessions invalidated for user: ${user.username}`,
      referenceType: "user",
      referenceId: userId,
      userId
    });
    
    return true;
  }
  
  async cleanExpiredSessions(): Promise<void> {
    const now = new Date();
    
    const expiredSessions = Array.from(this.sessions.values()).filter(
      (session) => session.expiresAt <= now
    );
    
    for (const session of expiredSessions) {
      session.isValid = false;
      session.lastActivity = now;
      this.sessions.set(session.id, session);
    }
  }
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const now = new Date();
    const user: User = { 
      ...insertUser, 
      id,
      createdAt: now,
      updatedAt: now,
      email: insertUser.email || null,
      role: insertUser.role || null,
      warehouseId: null,
      lastLogin: null,
      profilePicture: null,
      preferences: {}
    };
    this.users.set(id, user);
    return user;
  }
  
  async updateUser(id: number, updateData: Partial<InsertUser>): Promise<User | undefined> {
    const existingUser = this.users.get(id);
    if (!existingUser) return undefined;
    
    const updatedUser = { 
      ...existingUser, 
      ...updateData,
      updatedAt: new Date()
    };
    this.users.set(id, updatedUser);
    
    return updatedUser;
  }
  
  /**
   * Update a user's profile picture
   * @param userId ID of the user to update
   * @param profilePictureUrl URL of the new profile picture (or null to remove)
   * @returns The updated user object
   */
  async updateProfilePicture(userId: number, profilePictureUrl: string | null): Promise<User> {
    const existingUser = this.users.get(userId);
    if (!existingUser) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    const updatedUser = { 
      ...existingUser, 
      profilePicture: profilePictureUrl,
      updatedAt: new Date()
    };
    this.users.set(userId, updatedUser);
    
    return updatedUser;
  }
  
  async getUserPreferences(userId: number): Promise<UserPreference | undefined> {
    return Array.from(this.userPreferences.values()).find(
      (pref) => pref.userId === userId
    );
  }
  
  async updateUserPreferences(userId: number, preferences: Partial<InsertUserPreference>): Promise<UserPreference | undefined> {
    let userPref = await this.getUserPreferences(userId);
    
    if (!userPref) {
      // Create new preferences if they don't exist
      const id = this.userPreferenceCurrentId++;
      const now = new Date();
      userPref = {
        id,
        userId,
        theme: preferences.theme || 'light',
        language: preferences.language || 'en',
        notifications: preferences.notifications || false,
        dashboardLayout: preferences.dashboardLayout || {},
        updatedAt: now
      };
      this.userPreferences.set(id, userPref);
    } else {
      // Update existing preferences
      userPref = {
        ...userPref,
        ...preferences,
        updatedAt: new Date()
      };
      this.userPreferences.set(userPref.id, userPref);
    }
    
    return userPref;
  }
  
  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
  
  async deleteUser(id: number): Promise<boolean> {
    // Check if the user exists
    const user = this.users.get(id);
    if (!user) return false;
    
    // Create activity log
    await this.createActivityLog({
      action: "User Deleted",
      description: `Deleted user: ${user.username}`,
      referenceType: "user",
      referenceId: id
    });
    
    return this.users.delete(id);
  }
  
  // Permission methods
  private setupDefaultPermissions() {
    // ==================== STANDARD ROLES ====================
    
    // Admin role permissions (full access to all resources)
    const adminPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.DELETE },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.EXPORT },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.IMPORT },
      
      // Purchases resource permissions
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.DELETE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.APPROVE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.EXPORT },
      
      // Suppliers resource permissions
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.DELETE },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Categories resource permissions
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.DELETE },
      
      // Warehouses resource permissions
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.DELETE },
      
      // Reports resource permissions
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Users resource permissions
      { resource: ResourceEnum.USERS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.USERS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.USERS, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.USERS, permissionType: PermissionTypeEnum.DELETE },
      { resource: ResourceEnum.USERS, permissionType: PermissionTypeEnum.ASSIGN },
      
      // Settings resource permissions
      { resource: ResourceEnum.SETTINGS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.SETTINGS, permissionType: PermissionTypeEnum.UPDATE },
      
      // Reorder Requests resource permissions
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.DELETE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.APPROVE },
      
      // Stock Movements resource permissions
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.EXPORT }
    ];
    
    // Manager role permissions (extensive but not full access)
    const managerPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.EXPORT },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.IMPORT },
      
      // Purchases resource permissions
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.APPROVE },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.EXPORT },
      
      // Suppliers resource permissions
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Categories resource permissions
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.UPDATE },
      
      // Warehouses resource permissions
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.UPDATE },
      
      // Reports resource permissions
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Users resource permissions
      { resource: ResourceEnum.USERS, permissionType: PermissionTypeEnum.READ },
      
      // Settings resource permissions
      { resource: ResourceEnum.SETTINGS, permissionType: PermissionTypeEnum.READ },
      
      // Reorder Requests resource permissions
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.UPDATE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.APPROVE },
      
      // Stock Movements resource permissions
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.EXPORT }
    ];
    
    // Warehouse Staff role permissions (focused on inventory operations)
    const warehouseStaffPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.UPDATE },
      
      // Purchases resource permissions
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.READ },
      
      // Suppliers resource permissions
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.READ },
      
      // Categories resource permissions
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.READ },
      
      // Warehouses resource permissions
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.READ },
      
      // Reorder Requests resource permissions
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ },
      
      // Stock Movements resource permissions
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.READ }
    ];
    
    // Viewer role permissions (read-only access)
    const viewerPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      
      // Purchases resource permissions
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.READ },
      
      // Suppliers resource permissions
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.READ },
      
      // Categories resource permissions
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.READ },
      
      // Warehouses resource permissions
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.READ },
      
      // Reports resource permissions
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.READ },
      
      // Reorder Requests resource permissions
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ },
      
      // Stock Movements resource permissions
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.READ }
    ];
    
    // ==================== ADDITIONAL ROLES ====================
    
    // Sales Team role permissions (focus on inventory and customers)
    const salesTeamPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.EXPORT },
      
      // Categories resource permissions
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.READ },
      
      // Warehouses resource permissions
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.READ },
      
      // Reports resource permissions
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Reorder Requests resource permissions
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.CREATE },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ }
    ];
    
    // Auditor role permissions (focused on reporting and history)
    const auditorPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.EXPORT },
      
      // Purchases resource permissions
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.EXPORT },
      
      // Suppliers resource permissions
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.SUPPLIERS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Categories resource permissions
      { resource: ResourceEnum.CATEGORIES, permissionType: PermissionTypeEnum.READ },
      
      // Warehouses resource permissions
      { resource: ResourceEnum.WAREHOUSES, permissionType: PermissionTypeEnum.READ },
      
      // Reports resource permissions
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REPORTS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Reorder Requests resource permissions
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.EXPORT },
      
      // Stock Movements resource permissions
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.READ },
      { resource: ResourceEnum.STOCK_MOVEMENTS, permissionType: PermissionTypeEnum.EXPORT }
    ];
    
    // Supplier role permissions (limited to their own inventory)
    const supplierPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions (limited)
      { resource: ResourceEnum.INVENTORY, permissionType: PermissionTypeEnum.READ },
      
      // Purchases resource permissions (limited to their own POs)
      { resource: ResourceEnum.PURCHASES, permissionType: PermissionTypeEnum.READ },
      
      // Reorder Requests resource permissions (limited to relevant items)
      { resource: ResourceEnum.REORDER_REQUESTS, permissionType: PermissionTypeEnum.READ }
    ];
    
    // ==================== CREATE PERMISSIONS ====================
    
    // Create admin permissions
    for (const permission of adminPermissions) {
      this.createPermission({
        role: UserRoleEnum.ADMIN,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // Create manager permissions
    for (const permission of managerPermissions) {
      this.createPermission({
        role: UserRoleEnum.MANAGER,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // Create warehouse staff permissions
    for (const permission of warehouseStaffPermissions) {
      this.createPermission({
        role: UserRoleEnum.WAREHOUSE_STAFF,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // Create viewer permissions
    for (const permission of viewerPermissions) {
      this.createPermission({
        role: UserRoleEnum.VIEWER,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // ==================== SETUP DEFAULT CUSTOM ROLES ====================
    
    // Create Sales Team as a default custom role
    this.createCustomRole({
      name: "Sales Team",
      description: "Role for sales personnel with access to inventory information and ability to place reorder requests",
      createdBy: 1, // System user ID
      isActive: true
    }).then(salesTeamRole => {
      for (const permission of salesTeamPermissions) {
        this.createCustomRolePermission({
          roleId: salesTeamRole.id,
          resource: permission.resource,
          permissionType: permission.permissionType
        });
      }
    });
    
    // Create Auditor as a default custom role
    this.createCustomRole({
      name: "Auditor",
      description: "Role for auditors with read and export access to all resources for compliance and financial review",
      createdBy: 1, // System user ID
      isActive: true
    }).then(auditorRole => {
      for (const permission of auditorPermissions) {
        this.createCustomRolePermission({
          roleId: auditorRole.id,
          resource: permission.resource,
          permissionType: permission.permissionType
        });
      }
    });
    
    // Create Supplier as a default custom role
    this.createCustomRole({
      name: "Supplier",
      description: "Role for external suppliers with limited access to view relevant inventory, purchase orders, and reorder requests",
      createdBy: 1, // System user ID
      isActive: true
    }).then(supplierRole => {
      for (const permission of supplierPermissions) {
        this.createCustomRolePermission({
          roleId: supplierRole.id,
          resource: permission.resource,
          permissionType: permission.permissionType
        });
      }
    });
  }
  
  async getAllPermissions(): Promise<Permission[]> {
    return Array.from(this.permissions.values());
  }
  
  async getPermission(id: number): Promise<Permission | undefined> {
    return this.permissions.get(id);
  }
  
  async getPermissionsByRole(role: UserRole): Promise<Permission[]> {
    return Array.from(this.permissions.values())
      .filter(permission => permission.role === role);
  }
  
  async getPermissionsByResource(resource: Resource): Promise<Permission[]> {
    return Array.from(this.permissions.values())
      .filter(permission => permission.resource === resource);
  }
  
  async checkPermission(role: UserRole, resource: Resource, permissionType: PermissionType): Promise<boolean> {
    // Admin always has access to everything
    if (role === UserRoleEnum.ADMIN) return true;
    
    const foundPermission = Array.from(this.permissions.values())
      .find(p => p.role === role && p.resource === resource && p.permissionType === permissionType);
      
    return !!foundPermission;
  }
  
  createPermission(insertPermission: InsertPermission): Permission {
    const id = this.permissionCurrentId++;
    const now = new Date();
    
    const permission: Permission = {
      ...insertPermission,
      id,
      createdAt: now,
      updatedAt: now
    };
    
    this.permissions.set(id, permission);
    
    return permission;
  }
  
  async updatePermission(id: number, updateData: Partial<InsertPermission>): Promise<Permission | undefined> {
    const existingPermission = this.permissions.get(id);
    
    if (!existingPermission) return undefined;
    
    const updatedPermission = {
      ...existingPermission,
      ...updateData,
      updatedAt: new Date()
    };
    
    this.permissions.set(id, updatedPermission);
    
    return updatedPermission;
  }
  
  async deletePermission(id: number): Promise<boolean> {
    return this.permissions.delete(id);
  }
  
  // Category methods
  async getAllCategories(): Promise<Category[]> {
    return Array.from(this.categories.values());
  }
  
  async getCategory(id: number): Promise<Category | undefined> {
    return this.categories.get(id);
  }
  
  async getCategoryByName(name: string): Promise<Category | undefined> {
    return Array.from(this.categories.values()).find(
      (category) => category.name.toLowerCase() === name.toLowerCase(),
    );
  }
  
  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const id = this.categoryCurrentId++;
    const category: Category = { 
      ...insertCategory, 
      id,
      description: insertCategory.description || null
    };
    this.categories.set(id, category);
    return category;
  }
  
  async updateCategory(id: number, updateData: Partial<InsertCategory>): Promise<Category | undefined> {
    const existingCategory = this.categories.get(id);
    if (!existingCategory) return undefined;
    
    const updatedCategory = { ...existingCategory, ...updateData };
    this.categories.set(id, updatedCategory);
    return updatedCategory;
  }
  
  async deleteCategory(id: number): Promise<boolean> {
    return this.categories.delete(id);
  }
  
  // Supplier methods
  async getAllSuppliers(): Promise<Supplier[]> {
    return Array.from(this.suppliers.values());
  }
  
  async getSupplier(id: number): Promise<Supplier | undefined> {
    return this.suppliers.get(id);
  }
  
  async getSupplierByName(name: string): Promise<Supplier | undefined> {
    return Array.from(this.suppliers.values()).find(
      (supplier) => supplier.name.toLowerCase() === name.toLowerCase()
    );
  }
  
  // Warehouse methods
  async getAllWarehouses(): Promise<Warehouse[]> {
    return Array.from(this.warehouses.values());
  }
  
  async getWarehouse(id: number): Promise<Warehouse | undefined> {
    return this.warehouses.get(id);
  }
  
  async getDefaultWarehouse(): Promise<Warehouse | undefined> {
    return Array.from(this.warehouses.values()).find(warehouse => warehouse.isDefault);
  }
  
  async createWarehouse(insertWarehouse: InsertWarehouse): Promise<Warehouse> {
    const id = this.warehouseCurrentId++;
    const now = new Date();
    const warehouse: Warehouse = {
      ...insertWarehouse,
      id,
      createdAt: now,
      updatedAt: now,
      address: insertWarehouse.address || null,
      location: insertWarehouse.location || null,
      contactPerson: insertWarehouse.contactPerson || null,
      contactPhone: insertWarehouse.contactPhone || null,
      isDefault: insertWarehouse.isDefault || false
    };
    
    // If this is marked as default, update other warehouses
    if (warehouse.isDefault) {
      for (const [wId, w] of this.warehouses.entries()) {
        if (w.isDefault) {
          this.warehouses.set(wId, { ...w, isDefault: false });
        }
      }
    }
    
    this.warehouses.set(id, warehouse);
    
    // Create activity log
    await this.createActivityLog({
      action: "Warehouse Created",
      description: `Added warehouse: ${warehouse.name}`,
      referenceType: "warehouse",
      referenceId: warehouse.id
    });
    
    return warehouse;
  }
  
  async updateWarehouse(id: number, updateData: Partial<InsertWarehouse>): Promise<Warehouse | undefined> {
    const existingWarehouse = this.warehouses.get(id);
    if (!existingWarehouse) return undefined;
    
    const updatedWarehouse = {
      ...existingWarehouse,
      ...updateData,
      updatedAt: new Date()
    };
    
    // If this is being marked as default, update other warehouses
    if (updateData.isDefault) {
      for (const [wId, w] of this.warehouses.entries()) {
        if (wId !== id && w.isDefault) {
          this.warehouses.set(wId, { ...w, isDefault: false });
        }
      }
    }
    
    this.warehouses.set(id, updatedWarehouse);
    
    // Create activity log
    await this.createActivityLog({
      action: "Warehouse Updated",
      description: `Updated warehouse: ${updatedWarehouse.name}`,
      referenceType: "warehouse",
      referenceId: updatedWarehouse.id
    });
    
    return updatedWarehouse;
  }
  
  async deleteWarehouse(id: number): Promise<boolean> {
    const warehouse = this.warehouses.get(id);
    if (!warehouse) return false;
    
    // Check if this is the default warehouse
    if (warehouse.isDefault) {
      // Can't delete the default warehouse unless it's the only one
      if (this.warehouses.size > 1) {
        return false;
      }
    }
    
    // Check if any items are stored in this warehouse
    const warehouseInventory = Array.from(this.warehouseInventory.values())
      .filter(wi => wi.warehouseId === id);
    
    if (warehouseInventory.length > 0) {
      // Warehouse has items, can't delete
      return false;
    }
    
    // Check if any users are assigned to this warehouse
    const assignedUsers = Array.from(this.users.values())
      .filter(user => user.warehouseId === id);
    
    if (assignedUsers.length > 0) {
      // Users are assigned to this warehouse, can't delete
      return false;
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Warehouse Deleted",
      description: `Removed warehouse: ${warehouse.name}`,
      referenceType: "warehouse",
      referenceId: warehouse.id
    });
    
    return this.warehouses.delete(id);
  }
  
  async setDefaultWarehouse(id: number): Promise<Warehouse | undefined> {
    const warehouse = this.warehouses.get(id);
    if (!warehouse) return undefined;
    
    // Already the default
    if (warehouse.isDefault) return warehouse;
    
    // Update current default warehouse(s)
    for (const [wId, w] of this.warehouses.entries()) {
      if (wId !== id && w.isDefault) {
        this.warehouses.set(wId, { ...w, isDefault: false });
      }
    }
    
    // Set this warehouse as default
    const updatedWarehouse = { ...warehouse, isDefault: true };
    this.warehouses.set(id, updatedWarehouse);
    
    // Create activity log
    await this.createActivityLog({
      action: "Default Warehouse Changed",
      description: `Set ${updatedWarehouse.name} as the default warehouse`,
      referenceType: "warehouse",
      referenceId: updatedWarehouse.id
    });
    
    return updatedWarehouse;
  }
  
  // Warehouse inventory methods
  async getWarehouseInventory(warehouseId: number): Promise<WarehouseInventory[]> {
    return Array.from(this.warehouseInventory.values())
      .filter(wi => wi.warehouseId === warehouseId);
  }
  
  async getWarehouseInventoryItem(warehouseId: number, itemId: number): Promise<WarehouseInventory | undefined> {
    return Array.from(this.warehouseInventory.values())
      .find(wi => wi.warehouseId === warehouseId && wi.itemId === itemId);
  }
  
  async getItemWarehouseInventory(itemId: number): Promise<WarehouseInventory[]> {
    return Array.from(this.warehouseInventory.values())
      .filter(wi => wi.itemId === itemId);
  }
  
  async createWarehouseInventory(insertWI: InsertWarehouseInventory): Promise<WarehouseInventory> {
    const id = this.warehouseInventoryCurrentId++;
    const now = new Date();
    const wi: WarehouseInventory = {
      ...insertWI,
      id,
      updatedAt: now,
      quantity: insertWI.quantity || 0,
      location: insertWI.location || null,
      aisle: insertWI.aisle || null,
      bin: insertWI.bin || null
    };
    this.warehouseInventory.set(id, wi);
    
    // Create activity log
    const warehouse = await this.getWarehouse(wi.warehouseId);
    const item = await this.getInventoryItem(wi.itemId);
    
    if (warehouse && item) {
      await this.createActivityLog({
        action: "Warehouse Inventory Created",
        description: `Added ${item.name} to ${warehouse.name} (Quantity: ${wi.quantity})`,
        referenceType: "warehouse_inventory",
        referenceId: wi.id,
        itemId: item.id
      });
    }
    
    return wi;
  }
  
  async updateWarehouseInventory(id: number, updateData: Partial<InsertWarehouseInventory>): Promise<WarehouseInventory | undefined> {
    const existingWI = this.warehouseInventory.get(id);
    if (!existingWI) return undefined;
    
    const updatedWI = {
      ...existingWI,
      ...updateData,
      updatedAt: new Date()
    };
    this.warehouseInventory.set(id, updatedWI);
    
    // Create activity log
    const warehouse = await this.getWarehouse(updatedWI.warehouseId);
    const item = await this.getInventoryItem(updatedWI.itemId);
    
    if (warehouse && item && updateData.quantity !== undefined) {
      const quantityDiff = updateData.quantity - existingWI.quantity;
      const action = quantityDiff > 0 ? "Increased" : "Decreased";
      
      await this.createActivityLog({
        action: `Warehouse Inventory ${action}`,
        description: `${action} ${item.name} in ${warehouse.name} by ${Math.abs(quantityDiff)} (New total: ${updatedWI.quantity})`,
        referenceType: "warehouse_inventory",
        referenceId: updatedWI.id,
        itemId: item.id
      });
    }
    
    return updatedWI;
  }
  
  async deleteWarehouseInventory(id: number): Promise<boolean> {
    const wi = this.warehouseInventory.get(id);
    if (!wi) return false;
    
    // Create activity log
    const warehouse = await this.getWarehouse(wi.warehouseId);
    const item = await this.getInventoryItem(wi.itemId);
    
    if (warehouse && item) {
      await this.createActivityLog({
        action: "Warehouse Inventory Removed",
        description: `Removed ${item.name} from ${warehouse.name}`,
        referenceType: "warehouse_inventory",
        referenceId: wi.id,
        itemId: item.id
      });
    }
    
    return this.warehouseInventory.delete(id);
  }
  
  // Stock movement methods
  async getAllStockMovements(options?: {
    warehouseId?: number;
    itemId?: number;
    startDate?: Date;
    endDate?: Date;
    type?: string;
  }): Promise<StockMovement[]> {
    let movements = Array.from(this.stockMovements.values());
    
    if (options) {
      if (options.warehouseId !== undefined) {
        movements = movements.filter(m => 
          m.sourceWarehouseId === options.warehouseId || 
          m.destinationWarehouseId === options.warehouseId
        );
      }
      
      if (options.itemId !== undefined) {
        movements = movements.filter(m => m.itemId === options.itemId);
      }
      
      if (options.startDate) {
        movements = movements.filter(m => m.timestamp >= options.startDate!);
      }
      
      if (options.endDate) {
        movements = movements.filter(m => m.timestamp <= options.endDate!);
      }
      
      if (options.type) {
        movements = movements.filter(m => m.type === options.type);
      }
    }
    
    // Sort by timestamp (newest first)
    return movements.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  async getStockMovement(id: number): Promise<StockMovement | undefined> {
    return this.stockMovements.get(id);
  }
  
  async getStockMovementsByItemId(itemId: number): Promise<StockMovement[]> {
    return this.getAllStockMovements({ itemId });
  }
  
  async getStockMovementsByWarehouseId(warehouseId: number): Promise<StockMovement[]> {
    return this.getAllStockMovements({ warehouseId });
  }
  
  async createStockMovement(insertMovement: InsertStockMovement): Promise<StockMovement> {
    const id = this.stockMovementCurrentId++;
    const now = new Date();
    
    // Create the stock movement record
    const movement: StockMovement = {
      ...insertMovement,
      id,
      timestamp: insertMovement.timestamp || now,
      createdAt: now,
      notes: insertMovement.notes || null,
      referenceId: insertMovement.referenceId || null,
      referenceType: insertMovement.referenceType || null,
      sourceWarehouseId: insertMovement.sourceWarehouseId || null,
      destinationWarehouseId: insertMovement.destinationWarehouseId || null,
      previousQuantity: null,
      newQuantity: null,
      warehouseId: insertMovement.warehouseId || null,
      unitCost: insertMovement.unitCost || null,
      userId: insertMovement.userId || null
    };
    
    this.stockMovements.set(id, movement);
    
    // Get the inventory item
    const item = await this.getInventoryItem(movement.itemId);
    if (!item) {
      throw new Error(`Item with ID ${movement.itemId} not found`);
    }
    
    // Handle different movement types
    switch (movement.type) {
      case 'RECEIPT':
        // Increment quantity in destination warehouse (if specified)
        if (movement.destinationWarehouseId) {
          const existingWI = await this.getWarehouseInventoryItem(
            movement.destinationWarehouseId, 
            movement.itemId
          );
          
          if (existingWI) {
            await this.updateWarehouseInventory(existingWI.id, {
              quantity: existingWI.quantity + movement.quantity
            });
          } else {
            await this.createWarehouseInventory({
              warehouseId: movement.destinationWarehouseId,
              itemId: movement.itemId,
              quantity: movement.quantity,
              location: null
            });
          }
        }
        
        // Update overall inventory
        await this.updateInventoryItem(movement.itemId, {
          quantity: item.quantity + movement.quantity
        });
        break;
        
      case 'ISSUE':
        // Decrement quantity in source warehouse (if specified)
        if (movement.sourceWarehouseId) {
          const existingWI = await this.getWarehouseInventoryItem(
            movement.sourceWarehouseId, 
            movement.itemId
          );
          
          if (existingWI) {
            if (existingWI.quantity >= movement.quantity) {
              await this.updateWarehouseInventory(existingWI.id, {
                quantity: existingWI.quantity - movement.quantity
              });
            } else {
              throw new Error(`Insufficient quantity in warehouse`);
            }
          } else {
            throw new Error(`Item not found in source warehouse`);
          }
        }
        
        // Update overall inventory
        if (item.quantity >= movement.quantity) {
          await this.updateInventoryItem(movement.itemId, {
            quantity: item.quantity - movement.quantity
          });
        } else {
          throw new Error(`Insufficient overall quantity`);
        }
        break;
        
      case 'TRANSFER':
        // Need both source and destination warehouses
        if (!movement.sourceWarehouseId || !movement.destinationWarehouseId) {
          throw new Error(`Both source and destination warehouses are required for transfers`);
        }
        
        // Check source warehouse inventory
        const sourceWI = await this.getWarehouseInventoryItem(
          movement.sourceWarehouseId, 
          movement.itemId
        );
        
        if (!sourceWI || sourceWI.quantity < movement.quantity) {
          throw new Error(`Insufficient quantity in source warehouse`);
        }
        
        // Decrement from source warehouse
        await this.updateWarehouseInventory(sourceWI.id, {
          quantity: sourceWI.quantity - movement.quantity
        });
        
        // Increment in destination warehouse
        const destWI = await this.getWarehouseInventoryItem(
          movement.destinationWarehouseId, 
          movement.itemId
        );
        
        if (destWI) {
          await this.updateWarehouseInventory(destWI.id, {
            quantity: destWI.quantity + movement.quantity
          });
        } else {
          await this.createWarehouseInventory({
            warehouseId: movement.destinationWarehouseId,
            itemId: movement.itemId,
            quantity: movement.quantity,
            location: null
          });
        }
        
        // Overall quantity doesn't change for transfers
        break;
        
      case 'ADJUSTMENT':
        // Adjust quantity in specific warehouse (if specified)
        if (movement.destinationWarehouseId) {
          const existingWI = await this.getWarehouseInventoryItem(
            movement.destinationWarehouseId, 
            movement.itemId
          );
          
          if (existingWI) {
            await this.updateWarehouseInventory(existingWI.id, {
              quantity: existingWI.quantity + movement.quantity // Can be negative for reductions
            });
          } else if (movement.quantity > 0) {
            await this.createWarehouseInventory({
              warehouseId: movement.destinationWarehouseId,
              itemId: movement.itemId,
              quantity: movement.quantity,
              location: null
            });
          }
        }
        
        // Update overall inventory
        await this.updateInventoryItem(movement.itemId, {
          quantity: item.quantity + movement.quantity // Can be negative for reductions
        });
        break;
    }
    
    // Create activity log
    let description = '';
    switch (movement.type) {
      case 'RECEIPT':
        description = `Received ${movement.quantity} of ${item.name}`;
        if (movement.destinationWarehouseId) {
          const warehouse = await this.getWarehouse(movement.destinationWarehouseId);
          if (warehouse) {
            description += ` into ${warehouse.name}`;
          }
        }
        break;
        
      case 'ISSUE':
        description = `Issued ${movement.quantity} of ${item.name}`;
        if (movement.sourceWarehouseId) {
          const warehouse = await this.getWarehouse(movement.sourceWarehouseId);
          if (warehouse) {
            description += ` from ${warehouse.name}`;
          }
        }
        break;
        
      case 'TRANSFER':
        description = `Transferred ${movement.quantity} of ${item.name}`;
        if (movement.sourceWarehouseId && movement.destinationWarehouseId) {
          const sourceWarehouse = await this.getWarehouse(movement.sourceWarehouseId);
          const destWarehouse = await this.getWarehouse(movement.destinationWarehouseId);
          if (sourceWarehouse && destWarehouse) {
            description += ` from ${sourceWarehouse.name} to ${destWarehouse.name}`;
          }
        }
        break;
        
      case 'ADJUSTMENT':
        const action = movement.quantity >= 0 ? 'Increased' : 'Decreased';
        description = `${action} ${item.name} by ${Math.abs(movement.quantity)}`;
        if (movement.destinationWarehouseId) {
          const warehouse = await this.getWarehouse(movement.destinationWarehouseId);
          if (warehouse) {
            description += ` in ${warehouse.name}`;
          }
        }
        break;
    }
    
    await this.createActivityLog({
      action: `Stock ${movement.type}`,
      description,
      referenceType: "stock_movement",
      referenceId: movement.id,
      itemId: movement.itemId
    });
    
    return movement;
  }
  
  async transferStock(
    sourceWarehouseId: number, 
    destinationWarehouseId: number, 
    itemId: number, 
    quantity: number, 
    userId?: number,
    reason?: string
  ): Promise<StockMovement> {
    // Verify warehouses exist
    const sourceWarehouse = await this.getWarehouse(sourceWarehouseId);
    if (!sourceWarehouse) {
      throw new Error("Source warehouse not found");
    }
    
    const destinationWarehouse = await this.getWarehouse(destinationWarehouseId);
    if (!destinationWarehouse) {
      throw new Error("Destination warehouse not found");
    }
    
    // Verify item exists
    const item = await this.getInventoryItem(itemId);
    if (!item) {
      throw new Error("Inventory item not found");
    }
    
    // Check if item exists in source warehouse inventory
    const sourceInventory = await this.getWarehouseInventoryItem(sourceWarehouseId, itemId);
    if (!sourceInventory) {
      throw new Error("Item not found in source warehouse inventory");
    }
    
    if (sourceInventory.quantity < quantity) {
      throw new Error("Insufficient quantity in source warehouse");
    }
    
    // Update source warehouse inventory (decrease quantity)
    const updatedSourceInventory = await this.updateWarehouseInventory(
      sourceInventory.id,
      { quantity: sourceInventory.quantity - quantity }
    );
    
    // Check if item exists in destination warehouse inventory
    let destinationInventory = await this.getWarehouseInventoryItem(destinationWarehouseId, itemId);
    
    if (destinationInventory) {
      // Update destination warehouse inventory (increase quantity)
      await this.updateWarehouseInventory(
        destinationInventory.id,
        { quantity: destinationInventory.quantity + quantity }
      );
    } else {
      // Create new inventory record for this item in the destination warehouse
      await this.createWarehouseInventory({
        warehouseId: destinationWarehouseId,
        itemId: itemId,
        quantity: quantity,
        location: null // Default location
      });
    }
    
    // Create stock movement record with TRANSFER type
    const movement = await this.createStockMovement({
      itemId,
      quantity,
      type: "TRANSFER",
      warehouseId: null, // Not using this since we have source and destination
      userId: userId || null,
      referenceId: null,
      referenceType: null,
      unitCost: null,
      notes: reason 
        ? `Transfer from ${sourceWarehouse.name} to ${destinationWarehouse.name}: ${reason}` 
        : `Transfer from ${sourceWarehouse.name} to ${destinationWarehouse.name}`,
      sourceWarehouseId,
      destinationWarehouseId
    });
    
    // Log activity
    await this.createActivityLog({
      action: "STOCK_TRANSFER",
      description: reason 
        ? `Transferred ${quantity} units of ${item.name} from ${sourceWarehouse.name} to ${destinationWarehouse.name}: ${reason}` 
        : `Transferred ${quantity} units of ${item.name} from ${sourceWarehouse.name} to ${destinationWarehouse.name}`,
      referenceType: "stock_movement",
      referenceId: movement.id,
      itemId: item.id
    });
    
    return movement;
  }
  
  async createSupplier(insertSupplier: InsertSupplier): Promise<Supplier> {
    const id = this.supplierCurrentId++;
    const now = new Date();
    const supplier: Supplier = {
      ...insertSupplier,
      id,
      email: insertSupplier.email || null,
      contactName: insertSupplier.contactName || null,
      phone: insertSupplier.phone || null,
      address: insertSupplier.address || null,
      notes: insertSupplier.notes || null,
      createdAt: now,
      updatedAt: now
    };
    this.suppliers.set(id, supplier);
    
    // Create activity log for new supplier
    await this.createActivityLog({
      action: "Supplier Created",
      description: `Added ${supplier.name} as a supplier`,
      referenceType: "supplier",
      referenceId: supplier.id
    });
    
    return supplier;
  }
  
  async updateSupplier(id: number, updateData: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const existingSupplier = this.suppliers.get(id);
    if (!existingSupplier) return undefined;
    
    const updatedSupplier = {
      ...existingSupplier,
      ...updateData,
      updatedAt: new Date()
    };
    this.suppliers.set(id, updatedSupplier);
    
    // Create activity log for update
    await this.createActivityLog({
      action: "Supplier Updated",
      description: `Updated supplier: ${updatedSupplier.name}`,
      referenceType: "supplier",
      referenceId: updatedSupplier.id
    });
    
    return updatedSupplier;
  }
  
  async deleteSupplier(id: number): Promise<boolean> {
    const supplier = this.suppliers.get(id);
    if (!supplier) return false;
    
    // Check if any inventory items are linked to this supplier
    const linkedItems = Array.from(this.inventoryItems.values())
      .filter(item => item.supplierId === id);
    
    if (linkedItems.length > 0) {
      // In a real application, you might want to handle this differently
      // For example, set the supplierId to null for these items
      linkedItems.forEach(item => {
        this.updateInventoryItem(item.id, { supplierId: null });
      });
    }
    
    // Create activity log for deletion
    await this.createActivityLog({
      action: "Supplier Deleted",
      description: `Removed supplier: ${supplier.name}`,
      referenceType: "supplier",
      referenceId: supplier.id
    });
    
    return this.suppliers.delete(id);
  }
  
  // Inventory item methods
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    return Array.from(this.inventoryItems.values());
  }
  
  async getInventoryItem(id: number): Promise<InventoryItem | undefined> {
    return this.inventoryItems.get(id);
  }
  
  async getInventoryItemBySku(sku: string): Promise<InventoryItem | undefined> {
    return Array.from(this.inventoryItems.values()).find(
      (item) => item.sku.toLowerCase() === sku.toLowerCase(),
    );
  }
  
  // Barcode methods
  async getAllBarcodes(): Promise<Barcode[]> {
    return Array.from(this.barcodes.values());
  }
  
  async getBarcode(id: number): Promise<Barcode | undefined> {
    return this.barcodes.get(id);
  }
  
  async getBarcodesByItemId(itemId: number): Promise<Barcode[]> {
    return Array.from(this.barcodes.values())
      .filter(barcode => barcode.itemId === itemId);
  }
  
  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    return Array.from(this.barcodes.values())
      .find(barcode => barcode.value === value);
  }
  
  async createBarcode(insertBarcode: InsertBarcode): Promise<Barcode> {
    // Check if barcode already exists
    const existingBarcode = await this.getBarcodeByValue(insertBarcode.value);
    if (existingBarcode) {
      throw new Error(`Barcode with value ${insertBarcode.value} already exists`);
    }
    
    const id = this.barcodeCurrentId++;
    const now = new Date();
    const barcode: Barcode = {
      ...insertBarcode,
      id,
      createdAt: now,
      type: insertBarcode.type || null,
      isPrimary: insertBarcode.isPrimary || false
    };
    this.barcodes.set(id, barcode);
    
    // Create activity log
    const item = await this.getInventoryItem(barcode.itemId);
    if (item) {
      await this.createActivityLog({
        action: "Barcode Created",
        description: `Added ${barcode.type || 'standard'} barcode ${barcode.value} for ${item.name}`,
        referenceType: "barcode",
        referenceId: barcode.id,
        itemId: item.id
      });
    }
    
    return barcode;
  }
  
  async updateBarcode(id: number, updateData: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    const existingBarcode = this.barcodes.get(id);
    if (!existingBarcode) return undefined;
    
    // If value is being updated, make sure it doesn't conflict
    if (updateData.value && updateData.value !== existingBarcode.value) {
      const conflictBarcode = await this.getBarcodeByValue(updateData.value);
      if (conflictBarcode) {
        throw new Error(`Barcode with value ${updateData.value} already exists`);
      }
    }
    
    const updatedBarcode = {
      ...existingBarcode,
      ...updateData,
      updatedAt: new Date()
    };
    this.barcodes.set(id, updatedBarcode);
    
    // Create activity log
    const item = await this.getInventoryItem(updatedBarcode.itemId);
    if (item) {
      await this.createActivityLog({
        action: "Barcode Updated",
        description: `Updated barcode for ${item.name}`,
        referenceType: "barcode",
        referenceId: updatedBarcode.id,
        itemId: item.id
      });
    }
    
    return updatedBarcode;
  }
  
  async deleteBarcode(id: number): Promise<boolean> {
    const barcode = this.barcodes.get(id);
    if (!barcode) return false;
    
    // Create activity log
    const item = await this.getInventoryItem(barcode.itemId);
    if (item) {
      await this.createActivityLog({
        action: "Barcode Deleted",
        description: `Removed ${barcode.type || 'standard'} barcode ${barcode.value} from ${item.name}`,
        referenceType: "barcode",
        referenceId: barcode.id,
        itemId: item.id
      });
    }
    
    return this.barcodes.delete(id);
  }
  
  async findItemByBarcode(barcodeValue: string): Promise<InventoryItem | undefined> {
    const barcode = await this.getBarcodeByValue(barcodeValue);
    if (!barcode) return undefined;
    
    return this.getInventoryItem(barcode.itemId);
  }
  
  async createInventoryItem(insertItem: InsertInventoryItem): Promise<InventoryItem> {
    const id = this.itemCurrentId++;
    const now = new Date();
    const item: InventoryItem = { 
      ...insertItem, 
      id,
      createdAt: now,
      updatedAt: now
    };
    this.inventoryItems.set(id, item);
    
    // Create activity log for new item
    await this.createActivityLog({
      action: "Item Created",
      description: `Added ${item.name} (SKU: ${item.sku})`,
      itemId: item.id
    });
    
    return item;
  }
  
  async updateInventoryItem(id: number, updateData: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined> {
    const existingItem = this.inventoryItems.get(id);
    if (!existingItem) return undefined;
    
    const updatedItem = { 
      ...existingItem, 
      ...updateData,
      updatedAt: new Date()
    };
    this.inventoryItems.set(id, updatedItem);
    
    // Create activity log for update
    await this.createActivityLog({
      action: "Item Updated",
      description: `Updated ${updatedItem.name} (SKU: ${updatedItem.sku})`,
      itemId: updatedItem.id
    });
    
    return updatedItem;
  }
  
  async deleteInventoryItem(id: number): Promise<boolean> {
    const item = this.inventoryItems.get(id);
    if (!item) return false;
    
    // Create activity log for deletion
    await this.createActivityLog({
      action: "Item Deleted",
      description: `Removed ${item.name} (SKU: ${item.sku})`,
      itemId: item.id
    });
    
    return this.inventoryItems.delete(id);
  }
  
  async searchInventoryItems(query: string, categoryId?: number): Promise<InventoryItem[]> {
    const lowerQuery = query.toLowerCase();
    
    return Array.from(this.inventoryItems.values()).filter(item => {
      const matchesQuery = 
        item.name.toLowerCase().includes(lowerQuery) ||
        item.sku.toLowerCase().includes(lowerQuery) ||
        (item.description && item.description.toLowerCase().includes(lowerQuery));
      
      const matchesCategory = categoryId ? item.categoryId === categoryId : true;
      
      return matchesQuery && matchesCategory;
    });
  }
  
  async getLowStockItems(): Promise<InventoryItem[]> {
    return Array.from(this.inventoryItems.values()).filter(item => 
      item.quantity > 0 && item.quantity <= item.lowStockThreshold
    );
  }
  
  async getOutOfStockItems(): Promise<InventoryItem[]> {
    return Array.from(this.inventoryItems.values()).filter(item => 
      item.quantity === 0
    );
  }
  
  async getInventoryStats(): Promise<InventoryStats> {
    const items = Array.from(this.inventoryItems.values());
    
    // Calculate total inventory value (price * quantity)
    const inventoryValue = items.reduce((total, item) => 
      total + (item.price * item.quantity), 0
    );
    
    return {
      totalItems: items.length,
      lowStockItems: items.filter(item => 
        item.quantity > 0 && item.quantity <= (item.lowStockThreshold || 0)
      ).length,
      outOfStockItems: items.filter(item => item.quantity === 0).length,
      inventoryValue: Number(inventoryValue.toFixed(2))
    };
  }
  
  async bulkImportInventory(items: BulkImportInventory): Promise<{
    created: InventoryItem[];
    updated: InventoryItem[];
    errors: { row: number; sku: string; message: string }[];
  }> {
    const result = {
      created: [] as InventoryItem[],
      updated: [] as InventoryItem[],
      errors: [] as { row: number; sku: string; message: string }[]
    };
    
    await Promise.all(items.map(async (importItem, index) => {
      try {
        // Check if item with this SKU already exists
        const existingItem = await this.getInventoryItemBySku(importItem.sku);
        
        // Process category if provided
        let categoryId: number | null = null;
        if (importItem.category) {
          let category = await this.getCategoryByName(importItem.category);
          if (!category) {
            // Create the category if it doesn't exist
            category = await this.createCategory({
              name: importItem.category,
              description: `Category for ${importItem.category} items`
            });
          }
          categoryId = category.id;
        }
        
        // Process supplier if provided
        let supplierId: number | null = null;
        if (importItem.supplier) {
          let supplier = await this.getSupplierByName(importItem.supplier);
          if (!supplier) {
            // Create the supplier if it doesn't exist
            supplier = await this.createSupplier({
              name: importItem.supplier,
              contactName: null,
              email: null,
              phone: null,
              address: null,
              notes: `Supplier for ${importItem.name}`
            });
          }
          supplierId = supplier.id;
        }
        
        if (existingItem) {
          // Update existing item
          const updatedItem = await this.updateInventoryItem(existingItem.id, {
            name: importItem.name,
            description: importItem.description || existingItem.description,
            categoryId: categoryId !== null ? categoryId : existingItem.categoryId,
            quantity: importItem.quantity,
            price: importItem.price,
            cost: importItem.cost !== undefined ? importItem.cost : existingItem.cost,
            lowStockThreshold: importItem.lowStockThreshold !== undefined ? 
              importItem.lowStockThreshold : existingItem.lowStockThreshold,
            location: importItem.location || existingItem.location,
            supplierId: supplierId !== null ? supplierId : existingItem.supplierId
          });
          
          if (updatedItem) {
            result.updated.push(updatedItem);
          }
        } else {
          // Create new item
          const newItem = await this.createInventoryItem({
            name: importItem.name,
            sku: importItem.sku,
            description: importItem.description || null,
            categoryId: categoryId,
            quantity: importItem.quantity,
            price: importItem.price,
            cost: importItem.cost || null,
            lowStockThreshold: importItem.lowStockThreshold || 10,
            location: importItem.location || null,
            supplierId: supplierId
          });
          
          result.created.push(newItem);
        }
      } catch (error) {
        // Add error to the list
        result.errors.push({
          row: index + 1,
          sku: importItem.sku,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }));
    
    // Create activity log for bulk import
    await this.createActivityLog({
      action: "Bulk Import",
      description: `Imported ${result.created.length} new items and updated ${result.updated.length} existing items`,
      itemId: null,
      userId: 1, // Default to the admin user
    });
    
    return result;
  }
  
  // Purchase Requisition methods
  async getAllPurchaseRequisitions(): Promise<PurchaseRequisition[]> {
    return Array.from(this.purchaseRequisitions.values());
  }
  
  async getPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    return this.purchaseRequisitions.get(id);
  }
  
  async getPurchaseRequisitionByNumber(requisitionNumber: string): Promise<PurchaseRequisition | undefined> {
    return Array.from(this.purchaseRequisitions.values()).find(
      (req) => req.requisitionNumber === requisitionNumber
    );
  }
  
  async createPurchaseRequisition(
    requisition: InsertPurchaseRequisition, 
    items: Omit<InsertPurchaseRequisitionItem, "requisitionId">[]
  ): Promise<PurchaseRequisition> {
    const id = this.requisitionCurrentId++;
    const now = new Date();
    
    const requisitionEntity: PurchaseRequisition = {
      ...requisition,
      id,
      createdAt: now,
      updatedAt: now
    };
    
    this.purchaseRequisitions.set(id, requisitionEntity);
    
    // Add the items
    let totalAmount = 0;
    
    for (const item of items) {
      const reqItem = await this.addPurchaseRequisitionItem({
        ...item,
        requisitionId: id
      });
      totalAmount += reqItem.totalPrice;
    }
    
    // Update the total amount
    requisitionEntity.totalAmount = totalAmount;
    this.purchaseRequisitions.set(id, requisitionEntity);
    
    // Create activity log
    await this.createActivityLog({
      action: "Requisition Created",
      description: `Created requisition ${requisitionEntity.requisitionNumber} for $${totalAmount.toFixed(2)}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: requisition.requestorId || null
    });
    
    return requisitionEntity;
  }
  
  async updatePurchaseRequisition(
    id: number, 
    updateData: Partial<InsertPurchaseRequisition>
  ): Promise<PurchaseRequisition | undefined> {
    const existingRequisition = this.purchaseRequisitions.get(id);
    if (!existingRequisition) return undefined;
    
    const updatedRequisition = {
      ...existingRequisition,
      ...updateData,
      updatedAt: new Date()
    };
    
    this.purchaseRequisitions.set(id, updatedRequisition);
    
    // Create activity log
    await this.createActivityLog({
      action: "Requisition Updated",
      description: `Updated requisition ${updatedRequisition.requisitionNumber}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: updateData.requestorId || existingRequisition.requestorId
    });
    
    return updatedRequisition;
  }
  
  async deletePurchaseRequisition(id: number): Promise<boolean> {
    const requisition = this.purchaseRequisitions.get(id);
    if (!requisition) return false;
    
    // Delete all associated items
    const itemsToDelete = Array.from(this.purchaseRequisitionItems.values())
      .filter(item => item.requisitionId === id);
    
    for (const item of itemsToDelete) {
      this.purchaseRequisitionItems.delete(item.id);
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Requisition Deleted",
      description: `Deleted requisition ${requisition.requisitionNumber}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: requisition.requestorId
    });
    
    return this.purchaseRequisitions.delete(id);
  }
  
  async getPurchaseRequisitionItems(requisitionId: number): Promise<PurchaseRequisitionItem[]> {
    return Array.from(this.purchaseRequisitionItems.values())
      .filter(item => item.requisitionId === requisitionId);
  }
  
  async addPurchaseRequisitionItem(item: InsertPurchaseRequisitionItem): Promise<PurchaseRequisitionItem> {
    const id = this.requisitionItemCurrentId++;
    
    // Make sure the referenced inventory item exists
    const inventoryItem = this.inventoryItems.get(item.itemId);
    if (!inventoryItem) {
      throw new Error(`Inventory item with ID ${item.itemId} not found`);
    }
    
    const requisitionItem: PurchaseRequisitionItem = {
      ...item,
      id
    };
    
    this.purchaseRequisitionItems.set(id, requisitionItem);
    
    // Update the requisition total amount
    const requisition = this.purchaseRequisitions.get(item.requisitionId);
    if (requisition) {
      requisition.totalAmount += requisitionItem.totalPrice;
      requisition.updatedAt = new Date();
      this.purchaseRequisitions.set(requisition.id, requisition);
    }
    
    return requisitionItem;
  }
  
  async updatePurchaseRequisitionItem(
    id: number, 
    updateData: Partial<InsertPurchaseRequisitionItem>
  ): Promise<PurchaseRequisitionItem | undefined> {
    const existingItem = this.purchaseRequisitionItems.get(id);
    if (!existingItem) return undefined;
    
    // Calculate price difference
    const oldPrice = existingItem.totalPrice;
    
    const updatedItem = {
      ...existingItem,
      ...updateData
    };
    
    this.purchaseRequisitionItems.set(id, updatedItem);
    
    // Update the requisition total amount
    const requisition = this.purchaseRequisitions.get(existingItem.requisitionId);
    if (requisition && updatedItem.totalPrice !== oldPrice) {
      requisition.totalAmount = requisition.totalAmount - oldPrice + updatedItem.totalPrice;
      requisition.updatedAt = new Date();
      this.purchaseRequisitions.set(requisition.id, requisition);
    }
    
    return updatedItem;
  }
  
  async deletePurchaseRequisitionItem(id: number): Promise<boolean> {
    const item = this.purchaseRequisitionItems.get(id);
    if (!item) return false;
    
    // Update the requisition total amount
    const requisition = this.purchaseRequisitions.get(item.requisitionId);
    if (requisition) {
      requisition.totalAmount -= item.totalPrice;
      requisition.updatedAt = new Date();
      this.purchaseRequisitions.set(requisition.id, requisition);
    }
    
    return this.purchaseRequisitionItems.delete(id);
  }
  
  async approvePurchaseRequisition(id: number, approverId: number): Promise<PurchaseRequisition | undefined> {
    const requisition = this.purchaseRequisitions.get(id);
    if (!requisition) return undefined;
    
    const updatedRequisition = {
      ...requisition,
      status: PurchaseRequisitionStatus.APPROVED,
      approverId,
      approvalDate: new Date(),
      updatedAt: new Date()
    };
    
    this.purchaseRequisitions.set(id, updatedRequisition);
    
    // Create activity log
    await this.createActivityLog({
      action: "Requisition Approved",
      description: `Approved requisition ${updatedRequisition.requisitionNumber}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: approverId
    });
    
    return updatedRequisition;
  }
  
  async rejectPurchaseRequisition(
    id: number, 
    approverId: number, 
    reason: string
  ): Promise<PurchaseRequisition | undefined> {
    const requisition = this.purchaseRequisitions.get(id);
    if (!requisition) return undefined;
    
    const updatedRequisition = {
      ...requisition,
      status: PurchaseRequisitionStatus.REJECTED,
      approverId,
      approvalDate: new Date(),
      rejectionReason: reason,
      updatedAt: new Date()
    };
    
    this.purchaseRequisitions.set(id, updatedRequisition);
    
    // Create activity log
    await this.createActivityLog({
      action: "Requisition Rejected",
      description: `Rejected requisition ${updatedRequisition.requisitionNumber}: ${reason}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: approverId
    });
    
    return updatedRequisition;
  }
  
  // Purchase Order methods
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return Array.from(this.purchaseOrders.values());
  }
  
  async getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(id);
  }
  
  async getPurchaseOrderByNumber(orderNumber: string): Promise<PurchaseOrder | undefined> {
    return Array.from(this.purchaseOrders.values()).find(
      (order) => order.orderNumber === orderNumber
    );
  }
  
  async createPurchaseOrder(
    order: InsertPurchaseOrder, 
    items: Omit<InsertPurchaseOrderItem, "orderId">[]
  ): Promise<PurchaseOrder> {
    const id = this.orderCurrentId++;
    const now = new Date();
    
    const orderEntity: PurchaseOrder = {
      ...order,
      id,
      createdAt: now,
      updatedAt: now
    };
    
    this.purchaseOrders.set(id, orderEntity);
    
    // Add the items
    let totalAmount = 0;
    
    for (const item of items) {
      const orderItem = await this.addPurchaseOrderItem({
        ...item,
        orderId: id
      });
      totalAmount += orderItem.totalPrice;
    }
    
    // Update the total amount
    orderEntity.totalAmount = totalAmount;
    this.purchaseOrders.set(id, orderEntity);
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Created",
      description: `Created PO ${orderEntity.orderNumber} for $${totalAmount.toFixed(2)}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1 // Default to admin user
    });
    
    return orderEntity;
  }
  
  async updatePurchaseOrder(
    id: number, 
    updateData: Partial<InsertPurchaseOrder>
  ): Promise<PurchaseOrder | undefined> {
    const existingOrder = this.purchaseOrders.get(id);
    if (!existingOrder) return undefined;
    
    const updatedOrder = {
      ...existingOrder,
      ...updateData,
      updatedAt: new Date()
    };
    
    this.purchaseOrders.set(id, updatedOrder);
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Updated",
      description: `Updated PO ${updatedOrder.orderNumber}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1 // Default to admin user
    });
    
    return updatedOrder;
  }
  
  async deletePurchaseOrder(id: number): Promise<boolean> {
    const order = this.purchaseOrders.get(id);
    if (!order) return false;
    
    // Delete all associated items
    const itemsToDelete = Array.from(this.purchaseOrderItems.values())
      .filter(item => item.orderId === id);
    
    for (const item of itemsToDelete) {
      this.purchaseOrderItems.delete(item.id);
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Deleted",
      description: `Deleted PO ${order.orderNumber}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1 // Default to admin user
    });
    
    return this.purchaseOrders.delete(id);
  }
  
  async getPurchaseOrderItems(orderId: number): Promise<PurchaseOrderItem[]> {
    return Array.from(this.purchaseOrderItems.values())
      .filter(item => item.orderId === orderId);
  }
  
  async addPurchaseOrderItem(item: InsertPurchaseOrderItem): Promise<PurchaseOrderItem> {
    const id = this.orderItemCurrentId++;
    
    // Make sure the referenced inventory item exists
    const inventoryItem = this.inventoryItems.get(item.itemId);
    if (!inventoryItem) {
      throw new Error(`Inventory item with ID ${item.itemId} not found`);
    }
    
    const orderItem: PurchaseOrderItem = {
      ...item,
      id
    };
    
    this.purchaseOrderItems.set(id, orderItem);
    
    // Update the order total amount
    const order = this.purchaseOrders.get(item.orderId);
    if (order) {
      order.totalAmount += orderItem.totalPrice;
      order.updatedAt = new Date();
      this.purchaseOrders.set(order.id, order);
    }
    
    return orderItem;
  }
  
  async updatePurchaseOrderItem(
    id: number, 
    updateData: Partial<InsertPurchaseOrderItem>
  ): Promise<PurchaseOrderItem | undefined> {
    const existingItem = this.purchaseOrderItems.get(id);
    if (!existingItem) return undefined;
    
    // Calculate price difference
    const oldPrice = existingItem.totalPrice;
    
    const updatedItem = {
      ...existingItem,
      ...updateData
    };
    
    this.purchaseOrderItems.set(id, updatedItem);
    
    // Update the order total amount
    const order = this.purchaseOrders.get(existingItem.orderId);
    if (order && updatedItem.totalPrice !== oldPrice) {
      order.totalAmount = order.totalAmount - oldPrice + updatedItem.totalPrice;
      order.updatedAt = new Date();
      this.purchaseOrders.set(order.id, order);
    }
    
    return updatedItem;
  }
  
  async deletePurchaseOrderItem(id: number): Promise<boolean> {
    const item = this.purchaseOrderItems.get(id);
    if (!item) return false;
    
    // Update the order total amount
    const order = this.purchaseOrders.get(item.orderId);
    if (order) {
      order.totalAmount -= item.totalPrice;
      order.updatedAt = new Date();
      this.purchaseOrders.set(order.id, order);
    }
    
    return this.purchaseOrderItems.delete(id);
  }
  
  async updatePurchaseOrderStatus(
    id: number, 
    status: PurchaseOrderStatus
  ): Promise<PurchaseOrder | undefined> {
    const order = this.purchaseOrders.get(id);
    if (!order) return undefined;
    
    const updatedOrder = {
      ...order,
      status,
      updatedAt: new Date()
    };
    
    // If status is COMPLETED, update payment status to PAID
    if (status === PurchaseOrderStatus.COMPLETED) {
      updatedOrder.paymentStatus = PaymentStatus.PAID;
      updatedOrder.paymentDate = new Date();
    }
    
    this.purchaseOrders.set(id, updatedOrder);
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Status Updated",
      description: `Updated PO ${updatedOrder.orderNumber} status to ${status}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1 // Default to admin user
    });
    
    return updatedOrder;
  }
  
  async updatePurchaseOrderPaymentStatus(
    id: number, 
    paymentStatus: PaymentStatus, 
    reference?: string
  ): Promise<PurchaseOrder | undefined> {
    const order = this.purchaseOrders.get(id);
    if (!order) return undefined;
    
    const updatedOrder = {
      ...order,
      paymentStatus,
      paymentReference: reference || order.paymentReference,
      updatedAt: new Date()
    };
    
    // Set the payment date if it's now paid
    if (paymentStatus === PaymentStatus.PAID && !order.paymentDate) {
      updatedOrder.paymentDate = new Date();
    }
    
    this.purchaseOrders.set(id, updatedOrder);
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Payment Updated",
      description: `Updated PO ${updatedOrder.orderNumber} payment status to ${paymentStatus}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1 // Default to admin user
    });
    
    return updatedOrder;
  }
  
  async recordPurchaseOrderItemReceived(
    itemId: number, 
    receivedQuantity: number
  ): Promise<PurchaseOrderItem | undefined> {
    const poItem = this.purchaseOrderItems.get(itemId);
    if (!poItem) return undefined;
    
    // Check if we're receiving a valid amount
    if (receivedQuantity < 0 || receivedQuantity > poItem.quantity) {
      throw new Error(`Invalid received quantity: ${receivedQuantity}`);
    }
    
    // Update the received quantity
    const updatedItem = {
      ...poItem,
      receivedQuantity: poItem.receivedQuantity + receivedQuantity
    };
    
    this.purchaseOrderItems.set(itemId, updatedItem);
    
    // Update the inventory quantity
    const inventoryItem = this.inventoryItems.get(poItem.itemId);
    if (inventoryItem) {
      await this.updateInventoryItem(inventoryItem.id, {
        quantity: inventoryItem.quantity + receivedQuantity
      });
    }
    
    // Check if all items for this order have been fully received
    const order = this.purchaseOrders.get(poItem.orderId);
    if (order) {
      const orderItems = await this.getPurchaseOrderItems(order.id);
      const allItemsReceived = orderItems.every(item => item.receivedQuantity >= item.quantity);
      
      // If all items are received, update the order status
      if (allItemsReceived) {
        await this.updatePurchaseOrderStatus(order.id, PurchaseOrderStatus.RECEIVED);
      } else {
        // If some items are received but not all, update to partially received
        const anyItemsReceived = orderItems.some(item => item.receivedQuantity > 0);
        if (anyItemsReceived) {
          await this.updatePurchaseOrderStatus(order.id, PurchaseOrderStatus.PARTIALLY_RECEIVED);
        }
      }
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Item Received",
      description: `Received ${receivedQuantity} unit(s) of item #${poItem.itemId} from PO #${poItem.orderId}`,
      itemId: poItem.itemId,
      referenceType: "purchase_order",
      referenceId: poItem.orderId,
      userId: 1 // Default to admin user
    });
    
    return updatedItem;
  }
  
  async createPurchaseOrderFromRequisition(requisitionId: number): Promise<PurchaseOrder | undefined> {
    const requisition = this.purchaseRequisitions.get(requisitionId);
    if (!requisition) return undefined;
    
    // Check if requisition is approved
    if (requisition.status !== PurchaseRequisitionStatus.APPROVED) {
      throw new Error(`Cannot create purchase order from requisition with status: ${requisition.status}`);
    }
    
    // Generate order number
    const orderNumber = `PO-${new Date().getFullYear()}-${this.orderCurrentId.toString().padStart(3, '0')}`;
    
    // Create new purchase order
    const order: InsertPurchaseOrder = {
      orderNumber,
      supplierId: requisition.supplierId,
      requisitionId: requisition.id,
      status: PurchaseOrderStatus.DRAFT,
      orderDate: new Date(),
      expectedDeliveryDate: requisition.requiredDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // Default to 2 weeks
      deliveryAddress: "", // This would be set based on business requirements
      totalAmount: requisition.totalAmount,
      notes: requisition.notes,
      paymentStatus: PaymentStatus.UNPAID,
      emailSent: false
    };
    
    // Get requisition items
    const requisitionItems = await this.getPurchaseRequisitionItems(requisitionId);
    
    // Convert requisition items to purchase order items
    const orderItems = requisitionItems.map(reqItem => ({
      itemId: reqItem.itemId,
      quantity: reqItem.quantity,
      unitPrice: reqItem.unitPrice,
      totalPrice: reqItem.totalPrice,
      receivedQuantity: 0,
      notes: reqItem.notes
    }));
    
    // Create purchase order
    const createdOrder = await this.createPurchaseOrder(order, orderItems);
    
    // Update requisition status
    await this.updatePurchaseRequisition(requisitionId, {
      status: PurchaseRequisitionStatus.CONVERTED
    });
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Created from Requisition",
      description: `Created PO ${orderNumber} from requisition ${requisition.requisitionNumber}`,
      referenceType: "purchase_order",
      referenceId: createdOrder.id,
      userId: 1 // Default to admin user
    });
    
    return createdOrder;
  }
  
  async sendPurchaseOrderEmail(id: number, recipientEmail: string): Promise<boolean> {
    const order = this.purchaseOrders.get(id);
    if (!order) return false;
    
    // In a real implementation, this would call an email service
    // For demo purposes, we'll just update the order status
    
    const updatedOrder = {
      ...order,
      emailSent: true,
      emailSentDate: new Date(),
      status: order.status === PurchaseOrderStatus.DRAFT ? 
        PurchaseOrderStatus.SENT : order.status,
      updatedAt: new Date()
    };
    
    this.purchaseOrders.set(id, updatedOrder);
    
    // Create activity log
    await this.createActivityLog({
      action: "Purchase Order Email Sent",
      description: `Sent PO ${updatedOrder.orderNumber} by email to ${recipientEmail}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1 // Default to admin user
    });
    
    return true;
  }
  
  // Reference lookup combined methods
  async getItemWithSupplierAndCategory(id: number): Promise<(InventoryItem & { 
    supplier?: Supplier, 
    category?: Category 
  }) | undefined> {
    const item = this.inventoryItems.get(id);
    if (!item) return undefined;
    
    const result = { ...item };
    
    if (item.supplierId) {
      result.supplier = this.suppliers.get(item.supplierId);
    }
    
    if (item.categoryId) {
      result.category = this.categories.get(item.categoryId);
    }
    
    return result;
  }
  
  async getRequisitionWithDetails(id: number): Promise<(PurchaseRequisition & { 
    items: (PurchaseRequisitionItem & { item: InventoryItem })[];
    requestor?: User;
    approver?: User;
    supplier?: Supplier;
  }) | undefined> {
    const requisition = this.purchaseRequisitions.get(id);
    if (!requisition) return undefined;
    
    const result = { ...requisition, items: [] };
    
    // Get items
    const items = await this.getPurchaseRequisitionItems(id);
    result.items = items.map(item => {
      const inventoryItem = this.inventoryItems.get(item.itemId);
      return {
        ...item,
        item: inventoryItem!
      };
    });
    
    // Get requestor
    if (requisition.requestorId) {
      result.requestor = this.users.get(requisition.requestorId);
    }
    
    // Get approver
    if (requisition.approverId) {
      result.approver = this.users.get(requisition.approverId);
    }
    
    // Get supplier
    if (requisition.supplierId) {
      result.supplier = this.suppliers.get(requisition.supplierId);
    }
    
    return result;
  }
  
  async getPurchaseOrderWithDetails(id: number): Promise<(PurchaseOrder & { 
    items: (PurchaseOrderItem & { item: InventoryItem })[];
    supplier: Supplier;
    requisition?: PurchaseRequisition;
  }) | undefined> {
    const order = this.purchaseOrders.get(id);
    if (!order) return undefined;
    
    const supplier = this.suppliers.get(order.supplierId);
    if (!supplier) {
      throw new Error(`Supplier not found for order ${id}`);
    }
    
    const result = { 
      ...order, 
      items: [],
      supplier
    };
    
    // Get items
    const items = await this.getPurchaseOrderItems(id);
    result.items = items.map(item => {
      const inventoryItem = this.inventoryItems.get(item.itemId);
      return {
        ...item,
        item: inventoryItem!
      };
    });
    
    // Get requisition if available
    if (order.requisitionId) {
      result.requisition = this.purchaseRequisitions.get(order.requisitionId);
    }
    
    return result;
  }
  
  // Activity log methods
  async getAllActivityLogs(limit?: number): Promise<ActivityLog[]> {
    const logs = Array.from(this.activityLogs.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return limit ? logs.slice(0, limit) : logs;
  }
  
  async createActivityLog(insertLog: InsertActivityLog): Promise<ActivityLog> {
    const id = this.logCurrentId++;
    const now = new Date();
    
    // Ensure all fields have values to avoid TypeScript errors
    const log: ActivityLog = { 
      ...insertLog, 
      id,
      timestamp: now,
      itemId: insertLog.itemId || null,
      userId: insertLog.userId || null,
      referenceType: insertLog.referenceType || null,
      referenceId: insertLog.referenceId || null
    };
    
    this.activityLogs.set(id, log);
    return log;
  }

  // App Settings methods
  async getAppSettings(): Promise<AppSettings | undefined> {
    // Since there should be only one settings record, return the first one
    const settings = Array.from(this.appSettings.values());
    return settings.length > 0 ? settings[0] : undefined;
  }

  async updateAppSettings(settings: Partial<InsertAppSettings>): Promise<AppSettings> {
    const existingSettings = await this.getAppSettings();
    const now = new Date();
    
    if (existingSettings) {
      // Update existing settings
      const updatedSettings: AppSettings = {
        ...existingSettings,
        ...settings,
        updatedAt: now
      };
      this.appSettings.set(existingSettings.id, updatedSettings);
      
      // Create activity log
      await this.createActivityLog({
        action: "Settings Updated",
        description: "Application settings were updated",
        referenceType: "settings",
        referenceId: existingSettings.id
      });
      
      return updatedSettings;
    } else {
      // Create new settings record
      const id = this.settingsCurrentId++;
      const newSettings: AppSettings = {
        id,
        companyName: settings.companyName || "InvTrack",
        companyLogo: settings.companyLogo || null,
        primaryColor: settings.primaryColor || "#0F172A",
        dateFormat: settings.dateFormat || "YYYY-MM-DD",
        timeFormat: settings.timeFormat || "HH:mm",
        currencySymbol: settings.currencySymbol || "$",
        lowStockDefaultThreshold: settings.lowStockDefaultThreshold || 10,
        allowNegativeInventory: settings.allowNegativeInventory || false,
        enableVat: settings.enableVat || false,
        defaultVatCountry: settings.defaultVatCountry || "US",
        showPricesWithVat: settings.showPricesWithVat || true,
        updatedAt: now
      };
      
      this.appSettings.set(id, newSettings);
      
      // Create activity log
      await this.createActivityLog({
        action: "Settings Created",
        description: "Initial application settings were created",
        referenceType: "settings",
        referenceId: id
      });
      
      return newSettings;
    }
  }
  
  // Supplier Logo methods
  async getSupplierLogo(supplierId: number): Promise<SupplierLogo | undefined> {
    return Array.from(this.supplierLogos.values())
      .find(logo => logo.supplierId === supplierId);
  }
  
  async createSupplierLogo(logo: InsertSupplierLogo): Promise<SupplierLogo> {
    const id = this.supplierLogoCurrentId++;
    const now = new Date();
    
    const newLogo: SupplierLogo = {
      ...logo,
      id,
      updatedAt: now
    };
    
    this.supplierLogos.set(id, newLogo);
    
    // Create activity log
    await this.createActivityLog({
      action: "Supplier Logo Added",
      description: `Logo was added for supplier ID ${logo.supplierId}`,
      referenceType: "supplier",
      referenceId: logo.supplierId
    });
    
    return newLogo;
  }
  
  async updateSupplierLogo(supplierId: number, logoUrl: string): Promise<SupplierLogo | undefined> {
    const existingLogo = await this.getSupplierLogo(supplierId);
    
    if (existingLogo) {
      // Update existing logo
      const updatedLogo: SupplierLogo = {
        ...existingLogo,
        logoUrl,
        updatedAt: new Date()
      };
      
      this.supplierLogos.set(existingLogo.id, updatedLogo);
      
      // Create activity log
      await this.createActivityLog({
        action: "Supplier Logo Updated",
        description: `Logo was updated for supplier ID ${supplierId}`,
        referenceType: "supplier",
        referenceId: supplierId
      });
      
      return updatedLogo;
    } else {
      // Create new logo if it doesn't exist
      return this.createSupplierLogo({
        supplierId,
        logoUrl
      });
    }
  }
  
  async deleteSupplierLogo(supplierId: number): Promise<boolean> {
    const logo = await this.getSupplierLogo(supplierId);
    if (!logo) return false;
    
    // Create activity log
    await this.createActivityLog({
      action: "Supplier Logo Removed",
      description: `Logo was removed for supplier ID ${supplierId}`,
      referenceType: "supplier",
      referenceId: supplierId
    });
    
    return this.supplierLogos.delete(logo.id);
  }
  
  // Reorder request methods
  async getAllReorderRequests(): Promise<ReorderRequest[]> {
    return Array.from(this.reorderRequests.values());
  }
  
  async getReorderRequestsByDateRange(startDate: Date, endDate: Date): Promise<ReorderRequest[]> {
    return Array.from(this.reorderRequests.values()).filter(request => {
      return request.createdAt >= startDate && request.createdAt <= endDate;
    });
  }
  
  async getReorderRequest(id: number): Promise<ReorderRequest | undefined> {
    return this.reorderRequests.get(id);
  }
  
  async getReorderRequestByNumber(requestNumber: string): Promise<ReorderRequest | undefined> {
    return Array.from(this.reorderRequests.values()).find(
      (request) => request.requestNumber === requestNumber
    );
  }
  
  async createReorderRequest(insertRequest: InsertReorderRequest): Promise<ReorderRequest> {
    const id = this.reorderRequestCurrentId++;
    const now = new Date();
    
    // Generate a request number if not provided
    const requestNumber = insertRequest.requestNumber || `RO-${new Date().getFullYear()}-${id.toString().padStart(3, '0')}`;
    
    const request: ReorderRequest = {
      ...insertRequest,
      id,
      requestNumber,
      createdAt: now,
      updatedAt: now,
      status: insertRequest.status || ReorderRequestStatus.PENDING,
      notes: insertRequest.notes || null,
      requestorId: insertRequest.requestorId || null,
      approverId: insertRequest.approverId || null,
      approvalDate: insertRequest.approvalDate || null,
      rejectionReason: insertRequest.rejectionReason || null,
      convertedToRequisition: insertRequest.convertedToRequisition || false,
      requisitionId: insertRequest.requisitionId || null,
      supplierId: insertRequest.supplierId || null,
      warehouseId: insertRequest.warehouseId || null,
      isAutoGenerated: insertRequest.isAutoGenerated || false,
      requestDate: insertRequest.requestDate || now
    };
    
    this.reorderRequests.set(id, request);
    
    // Create activity log for new reorder request
    await this.createActivityLog({
      action: "Reorder Request Created",
      description: `Created reorder request ${request.requestNumber} for item ID: ${request.itemId}`,
      referenceType: "reorder_request",
      referenceId: request.id,
      userId: request.requestorId || undefined
    });
    
    return request;
  }
  
  async updateReorderRequest(id: number, updateData: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined> {
    const existingRequest = this.reorderRequests.get(id);
    if (!existingRequest) return undefined;
    
    const updatedRequest = {
      ...existingRequest,
      ...updateData,
      updatedAt: new Date()
    };
    
    this.reorderRequests.set(id, updatedRequest);
    
    // Create activity log for update
    await this.createActivityLog({
      action: "Reorder Request Updated",
      description: `Updated reorder request ${updatedRequest.requestNumber}`,
      referenceType: "reorder_request",
      referenceId: id,
      userId: updateData.requestorId || existingRequest.requestorId || undefined
    });
    
    return updatedRequest;
  }
  
  async deleteReorderRequest(id: number): Promise<boolean> {
    const request = this.reorderRequests.get(id);
    if (!request) return false;
    
    // Create activity log for deletion
    await this.createActivityLog({
      action: "Reorder Request Deleted",
      description: `Deleted reorder request ${request.requestNumber}`,
      referenceType: "reorder_request",
      referenceId: id
    });
    
    return this.reorderRequests.delete(id);
  }
  
  async approveReorderRequest(id: number, approverId: number): Promise<ReorderRequest | undefined> {
    const request = this.reorderRequests.get(id);
    if (!request) return undefined;
    
    const now = new Date();
    const updatedRequest: ReorderRequest = {
      ...request,
      status: ReorderRequestStatus.APPROVED,
      approverId,
      approvalDate: now,
      updatedAt: now
    };
    
    this.reorderRequests.set(id, updatedRequest);
    
    // Create activity log for approval
    await this.createActivityLog({
      action: "Reorder Request Approved",
      description: `Approved reorder request ${updatedRequest.requestNumber}`,
      referenceType: "reorder_request",
      referenceId: id,
      userId: approverId
    });
    
    return updatedRequest;
  }
  
  async rejectReorderRequest(id: number, approverId: number, reason: string): Promise<ReorderRequest | undefined> {
    const request = this.reorderRequests.get(id);
    if (!request) return undefined;
    
    const now = new Date();
    const updatedRequest: ReorderRequest = {
      ...request,
      status: ReorderRequestStatus.REJECTED,
      approverId,
      rejectionReason: reason,
      updatedAt: now
    };
    
    this.reorderRequests.set(id, updatedRequest);
    
    // Create activity log for rejection
    await this.createActivityLog({
      action: "Reorder Request Rejected",
      description: `Rejected reorder request ${updatedRequest.requestNumber}: ${reason}`,
      referenceType: "reorder_request",
      referenceId: id,
      userId: approverId
    });
    
    return updatedRequest;
  }
  
  async convertReorderRequestToRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    const request = this.reorderRequests.get(id);
    if (!request) return undefined;
    
    // Get the item details
    const item = await this.getInventoryItem(request.itemId);
    if (!item) return undefined;
    
    // Create a new purchase requisition
    const requisitionData: InsertPurchaseRequisition = {
      requisitionNumber: `REQ-${new Date().getFullYear()}-${this.requisitionCurrentId.toString().padStart(3, '0')}`,
      requestorId: request.requestorId,
      status: PurchaseRequisitionStatus.PENDING,
      notes: `Created from reorder request ${request.requestNumber}. ${request.notes || ''}`,
      supplierId: request.supplierId || item.supplierId, // Use request supplierId if available, fallback to item supplierId
      totalAmount: (item.cost || item.price) * request.quantity
    };
    
    // Create requisition item
    const requisitionItemData: Omit<InsertPurchaseRequisitionItem, "requisitionId"> = {
      itemId: request.itemId,
      quantity: request.quantity,
      unitPrice: item.cost || item.price,
      totalPrice: (item.cost || item.price) * request.quantity,
      notes: `From reorder request ${request.requestNumber}`
    };
    
    // Create the purchase requisition with the item
    const requisition = await this.createPurchaseRequisition(requisitionData, [requisitionItemData]);
    
    // Update the reorder request to mark it as converted
    const now = new Date();
    const updatedRequest: ReorderRequest = {
      ...request,
      status: ReorderRequestStatus.CONVERTED,
      convertedToRequisition: true,
      requisitionId: requisition.id,
      updatedAt: now
    };
    
    this.reorderRequests.set(id, updatedRequest);
    
    // Create activity log for conversion
    await this.createActivityLog({
      action: "Reorder Request Converted",
      description: `Converted reorder request ${request.requestNumber} to purchase requisition ${requisition.requisitionNumber}`,
      referenceType: "reorder_request",
      referenceId: id,
      userId: request.requestorId || undefined
    });
    
    return requisition;
  }
  
  async getReorderRequestWithDetails(id: number): Promise<(ReorderRequest & { 
    item: InventoryItem,
    requestor?: User,
    approver?: User,
    supplier?: Supplier,
    warehouse?: Warehouse
  }) | undefined> {
    const request = this.reorderRequests.get(id);
    if (!request) return undefined;
    
    const item = await this.getInventoryItem(request.itemId);
    if (!item) return undefined;
    
    let requestor: User | undefined;
    let approver: User | undefined;
    let supplier: Supplier | undefined;
    let warehouse: Warehouse | undefined;
    
    if (request.requestorId) {
      requestor = await this.getUser(request.requestorId);
    }
    
    if (request.approverId) {
      approver = await this.getUser(request.approverId);
    }
    
    if (request.supplierId) {
      supplier = await this.getSupplier(request.supplierId);
    } else if (item.supplierId) {
      supplier = await this.getSupplier(item.supplierId);
    }
    
    if (request.warehouseId) {
      warehouse = await this.getWarehouse(request.warehouseId);
    }
    
    return {
      ...request,
      item,
      requestor,
      approver,
      supplier,
      warehouse
    };
  }
  
  // VAT rate methods
  async getAllVatRates(): Promise<VatRate[]> {
    return Array.from(this.vatRates.values());
  }
  
  async getVatRate(id: number): Promise<VatRate | undefined> {
    return this.vatRates.get(id);
  }
  
  async getVatRateByCountryCode(countryCode: string): Promise<VatRate | undefined> {
    return Array.from(this.vatRates.values()).find(
      vatRate => vatRate.countryCode.toLowerCase() === countryCode.toLowerCase()
    );
  }
  
  async createVatRate(vatRate: InsertVatRate): Promise<VatRate> {
    const id = this.vatRateCurrentId++;
    const now = new Date();
    const newVatRate: VatRate = {
      ...vatRate,
      id,
      updatedAt: now
    };
    
    this.vatRates.set(id, newVatRate);
    
    // Create activity log
    await this.createActivityLog({
      action: "VAT Rate Added",
      description: `Added VAT rate for ${vatRate.countryName} (${vatRate.countryCode}): ${vatRate.standardRate}%`,
      referenceType: "settings",
      referenceId: 0
    });
    
    return newVatRate;
  }
  
  async updateVatRate(id: number, vatRate: Partial<InsertVatRate>): Promise<VatRate | undefined> {
    const existingVatRate = this.vatRates.get(id);
    if (!existingVatRate) return undefined;
    
    const updatedVatRate: VatRate = {
      ...existingVatRate,
      ...vatRate,
      updatedAt: new Date()
    };
    
    this.vatRates.set(id, updatedVatRate);
    
    // Create activity log
    await this.createActivityLog({
      action: "VAT Rate Updated",
      description: `Updated VAT rate for ${updatedVatRate.countryName} (${updatedVatRate.countryCode})`,
      referenceType: "settings",
      referenceId: 0
    });
    
    return updatedVatRate;
  }
  
  async deleteVatRate(id: number): Promise<boolean> {
    const vatRate = this.vatRates.get(id);
    if (!vatRate) return false;
    
    // Create activity log
    await this.createActivityLog({
      action: "VAT Rate Deleted",
      description: `Deleted VAT rate for ${vatRate.countryName} (${vatRate.countryCode})`,
      referenceType: "settings",
      referenceId: 0
    });
    
    return this.vatRates.delete(id);
  }
  
  // VAT calculation method
  async calculateVat(amount: number, countryCode: string, useReducedRate: boolean = false): Promise<{
    originalAmount: number;
    vatAmount: number;
    totalAmount: number;
    vatRate: number;
    countryCode: string;
  }> {
    const vatRate = await this.getVatRateByCountryCode(countryCode);
    
    if (!vatRate) {
      // If no VAT rate found for country, return with 0% VAT
      return {
        originalAmount: amount,
        vatAmount: 0,
        totalAmount: amount,
        vatRate: 0,
        countryCode
      };
    }
    
    const rate = useReducedRate ? (vatRate.reducedRate || vatRate.standardRate) : vatRate.standardRate;
    const vatAmount = amount * (rate / 100);
    
    return {
      originalAmount: amount,
      vatAmount: Number(vatAmount.toFixed(2)),
      totalAmount: Number((amount + vatAmount).toFixed(2)),
      vatRate: rate,
      countryCode
    };
  }

  // Custom Role Methods
  async getAllCustomRoles(): Promise<CustomRole[]> {
    return Array.from(this.customRoles.values());
  }
  
  async getCustomRole(id: number): Promise<CustomRole | undefined> {
    return this.customRoles.get(id);
  }
  
  async getCustomRoleByName(name: string): Promise<CustomRole | undefined> {
    return Array.from(this.customRoles.values()).find(
      (role) => role.name.toLowerCase() === name.toLowerCase()
    );
  }
  
  async createCustomRole(role: InsertCustomRole): Promise<CustomRole> {
    const now = new Date();
    const customRole: CustomRole = {
      id: this.customRoleCurrentId++,
      createdAt: now,
      updatedAt: now,
      isSystemRole: role.isSystemRole || false,
      ...role
    };
    
    this.customRoles.set(customRole.id, customRole);
    
    // Log the action
    await this.createActivityLog({
      action: "Custom Role Created",
      description: `Created custom role: ${customRole.name}`,
      referenceType: "custom_role",
      referenceId: customRole.id,
      userId: role.createdBy
    });
    
    return customRole;
  }
  
  async updateCustomRole(id: number, role: Partial<InsertCustomRole>): Promise<CustomRole | undefined> {
    const existingRole = await this.getCustomRole(id);
    if (!existingRole) return undefined;
    
    const updatedRole: CustomRole = {
      ...existingRole,
      ...role,
      updatedAt: new Date()
    };
    
    this.customRoles.set(id, updatedRole);
    
    // Log the action
    if (role.createdBy) {
      await this.createActivityLog({
        action: "Custom Role Updated",
        description: `Updated custom role: ${updatedRole.name}`,
        referenceType: "custom_role",
        referenceId: id,
        userId: role.createdBy
      });
    }
    
    return updatedRole;
  }
  
  async deleteCustomRole(id: number): Promise<boolean> {
    // Check if the role exists
    const role = await this.getCustomRole(id);
    if (!role) return false;
    
    // Delete the role
    const result = this.customRoles.delete(id);
    
    // Delete all associated permissions
    const permissions = await this.getAllCustomRolePermissions(id);
    for (const permission of permissions) {
      await this.deleteCustomRolePermission(permission.id);
    }
    
    return result;
  }
  
  // Custom Role Permission Methods
  async getCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]> {
    return Array.from(this.customRolePermissions.values()).filter(
      (permission) => permission.roleId === roleId
    );
  }
  
  async addPermissionToCustomRole(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<CustomRolePermission> {
    const permission: InsertCustomRolePermission = {
      roleId,
      resource,
      permissionType
    };
    
    return this.createCustomRolePermission(permission);
  }
  
  async removePermissionFromCustomRole(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<boolean> {
    const permissions = await this.getCustomRolePermissions(roleId);
    const permissionToRemove = permissions.find(
      p => p.roleId === roleId && p.resource === resource && p.permissionType === permissionType
    );
    
    if (!permissionToRemove) return false;
    
    return this.deleteCustomRolePermission(permissionToRemove.id);
  }
  
  async getAllCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]> {
    return Array.from(this.customRolePermissions.values()).filter(
      (permission) => permission.roleId === roleId
    );
  }
  
  async getCustomRolePermission(id: number): Promise<CustomRolePermission | undefined> {
    return this.customRolePermissions.get(id);
  }
  
  async createCustomRolePermission(permission: InsertCustomRolePermission): Promise<CustomRolePermission> {
    const now = new Date();
    const customRolePermission: CustomRolePermission = {
      id: this.customRolePermissionCurrentId++,
      createdAt: now,
      updatedAt: now,
      ...permission
    };
    
    this.customRolePermissions.set(customRolePermission.id, customRolePermission);
    
    return customRolePermission;
  }
  
  async updateCustomRolePermission(id: number, permission: Partial<InsertCustomRolePermission>): Promise<CustomRolePermission | undefined> {
    const existingPermission = await this.getCustomRolePermission(id);
    if (!existingPermission) return undefined;
    
    const updatedPermission: CustomRolePermission = {
      ...existingPermission,
      ...permission,
      updatedAt: new Date()
    };
    
    this.customRolePermissions.set(id, updatedPermission);
    
    return updatedPermission;
  }
  
  async deleteCustomRolePermission(id: number): Promise<boolean> {
    return this.customRolePermissions.delete(id);
  }
  
  // User Access Log Methods
  async getAllUserAccessLogs(userId?: number): Promise<UserAccessLog[]> {
    let logs = Array.from(this.userAccessLogs.values());
    
    if (userId) {
      logs = logs.filter(log => log.userId === userId);
    }
    
    // Sort by timestamp, most recent first
    return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  async getUserAccessLog(id: number): Promise<UserAccessLog | undefined> {
    return this.userAccessLogs.get(id);
  }
  
  async createUserAccessLog(log: InsertUserAccessLog): Promise<UserAccessLog> {
    const userAccessLog: UserAccessLog = {
      id: this.userAccessLogCurrentId++,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...log
    };
    
    this.userAccessLogs.set(userAccessLog.id, userAccessLog);
    
    return userAccessLog;
  }
  
  // User Contact Methods
  async getAllUserContacts(userId: number): Promise<UserContact[]> {
    return Array.from(this.userContacts.values()).filter(
      (contact) => contact.userId === userId
    );
  }
  
  async getUserContact(id: number): Promise<UserContact | undefined> {
    return this.userContacts.get(id);
  }
  
  async createUserContact(contact: InsertUserContact): Promise<UserContact> {
    const now = new Date();
    const userContact: UserContact = {
      id: this.userContactCurrentId++,
      createdAt: now,
      updatedAt: now,
      ...contact
    };
    
    this.userContacts.set(userContact.id, userContact);
    
    return userContact;
  }
  
  async updateUserContact(id: number, contact: Partial<InsertUserContact>): Promise<UserContact | undefined> {
    const existingContact = await this.getUserContact(id);
    if (!existingContact) return undefined;
    
    const updatedContact: UserContact = {
      ...existingContact,
      ...contact,
      updatedAt: new Date()
    };
    
    this.userContacts.set(id, updatedContact);
    
    return updatedContact;
  }
  
  async deleteUserContact(id: number): Promise<boolean> {
    return this.userContacts.delete(id);
  }
  
  // User Security Settings Methods
  async getUserSecuritySettings(userId: number): Promise<UserSecuritySetting | undefined> {
    return Array.from(this.userSecuritySettings.values()).find(
      (settings) => settings.userId === userId
    );
  }
  
  async createUserSecuritySettings(settings: InsertUserSecuritySetting): Promise<UserSecuritySetting> {
    const now = new Date();
    const userSecuritySetting: UserSecuritySetting = {
      id: this.userSecuritySettingCurrentId++,
      createdAt: now,
      updatedAt: now,
      ...settings
    };
    
    this.userSecuritySettings.set(userSecuritySetting.id, userSecuritySetting);
    
    return userSecuritySetting;
  }
  
  async updateUserSecuritySettings(userId: number, settings: Partial<InsertUserSecuritySetting>): Promise<UserSecuritySetting | undefined> {
    const existingSettings = await this.getUserSecuritySettings(userId);
    if (!existingSettings) return undefined;
    
    const updatedSettings: UserSecuritySetting = {
      ...existingSettings,
      ...settings,
      updatedAt: new Date()
    };
    
    this.userSecuritySettings.set(existingSettings.id, updatedSettings);
    
    return updatedSettings;
  }
  
  // User Performance Metrics Methods
  async getAllUserPerformanceMetrics(userId: number): Promise<UserPerformanceMetric[]> {
    return Array.from(this.userPerformanceMetrics.values()).filter(
      (metric) => metric.userId === userId
    );
  }
  
  async getUserPerformanceMetric(id: number): Promise<UserPerformanceMetric | undefined> {
    return this.userPerformanceMetrics.get(id);
  }
  
  async createUserPerformanceMetric(metric: InsertUserPerformanceMetric): Promise<UserPerformanceMetric> {
    const now = new Date();
    const userPerformanceMetric: UserPerformanceMetric = {
      id: this.userPerformanceMetricCurrentId++,
      createdAt: now,
      updatedAt: now,
      ...metric
    };
    
    this.userPerformanceMetrics.set(userPerformanceMetric.id, userPerformanceMetric);
    
    return userPerformanceMetric;
  }
  
  async updateUserPerformanceMetric(id: number, metric: Partial<InsertUserPerformanceMetric>): Promise<UserPerformanceMetric | undefined> {
    const existingMetric = await this.getUserPerformanceMetric(id);
    if (!existingMetric) return undefined;
    
    const updatedMetric: UserPerformanceMetric = {
      ...existingMetric,
      ...metric,
      updatedAt: new Date()
    };
    
    this.userPerformanceMetrics.set(id, updatedMetric);
    
    return updatedMetric;
  }
  
  // Time Restriction Methods
  async getAllTimeRestrictions(userId?: number): Promise<TimeRestriction[]> {
    let restrictions = Array.from(this.timeRestrictions.values());
    
    if (userId) {
      restrictions = restrictions.filter(
        (restriction) => restriction.userId === userId
      );
    }
    
    return restrictions;
  }
  
  async getTimeRestriction(id: number): Promise<TimeRestriction | undefined> {
    return this.timeRestrictions.get(id);
  }
  
  async createTimeRestriction(restriction: InsertTimeRestriction): Promise<TimeRestriction> {
    const now = new Date();
    const timeRestriction: TimeRestriction = {
      id: this.timeRestrictionCurrentId++,
      createdAt: now,
      updatedAt: now,
      ...restriction
    };
    
    this.timeRestrictions.set(timeRestriction.id, timeRestriction);
    
    return timeRestriction;
  }
  
  async updateTimeRestriction(id: number, restriction: Partial<InsertTimeRestriction>): Promise<TimeRestriction | undefined> {
    const existingRestriction = await this.getTimeRestriction(id);
    if (!existingRestriction) return undefined;
    
    const updatedRestriction: TimeRestriction = {
      ...existingRestriction,
      ...restriction,
      updatedAt: new Date()
    };
    
    this.timeRestrictions.set(id, updatedRestriction);
    
    return updatedRestriction;
  }
  
  async deleteTimeRestriction(id: number): Promise<boolean> {
    return this.timeRestrictions.delete(id);
  }

  // Billing Methods
  
  // Invoice methods
  async getAllInvoices(): Promise<Invoice[]> {
    return Array.from(this.invoices.values());
  }
  
  async getInvoice(id: number): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }
  
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    return Array.from(this.invoices.values()).find(
      (invoice) => invoice.invoiceNumber === invoiceNumber
    );
  }
  
  async createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[] = []): Promise<Invoice> {
    const id = this.invoiceCurrentId++;
    const now = new Date();
    
    // Generate invoice number if not provided
    if (!invoice.invoiceNumber) {
      // Get billing settings for prefix
      const billingSettings = await this.getBillingSettings();
      const prefix = billingSettings?.invoicePrefix || 'INV-';
      
      invoice.invoiceNumber = `${prefix}${String(id).padStart(5, '0')}`;
    }

    // Calculate due amount based on total
    const dueAmount = invoice.dueAmount || invoice.total;
    
    const newInvoice: Invoice = {
      ...invoice,
      id,
      createdAt: now,
      updatedAt: now,
      dueAmount,
      paidAmount: invoice.paidAmount || 0,
      sentDate: invoice.sentDate || null,
      paidDate: invoice.paidDate || null
    };
    
    this.invoices.set(id, newInvoice);
    
    // Create invoice items if provided
    for (const item of items) {
      await this.addInvoiceItem({
        ...item,
        invoiceId: id
      });
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Invoice Created",
      description: `Created invoice: ${newInvoice.invoiceNumber}`,
      referenceType: "invoice",
      referenceId: id,
      userId: invoice.createdBy
    });
    
    return newInvoice;
  }
  
  async updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const existingInvoice = this.invoices.get(id);
    if (!existingInvoice) return undefined;
    
    const updatedInvoice = {
      ...existingInvoice,
      ...invoice,
      updatedAt: new Date()
    };
    
    // Update due amount based on total and paid amount if total is changed
    if (invoice.total !== undefined) {
      updatedInvoice.dueAmount = invoice.total - (updatedInvoice.paidAmount || 0);
    }
    
    this.invoices.set(id, updatedInvoice);
    
    // Create activity log
    await this.createActivityLog({
      action: "Invoice Updated",
      description: `Updated invoice: ${updatedInvoice.invoiceNumber}`,
      referenceType: "invoice",
      referenceId: id
    });
    
    return updatedInvoice;
  }
  
  async deleteInvoice(id: number): Promise<boolean> {
    const invoice = this.invoices.get(id);
    if (!invoice) return false;
    
    // Delete related invoice items
    const items = await this.getInvoiceItems(id);
    for (const item of items) {
      await this.deleteInvoiceItem(item.id);
    }
    
    // Delete related payments
    const payments = await this.getPaymentsByInvoiceId(id);
    for (const payment of payments) {
      await this.deletePayment(payment.id);
    }
    
    // Delete reminder logs
    const reminderLogs = await this.getBillingReminderLogsByInvoiceId(id);
    for (const log of reminderLogs) {
      await this.deleteBillingReminderLog(log.id);
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Invoice Deleted",
      description: `Deleted invoice: ${invoice.invoiceNumber}`,
      referenceType: "invoice",
      referenceId: id
    });
    
    return this.invoices.delete(id);
  }
  
  async getInvoicesByCustomerId(customerId: number): Promise<Invoice[]> {
    return Array.from(this.invoices.values())
      .filter(invoice => invoice.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  
  async getInvoicesByDateRange(startDate: Date, endDate: Date): Promise<Invoice[]> {
    return Array.from(this.invoices.values())
      .filter(invoice => {
        const issueDate = new Date(invoice.issueDate);
        return issueDate >= startDate && issueDate <= endDate;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  
  async getInvoicesByStatus(status: string): Promise<Invoice[]> {
    return Array.from(this.invoices.values())
      .filter(invoice => invoice.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  
  async getOverdueInvoices(): Promise<Invoice[]> {
    const now = new Date();
    return Array.from(this.invoices.values())
      .filter(invoice => {
        return (
          invoice.status !== "PAID" && 
          invoice.status !== "CANCELLED" && 
          invoice.status !== "VOID" &&
          new Date(invoice.dueDate) < now
        );
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }
  
  async getInvoiceDueInDays(days: number): Promise<Invoice[]> {
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + days);
    
    return Array.from(this.invoices.values())
      .filter(invoice => {
        const dueDate = new Date(invoice.dueDate);
        return (
          invoice.status !== "PAID" && 
          invoice.status !== "CANCELLED" && 
          invoice.status !== "VOID" &&
          dueDate > now && 
          dueDate <= futureDate
        );
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }
  
  // Invoice items methods
  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return Array.from(this.invoiceItems.values())
      .filter(item => item.invoiceId === invoiceId);
  }
  
  async getInvoiceItem(id: number): Promise<InvoiceItem | undefined> {
    return this.invoiceItems.get(id);
  }
  
  async addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    const id = this.invoiceItemCurrentId++;
    const now = new Date();
    
    const newItem: InvoiceItem = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now
    };
    
    this.invoiceItems.set(id, newItem);
    
    // Update invoice totals
    const invoice = await this.getInvoice(item.invoiceId);
    if (invoice) {
      const invoiceItems = await this.getInvoiceItems(item.invoiceId);
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
      
      await this.updateInvoice(item.invoiceId, {
        subtotal,
        total: subtotal - (invoice.discount || 0) + (invoice.tax || 0)
      });
    }
    
    return newItem;
  }
  
  async updateInvoiceItem(id: number, item: Partial<InsertInvoiceItem>): Promise<InvoiceItem | undefined> {
    const existingItem = this.invoiceItems.get(id);
    if (!existingItem) return undefined;
    
    const updatedItem = {
      ...existingItem,
      ...item,
      updatedAt: new Date()
    };
    
    this.invoiceItems.set(id, updatedItem);
    
    // Update invoice totals
    const invoice = await this.getInvoice(existingItem.invoiceId);
    if (invoice) {
      const invoiceItems = await this.getInvoiceItems(existingItem.invoiceId);
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
      
      await this.updateInvoice(existingItem.invoiceId, {
        subtotal,
        total: subtotal - (invoice.discount || 0) + (invoice.tax || 0)
      });
    }
    
    return updatedItem;
  }
  
  async deleteInvoiceItem(id: number): Promise<boolean> {
    const item = this.invoiceItems.get(id);
    if (!item) return false;
    
    const invoiceId = item.invoiceId;
    const result = this.invoiceItems.delete(id);
    
    // Update invoice totals
    const invoice = await this.getInvoice(invoiceId);
    if (invoice) {
      const invoiceItems = await this.getInvoiceItems(invoiceId);
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
      
      await this.updateInvoice(invoiceId, {
        subtotal,
        total: subtotal - (invoice.discount || 0) + (invoice.tax || 0)
      });
    }
    
    return result;
  }
  
  // Payment methods
  async getAllPayments(): Promise<Payment[]> {
    return Array.from(this.payments.values());
  }
  
  async getPayment(id: number): Promise<Payment | undefined> {
    return this.payments.get(id);
  }
  
  async getPaymentsByInvoiceId(invoiceId: number): Promise<Payment[]> {
    return Array.from(this.payments.values())
      .filter(payment => payment.invoiceId === invoiceId);
  }
  
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const id = this.paymentCurrentId++;
    const now = new Date();
    
    const newPayment: Payment = {
      ...payment,
      id,
      createdAt: now,
      updatedAt: now,
      paymentDate: payment.paymentDate || now
    };
    
    this.payments.set(id, newPayment);
    
    // Update invoice payment status
    const invoice = await this.getInvoice(payment.invoiceId);
    if (invoice) {
      const payments = await this.getPaymentsByInvoiceId(payment.invoiceId);
      const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
      
      let status: string = invoice.status;
      if (totalPaid >= invoice.total) {
        status = "PAID";
      } else if (totalPaid > 0) {
        status = "PARTIALLY_PAID";
      }
      
      await this.updateInvoice(payment.invoiceId, {
        paidAmount: totalPaid,
        dueAmount: invoice.total - totalPaid,
        status,
        paidDate: totalPaid >= invoice.total ? new Date() : invoice.paidDate
      });
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Payment Recorded",
      description: `Payment of ${payment.amount} recorded for invoice: ${invoice?.invoiceNumber}`,
      referenceType: "payment",
      referenceId: id,
      userId: payment.receivedBy
    });
    
    return newPayment;
  }
  
  async updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment | undefined> {
    const existingPayment = this.payments.get(id);
    if (!existingPayment) return undefined;
    
    const updatedPayment = {
      ...existingPayment,
      ...payment,
      updatedAt: new Date()
    };
    
    this.payments.set(id, updatedPayment);
    
    // Update invoice status if amount changed
    if (payment.amount !== undefined && payment.amount !== existingPayment.amount) {
      const invoice = await this.getInvoice(existingPayment.invoiceId);
      if (invoice) {
        const payments = await this.getPaymentsByInvoiceId(existingPayment.invoiceId);
        const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
        
        let status: string = invoice.status;
        if (totalPaid >= invoice.total) {
          status = "PAID";
        } else if (totalPaid > 0) {
          status = "PARTIALLY_PAID";
        } else {
          status = invoice.sentDate ? "SENT" : "DRAFT";
        }
        
        await this.updateInvoice(existingPayment.invoiceId, {
          paidAmount: totalPaid,
          dueAmount: invoice.total - totalPaid,
          status,
          paidDate: totalPaid >= invoice.total ? new Date() : null
        });
      }
    }
    
    return updatedPayment;
  }
  
  async deletePayment(id: number): Promise<boolean> {
    const payment = this.payments.get(id);
    if (!payment) return false;
    
    const result = this.payments.delete(id);
    
    // Update invoice status
    const invoice = await this.getInvoice(payment.invoiceId);
    if (invoice) {
      const payments = await this.getPaymentsByInvoiceId(payment.invoiceId);
      const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
      
      let status: string = invoice.status;
      if (totalPaid >= invoice.total) {
        status = "PAID";
      } else if (totalPaid > 0) {
        status = "PARTIALLY_PAID";
      } else {
        status = invoice.sentDate ? "SENT" : "DRAFT";
      }
      
      await this.updateInvoice(payment.invoiceId, {
        paidAmount: totalPaid,
        dueAmount: invoice.total - totalPaid,
        status,
        paidDate: totalPaid >= invoice.total ? new Date() : null
      });
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Payment Deleted",
      description: `Payment of ${payment.amount} deleted for invoice: ${invoice?.invoiceNumber}`,
      referenceType: "payment",
      referenceId: id
    });
    
    return result;
  }
  
  async recordInvoicePayment(invoiceId: number, amount: number, method: string, receivedBy: number, reference?: string, notes?: string): Promise<Payment> {
    return this.createPayment({
      invoiceId,
      amount,
      method: method as any,
      receivedBy,
      transactionReference: reference,
      notes,
      paymentDate: new Date()
    });
  }
  
  // Billing settings methods
  async getBillingSettings(): Promise<BillingSetting | undefined> {
    // For simplicity, return the first billing settings entry
    return Array.from(this.billingSettings.values())[0];
  }
  
  async updateBillingSettings(settings: Partial<InsertBillingSetting>): Promise<BillingSetting> {
    // Get existing settings or create new ones
    const existingSettings = await this.getBillingSettings();
    
    if (existingSettings) {
      // Update existing settings
      const updatedSettings = {
        ...existingSettings,
        ...settings,
        updatedAt: new Date()
      };
      
      this.billingSettings.set(existingSettings.id, updatedSettings);
      
      // Create activity log
      await this.createActivityLog({
        action: "Billing Settings Updated",
        description: `Updated billing settings for ${updatedSettings.companyName}`,
        referenceType: "billing_settings",
        referenceId: existingSettings.id
      });
      
      return updatedSettings;
    } else {
      // Create new settings
      const id = this.billingSettingCurrentId++;
      const now = new Date();
      
      const companyName = settings.companyName || "Default Company";
      
      const newSettings: BillingSetting = {
        id,
        companyName,
        companyAddress: settings.companyAddress || null,
        companyPhone: settings.companyPhone || null,
        companyEmail: settings.companyEmail || null,
        companyWebsite: settings.companyWebsite || null,
        companyLogo: settings.companyLogo || null,
        taxIdentificationNumber: settings.taxIdentificationNumber || null,
        defaultTaxRate: settings.defaultTaxRate || 0,
        defaultPaymentTerms: settings.defaultPaymentTerms || 30,
        invoicePrefix: settings.invoicePrefix || "INV-",
        invoiceFooter: settings.invoiceFooter || null,
        enableAutomaticReminders: settings.enableAutomaticReminders !== undefined ? settings.enableAutomaticReminders : true,
        reminderDays: settings.reminderDays || [7, 3, 1],
        updatedAt: now
      };
      
      this.billingSettings.set(id, newSettings);
      
      // Create activity log
      await this.createActivityLog({
        action: "Billing Settings Created",
        description: `Created billing settings for ${newSettings.companyName}`,
        referenceType: "billing_settings",
        referenceId: id
      });
      
      return newSettings;
    }
  }
  
  // Tax rate methods
  async getAllTaxRates(): Promise<TaxRate[]> {
    return Array.from(this.taxRates.values());
  }
  
  async getTaxRate(id: number): Promise<TaxRate | undefined> {
    return this.taxRates.get(id);
  }
  
  async getDefaultTaxRate(): Promise<TaxRate | undefined> {
    return Array.from(this.taxRates.values()).find(rate => rate.isDefault);
  }
  
  async createTaxRate(taxRate: InsertTaxRate): Promise<TaxRate> {
    const id = this.taxRateCurrentId++;
    const now = new Date();
    
    const newTaxRate: TaxRate = {
      ...taxRate,
      id,
      createdAt: now,
      updatedAt: now,
      isActive: taxRate.isActive !== undefined ? taxRate.isActive : true,
      isDefault: taxRate.isDefault !== undefined ? taxRate.isDefault : false
    };
    
    // If this is set as default, update other tax rates
    if (newTaxRate.isDefault) {
      await this.setDefaultTaxRate(id);
    }
    
    this.taxRates.set(id, newTaxRate);
    
    // Create activity log
    await this.createActivityLog({
      action: "Tax Rate Created",
      description: `Created tax rate: ${newTaxRate.name} (${newTaxRate.rate}%)`,
      referenceType: "tax_rate",
      referenceId: id
    });
    
    return newTaxRate;
  }
  
  async updateTaxRate(id: number, taxRate: Partial<InsertTaxRate>): Promise<TaxRate | undefined> {
    const existingRate = this.taxRates.get(id);
    if (!existingRate) return undefined;
    
    const updatedRate = {
      ...existingRate,
      ...taxRate,
      updatedAt: new Date()
    };
    
    // If this is being set as default, update other tax rates
    if (taxRate.isDefault && !existingRate.isDefault) {
      await this.setDefaultTaxRate(id);
    }
    
    this.taxRates.set(id, updatedRate);
    
    // Create activity log
    await this.createActivityLog({
      action: "Tax Rate Updated",
      description: `Updated tax rate: ${updatedRate.name} (${updatedRate.rate}%)`,
      referenceType: "tax_rate",
      referenceId: id
    });
    
    return updatedRate;
  }
  
  async deleteTaxRate(id: number): Promise<boolean> {
    const taxRate = this.taxRates.get(id);
    if (!taxRate) return false;
    
    // Don't allow deletion of default tax rate
    if (taxRate.isDefault) {
      throw new Error("Cannot delete default tax rate");
    }
    
    // Create activity log
    await this.createActivityLog({
      action: "Tax Rate Deleted",
      description: `Deleted tax rate: ${taxRate.name}`,
      referenceType: "tax_rate",
      referenceId: id
    });
    
    return this.taxRates.delete(id);
  }
  
  async setDefaultTaxRate(id: number): Promise<TaxRate | undefined> {
    // First, set all existing tax rates to non-default
    for (const [existingId, existingRate] of this.taxRates.entries()) {
      if (existingId !== id && existingRate.isDefault) {
        this.taxRates.set(existingId, { 
          ...existingRate, 
          isDefault: false, 
          updatedAt: new Date() 
        });
      }
    }
    
    // Now set the specified tax rate as default
    const taxRate = this.taxRates.get(id);
    if (!taxRate) return undefined;
    
    const updatedTaxRate = {
      ...taxRate,
      isDefault: true,
      updatedAt: new Date()
    };
    
    this.taxRates.set(id, updatedTaxRate);
    
    // Create activity log
    await this.createActivityLog({
      action: "Default Tax Rate Changed",
      description: `Set default tax rate to: ${updatedTaxRate.name} (${updatedTaxRate.rate}%)`,
      referenceType: "tax_rate",
      referenceId: id
    });
    
    return updatedTaxRate;
  }
  
  // Discount methods
  async getAllDiscounts(): Promise<Discount[]> {
    return Array.from(this.discounts.values());
  }
  
  async getDiscount(id: number): Promise<Discount | undefined> {
    return this.discounts.get(id);
  }
  
  async getActiveDiscounts(): Promise<Discount[]> {
    const now = new Date();
    return Array.from(this.discounts.values())
      .filter(discount => {
        return discount.isActive && 
               (!discount.startDate || new Date(discount.startDate) <= now) &&
               (!discount.endDate || new Date(discount.endDate) >= now);
      });
  }
  
  async createDiscount(discount: InsertDiscount): Promise<Discount> {
    const id = this.discountCurrentId++;
    const now = new Date();
    
    const newDiscount: Discount = {
      ...discount,
      id,
      createdAt: now,
      updatedAt: now,
      isActive: discount.isActive !== undefined ? discount.isActive : true
    };
    
    this.discounts.set(id, newDiscount);
    
    // Create activity log
    await this.createActivityLog({
      action: "Discount Created",
      description: `Created discount: ${newDiscount.name}`,
      referenceType: "discount",
      referenceId: id
    });
    
    return newDiscount;
  }
  
  async updateDiscount(id: number, discount: Partial<InsertDiscount>): Promise<Discount | undefined> {
    const existingDiscount = this.discounts.get(id);
    if (!existingDiscount) return undefined;
    
    const updatedDiscount = {
      ...existingDiscount,
      ...discount,
      updatedAt: new Date()
    };
    
    this.discounts.set(id, updatedDiscount);
    
    // Create activity log
    await this.createActivityLog({
      action: "Discount Updated",
      description: `Updated discount: ${updatedDiscount.name}`,
      referenceType: "discount",
      referenceId: id
    });
    
    return updatedDiscount;
  }
  
  async deleteDiscount(id: number): Promise<boolean> {
    const discount = this.discounts.get(id);
    if (!discount) return false;
    
    // Create activity log
    await this.createActivityLog({
      action: "Discount Deleted",
      description: `Deleted discount: ${discount.name}`,
      referenceType: "discount",
      referenceId: id
    });
    
    return this.discounts.delete(id);
  }
  
  // Billing reminder logs
  async getAllBillingReminderLogs(): Promise<BillingReminderLog[]> {
    return Array.from(this.billingReminderLogs.values());
  }
  
  async getBillingReminderLog(id: number): Promise<BillingReminderLog | undefined> {
    return this.billingReminderLogs.get(id);
  }
  
  async getBillingReminderLogsByInvoiceId(invoiceId: number): Promise<BillingReminderLog[]> {
    return Array.from(this.billingReminderLogs.values())
      .filter(log => log.invoiceId === invoiceId)
      .sort((a, b) => new Date(b.sentDate).getTime() - new Date(a.sentDate).getTime());
  }
  
  async createBillingReminderLog(log: InsertBillingReminderLog): Promise<BillingReminderLog> {
    const id = this.billingReminderLogCurrentId++;
    const now = new Date();
    
    const newLog: BillingReminderLog = {
      ...log,
      id,
      createdAt: now,
      sentDate: log.sentDate || now
    };
    
    this.billingReminderLogs.set(id, newLog);
    
    return newLog;
  }
  
  async deleteBillingReminderLog(id: number): Promise<boolean> {
    return this.billingReminderLogs.delete(id);
  }
  
  // Image Analysis methods
  async logImageAnalysis(log: InsertImageAnalysisLog): Promise<ImageAnalysisLog> {
    const id = this.imageAnalysisLogCurrentId++;
    const timestamp = new Date();
    
    const newLog: ImageAnalysisLog = {
      id,
      userId: log.userId,
      imageHash: log.imageHash,
      recognitionResults: log.recognitionResults || null,
      itemId: log.itemId || null,
      confidence: log.confidence || null,
      isTrainingData: log.isTrainingData || null,
      notes: log.notes || null,
      timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    this.imageAnalysisLogs.set(id, newLog);
    
    // Also create an activity log
    this.createActivityLog({
      action: "Image Analysis",
      description: `Analyzed image for item ${log.itemId || 'Unknown'}`,
      userId: log.userId,
      itemId: log.itemId || null,
      referenceType: "image_analysis",
      referenceId: id
    }).catch(error => {
      console.error("Error creating activity log for image analysis:", error);
    });
    
    return newLog;
  }
  
  async getItemImageAnalysisHistory(itemId: number): Promise<ImageAnalysisLog[]> {
    return Array.from(this.imageAnalysisLogs.values())
      .filter(log => log.itemId === itemId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Sort by timestamp descending
  }
  
  async getImageAnalysisByUserId(userId: number): Promise<ImageAnalysisLog[]> {
    return Array.from(this.imageAnalysisLogs.values())
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Sort by timestamp descending
  }
}

// DatabaseStorage implementation with PostgreSQL
export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool: pool,
      createTableIfMissing: true 
    });
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(
        and(
          eq(users.passwordResetToken, token),
          isNotNull(users.passwordResetExpires),
          gt(users.passwordResetExpires, new Date())
        )
      );
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    
    // Create a welcome verification token
    await this.createVerificationToken(newUser.id, 'email');
    
    return newUser;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
      
    return updatedUser;
  }
  
  async updateProfilePicture(userId: number, profilePictureUrl: string | null): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ 
        profilePicture: profilePictureUrl,
        updatedAt: new Date() 
      })
      .where(eq(users.id, userId))
      .returning();
      
    return updatedUser;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  // Category methods
  async getAllCategories(): Promise<Category[]> {
    return db.select().from(categories);
  }

  async getCategory(id: number): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    return category;
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const [newCategory] = await db.insert(categories).values(category).returning();
    return newCategory;
  }

  // Inventory item methods
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    return db.select().from(inventoryItems);
  }

  async getInventoryItem(id: number): Promise<InventoryItem | undefined> {
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    return item;
  }

  async getInventoryItemBySku(sku: string): Promise<InventoryItem | undefined> {
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.sku, sku));
    return item;
  }

  async createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem> {
    const [newItem] = await db.insert(inventoryItems).values(item).returning();
    return newItem;
  }

  async updateInventoryItem(id: number, item: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined> {
    const [updatedItem] = await db
      .update(inventoryItems)
      .set({
        ...item,
        updatedAt: new Date()
      })
      .where(eq(inventoryItems.id, id))
      .returning();
    
    return updatedItem;
  }

  // Settings methods
  async getSettings(): Promise<AppSettings> {
    const [settings] = await db.select().from(appSettings);
    if (settings) {
      return settings;
    }

    // If no settings exist, create default settings
    const defaultSettings: InsertAppSettings = {
      companyName: "My Inventory System",
      primaryColor: "#4f46e5",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "hh:mm A",
      currencySymbol: "$",
      lowStockDefaultThreshold: 10,
      allowNegativeInventory: false,
      enableVat: false,
      defaultVatCountry: "US",
      showPricesWithVat: true
    };

    const [newSettings] = await db.insert(appSettings).values(defaultSettings).returning();
    return newSettings;
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const currentSettings = await this.getSettings();
    
    const [updatedSettings] = await db
      .update(appSettings)
      .set({
        ...settings,
        updatedAt: new Date()
      })
      .where(eq(appSettings.id, currentSettings.id))
      .returning();
    
    return updatedSettings;
  }
  
  // Activity log methods
  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [newLog] = await db.insert(activityLogs).values(log).returning();
    return newLog;
  }

  async getAllActivityLogs(limit?: number): Promise<ActivityLog[]> {
    const query = db.select().from(activityLogs).orderBy(desc(activityLogs.timestamp));
    
    if (limit) {
      query.limit(limit);
    }
    
    return query;
  }

  // Additional methods would be implemented here following the same pattern
  // Each method would use Drizzle ORM to interact with the database
  
  // For the remaining methods, we use MemStorage temporarily until they're fully implemented
  // We create an instance of MemStorage for temporary fallback
  private memStorage = new MemStorage();
  
  // Image Analysis Log methods
  async logImageAnalysis(log: InsertImageAnalysisLog): Promise<ImageAnalysisLog> {
    try {
      // Create an activity log entry
      const activityLogPromise = db.insert(activityLogs).values({
        action: "Image Analysis",
        description: `Analyzed image for item ${log.itemId || 'Unknown'}`,
        userId: log.userId,
        itemId: log.itemId || null,
        referenceType: "image_analysis",
        timestamp: new Date()
      });
      
      // Add the log entry
      const [newLog] = await db
        .insert(imageAnalysisLogs)
        .values({
          ...log,
          timestamp: log.timestamp || new Date(),
        })
        .returning();
        
      // Wait for the activity log to complete (but don't block returning the result)
      activityLogPromise.catch(error => {
        console.error("Error creating activity log for image analysis:", error);
      });
        
      return newLog;
    } catch (error) {
      console.error("Error logging image analysis:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.logImageAnalysis(log);
    }
  }
  
  async getItemImageAnalysisHistory(itemId: number): Promise<ImageAnalysisLog[]> {
    try {
      const logs = await db
        .select()
        .from(imageAnalysisLogs)
        .where(eq(imageAnalysisLogs.itemId, itemId))
        .orderBy(desc(imageAnalysisLogs.timestamp));
        
      return logs;
    } catch (error) {
      console.error("Error getting item image analysis history:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.getItemImageAnalysisHistory(itemId);
    }
  }
  
  async getImageAnalysisByUserId(userId: number): Promise<ImageAnalysisLog[]> {
    try {
      const logs = await db
        .select()
        .from(imageAnalysisLogs)
        .where(eq(imageAnalysisLogs.userId, userId))
        .orderBy(desc(imageAnalysisLogs.timestamp));
        
      return logs;
    } catch (error) {
      console.error("Error getting user image analysis logs:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.getImageAnalysisByUserId(userId);
    }
  }
  
  // Delegate methods to memStorage for those not yet implemented
  async getUserByResetToken(token: string): Promise<User | undefined> {
    return this.memStorage.getUserByResetToken(token);
  }
  
  async getUserCustomRoleId(userId: number): Promise<number | null> {
    return this.memStorage.getUserCustomRoleId(userId);
  }
  
  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          ...user,
          updatedAt: new Date()
        })
        .where(eq(users.id, id))
        .returning();
      
      return updatedUser;
    } catch (error) {
      console.error("Error updating user:", error);
      return undefined;
    }
  }
  
  async updateProfilePicture(userId: number, profilePictureUrl: string | null): Promise<User> {
    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          profilePicture: profilePictureUrl,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
      
      if (!updatedUser) {
        throw new Error(`User with ID ${userId} not found`);
      }
      
      return updatedUser;
    } catch (error) {
      console.error("Error updating profile picture:", error);
      throw error;
    }
  }
  
  async getUserPreferences(userId: number): Promise<UserPreference | undefined> {
    return this.memStorage.getUserPreferences(userId);
  }
  
  async updateUserPreferences(userId: number, preferences: Partial<InsertUserPreference>): Promise<UserPreference | undefined> {
    return this.memStorage.updateUserPreferences(userId, preferences);
  }
  
  async deleteUser(id: number): Promise<boolean> {
    return this.memStorage.deleteUser(id);
  }
  
  async checkPermission(role: string, resource: string, permissionType: string): Promise<boolean> {
    return this.memStorage.checkPermission(role, resource, permissionType);
  }
  
  async checkCustomRolePermission(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<boolean> {
    return this.memStorage.checkCustomRolePermission(roleId, resource, permissionType);
  }
  
  async getSystemRoles(): Promise<string[]> {
    return this.memStorage.getSystemRoles();
  }
  
  async getCustomRoles(): Promise<CustomRole[]> {
    return this.memStorage.getCustomRoles();
  }
  
  async getCustomRole(id: number): Promise<CustomRole | undefined> {
    return this.memStorage.getCustomRole(id);
  }
  
  async createCustomRole(role: InsertCustomRole): Promise<CustomRole> {
    return this.memStorage.createCustomRole(role);
  }
  
  async updateCustomRole(id: number, role: Partial<InsertCustomRole>): Promise<CustomRole | undefined> {
    return this.memStorage.updateCustomRole(id, role);
  }
  
  async deleteCustomRole(id: number): Promise<boolean> {
    return this.memStorage.deleteCustomRole(id);
  }
  
  async getRolePermissions(role: keyof typeof UserRoleEnum): Promise<Permission[]> {
    return this.memStorage.getRolePermissions(role);
  }
  
  async getCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]> {
    return this.memStorage.getCustomRolePermissions(roleId);
  }
  
  async addCustomRolePermission(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<CustomRolePermission> {
    return this.memStorage.addCustomRolePermission(roleId, resource, permissionType);
  }
  
  async removeCustomRolePermission(roleId: number, permissionId: number): Promise<boolean> {
    return this.memStorage.removeCustomRolePermission(roleId, permissionId);
  }
  
  async logUserAccess(log: InsertUserAccessLog): Promise<UserAccessLog> {
    try {
      const [accessLog] = await db
        .insert(userAccessLogs)
        .values({
          ...log,
          timestamp: new Date()
        })
        .returning();
        
      return accessLog;
    } catch (error) {
      console.error("Error logging user access:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.logUserAccess(log);
    }
  }
  
  async getUserAccessLogs(userId: number): Promise<UserAccessLog[]> {
    try {
      const logs = await db
        .select()
        .from(userAccessLogs)
        .where(eq(userAccessLogs.userId, userId))
        .orderBy(desc(userAccessLogs.timestamp))
        .limit(50);
        
      return logs;
    } catch (error) {
      console.error("Error getting user access logs:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.getUserAccessLogs(userId);
    }
  }
  
  async getRecentUserAccessLogs(limit: number = 10): Promise<UserAccessLog[]> {
    try {
      const logs = await db
        .select()
        .from(userAccessLogs)
        .orderBy(desc(userAccessLogs.timestamp))
        .limit(limit);
        
      return logs;
    } catch (error) {
      console.error("Error getting recent user access logs:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.getRecentUserAccessLogs(limit);
    }
  }
  
  async authenticateUser(credentials: UserLogin): Promise<User | null> {
    try {
      const user = await this.getUserByUsername(credentials.username);
      // Authentication is handled by Passport in auth.ts, so we just return the user or null
      return user || null;
    } catch (error) {
      console.error("Error authenticating user:", error);
      return null;
    }
  }
  
  async recordLoginAttempt(username: string, success: boolean): Promise<void> {
    try {
      // Log the login attempt
      const user = await this.getUserByUsername(username);
      if (user) {
        await this.logUserAccess(user.id, success ? 'login_success' : 'login_failure');
      }
    } catch (error) {
      console.error("Error recording login attempt:", error);
    }
  }
  
  async resetFailedLoginAttempts(userId: number): Promise<void> {
    try {
      // This is a simplified implementation for now
      console.log(`Reset failed login attempts for user ID: ${userId}`);
    } catch (error) {
      console.error("Error resetting failed login attempts:", error);
    }
  }
  
  async isAccountLocked(userId: number): Promise<boolean> {
    try {
      // This is a simplified implementation that doesn't lock accounts
      return false;
    } catch (error) {
      console.error("Error checking if account is locked:", error);
      return false;
    }
  }
  
  async createVerificationToken(userId: number, tokenType: string, expiresInMinutes: number = 60): Promise<UserVerificationToken> {
    try {
      // Generate a random token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Calculate expiry (default to 60 minutes if not specified)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);
      
      // Create the token in the database
      const [verificationToken] = await db
        .insert(userVerificationTokens)
        .values({
          userId,
          token,
          type: tokenType,
          expiresAt,
          createdAt: new Date(),
          used: false
        })
        .returning();
        
      return verificationToken;
    } catch (error) {
      console.error("Error creating verification token:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.createVerificationToken(userId, tokenType, expiresInMinutes);
    }
  }
  
  async getVerificationToken(token: string, type: string): Promise<UserVerificationToken | undefined> {
    try {
      const [verificationToken] = await db
        .select()
        .from(userVerificationTokens)
        .where(
          and(
            eq(userVerificationTokens.token, token),
            eq(userVerificationTokens.type, type),
            eq(userVerificationTokens.used, false)
          )
        );
        
      return verificationToken;
    } catch (error) {
      console.error("Error getting verification token:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.getVerificationToken(token, type);
    }
  }
  
  async useVerificationToken(token: string, type: string): Promise<UserVerificationToken | undefined> {
    try {
      // Get the token
      const verificationToken = await this.getVerificationToken(token, type);
      
      if (!verificationToken) {
        return undefined;
      }
      
      // Mark token as used
      const [updatedToken] = await db
        .update(userVerificationTokens)
        .set({
          used: true,
          usedAt: new Date()
        })
        .where(eq(userVerificationTokens.id, verificationToken.id))
        .returning();
        
      return updatedToken;
    } catch (error) {
      console.error("Error using verification token:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.useVerificationToken(token, type);
    }
  }
  
  async markEmailAsVerified(userId: number): Promise<User | undefined> {
    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          emailVerified: true,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
        
      return updatedUser;
    } catch (error) {
      console.error("Error marking email as verified:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.markEmailAsVerified(userId);
    }
  }
  
  async createPasswordResetToken(email: string): Promise<UserVerificationToken | null> {
    try {
      // Find the user by email
      const user = await this.getUserByEmail(email);
      
      if (!user) {
        return null;
      }
      
      // Create a token with 15 minute expiry
      const token = await this.createVerificationToken(user.id, 'password_reset', 15);
      
      // Update the user with the reset token
      await this.updateUser(user.id, {
        passwordResetToken: token.token,
        passwordResetExpires: token.expiresAt
      });
      
      return token;
    } catch (error) {
      console.error("Error creating password reset token:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.createPasswordResetToken(email);
    }
  }
  
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    try {
      // Find the user by reset token
      const user = await this.getUserByResetToken(token);
      
      if (!user) {
        return false;
      }
      
      // Hash the new password
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(newPassword, salt, 10000, 64, 'sha512').toString('hex');
      const hashedPassword = `${hash}.${salt}`;
      
      // Update the user's password and clear the reset token
      await this.updateUser(user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        lastPasswordChange: new Date(),
        failedLoginAttempts: 0,
        accountLocked: false
      });
      
      // Mark the password reset token as used
      const verificationToken = await this.getVerificationToken(token, 'password_reset');
      if (verificationToken) {
        await this.useVerificationToken(token, 'password_reset');
      }
      
      return true;
    } catch (error) {
      console.error("Error resetting password:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.resetPassword(token, newPassword);
    }
  }
  
  async verifyEmail(token: string): Promise<boolean> {
    try {
      // Get the verification token
      const verificationToken = await this.getVerificationToken(token, 'email');
      
      if (!verificationToken) {
        return false;
      }
      
      // Check if token is expired
      const now = new Date();
      if (verificationToken.expiresAt < now) {
        return false;
      }
      
      // Mark user's email as verified
      await this.markEmailAsVerified(verificationToken.userId);
      
      // Mark token as used
      await this.useVerificationToken(token, 'email');
      
      // Log the verification
      await this.logUserAccess(verificationToken.userId, 'email_verified');
      
      return true;
    } catch (error) {
      console.error("Error verifying email:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.verifyEmail ? this.memStorage.verifyEmail(token) : false;
    }
  }
  
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      
      if (!user) {
        return false;
      }
      
      // Verify current password
      const [currentHash, currentSalt] = user.password.split('.');
      const currentBuffer = Buffer.from(currentHash, 'hex');
      const suppliedBuffer = crypto.pbkdf2Sync(currentPassword, currentSalt, 10000, 64, 'sha512');
      
      if (!crypto.timingSafeEqual(currentBuffer, suppliedBuffer)) {
        return false;
      }
      
      // Hash the new password
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(newPassword, salt, 10000, 64, 'sha512').toString('hex');
      const hashedPassword = `${hash}.${salt}`;
      
      // Update the user's password
      await this.updateUser(userId, {
        password: hashedPassword,
        lastPasswordChange: new Date()
      });
      
      return true;
    } catch (error) {
      console.error("Error changing password:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.changePassword(userId, currentPassword, newPassword);
    }
  }
  
  async generateTwoFactorSecret(userId: number): Promise<string> {
    try {
      // Import speakeasy here to avoid global import issues
      const speakeasy = require('speakeasy');
      
      // Generate a secret
      const secret = speakeasy.generateSecret({
        name: `Inventory Manager (User ${userId})`
      });
      
      // Save the secret to the user's record
      await this.updateUser(userId, {
        twoFactorSecret: secret.base32
      });
      
      return secret.base32;
    } catch (error) {
      console.error("Error generating 2FA secret:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.generateTwoFactorSecret(userId);
    }
  }
  
  async enableTwoFactorAuth(userId: number, verified: boolean): Promise<User | undefined> {
    try {
      // Update the user to enable 2FA
      const [updatedUser] = await db
        .update(users)
        .set({
          twoFactorEnabled: verified,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
        
      return updatedUser;
    } catch (error) {
      console.error("Error enabling 2FA:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.enableTwoFactorAuth(userId, verified);
    }
  }
  
  async disableTwoFactorAuth(userId: number): Promise<User | undefined> {
    try {
      // Update the user to disable 2FA and clear the secret
      const [updatedUser] = await db
        .update(users)
        .set({
          twoFactorEnabled: false,
          twoFactorSecret: null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
        
      return updatedUser;
    } catch (error) {
      console.error("Error disabling 2FA:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.disableTwoFactorAuth(userId);
    }
  }
  
  async getFailedLoginAttempts(userId: number, hours: number = 24): Promise<UserAccessLog[]> {
    try {
      // Calculate the time window
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);
      
      // Get the failed login attempts
      const logs = await db
        .select()
        .from(userAccessLogs)
        .where(
          and(
            eq(userAccessLogs.userId, userId),
            eq(userAccessLogs.action, 'login_failure'),
            gt(userAccessLogs.timestamp, cutoffTime)
          )
        )
        .orderBy(desc(userAccessLogs.timestamp));
        
      return logs;
    } catch (error) {
      console.error("Error getting failed login attempts:", error);
      return [];
    }
  }
  
  async hasUserUsedIpBefore(userId: number, ipAddress: string): Promise<boolean> {
    try {
      // Look for previous successful logins with this IP
      const [log] = await db
        .select()
        .from(userAccessLogs)
        .where(
          and(
            eq(userAccessLogs.userId, userId),
            eq(userAccessLogs.action, 'login_success'),
            eq(userAccessLogs.ipAddress, ipAddress)
          )
        )
        .limit(1);
        
      return !!log;
    } catch (error) {
      console.error("Error checking if user has used IP before:", error);
      return false;
    }
  }
  
  async hasUserUsedUserAgentBefore(userId: number, userAgent: string): Promise<boolean> {
    try {
      // Look for previous successful logins with this user agent
      const [log] = await db
        .select()
        .from(userAccessLogs)
        .where(
          and(
            eq(userAccessLogs.userId, userId),
            eq(userAccessLogs.action, 'login_success'),
            eq(userAccessLogs.userAgent, userAgent)
          )
        )
        .limit(1);
        
      return !!log;
    } catch (error) {
      console.error("Error checking if user has used user agent before:", error);
      return false;
    }
  }
  
  async verifyTwoFactorToken(userId: number, token: string): Promise<boolean> {
    try {
      // Import speakeasy here to avoid global import issues
      const speakeasy = require('speakeasy');
      
      // Get the user record to retrieve their secret
      const user = await this.getUser(userId);
      
      if (!user || !user.twoFactorSecret) {
        return false;
      }
      
      // Verify the token against the user's secret
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 1 // Allow a time skew of ±30 seconds
      });
      
      // If verification succeeds, update the user's record to mark 2FA as enabled
      if (verified) {
        // Log successful 2FA verification
        await this.logUserAccess(userId, 'two_factor_verification_success');
        return true;
      } else {
        // Log failed 2FA verification
        await this.logUserAccess(userId, 'two_factor_verification_failure');
        return false;
      }
    } catch (error) {
      console.error("Error verifying 2FA token:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.verifyTwoFactorToken(userId, token);
    }
  }
  
  async createSession(userId: number, ipAddress?: string, userAgent?: string, expiresInDays: number = 30): Promise<Session> {
    try {
      // Generate a session token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Calculate session expiry (default to 30 days if not specified)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      
      // Create the session in the database
      const [session] = await db
        .insert(sessions)
        .values({
          userId,
          token,
          ipAddress: ipAddress || '127.0.0.1',
          userAgent: userAgent || 'Unknown',
          expiresAt,
          createdAt: new Date(),
          lastActiveAt: new Date(),
          isActive: true
        })
        .returning();
      
      // Log session creation
      await this.logUserAccess(userId, 'session_created', { sessionId: session.id }, ipAddress, userAgent);
      
      return session;
    } catch (error) {
      console.error("Error creating session:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.createSession(userId, ipAddress, userAgent, expiresInDays);
    }
  }
  
  async getSession(token: string): Promise<Session | undefined> {
    try {
      // Get the session
      const [session] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.token, token),
            eq(sessions.isActive, true),
            gt(sessions.expiresAt, new Date())
          )
        );
      
      // If session exists, update lastActiveAt timestamp
      if (session) {
        await db
          .update(sessions)
          .set({
            lastActiveAt: new Date()
          })
          .where(eq(sessions.id, session.id));
      }
      
      return session;
    } catch (error) {
      console.error("Error getting session:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.getSession(token);
    }
  }
  
  async invalidateSession(token: string): Promise<boolean> {
    try {
      // Get the session to log the action
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.token, token));
      
      if (!session) {
        return false;
      }
      
      // Mark session as inactive
      await db
        .update(sessions)
        .set({
          isActive: false
        })
        .where(eq(sessions.id, session.id));
      
      // Log the session invalidation
      await this.logUserAccess(session.userId, 'session_invalidated', { sessionId: session.id });
      
      return true;
    } catch (error) {
      console.error("Error invalidating session:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.invalidateSession(token);
    }
  }
  
  async invalidateAllUserSessions(userId: number): Promise<boolean> {
    try {
      // Mark all user's sessions as inactive
      await db
        .update(sessions)
        .set({
          isActive: false
        })
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.isActive, true)
          )
        );
      
      // Log the action
      await this.logUserAccess(userId, 'all_sessions_invalidated');
      
      return true;
    } catch (error) {
      console.error("Error invalidating all user sessions:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.invalidateAllUserSessions(userId);
    }
  }
  
  async cleanExpiredSessions(): Promise<void> {
    try {
      // Get the expired sessions for logging
      const expiredSessions = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.isActive, true),
            lt(sessions.expiresAt, new Date())
          )
        );
      
      // Mark all expired sessions as inactive
      await db
        .update(sessions)
        .set({
          isActive: false
        })
        .where(
          and(
            eq(sessions.isActive, true),
            lt(sessions.expiresAt, new Date())
          )
        );
      
      // Log the number of expired sessions cleaned
      console.log(`Cleaned ${expiredSessions.length} expired sessions`);
    } catch (error) {
      console.error("Error cleaning expired sessions:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.cleanExpiredSessions();
    }
  }
  
  async getAllPermissions(): Promise<Permission[]> {
    return this.memStorage.getAllPermissions();
  }
  
  async getPermission(id: number): Promise<Permission | undefined> {
    return this.memStorage.getPermission(id);
  }
  
  async getPermissionsByRole(role: keyof typeof UserRoleEnum): Promise<Permission[]> {
    return this.memStorage.getPermissionsByRole(role);
  }
  
  async getPermissionsByResource(resource: keyof typeof ResourceEnum): Promise<Permission[]> {
    return this.memStorage.getPermissionsByResource(resource);
  }
  
  createPermission(permission: InsertPermission): Permission {
    return this.memStorage.createPermission(permission);
  }
  
  async updatePermission(id: number, permission: Partial<InsertPermission>): Promise<Permission | undefined> {
    return this.memStorage.updatePermission(id, permission);
  }
  
  async deletePermission(id: number): Promise<boolean> {
    return this.memStorage.deletePermission(id);
  }
  
  async getAllCustomRoles(): Promise<CustomRole[]> {
    return this.memStorage.getAllCustomRoles();
  }
  
  async getCustomRoleByName(name: string): Promise<CustomRole | undefined> {
    return this.memStorage.getCustomRoleByName(name);
  }
  
  async addPermissionToCustomRole(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<CustomRolePermission> {
    return this.memStorage.addPermissionToCustomRole(roleId, resource, permissionType);
  }
  
  async removePermissionFromCustomRole(roleId: number, resource: keyof typeof ResourceEnum, permissionType: keyof typeof PermissionTypeEnum): Promise<boolean> {
    return this.memStorage.removePermissionFromCustomRole(roleId, resource, permissionType);
  }
  
  async logUserAccess(userId: number, action: string, details?: any, ip?: string, userAgent?: string): Promise<UserAccessLog> {
    try {
      // Insert a new access log record in the database
      const [accessLog] = await db
        .insert(userAccessLogs)
        .values({
          userId,
          action,
          details: details || {},
          ipAddress: ip || '127.0.0.1',
          userAgent: userAgent || 'Unknown',
          timestamp: new Date(),
          geolocation: null,
          sessionId: null
        })
        .returning();
        
      return accessLog;
    } catch (error) {
      console.error("Error logging user access:", error);
      
      // If database operation fails, fall back to memory storage
      const log = {
        userId,
        action,
        details,
        ipAddress: ip,
        userAgent: userAgent
      };
      
      try {
        return this.memStorage.logUserAccess(log as InsertUserAccessLog);
      } catch (fallbackError) {
        // In case memory storage also fails, log to console and create a local record
        console.error("Memory storage fallback also failed:", fallbackError);
        console.log(`User access log: User ID ${userId}, Action: ${action}, Details:`, details);
        
        return {
          id: Date.now(),
          userId,
          action,
          details: details || {},
          ipAddress: ip || '127.0.0.1',
          userAgent: userAgent || 'Unknown',
          geolocation: null,
          sessionId: null,
          timestamp: new Date(),
        };
      }
    }
  }
  
  async getUserAccessLogs(userId: number, limit?: number): Promise<UserAccessLog[]> {
    try {
      let query = db
        .select()
        .from(userAccessLogs)
        .where(eq(userAccessLogs.userId, userId))
        .orderBy(desc(userAccessLogs.timestamp));
      
      if (limit) {
        query = query.limit(limit);
      }
      
      const logs = await query;
      return logs;
    } catch (error) {
      console.error("Error getting user access logs:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.getUserAccessLogs(userId, limit);
    }
  }
  
  async getRecentUserAccessLogs(limit: number = 10): Promise<UserAccessLog[]> {
    try {
      const logs = await db
        .select()
        .from(userAccessLogs)
        .orderBy(desc(userAccessLogs.timestamp))
        .limit(limit);
        
      return logs;
    } catch (error) {
      console.error("Error getting recent user access logs:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.getRecentUserAccessLogs(limit);
    }
  }
  
  async getFailedLoginAttempts(userId: number, hours: number = 24): Promise<UserAccessLog[]> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);
      
      const logs = await db
        .select()
        .from(userAccessLogs)
        .where(
          and(
            eq(userAccessLogs.userId, userId),
            eq(userAccessLogs.action, 'login_failure'),
            gt(userAccessLogs.timestamp, cutoffTime)
          )
        )
        .orderBy(desc(userAccessLogs.timestamp));
        
      return logs;
    } catch (error) {
      console.error("Error getting failed login attempts:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.getFailedLoginAttempts(userId, hours);
    }
  }
  
  async getUserContactInfo(userId: number): Promise<UserContact | undefined> {
    try {
      const [contact] = await db
        .select()
        .from(userContacts)
        .where(eq(userContacts.userId, userId));
      
      return contact;
    } catch (error) {
      console.error("Error getting user contact info:", error);
      return undefined;
    }
  }
  
  async updateUserContactInfo(userId: number, contactInfo: Partial<InsertUserContact>): Promise<UserContact | undefined> {
    try {
      // Check if contact info already exists for this user
      const existingContact = await this.getUserContactInfo(userId);
      
      if (existingContact) {
        // Update existing contact info
        const [updatedContact] = await db
          .update(userContacts)
          .set({
            ...contactInfo,
            updatedAt: new Date()
          })
          .where(eq(userContacts.id, existingContact.id))
          .returning();
          
        return updatedContact;
      } else {
        // Create new contact info
        const [newContact] = await db
          .insert(userContacts)
          .values({
            userId,
            ...contactInfo,
            updatedAt: new Date()
          })
          .returning();
          
        return newContact;
      }
    } catch (error) {
      console.error("Error updating user contact info:", error);
      return undefined;
    }
  }
  
  async getUserSecuritySettings(userId: number): Promise<UserSecuritySetting | undefined> {
    try {
      const [settings] = await db
        .select()
        .from(userSecuritySettings)
        .where(eq(userSecuritySettings.userId, userId));
      
      return settings;
    } catch (error) {
      console.error("Error getting user security settings:", error);
      return undefined;
    }
  }
  
  async updateUserSecuritySettings(userId: number, settings: Partial<InsertUserSecuritySetting>): Promise<UserSecuritySetting | undefined> {
    try {
      // Check if settings already exist for this user
      const existingSettings = await this.getUserSecuritySettings(userId);
      
      if (existingSettings) {
        // Update existing settings
        const [updatedSettings] = await db
          .update(userSecuritySettings)
          .set({
            ...settings,
            updatedAt: new Date()
          })
          .where(eq(userSecuritySettings.id, existingSettings.id))
          .returning();
          
        return updatedSettings;
      } else {
        // Create new settings
        const [newSettings] = await db
          .insert(userSecuritySettings)
          .values({
            userId,
            ...settings,
            updatedAt: new Date()
          })
          .returning();
          
        return newSettings;
      }
    } catch (error) {
      console.error("Error updating user security settings:", error);
      return undefined;
    }
  }
  
  async checkIpAllowed(userId: number, ipAddress: string): Promise<boolean> {
    return this.memStorage.checkIpAllowed(userId, ipAddress);
  }
  
  async checkTimeAllowed(userId: number, timestamp?: Date): Promise<boolean> {
    return this.memStorage.checkTimeAllowed(userId, timestamp);
  }
  
  async checkGeoAllowed(userId: number, country: string): Promise<boolean> {
    return this.memStorage.checkGeoAllowed(userId, country);
  }
  
  async recordUserPerformance(metric: InsertUserPerformanceMetric): Promise<UserPerformanceMetric> {
    return this.memStorage.recordUserPerformance(metric);
  }
  
  async getUserPerformanceMetrics(userId: number, metricType?: string, startDate?: Date, endDate?: Date): Promise<UserPerformanceMetric[]> {
    return this.memStorage.getUserPerformanceMetrics(userId, metricType, startDate, endDate);
  }
  
  async getTimeRestrictions(userId: number): Promise<TimeRestriction[]> {
    return this.memStorage.getTimeRestrictions(userId);
  }
  
  async addTimeRestriction(restriction: InsertTimeRestriction): Promise<TimeRestriction> {
    return this.memStorage.addTimeRestriction(restriction);
  }
  
  async updateTimeRestriction(id: number, restriction: Partial<InsertTimeRestriction>): Promise<TimeRestriction | undefined> {
    return this.memStorage.updateTimeRestriction(id, restriction);
  }
  
  async deleteTimeRestriction(id: number): Promise<boolean> {
    return this.memStorage.deleteTimeRestriction(id);
  }
  
  async getCategoryByName(name: string): Promise<Category | undefined> {
    return this.memStorage.getCategoryByName(name);
  }
  
  async updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category | undefined> {
    return this.memStorage.updateCategory(id, category);
  }
  
  async deleteCategory(id: number): Promise<boolean> {
    return this.memStorage.deleteCategory(id);
  }
  
  async getAllSuppliers(): Promise<Supplier[]> {
    return this.memStorage.getAllSuppliers();
  }
  
  async getSupplier(id: number): Promise<Supplier | undefined> {
    return this.memStorage.getSupplier(id);
  }
  
  async getSupplierByName(name: string): Promise<Supplier | undefined> {
    return this.memStorage.getSupplierByName(name);
  }
  
  async createSupplier(supplier: InsertSupplier): Promise<Supplier> {
    return this.memStorage.createSupplier(supplier);
  }
  
  async updateSupplier(id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    return this.memStorage.updateSupplier(id, supplier);
  }
  
  async deleteSupplier(id: number): Promise<boolean> {
    return this.memStorage.deleteSupplier(id);
  }
  
  async getAllBarcodes(): Promise<Barcode[]> {
    return this.memStorage.getAllBarcodes();
  }
  
  async getBarcode(id: number): Promise<Barcode | undefined> {
    return this.memStorage.getBarcode(id);
  }
  
  async getBarcodesByItemId(itemId: number): Promise<Barcode[]> {
    return this.memStorage.getBarcodesByItemId(itemId);
  }
  
  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    return this.memStorage.getBarcodeByValue(value);
  }
  
  async createBarcode(barcode: InsertBarcode): Promise<Barcode> {
    return this.memStorage.createBarcode(barcode);
  }
  
  async updateBarcode(id: number, barcode: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    return this.memStorage.updateBarcode(id, barcode);
  }
  
  async deleteBarcode(id: number): Promise<boolean> {
    return this.memStorage.deleteBarcode(id);
  }
  
  async findItemByBarcode(barcodeValue: string): Promise<InventoryItem | undefined> {
    return this.memStorage.findItemByBarcode(barcodeValue);
  }
  
  async getAllWarehouses(): Promise<Warehouse[]> {
    return this.memStorage.getAllWarehouses();
  }
  
  async getWarehouse(id: number): Promise<Warehouse | undefined> {
    return this.memStorage.getWarehouse(id);
  }
  
  async getDefaultWarehouse(): Promise<Warehouse | undefined> {
    return this.memStorage.getDefaultWarehouse();
  }
  
  async createWarehouse(warehouse: InsertWarehouse): Promise<Warehouse> {
    return this.memStorage.createWarehouse(warehouse);
  }
  
  async updateWarehouse(id: number, warehouse: Partial<InsertWarehouse>): Promise<Warehouse | undefined> {
    return this.memStorage.updateWarehouse(id, warehouse);
  }
  
  async deleteWarehouse(id: number): Promise<boolean> {
    return this.memStorage.deleteWarehouse(id);
  }
  
  async setDefaultWarehouse(id: number): Promise<Warehouse | undefined> {
    return this.memStorage.setDefaultWarehouse(id);
  }
  
  async getWarehouseInventory(warehouseId: number): Promise<WarehouseInventory[]> {
    return this.memStorage.getWarehouseInventory(warehouseId);
  }
  
  async getWarehouseInventoryItem(warehouseId: number, itemId: number): Promise<WarehouseInventory | undefined> {
    return this.memStorage.getWarehouseInventoryItem(warehouseId, itemId);
  }
  
  async getItemWarehouseInventory(itemId: number): Promise<WarehouseInventory[]> {
    return this.memStorage.getItemWarehouseInventory(itemId);
  }
  
  async createWarehouseInventory(warehouseInventory: InsertWarehouseInventory): Promise<WarehouseInventory> {
    return this.memStorage.createWarehouseInventory(warehouseInventory);
  }
  
  async updateWarehouseInventory(id: number, warehouseInventory: Partial<InsertWarehouseInventory>): Promise<WarehouseInventory | undefined> {
    return this.memStorage.updateWarehouseInventory(id, warehouseInventory);
  }
  
  async deleteWarehouseInventory(id: number): Promise<boolean> {
    return this.memStorage.deleteWarehouseInventory(id);
  }
  
  async getAllStockMovements(): Promise<StockMovement[]> {
    return this.memStorage.getAllStockMovements();
  }
  
  async getStockMovement(id: number): Promise<StockMovement | undefined> {
    return this.memStorage.getStockMovement(id);
  }
  
  async getStockMovementsByItemId(itemId: number): Promise<StockMovement[]> {
    return this.memStorage.getStockMovementsByItemId(itemId);
  }
  
  async getStockMovementsByWarehouseId(warehouseId: number): Promise<StockMovement[]> {
    return this.memStorage.getStockMovementsByWarehouseId(warehouseId);
  }
  
  async createStockMovement(movement: InsertStockMovement): Promise<StockMovement> {
    return this.memStorage.createStockMovement(movement);
  }
  
  async transferStock(sourceWarehouseId: number, destinationWarehouseId: number, itemId: number, quantity: number, userId?: number, reason?: string): Promise<StockMovement> {
    return this.memStorage.transferStock(sourceWarehouseId, destinationWarehouseId, itemId, quantity, userId, reason);
  }
  
  async getAllReorderRequests(): Promise<ReorderRequest[]> {
    return this.memStorage.getAllReorderRequests();
  }
  
  async getReorderRequestsByDateRange(startDate: Date, endDate: Date): Promise<ReorderRequest[]> {
    return this.memStorage.getReorderRequestsByDateRange(startDate, endDate);
  }
  
  async getReorderRequest(id: number): Promise<ReorderRequest | undefined> {
    return this.memStorage.getReorderRequest(id);
  }
  
  async getReorderRequestByNumber(requestNumber: string): Promise<ReorderRequest | undefined> {
    return this.memStorage.getReorderRequestByNumber(requestNumber);
  }
  
  async createReorderRequest(request: InsertReorderRequest): Promise<ReorderRequest> {
    return this.memStorage.createReorderRequest(request);
  }
  
  async updateReorderRequest(id: number, request: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined> {
    return this.memStorage.updateReorderRequest(id, request);
  }
  
  async deleteReorderRequest(id: number): Promise<boolean> {
    return this.memStorage.deleteReorderRequest(id);
  }
  
  async approveReorderRequest(id: number, approverId: number): Promise<ReorderRequest | undefined> {
    return this.memStorage.approveReorderRequest(id, approverId);
  }
  
  async rejectReorderRequest(id: number, approverId: number, reason: string): Promise<ReorderRequest | undefined> {
    return this.memStorage.rejectReorderRequest(id, approverId, reason);
  }
  
  async convertReorderRequestToRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    return this.memStorage.convertReorderRequestToRequisition(id);
  }
  
  async getReorderRequestWithDetails(id: number): Promise<(ReorderRequest & { item: InventoryItem; requestor?: User; approver?: User; }) | undefined> {
    return this.memStorage.getReorderRequestWithDetails(id);
  }
  
  async getAppSettings(): Promise<AppSettings | undefined> {
    return this.memStorage.getAppSettings();
  }
  
  async updateAppSettings(settings: Partial<InsertAppSettings>): Promise<AppSettings> {
    return this.memStorage.updateAppSettings(settings);
  }
  
  async getSupplierLogo(supplierId: number): Promise<SupplierLogo | undefined> {
    return this.memStorage.getSupplierLogo(supplierId);
  }
  
  async createSupplierLogo(logo: InsertSupplierLogo): Promise<SupplierLogo> {
    return this.memStorage.createSupplierLogo(logo);
  }
  
  async updateSupplierLogo(supplierId: number, logoUrl: string): Promise<SupplierLogo | undefined> {
    return this.memStorage.updateSupplierLogo(supplierId, logoUrl);
  }
  
  async deleteSupplierLogo(supplierId: number): Promise<boolean> {
    return this.memStorage.deleteSupplierLogo(supplierId);
  }
  
  async deleteInventoryItem(id: number): Promise<boolean> {
    return this.memStorage.deleteInventoryItem(id);
  }
  
  async searchInventoryItems(query: string, categoryId?: number): Promise<InventoryItem[]> {
    return this.memStorage.searchInventoryItems(query, categoryId);
  }
  
  async getLowStockItems(): Promise<InventoryItem[]> {
    return this.memStorage.getLowStockItems();
  }
  
  async getOutOfStockItems(): Promise<InventoryItem[]> {
    return this.memStorage.getOutOfStockItems();
  }
  
  async getInventoryStats(): Promise<InventoryStats> {
    return this.memStorage.getInventoryStats();
  }
  
  async bulkImportInventory(items: BulkImportInventory): Promise<{ created: InventoryItem[]; updated: InventoryItem[]; errors: { row: number; sku: string; message: string; }[]; }> {
    return this.memStorage.bulkImportInventory(items);
  }
  
  async getAllPurchaseRequisitions(): Promise<PurchaseRequisition[]> {
    return this.memStorage.getAllPurchaseRequisitions();
  }
  
  async getPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    return this.memStorage.getPurchaseRequisition(id);
  }
  
  async getPurchaseRequisitionByNumber(requisitionNumber: string): Promise<PurchaseRequisition | undefined> {
    return this.memStorage.getPurchaseRequisitionByNumber(requisitionNumber);
  }
  
  async createPurchaseRequisition(requisition: InsertPurchaseRequisition, items: Omit<InsertPurchaseRequisitionItem, "requisitionId">[]): Promise<PurchaseRequisition> {
    return this.memStorage.createPurchaseRequisition(requisition, items);
  }
  
  async updatePurchaseRequisition(id: number, requisition: Partial<InsertPurchaseRequisition>): Promise<PurchaseRequisition | undefined> {
    return this.memStorage.updatePurchaseRequisition(id, requisition);
  }
  
  async deletePurchaseRequisition(id: number): Promise<boolean> {
    return this.memStorage.deletePurchaseRequisition(id);
  }
  
  async getPurchaseRequisitionItems(requisitionId: number): Promise<PurchaseRequisitionItem[]> {
    return this.memStorage.getPurchaseRequisitionItems(requisitionId);
  }
  
  async addPurchaseRequisitionItem(item: InsertPurchaseRequisitionItem): Promise<PurchaseRequisitionItem> {
    return this.memStorage.addPurchaseRequisitionItem(item);
  }
  
  async updatePurchaseRequisitionItem(id: number, item: Partial<InsertPurchaseRequisitionItem>): Promise<PurchaseRequisitionItem | undefined> {
    return this.memStorage.updatePurchaseRequisitionItem(id, item);
  }
  
  async deletePurchaseRequisitionItem(id: number): Promise<boolean> {
    return this.memStorage.deletePurchaseRequisitionItem(id);
  }
  
  async approvePurchaseRequisition(id: number, approverId: number): Promise<PurchaseRequisition | undefined> {
    return this.memStorage.approvePurchaseRequisition(id, approverId);
  }
  
  async rejectPurchaseRequisition(id: number, approverId: number, reason: string): Promise<PurchaseRequisition | undefined> {
    return this.memStorage.rejectPurchaseRequisition(id, approverId, reason);
  }
  
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return this.memStorage.getAllPurchaseOrders();
  }
  
  async getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined> {
    return this.memStorage.getPurchaseOrder(id);
  }
  
  async getPurchaseOrderByNumber(orderNumber: string): Promise<PurchaseOrder | undefined> {
    return this.memStorage.getPurchaseOrderByNumber(orderNumber);
  }
  
  async createPurchaseOrder(order: InsertPurchaseOrder, items: Omit<InsertPurchaseOrderItem, "orderId">[]): Promise<PurchaseOrder> {
    return this.memStorage.createPurchaseOrder(order, items);
  }
  
  async updatePurchaseOrder(id: number, order: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    return this.memStorage.updatePurchaseOrder(id, order);
  }
  
  async deletePurchaseOrder(id: number): Promise<boolean> {
    return this.memStorage.deletePurchaseOrder(id);
  }
  
  async getPurchaseOrderItems(orderId: number): Promise<PurchaseOrderItem[]> {
    return this.memStorage.getPurchaseOrderItems(orderId);
  }
  
  async addPurchaseOrderItem(item: InsertPurchaseOrderItem): Promise<PurchaseOrderItem> {
    return this.memStorage.addPurchaseOrderItem(item);
  }
  
  async updatePurchaseOrderItem(id: number, item: Partial<InsertPurchaseOrderItem>): Promise<PurchaseOrderItem | undefined> {
    return this.memStorage.updatePurchaseOrderItem(id, item);
  }
  
  async deletePurchaseOrderItem(id: number): Promise<boolean> {
    return this.memStorage.deletePurchaseOrderItem(id);
  }
  
  async updatePurchaseOrderStatus(id: number, status: PurchaseOrderStatus): Promise<PurchaseOrder | undefined> {
    return this.memStorage.updatePurchaseOrderStatus(id, status);
  }
  
  async updatePurchaseOrderPaymentStatus(id: number, paymentStatus: PaymentStatus, reference?: string): Promise<PurchaseOrder | undefined> {
    return this.memStorage.updatePurchaseOrderPaymentStatus(id, paymentStatus, reference);
  }
  
  async recordPurchaseOrderItemReceived(itemId: number, receivedQuantity: number): Promise<PurchaseOrderItem | undefined> {
    return this.memStorage.recordPurchaseOrderItemReceived(itemId, receivedQuantity);
  }
  
  async createPurchaseOrderFromRequisition(requisitionId: number): Promise<PurchaseOrder | undefined> {
    return this.memStorage.createPurchaseOrderFromRequisition(requisitionId);
  }
  
  async sendPurchaseOrderEmail(id: number, recipientEmail: string): Promise<boolean> {
    return this.memStorage.sendPurchaseOrderEmail(id, recipientEmail);
  }
  
  async createReorderRequest(insertRequest: InsertReorderRequest): Promise<ReorderRequest> {
    return this.memStorage.createReorderRequest(insertRequest);
  }
  
  async updateReorderRequest(id: number, updateData: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined> {
    return this.memStorage.updateReorderRequest(id, updateData);
  }
  
  async getAllVatRates(): Promise<VatRate[]> {
    return this.memStorage.getAllVatRates();
  }
  
  async getVatRate(id: number): Promise<VatRate | undefined> {
    return this.memStorage.getVatRate(id);
  }
  
  async getVatRateByCountryCode(countryCode: string): Promise<VatRate | undefined> {
    return this.memStorage.getVatRateByCountryCode(countryCode);
  }
  
  async createVatRate(vatRate: InsertVatRate): Promise<VatRate> {
    return this.memStorage.createVatRate(vatRate);
  }
  
  async updateVatRate(id: number, vatRate: Partial<InsertVatRate>): Promise<VatRate | undefined> {
    return this.memStorage.updateVatRate(id, vatRate);
  }
  
  async deleteVatRate(id: number): Promise<boolean> {
    return this.memStorage.deleteVatRate(id);
  }
  
  async calculateVat(amount: number, countryCode: string, useReducedRate?: boolean): Promise<{ originalAmount: number; vatAmount: number; totalAmount: number; vatRate: number; countryCode: string; }> {
    return this.memStorage.calculateVat(amount, countryCode, useReducedRate);
  }
  
  async getItemWithSupplierAndCategory(id: number): Promise<(InventoryItem & { supplier?: Supplier; category?: Category; }) | undefined> {
    return this.memStorage.getItemWithSupplierAndCategory(id);
  }
  
  async getRequisitionWithDetails(id: number): Promise<(PurchaseRequisition & { items: (PurchaseRequisitionItem & { item: InventoryItem; })[]; requestor?: User; approver?: User; supplier?: Supplier; }) | undefined> {
    return this.memStorage.getRequisitionWithDetails(id);
  }
  
  async getPurchaseOrderWithDetails(id: number): Promise<(PurchaseOrder & { items: (PurchaseOrderItem & { item: InventoryItem; })[]; supplier: Supplier; requisition?: PurchaseRequisition; }) | undefined> {
    return this.memStorage.getPurchaseOrderWithDetails(id);
  }
  
  async getAllCustomRolePermissions(roleId: number): Promise<CustomRolePermission[]> {
    return this.memStorage.getAllCustomRolePermissions(roleId);
  }
  
  async getCustomRolePermission(id: number): Promise<CustomRolePermission | undefined> {
    return this.memStorage.getCustomRolePermission(id);
  }
  
  async createCustomRolePermission(permission: InsertCustomRolePermission): Promise<CustomRolePermission> {
    return this.memStorage.createCustomRolePermission(permission);
  }
  
  async updateCustomRolePermission(id: number, permission: Partial<InsertCustomRolePermission>): Promise<CustomRolePermission | undefined> {
    return this.memStorage.updateCustomRolePermission(id, permission);
  }
  
  async deleteCustomRolePermission(id: number): Promise<boolean> {
    return this.memStorage.deleteCustomRolePermission(id);
  }
  
  async getAllUserAccessLogs(userId?: number): Promise<UserAccessLog[]> {
    try {
      let query = db
        .select()
        .from(userAccessLogs)
        .orderBy(desc(userAccessLogs.timestamp));
      
      if (userId) {
        query = query.where(eq(userAccessLogs.userId, userId));
      }
      
      const logs = await query;
      return logs;
    } catch (error) {
      console.error("Error getting all user access logs:", error);
      // If database operation fails, fall back to memory storage
      return this.memStorage.getAllUserAccessLogs(userId);
    }
  }
  
  async getUserAccessLog(id: number): Promise<UserAccessLog | undefined> {
    return this.memStorage.getUserAccessLog(id);
  }
  
  async createUserAccessLog(log: InsertUserAccessLog): Promise<UserAccessLog> {
    return this.memStorage.createUserAccessLog(log);
  }
  
  async getAllUserContacts(userId: number): Promise<UserContact[]> {
    return this.memStorage.getAllUserContacts(userId);
  }
  
  async getUserContact(id: number): Promise<UserContact | undefined> {
    return this.memStorage.getUserContact(id);
  }
  
  async createUserContact(contact: InsertUserContact): Promise<UserContact> {
    return this.memStorage.createUserContact(contact);
  }
  
  async updateUserContact(id: number, contact: Partial<InsertUserContact>): Promise<UserContact | undefined> {
    return this.memStorage.updateUserContact(id, contact);
  }
  
  async deleteUserContact(id: number): Promise<boolean> {
    return this.memStorage.deleteUserContact(id);
  }
  
  async createUserSecuritySettings(settings: InsertUserSecuritySetting): Promise<UserSecuritySetting> {
    return this.memStorage.createUserSecuritySettings(settings);
  }
  
  async getAllUserPerformanceMetrics(userId: number): Promise<UserPerformanceMetric[]> {
    return this.memStorage.getAllUserPerformanceMetrics(userId);
  }
  
  async getUserPerformanceMetric(id: number): Promise<UserPerformanceMetric | undefined> {
    return this.memStorage.getUserPerformanceMetric(id);
  }
  
  async createUserPerformanceMetric(metric: InsertUserPerformanceMetric): Promise<UserPerformanceMetric> {
    return this.memStorage.createUserPerformanceMetric(metric);
  }
  
  async updateUserPerformanceMetric(id: number, metric: Partial<InsertUserPerformanceMetric>): Promise<UserPerformanceMetric | undefined> {
    return this.memStorage.updateUserPerformanceMetric(id, metric);
  }
  
  async getAllTimeRestrictions(userId?: number): Promise<TimeRestriction[]> {
    return this.memStorage.getAllTimeRestrictions(userId);
  }
  
  async getTimeRestriction(id: number): Promise<TimeRestriction | undefined> {
    return this.memStorage.getTimeRestriction(id);
  }
  
  async createTimeRestriction(restriction: InsertTimeRestriction): Promise<TimeRestriction> {
    return this.memStorage.createTimeRestriction(restriction);
  }
  
  async getAllInvoices(): Promise<Invoice[]> {
    return this.memStorage.getAllInvoices();
  }
  
  async getInvoice(id: number): Promise<Invoice | undefined> {
    return this.memStorage.getInvoice(id);
  }
  
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    return this.memStorage.getInvoiceByNumber(invoiceNumber);
  }
  
  async createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[]): Promise<Invoice> {
    return this.memStorage.createInvoice(invoice, items);
  }
  
  async updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    return this.memStorage.updateInvoice(id, invoice);
  }
  
  async deleteInvoice(id: number): Promise<boolean> {
    return this.memStorage.deleteInvoice(id);
  }
  
  async getInvoicesByCustomerId(customerId: number): Promise<Invoice[]> {
    return this.memStorage.getInvoicesByCustomerId(customerId);
  }
  
  async getInvoicesByDateRange(startDate: Date, endDate: Date): Promise<Invoice[]> {
    return this.memStorage.getInvoicesByDateRange(startDate, endDate);
  }
  
  async getInvoicesByStatus(status: string): Promise<Invoice[]> {
    return this.memStorage.getInvoicesByStatus(status);
  }
  
  async getOverdueInvoices(): Promise<Invoice[]> {
    return this.memStorage.getOverdueInvoices();
  }
  
  async getInvoiceDueInDays(days: number): Promise<Invoice[]> {
    return this.memStorage.getInvoiceDueInDays(days);
  }
  
  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return this.memStorage.getInvoiceItems(invoiceId);
  }
  
  async getInvoiceItem(id: number): Promise<InvoiceItem | undefined> {
    return this.memStorage.getInvoiceItem(id);
  }
  
  async addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    return this.memStorage.addInvoiceItem(item);
  }
  
  async updateInvoiceItem(id: number, item: Partial<InsertInvoiceItem>): Promise<InvoiceItem | undefined> {
    return this.memStorage.updateInvoiceItem(id, item);
  }
  
  async deleteInvoiceItem(id: number): Promise<boolean> {
    return this.memStorage.deleteInvoiceItem(id);
  }
  
  async getAllPayments(): Promise<Payment[]> {
    return this.memStorage.getAllPayments();
  }
  
  async getPayment(id: number): Promise<Payment | undefined> {
    return this.memStorage.getPayment(id);
  }
  
  async getPaymentsByInvoiceId(invoiceId: number): Promise<Payment[]> {
    return this.memStorage.getPaymentsByInvoiceId(invoiceId);
  }
  
  async createPayment(payment: InsertPayment): Promise<Payment> {
    return this.memStorage.createPayment(payment);
  }
  
  async updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment | undefined> {
    return this.memStorage.updatePayment(id, payment);
  }
  
  async deletePayment(id: number): Promise<boolean> {
    return this.memStorage.deletePayment(id);
  }
  
  async recordInvoicePayment(invoiceId: number, amount: number, method: string, receivedBy: number, reference?: string, notes?: string): Promise<Payment> {
    return this.memStorage.recordInvoicePayment(invoiceId, amount, method, receivedBy, reference, notes);
  }
  
  async getBillingSettings(): Promise<BillingSetting | undefined> {
    return this.memStorage.getBillingSettings();
  }
  
  async updateBillingSettings(settings: Partial<InsertBillingSetting>): Promise<BillingSetting> {
    return this.memStorage.updateBillingSettings(settings);
  }
  
  async getAllTaxRates(): Promise<TaxRate[]> {
    return this.memStorage.getAllTaxRates();
  }
  
  async getTaxRate(id: number): Promise<TaxRate | undefined> {
    return this.memStorage.getTaxRate(id);
  }
  
  async getDefaultTaxRate(): Promise<TaxRate | undefined> {
    return this.memStorage.getDefaultTaxRate();
  }
  
  async createTaxRate(taxRate: InsertTaxRate): Promise<TaxRate> {
    return this.memStorage.createTaxRate(taxRate);
  }
  
  async updateTaxRate(id: number, taxRate: Partial<InsertTaxRate>): Promise<TaxRate | undefined> {
    return this.memStorage.updateTaxRate(id, taxRate);
  }
  
  async deleteTaxRate(id: number): Promise<boolean> {
    return this.memStorage.deleteTaxRate(id);
  }
  
  async setDefaultTaxRate(id: number): Promise<TaxRate | undefined> {
    return this.memStorage.setDefaultTaxRate(id);
  }
  
  async getAllDiscounts(): Promise<Discount[]> {
    return this.memStorage.getAllDiscounts();
  }
  
  async getDiscount(id: number): Promise<Discount | undefined> {
    return this.memStorage.getDiscount(id);
  }
  
  async getActiveDiscounts(): Promise<Discount[]> {
    return this.memStorage.getActiveDiscounts();
  }
  
  async createDiscount(discount: InsertDiscount): Promise<Discount> {
    return this.memStorage.createDiscount(discount);
  }
  
  async updateDiscount(id: number, discount: Partial<InsertDiscount>): Promise<Discount | undefined> {
    return this.memStorage.updateDiscount(id, discount);
  }
  
  async deleteDiscount(id: number): Promise<boolean> {
    return this.memStorage.deleteDiscount(id);
  }
  
  async getAllBillingReminderLogs(): Promise<BillingReminderLog[]> {
    return this.memStorage.getAllBillingReminderLogs();
  }
  
  async getBillingReminderLog(id: number): Promise<BillingReminderLog | undefined> {
    return this.memStorage.getBillingReminderLog(id);
  }
  
  async getBillingReminderLogsByInvoiceId(invoiceId: number): Promise<BillingReminderLog[]> {
    return this.memStorage.getBillingReminderLogsByInvoiceId(invoiceId);
  }
  
  async createBillingReminderLog(log: InsertBillingReminderLog): Promise<BillingReminderLog> {
    return this.memStorage.createBillingReminderLog(log);
  }
  
  async deleteBillingReminderLog(id: number): Promise<boolean> {
    return this.memStorage.deleteBillingReminderLog(id);
  }
  

}

// Export the storage instance (using PostgreSQL)
export const storage = new DatabaseStorage();
