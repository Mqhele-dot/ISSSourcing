import {
  users, type User, type InsertUser,
  categories, type Category, type InsertCategory,
  inventoryItems, type InventoryItem, type InsertInventoryItem,
  activityLogs, type ActivityLog, type InsertActivityLog,
  type InventoryStats, ItemStatus,
} from "@shared/schema";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Category methods
  getAllCategories(): Promise<Category[]>;
  getCategory(id: number): Promise<Category | undefined>;
  getCategoryByName(name: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category | undefined>;
  deleteCategory(id: number): Promise<boolean>;
  
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
  
  // Activity log methods
  getAllActivityLogs(limit?: number): Promise<ActivityLog[]>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private categories: Map<number, Category>;
  private inventoryItems: Map<number, InventoryItem>;
  private activityLogs: Map<number, ActivityLog>;
  
  private userCurrentId: number;
  private categoryCurrentId: number;
  private itemCurrentId: number;
  private logCurrentId: number;
  
  constructor() {
    this.users = new Map();
    this.categories = new Map();
    this.inventoryItems = new Map();
    this.activityLogs = new Map();
    
    this.userCurrentId = 1;
    this.categoryCurrentId = 1;
    this.itemCurrentId = 1;
    this.logCurrentId = 1;
    
    // Add default categories
    this.initializeDefaultData();
  }
  
  private initializeDefaultData() {
    // Add default categories
    const defaultCategories: InsertCategory[] = [
      { name: "Electronics", description: "Electronic devices and accessories" },
      { name: "Office Supplies", description: "General office supplies and stationery" },
      { name: "Furniture", description: "Office furniture and fixtures" }
    ];
    
    defaultCategories.forEach(category => this.createCategory(category));
    
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
        location: "Warehouse A"
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
        location: "Shelf B5"
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
        location: "Warehouse B"
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
        location: "Warehouse A"
      }
    ];
    
    defaultItems.forEach(item => {
      this.createInventoryItem(item);
    });
    
    // Add sample activity logs
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const defaultLogs: InsertActivityLog[] = [
      {
        action: "New Order Created",
        description: "Order #5782 for $754.99",
        itemId: null,
        timestamp: now
      },
      {
        action: "New Supplier Added",
        description: "Tech Solutions Inc.",
        itemId: null,
        timestamp: yesterday
      },
      {
        action: "Inventory Updated",
        description: "24 items added to stock",
        itemId: 1,
        timestamp: yesterday
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
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
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
    const category: Category = { ...insertCategory, id };
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
        item.quantity > 0 && item.quantity <= item.lowStockThreshold
      ).length,
      outOfStockItems: items.filter(item => item.quantity === 0).length,
      inventoryValue: Number(inventoryValue.toFixed(2))
    };
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
    const log: ActivityLog = { 
      ...insertLog, 
      id,
      timestamp: insertLog.timestamp || now
    };
    this.activityLogs.set(id, log);
    return log;
  }
}

export const storage = new MemStorage();
