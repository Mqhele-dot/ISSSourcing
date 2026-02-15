import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import {
  appSettings,
  categories,
  inventoryItems,
  suppliers,
  users,
  warehouses,
  type InsertAppSettings,
  type InsertCategory,
  type InsertInventoryItem,
  type InsertSupplier,
  type InsertWarehouse,
} from "@shared/schema";
import { db, pool } from "./db";

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

  return createdWarehouse.id;
}

async function ensureCategories(): Promise<Map<string, number>> {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES)
    .onConflictDoNothing({ target: categories.name });

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
    lowStockDefaultThreshold: 10,
    allowNegativeInventory: false,
    realTimeUpdatesEnabled: true,
    lowStockAlertFrequency: 30,
    autoReorderEnabled: false,
    enableVat: false,
    defaultVatCountry: "US",
    showPricesWithVat: true,
  };

  await db.insert(appSettings).values(defaultSettings);
}

async function ensureAdminUser(): Promise<void> {
  const hashedPassword = await hashPassword("Admin123!");
  await db
    .insert(users)
    .values({
      username: "admin",
      email: "admin@example.com",
      fullName: "System Administrator",
      role: "admin",
      emailVerified: true,
      password: hashedPassword,
      active: true,
    })
    .onConflictDoNothing({ target: users.username });
}

async function ensureDemoUsers(): Promise<void> {
  const hashedPassword = await hashPassword("Admin123!");
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
  ];

  for (const demoUser of demoUsers) {
    await db
      .insert(users)
      .values({
        ...demoUser,
        emailVerified: true,
        password: hashedPassword,
        active: true,
      })
      .onConflictDoNothing({ target: users.username });
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
  ];

  for (const item of demoItems) {
    await db
      .insert(inventoryItems)
      .values(item)
      .onConflictDoUpdate({
        target: inventoryItems.sku,
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
  const defaultWarehouseId = await getOrCreateDefaultWarehouse();
  const categoryMap = await ensureCategories();
  const supplierMap = await ensureSuppliers();

  await ensureSettings();
  await ensureAdminUser();
  await ensureDemoUsers();
  await ensureInventoryItems(defaultWarehouseId, categoryMap, supplierMap);

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

const isDirectRun =
  typeof process.argv[1] === "string" &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  runSeedCli().catch((error) => {
    console.error("Failed to seed database:", error);
    process.exit(1);
  });
}
