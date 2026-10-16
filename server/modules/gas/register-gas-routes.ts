import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";
import { sendError, sendOk } from "../../api-response";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
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
const productId = z.coerce.number().int().positive();

const stationSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional().nullable(),
  managerName: z.string().trim().max(120).optional().nullable(),
}).strict();

const tankSchema = z.object({
  stationId: id,
  code: z.string().trim().min(1).max(40),
  productId,
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
  productId,
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
    try {
      const workspace = await getFuelOperationsWorkspace();
      const products = await pool.query(
        `SELECT id, code, name, product_class AS "productClass", unit,
          applicable_storage_types AS "applicableStorageTypes", active
         FROM fuel_products WHERE organization_id = $1 ORDER BY active DESC, name, id`,
        [getActiveOrganizationId()],
      );
      return sendOk(res, { ...workspace, products: products.rows });
    } catch (error) { return operationError(res, error); }
  });

  app.get("/api/fuel/products", ...read, async (_req, res) => {
    try {
      const rows = await pool.query(
        `SELECT id, code, name, product_class AS "productClass", unit,
          applicable_storage_types AS "applicableStorageTypes", active, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM fuel_products WHERE organization_id = $1 ORDER BY active DESC, name, id`,
        [getActiveOrganizationId()],
      );
      return sendOk(res, rows.rows);
    } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/products", ...write, async (req, res) => {
    const parsed = z.object({
      code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
      name: z.string().trim().min(2).max(120),
      productClass: z.string().trim().min(2).max(80),
      unit: z.string().trim().min(1).max(30).default("litre"),
      applicableStorageTypes: z.array(z.enum(["underground_tank", "above_ground_tank", "lpg_bulk_tank"])).min(1),
    }).safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try {
      const result = await pool.query(
        `INSERT INTO fuel_products (organization_id, code, name, product_class, unit, applicable_storage_types)
         VALUES ($1, upper($2), $3, $4, $5, $6) RETURNING id, code, name, product_class AS "productClass", unit, applicable_storage_types AS "applicableStorageTypes", active`,
        [getActiveOrganizationId(), parsed.data.code, parsed.data.name, parsed.data.productClass, parsed.data.unit, parsed.data.applicableStorageTypes],
      );
      return sendOk(res, result.rows[0], 201);
    } catch (error) { return operationError(res, error); }
  });

  app.patch("/api/fuel/products/:id", ...write, async (req, res) => {
    const parsedId = id.safeParse(req.params.id);
    const parsed = z.object({ name: z.string().trim().min(2).max(120).optional(), productClass: z.string().trim().min(2).max(80).optional(), unit: z.string().trim().min(1).max(30).optional(), applicableStorageTypes: z.array(z.string()).min(1).optional(), active: z.boolean().optional() }).safeParse(req.body);
    if (!parsedId.success) return validationError(res, parsedId.error);
    if (!parsed.success) return validationError(res, parsed.error);
    try {
      if (parsed.data.active === false) {
        const used = await pool.query("SELECT count(*)::int AS count FROM fuel_tanks WHERE organization_id = $1 AND product_id = $2 AND status <> 'inactive'", [getActiveOrganizationId(), parsedId.data]);
        if (Number(used.rows[0]?.count ?? 0) > 0) return sendError(res, 409, "FUEL_PRODUCT_IN_USE", "Deactivate or reassign active tanks before deactivating this fuel product.");
      }
      const current = await pool.query("SELECT * FROM fuel_products WHERE organization_id = $1 AND id = $2", [getActiveOrganizationId(), parsedId.data]);
      if (!current.rows[0]) return sendError(res, 404, "FUEL_PRODUCT_NOT_FOUND", "Fuel product not found.");
      const next = { ...current.rows[0], ...parsed.data };
      const result = await pool.query(
        `UPDATE fuel_products SET name=$1, product_class=$2, unit=$3, applicable_storage_types=$4, active=$5, updated_at=now()
         WHERE organization_id=$6 AND id=$7 RETURNING id, code, name, product_class AS "productClass", unit, applicable_storage_types AS "applicableStorageTypes", active`,
        [next.name, next.productClass ?? next.product_class, next.unit, next.applicableStorageTypes ?? next.applicable_storage_types, next.active, getActiveOrganizationId(), parsedId.data],
      );
      return sendOk(res, result.rows[0]);
    } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/stations", ...write, async (req, res) => {
    const parsed = stationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try { return sendOk(res, await createFuelStation(parsed.data), 201); } catch (error) { return operationError(res, error); }
  });

  app.post("/api/fuel/tanks", ...write, async (req, res) => {
    const parsed = tankSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try {
      const product = await pool.query("SELECT code, applicable_storage_types FROM fuel_products WHERE organization_id = $1 AND id = $2 AND active = TRUE", [getActiveOrganizationId(), parsed.data.productId]);
      if (!product.rows[0]) return sendError(res, 400, "INVALID_FUEL_PRODUCT", "Select an active fuel product owned by this organization.");
      if (!product.rows[0].applicable_storage_types.includes(parsed.data.storageType)) return sendError(res, 400, "INVALID_FUEL_STORAGE", "The selected product cannot use this storage type.");
      const { productId: selectedProductId, ...values } = parsed.data;
      const created = await createFuelTank({ ...values, productType: String(product.rows[0].code).toLowerCase() });
      await pool.query("UPDATE fuel_tanks SET product_id = $1 WHERE organization_id = $2 AND id = $3", [selectedProductId, getActiveOrganizationId(), created.id]);
      return sendOk(res, { ...created, productId: selectedProductId }, 201);
    } catch (error) { return operationError(res, error); }
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
    try {
      const product = await pool.query("SELECT code FROM fuel_products WHERE organization_id = $1 AND id = $2 AND active = TRUE", [getActiveOrganizationId(), parsed.data.productId]);
      if (!product.rows[0]) return sendError(res, 400, "INVALID_FUEL_PRODUCT", "Select an active fuel product owned by this organization.");
      const created = await setFuelPrice({ stationId: parsed.data.stationId, productType: String(product.rows[0].code).toLowerCase(), pricePerLitre: parsed.data.pricePerLitre, effectiveFrom: parsed.data.effectiveFrom ?? new Date() });
      return sendOk(res, created, 201);
    } catch (error) { return operationError(res, error); }
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
