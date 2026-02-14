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
    console.log("Default admin credentials: admin / Admin123!");
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
