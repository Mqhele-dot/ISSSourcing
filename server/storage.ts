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
  type InventoryStats, ItemStatus, type BulkImportInventory,
  PurchaseRequisitionStatus, PurchaseOrderStatus, PaymentStatus, ReorderRequestStatus,
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
  
  // Supplier methods
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplier(id: number): Promise<Supplier | undefined>;
  getSupplierByName(name: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: number): Promise<boolean>;
  
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
}

export class MemStorage implements IStorage {
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
    this.vatRates = new Map();
    this.reorderRequests = new Map();
    
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
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const user: User = { 
      ...insertUser, 
      id,
      email: insertUser.email || null,
      role: insertUser.role || null
    };
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
      requisitionId: insertRequest.requisitionId || null
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
      supplierId: item.supplierId,
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
  }) | undefined> {
    const request = this.reorderRequests.get(id);
    if (!request) return undefined;
    
    const item = await this.getInventoryItem(request.itemId);
    if (!item) return undefined;
    
    let requestor: User | undefined;
    let approver: User | undefined;
    
    if (request.requestorId) {
      requestor = await this.getUser(request.requestorId);
    }
    
    if (request.approverId) {
      approver = await this.getUser(request.approverId);
    }
    
    return {
      ...request,
      item,
      requestor,
      approver
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
}

export const storage = new MemStorage();
