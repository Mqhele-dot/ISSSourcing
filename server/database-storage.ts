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
  purchaseOrderItems, type PurchaseOrderItem, type InsertPurchaseOrderItem,
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
import type { IStorage } from "./storage";
import { MemStorage } from "./storage";
import { inventoryLineValue } from "./forecast-service";

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
    const base = db.select().from(activityLogs).orderBy(desc(activityLogs.timestamp));
    return limit ? base.limit(limit) : base;
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
  
  async getUserCustomRoleId(userId: number): Promise<number | null> {
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
    return db.select().from(suppliers);
  }
  
  async getSupplier(id: number): Promise<Supplier | undefined> {
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    return row;
  }
  
  async getSupplierByName(name: string): Promise<Supplier | undefined> {
    const [row] = await db.select().from(suppliers).where(eq(suppliers.name, name));
    return row;
  }
  
  async createSupplier(supplier: InsertSupplier): Promise<Supplier> {
    const [created] = await db.insert(suppliers).values(supplier).returning();
    return created;
  }
  
  async updateSupplier(id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const [updated] = await db.update(suppliers).set(supplier).where(eq(suppliers.id, id)).returning();
    return updated;
  }
  
  async deleteSupplier(id: number): Promise<boolean> {
    const result = await db.delete(suppliers).where(eq(suppliers.id, id));
    return (result.rowCount ?? 0) > 0;
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
    return db.select().from(warehouses);
  }
  
  async getWarehouse(id: number): Promise<Warehouse | undefined> {
    const [row] = await db.select().from(warehouses).where(eq(warehouses.id, id));
    return row;
  }
  
  async getDefaultWarehouse(): Promise<Warehouse | undefined> {
    const [row] = await db.select().from(warehouses).where(eq(warehouses.isDefault, true)).limit(1);
    return row;
  }
  
  async createWarehouse(warehouse: InsertWarehouse): Promise<Warehouse> {
    const [created] = await db.insert(warehouses).values(warehouse).returning();
    return created;
  }
  
  async updateWarehouse(id: number, warehouse: Partial<InsertWarehouse>): Promise<Warehouse | undefined> {
    const [updated] = await db.update(warehouses).set({ ...warehouse, updatedAt: new Date() }).where(eq(warehouses.id, id)).returning();
    return updated;
  }
  
  async deleteWarehouse(id: number): Promise<boolean> {
    const result = await db.delete(warehouses).where(eq(warehouses.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async setDefaultWarehouse(id: number): Promise<Warehouse | undefined> {
    await db.update(warehouses).set({ isDefault: false, updatedAt: new Date() });
    const [updated] = await db.update(warehouses).set({ isDefault: true, updatedAt: new Date() }).where(eq(warehouses.id, id)).returning();
    return updated;
  }
  
  async getWarehouseInventory(warehouseId: number): Promise<WarehouseInventory[]> {
    return db.select().from(warehouseInventory).where(eq(warehouseInventory.warehouseId, warehouseId));
  }

  async getWarehouseInventoryById(id: number): Promise<WarehouseInventory | undefined> {
    const [row] = await db.select().from(warehouseInventory).where(eq(warehouseInventory.id, id));
    return row;
  }

  async getWarehouseInventoryItem(warehouseId: number, itemId: number): Promise<WarehouseInventory | undefined> {
    const [row] = await db.select().from(warehouseInventory).where(and(eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.itemId, itemId)));
    return row;
  }
  
  async getItemWarehouseInventory(itemId: number): Promise<WarehouseInventory[]> {
    return db.select().from(warehouseInventory).where(eq(warehouseInventory.itemId, itemId));
  }
  
  async createWarehouseInventory(wi: InsertWarehouseInventory): Promise<WarehouseInventory> {
    const [created] = await db.insert(warehouseInventory).values({ ...wi, updatedAt: new Date() }).returning();
    return created;
  }
  
  async updateWarehouseInventory(id: number, wi: Partial<InsertWarehouseInventory>): Promise<WarehouseInventory | undefined> {
    const [updated] = await db.update(warehouseInventory).set({ ...wi, updatedAt: new Date() }).where(eq(warehouseInventory.id, id)).returning();
    return updated;
  }
  
  async deleteWarehouseInventory(id: number): Promise<boolean> {
    const result = await db.delete(warehouseInventory).where(eq(warehouseInventory.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getAllStockMovements(): Promise<StockMovement[]> {
    return db.select().from(stockMovements).orderBy(desc(stockMovements.timestamp));
  }
  
  async getStockMovement(id: number): Promise<StockMovement | undefined> {
    const [row] = await db.select().from(stockMovements).where(eq(stockMovements.id, id));
    return row;
  }
  
  async getStockMovementsByItemId(itemId: number): Promise<StockMovement[]> {
    return db.select().from(stockMovements).where(eq(stockMovements.itemId, itemId)).orderBy(desc(stockMovements.timestamp));
  }
  
  async getStockMovementsByWarehouseId(warehouseId: number): Promise<StockMovement[]> {
    return db.select().from(stockMovements).where(or(eq(stockMovements.warehouseId, warehouseId), eq(stockMovements.sourceWarehouseId, warehouseId), eq(stockMovements.destinationWarehouseId, warehouseId))).orderBy(desc(stockMovements.timestamp));
  }
  
  async createStockMovement(movement: InsertStockMovement): Promise<StockMovement> {
    const [created] = await db.insert(stockMovements).values(movement).returning();
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
    return db.select().from(reorderRequests).orderBy(desc(reorderRequests.createdAt));
  }
  
  async getReorderRequestsByDateRange(startDate: Date, endDate: Date): Promise<ReorderRequest[]> {
    return db.select().from(reorderRequests).where(and(gte(reorderRequests.createdAt, startDate), lte(reorderRequests.createdAt, endDate))).orderBy(desc(reorderRequests.createdAt));
  }
  
  async getReorderRequest(id: number): Promise<ReorderRequest | undefined> {
    const [row] = await db.select().from(reorderRequests).where(eq(reorderRequests.id, id));
    return row;
  }
  
  async getReorderRequestByNumber(requestNumber: string): Promise<ReorderRequest | undefined> {
    const [row] = await db.select().from(reorderRequests).where(eq(reorderRequests.requestNumber, requestNumber));
    return row;
  }
  
  async createReorderRequest(request: InsertReorderRequest): Promise<ReorderRequest> {
    const reqNumber = request.requestNumber ?? `RO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 1000)}`;
    const [created] = await db.insert(reorderRequests).values({ ...request, requestNumber: reqNumber, updatedAt: new Date() }).returning();
    return created;
  }
  
  async updateReorderRequest(id: number, request: Partial<InsertReorderRequest>): Promise<ReorderRequest | undefined> {
    const [updated] = await db.update(reorderRequests).set({ ...request, updatedAt: new Date() }).where(eq(reorderRequests.id, id)).returning();
    return updated;
  }
  
  async deleteReorderRequest(id: number): Promise<boolean> {
    const result = await db.delete(reorderRequests).where(eq(reorderRequests.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async approveReorderRequest(id: number, approverId: number): Promise<ReorderRequest | undefined> {
    const [updated] = await db.update(reorderRequests).set({ status: "APPROVED", approverId, approvalDate: new Date(), updatedAt: new Date() }).where(eq(reorderRequests.id, id)).returning();
    return updated;
  }
  
  async rejectReorderRequest(id: number, approverId: number, reason: string): Promise<ReorderRequest | undefined> {
    const [updated] = await db.update(reorderRequests).set({ status: "REJECTED", approverId, rejectionReason: reason, updatedAt: new Date() }).where(eq(reorderRequests.id, id)).returning();
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
    const [req] = await db.select().from(reorderRequests).where(eq(reorderRequests.id, id));
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
    const base = db.select().from(supplierContracts).orderBy(desc(supplierContracts.createdAt));
    if (supplierId != null) {
      return base.where(eq(supplierContracts.supplierId, supplierId));
    }
    return base;
  }

  async getContract(id: number): Promise<SupplierContract | undefined> {
    const [row] = await db.select().from(supplierContracts).where(eq(supplierContracts.id, id));
    return row;
  }

  async createContract(contract: InsertSupplierContract): Promise<SupplierContract> {
    const payload = {
      ...contract,
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
    const [updated] = await db.update(supplierContracts).set(payload as Partial<InsertSupplierContract>).where(eq(supplierContracts.id, id)).returning();
    return updated;
  }

  async deleteContract(id: number): Promise<boolean> {
    const result = await db.delete(supplierContracts).where(eq(supplierContracts.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async deleteInventoryItem(id: number): Promise<boolean> {
    const result = await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async searchInventoryItems(query: string, categoryId?: number): Promise<InventoryItem[]> {
    const q = `%${query.trim()}%`;
    const textMatch = query.trim()
      ? or(like(inventoryItems.name, q), like(inventoryItems.sku, q))
      : undefined;
    const whereClause =
      textMatch && categoryId != null
        ? and(textMatch, eq(inventoryItems.categoryId, categoryId))
        : textMatch ?? (categoryId != null ? eq(inventoryItems.categoryId, categoryId) : undefined);
    if (!whereClause) return db.select().from(inventoryItems);
    return db.select().from(inventoryItems).where(whereClause);
  }
  
  async getLowStockItems(): Promise<InventoryItem[]> {
    const items = await db.select().from(inventoryItems);
    return items.filter(
      (item) =>
        (item.quantity ?? 0) > 0 &&
        (item.lowStockThreshold != null && (item.quantity ?? 0) <= item.lowStockThreshold)
    );
  }
  
  async getOutOfStockItems(): Promise<InventoryItem[]> {
    return db.select().from(inventoryItems).where(eq(inventoryItems.quantity, 0));
  }
  
  async getInventoryStats(): Promise<InventoryStats> {
    const items = await db.select().from(inventoryItems);
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
    return db.select().from(purchaseRequisitions).orderBy(desc(purchaseRequisitions.createdAt));
  }
  
  async getPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined> {
    const [row] = await db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
    return row;
  }
  
  async getPurchaseRequisitionByNumber(requisitionNumber: string): Promise<PurchaseRequisition | undefined> {
    const [row] = await db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.requisitionNumber, requisitionNumber));
    return row;
  }
  
  async createPurchaseRequisition(requisition: InsertPurchaseRequisition, items: Omit<InsertPurchaseRequisitionItem, "requisitionId">[]): Promise<PurchaseRequisition> {
    const [created] = await db.insert(purchaseRequisitions).values({ ...requisition, updatedAt: new Date() }).returning();
    let totalAmount = 0;
    for (const item of items) {
      const totalPrice = (Number(item.unitPrice) || 0) * (item.quantity || 0);
      totalAmount += totalPrice;
      await db.insert(purchaseRequisitionItems).values({ ...item, requisitionId: created.id, totalPrice });
    }
    if (totalAmount > 0) {
      await db.update(purchaseRequisitions).set({ totalAmount, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, created.id));
      return (await db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, created.id)))[0];
    }
    return created;
  }
  
  async updatePurchaseRequisition(id: number, requisition: Partial<InsertPurchaseRequisition>): Promise<PurchaseRequisition | undefined> {
    const [updated] = await db.update(purchaseRequisitions).set({ ...requisition, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, id)).returning();
    return updated;
  }
  
  async deletePurchaseRequisition(id: number): Promise<boolean> {
    await db.delete(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId, id));
    const result = await db.delete(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getPurchaseRequisitionItems(requisitionId: number): Promise<PurchaseRequisitionItem[]> {
    return db.select().from(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId, requisitionId));
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
    const [updated] = await db
      .update(purchaseRequisitions)
      .set({
        status: PurchaseRequisitionStatus.APPROVED,
        approverId,
        approvalDate: new Date(),
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, id))
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
      .where(eq(purchaseRequisitions.id, id))
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
    return db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt));
  }
  
  async getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined> {
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    return row;
  }
  
  async getPurchaseOrderByNumber(orderNumber: string): Promise<PurchaseOrder | undefined> {
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.orderNumber, orderNumber));
    return row;
  }
  
  async createPurchaseOrder(order: InsertPurchaseOrder, items: Omit<InsertPurchaseOrderItem, "orderId">[]): Promise<PurchaseOrder> {
    const [created] = await db.insert(purchaseOrders).values({ ...order, updatedAt: new Date() }).returning();
    let totalAmount = 0;
    for (const item of items) {
      const totalPrice = (Number(item.unitPrice) || 0) * (item.quantity || 0);
      totalAmount += totalPrice;
      await db.insert(purchaseOrderItems).values({ ...item, orderId: created.id, totalPrice });
    }
    if (totalAmount > 0) {
      await db.update(purchaseOrders).set({ totalAmount, updatedAt: new Date() }).where(eq(purchaseOrders.id, created.id));
      return (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, created.id)))[0];
    }
    return created;
  }
  
  async updatePurchaseOrder(id: number, order: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const [updated] = await db.update(purchaseOrders).set({ ...order, updatedAt: new Date() }).where(eq(purchaseOrders.id, id)).returning();
    return updated;
  }
  
  async deletePurchaseOrder(id: number): Promise<boolean> {
    await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id));
    const result = await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getPurchaseOrderItems(orderId: number): Promise<PurchaseOrderItem[]> {
    return db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, orderId));
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
    const [updated] = await db
      .update(purchaseOrders)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id))
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
      .where(eq(purchaseOrders.id, id))
      .returning();

    return updated;
  }
  
  async recordPurchaseOrderItemReceived(itemId: number, receivedQuantity: number): Promise<PurchaseOrderItem | undefined> {
    return this.memStorage.recordPurchaseOrderItemReceived(itemId, receivedQuantity);
  }
  
  async createPurchaseOrderFromRequisition(requisitionId: number): Promise<PurchaseOrder | undefined> {
    return db.transaction(async (tx) => {
      const [requisition] = await tx
        .select()
        .from(purchaseRequisitions)
        .where(eq(purchaseRequisitions.id, requisitionId));
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

      const orderNumber = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
      const expectedDeliveryDate =
        requisition.requiredDate ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          orderNumber,
          supplierId: requisition.supplierId,
          requisitionId: requisition.id,
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
        await tx.insert(purchaseOrderItems).values({
          orderId: order.id,
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          receivedQuantity: 0,
          notes: item.notes ?? null,
        });
      }

      await tx
        .update(purchaseRequisitions)
        .set({
          status: PurchaseRequisitionStatus.CONVERTED,
          updatedAt: new Date(),
        })
        .where(eq(purchaseRequisitions.id, requisitionId));

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
    const [req] = await db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
    if (!req) return undefined;
    const items = await db.select().from(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId, id));
    const itemIds = [...new Set(items.map((i) => i.itemId))];
    const invItems = itemIds.length > 0
      ? await db.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds))
      : [];
    const invMap = new Map(invItems.map((i) => [i.id, i]));
    const result = {
      ...req,
      items: items
        .map((i) => ({ ...i, item: invMap.get(i.itemId) }))
        .filter((x): x is PurchaseRequisitionItem & { item: InventoryItem } => x.item != null),
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
      const [s] = await db.select().from(suppliers).where(eq(suppliers.id, req.supplierId));
      result.supplier = s;
    }
    return result;
  }
  
  async getPurchaseOrderWithDetails(id: number): Promise<(PurchaseOrder & { items: (PurchaseOrderItem & { item: InventoryItem; })[]; supplier: Supplier; requisition?: PurchaseRequisition; }) | undefined> {
    const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!order) return undefined;

    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
    if (!supplier) return undefined;

    const items = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id));
    const itemIds = [...new Set(items.map((line) => line.itemId))];
    const invItems =
      itemIds.length > 0
        ? await db.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds))
        : [];
    const invMap = new Map(invItems.map((item) => [item.id, item]));
    const enrichedItems = items
      .map((line) => ({ ...line, item: invMap.get(line.itemId) }))
      .filter((line): line is PurchaseOrderItem & { item: InventoryItem } => line.item != null);

    let requisition: PurchaseRequisition | undefined;
    if (order.requisitionId != null) {
      const [req] = await db
        .select()
        .from(purchaseRequisitions)
        .where(eq(purchaseRequisitions.id, order.requisitionId));
      requisition = req;
    }

    return {
      ...order,
      items: enrichedItems,
      supplier,
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
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }
  
  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    return row;
  }
  
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    const [row] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber));
    return row;
  }
  
  async createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[]): Promise<Invoice> {
    return db.transaction(async (tx) => {
      const total = Number(invoice.total ?? 0);
      const payload = {
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
        paidAmount: Number(invoice.paidAmount ?? 0),
        dueAmount: Number(invoice.dueAmount ?? total),
        createdBy: Number(invoice.createdBy ?? 1),
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
      .where(eq(invoices.id, id))
      .returning();
    return updated;
  }
  
  async deleteInvoice(id: number): Promise<boolean> {
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await db.delete(payments).where(eq(payments.invoiceId, id));
    const result = await db.delete(invoices).where(eq(invoices.id, id));
    return (result.rowCount ?? 0) > 0;
  }
  
  async getInvoicesByCustomerId(customerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.customerId, customerId)).orderBy(desc(invoices.createdAt));
  }
  
  async getInvoicesByDateRange(startDate: Date, endDate: Date): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(and(gte(invoices.issueDate, startDate), lte(invoices.issueDate, endDate)))
      .orderBy(desc(invoices.issueDate));
  }
  
  async getInvoicesByStatus(status: string): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.status, status as Invoice["status"]))
      .orderBy(desc(invoices.createdAt));
  }
  
  async getOverdueInvoices(): Promise<Invoice[]> {
    const now = new Date();
    return db
      .select()
      .from(invoices)
      .where(and(lt(invoices.dueDate, now), ne(invoices.status, "PAID")))
      .orderBy(desc(invoices.dueDate));
  }
  
  async getInvoiceDueInDays(days: number): Promise<Invoice[]> {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    return db
      .select()
      .from(invoices)
      .where(and(gte(invoices.dueDate, now), lte(invoices.dueDate, target), ne(invoices.status, "PAID")))
      .orderBy(invoices.dueDate);
  }
  
  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(invoiceItems.id);
  }
  
  async getInvoiceItem(id: number): Promise<InvoiceItem | undefined> {
    const [row] = await db.select().from(invoiceItems).where(eq(invoiceItems.id, id));
    return row;
  }
  
  async addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
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
    const [updated] = await db
      .update(invoiceItems)
      .set(item)
      .where(eq(invoiceItems.id, id))
      .returning();
    return updated;
  }
  
  async deleteInvoiceItem(id: number): Promise<boolean> {
    const result = await db.delete(invoiceItems).where(eq(invoiceItems.id, id));
    return (result.rowCount ?? 0) > 0;
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
