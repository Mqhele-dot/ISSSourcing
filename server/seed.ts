import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
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

type SeedSummary = {
  seeded: boolean;
  usersCreated: number;
  categoriesCreated: number;
  suppliersCreated: number;
  warehousesCreated: number;
  inventoryItemsCreated: number;
  settingsCreated: number;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${hash.toString("hex")}.${salt}`;
}

async function ensureDefaultWarehouse(summary: SeedSummary): Promise<number> {
  const [existingDefault] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.isDefault, true))
    .limit(1);

  if (existingDefault) {
    return existingDefault.id;
  }

  const [existingWarehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .limit(1);

  if (existingWarehouse) {
    await db
      .update(warehouses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(warehouses.id, existingWarehouse.id));
    return existingWarehouse.id;
  }

  const defaultWarehouse: InsertWarehouse = {
    name: "Main Warehouse",
    location: "HQ",
    address: "100 Inventory Way",
    contactPerson: "Operations Team",
    contactPhone: "+1-555-0100",
    isDefault: true,
  };

  const [createdWarehouse] = await db.insert(warehouses).values(defaultWarehouse).returning({
    id: warehouses.id,
  });

  summary.warehousesCreated += 1;
  return createdWarehouse.id;
}

async function ensureCategories(summary: SeedSummary): Promise<Map<string, number>> {
  const existingCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);

  if (existingCategories.length === 0) {
    const defaultCategories: InsertCategory[] = [
      { name: "Electronics", description: "Devices, accessories, and components" },
      { name: "Office Supplies", description: "Everyday office essentials" },
      { name: "Furniture", description: "Workspace furniture and fixtures" },
      { name: "Networking", description: "Network and connectivity equipment" },
    ];

    await db.insert(categories).values(defaultCategories);
    summary.categoriesCreated += defaultCategories.length;
  }

  const rows = await db.select({ id: categories.id, name: categories.name }).from(categories);
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function ensureSuppliers(summary: SeedSummary): Promise<Map<string, number>> {
  const existingSuppliers = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers);

  if (existingSuppliers.length === 0) {
    const defaultSuppliers: InsertSupplier[] = [
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

    await db.insert(suppliers).values(defaultSuppliers);
    summary.suppliersCreated += defaultSuppliers.length;
  }

  const rows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function ensureSettings(summary: SeedSummary): Promise<void> {
  const [settings] = await db.select({ id: appSettings.id }).from(appSettings).limit(1);
  if (settings) {
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
  summary.settingsCreated += 1;
}

async function ensureAdminUser(summary: SeedSummary): Promise<void> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "admin"))
    .limit(1);

  if (admin) {
    return;
  }

  const hashedPassword = await hashPassword("Admin123!");
  await db.insert(users).values({
    username: "admin",
    email: "admin@example.com",
    fullName: "System Administrator",
    role: "admin",
    emailVerified: true,
    password: hashedPassword,
    active: true,
  });

  summary.usersCreated += 1;
}

async function ensureInventoryItems(
  defaultWarehouseId: number,
  categoryMap: Map<string, number>,
  supplierMap: Map<string, number>,
  summary: SeedSummary,
): Promise<void> {
  const [existingItem] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .limit(1);

  if (existingItem) {
    return;
  }

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

  await db.insert(inventoryItems).values(demoItems);
  summary.inventoryItemsCreated += demoItems.length;
}

export async function seedDatabase(): Promise<SeedSummary> {
  const summary: SeedSummary = {
    seeded: false,
    usersCreated: 0,
    categoriesCreated: 0,
    suppliersCreated: 0,
    warehousesCreated: 0,
    inventoryItemsCreated: 0,
    settingsCreated: 0,
  };

  const defaultWarehouseId = await ensureDefaultWarehouse(summary);
  const categoryMap = await ensureCategories(summary);
  const supplierMap = await ensureSuppliers(summary);
  await ensureSettings(summary);
  await ensureAdminUser(summary);
  await ensureInventoryItems(defaultWarehouseId, categoryMap, supplierMap, summary);

  summary.seeded =
    summary.usersCreated > 0 ||
    summary.categoriesCreated > 0 ||
    summary.suppliersCreated > 0 ||
    summary.warehousesCreated > 0 ||
    summary.inventoryItemsCreated > 0 ||
    summary.settingsCreated > 0;

  return summary;
}

export async function seedDatabaseIfEmpty(): Promise<boolean> {
  const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
  const [existingItem] = await db.select({ id: inventoryItems.id }).from(inventoryItems).limit(1);

  if (existingUser || existingItem) {
    return false;
  }

  const summary = await seedDatabase();
  return summary.seeded;
}

async function runSeedCli(): Promise<void> {
  try {
    const summary = await seedDatabase();
    if (summary.seeded) {
      console.log("Demo data seeded successfully.");
      console.log(summary);
      console.log("Default admin credentials: admin / Admin123!");
    } else {
      console.log("Database already contains seed data. No changes were made.");
    }
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
