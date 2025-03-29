import { pgTable, text, serial, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User schema for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Activity log schema for tracking changes
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  itemId: integer("item_id"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
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
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItemForm = z.infer<typeof inventoryItemFormSchema>;

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

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
export type ReportType = "inventory" | "low-stock" | "value";
