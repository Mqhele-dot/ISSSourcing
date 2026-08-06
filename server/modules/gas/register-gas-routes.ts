import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";
import { sendError, sendOk } from "../../api-response";
import { getGasDashboardSummary, runGasComplianceAlerts } from "./gas-service";
import {
  createFuelCylinder,
  createFuelPump,
  createFuelStation,
  createFuelTank,
  FuelOperationsError,
  getFuelOperationsWorkspace,
  isMissingFuelSchemaError,
  recordFuelDelivery,
  recordSafetyInspection,
  recordShiftReconciliation,
  recordTankReading,
  setFuelPrice,
  updateFuelCylinderStatus,
} from "./fuel-operations-service";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

const id = z.coerce.number().int().positive();
const nonNegative = z.coerce.number().finite().nonnegative();
const positive = z.coerce.number().finite().positive();
const optionalDate = z.coerce.date().optional().nullable();
const productType = z.enum(["unleaded_93", "unleaded_95", "diesel_50ppm", "diesel_500ppm", "lpg"]);

const stationSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional().nullable(),
  managerName: z.string().trim().max(120).optional().nullable(),
}).strict();

const tankSchema = z.object({
  stationId: id,
  code: z.string().trim().min(1).max(40),
  productType,
  storageType: z.enum(["underground_tank", "above_ground_tank", "lpg_bulk_tank"]),
  capacityLitres: positive,
  currentLevelLitres: nonNegative.default(0),
  reorderLevelLitres: nonNegative.default(0),
}).strict();

const pumpSchema = z.object({
  stationId: id,
  tankId: id,
  code: z.string().trim().min(1).max(40),
  currentMeterLitres: nonNegative.default(0),
}).strict();

const readingSchema = z.object({
  stationId: id,
  tankId: id,
  levelLitres: nonNegative,
  waterLevelMm: nonNegative.default(0),
  temperatureC: z.coerce.number().finite().min(-50).max(100).optional().nullable(),
  source: z.enum(["manual", "gauge", "sensor"]).default("manual"),
}).strict();

const deliverySchema = z.object({
  stationId: id,
  tankId: id,
  supplierId: id.optional().nullable(),
  deliveryReference: z.string().trim().min(2).max(100),
  quantityLitres: positive,
  unitCost: nonNegative.optional().nullable(),
  deliveredAt: optionalDate,
}).strict();

const reconciliationSchema = z.object({
  stationId: id,
  pumpId: id,
  openingMeterLitres: nonNegative,
  closingMeterLitres: nonNegative,
  reportedSalesLitres: nonNegative,
  salesAmount: nonNegative,
  shiftStartedAt: z.coerce.date(),
  shiftEndedAt: z.coerce.date(),
}).strict();

const priceSchema = z.object({
  stationId: id,
  productType,
  pricePerLitre: positive,
  effectiveFrom: optionalDate,
}).strict();

const inspectionSchema = z.object({
  stationId: id,
  tankId: id.optional().nullable(),
  inspectionType: z.enum(["daily_forecourt", "tank_integrity", "lpg_safety", "fire_equipment", "environmental"]),
  result: z.enum(["pass", "conditional", "fail"]),
  checklist: z.record(z.boolean()).default({}),
  notes: z.string().trim().max(2000).optional().nullable(),
  nextDueAt: optionalDate,
  inspectedAt: optionalDate,
}).strict();

const cylinderSchema = z.object({
  stationId: id,
  serialNumber: z.string().trim().min(2).max(100),
  gasFamily: z.string().trim().min(2).max(40).default("LPG"),
  capacityKg: positive,
  tareWeightKg: positive.optional().nullable(),
  status: z.enum(["full", "empty", "in_customer", "quarantine", "inspection_due"]).default("full"),
  testDueAt: optionalDate,
}).strict();

const cylinderStatusSchema = z.object({
  status: z.enum(["full", "empty", "in_customer", "quarantine", "inspection_due"]),
}).strict();

function validationError(res: Response, error: z.ZodError) {
  const fieldIssues: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "request";
    (fieldIssues[field] ??= []).push(issue.message);
  }
  return sendError(res, 400, "INVALID_FUEL_OPERATION", "Review the highlighted fuel-operation fields.", { fieldIssues });
}

function operationError(res: Response, error: unknown) {
  if (error instanceof FuelOperationsError) return sendError(res, error.status, error.code, error.message);
  if (isMissingFuelSchemaError(error)) {
    return sendError(res, 503, "FUEL_SCHEMA_REQUIRED", "Fuel Operations needs its database migration before it can be used.", {
      hint: "Run the database migration, then retry.",
    });
  }
  const candidate = error as { code?: string };
  if (candidate?.code === "23505") return sendError(res, 409, "DUPLICATE_FUEL_RECORD", "A fuel record with this code or serial number already exists.");
  console.error("[fuel-operations]", error);
  return sendError(res, 500, "FUEL_OPERATION_FAILED", "Fuel Operations could not complete the request.");
}

/** Gas and fuel vertical APIs. Gated by the organization's gas feature flag. */
export function registerGasRoutes(app: Express, auth: Auth): void {
  const requireGasFeature: RequestHandler = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const flags = await getFeatureFlagsForActiveOrg();
      if (!isOrgFeatureEnabled(flags, "gas")) return void sendOrgFeatureDisabled(res, "gas");
      next();
    } catch (error) {
      next(error);
    }
  };
  const read = [auth.ensureAuthenticated, requireGasFeature, auth.ensurePermission("inventory", "read")];
  const write = [auth.ensureAuthenticated, requireGasFeature, auth.ensurePermission("inventory", "update")];

  app.get("/api/gas/dashboard-summary", ...read, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getGasDashboardSummary());
    } catch (error) {
      return operationError(res, error);
    }
  });

  app.post("/api/gas/run-compliance-alerts", ...write, async (req: Request, res: Response) => {
    const role = String((req as Request & { user?: { role?: string } }).user?.role ?? "").toLowerCase();
    if (role !== "admin" && role !== "manager") return sendError(res, 403, "FORBIDDEN", "Manager or admin required");
    try {
      return sendOk(res, await runGasComplianceAlerts());
    } catch (error) {
      return operationError(res, error);
    }
  });

  app.get("/api/fuel/workspace", ...read, async (_req, res) => {
    try { return sendOk(res, await getFuelOperationsWorkspace()); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/stations", ...write, async (req, res) => {
    const parsed = stationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await createFuelStation(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/tanks", ...write, async (req, res) => {
    const parsed = tankSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await createFuelTank(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/pumps", ...write, async (req, res) => {
    const parsed = pumpSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await createFuelPump(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/readings", ...write, async (req, res) => {
    const parsed = readingSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await recordTankReading(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/deliveries", ...write, async (req, res) => {
    const parsed = deliverySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await recordFuelDelivery({ ...parsed.data, deliveredAt: parsed.data.deliveredAt ?? new Date() }), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/reconciliations", ...write, async (req, res) => {
    const parsed = reconciliationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await recordShiftReconciliation(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/prices", ...write, async (req, res) => {
    const parsed = priceSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await setFuelPrice({ ...parsed.data, effectiveFrom: parsed.data.effectiveFrom ?? new Date() }), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/inspections", ...write, async (req, res) => {
    const parsed = inspectionSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await recordSafetyInspection({ ...parsed.data, inspectedAt: parsed.data.inspectedAt ?? new Date() }), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/cylinders", ...write, async (req, res) => {
    const parsed = cylinderSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await createFuelCylinder(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.patch("/api/fuel/cylinders/:id/status", ...write, async (req, res) => {
    const cylinderId = id.safeParse(req.params.id);
    const parsed = cylinderStatusSchema.safeParse(req.body);
    if (!cylinderId.success) return validationError(res, cylinderId.error);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await updateFuelCylinderStatus(cylinderId.data, parsed.data.status)); } catch (error) { return operationError(res, error); }
  });
}
