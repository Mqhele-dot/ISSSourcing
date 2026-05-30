import type {
  UserRoleEnum, ResourceEnum, PermissionTypeEnum } from "@shared/schema";
import {
  users, type User, type InsertUser,
  categories, type Category, type InsertCategory,
  inventoryItems, type InventoryItem, type InsertInventoryItem,
  suppliers, type Supplier, type InsertSupplier,
  purchaseRequisitions, type PurchaseRequisition, type InsertPurchaseRequisition,
  purchaseRequisitionItems, type PurchaseRequisitionItem, type InsertPurchaseRequisitionItem,
  purchaseOrders, type PurchaseOrder, type InsertPurchaseOrder,
  purchaseOrderItems,
  type PurchaseOrderItem,
  type InsertPurchaseOrderItem,
  type PurchaseOrderItemReceiveMeta,
  activityLogs, type ActivityLog, type InsertActivityLog,
  appSettings, type AppSettings, type InsertAppSettings,
  supplierLogos, type SupplierLogo, type InsertSupplierLogo,
  supplierContracts, type SupplierContract, type InsertSupplierContract,
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
import * as crypto from "node:crypto";
import { db, pool } from "./db";
import { eq, and, or, like, desc, lte, gte, gt, lt, inArray, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { getActiveOrganizationId } from "./organization-context";
import type { IStorage } from "./storage";
import { MemStorage } from "./storage";
import { inventoryLineValue } from "./forecast-service";
import {
  repoCreateInventoryItem,
  repoGetAllInventoryItems,
  repoGetInventoryItem,
  repoGetInventoryItemBySku,
  repoUpdateInventoryItem,
} from "./repositories/inventory-item-repository";

const PostgresSessionStore = connectPgSimple(session);

// DatabaseStorage implementation with PostgreSQL
export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool: pool,
      createTableIfMissing: true 
    });
  }

  private async reconcileInvoicePayments(invoiceId: number): Promise<void> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return;

    const paymentRows = await db
      .select({ amount: payments.amount })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId));

    const totalPaid = paymentRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const invoiceTotal = Number(invoice.total ?? 0);
    const dueAmount = Math.max(invoiceTotal - totalPaid, 0);
    const nextStatus =
      totalPaid <= 0
        ? invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID"
          ? "APPROVED"
          : invoice.status
        : dueAmount <= 0
          ? "PAID"
          : "PARTIALLY_PAID";

    await db
      .update(invoices)
      .set({
        paidAmount: totalPaid,
        dueAmount,
        status: nextStatus,
        paidDate: dueAmount <= 0 ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      );
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
    // Insert the user without creating a verification token
    // since that will be handled separately in the route
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
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

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  // Category methods
  async getAllCategories(): Promise<Category[]> {
    return db
      .select()
      .from(categories)
      .where(eq(categories.organizationId, getActiveOrganizationId()));
  }

  async getCategory(id: number): Promise<Category | undefined> {
    const [category] = await db
      .select()
      .from(categories)
      .where(
        and(eq(categories.id, id), eq(categories.organizationId, getActiveOrganizationId())),
      );
    return category;
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const [newCategory] = await db
      .insert(categories)
      .values({
        ...category,
        organizationId: getActiveOrganizationId(),
      })
      .returning();
    return newCategory;
  }

  // Inventory item methods (persistence: repositories/inventory-item-repository.ts)
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    return repoGetAllInventoryItems();
  }

  async getInventoryItem(id: number): Promise<InventoryItem | undefined> {
    return repoGetInventoryItem(id);
  }

  async getInventoryItemBySku(sku: string): Promise<InventoryItem | undefined> {
    return repoGetInventoryItemBySku(sku);
  }

  async createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem> {
    return repoCreateInventoryItem(item);
  }

  async updateInventoryItem(id: number, item: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined> {
    return repoUpdateInventoryItem(id, item);
  }

  // Settings methods
  async getSettings(): Promise<AppSettings> {
    const orgId = getActiveOrganizationId();
    const [settings] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.organizationId, orgId));
    if (settings) {
      return settings;
    }

    // If no settings exist, create default settings
    const defaultSettings: InsertAppSettings = {
      organizationId: orgId,
      companyName: "My Inventory System",
      primaryColor: "#4f46e5",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "hh:mm A",
      currencySymbol: "$",
      currencyCode: "USD",
      lowStockDefaultThreshold: 10,
      allowNegativeInventory: false,
      enableVat: false,
      defaultVatCountry: "US",
      showPricesWithVat: true,
      businessCountryCode: "US",
      taxMode: "none",
      productOnboardingCompletedAt: null,
      productOnboardingState: null,
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
      .where(
        and(eq(appSettings.id, currentSettings.id), eq(appSettings.organizationId, getActiveOrganizationId())),
      )
      .returning();
    
    return updatedSettings;
  }
  
  // Activity log methods
  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [newLog] = await db
      .insert(activityLogs)
      .values({
        ...log,
        organizationId: log.organizationId ?? getActiveOrganizationId(),
      })
      .returning();
    return newLog;
  }

  async getAllActivityLogs(limit?: number): Promise<ActivityLog[]> {
    const base = db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.organizationId, getActiveOrganizationId()))
      .orderBy(desc(activityLogs.timestamp));
    return limit ? base.limit(limit) : base;
  }

  // Additional methods would be implemented here following the same pattern
  // Each method would use Drizzle ORM to interact with the database
  
  // Tier-B: MemStorage covers ancillary features (VAT/auth/session helpers, supplier logos, bulk-import fallback,
  // legacy email stub). PO/receive/grn persistence uses Drizzle (see recordPurchaseOrderItemReceived, purchase_orders).
  private memStorage = new MemStorage();
  
  // Image Analysis Log methods
  async logImageAnalysis(log: InsertImageAnalysisLog): Promise<ImageAnalysisLog> {
    try {
      // Create an activity log entry
      const activityLogPromise = db.insert(activityLogs).values({
        organizationId: getActiveOrganizationId(),
        action: "Image Analysis",
        description: `Analyzed image for item ${log.itemId || 'Unknown'}`,
        userId: log.userId,
        itemId: log.itemId || null,
        referenceType: "image_analysis",
        timestamp: new Date(),
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
      const item = await this.getInventoryItem(itemId);
      if (!item) return [];
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
      const orgId = getActiveOrganizationId();
      const orgItemIds = db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.organizationId, orgId));
      const logs = await db
        .select()
        .from(imageAnalysisLogs)
        .where(
          and(
            eq(imageAnalysisLogs.userId, userId),
            or(isNull(imageAnalysisLogs.itemId), inArray(imageAnalysisLogs.itemId, orgItemIds)),
          ),
        )
        .orderBy(desc(imageAnalysisLogs.timestamp));
        
      return logs;
    } catch (error) {
      console.error("Error getting user image analysis logs:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.getImageAnalysisByUserId(userId);
    }
  }
  
  async getUserCustomRoleId(userId: number): Promise<number | null> {
    const [user] = await db
      .select({ role: users.role, preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.role !== "custom") return null;
    const prefs = user.preferences && typeof user.preferences === "object"
      ? (user.preferences as { customRoleId?: unknown })
      : null;
    const customRoleId = Number(prefs?.customRoleId);
    if (Number.isFinite(customRoleId) && customRoleId > 0) return customRoleId;
    return this.memStorage.getUserCustomRoleId(userId);
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
  
  async logUserAccess(
    logOrUserId: InsertUserAccessLog | number,
    action?: string,
    details?: any,
    ip?: string,
    userAgent?: string
  ): Promise<UserAccessLog> {
    const log: InsertUserAccessLog =
      typeof logOrUserId === "number"
        ? {
            userId: logOrUserId,
            action: action!,
            details: details ?? {},
            ipAddress: ip ?? "127.0.0.1",
            userAgent: userAgent ?? "Unknown",
          }
        : logOrUserId;
    try {
      const [accessLog] = await db
        .insert(userAccessLogs)
        .values({
          ...log,
          timestamp: new Date(),
        })
        .returning();
      return accessLog;
    } catch (error) {
      console.error("Error logging user access:", error);
      return this.memStorage.logUserAccess(log);
    }
  }
  
  async getUserAccessLogs(userId: number, limit?: number): Promise<UserAccessLog[]> {
    try {
      const logs = await db
        .select()
        .from(userAccessLogs)
        .where(eq(userAccessLogs.userId, userId))
        .orderBy(desc(userAccessLogs.timestamp))
        .limit(limit ?? 50);
      return logs;
    } catch (error) {
      console.error("Error getting user access logs:", error);
      return this.memStorage.getUserAccessLogs(userId);
    }
  }
  
  async getRecentUserAccessLogs(limit: number = 10): Promise<UserAccessLog[]> {
    try {
      const logs = await db
        .select()
        .from(userAccessLogs)
        .where(sql`1=1`)
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
      await db.delete(userAccessLogs).where(
        and(eq(userAccessLogs.userId, userId), eq(userAccessLogs.action, "login_failure")),
      );
      await db
        .update(users)
        .set({ failedLoginAttempts: 0, updatedAt: new Date() })
        .where(eq(users.id, userId));
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
          used: true
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
  
  async resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
    try {
      // Find the user by email
      const user = await this.getUserByEmail(email);
      
      if (!user) {
        // For security reasons, always return success even if email doesn't exist
        return {
          success: true,
          message: "If your email is registered, you will receive a new verification email."
        };
      }
      
      // Check if email is already verified
      if (user.emailVerified) {
        return {
          success: false,
          message: "Your email is already verified."
        };
      }
      
      // Create a new verification token
      const verificationToken = await this.createVerificationToken(user.id, 'email', 24 * 60); // 24 hours expiry
      
      // Import email service
      const { sendVerificationEmail } = await import('./services/email-service');
      
      // Send verification email
      await sendVerificationEmail(user.email, verificationToken.token, user.username);
      
      // Log the action
      await this.logUserAccess(user.id, 'verification_email_resent');
      
      return {
        success: true,
        message: "If your email is registered, you will receive a new verification email."
      };
    } catch (error) {
      console.error("Error resending verification email:", error);
      // Fall back to memory storage if database operation fails
      return this.memStorage.resendVerificationEmail ? 
        this.memStorage.resendVerificationEmail(email) : 
        {
          success: false,
          message: "An error occurred while resending the verification email."
        };
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
          lastActivity: new Date(),
          isValid: true
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
            eq(sessions.isValid, true),
            gt(sessions.expiresAt, new Date())
          )
        );
      
      // If session exists, update lastActivity timestamp
      if (session) {
        await db
          .update(sessions)
          .set({
            lastActivity: new Date()
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
      
      // Mark session as invalid
      await db
        .update(sessions)
        .set({
          isValid: false
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
      // Mark all user's sessions as invalid
      await db
        .update(sessions)
        .set({
          isValid: false
        })
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.isValid, true)
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
            eq(sessions.isValid, true),
            lt(sessions.expiresAt, new Date())
          )
        );
      
      // Mark all expired sessions as invalid
      await db
        .update(sessions)
        .set({
          isValid: false
        })
        .where(
          and(
            eq(sessions.isValid, true),
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
    return db
      .select()
      .from(suppliers)
      .where(eq(suppliers.organizationId, getActiveOrganizationId()));
  }
  
  async getSupplier(id: number): Promise<Supplier | undefined> {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, getActiveOrganizationId())));
    return row;
  }
  
  async getSupplierByName(name: string): Promise<Supplier | undefined> {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.name, name), eq(suppliers.organizationId, getActiveOrganizationId())));
    return row;
  }
  
  async createSupplier(supplier: InsertSupplier): Promise<Supplier> {
    const [created] = await db
      .insert(suppliers)
      .values({ ...supplier, organizationId: supplier.organizationId ?? getActiveOrganizationId() })
      .returning();
    return created;
  }
  
  async updateSupplier(id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const [updated] = await db
      .update(suppliers)
      .set(supplier)
      .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, getActiveOrganizationId())))
      .returning();
    return updated;
  }
  
  async deleteSupplier(id: number): Promise<boolean> {
    const result = await db
      .delete(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, getActiveOrganizationId())));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getAllBarcodes(): Promise<Barcode[]> {
    return db
      .select()
      .from(barcodes)
      .where(eq(barcodes.organizationId, getActiveOrganizationId()));
  }
  
  async getBarcode(id: number): Promise<Barcode | undefined> {
    const [row] = await db
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.id, id), eq(barcodes.organizationId, getActiveOrganizationId())));
    return row;
  }
  
  async getBarcodesByItemId(itemId: number): Promise<Barcode[]> {
    return db
      .select()
      .from(barcodes)
      .where(
        and(
          eq(barcodes.itemId, itemId),
          eq(barcodes.organizationId, getActiveOrganizationId()),
        ),
      );
  }
  
  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    const [row] = await db
      .select()
      .from(barcodes)
      .where(
        and(eq(barcodes.value, value), eq(barcodes.organizationId, getActiveOrganizationId())),
      );
    return row;
  }
  
  async createBarcode(barcode: InsertBarcode): Promise<Barcode> {
    const [created] = await db
      .insert(barcodes)
      .values({
        ...barcode,
        organizationId: barcode.organizationId ?? getActiveOrganizationId(),
      })
      .returning();
    return created;
  }
  
  async updateBarcode(id: number, barcode: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    const [updated] = await db
      .update(barcodes)
      .set(barcode)
      .where(and(eq(barcodes.id, id), eq(barcodes.organizationId, getActiveOrganizationId())))
      .returning();
    return updated;
  }
  
  async deleteBarcode(id: number): Promise<boolean> {
    const result = await db
      .delete(barcodes)
      .where(and(eq(barcodes.id, id), eq(barcodes.organizationId, getActiveOrganizationId())));
    return (result.rowCount ?? 0) > 0;
  }
  
  async findItemByBarcode(barcodeValue: string): Promise<InventoryItem | undefined> {
    const bc = await this.getBarcodeByValue(barcodeValue);
    if (!bc) return undefined;
    return this.getInventoryItem(bc.itemId);
  }
  
  async getAllWarehouses(): Promise<Warehouse[]> {
    return db
      .select()
      .from(warehouses)
      .where(eq(warehouses.organizationId, getActiveOrganizationId()));
  }
  
  async getWarehouse(id: number): Promise<Warehouse | undefined> {
    const [row] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.organizationId, getActiveOrganizationId())));
    return row;
  }
  
  async getDefaultWarehouse(): Promise<Warehouse | undefined> {
    const [row] = await db
      .select()
      .from(warehouses)
      .where(
        and(
          eq(warehouses.isDefault, true),
          eq(warehouses.organizationId, getActiveOrganizationId()),
        ),
      )
      .limit(1);
    return row;
  }
  
  async createWarehouse(warehouse: InsertWarehouse): Promise<Warehouse> {
    const [created] = await db
      .insert(warehouses)
      .values({ ...warehouse, organizationId: warehouse.organizationId ?? getActiveOrganizationId() })
      .returning();
    return created;
  }
  
  async updateWarehouse(id: number, warehouse: Partial<InsertWarehouse>): Promise<Warehouse | undefined> {
    const [updated] = await db
      .update(warehouses)
      .set({ ...warehouse, updatedAt: new Date() })
      .where(and(eq(warehouses.id, id), eq(warehouses.organizationId, getActiveOrganizationId())))
      .returning();
    return updated;
  }
  
  async deleteWarehouse(id: number): Promise<boolean> {
    const result = await db
      .delete(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.organizationId, getActiveOrganizationId())));
    return (result.rowCount ?? 0) > 0;
  }
  
  async setDefaultWarehouse(id: number): Promise<Warehouse | undefined> {
    const orgId = getActiveOrganizationId();
    await db
      .update(warehouses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(warehouses.organizationId, orgId));
    const [updated] = await db
      .update(warehouses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(warehouses.id, id), eq(warehouses.organizationId, orgId)))
      .returning();
    return updated;
  }
  
  async getWarehouseInventory(warehouseId: number): Promise<WarehouseInventory[]> {
    return db
      .select()
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.warehouseId, warehouseId),
          eq(warehouseInventory.organizationId, getActiveOrganizationId()),
        ),
      );
  }

  async getWarehouseInventoryById(id: number): Promise<WarehouseInventory | undefined> {
    const [row] = await db
      .select()
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.id, id),
          eq(warehouseInventory.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }

  async getWarehouseInventoryItem(warehouseId: number, itemId: number): Promise<WarehouseInventory | undefined> {
    const [row] = await db
      .select()
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.warehouseId, warehouseId),
          eq(warehouseInventory.itemId, itemId),
          eq(warehouseInventory.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async getItemWarehouseInventory(itemId: number): Promise<WarehouseInventory[]> {
    return db
      .select()
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.itemId, itemId),
          eq(warehouseInventory.organizationId, getActiveOrganizationId()),
        ),
      );
  }
  
  async createWarehouseInventory(wi: InsertWarehouseInventory): Promise<WarehouseInventory> {
    const [created] = await db
      .insert(warehouseInventory)
      .values({
        ...wi,
        organizationId: wi.organizationId ?? getActiveOrganizationId(),
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }
  
  async updateWarehouseInventory(id: number, wi: Partial<InsertWarehouseInventory>): Promise<WarehouseInventory | undefined> {
    const [updated] = await db
      .update(warehouseInventory)
      .set({ ...wi, updatedAt: new Date() })
      .where(
        and(
          eq(warehouseInventory.id, id),
          eq(warehouseInventory.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async deleteWarehouseInventory(id: number): Promise<boolean> {
    const result = await db
      .delete(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.id, id),
          eq(warehouseInventory.organizationId, getActiveOrganizationId()),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }
  
  async getAllStockMovements(): Promise<StockMovement[]> {
    return db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.organizationId, getActiveOrganizationId()))
      .orderBy(desc(stockMovements.timestamp));
  }
  
  async getStockMovement(id: number): Promise<StockMovement | undefined> {
    const [row] = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.id, id),
          eq(stockMovements.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async getStockMovementsByItemId(itemId: number): Promise<StockMovement[]> {
    return db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.itemId, itemId),
          eq(stockMovements.organizationId, getActiveOrganizationId()),
        ),
      )
      .orderBy(desc(stockMovements.timestamp));
  }
  
  async getStockMovementsByWarehouseId(warehouseId: number): Promise<StockMovement[]> {
    return db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, getActiveOrganizationId()),
          or(
            eq(stockMovements.warehouseId, warehouseId),
            eq(stockMovements.sourceWarehouseId, warehouseId),
            eq(stockMovements.destinationWarehouseId, warehouseId),
          ),
        ),
      )
      .orderBy(desc(stockMovements.timestamp));
  }
  
  async createStockMovement(movement: InsertStockMovement): Promise<StockMovement> {
    const [created] = await db
      .insert(stockMovements)
      .values({
        ...movement,
        organizationId: movement.organizationId ?? getActiveOrganizationId(),
      })
      .returning();
    return created;
  }
  
  async transferStock(sourceWarehouseId: number, destinationWarehouseId: number, itemId: number, quantity: number, userId?: number, reason?: string): Promise<StockMovement> {
    const sourceWarehouse = await this.getWarehouse(sourceWarehouseId);
    if (!sourceWarehouse) throw new Error("Source warehouse not found");
    const destinationWarehouse = await this.getWarehouse(destinationWarehouseId);
    if (!destinationWarehouse) throw new Error("Destination warehouse not found");
    const item = await this.getInventoryItem(itemId);
    if (!item) throw new Error("Inventory item not found");
    const sourceInv = await this.getWarehouseInventoryItem(sourceWarehouseId, itemId);
    if (!sourceInv || (sourceInv.quantity ?? 0) < quantity) throw new Error("Insufficient quantity in source warehouse");
    await this.updateWarehouseInventory(sourceInv.id, { quantity: (sourceInv.quantity ?? 0) - quantity });
    let destInv = await this.getWarehouseInventoryItem(destinationWarehouseId, itemId);
    if (destInv) {
      await this.updateWarehouseInventory(destInv.id, { quantity: (destInv.quantity ?? 0) + quantity });
    } else {
      await this.createWarehouseInventory({ warehouseId: destinationWarehouseId, itemId, quantity });
    }
    const notes = reason
      ? `Transfer from ${sourceWarehouse.name} to ${destinationWarehouse.name}: ${reason}`
      : `Transfer from ${sourceWarehouse.name} to ${destinationWarehouse.name}`;
    const [movement] = await db.insert(stockMovements).values({
      organizationId: getActiveOrganizationId(),
      itemId,
      quantity,
      type: "TRANSFER",
      sourceWarehouseId,
      destinationWarehouseId,
      userId: userId ?? null,
      notes,
      previousQuantity: sourceInv.quantity ?? 0,
      newQuantity: (sourceInv.quantity ?? 0) - quantity,
    }).returning();
    return movement;
  }
  
  async getAllReorderRequests(): Promise<ReorderRequest[]> {
    return db
      .select()
      .from(reorderRequests)
      .where(eq(reorderRequests.organizationId, getActiveOrganizationId()))
      .orderBy(desc(reorderRequests.createdAt));
  }
  
  async getReorderRequestsByDateRange(startDate: Date, endDate: Date): Promise<ReorderRequest[]> {
    return db
      .select()
      .from(reorderRequests)
      .where(
        and(
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
          gte(reorderRequests.createdAt, startDate),
          lte(reorderRequests.createdAt, endDate),
        ),
      )
      .orderBy(desc(reorderRequests.createdAt));
  }
  
  async getReorderRequest(id: number): Promise<ReorderRequest | undefined> {
    const [row] = await db
      .select()
      .from(reorderRequests)
      .where(
        and(
          eq(reorderRequests.id, id),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async getReorderRequestByNumber(requestNumber: string): Promise<ReorderRequest | undefined> {
    const [row] = await db
      .select()
      .from(reorderRequests)
      .where(
        and(
          eq(reorderRequests.requestNumber, requestNumber),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async createReorderRequest(request: InsertReorderRequest): Promise<ReorderRequest> {
    const reqNumber = request.requestNumber ?? `RO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 1000)}`;
    const [created] = await db
      .insert(reorderRequests)
      .values({
        ...request,
        organizationId: request.organizationId ?? getActiveOrganizationId(),
        requestNumber: reqNumber,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }
  
  async updateReorderRequest(id: number, request: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined> {
    const [updated] = await db
      .update(reorderRequests)
      .set({ ...request, updatedAt: new Date() })
      .where(
        and(
          eq(reorderRequests.id, id),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async deleteReorderRequest(id: number): Promise<boolean> {
    const result = await db
      .delete(reorderRequests)
      .where(
        and(
          eq(reorderRequests.id, id),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }
  
  async approveReorderRequest(id: number, approverId: number): Promise<ReorderRequest | undefined> {
    const [updated] = await db
      .update(reorderRequests)
      .set({ status: "APPROVED", approverId, approvalDate: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(reorderRequests.id, id),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async rejectReorderRequest(id: number, approverId: number, reason: string): Promise<ReorderRequest | undefined> {
    const [updated] = await db
      .update(reorderRequests)
      .set({ status: "REJECTED", approverId, rejectionReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(reorderRequests.id, id),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async convertReorderRequestToRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    const request = await this.getReorderRequest(id);
    if (!request) return undefined;
    const item = await this.getInventoryItem(request.itemId);
    if (!item) return undefined;
    const unitPrice = Number(item.cost ?? item.price ?? 0);
    const totalAmount = unitPrice * request.quantity;
    const requisitionNumber = `REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const requisitionData: InsertPurchaseRequisition = {
      requisitionNumber,
      requestorId: request.requestorId ?? undefined,
      status: PurchaseRequisitionStatus.PENDING,
      notes: `Created from reorder request ${request.requestNumber}. ${request.notes ?? ""}`.trim(),
      supplierId: request.supplierId ?? item.supplierId ?? undefined,
      totalAmount,
    };
    const requisitionItemData: Omit<InsertPurchaseRequisitionItem, "requisitionId"> = {
      itemId: request.itemId,
      quantity: request.quantity,
      unitPrice,
      totalPrice: totalAmount,
      notes: `From reorder request ${request.requestNumber}`,
    };
    const requisition = await this.createPurchaseRequisition(requisitionData, [requisitionItemData]);
    await this.updateReorderRequest(id, {
      status: "CONVERTED",
      convertedToRequisition: true,
      requisitionId: requisition.id,
    });
    await this.createActivityLog({
      action: "Reorder Request Converted",
      description: `Converted reorder request ${request.requestNumber} to purchase requisition ${requisition.requisitionNumber}`,
      referenceType: "reorder_request",
      referenceId: id,
      userId: request.requestorId ?? undefined,
    });
    return requisition;
  }
  
  async getReorderRequestWithDetails(id: number): Promise<(ReorderRequest & { item: InventoryItem; requestor?: User; approver?: User; }) | undefined> {
    const [req] = await db
      .select()
      .from(reorderRequests)
      .where(
        and(
          eq(reorderRequests.id, id),
          eq(reorderRequests.organizationId, getActiveOrganizationId()),
        ),
      );
    if (!req) return undefined;
    const item = await this.getInventoryItem(req.itemId);
    if (!item) return { ...req, item: {} as InventoryItem };
    const requestor = req.requestorId ? await this.getUser(req.requestorId) : undefined;
    const approver = req.approverId ? await this.getUser(req.approverId) : undefined;
    return { ...req, item, requestor, approver };
  }
  
  async getAppSettings(): Promise<AppSettings | undefined> {
    return this.getSettings();
  }
  
  async updateAppSettings(settings: Partial<InsertAppSettings>): Promise<AppSettings> {
    return this.updateSettings(settings);
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

  async getContracts(supplierId?: number): Promise<SupplierContract[]> {
    const orgId = getActiveOrganizationId();
    if (supplierId != null) {
      return db
        .select()
        .from(supplierContracts)
        .where(
          and(
            eq(supplierContracts.organizationId, orgId),
            eq(supplierContracts.supplierId, supplierId),
          ),
        )
        .orderBy(desc(supplierContracts.createdAt));
    }
    return db
      .select()
      .from(supplierContracts)
      .where(eq(supplierContracts.organizationId, orgId))
      .orderBy(desc(supplierContracts.createdAt));
  }

  async getContract(id: number): Promise<SupplierContract | undefined> {
    const [row] = await db
      .select()
      .from(supplierContracts)
      .where(
        and(
          eq(supplierContracts.id, id),
          eq(supplierContracts.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }

  async createContract(contract: InsertSupplierContract): Promise<SupplierContract> {
    const payload = {
      ...contract,
      organizationId: contract.organizationId ?? getActiveOrganizationId(),
      startDate: contract.startDate instanceof Date ? contract.startDate : new Date(contract.startDate as string),
      endDate: contract.endDate != null ? (contract.endDate instanceof Date ? contract.endDate : new Date(contract.endDate as string)) : null,
      attachments: contract.attachments ?? [],
      updatedAt: new Date(),
    };
    const [created] = await db.insert(supplierContracts).values(payload).returning();
    return created;
  }

  async updateContract(id: number, contract: Partial<InsertSupplierContract>): Promise<SupplierContract | undefined> {
    const payload: Record<string, unknown> = { ...contract, updatedAt: new Date() };
    if (contract.startDate !== undefined) {
      payload.startDate = contract.startDate instanceof Date ? contract.startDate : new Date(contract.startDate as string);
    }
    if (contract.endDate !== undefined) {
      payload.endDate = contract.endDate != null ? (contract.endDate instanceof Date ? contract.endDate : new Date(contract.endDate as string)) : null;
    }
    const [updated] = await db
      .update(supplierContracts)
      .set(payload as Partial<InsertSupplierContract>)
      .where(
        and(
          eq(supplierContracts.id, id),
          eq(supplierContracts.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }

  async deleteContract(id: number): Promise<boolean> {
    const result = await db
      .delete(supplierContracts)
      .where(
        and(
          eq(supplierContracts.id, id),
          eq(supplierContracts.organizationId, getActiveOrganizationId()),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }
  
  async deleteInventoryItem(id: number): Promise<boolean> {
    const result = await db
      .delete(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, id),
          eq(inventoryItems.organizationId, getActiveOrganizationId()),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }
  
  async searchInventoryItems(query: string, categoryId?: number): Promise<InventoryItem[]> {
    const orgPred = eq(inventoryItems.organizationId, getActiveOrganizationId());
    const q = `%${query.trim()}%`;
    const textMatch = query.trim()
      ? or(like(inventoryItems.name, q), like(inventoryItems.sku, q))
      : undefined;
    const whereClause =
      textMatch && categoryId != null
        ? and(orgPred, textMatch, eq(inventoryItems.categoryId, categoryId))
        : textMatch
          ? and(orgPred, textMatch)
          : categoryId != null
            ? and(orgPred, eq(inventoryItems.categoryId, categoryId))
            : orgPred;
    return db.select().from(inventoryItems).where(whereClause);
  }
  
  async getLowStockItems(): Promise<InventoryItem[]> {
    const items = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.organizationId, getActiveOrganizationId()));
    return items.filter(
      (item) =>
        (item.quantity ?? 0) > 0 &&
        (item.lowStockThreshold != null && (item.quantity ?? 0) <= item.lowStockThreshold)
    );
  }
  
  async getOutOfStockItems(): Promise<InventoryItem[]> {
    return db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.quantity, 0),
          eq(inventoryItems.organizationId, getActiveOrganizationId()),
        ),
      );
  }
  
  async getInventoryStats(): Promise<InventoryStats> {
    const items = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.organizationId, getActiveOrganizationId()));
    const inventoryValue = items.reduce((sum, item) => sum + inventoryLineValue(item), 0);
    const lowStockItems = items.filter(
      (item) =>
        (item.quantity ?? 0) > 0 &&
        item.lowStockThreshold != null &&
        (item.quantity ?? 0) <= item.lowStockThreshold
    ).length;
    const outOfStockItems = items.filter((item) => (item.quantity ?? 0) === 0).length;
    return {
      totalItems: items.length,
      lowStockItems,
      outOfStockItems,
      inventoryValue: Number(inventoryValue.toFixed(2)),
    };
  }
  
  async bulkImportInventory(items: BulkImportInventory): Promise<{ created: InventoryItem[]; updated: InventoryItem[]; errors: { row: number; sku: string; message: string; }[]; }> {
    return this.memStorage.bulkImportInventory(items);
  }
  
  async getAllPurchaseRequisitions(): Promise<PurchaseRequisition[]> {
    return db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.organizationId, getActiveOrganizationId()))
      .orderBy(desc(purchaseRequisitions.createdAt));
  }
  
  async getPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    const [row] = await db
      .select()
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.id, id),
          eq(purchaseRequisitions.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async getPurchaseRequisitionByNumber(requisitionNumber: string): Promise<PurchaseRequisition | undefined> {
    const [row] = await db
      .select()
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.requisitionNumber, requisitionNumber),
          eq(purchaseRequisitions.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async createPurchaseRequisition(requisition: InsertPurchaseRequisition, items: Omit<InsertPurchaseRequisitionItem, "requisitionId">[]): Promise<PurchaseRequisition> {
    const orgId = getActiveOrganizationId();
    const [created] = await db
      .insert(purchaseRequisitions)
      .values({
        ...requisition,
        organizationId: requisition.organizationId ?? orgId,
        updatedAt: new Date(),
      })
      .returning();
    let totalAmount = 0;
    for (const item of items) {
      const totalPrice = (Number(item.unitPrice) || 0) * (item.quantity || 0);
      totalAmount += totalPrice;
      await db.insert(purchaseRequisitionItems).values({ ...item, requisitionId: created.id, totalPrice });
    }
    if (totalAmount > 0) {
      await db
        .update(purchaseRequisitions)
        .set({ totalAmount, updatedAt: new Date() })
        .where(
          and(eq(purchaseRequisitions.id, created.id), eq(purchaseRequisitions.organizationId, orgId)),
        );
      const [refetched] = await db
        .select()
        .from(purchaseRequisitions)
        .where(
          and(eq(purchaseRequisitions.id, created.id), eq(purchaseRequisitions.organizationId, orgId)),
        );
      return refetched ?? created;
    }
    return created;
  }
  
  async updatePurchaseRequisition(id: number, requisition: Partial<InsertPurchaseRequisition>): Promise<PurchaseRequisition | undefined> {
    const [updated] = await db
      .update(purchaseRequisitions)
      .set({ ...requisition, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseRequisitions.id, id),
          eq(purchaseRequisitions.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async deletePurchaseRequisition(id: number): Promise<boolean> {
    const orgId = getActiveOrganizationId();
    const existing = await this.getPurchaseRequisition(id);
    if (!existing) return false;
    await db.delete(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId, id));
    const result = await db
      .delete(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.organizationId, orgId)));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getPurchaseRequisitionItems(requisitionId: number): Promise<PurchaseRequisitionItem[]> {
    const parent = await this.getPurchaseRequisition(requisitionId);
    if (!parent) return [];
    return db
      .select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, requisitionId));
  }
  
  async addPurchaseRequisitionItem(item: InsertPurchaseRequisitionItem): Promise<PurchaseRequisitionItem> {
    const [created] = await db
      .insert(purchaseRequisitionItems)
      .values({
        ...item,
        totalPrice: Number(item.totalPrice ?? Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0)),
      })
      .returning();
    return created;
  }
  
  async updatePurchaseRequisitionItem(id: number, item: Partial<InsertPurchaseRequisitionItem>): Promise<PurchaseRequisitionItem | undefined> {
    const [updated] = await db
      .update(purchaseRequisitionItems)
      .set({
        ...item,
        totalPrice:
          item.totalPrice ??
          (item.quantity != null && item.unitPrice != null
            ? Number(item.quantity) * Number(item.unitPrice)
            : undefined),
      })
      .where(eq(purchaseRequisitionItems.id, id))
      .returning();
    return updated;
  }
  
  async deletePurchaseRequisitionItem(id: number): Promise<boolean> {
    const result = await db.delete(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async approvePurchaseRequisition(id: number, approverId: number): Promise<PurchaseRequisition | undefined> {
    const [updated] = await db
      .update(purchaseRequisitions)
      .set({
        status: PurchaseRequisitionStatus.APPROVED,
        approverId,
        approvalDate: new Date(),
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseRequisitions.id, id),
          eq(purchaseRequisitions.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();

    if (!updated) return undefined;

    await this.createActivityLog({
      action: "Requisition Approved",
      description: `Approved requisition ${updated.requisitionNumber}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: approverId,
    });

    return updated;
  }
  
  async rejectPurchaseRequisition(id: number, approverId: number, reason: string): Promise<PurchaseRequisition | undefined> {
    const [updated] = await db
      .update(purchaseRequisitions)
      .set({
        status: PurchaseRequisitionStatus.REJECTED,
        approverId,
        approvalDate: new Date(),
        rejectionReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseRequisitions.id, id),
          eq(purchaseRequisitions.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();

    if (!updated) return undefined;

    await this.createActivityLog({
      action: "Requisition Rejected",
      description: `Rejected requisition ${updated.requisitionNumber}${reason ? `: ${reason}` : ""}`,
      referenceType: "purchase_requisition",
      referenceId: id,
      userId: approverId,
    });

    return updated;
  }
  
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.organizationId, getActiveOrganizationId()))
      .orderBy(desc(purchaseOrders.createdAt));
  }
  
  async getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined> {
    const [row] = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async getPurchaseOrderByNumber(orderNumber: string): Promise<PurchaseOrder | undefined> {
    const [row] = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.orderNumber, orderNumber),
          eq(purchaseOrders.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async createPurchaseOrder(order: InsertPurchaseOrder, items: Omit<InsertPurchaseOrderItem, "orderId">[]): Promise<PurchaseOrder> {
    const orgId = getActiveOrganizationId();
    const [created] = await db
      .insert(purchaseOrders)
      .values({
        ...order,
        organizationId: order.organizationId ?? orgId,
        updatedAt: new Date(),
      })
      .returning();
    let totalAmount = 0;
    for (const item of items) {
      const totalPrice = (Number(item.unitPrice) || 0) * (item.quantity || 0);
      totalAmount += totalPrice;
      const inv = await repoGetInventoryItem(item.itemId);
      await db.insert(purchaseOrderItems).values({
        ...item,
        orderId: created.id,
        totalPrice,
        unitOfMeasureId: item.unitOfMeasureId ?? inv?.unitOfMeasureId ?? null,
        commodityCodeId: item.commodityCodeId ?? inv?.commodityCodeId ?? null,
        taxCodeId: item.taxCodeId ?? null,
      });
    }
    if (totalAmount > 0) {
      await db
        .update(purchaseOrders)
        .set({ totalAmount, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, created.id), eq(purchaseOrders.organizationId, orgId)));
      const [refetched] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, created.id), eq(purchaseOrders.organizationId, orgId)));
      return refetched ?? created;
    }
    return created;
  }
  
  async updatePurchaseOrder(id: number, order: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({ ...order, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async deletePurchaseOrder(id: number): Promise<boolean> {
    const orgId = getActiveOrganizationId();
    const existing = await this.getPurchaseOrder(id);
    if (!existing) return false;
    await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id));
    const result = await db
      .delete(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, orgId)));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getPurchaseOrderItems(orderId: number): Promise<PurchaseOrderItem[]> {
    const parent = await this.getPurchaseOrder(orderId);
    if (!parent) return [];
    return db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, orderId));
  }
  
  async addPurchaseOrderItem(item: InsertPurchaseOrderItem): Promise<PurchaseOrderItem> {
    const orgId = getActiveOrganizationId();
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, item.orderId), eq(purchaseOrders.organizationId, orgId)))
      .limit(1);
    if (!order) {
      throw new Error(`Purchase order ${item.orderId} not found`);
    }
    const inv = await repoGetInventoryItem(item.itemId);
    if (!inv) {
      throw new Error(`Inventory item with ID ${item.itemId} not found`);
    }

    const [row] = await db
      .insert(purchaseOrderItems)
      .values({
        orderId: item.orderId,
        itemId: item.itemId,
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        receivedQuantity: item.receivedQuantity ?? 0,
        notes: item.notes ?? null,
        unitOfMeasureId: item.unitOfMeasureId ?? inv?.unitOfMeasureId ?? null,
        commodityCodeId: item.commodityCodeId ?? inv?.commodityCodeId ?? null,
        taxCodeId: item.taxCodeId ?? null,
      })
      .returning();

    await db
      .update(purchaseOrders)
      .set({
        totalAmount: Number(order.totalAmount ?? 0) + Number(row.totalPrice),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, order.id));

    return row;
  }
  
  async updatePurchaseOrderItem(
    id: number,
    item: Partial<InsertPurchaseOrderItem>,
  ): Promise<PurchaseOrderItem | undefined> {
    const orgId = getActiveOrganizationId();
    const [row] = await db
      .select({ poi: purchaseOrderItems })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.orderId, purchaseOrders.id))
      .where(and(eq(purchaseOrderItems.id, id), eq(purchaseOrders.organizationId, orgId)));
    if (!row) return undefined;

    const existingItem = row.poi;
    const oldPrice = Number(existingItem.totalPrice);

    const merged = {
      quantity: item.quantity ?? existingItem.quantity,
      unitPrice: item.unitPrice ?? existingItem.unitPrice,
      totalPrice: item.totalPrice ?? existingItem.totalPrice,
      notes: item.notes !== undefined ? item.notes : existingItem.notes,
      itemId: item.itemId ?? existingItem.itemId,
      orderId: item.orderId ?? existingItem.orderId,
      receivedQuantity:
        item.receivedQuantity !== undefined ? item.receivedQuantity : existingItem.receivedQuantity,
      unitOfMeasureId:
        item.unitOfMeasureId !== undefined ? item.unitOfMeasureId : existingItem.unitOfMeasureId,
      commodityCodeId:
        item.commodityCodeId !== undefined ? item.commodityCodeId : existingItem.commodityCodeId,
      taxCodeId: item.taxCodeId !== undefined ? item.taxCodeId : existingItem.taxCodeId,
    };

    const [updatedItem] = await db.update(purchaseOrderItems).set(merged).where(eq(purchaseOrderItems.id, id)).returning();

    if (!updatedItem) return undefined;

    const newPrice = Number(updatedItem.totalPrice);
    if (newPrice !== oldPrice) {
      const order = await this.getPurchaseOrder(existingItem.orderId);
      if (order) {
        await db
          .update(purchaseOrders)
          .set({
            totalAmount: Number(order.totalAmount ?? 0) - oldPrice + newPrice,
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, order.id));
      }
    }

    return updatedItem;
  }
  
  async deletePurchaseOrderItem(id: number): Promise<boolean> {
    const orgId = getActiveOrganizationId();
    const [row] = await db
      .select({ poi: purchaseOrderItems })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.orderId, purchaseOrders.id))
      .where(and(eq(purchaseOrderItems.id, id), eq(purchaseOrders.organizationId, orgId)));
    if (!row) return false;

    const poi = row.poi;
    const order = await this.getPurchaseOrder(poi.orderId);
    if (order) {
      await db
        .update(purchaseOrders)
        .set({
          totalAmount: Math.max(0, Number(order.totalAmount ?? 0) - Number(poi.totalPrice)),
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, order.id));
    }

    const result = await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async updatePurchaseOrderStatus(id: number, status: PurchaseOrderStatus): Promise<PurchaseOrder | undefined> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();

    if (!updated) return undefined;

    await this.createActivityLog({
      action: "Purchase Order Status Updated",
      description: `Updated PO ${updated.orderNumber} to ${status}`,
      referenceType: "purchase_order",
      referenceId: id,
      userId: 1,
    });

    return updated;
  }
  
  async updatePurchaseOrderPaymentStatus(id: number, paymentStatus: PaymentStatus, reference?: string): Promise<PurchaseOrder | undefined> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({
        paymentStatus,
        paymentReference: reference ?? null,
        paymentDate: paymentStatus === PaymentStatus.PAID ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();

    return updated;
  }
  
  async recordPurchaseOrderItemReceived(
    itemId: number,
    receivedQuantity: number,
    meta?: PurchaseOrderItemReceiveMeta,
  ): Promise<PurchaseOrderItem | undefined> {
    const orgId = getActiveOrganizationId();
    if (!Number.isFinite(receivedQuantity) || !Number.isInteger(receivedQuantity) || receivedQuantity < 0) {
      throw new Error(`Invalid received quantity: ${receivedQuantity}`);
    }

    const [row] = await db
      .select({ item: purchaseOrderItems })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.orderId, purchaseOrders.id))
      .where(and(eq(purchaseOrderItems.id, itemId), eq(purchaseOrders.organizationId, orgId)));

    if (!row) return undefined;

    const poItem = row.item;
    const current = poItem.receivedQuantity ?? 0;
    const remaining = Math.max(0, poItem.quantity - current);

    if (receivedQuantity > remaining) {
      throw new Error("RECEIVE_EXCEEDS_REMAINING");
    }

    const newReceived = current + receivedQuantity;

    const [updatedItem] = await db
      .update(purchaseOrderItems)
      .set({ receivedQuantity: newReceived })
      .where(eq(purchaseOrderItems.id, itemId))
      .returning();

    if (!updatedItem) return undefined;

    const inv = await repoGetInventoryItem(poItem.itemId);
    if (inv) {
      await repoUpdateInventoryItem(inv.id, {
        quantity: Number(inv.quantity ?? 0) + receivedQuantity,
      });
    }

    const order = await this.getPurchaseOrder(poItem.orderId);
    if (order) {
      const orderItems = await this.getPurchaseOrderItems(order.id);
      const allItemsReceived = orderItems.every((oi) => (oi.receivedQuantity ?? 0) >= oi.quantity);
      if (allItemsReceived) {
        await this.updatePurchaseOrderStatus(order.id, PurchaseOrderStatus.RECEIVED);
      } else {
        const anyItemsReceived = orderItems.some((oi) => (oi.receivedQuantity ?? 0) > 0);
        if (anyItemsReceived) {
          await this.updatePurchaseOrderStatus(order.id, PurchaseOrderStatus.PARTIALLY_RECEIVED);
        }
      }
    }

    const grnParts: string[] = [];
    if (meta?.receiverName?.trim()) grnParts.push(`receiver: ${meta.receiverName.trim()}`);
    if (meta?.warehouseLocation?.trim()) grnParts.push(`location: ${meta.warehouseLocation.trim()}`);
    if (meta?.receivedAt?.trim()) grnParts.push(`receivedAt: ${meta.receivedAt.trim()}`);
    const grnSuffix = grnParts.length ? ` (${grnParts.join("; ")})` : "";
    const actorUserId =
      meta?.receiverUserId != null && Number.isFinite(Number(meta.receiverUserId))
        ? Number(meta.receiverUserId)
        : 1;

    await this.createActivityLog({
      action: "Item Received",
      description: `Received ${receivedQuantity} unit(s) of item #${poItem.itemId} from PO #${poItem.orderId}${grnSuffix}`,
      itemId: poItem.itemId,
      referenceType: "purchase_order",
      referenceId: poItem.orderId,
      userId: actorUserId,
    });

    return updatedItem;
  }
  
  async createPurchaseOrderFromRequisition(requisitionId: number): Promise<PurchaseOrder | undefined> {
    const orgId = getActiveOrganizationId();
    return db.transaction(async (tx) => {
      const [requisition] = await tx
        .select()
        .from(purchaseRequisitions)
        .where(
          and(
            eq(purchaseRequisitions.id, requisitionId),
            eq(purchaseRequisitions.organizationId, orgId),
          ),
        );
      if (!requisition) return undefined;
      if (requisition.status !== PurchaseRequisitionStatus.APPROVED) {
        throw new Error(`Cannot create purchase order from requisition with status: ${requisition.status}`);
      }
      if (requisition.supplierId == null) {
        throw new Error("Requisition must have a supplier to create a purchase order");
      }

      const requisitionItems = await tx
        .select()
        .from(purchaseRequisitionItems)
        .where(eq(purchaseRequisitionItems.requisitionId, requisitionId));
      if (requisitionItems.length === 0) {
        throw new Error("Requisition has no line items to convert");
      }

      const [supplierRow] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, requisition.supplierId!), eq(suppliers.organizationId, orgId)))
        .limit(1);

      const defaultCurRaw = String(supplierRow?.defaultCurrencyCode ?? "").trim().toUpperCase();
      let currencyCode = "USD";
      if (/^[A-Z]{3}$/.test(defaultCurRaw)) {
        try {
          new Intl.NumberFormat("en-US", { style: "currency", currency: defaultCurRaw }).format(0);
          currencyCode = defaultCurRaw;
        } catch {
          currencyCode = "USD";
        }
      }

      const orderNumber = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
      const expectedDeliveryDate =
        requisition.requiredDate ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: orgId,
          orderNumber,
          supplierId: requisition.supplierId,
          requisitionId: requisition.id,
          departmentId: requisition.departmentId ?? null,
          paymentTermsId: supplierRow?.paymentTermsId ?? null,
          currencyCode,
          projectId: requisition.projectId ?? null,
          status: PurchaseOrderStatus.DRAFT,
          orderDate: new Date(),
          expectedDeliveryDate,
          deliveryAddress: "",
          totalAmount: Number(requisition.totalAmount ?? 0),
          notes: requisition.notes ?? null,
          paymentStatus: PaymentStatus.UNPAID,
          emailSent: false,
          updatedAt: new Date(),
        })
        .returning();

      for (const item of requisitionItems) {
        const inv = await tx
          .select()
          .from(inventoryItems)
          .where(eq(inventoryItems.id, item.itemId))
          .limit(1);
        const invRow = inv[0];
        await tx.insert(purchaseOrderItems).values({
          orderId: order.id,
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          receivedQuantity: 0,
          notes: item.notes ?? null,
          unitOfMeasureId: invRow?.unitOfMeasureId ?? null,
          commodityCodeId: invRow?.commodityCodeId ?? null,
          taxCodeId: null,
        });
      }

      await tx
        .update(purchaseRequisitions)
        .set({
          status: PurchaseRequisitionStatus.CONVERTED,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(purchaseRequisitions.id, requisitionId),
            eq(purchaseRequisitions.organizationId, orgId),
          ),
        );

      await this.createActivityLog({
        action: "Purchase Order Created from Requisition",
        description: `Created PO ${orderNumber} from requisition ${requisition.requisitionNumber}`,
        referenceType: "purchase_order",
        referenceId: order.id,
        userId: requisition.approverId ?? requisition.requestorId ?? 1,
      });

      return order;
    });
  }
  
  async sendPurchaseOrderEmail(id: number, recipientEmail: string): Promise<boolean> {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[database-storage] sendPurchaseOrderEmail delegates to MemStorage; outbound PO email may be a no-op in production.",
      );
    }
    return this.memStorage.sendPurchaseOrderEmail(id, recipientEmail);
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
    const orgId = getActiveOrganizationId();
    const [req] = await db
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.organizationId, orgId)));
    if (!req) return undefined;
    const items = await db.select().from(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId, id));
    const itemIds = [...new Set(items.map((i) => i.itemId))];
    const invItems =
      itemIds.length > 0
        ? await db
            .select()
            .from(inventoryItems)
            .where(
              and(inArray(inventoryItems.id, itemIds), eq(inventoryItems.organizationId, orgId)),
            )
        : [];
    const invMap = new Map(invItems.map((i) => [i.id, i]));
    const now = new Date();
    const placeholderInventory = (itemId: number): InventoryItem => ({
      id: itemId,
      organizationId: orgId,
      name: "Unknown item",
      sku: `ITEM-${itemId}`,
      description: null,
      categoryId: null,
      quantity: 0,
      price: 0,
      cost: null,
      lowStockThreshold: 10,
      location: null,
      supplierId: null,
      barcode: null,
      barcodeType: "CODE128",
      dimensions: null,
      weight: null,
      unitOfMeasure: "each",
      unitOfMeasureId: null,
      supplierPartNumber: null,
      commodityCodeId: null,
      defaultWarehouseId: null,
      minOrderQuantity: 1,
      leadTime: null,
      reorderPoint: null,
      maxStockLevel: null,
      taxable: true,
      status: "unknown",
      expiryDate: null,
      manufacturingDate: null,
      lastCountDate: null,
      images: null,
      tags: null,
      customFields: null,
      createdAt: now,
      updatedAt: now,
    });
    const result = {
      ...req,
      items: items.map((i) => ({
        ...i,
        item: invMap.get(i.itemId) ?? placeholderInventory(i.itemId),
      })),
      requestor: undefined as User | undefined,
      approver: undefined as User | undefined,
      supplier: undefined as Supplier | undefined,
    };
    if (req.requestorId) {
      const [u] = await db.select().from(users).where(eq(users.id, req.requestorId));
      result.requestor = u;
    }
    if (req.approverId) {
      const [u] = await db.select().from(users).where(eq(users.id, req.approverId));
      result.approver = u;
    }
    if (req.supplierId) {
      result.supplier = await this.getSupplier(req.supplierId);
    }
    return result;
  }
  
  async getPurchaseOrderWithDetails(id: number): Promise<(PurchaseOrder & { items: (PurchaseOrderItem & { item: InventoryItem; })[]; supplier: Supplier; requisition?: PurchaseRequisition; }) | undefined> {
    const orgId = getActiveOrganizationId();
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, orgId)));
    if (!order) return undefined;

    const supplier = await this.getSupplier(order.supplierId);
    const now = new Date();
    const supplierResolved: Supplier =
      supplier ??
      ({
        id: order.supplierId,
        organizationId: orgId,
        name: "(Unknown supplier)",
        contactName: null,
        email: null,
        phone: null,
        address: null,
        taxIdentificationNumber: null,
        bankName: null,
        bankAccountNumber: null,
        bankSwift: null,
        paymentTermsId: null,
        defaultCurrencyCode: null,
        defaultCarrierId: null,
        insuranceExpiry: null,
        complianceNotes: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      } as Supplier);

    const items = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id));
    const itemIds = [...new Set(items.map((line) => line.itemId))];
    const invItems =
      itemIds.length > 0
        ? await db
            .select()
            .from(inventoryItems)
            .where(
              and(inArray(inventoryItems.id, itemIds), eq(inventoryItems.organizationId, orgId)),
            )
        : [];
    const invMap = new Map(invItems.map((item) => [item.id, item]));
    const placeholderInventory = (itemId: number): InventoryItem => ({
      id: itemId,
      organizationId: orgId,
      name: "Unknown item",
      sku: `ITEM-${itemId}`,
      description: null,
      categoryId: null,
      quantity: 0,
      price: 0,
      cost: null,
      lowStockThreshold: 10,
      location: null,
      supplierId: null,
      barcode: null,
      barcodeType: "CODE128",
      dimensions: null,
      weight: null,
      unitOfMeasure: "each",
      unitOfMeasureId: null,
      supplierPartNumber: null,
      commodityCodeId: null,
      defaultWarehouseId: null,
      minOrderQuantity: 1,
      leadTime: null,
      reorderPoint: null,
      maxStockLevel: null,
      taxable: true,
      status: "unknown",
      expiryDate: null,
      manufacturingDate: null,
      lastCountDate: null,
      images: null,
      tags: null,
      customFields: null,
      createdAt: now,
      updatedAt: now,
    });
    const enrichedItems = items.map((line) => ({
      ...line,
      item: invMap.get(line.itemId) ?? placeholderInventory(line.itemId),
    }));

    let requisition: PurchaseRequisition | undefined;
    if (order.requisitionId != null) {
      requisition = await this.getPurchaseRequisition(order.requisitionId);
    }

    return {
      ...order,
      items: enrichedItems,
      supplier: supplierResolved,
      requisition,
    };
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
      const logs = await db
        .select()
        .from(userAccessLogs)
        .where(userId != null ? eq(userAccessLogs.userId, userId) : sql`1=1`)
        .orderBy(desc(userAccessLogs.timestamp))
        .limit(1000);
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
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, getActiveOrganizationId()))
      .orderBy(desc(invoices.createdAt));
  }
  
  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [row] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    const [row] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.invoiceNumber, invoiceNumber),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      );
    return row;
  }
  
  async createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[]): Promise<Invoice> {
    const orgId = getActiveOrganizationId();
    const createdBy = Number(invoice.createdBy);
    if (!Number.isFinite(createdBy) || createdBy <= 0) {
      throw new Error("Invoice createdBy is required.");
    }
    return db.transaction(async (tx) => {
      const total = Number(invoice.total ?? 0);
      const payload = {
        organizationId: invoice.organizationId ?? orgId,
        invoiceNumber: invoice.invoiceNumber ?? `INV-${Date.now().toString().slice(-8)}`,
        customerId: invoice.customerId ?? null,
        supplierId: invoice.supplierId ?? null,
        status: invoice.status ?? "DRAFT",
        issueDate: invoice.issueDate ?? new Date(),
        dueDate: invoice.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotal: Number(invoice.subtotal ?? total),
        tax: Number(invoice.tax ?? 0),
        discount: Number(invoice.discount ?? 0),
        total,
        notes: invoice.notes ?? null,
        termsAndConditions: invoice.termsAndConditions ?? null,
        purchaseOrderId: invoice.purchaseOrderId ?? null,
        paymentTermsId: invoice.paymentTermsId ?? null,
        currencyCode: invoice.currencyCode ?? null,
        paidAmount: Number(invoice.paidAmount ?? 0),
        dueAmount: Number(invoice.dueAmount ?? total),
        createdBy,
        updatedAt: new Date(),
      };

      const [created] = await tx.insert(invoices).values(payload).returning();

      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          await tx.insert(invoiceItems).values({
            invoiceId: created.id,
            itemId: Number(item.itemId),
            description: item.description ?? `Item #${item.itemId}`,
            quantity: Number(item.quantity ?? 1),
            unitPrice: Number(item.unitPrice ?? 0),
            discount: Number(item.discount ?? 0),
            taxRate: Number(item.taxRate ?? 0),
            taxAmount: Number(item.taxAmount ?? 0),
            totalPrice: Number(item.totalPrice ?? (Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1))),
          });
        }
      }

      return created;
    });
  }
  
  async updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [updated] = await db
      .update(invoices)
      .set({ ...invoice, updatedAt: new Date() })
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      )
      .returning();
    return updated;
  }
  
  async deleteInvoice(id: number): Promise<boolean> {
    const inv = await this.getInvoice(id);
    if (!inv) return false;
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await db.delete(payments).where(eq(payments.invoiceId, id));
    const result = await db
      .delete(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }
  
  async getInvoicesByCustomerId(customerId: number): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      )
      .orderBy(desc(invoices.createdAt));
  }
  
  async getInvoicesByDateRange(startDate: Date, endDate: Date): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, getActiveOrganizationId()),
          gte(invoices.issueDate, startDate),
          lte(invoices.issueDate, endDate),
        ),
      )
      .orderBy(desc(invoices.issueDate));
  }
  
  async getInvoicesByStatus(status: string): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.status, status as Invoice["status"]),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      )
      .orderBy(desc(invoices.createdAt));
  }
  
  async getOverdueInvoices(): Promise<Invoice[]> {
    const now = new Date();
    return db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, getActiveOrganizationId()),
          lt(invoices.dueDate, now),
          ne(invoices.status, "PAID"),
        ),
      )
      .orderBy(desc(invoices.dueDate));
  }
  
  async getInvoiceDueInDays(days: number): Promise<Invoice[]> {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    return db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, getActiveOrganizationId()),
          gte(invoices.dueDate, now),
          lte(invoices.dueDate, target),
          ne(invoices.status, "PAID"),
        ),
      )
      .orderBy(invoices.dueDate);
  }
  
  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    const parent = await this.getInvoice(invoiceId);
    if (!parent) return [];
    return db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId))
      .orderBy(invoiceItems.id);
  }
  
  async getInvoiceItem(id: number): Promise<InvoiceItem | undefined> {
    const [row] = await db.select().from(invoiceItems).where(eq(invoiceItems.id, id));
    if (!row) return undefined;
    const parent = await this.getInvoice(row.invoiceId);
    return parent ? row : undefined;
  }
  
  async addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    const parent = await this.getInvoice(Number(item.invoiceId));
    if (!parent) {
      throw new Error("Invoice not found");
    }
    const payload = {
      invoiceId: Number(item.invoiceId),
      itemId: Number(item.itemId),
      description: item.description ?? `Item #${item.itemId}`,
      quantity: Number(item.quantity ?? 1),
      unitPrice: Number(item.unitPrice ?? 0),
      discount: Number(item.discount ?? 0),
      taxRate: Number(item.taxRate ?? 0),
      taxAmount: Number(item.taxAmount ?? 0),
      totalPrice:
        Number(item.totalPrice ?? (Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1))),
    };
    const [created] = await db.insert(invoiceItems).values(payload).returning();
    return created;
  }
  
  async updateInvoiceItem(id: number, item: Partial<InsertInvoiceItem>): Promise<InvoiceItem | undefined> {
    const existing = await this.getInvoiceItem(id);
    if (!existing) return undefined;
    const [updated] = await db
      .update(invoiceItems)
      .set(item)
      .where(eq(invoiceItems.id, id))
      .returning();
    return updated;
  }
  
  async deleteInvoiceItem(id: number): Promise<boolean> {
    const existing = await this.getInvoiceItem(id);
    if (!existing) return false;
    const result = await db.delete(invoiceItems).where(eq(invoiceItems.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getAllPayments(): Promise<Payment[]> {
    const rows = await db
      .select({ payment: payments })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(eq(invoices.organizationId, getActiveOrganizationId()))
      .orderBy(desc(payments.paymentDate));
    return rows.map((row) => row.payment);
  }
  
  async getPayment(id: number): Promise<Payment | undefined> {
    const [row] = await db
      .select({ payment: payments })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(payments.id, id),
          eq(invoices.organizationId, getActiveOrganizationId()),
        ),
      );
    return row?.payment;
  }
  
  async getPaymentsByInvoiceId(invoiceId: number): Promise<Payment[]> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return [];
    return db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(desc(payments.paymentDate));
  }
  
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const invoice = await this.getInvoice(Number(payment.invoiceId));
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const receivedBy = Number(payment.receivedBy);
    if (!Number.isFinite(receivedBy) || receivedBy <= 0) {
      throw new Error("Payment receivedBy is required.");
    }
    const [created] = await db
      .insert(payments)
      .values({
        invoiceId: Number(payment.invoiceId),
        amount: Number(payment.amount ?? 0),
        method: payment.method ?? "BANK_TRANSFER",
        transactionReference: payment.transactionReference ?? null,
        paymentDate: payment.paymentDate ?? new Date(),
        notes: payment.notes ?? null,
        receivedBy,
      })
      .returning();

    await this.reconcileInvoicePayments(created.invoiceId);
    return created;
  }
  
  async updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment | undefined> {
    const existing = await this.getPayment(id);
    if (!existing) return undefined;

    const [updated] = await db
      .update(payments)
      .set({
        ...payment,
        paymentDate: payment.paymentDate ?? existing.paymentDate,
        receivedBy: payment.receivedBy != null ? Number(payment.receivedBy) : existing.receivedBy,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, id))
      .returning();

    await this.reconcileInvoicePayments(updated.invoiceId);
    return updated;
  }
  
  async deletePayment(id: number): Promise<boolean> {
    const existing = await this.getPayment(id);
    if (!existing) return false;
    const result = await db.delete(payments).where(eq(payments.id, id));
    await this.reconcileInvoicePayments(existing.invoiceId);
    return (result.rowCount ?? 0) > 0;
  }
  
  async recordInvoicePayment(invoiceId: number, amount: number, method: string, receivedBy: number, reference?: string, notes?: string): Promise<Payment> {
    return this.createPayment({
      invoiceId,
      amount,
      method: method as Payment["method"],
      receivedBy,
      transactionReference: reference,
      notes,
    });
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
