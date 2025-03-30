import {
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
  stockMovementTypeEnum, UserRoleEnum, PermissionTypeEnum, ResourceEnum,
  Resource, PermissionType, UserRole,
  type UserLogin, type PasswordResetRequest,
} from "@shared/schema";
import session from "express-session";
import memorystore from "memorystore";

const MemoryStore = memorystore(session);
import crypto from "crypto";

export interface IStorage {
  // Session store for Express sessions
  sessionStore: session.Store;

  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  getUserPreferences(userId: number): Promise<UserPreference | undefined>;
  updateUserPreferences(userId: number, preferences: Partial<InsertUserPreference>): Promise<UserPreference | undefined>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;
  
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
  
  // Password reset methods
  createPasswordResetToken(email: string): Promise<UserVerificationToken | null>;
  resetPassword(token: string, newPassword: string): Promise<boolean>;
  changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean>;
  
  // Two-factor authentication methods
  generateTwoFactorSecret(userId: number): Promise<string>;
  enableTwoFactorAuth(userId: number, verified: boolean): Promise<User | undefined>;
  disableTwoFactorAuth(userId: number): Promise<User | undefined>;
  verifyTwoFactorToken(userId: number, token: string): Promise<boolean>;
  
  // Session management
  createSession(userId: number, ipAddress?: string, userAgent?: string, expiresInDays?: number): Promise<Session>;
  getSession(token: string): Promise<Session | undefined>;
  invalidateSession(token: string): Promise<boolean>;
  invalidateAllUserSessions(userId: number): Promise<boolean>;
  cleanExpiredSessions(): Promise<void>;
  
  // Permission methods
  getAllPermissions(): Promise<Permission[]>;
  getPermission(id: number): Promise<Permission | undefined>;
  getPermissionsByRole(role: UserRole): Promise<Permission[]>;
  getPermissionsByResource(resource: Resource): Promise<Permission[]>;
  checkPermission(role: UserRole, resource: Resource, permissionType: PermissionType): Promise<boolean>;
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
  addPermissionToCustomRole(roleId: number, resource: Resource, permissionType: PermissionType): Promise<CustomRolePermission>;
  removePermissionFromCustomRole(roleId: number, resource: Resource, permissionType: PermissionType): Promise<boolean>;
  checkCustomRolePermission(roleId: number, resource: Resource, permissionType: PermissionType): Promise<boolean>;
  
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
  transferStock(sourceWarehouseId: number, destinationWarehouseId: number, itemId: number, quantity: number, userId?: number): Promise<StockMovement>;
  
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
      { resource: Resource.INVENTORY, permissionType: PermissionType.CREATE },
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      { resource: Resource.INVENTORY, permissionType: PermissionType.UPDATE },
      { resource: Resource.INVENTORY, permissionType: PermissionType.DELETE },
      { resource: Resource.INVENTORY, permissionType: PermissionType.EXPORT },
      { resource: Resource.INVENTORY, permissionType: PermissionType.IMPORT },
      
      // Purchases resource permissions
      { resource: Resource.PURCHASES, permissionType: PermissionType.CREATE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.READ },
      { resource: Resource.PURCHASES, permissionType: PermissionType.UPDATE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.DELETE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.APPROVE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.EXPORT },
      
      // Suppliers resource permissions
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.CREATE },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.READ },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.UPDATE },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.DELETE },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.EXPORT },
      
      // Categories resource permissions
      { resource: Resource.CATEGORIES, permissionType: PermissionType.CREATE },
      { resource: Resource.CATEGORIES, permissionType: PermissionType.READ },
      { resource: Resource.CATEGORIES, permissionType: PermissionType.UPDATE },
      { resource: Resource.CATEGORIES, permissionType: PermissionType.DELETE },
      
      // Warehouses resource permissions
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.CREATE },
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.READ },
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.UPDATE },
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.DELETE },
      
      // Reports resource permissions
      { resource: Resource.REPORTS, permissionType: PermissionType.READ },
      { resource: Resource.REPORTS, permissionType: PermissionType.EXPORT },
      
      // Users resource permissions
      { resource: Resource.USERS, permissionType: PermissionType.CREATE },
      { resource: Resource.USERS, permissionType: PermissionType.READ },
      { resource: Resource.USERS, permissionType: PermissionType.UPDATE },
      { resource: Resource.USERS, permissionType: PermissionType.DELETE },
      { resource: Resource.USERS, permissionType: PermissionType.ASSIGN },
      
      // Settings resource permissions
      { resource: Resource.SETTINGS, permissionType: PermissionType.READ },
      { resource: Resource.SETTINGS, permissionType: PermissionType.UPDATE },
      
      // Reorder Requests resource permissions
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.CREATE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.UPDATE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.DELETE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.APPROVE },
      
      // Stock Movements resource permissions
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.CREATE },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.READ },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.UPDATE },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.EXPORT }
    ];
    
    // Manager role permissions (extensive but not full access)
    const managerPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: Resource.INVENTORY, permissionType: PermissionType.CREATE },
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      { resource: Resource.INVENTORY, permissionType: PermissionType.UPDATE },
      { resource: Resource.INVENTORY, permissionType: PermissionType.EXPORT },
      { resource: Resource.INVENTORY, permissionType: PermissionType.IMPORT },
      
      // Purchases resource permissions
      { resource: Resource.PURCHASES, permissionType: PermissionType.CREATE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.READ },
      { resource: Resource.PURCHASES, permissionType: PermissionType.UPDATE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.APPROVE },
      { resource: Resource.PURCHASES, permissionType: PermissionType.EXPORT },
      
      // Suppliers resource permissions
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.CREATE },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.READ },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.UPDATE },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.EXPORT },
      
      // Categories resource permissions
      { resource: Resource.CATEGORIES, permissionType: PermissionType.CREATE },
      { resource: Resource.CATEGORIES, permissionType: PermissionType.READ },
      { resource: Resource.CATEGORIES, permissionType: PermissionType.UPDATE },
      
      // Warehouses resource permissions
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.READ },
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.UPDATE },
      
      // Reports resource permissions
      { resource: Resource.REPORTS, permissionType: PermissionType.READ },
      { resource: Resource.REPORTS, permissionType: PermissionType.EXPORT },
      
      // Users resource permissions
      { resource: Resource.USERS, permissionType: PermissionType.READ },
      
      // Settings resource permissions
      { resource: Resource.SETTINGS, permissionType: PermissionType.READ },
      
      // Reorder Requests resource permissions
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.CREATE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.UPDATE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.APPROVE },
      
      // Stock Movements resource permissions
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.CREATE },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.READ },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.EXPORT }
    ];
    
    // Warehouse Staff role permissions (focused on inventory operations)
    const warehouseStaffPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      { resource: Resource.INVENTORY, permissionType: PermissionType.UPDATE },
      
      // Purchases resource permissions
      { resource: Resource.PURCHASES, permissionType: PermissionType.READ },
      
      // Suppliers resource permissions
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.READ },
      
      // Categories resource permissions
      { resource: Resource.CATEGORIES, permissionType: PermissionType.READ },
      
      // Warehouses resource permissions
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.READ },
      
      // Reorder Requests resource permissions
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.CREATE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ },
      
      // Stock Movements resource permissions
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.CREATE },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.READ }
    ];
    
    // Viewer role permissions (read-only access)
    const viewerPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      
      // Purchases resource permissions
      { resource: Resource.PURCHASES, permissionType: PermissionType.READ },
      
      // Suppliers resource permissions
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.READ },
      
      // Categories resource permissions
      { resource: Resource.CATEGORIES, permissionType: PermissionType.READ },
      
      // Warehouses resource permissions
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.READ },
      
      // Reports resource permissions
      { resource: Resource.REPORTS, permissionType: PermissionType.READ },
      
      // Reorder Requests resource permissions
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ },
      
      // Stock Movements resource permissions
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.READ }
    ];
    
    // ==================== ADDITIONAL ROLES ====================
    
    // Sales Team role permissions (focus on inventory and customers)
    const salesTeamPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      { resource: Resource.INVENTORY, permissionType: PermissionType.EXPORT },
      
      // Categories resource permissions
      { resource: Resource.CATEGORIES, permissionType: PermissionType.READ },
      
      // Warehouses resource permissions
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.READ },
      
      // Reports resource permissions
      { resource: Resource.REPORTS, permissionType: PermissionType.READ },
      { resource: Resource.REPORTS, permissionType: PermissionType.EXPORT },
      
      // Reorder Requests resource permissions
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.CREATE },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ }
    ];
    
    // Auditor role permissions (focused on reporting and history)
    const auditorPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      { resource: Resource.INVENTORY, permissionType: PermissionType.EXPORT },
      
      // Purchases resource permissions
      { resource: Resource.PURCHASES, permissionType: PermissionType.READ },
      { resource: Resource.PURCHASES, permissionType: PermissionType.EXPORT },
      
      // Suppliers resource permissions
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.READ },
      { resource: Resource.SUPPLIERS, permissionType: PermissionType.EXPORT },
      
      // Categories resource permissions
      { resource: Resource.CATEGORIES, permissionType: PermissionType.READ },
      
      // Warehouses resource permissions
      { resource: Resource.WAREHOUSES, permissionType: PermissionType.READ },
      
      // Reports resource permissions
      { resource: Resource.REPORTS, permissionType: PermissionType.READ },
      { resource: Resource.REPORTS, permissionType: PermissionType.EXPORT },
      
      // Reorder Requests resource permissions
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ },
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.EXPORT },
      
      // Stock Movements resource permissions
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.READ },
      { resource: Resource.STOCK_MOVEMENTS, permissionType: PermissionType.EXPORT }
    ];
    
    // Supplier role permissions (limited to their own inventory)
    const supplierPermissions: Array<{resource: Resource, permissionType: PermissionType}> = [
      // Inventory resource permissions (limited)
      { resource: Resource.INVENTORY, permissionType: PermissionType.READ },
      
      // Purchases resource permissions (limited to their own POs)
      { resource: Resource.PURCHASES, permissionType: PermissionType.READ },
      
      // Reorder Requests resource permissions (limited to relevant items)
      { resource: Resource.REORDER_REQUESTS, permissionType: PermissionType.READ }
    ];
    
    // ==================== CREATE PERMISSIONS ====================
    
    // Create admin permissions
    for (const permission of adminPermissions) {
      this.createPermission({
        role: UserRole.ADMIN,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // Create manager permissions
    for (const permission of managerPermissions) {
      this.createPermission({
        role: UserRole.MANAGER,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // Create warehouse staff permissions
    for (const permission of warehouseStaffPermissions) {
      this.createPermission({
        role: UserRole.WAREHOUSE_STAFF,
        resource: permission.resource,
        permissionType: permission.permissionType
      });
    }
    
    // Create viewer permissions
    for (const permission of viewerPermissions) {
      this.createPermission({
        role: UserRole.VIEWER,
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
    if (role === UserRole.ADMIN) return true;
    
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
    userId?: number
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
      notes: `Transfer from ${sourceWarehouse.name} to ${destinationWarehouse.name}`,
      sourceWarehouseId,
      destinationWarehouseId
    });
    
    // Log activity
    await this.createActivityLog({
      action: "STOCK_TRANSFER",
      description: `Transferred ${quantity} units of ${item.name} from ${sourceWarehouse.name} to ${destinationWarehouse.name}`,
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
}

export const storage = new MemStorage();
