import { and, desc, eq, sql } from "drizzle-orm";
import {
  fuelCylinders,
  fuelDeliveries,
  fuelPrices,
  fuelPumps,
  fuelSafetyInspections,
  fuelShiftReconciliations,
  fuelStations,
  fuelTankReadings,
  fuelTanks,
  suppliers,
} from "@shared/schema";
import { db } from "../../db";
import { getTenantContext } from "../../organization-context";
import { calculateFuelReconciliation } from "@shared/fuel-operations";

export class FuelOperationsError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "FuelOperationsError";
  }
}

export function isMissingFuelSchemaError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate?.code === "42P01" || String(candidate?.message ?? "").includes("fuel_");
}

async function requireStation(stationId: number) {
  const { organizationId } = getTenantContext();
  const [station] = await db
    .select()
    .from(fuelStations)
    .where(and(eq(fuelStations.organizationId, organizationId), eq(fuelStations.id, stationId)))
    .limit(1);
  if (!station) throw new FuelOperationsError("INVALID_STATION", "Station does not belong to the active organization.");
  return station;
}

async function requireTank(tankId: number, stationId?: number) {
  const { organizationId } = getTenantContext();
  const [tank] = await db
    .select()
    .from(fuelTanks)
    .where(and(eq(fuelTanks.organizationId, organizationId), eq(fuelTanks.id, tankId)))
    .limit(1);
  if (!tank || (stationId != null && tank.stationId !== stationId)) {
    throw new FuelOperationsError("INVALID_TANK", "Tank does not belong to the selected station.");
  }
  return tank;
}

export async function getFuelOperationsWorkspace() {
  const { organizationId } = getTenantContext();
  const now = new Date();
  const [stations, tanks, pumps, cylinders, deliveries, reconciliations, prices, inspections] = await Promise.all([
    db.select().from(fuelStations).where(eq(fuelStations.organizationId, organizationId)).orderBy(fuelStations.name).limit(100),
    db.select().from(fuelTanks).where(eq(fuelTanks.organizationId, organizationId)).orderBy(fuelTanks.code).limit(250),
    db.select().from(fuelPumps).where(eq(fuelPumps.organizationId, organizationId)).orderBy(fuelPumps.code).limit(250),
    db.select().from(fuelCylinders).where(eq(fuelCylinders.organizationId, organizationId)).orderBy(fuelCylinders.serialNumber).limit(250),
    db.select().from(fuelDeliveries).where(eq(fuelDeliveries.organizationId, organizationId)).orderBy(desc(fuelDeliveries.deliveredAt), desc(fuelDeliveries.id)).limit(50),
    db.select().from(fuelShiftReconciliations).where(eq(fuelShiftReconciliations.organizationId, organizationId)).orderBy(desc(fuelShiftReconciliations.shiftEndedAt), desc(fuelShiftReconciliations.id)).limit(50),
    db.select().from(fuelPrices).where(and(eq(fuelPrices.organizationId, organizationId), eq(fuelPrices.active, true))).orderBy(desc(fuelPrices.effectiveFrom)).limit(100),
    db.select().from(fuelSafetyInspections).where(eq(fuelSafetyInspections.organizationId, organizationId)).orderBy(desc(fuelSafetyInspections.inspectedAt), desc(fuelSafetyInspections.id)).limit(50),
  ]);

  const totalCapacityLitres = tanks.reduce((sum, tank) => sum + tank.capacityLitres, 0);
  const totalStockLitres = tanks.reduce((sum, tank) => sum + tank.currentLevelLitres, 0);
  const lowStockTanks = tanks.filter((tank) => tank.currentLevelLitres <= tank.reorderLevelLitres).length;
  const safetyAttention = inspections.filter(
    (inspection) => inspection.result !== "pass" || (inspection.nextDueAt != null && inspection.nextDueAt <= now),
  ).length;
  const reconciliationVarianceLitres = reconciliations.reduce((sum, row) => sum + Math.abs(row.varianceLitres), 0);

  return {
    generatedAt: now.toISOString(),
    summary: {
      stations: stations.length,
      tanks: tanks.length,
      pumps: pumps.length,
      totalCapacityLitres,
      totalStockLitres,
      stockUtilizationPercent: totalCapacityLitres > 0 ? (totalStockLitres / totalCapacityLitres) * 100 : 0,
      lowStockTanks,
      lpgCylinders: cylinders.length,
      cylindersDueForTest: cylinders.filter((cylinder) => cylinder.testDueAt != null && cylinder.testDueAt <= now).length,
      safetyAttention,
      reconciliationVarianceLitres,
    },
    stations,
    tanks,
    pumps,
    cylinders,
    deliveries,
    reconciliations,
    prices,
    inspections,
  };
}

export async function createFuelStation(input: {
  code: string;
  name: string;
  address?: string | null;
  managerName?: string | null;
}) {
  const { organizationId } = getTenantContext();
  const [created] = await db.insert(fuelStations).values({ organizationId, ...input }).returning();
  return created;
}

export async function createFuelTank(input: {
  stationId: number;
  code: string;
  productType: string;
  storageType: string;
  capacityLitres: number;
  currentLevelLitres: number;
  reorderLevelLitres: number;
}) {
  const { organizationId } = getTenantContext();
  await requireStation(input.stationId);
  if (input.currentLevelLitres > input.capacityLitres || input.reorderLevelLitres > input.capacityLitres) {
    throw new FuelOperationsError("INVALID_CAPACITY", "Current and reorder levels cannot exceed tank capacity.");
  }
  const [created] = await db.insert(fuelTanks).values({ organizationId, ...input }).returning();
  return created;
}

export async function createFuelPump(input: { stationId: number; tankId: number; code: string; currentMeterLitres: number }) {
  const { organizationId } = getTenantContext();
  await requireStation(input.stationId);
  await requireTank(input.tankId, input.stationId);
  const [created] = await db.insert(fuelPumps).values({ organizationId, ...input }).returning();
  return created;
}

export async function recordTankReading(input: {
  stationId: number;
  tankId: number;
  levelLitres: number;
  waterLevelMm: number;
  temperatureC?: number | null;
  source: string;
}) {
  const { organizationId, userId } = getTenantContext();
  const tank = await requireTank(input.tankId, input.stationId);
  if (input.levelLitres > tank.capacityLitres) {
    throw new FuelOperationsError("LEVEL_EXCEEDS_CAPACITY", "Tank reading cannot exceed registered capacity.");
  }
  return db.transaction(async (tx) => {
    const [reading] = await tx.insert(fuelTankReadings).values({ organizationId, recordedBy: userId, ...input }).returning();
    await tx.update(fuelTanks).set({ currentLevelLitres: input.levelLitres, updatedAt: new Date() }).where(and(eq(fuelTanks.organizationId, organizationId), eq(fuelTanks.id, input.tankId)));
    return reading;
  });
}

export async function recordFuelDelivery(input: {
  stationId: number;
  tankId: number;
  supplierId?: number | null;
  deliveryReference: string;
  quantityLitres: number;
  unitCost?: number | null;
  deliveredAt: Date;
}) {
  const { organizationId, userId } = getTenantContext();
  const tank = await requireTank(input.tankId, input.stationId);
  if (input.supplierId != null) {
    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, input.supplierId)))
      .limit(1);
    if (!supplier) {
      throw new FuelOperationsError("INVALID_SUPPLIER", "Supplier does not belong to the active organization.");
    }
  }
  const nextLevel = tank.currentLevelLitres + input.quantityLitres;
  if (nextLevel > tank.capacityLitres) {
    throw new FuelOperationsError("DELIVERY_EXCEEDS_CAPACITY", `Delivery would exceed capacity by ${(nextLevel - tank.capacityLitres).toFixed(2)} L.`);
  }
  return db.transaction(async (tx) => {
    const [delivery] = await tx.insert(fuelDeliveries).values({ organizationId, receivedBy: userId, ...input }).returning();
    await tx.update(fuelTanks).set({ currentLevelLitres: nextLevel, updatedAt: new Date() }).where(and(eq(fuelTanks.organizationId, organizationId), eq(fuelTanks.id, input.tankId)));
    return delivery;
  });
}

export async function recordShiftReconciliation(input: {
  stationId: number;
  pumpId: number;
  openingMeterLitres: number;
  closingMeterLitres: number;
  reportedSalesLitres: number;
  salesAmount: number;
  shiftStartedAt: Date;
  shiftEndedAt: Date;
}) {
  const { organizationId, userId } = getTenantContext();
  const [pump] = await db.select().from(fuelPumps).where(and(eq(fuelPumps.organizationId, organizationId), eq(fuelPumps.id, input.pumpId))).limit(1);
  if (!pump || pump.stationId !== input.stationId) throw new FuelOperationsError("INVALID_PUMP", "Pump does not belong to the selected station.");
  const tank = await requireTank(pump.tankId, input.stationId);
  if (input.shiftEndedAt < input.shiftStartedAt) throw new FuelOperationsError("INVALID_SHIFT_RANGE", "Shift end must be after shift start.");
  let calculation: ReturnType<typeof calculateFuelReconciliation>;
  try {
    calculation = calculateFuelReconciliation(input);
  } catch (error) {
    throw new FuelOperationsError("INVALID_METER_RANGE", error instanceof Error ? error.message : "Invalid meter range.");
  }
  const { measuredSalesLitres, varianceLitres, status } = calculation;
  if (measuredSalesLitres > tank.currentLevelLitres) throw new FuelOperationsError("INSUFFICIENT_TANK_STOCK", "Measured sales exceed the tank's recorded stock.");
  return db.transaction(async (tx) => {
    const [reconciliation] = await tx.insert(fuelShiftReconciliations).values({
      organizationId,
      recordedBy: userId,
      ...input,
      measuredSalesLitres,
      varianceLitres,
      status,
    }).returning();
    await tx.update(fuelPumps).set({ currentMeterLitres: input.closingMeterLitres, updatedAt: new Date() }).where(and(eq(fuelPumps.organizationId, organizationId), eq(fuelPumps.id, input.pumpId)));
    await tx.update(fuelTanks).set({ currentLevelLitres: sql`${fuelTanks.currentLevelLitres} - ${measuredSalesLitres}`, updatedAt: new Date() }).where(and(eq(fuelTanks.organizationId, organizationId), eq(fuelTanks.id, tank.id)));
    return reconciliation;
  });
}

export async function setFuelPrice(input: { stationId: number; productType: string; pricePerLitre: number; effectiveFrom: Date }) {
  const { organizationId, userId } = getTenantContext();
  await requireStation(input.stationId);
  return db.transaction(async (tx) => {
    await tx.update(fuelPrices).set({ active: false }).where(and(eq(fuelPrices.organizationId, organizationId), eq(fuelPrices.stationId, input.stationId), eq(fuelPrices.productType, input.productType), eq(fuelPrices.active, true)));
    const [created] = await tx.insert(fuelPrices).values({ organizationId, createdBy: userId, ...input }).returning();
    return created;
  });
}

export async function recordSafetyInspection(input: {
  stationId: number;
  tankId?: number | null;
  inspectionType: string;
  result: string;
  checklist: Record<string, boolean>;
  notes?: string | null;
  nextDueAt?: Date | null;
  inspectedAt: Date;
}) {
  const { organizationId, userId } = getTenantContext();
  await requireStation(input.stationId);
  if (input.tankId != null) await requireTank(input.tankId, input.stationId);
  return db.transaction(async (tx) => {
    const [inspection] = await tx.insert(fuelSafetyInspections).values({ organizationId, inspectorId: userId, ...input }).returning();
    if (input.tankId != null && input.result === "fail") {
      await tx.update(fuelTanks).set({ status: "blocked", updatedAt: new Date() }).where(and(eq(fuelTanks.organizationId, organizationId), eq(fuelTanks.id, input.tankId)));
    }
    return inspection;
  });
}

export async function createFuelCylinder(input: {
  stationId: number;
  serialNumber: string;
  gasFamily: string;
  capacityKg: number;
  tareWeightKg?: number | null;
  status: string;
  testDueAt?: Date | null;
}) {
  const { organizationId } = getTenantContext();
  await requireStation(input.stationId);
  const [created] = await db.insert(fuelCylinders).values({ organizationId, ...input }).returning();
  return created;
}

export async function updateFuelCylinderStatus(cylinderId: number, status: string) {
  const { organizationId } = getTenantContext();
  const [updated] = await db.update(fuelCylinders).set({ status, updatedAt: new Date() }).where(and(eq(fuelCylinders.organizationId, organizationId), eq(fuelCylinders.id, cylinderId))).returning();
  if (!updated) throw new FuelOperationsError("INVALID_CYLINDER", "Cylinder does not belong to the active organization.", 404);
  return updated;
}
