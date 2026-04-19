import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import {
  appSettings,
  categories,
  inventoryItems,
  suppliers,
  users,
  warehouses,
  reorderRequests,
  stockMovements,
  activityLogs,
  approvalPolicies,
  carriers,
  commodityCodes,
  currencies,
  cycleCountLines,
  cycleCounts,
  departments,
  documents,
  incoterms,
  inventoryAllocations,
  inventoryBatches,
  inventorySerials,
  notificationPreferences,
  notifications,
  paymentTerms,
  purchaseRequisitions,
  purchaseRequisitionItems,
  purchaseOrders,
  purchaseOrderItems,
  retentionPolicies,
  supplierContracts,
  taxCodes,
  userContacts,
  userSecuritySettings,
  warehouseInventory,
  unitsOfMeasure,
  auditLogs,
  invoices,
  payments,
  type InsertAppSettings,
  type InsertCategory,
  type InsertInventoryItem,
  type InsertSupplier,
  type InsertWarehouse,
  type InsertReorderRequest,
  type InsertStockMovement,
  type InsertActivityLog,
  type InsertPurchaseRequisition,
  type InsertPurchaseRequisitionItem,
  type InsertPurchaseOrder,
  type InsertPurchaseOrderItem,
  type InsertSupplierContract,
} from "@shared/schema";
import { db, pool } from "./db";
import { ensureLegacyOrgIdColumnsForSeed, ensureProfessionalSupplyChainTables } from "./init-db";
import { initializeOperationalData } from "./operations-core";

const scryptAsync = promisify(scrypt);

export type DemoDataSummary = {
  users: number;
  warehouses: number;
  suppliers: number;
  items: number;
  settings: number;
};

export type SchemaStatus = {
  ok: boolean;
  missingTables: string[];
  status: "schema_ok" | "schema_incomplete";
};

const DEFAULT_CATEGORIES: InsertCategory[] = [
  { name: "Electronics", description: "Devices, accessories, and components" },
  { name: "Office Supplies", description: "Everyday office essentials" },
  { name: "Furniture", description: "Workspace furniture and fixtures" },
  { name: "Networking", description: "Network and connectivity equipment" },
];

const DEFAULT_SUPPLIERS: InsertSupplier[] = [
  {
    name: "Tech Solutions Inc.",
    contactName: "John Smith",
    email: "john@techsolutions.example",
    phone: "+1-555-1001",
    address: "123 Tech Blvd, San Francisco, CA",
    notes: "Primary electronics supplier",
  },
  {
    name: "Office Supply Co.",
    contactName: "Jane Doe",
    email: "jane@officesupply.example",
    phone: "+1-555-1002",
    address: "456 Office Park, Chicago, IL",
    notes: "Stationery and printing supplies",
  },
  {
    name: "Furniture Warehouse",
    contactName: "Robert Johnson",
    email: "robert@furniturewarehouse.example",
    phone: "+1-555-1003",
    address: "789 Warehouse Ave, Atlanta, GA",
    notes: "Furniture and storage fixtures",
  },
];

const REQUIRED_SCHEMA_TABLES = [
  "users",
  "warehouses",
  "suppliers",
  "inventory_items",
  "app_settings",
];

function toCount(value: unknown): number {
  return Number(value ?? 0);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${hash.toString("hex")}.${salt}`;
}

async function getOrCreateDefaultWarehouse(): Promise<number> {
  const [defaultWarehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.isDefault, true))
    .limit(1);

  if (defaultWarehouse) {
    return defaultWarehouse.id;
  }

  const [mainWarehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.name, "Main Warehouse"))
    .limit(1);

  if (mainWarehouse) {
    await db
      .update(warehouses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(warehouses.id, mainWarehouse.id));
    await ensureSecondaryWarehouse();
    return mainWarehouse.id;
  }

  const warehousePayload: InsertWarehouse = {
    name: "Main Warehouse",
    location: "HQ",
    address: "100 Inventory Way",
    contactPerson: "Operations Team",
    contactPhone: "+1-555-0100",
    isDefault: true,
  };

  const [createdWarehouse] = await db.insert(warehouses).values(warehousePayload).returning({
    id: warehouses.id,
  });
  await ensureSecondaryWarehouse();
  return createdWarehouse.id;
}

async function ensureSecondaryWarehouse(): Promise<void> {
  const [existing] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.name, "Secondary Warehouse"))
    .limit(1);
  if (existing) return;
  await db.insert(warehouses).values({
    name: "Secondary Warehouse",
    location: "Site B",
    address: "200 Distribution Rd",
    contactPerson: "Site B Manager",
    contactPhone: "+1-555-0200",
    isDefault: false,
  });
}

async function ensureCategories(): Promise<Map<string, number>> {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES)
    .onConflictDoNothing({ target: [categories.organizationId, categories.name] });

  const rows = await db.select({ id: categories.id, name: categories.name }).from(categories);
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function ensureSuppliers(): Promise<Map<string, number>> {
  for (const supplier of DEFAULT_SUPPLIERS) {
    const [existing] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.name, supplier.name))
      .limit(1);

    if (!existing) {
      await db.insert(suppliers).values(supplier);
    }
  }

  const rows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function ensureMasterData(): Promise<void> {
  await db.insert(unitsOfMeasure).values([
    { code: "EA", name: "Each", symbol: "ea", system: "metric", active: true },
    { code: "BOX", name: "Box", symbol: "box", system: "custom", active: true },
    { code: "KG", name: "Kilogram", symbol: "kg", system: "metric", active: true },
  ]).onConflictDoNothing({ target: unitsOfMeasure.code });

  await db.insert(currencies).values([
    { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2, active: true },
    { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2, active: true },
    { code: "GBP", name: "British Pound", symbol: "£", decimalPlaces: 2, active: true },
  ]).onConflictDoNothing({ target: currencies.code });

  await db.insert(taxCodes).values([
    { code: "VAT15", name: "Standard VAT 15%", rate: 15, type: "vat", countryCode: "ZA", active: true },
    { code: "GST07", name: "GST 7%", rate: 7, type: "sales", countryCode: "US", active: true },
  ]).onConflictDoNothing({ target: taxCodes.code });

  await db.insert(commodityCodes).values([
    { code: "432115", description: "Computers", category: "IT", active: true },
    { code: "441217", description: "Office writing instruments", category: "Office", active: true },
    { code: "561015", description: "Office furniture", category: "Furniture", active: true },
  ]).onConflictDoNothing({ target: commodityCodes.code });

  await db.insert(incoterms).values([
    { code: "EXW", name: "Ex Works", description: "Buyer takes responsibility at seller premises", active: true },
    { code: "FOB", name: "Free On Board", description: "Seller responsible until loaded on vessel", active: true },
    { code: "DAP", name: "Delivered At Place", description: "Seller delivers to buyer destination", active: true },
  ]).onConflictDoNothing({ target: incoterms.code });

  await db.insert(paymentTerms).values([
    { code: "NET30", name: "Net 30", netDays: 30, active: true },
    { code: "NET45", name: "Net 45", netDays: 45, active: true },
    { code: "COD", name: "Cash on Delivery", netDays: 0, active: true },
  ]).onConflictDoNothing({ target: paymentTerms.code });

  await db.insert(departments).values([
    { code: "OPS", name: "Operations", costCenterId: "CC-OPS-001", active: true },
    { code: "PROC", name: "Procurement", costCenterId: "CC-PRC-001", active: true },
    { code: "FIN", name: "Finance", costCenterId: "CC-FIN-001", active: true },
    { code: "WH", name: "Warehousing", costCenterId: "CC-WH-001", active: true },
  ]).onConflictDoNothing({ target: [departments.organizationId, departments.code] });

  await db.insert(carriers).values([
    { code: "DHL", name: "DHL Demo Freight", contact: "ops@dhl.example", active: true },
    { code: "UPS", name: "UPS Demo Express", contact: "ops@ups.example", active: true },
    { code: "FDEX", name: "FedEx Demo", contact: "ops@fedex.example", active: true },
  ]).onConflictDoNothing({ target: [carriers.organizationId, carriers.code] });
}

async function ensureSettings(): Promise<void> {
  const [existingSettings] = await db.select({ id: appSettings.id }).from(appSettings).limit(1);
  if (existingSettings) {
    return;
  }

  const defaultSettings: InsertAppSettings = {
    companyName: "InvTrack Demo",
    primaryColor: "#4f46e5",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "HH:mm",
    currencySymbol: "$",
    currencyCode: "USD",
    lowStockDefaultThreshold: 10,
    allowNegativeInventory: false,
    realTimeUpdatesEnabled: true,
    lowStockAlertFrequency: 30,
    autoReorderEnabled: false,
    enableVat: false,
    defaultVatCountry: "US",
    showPricesWithVat: true,
    businessCountryCode: "US",
    taxMode: "none",
    productOnboardingCompletedAt: new Date(),
    productOnboardingState: null,
  };

  await db.insert(appSettings).values(defaultSettings);
}

async function ensureAdminUser(demoPasswordHash: string): Promise<void> {
  const values = {
    username: "admin",
    email: "admin@example.com",
    fullName: "System Administrator",
    role: "admin" as const,
    emailVerified: true,
    password: demoPasswordHash,
    active: true,
  };
  if (process.env.NODE_ENV === "production") {
    await db.insert(users).values(values).onConflictDoNothing({ target: users.username });
    return;
  }
  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.username,
      set: {
        password: demoPasswordHash,
        emailVerified: true,
        active: true,
        fullName: values.fullName,
        email: values.email,
        role: values.role,
      },
    });
}

async function ensureDemoUsers(demoPasswordHash: string): Promise<void> {
  const demoUsers = [
    {
      username: "planner",
      email: "planner@example.com",
      fullName: "Demo Planner",
      role: "manager" as const,
    },
    {
      username: "viewer",
      email: "viewer@example.com",
      fullName: "Demo Viewer",
      role: "viewer" as const,
    },
    {
      username: "supplierdemo",
      email: "john@techsolutions.example",
      fullName: "Supplier Demo User",
      role: "supplier" as const,
    },
  ];

  for (const demoUser of demoUsers) {
    const row = {
      ...demoUser,
      emailVerified: true,
      password: demoPasswordHash,
      active: true,
    };
    if (process.env.NODE_ENV === "production") {
      await db.insert(users).values(row).onConflictDoNothing({ target: users.username });
    } else {
      await db
        .insert(users)
        .values(row)
        .onConflictDoUpdate({
          target: users.username,
          set: {
            password: demoPasswordHash,
            emailVerified: true,
            active: true,
            fullName: demoUser.fullName,
            email: demoUser.email,
            role: demoUser.role,
          },
        });
    }
  }
}

async function ensureInventoryItems(
  defaultWarehouseId: number,
  categoryMap: Map<string, number>,
  supplierMap: Map<string, number>,
): Promise<void> {
  const demoItems: InsertInventoryItem[] = [
    {
      name: 'MacBook Pro 16"',
      sku: "MBP16-2024",
      description: "16-inch MacBook Pro for engineering workstations",
      categoryId: categoryMap.get("Electronics"),
      supplierId: supplierMap.get("Tech Solutions Inc."),
      quantity: 18,
      price: 2399,
      cost: 1999,
      lowStockThreshold: 6,
      location: "Aisle A-2",
      defaultWarehouseId,
      status: "active",
    },
    {
      name: "Ergonomic Chair",
      sku: "CHR-ERG-100",
      description: "Adjustable ergonomic office chair with lumbar support",
      categoryId: categoryMap.get("Furniture"),
      supplierId: supplierMap.get("Furniture Warehouse"),
      quantity: 9,
      price: 349.99,
      cost: 220,
      lowStockThreshold: 4,
      location: "Aisle C-1",
      defaultWarehouseId,
      status: "active",
    },
    {
      name: "Premium Notebook Pack",
      sku: "NB-PREM-24",
      description: "Pack of 12 premium hardcover notebooks",
      categoryId: categoryMap.get("Office Supplies"),
      supplierId: supplierMap.get("Office Supply Co."),
      quantity: 45,
      price: 24.99,
      cost: 12.5,
      lowStockThreshold: 15,
      location: "Aisle B-4",
      defaultWarehouseId,
      status: "active",
    },
    // Extra items for filtering/export/testing (30+ total)
    { name: "USB-C Hub", sku: "USB-HUB-7", description: "7-in-1 USB-C hub", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 22, price: 49.99, cost: 28, lowStockThreshold: 8, location: "Aisle A-1", defaultWarehouseId, status: "active" },
    { name: "Wireless Mouse", sku: "MSE-WL-01", description: "Ergonomic wireless mouse", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 35, price: 29.99, cost: 15, lowStockThreshold: 10, location: "Aisle A-2", defaultWarehouseId, status: "active" },
    { name: "Mechanical Keyboard", sku: "KBD-MEC-01", description: "Tenkeyless mechanical keyboard", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 12, price: 89.99, cost: 52, lowStockThreshold: 5, location: "Aisle A-3", defaultWarehouseId, status: "active" },
    { name: "Monitor Arm", sku: "MON-ARM-01", description: "Single monitor desk mount", categoryId: categoryMap.get("Furniture"), supplierId: supplierMap.get("Furniture Warehouse"), quantity: 18, price: 79.99, cost: 42, lowStockThreshold: 6, location: "Aisle C-2", defaultWarehouseId, status: "active" },
    { name: "Standing Desk Mat", sku: "MAT-STD-01", description: "Anti-fatigue standing mat", categoryId: categoryMap.get("Furniture"), supplierId: supplierMap.get("Furniture Warehouse"), quantity: 25, price: 44.99, cost: 24, lowStockThreshold: 8, location: "Aisle C-3", defaultWarehouseId, status: "active" },
    { name: "Filing Cabinet", sku: "FIL-2DR-01", description: "2-drawer filing cabinet", categoryId: categoryMap.get("Furniture"), supplierId: supplierMap.get("Furniture Warehouse"), quantity: 7, price: 159.99, cost: 95, lowStockThreshold: 3, location: "Aisle C-4", defaultWarehouseId, status: "active" },
    { name: "Stapler", sku: "STP-DESK-01", description: "Desktop stapler", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 60, price: 12.99, cost: 5, lowStockThreshold: 20, location: "Aisle B-1", defaultWarehouseId, status: "active" },
    { name: "Ballpoint Pens 12pk", sku: "PEN-BP-12", description: "Box of 12 ballpoint pens", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 80, price: 8.99, cost: 3.5, lowStockThreshold: 24, location: "Aisle B-2", defaultWarehouseId, status: "active" },
    { name: "Sticky Notes 6pk", sku: "STK-NOT-06", description: "6-pack sticky notes", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 42, price: 6.99, cost: 2.8, lowStockThreshold: 15, location: "Aisle B-3", defaultWarehouseId, status: "active" },
    { name: "Ethernet Cable 5m", sku: "CAB-ETH-5M", description: "Cat6 Ethernet cable 5m", categoryId: categoryMap.get("Networking"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 50, price: 14.99, cost: 6, lowStockThreshold: 15, location: "Aisle A-4", defaultWarehouseId, status: "active" },
    { name: "Wi-Fi Router", sku: "WIF-ROUT-01", description: "Dual-band Wi-Fi 6 router", categoryId: categoryMap.get("Networking"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 14, price: 129.99, cost: 72, lowStockThreshold: 5, location: "Aisle A-5", defaultWarehouseId, status: "active" },
    { name: "Webcam HD", sku: "CAM-HD-01", description: "1080p webcam with mic", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 20, price: 59.99, cost: 32, lowStockThreshold: 6, location: "Aisle A-6", defaultWarehouseId, status: "active" },
    { name: "Headset", sku: "AUD-HST-01", description: "Noise-cancelling headset", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 16, price: 79.99, cost: 44, lowStockThreshold: 5, location: "Aisle A-7", defaultWarehouseId, status: "active" },
    { name: "Desk Lamp LED", sku: "LMP-LED-01", description: "LED desk lamp", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Furniture Warehouse"), quantity: 28, price: 34.99, cost: 18, lowStockThreshold: 8, location: "Aisle B-5", defaultWarehouseId, status: "active" },
    { name: "Paper Ream A4", sku: "PAP-A4-01", description: "Ream of 500 A4 sheets", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 55, price: 5.99, cost: 2.2, lowStockThreshold: 20, location: "Aisle B-6", defaultWarehouseId, status: "active" },
    { name: "Folder Manila 100", sku: "FLD-MAN-100", description: "Box of 100 manila folders", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 30, price: 18.99, cost: 9, lowStockThreshold: 10, location: "Aisle B-7", defaultWarehouseId, status: "active" },
    { name: "Switch 8-Port", sku: "SW-8P-01", description: "8-port gigabit switch", categoryId: categoryMap.get("Networking"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 11, price: 39.99, cost: 22, lowStockThreshold: 4, location: "Aisle A-8", defaultWarehouseId, status: "active" },
    { name: "Laptop Stand", sku: "LAP-STD-01", description: "Aluminum laptop stand", categoryId: categoryMap.get("Furniture"), supplierId: supplierMap.get("Furniture Warehouse"), quantity: 19, price: 54.99, cost: 30, lowStockThreshold: 6, location: "Aisle C-5", defaultWarehouseId, status: "active" },
    { name: "Whiteboard 60x90", sku: "WHT-BRD-01", description: "60x90 cm whiteboard", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 8, price: 69.99, cost: 38, lowStockThreshold: 3, location: "Aisle B-8", defaultWarehouseId, status: "active" },
    { name: "HDMI Cable 2m", sku: "CAB-HDM-2M", description: "HDMI 2.0 cable 2m", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 40, price: 11.99, cost: 4.5, lowStockThreshold: 12, location: "Aisle A-9", defaultWarehouseId, status: "active" },
    { name: "Desk Organizer", sku: "DSK-ORG-01", description: "Multi-compartment desk organizer", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 24, price: 22.99, cost: 11, lowStockThreshold: 8, location: "Aisle B-9", defaultWarehouseId, status: "active" },
    { name: "Power Strip 6-Outlet", sku: "PWR-STR-06", description: "6-outlet surge protector", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 33, price: 24.99, cost: 12, lowStockThreshold: 10, location: "Aisle A-10", defaultWarehouseId, status: "active" },
    { name: "Bookshelf 5-Tier", sku: "BOK-SHF-05", description: "5-tier bookshelf", categoryId: categoryMap.get("Furniture"), supplierId: supplierMap.get("Furniture Warehouse"), quantity: 6, price: 89.99, cost: 48, lowStockThreshold: 2, location: "Aisle C-6", defaultWarehouseId, status: "active" },
    { name: "Label Maker", sku: "LBL-MKR-01", description: "Electronic label maker", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 15, price: 44.99, cost: 24, lowStockThreshold: 5, location: "Aisle B-10", defaultWarehouseId, status: "active" },
    { name: "USB Flash 32GB", sku: "USB-FL-32", description: "32GB USB 3.0 flash drive", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 65, price: 12.99, cost: 5.5, lowStockThreshold: 20, location: "Aisle A-11", defaultWarehouseId, status: "active" },
    { name: "Screen Cleaner Kit", sku: "CLN-SCR-01", description: "Screen cleaning kit", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 38, price: 9.99, cost: 4, lowStockThreshold: 12, location: "Aisle B-11", defaultWarehouseId, status: "active" },
    { name: "Cable Tray", sku: "CAB-TRY-01", description: "Under-desk cable tray", categoryId: categoryMap.get("Networking"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 21, price: 19.99, cost: 10, lowStockThreshold: 6, location: "Aisle A-12", defaultWarehouseId, status: "active" },
    { name: "Docking Station", sku: "DOCK-USB-01", description: "USB-C docking station", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 10, price: 199.99, cost: 110, lowStockThreshold: 4, location: "Aisle A-13", defaultWarehouseId, status: "active" },
    { name: "Desk Pad XL", sku: "PAD-DSK-XL", description: "Extra-large desk pad", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 36, price: 27.99, cost: 14, lowStockThreshold: 10, location: "Aisle B-12", defaultWarehouseId, status: "active" },
    { name: "Monitor 27\"", sku: "MON-27-4K", description: "27-inch 4K monitor", categoryId: categoryMap.get("Electronics"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 13, price: 399.99, cost: 280, lowStockThreshold: 5, location: "Aisle A-14", defaultWarehouseId, status: "active" },
    { name: "Recycling Bin", sku: "BIN-REC-01", description: "Under-desk recycling bin", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Office Supply Co."), quantity: 44, price: 16.99, cost: 8, lowStockThreshold: 12, location: "Aisle B-13", defaultWarehouseId, status: "active" },
    { name: "Keyboard Wrist Rest", sku: "WRS-KBD-01", description: "Ergonomic wrist rest", categoryId: categoryMap.get("Office Supplies"), supplierId: supplierMap.get("Tech Solutions Inc."), quantity: 29, price: 19.99, cost: 9, lowStockThreshold: 8, location: "Aisle B-14", defaultWarehouseId, status: "active" },
  ];

  for (const item of demoItems) {
    await db
      .insert(inventoryItems)
      .values(item)
      .onConflictDoUpdate({
        target: [inventoryItems.organizationId, inventoryItems.sku],
        set: {
          name: item.name,
          description: item.description,
          categoryId: item.categoryId,
          supplierId: item.supplierId,
          quantity: item.quantity,
          price: item.price,
          cost: item.cost,
          lowStockThreshold: item.lowStockThreshold,
          location: item.location,
          defaultWarehouseId: item.defaultWarehouseId,
          status: item.status,
          updatedAt: new Date(),
        },
      });
  }
  // Ensure no inventory item has null price (avoids NaN in reports)
  await pool.query(
    `UPDATE inventory_items SET price = COALESCE(price, 0) WHERE price IS NULL`,
  );
}

async function ensureActivityLogs(): Promise<void> {
  const count = await db.select().from(activityLogs).limit(1);
  if (count.length > 0) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "admin")).limit(1);
  const userId = admin?.id ?? 1;
  const logs: InsertActivityLog[] = [
    { action: "System initialized", description: "Demo data seeded", userId, referenceType: "system", referenceId: null },
    { action: "Inventory loaded", description: "Sample inventory items loaded for testing", userId, referenceType: "inventory", referenceId: null },
    { action: "Categories created", description: "Default categories added", userId, referenceType: "category", referenceId: null },
    { action: "Suppliers added", description: "Default suppliers configured", userId, referenceType: "supplier", referenceId: null },
    { action: "Warehouses configured", description: "Main and secondary warehouses set up", userId, referenceType: "warehouse", referenceId: null },
  ];
  for (const log of logs) {
    await db.insert(activityLogs).values(log);
  }
}

async function ensureReorderRequests(supplierMap: Map<string, number>): Promise<void> {
  const existing = await db.select().from(reorderRequests).limit(1);
  if (existing.length > 0) return;
  const items = await db.select({ id: inventoryItems.id }).from(inventoryItems).limit(4);
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "admin")).limit(1);
  const [mainWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.name, "Main Warehouse")).limit(1);
  const supplierId = supplierMap.get("Tech Solutions Inc.") ?? null;
  const warehouseId = mainWh?.id ?? null;
  const requestorId = admin?.id ?? null;
  const reqs: InsertReorderRequest[] = [
    { requestNumber: "RO-DEMO-001", itemId: items[0]?.id ?? 1, quantity: 10, supplierId, warehouseId, requestorId, status: "PENDING" },
    { requestNumber: "RO-DEMO-002", itemId: items[1]?.id ?? 2, quantity: 5, supplierId, warehouseId, requestorId, status: "APPROVED" },
    { requestNumber: "RO-DEMO-003", itemId: items[2]?.id ?? 3, quantity: 20, supplierId, warehouseId, requestorId, status: "PENDING" },
  ];
  for (const r of reqs) {
    await db.insert(reorderRequests).values({ ...r, requestNumber: r.requestNumber ?? `RO-DEMO-${r.itemId}` });
  }
}

async function ensureStockMovements(): Promise<void> {
  const existing = await db.select().from(stockMovements).limit(1);
  if (existing.length > 0) return;
  const items = await db.select({ id: inventoryItems.id }).from(inventoryItems).limit(3);
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "admin")).limit(1);
  const whs = await db.select({ id: warehouses.id }).from(warehouses).limit(2);
  const userId = admin?.id ?? null;
  const movements: InsertStockMovement[] = [
    { itemId: items[0]?.id ?? 1, type: "RECEIPT", quantity: 15, userId, notes: "Demo receipt", previousQuantity: 0, newQuantity: 15 },
    { itemId: items[1]?.id ?? 2, type: "ADJUSTMENT", quantity: -2, userId, notes: "Demo adjustment", previousQuantity: 10, newQuantity: 8 },
    { itemId: items[2]?.id ?? 3, type: "RECEIPT", quantity: 30, userId, notes: "Demo restock", previousQuantity: 20, newQuantity: 50 },
    // Outbound movements so Analytics "stock use" charts are populated without relying on fallback
    { itemId: items[0]?.id ?? 1, type: "SALE", quantity: 3, userId, notes: "Demo sale", previousQuantity: 15, newQuantity: 12 },
    { itemId: items[2]?.id ?? 3, type: "ISSUE", quantity: 5, userId, notes: "Demo issue to floor", previousQuantity: 50, newQuantity: 45 },
  ];
  if (whs.length >= 2) {
    movements.push({
      itemId: items[0]?.id ?? 1,
      type: "TRANSFER",
      quantity: 5,
      userId,
      notes: "Demo transfer",
      sourceWarehouseId: whs[0].id,
      destinationWarehouseId: whs[1].id,
      previousQuantity: 15,
      newQuantity: 10,
    });
  }
  for (const m of movements) {
    await db.insert(stockMovements).values(m);
  }
}

async function ensurePurchaseRequisitionsAndOrders(supplierMap: Map<string, number>): Promise<void> {
  const existingPr = await db.select().from(purchaseRequisitions).limit(1);
  if (existingPr.length > 0) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "admin")).limit(1);
  const items = await db.select({ id: inventoryItems.id, price: inventoryItems.price }).from(inventoryItems).limit(2);
  const supId = supplierMap.get("Tech Solutions Inc.") ?? (await db.select({ id: suppliers.id }).from(suppliers).limit(1))[0]?.id ?? 1;
  const reqNum = `REQ-${Date.now()}-001`;
  const [pr] = await db.insert(purchaseRequisitions).values({
    requisitionNumber: reqNum,
    requestorId: admin?.id ?? 1,
    status: "APPROVED",
    notes: "Demo requisition for testing",
    requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    supplierId: supId,
    totalAmount: (Number(items[0]?.price) || 100) * 2 + (Number(items[1]?.price) || 50) * 1,
    approverId: admin?.id ?? 1,
    approvalDate: new Date(),
  }).returning({ id: purchaseRequisitions.id });
  if (pr && items.length >= 2) {
    await db.insert(purchaseRequisitionItems).values([
      { requisitionId: pr.id, itemId: items[0].id, quantity: 2, unitPrice: Number(items[0].price) || 100, totalPrice: (Number(items[0].price) || 100) * 2 },
      { requisitionId: pr.id, itemId: items[1].id, quantity: 1, unitPrice: Number(items[1].price) || 50, totalPrice: Number(items[1].price) || 50 },
    ]);
  }
  const existingPo = await db.select().from(purchaseOrders).limit(1);
  if (existingPo.length > 0) return;
  const poNum = `PO-${Date.now()}-001`;
  const totalAmount = (Number(items[0]?.price) || 100) * 3 + (Number(items[1]?.price) || 50) * 2;
  const [po] = await db.insert(purchaseOrders).values({
    orderNumber: poNum,
    supplierId: supId,
    status: "SENT",
    orderDate: new Date(),
    expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    totalAmount,
    paymentStatus: "UNPAID",
  }).returning({ id: purchaseOrders.id });
  if (po && items.length >= 2) {
    await db.insert(purchaseOrderItems).values([
      { orderId: po.id, itemId: items[0].id, quantity: 3, unitPrice: Number(items[0].price) || 100, totalPrice: (Number(items[0].price) || 100) * 3, receivedQuantity: 0 },
      { orderId: po.id, itemId: items[1].id, quantity: 2, unitPrice: Number(items[1].price) || 50, totalPrice: (Number(items[1].price) || 50) * 2, receivedQuantity: 0 },
    ]);
  }
}

async function ensureContractsAndFinanceData(
  supplierMap: Map<string, number>,
): Promise<void> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "admin"))
    .limit(1);
  const creatorId = admin?.id ?? 1;
  const supplierId =
    supplierMap.get("Tech Solutions Inc.") ??
    (await db.select({ id: suppliers.id }).from(suppliers).limit(1))[0]?.id ??
    1;

  const existingContracts = await db.select({ id: supplierContracts.id }).from(supplierContracts).limit(1);
  if (existingContracts.length === 0) {
    const contracts: InsertSupplierContract[] = [
      {
        supplierId,
        title: "Annual IT Equipment Supply Agreement",
        contractType: "master",
        referenceNumber: "CT-IT-2026-001",
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        value: 150000,
        currency: "USD",
        summary: "Demo annual contract for electronics and accessories.",
        status: "active",
        notes: "Seeded demo contract",
      },
    ];
    await db.insert(supplierContracts).values(contracts);
  }

  const existingInvoices = await db.select({ id: invoices.id }).from(invoices).limit(1);
  if (existingInvoices.length === 0) {
    const [po] = await db
      .select({
        id: purchaseOrders.id,
        supplierId: purchaseOrders.supplierId,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .limit(1);
    if (po) {
      const issueDate = new Date();
      const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const total = Number(po.totalAmount ?? 0);
      const paidAmount = Number((total * 0.4).toFixed(2));
      const dueAmount = Number((total - paidAmount).toFixed(2));
      const invoiceRows = await db
        .insert(invoices)
        .values({
          invoiceNumber: `INV-DEMO-${Date.now().toString().slice(-6)}`,
          customerId: null,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          status: "PARTIALLY_PAID",
          issueDate,
          dueDate,
          subtotal: total,
          tax: 0,
          discount: 0,
          total,
          paidAmount,
          dueAmount,
          notes: "Seeded demo invoice linked to seeded purchase order.",
          createdBy: creatorId,
        })
        .returning({ id: invoices.id });
      const invoiceId = invoiceRows[0]?.id;
      if (invoiceId) {
        await db.insert(payments).values({
          invoiceId,
          amount: paidAmount,
          method: "BANK_TRANSFER",
          transactionReference: `PMT-DEMO-${Date.now().toString().slice(-6)}`,
          paymentDate: new Date(),
          notes: "Seeded demo payment",
          receivedBy: creatorId,
        });
      }
    }
  }
}

async function ensureGovernanceAndDocuments(): Promise<void> {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "admin")).limit(1);
  const adminId = admin?.id ?? 1;

  const [firstPo] = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).limit(1);
  const [firstInvoice] = await db.select({ id: invoices.id }).from(invoices).limit(1);
  const [firstContract] = await db.select({ id: supplierContracts.id }).from(supplierContracts).limit(1);

  const existingDocs = await db.select({ id: documents.id }).from(documents).limit(1);
  if (existingDocs.length === 0) {
    await db.insert(documents).values([
      {
        entityType: "purchase_order",
        entityId: firstPo?.id ?? 1,
        fileUrl: "/uploads/documents/demo-po.pdf",
        fileName: "demo-po.pdf",
        mimeType: "application/pdf",
        fileSize: 102400,
        checksum: "demo-po-checksum",
        version: 1,
        uploadedBy: adminId,
      },
      {
        entityType: "invoice",
        entityId: firstInvoice?.id ?? 1,
        fileUrl: "/uploads/documents/demo-invoice.pdf",
        fileName: "demo-invoice.pdf",
        mimeType: "application/pdf",
        fileSize: 98888,
        checksum: "demo-invoice-checksum",
        version: 1,
        uploadedBy: adminId,
      },
      {
        entityType: "contract",
        entityId: firstContract?.id ?? 1,
        fileUrl: "/uploads/documents/demo-contract.pdf",
        fileName: "demo-contract.pdf",
        mimeType: "application/pdf",
        fileSize: 121100,
        checksum: "demo-contract-checksum",
        version: 1,
        uploadedBy: adminId,
      },
    ]);
  }

  await db.insert(retentionPolicies).values([
    { documentType: "purchase_order", retentionYears: 7, isActive: true },
    { documentType: "invoice", retentionYears: 7, isActive: true },
    { documentType: "contract", retentionYears: 10, isActive: true },
  ]).onConflictDoNothing({ target: retentionPolicies.documentType });

  const existingPolicies = await db.select({ id: approvalPolicies.id }).from(approvalPolicies).limit(1);
  if (existingPolicies.length === 0) {
    await db.insert(approvalPolicies).values([
      {
        name: "Requisition Standard Approval",
        entityType: "requisition",
        amountMin: 0,
        amountMax: 5000,
        approvalLevel: 1,
        approverRole: "manager",
        isActive: true,
      },
      {
        name: "PO High Value Approval",
        entityType: "purchase_order",
        amountMin: 5000,
        amountMax: null,
        approvalLevel: 2,
        approverRole: "admin",
        isActive: true,
      },
    ]);
  }

  const allUsers = await db.select({ id: users.id }).from(users);
  for (const user of allUsers) {
    await db
      .insert(notificationPreferences)
      .values({
        userId: user.id,
        emailEnabled: true,
        inAppEnabled: true,
        approvalRequest: true,
        lowStock: true,
        contractExpiry: true,
        shipmentDelay: true,
      })
      .onConflictDoNothing({ target: notificationPreferences.userId });
  }

  const existingNotifications = await db.select({ id: notifications.id }).from(notifications).limit(1);
  if (existingNotifications.length === 0 && allUsers.length > 0) {
    await db.insert(notifications).values(
      allUsers.flatMap((user) => [
        {
          userId: user.id,
          type: "approval",
          title: "Requisition awaiting approval",
          body: "A requisition is pending approval in your queue.",
          entityType: "purchase_requisition",
          entityId: null,
        },
        {
          userId: user.id,
          type: "inventory",
          title: "Low stock alert",
          body: "Multiple SKUs are below threshold and need reorder.",
          entityType: "inventory_item",
          entityId: null,
        },
      ]),
    );
  }

  const [existingSeedAudit] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.action, "seed_completed"))
    .limit(1);
  if (!existingSeedAudit) {
    await db.insert(auditLogs).values({
      userId: adminId,
      action: "seed_completed",
      resourceType: "system",
      resourceId: null,
      details: { note: "Extended demo seed completed" },
      ipAddress: "127.0.0.1",
      userAgent: "seed-script",
    });
  }
}

async function ensureOperationalInventoryCoverage(defaultWarehouseId: number): Promise<void> {
  const items = await db.select({ id: inventoryItems.id }).from(inventoryItems).limit(6);
  if (items.length === 0) return;

  const [secondaryWarehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.name, "Secondary Warehouse"))
    .limit(1);
  const secondaryWarehouseId = secondaryWarehouse?.id ?? defaultWarehouseId;

  const existingBatches = await db.select({ id: inventoryBatches.id }).from(inventoryBatches).limit(1);
  if (existingBatches.length === 0) {
    await db.insert(inventoryBatches).values(
      items.slice(0, 4).map((item, idx) => ({
        itemId: item.id,
        warehouseId: idx % 2 === 0 ? defaultWarehouseId : secondaryWarehouseId,
        batchNumber: `BATCH-DEMO-${idx + 1}`,
        manufacturingDate: new Date(Date.now() - (30 + idx) * 24 * 60 * 60 * 1000),
        expiryDate: new Date(Date.now() + (180 + idx * 15) * 24 * 60 * 60 * 1000),
        quantityReceived: 40 + idx * 10,
        quantityOnHand: 28 + idx * 8,
      })),
    );
  }

  const existingSerials = await db.select({ id: inventorySerials.id }).from(inventorySerials).limit(1);
  if (existingSerials.length === 0) {
    await db.insert(inventorySerials).values(
      items.slice(0, 3).flatMap((item, idx) => [
        {
          itemId: item.id,
          warehouseId: defaultWarehouseId,
          serialNumber: `SER-${item.id}-${idx + 1}-A`,
          status: "available",
          currentLocation: `Aisle A-${idx + 1}`,
        },
        {
          itemId: item.id,
          warehouseId: secondaryWarehouseId,
          serialNumber: `SER-${item.id}-${idx + 1}-B`,
          status: "allocated",
          currentLocation: `Aisle B-${idx + 1}`,
        },
      ]),
    );
  }

  const existingAllocations = await db.select({ id: inventoryAllocations.id }).from(inventoryAllocations).limit(1);
  if (existingAllocations.length === 0) {
    const [requisition] = await db.select({ id: purchaseRequisitions.id }).from(purchaseRequisitions).limit(1);
    let shipment: { id: number } | undefined;
    try {
      [shipment] = await pool
        .query<{ id: number }>("SELECT id FROM shipments ORDER BY id LIMIT 1")
        .then((r) => r.rows);
    } catch {
      // Shipments table is created by operational seed/bootstrap in some environments.
      // Core seed should still succeed when operational tables are not present yet.
      shipment = undefined;
    }
    await db.insert(inventoryAllocations).values(
      items.slice(0, 3).map((item, idx) => ({
        itemId: item.id,
        warehouseId: defaultWarehouseId,
        quantity: 4 + idx,
        requisitionId: requisition?.id ?? null,
        shipmentId: shipment?.id ?? null,
        status: idx === 0 ? "reserved" : "fulfilled",
      })),
    );
  }

  const existingWarehouseInventory = await db.select({ id: warehouseInventory.id }).from(warehouseInventory).limit(1);
  if (existingWarehouseInventory.length === 0) {
    await db.insert(warehouseInventory).values(
      items.map((item, idx) => ({
        itemId: item.id,
        warehouseId: idx % 2 === 0 ? defaultWarehouseId : secondaryWarehouseId,
        quantity: 20 + idx * 3,
        location: idx % 2 === 0 ? `Aisle A-${idx + 1}` : `Aisle B-${idx + 1}`,
        aisle: idx % 2 === 0 ? "A" : "B",
        bin: `BIN-${idx + 1}`,
      })),
    );
  }

  const existingCycleCounts = await db.select({ id: cycleCounts.id }).from(cycleCounts).limit(1);
  if (existingCycleCounts.length === 0) {
    const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "admin")).limit(1);
    const [cycleCount] = await db.insert(cycleCounts).values({
      warehouseId: defaultWarehouseId,
      zone: "Zone A",
      status: "completed",
      countDate: new Date(),
      countedBy: admin?.id ?? null,
      variance: 2,
    }).returning({ id: cycleCounts.id });

    if (cycleCount) {
      await db.insert(cycleCountLines).values(
        items.slice(0, 4).map((item, idx) => ({
          cycleCountId: cycleCount.id,
          itemId: item.id,
          location: `Aisle A-${idx + 1}`,
          systemQuantity: 25 + idx * 2,
          countedQuantity: 24 + idx * 2,
          variance: -1,
        })),
      );
    }
  }
}

async function ensureUserProfileCoverage(): Promise<void> {
  const allUsers = await db.select({ id: users.id }).from(users);
  if (allUsers.length === 0) return;

  const existingContacts = await db.select({ id: userContacts.id }).from(userContacts).limit(1);
  if (existingContacts.length === 0) {
    await db.insert(userContacts).values(
      allUsers.map((user, idx) => ({
        userId: user.id,
        phoneWork: `+1-555-30${idx}0`,
        phoneMobile: `+1-555-40${idx}0`,
        city: "Cape Town",
        state: "Western Cape",
        country: "ZA",
        emergencyContact: `Emergency Contact ${idx + 1}`,
        emergencyPhone: `+1-555-90${idx}0`,
      })),
    );
  }

  const existingSecurity = await db.select({ id: userSecuritySettings.id }).from(userSecuritySettings).limit(1);
  if (existingSecurity.length === 0) {
    await db.insert(userSecuritySettings).values(
      allUsers.map((user) => ({
        userId: user.id,
        allowedIpAddresses: ["127.0.0.1"],
        allowedGeolocations: ["ZA"],
        biometricEnabled: false,
        ssoEnabled: false,
      })),
    );
  }
}

export async function getDemoDataSummary(): Promise<DemoDataSummary> {
  const [usersCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  const [warehousesCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(warehouses);
  const [suppliersCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(suppliers);
  const [itemsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItems);
  const [settingsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appSettings);

  return {
    users: toCount(usersCount?.count),
    warehouses: toCount(warehousesCount?.count),
    suppliers: toCount(suppliersCount?.count),
    items: toCount(itemsCount?.count),
    settings: toCount(settingsCount?.count),
  };
}

export async function getSchemaStatus(): Promise<SchemaStatus> {
  const { rows } = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const existing = new Set(rows.map((row) => row.table_name));
  const missingTables = REQUIRED_SCHEMA_TABLES.filter((table) => !existing.has(table));

  return {
    ok: missingTables.length === 0,
    missingTables,
    status: missingTables.length === 0 ? "schema_ok" : "schema_incomplete",
  };
}

export async function seedDatabase(): Promise<DemoDataSummary> {
  await ensureLegacyOrgIdColumnsForSeed();
  await ensureProfessionalSupplyChainTables();
  // Ensure operational tables exist before core seed references optional shipment IDs.
  await initializeOperationalData();
  const defaultWarehouseId = await getOrCreateDefaultWarehouse();
  const categoryMap = await ensureCategories();
  const supplierMap = await ensureSuppliers();

  await ensureMasterData();
  await ensureSettings();
  const demoPasswordHash = await hashPassword("Admin123!");
  await ensureAdminUser(demoPasswordHash);
  await ensureDemoUsers(demoPasswordHash);
  await ensureInventoryItems(defaultWarehouseId, categoryMap, supplierMap);
  await ensureActivityLogs();
  await ensureReorderRequests(supplierMap);
  await ensureStockMovements();
  await ensurePurchaseRequisitionsAndOrders(supplierMap);
  await ensureContractsAndFinanceData(supplierMap);
  await ensureGovernanceAndDocuments();
  await ensureOperationalInventoryCoverage(defaultWarehouseId);
  await ensureUserProfileCoverage();

  return getDemoDataSummary();
}

export async function seedDatabaseIfEmpty(): Promise<boolean> {
  const summary = await getDemoDataSummary();
  const hasData = summary.users > 0 || summary.items > 0;

  if (hasData) {
    return false;
  }

  await seedDatabase();
  return true;
}

async function truncatePublicTables(): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );

  const tableNames = rows
    .map((row) => row.tablename)
    .filter((name) => name !== "__drizzle_migrations");

  if (tableNames.length === 0) {
    return;
  }

  const quotedNames = tableNames.map((name) => `"${name}"`).join(", ");
  await pool.query(`TRUNCATE TABLE ${quotedNames} RESTART IDENTITY CASCADE`);
}

export async function resetAndSeedDemoData(): Promise<DemoDataSummary> {
  await truncatePublicTables();
  return seedDatabase();
}

async function runSeedCli(): Promise<void> {
  const shouldReset = process.argv.includes("--reset");

  try {
    const summary = shouldReset ? await resetAndSeedDemoData() : await seedDatabase();
    console.log(shouldReset ? "Demo data reset complete." : "Demo data seeded successfully.");
    console.log(summary);
    console.log("Default demo credentials: admin|planner|viewer / Admin123!");
  } finally {
    await pool.end();
  }
}

// Only run CLI (and pool.end()) when this file was explicitly executed (e.g. npx tsx server/seed.ts).
// When imported by the server we must never call pool.end() or the shared pool becomes unusable.
const entryScript = typeof process.argv[1] === "string" ? process.argv[1] : "";
const isSeedCli = entryScript.includes("seed") && !entryScript.includes("seed-operational");

if (isSeedCli) {
  runSeedCli().catch((error) => {
    console.error("Failed to seed database:", error);
    process.exit(1);
  });
}
