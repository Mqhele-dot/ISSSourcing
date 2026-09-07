import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  addOperationalExceptionComment,
  adjustOperationalInventory,
  assignOperationalException,
  createOperationalShipment,
  getOperationalControlTowerOverview,
  getOperationalExceptionDetail,
  getOperationalInventoryDetail,
  getOperationalPurchaseOrderDetail,
  getOperationalShipmentDetail,
  listOperationalActivity,
  listOperationalActivityPage,
  listOperationalExceptions,
  listOperationalExceptionsPage,
  listOperationalInventory,
  listOperationalPurchaseOrders,
  listOperationalShipments,
  listOperationalShipmentsPage,
  patchOperationalShipmentMeta,
  runOperationalExceptionChecks,
  receiveOperationalPurchaseOrder,
  runOperationalDemoWalkthrough,
  transitionOperationalExceptionStatus,
  transitionOperationalPurchaseOrderStatus,
  tryCreateOperationalShipmentOnSend,
  updateOperationalShipmentStatus,
} from "./operations-core";
import { buildEmptyControlTowerDashboard, getControlTowerDashboard } from "./modules/operations/control-tower-dashboard";
import { ApiContractError, contractError, respondOk, withApiContract } from "./api-contract";
import { pool } from "./db";
import { readiness } from "./readiness";
import { seedOperationalIfEmpty } from "./seed-operational";
import { seedDatabaseIfEmpty } from "./seed";
import { storage } from "./storage";
import {
  generatePurchaseOrdersDocumentPdf,
  generateShipmentDeliveryNotePdf,
} from "./services/document-generator-service";
import { getReportingCurrencyCode } from "./lib/org-reporting-money";
import { getOrganizationDocumentBranding } from "./services/organization-document-branding";
import { getActiveOrganizationId } from "./organization-context";
import {
  normalizeShipmentDirection,
  normalizeShipmentFilters,
  normalizeShipmentSourceType,
} from "@shared/logistics-shipment-filters";
import { validateExceptionStatusTransition } from "./modules/operations/exception-status-policy";
import { isDemoWalkthroughEnabled } from "./lib/deployment-behavior";

type AuthGuards = {
  ensureAuthenticated: (req: Request, res: Response, next: NextFunction) => void;
  ensureAdmin: (req: Request, res: Response, next: NextFunction) => void;
  ensurePermission: (
    resource: string,
    permissionType: string,
  ) => (req: Request, res: Response, next: NextFunction) => void;
};

const shipmentPageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "pageSize must be 25, 50, or 100").default(25),
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(60).optional(),
  po: z.string().trim().max(120).optional(),
  supplier: z.string().trim().max(200).optional(),
  carrier: z.string().trim().max(200).optional(),
  risk: z.enum(["late", "no_eta", "due_soon", "exception", "on_time"]).optional(),
  etaFrom: z.string().trim().max(40).optional(),
  etaTo: z.string().trim().max(40).optional(),
  tracking: z.string().trim().max(200).optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  sourceType: z.string().trim().max(80).optional(),
  sort: z.enum(["updated_desc", "updated_asc", "eta_asc", "eta_desc", "status_asc", "po_asc"]).default("updated_desc"),
});

const exceptionPageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "pageSize must be 25, 50, or 100").default(25),
  severity: z.string().trim().max(40).optional(),
  status: z.string().trim().max(40).optional(),
  type: z.string().trim().max(80).optional(),
  sort: z.enum(["created_desc", "created_asc", "severity_desc"]).default("created_desc"),
});

const INVENTORY_ROUTE_RESERVED_SEGMENTS = new Set([
  "low-stock",
  "out-of-stock",
  "expiring",
  "stats",
  "bulk-import",
  "find-by-barcode",
]);

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

const OPERATIONS_QUERY_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("OPERATIONS_QUERY_TIMEOUT")), ms),
    ),
  ]);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error";
}

const OPERATIONS_DEGRADED = process.env.OPERATIONS_DEGRADED === "true";

function isOperationsDegraded(): boolean {
  return OPERATIONS_DEGRADED;
}

function setEndpointHeader(res: Response, path: string): void {
  res.setHeader("X-InvTrack-Endpoint", path);
}

function getFallbackValue(err: unknown): "timeout" | "db-error" {
  return toErrorMessage(err) === "OPERATIONS_QUERY_TIMEOUT" ? "timeout" : "db-error";
}

function setFallbackHeader(res: Response, err: unknown): void {
  res.setHeader("X-InvTrack-Fallback", getFallbackValue(err));
}

function logOperationalError(path: string, elapsedMs: number, err: unknown): void {
  console.error("[operations]", path, "elapsed_ms", elapsedMs, toErrorMessage(err));
}

function requirePoWorkflowRole(req: Request): void {
  const role = String((req as Request & { user?: { role?: string } }).user?.role ?? "").toLowerCase();
  if (!["manager", "planner", "admin"].includes(role)) {
    throw contractError(
      403,
      "PO_ACTION_FORBIDDEN",
      "Purchase order approve and send require Manager, Planner, or Admin.",
      "Sign in with a role that can move POs through the operational workflow.",
    );
  }
}

function requirePoReceiveRole(req: Request): void {
  const role = String((req as Request & { user?: { role?: string } }).user?.role ?? "").toLowerCase();
  if (!["warehouse_staff", "manager", "planner", "admin"].includes(role)) {
    throw contractError(
      403,
      "PO_RECEIVE_FORBIDDEN",
      "Receiving purchase orders requires Warehouse Staff, Manager, Planner, or Admin.",
      "Sign in with a role allowed to receive stock into warehouse inventory.",
    );
  }
}

function resolveActor(req: Request): string {
  const u = (req as Request & { user?: { username?: string | null; email?: string | null } }).user;
  if (u && typeof u.username === "string" && u.username.trim()) return u.username.trim();
  if (u && typeof u.email === "string" && u.email.trim()) return u.email.trim();
  return "system";
}

function assertValidLogisticsDateQuery(value: string, fieldLabel: string): void {
  const v = value.trim();
  if (!v) return;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    throw contractError(
      400,
      "INVALID_LOGISTICS_FILTER",
      `${fieldLabel} must be a valid date or ISO-8601 timestamp`,
      fieldLabel,
    );
  }
}

function assertValidShipmentDirectionInput(value: string | null): string | null {
  if (!value?.trim()) return null;
  const normalized = normalizeShipmentDirection(value);
  if (!normalized) {
    throw contractError(400, "SHIPMENT_DIRECTION_INVALID", "direction is not supported for shipments.");
  }
  return normalized;
}

function assertValidShipmentSourceTypeInput(value: string | null): string | null {
  if (!value?.trim()) return null;
  const normalized = normalizeShipmentSourceType(value);
  if (!normalized) {
    throw contractError(400, "SHIPMENT_SOURCE_TYPE_INVALID", "sourceType is not supported for shipments.");
  }
  return normalized;
}

function mapAdjustInventoryError(error: unknown): never {
  const message = toErrorMessage(error);
  if (message === "delta_must_be_non_zero") {
    throw contractError(
      400,
      "INVALID_DELTA",
      "delta must be non-zero",
      "Provide a positive or negative quantity adjustment.",
    );
  }
  if (message === "warehouse_required") {
    throw contractError(
      400,
      "WAREHOUSE_REQUIRED",
      "warehouseId is required",
      "Choose a tenant-owned warehouse before submitting the adjustment.",
    );
  }
  if (message === "sku_not_found") {
    throw contractError(404, "SKU_NOT_FOUND", "sku not found");
  }
  if (message === "warehouse_not_found") {
    throw contractError(
      400,
      "WAREHOUSE_NOT_FOUND",
      "warehouse not found",
      "Use an active warehouse identifier owned by this organization.",
    );
  }
  if (message === "insufficient_available_stock") {
    throw contractError(400, "INSUFFICIENT_AVAILABLE_STOCK", "The adjustment would reduce available warehouse stock below zero.", "Reduce allocations or enable negative inventory through the production control plane.");
  }
  throw error;
}

function mapPurchaseStatusError(error: unknown): never {
  const message = toErrorMessage(error);
  if (message === "po_not_found") {
    throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
  }
  if (message === "invalid_target_status") {
    throw contractError(400, "INVALID_TARGET_STATUS", "toStatus is required");
  }
  if (message === "invalid_transition") {
    throw contractError(
      400,
      "INVALID_TRANSITION",
      "Invalid status transition",
      "Move purchase orders through draft -> open -> approved -> sent -> received.",
    );
  }
  throw error;
}

function mapPurchaseReceiveError(error: unknown): never {
  const message = toErrorMessage(error);
  if (message === "po_not_found") {
    throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
  }
  if (message === "invalid_receive_state") {
    throw contractError(
      400,
      "INVALID_RECEIVE_STATE",
      "Only approved/sent purchase orders can receive",
      "Move the PO to approved or sent before receiving lines.",
    );
  }
  if (message === "lines_required") {
    throw contractError(400, "LINES_REQUIRED", "lines are required");
  }
  if (message.startsWith("line_not_found:")) {
    throw contractError(
      400,
      "LINE_NOT_FOUND",
      "Unknown SKU in receive payload",
      undefined,
      { sku: message.split(":")[1] },
    );
  }
  if (message.startsWith("invalid_receive_qty:")) {
    throw contractError(
      400,
      "INVALID_RECEIVE_QTY",
      "Invalid receive quantity for SKU",
      undefined,
      { sku: message.split(":")[1] },
    );
  }
  if (message.startsWith("invalid_receive_qty_integer:")) {
    throw contractError(
      400,
      "INVALID_RECEIVE_QTY",
      "Receive quantity must be a whole number",
      undefined,
      { sku: message.split(":")[1] },
    );
  }
  if (message === "line_sku_required") {
    throw contractError(400, "LINE_SKU_REQUIRED", "Each receive line must include a SKU");
  }
  if (message.startsWith("receive_exceeds_remaining")) {
    throw contractError(
      400,
      "RECEIVE_EXCEEDS_REMAINING",
      "Quantity cannot exceed remaining quantity",
      "Reduce qty_received_now to the line remaining or receive in multiple steps.",
    );
  }
  if (message === "putaway_warehouse_not_found") {
    throw contractError(400, "PUTAWAY_WAREHOUSE_NOT_FOUND", "Warehouse not found for this organization.");
  }
  if (message === "putaway_aisle_invalid") {
    throw contractError(
      400,
      "PUTAWAY_AISLE_INVALID",
      "Aisle is missing or not configured on the selected warehouse.",
    );
  }
  if (message === "putaway_no_bins_for_aisle") {
    throw contractError(
      400,
      "PUTAWAY_NO_BINS_FOR_AISLE",
      "No bins are configured for this aisle on the warehouse.",
    );
  }
  if (message === "putaway_bin_required") {
    throw contractError(400, "PUTAWAY_BIN_REQUIRED", "Select a bin for this receive.");
  }
  if (message === "putaway_bin_invalid") {
    throw contractError(400, "PUTAWAY_BIN_INVALID", "Bin is not valid for the selected warehouse and aisle.");
  }
  if (message === "shipment_not_found_for_po") {
    throw contractError(
      400,
      "SHIPMENT_NOT_FOUND_FOR_PO",
      "The selected shipment does not belong to this purchase order.",
    );
  }
  throw error;
}

function mapShipmentError(error: unknown): never {
  const message = toErrorMessage(error);
  const taggedError = error as { code?: string; status?: number; message?: string };
  if (taggedError.status === 409 && taggedError.code === "SUPPLIER_INACTIVE") {
    throw contractError(409, "SUPPLIER_INACTIVE", taggedError.message ?? "Supplier is inactive for new inbound shipments.");
  }
  if (taggedError.status === 409 && taggedError.code === "SUPPLIER_BLOCKED") {
    throw contractError(409, "SUPPLIER_BLOCKED", taggedError.message ?? "Supplier is blocked for new inbound shipments.");
  }
  if (taggedError.status === 400 && taggedError.code === "SUPPLIER_NOT_FOUND") {
    throw contractError(400, "SUPPLIER_NOT_FOUND", taggedError.message ?? "Supplier was not found for this shipment.");
  }
  if (message === "shipment_not_found") {
    throw contractError(404, "SHIPMENT_NOT_FOUND", "Shipment not found");
  }
  if (message === "po_not_found_for_shipment") {
    throw contractError(
      400,
      "PO_NOT_FOUND_FOR_SHIPMENT",
      "No purchase order matches this PO number for your organization.",
    );
  }
  if (message === "carrier_not_found") {
    throw contractError(400, "CARRIER_NOT_FOUND", "Carrier id does not exist for this organization.");
  }
  if (message === "carrier_inactive") {
    throw contractError(400, "CARRIER_INACTIVE", "This carrier is inactive and cannot be used for new shipments.");
  }
  if (message === "shipment_freight_cost_invalid") {
    throw contractError(400, "SHIPMENT_FREIGHT_COST_INVALID", "freightCost must be zero or greater.");
  }
  if (message === "shipment_direction_invalid") {
    throw contractError(400, "SHIPMENT_DIRECTION_INVALID", "direction is not supported for shipments.");
  }
  if (message === "shipment_source_type_invalid") {
    throw contractError(400, "SHIPMENT_SOURCE_TYPE_INVALID", "sourceType is not supported for shipments.");
  }
  if (message === "shipment_insert_failed") {
    throw contractError(500, "SHIPMENT_CREATE_FAILED", "Could not create shipment.");
  }
  if (message === "invalid_target_status") {
    throw contractError(400, "INVALID_TARGET_STATUS", "toStatus is required");
  }
  if (message === "invalid_transition") {
    throw contractError(
      400,
      "INVALID_TRANSITION",
      "Invalid shipment status transition",
      "Use a valid status progression for the current shipment state.",
    );
  }
  throw error;
}

function mapExceptionLookupError(error: unknown): never {
  const message = toErrorMessage(error);
  if (message === "exception_not_found") {
    throw contractError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
  }
  throw error;
}

function mapExceptionMutationError(error: unknown): never {
  const message = toErrorMessage(error);
  if (message === "exception_not_found") {
    throw contractError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
  }
  if (message === "invalid_target_status") {
    throw contractError(400, "INVALID_TARGET_STATUS", "toStatus is required");
  }
  if (message === "invalid_transition") {
    throw contractError(
      400,
      "INVALID_TRANSITION",
      "Invalid exception status transition",
    );
  }
  if (message === "comment_required") {
    throw contractError(400, "COMMENT_REQUIRED", "comment is required");
  }
  throw error;
}

export function registerOperationalRoutes(app: Express, auth: AuthGuards) {
  /**
   * GET /api/inventory (list) — canonical handler when this module registers before `routes.ts`.
   * Returns operational rollup: onHand, allocated, available, expiry/mfg, envelope `{ ok, data }`.
   * Do not add a second conflicting GET without changing registration order in `registerRoutes`.
   */
  app.get(
    "/api/inventory",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Inventory data is temporarily unavailable");
      }
      try {
        const q =
          typeof req.query.q === "string"
            ? req.query.q
            : typeof req.query.search === "string"
              ? req.query.search
              : "";
        const location = typeof req.query.location === "string" ? req.query.location : "";
        const category =
          typeof req.query.category === "string"
            ? req.query.category
            : typeof req.query.categoryId === "string"
              ? req.query.categoryId
              : "";
        const low = parseBooleanFlag(req.query.low) || parseBooleanFlag(req.query.lowStock);
        const items = await withTimeout(
          listOperationalInventory({ q, location, category, low }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, items);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        throw contractError(503, "DB_UNAVAILABLE", "Inventory data is temporarily unavailable", String(getFallbackValue(err)));
      }
    }),
  );

  app.post(
    "/api/inventory/:sku/adjust",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      const sku = req.params.sku;
      const warehouseId = Number(req.body?.warehouseId ?? req.body?.warehouse_id);
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const ref = typeof req.body?.ref === "string" ? req.body.ref : undefined;
      const delta = Number(req.body?.delta);
      const createdBy = req.user?.username || req.user?.email || "system";

      if (!reason.trim()) {
        throw contractError(
          400,
          "REASON_REQUIRED",
          "reason is required",
          "Add a short reason such as Adjust, Damage, or Transfer.",
        );
      }

      try {
        const result = await withTimeout(
          adjustOperationalInventory({
            skuOrId: sku,
            warehouseId,
            delta,
            reason,
            ref,
            createdBy,
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, result);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        mapAdjustInventoryError(error);
      }
    }),
  );

  app.get(
    "/api/inventory/:sku",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      const sku = req.params.sku;
      if (INVENTORY_ROUTE_RESERVED_SEGMENTS.has(sku)) {
        // Delegate to a later-registered route (e.g. GET /api/inventory/expiring).
        // Plain next() does not re-enter the router for a better match.
        next("route");
        return;
      }
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(404, "INVENTORY_NOT_FOUND", "Inventory item not found");
      }

      let detail;
      try {
        detail = await withTimeout(getOperationalInventoryDetail(sku), OPERATIONS_QUERY_TIMEOUT_MS);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        throw contractError(404, "INVENTORY_NOT_FOUND", "Inventory item not found");
      }
      if (!detail) {
        throw contractError(404, "INVENTORY_NOT_FOUND", "Inventory item not found");
      }

      respondOk(res, detail);
    }),
  );

  const procurementPurchaseOrderOperationalBases = [
    "/api/purchase/orders",
    "/api/procurement/purchase-orders",
  ] as const;

  /** e.g. `GET /api/procurement/purchase-orders/records` is domain list — not operational PO id "records". */
  const OPERATIONAL_PO_PARAM_RESERVED_SEGMENTS = new Set(["records"]);
  function delegateReservedOperationalPoSegment(req: Request, next: NextFunction): boolean {
    const po = req.params.po;
    if (typeof po === "string" && OPERATIONAL_PO_PARAM_RESERVED_SEGMENTS.has(po)) {
      next("route");
      return true;
    }
    return false;
  }

  for (const base of procurementPurchaseOrderOperationalBases) {
    app.get(
      `${base}/:po/signed-pdf`,
      auth.ensureAuthenticated,
      withApiContract(async (req: Request, res: Response, next: NextFunction) => {
        if (delegateReservedOperationalPoSegment(req, next)) return;
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        const poParam = req.params.po;
        try {
          const detail = await withTimeout(
            getOperationalPurchaseOrderDetail(poParam),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          if (!detail) {
            throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
          }
          const full = await storage.getPurchaseOrderWithDetails(detail.id);
          if (!full) {
            throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
          }
          const actor =
            typeof req.user?.username === "string" && req.user.username.trim()
              ? req.user.username.trim()
              : typeof req.user?.email === "string" && req.user.email.trim()
                ? req.user.email.trim()
                : "user";
          const metadataLines = [`Exported by: ${actor}`];
          const reportingCurrencyCode = await getReportingCurrencyCode(storage);
          const organizationBranding = await getOrganizationDocumentBranding(getActiveOrganizationId(), { loadLogo: true });
          const poCodeRaw = full.currencyCode;
          const poCurrencyCode =
            typeof poCodeRaw === "string" && poCodeRaw.trim().length > 0 ? poCodeRaw.trim().toUpperCase() : null;
          const documentCurrencyCode = poCurrencyCode ?? reportingCurrencyCode;
          if (poCurrencyCode && poCurrencyCode !== reportingCurrencyCode) {
            metadataLines.push(
              `PO currency: ${poCurrencyCode} (amounts formatted in PO currency; org reporting currency is ${reportingCurrencyCode}).`,
            );
          }
          const buffer = await generatePurchaseOrdersDocumentPdf(
            [full],
            `Purchase order - ${full.orderNumber}`,
            metadataLines,
            {
              reportingCurrencyCode: documentCurrencyCode,
              organizationDisplayName: organizationBranding.displayName,
              organizationFooter: organizationBranding.reportFooter,
              organizationLogoPng: organizationBranding.logoBytes,
            },
          );
          const safeName = String(full.orderNumber).replace(/[^\w.-]+/g, "_");
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="PO-${safeName}-for-signature.pdf"`);
          res.send(buffer);
        } catch (error) {
          if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
            logOperationalError(req.path, Date.now() - start, error);
            setFallbackHeader(res, error);
            throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
          }
          mapPurchaseStatusError(error);
        }
      }),
    );

    app.get(
      base,
      withApiContract(async (req: Request, res: Response) => {
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          return respondOk(res, [], 200, { fallback: "degraded" });
        }
        try {
          const status = typeof req.query.status === "string" ? req.query.status : "";
          const supplier = typeof req.query.supplier === "string" ? req.query.supplier : "";
          const q = typeof req.query.q === "string" ? req.query.q : "";
          const orders = await withTimeout(
            listOperationalPurchaseOrders({ status, supplier, q }),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          respondOk(res, orders);
        } catch (err) {
          logOperationalError(req.path, Date.now() - start, err);
          setFallbackHeader(res, err);
          respondOk(res, [], 200, { fallback: getFallbackValue(err) });
        }
      }),
    );

    app.get(
      `${base}/:po`,
      withApiContract(async (req: Request, res: Response, next: NextFunction) => {
        if (delegateReservedOperationalPoSegment(req, next)) return;
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
        }
        try {
          const detail = await withTimeout(
            getOperationalPurchaseOrderDetail(req.params.po),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          if (!detail) {
            throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
          }
          respondOk(res, detail);
        } catch (error) {
          if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
            logOperationalError(req.path, Date.now() - start, error);
            setFallbackHeader(res, error);
            throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
          }
          mapPurchaseStatusError(error);
        }
      }),
    );

    app.post(
      `${base}/:po/status`,
      auth.ensureAuthenticated,
      withApiContract(async (req: Request, res: Response, next: NextFunction) => {
        if (delegateReservedOperationalPoSegment(req, next)) return;
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        const toStatus =
          typeof req.body?.toStatus === "string"
            ? req.body.toStatus
            : typeof req.body?.status === "string"
              ? req.body.status
              : "";
        try {
          const detail = await withTimeout(
            transitionOperationalPurchaseOrderStatus(
              req.params.po,
              toStatus,
              resolveActor(req),
            ),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          respondOk(res, detail);
        } catch (error) {
          if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
            logOperationalError(req.path, Date.now() - start, error);
            setFallbackHeader(res, error);
            throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
          }
          mapPurchaseStatusError(error);
        }
      }),
    );

    app.post(
      `${base}/:po/approve`,
      auth.ensureAuthenticated,
      withApiContract(async (req: Request, res: Response, next: NextFunction) => {
        if (delegateReservedOperationalPoSegment(req, next)) return;
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        if (process.env.NODE_ENV === "production") {
          throw contractError(
            409,
            "CONTROLLED_PO_APPROVAL_REQUIRED",
            "Use the controlled purchase-order submit and independent approval workflow.",
          );
        }
        requirePoWorkflowRole(req);
        try {
          const detail = await withTimeout(
            transitionOperationalPurchaseOrderStatus(
              req.params.po,
              "approved",
              resolveActor(req),
            ),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          respondOk(res, detail);
        } catch (error) {
          if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
            logOperationalError(req.path, Date.now() - start, error);
            setFallbackHeader(res, error);
            throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
          }
          mapPurchaseStatusError(error);
        }
      }),
    );

    app.post(
      `${base}/:po/send`,
      auth.ensureAuthenticated,
      withApiContract(async (req: Request, res: Response, next: NextFunction) => {
        if (delegateReservedOperationalPoSegment(req, next)) return;
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        if (process.env.NODE_ENV === "production") {
          throw contractError(
            409,
            "CONTROLLED_PO_DISPATCH_REQUIRED",
            "Use controlled purchase-order dispatch so provider delivery evidence is recorded.",
          );
        }
        requirePoWorkflowRole(req);
        try {
          const detail = await withTimeout(
            transitionOperationalPurchaseOrderStatus(
              req.params.po,
              "sent",
              resolveActor(req),
            ),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          await tryCreateOperationalShipmentOnSend(req.params.po, req.body);
          respondOk(res, detail);
        } catch (error) {
          if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
            logOperationalError(req.path, Date.now() - start, error);
            setFallbackHeader(res, error);
            throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
          }
          mapPurchaseStatusError(error);
        }
      }),
    );

    app.post(
      `${base}/:po/receive`,
      auth.ensureAuthenticated,
      withApiContract(async (req: Request, res: Response, next: NextFunction) => {
        if (delegateReservedOperationalPoSegment(req, next)) return;
        const start = Date.now();
        setEndpointHeader(res, req.path);
        if (isOperationsDegraded()) {
          res.setHeader("X-InvTrack-Fallback", "degraded");
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        requirePoReceiveRole(req);
        const bodyLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
        const lines = bodyLines.map(
          (line: {
            sku?: unknown;
            qty_received_now?: unknown;
            qtyReceivedNow?: unknown;
            batch_number?: unknown;
            batchNumber?: unknown;
            serial_numbers?: unknown;
            serialNumbers?: unknown;
          }) => {
            const serialInput = line.serial_numbers ?? line.serialNumbers;
            const normalizedSerials = Array.isArray(serialInput)
              ? (serialInput as unknown[])
                  .map((value) => String(value))
                  .filter((value) => value.trim().length > 0)
              : undefined;
            return {
              sku: typeof line.sku === "string" ? line.sku : "",
              qty_received_now: Number(line.qty_received_now ?? line.qtyReceivedNow),
              batch_number:
                typeof (line.batch_number ?? line.batchNumber) === "string"
                  ? String(line.batch_number ?? line.batchNumber)
                  : undefined,
              serial_numbers: normalizedSerials,
            };
          },
        );
        const receiveMeta = {
          receiver_user_id:
            req.body?.receiver_user_id != null || req.body?.receiverUserId != null
              ? Number(req.body?.receiver_user_id ?? req.body?.receiverUserId)
              : undefined,
          receiver_name:
            typeof (req.body?.receiver_name ?? req.body?.receiverName) === "string"
              ? String(req.body?.receiver_name ?? req.body?.receiverName)
              : undefined,
          warehouse_location:
            typeof (req.body?.warehouse_location ?? req.body?.warehouseLocation) === "string"
              ? String(req.body?.warehouse_location ?? req.body?.warehouseLocation)
              : undefined,
          warehouse_id: (() => {
            const raw = req.body?.warehouse_id ?? req.body?.warehouseId;
            if (raw == null || raw === "") return undefined;
            const n = Number(raw);
            return Number.isFinite(n) ? n : undefined;
          })(),
          aisle: typeof req.body?.aisle === "string" ? String(req.body.aisle).trim() : undefined,
          bin_code:
            typeof (req.body?.bin_code ?? req.body?.binCode) === "string"
              ? String(req.body?.bin_code ?? req.body?.binCode).trim()
              : undefined,
          received_at:
            typeof (req.body?.received_at ?? req.body?.receivedAt) === "string"
              ? new Date(String(req.body?.received_at ?? req.body?.receivedAt))
              : undefined,
          shipment_id: (() => {
            const raw = req.body?.shipment_id ?? req.body?.shipmentId;
            if (raw == null || raw === "") return undefined;
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : undefined;
          })(),
          grn_number:
            typeof (req.body?.grn_number ?? req.body?.grnNumber) === "string"
              ? String(req.body?.grn_number ?? req.body?.grnNumber).trim()
              : undefined,
        };

        try {
          const result = await withTimeout(
            receiveOperationalPurchaseOrder(
              req.params.po,
              lines,
              receiveMeta,
              resolveActor(req),
            ),
            OPERATIONS_QUERY_TIMEOUT_MS,
          );
          respondOk(res, {
            ...result,
            changed: {
              inventoryChanges: result.inventoryChanges.length,
              shipmentUpdates: result.shipmentUpdates.length,
              mismatchExceptions: result.mismatchExceptions.length,
            },
          });
        } catch (error) {
          if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
            logOperationalError(req.path, Date.now() - start, error);
            setFallbackHeader(res, error);
            throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
          }
          mapPurchaseReceiveError(error);
        }
      }),
    );
  }

  app.get(
    "/api/logistics/shipments/:id/delivery-note.pdf",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ message: "Invalid shipment id" });
        }
        const r = await pool.query<{
          id: number;
          po_number: string;
          carrier: string | null;
          status: string;
          eta: Date | null;
          tracking_number: string | null;
        }>(
          `SELECT id, po_number, carrier, status, eta, tracking_number FROM shipments s
           WHERE s.id = $1
             AND COALESCE(s.organization_id, (SELECT po.organization_id FROM purchase_orders po WHERE po.order_number = s.po_number AND po.organization_id = $2 LIMIT 1)) = $2
           LIMIT 1`,
          [id, getActiveOrganizationId()],
        );
        const row = r.rows[0];
        if (!row) {
          return res.status(404).json({ message: "Shipment not found" });
        }
        const organizationBranding = await getOrganizationDocumentBranding(getActiveOrganizationId(), { loadLogo: true });
        const buffer = await generateShipmentDeliveryNotePdf({
          id: row.id,
          poNumber: row.po_number,
          carrier: row.carrier,
          status: String(row.status).toLowerCase(),
          eta: row.eta,
          trackingNumber: row.tracking_number,
        }, {
          organizationDisplayName: organizationBranding.displayName,
          organizationFooter: organizationBranding.reportFooter,
          organizationLogoPng: organizationBranding.logoBytes,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="delivery-note-${row.id}.pdf"`,
        );
        return res.send(buffer);
      } catch (error) {
        console.error("delivery-note pdf:", error);
        return res.status(500).json({ message: "Failed to generate delivery note PDF" });
      }
    },
  );

  app.get(
    "/api/v2/logistics/shipments",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const parsed = shipmentPageQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw contractError(400, "INVALID_QUERY", "Invalid shipment pagination, filter, or sort value.", undefined, parsed.error.flatten());
      }
      assertValidLogisticsDateQuery(parsed.data.etaFrom ?? "", "etaFrom");
      assertValidLogisticsDateQuery(parsed.data.etaTo ?? "", "etaTo");
      const result = await withTimeout(
        listOperationalShipmentsPage(parsed.data),
        OPERATIONS_QUERY_TIMEOUT_MS,
      );
      return respondOk(res, result);
    }),
  );

  app.get(
    "/api/logistics/shipments",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
      }
      try {
        const supplierRaw = typeof req.query.supplier === "string" ? req.query.supplier : "";
        const statusRaw = typeof req.query.status === "string" ? req.query.status : "";
        const poRaw = typeof req.query.po === "string" ? req.query.po : "";
        const carrierRaw = typeof req.query.carrier === "string" ? req.query.carrier : "";
        const riskRaw = typeof req.query.risk === "string" ? req.query.risk : "";
        const etaFromRaw = typeof req.query.etaFrom === "string" ? req.query.etaFrom : "";
        const etaToRaw = typeof req.query.etaTo === "string" ? req.query.etaTo : "";
        const trackingRaw = typeof req.query.tracking === "string" ? req.query.tracking : "";
        const directionRaw = typeof req.query.direction === "string" ? req.query.direction : "";
        const sourceTypeRaw =
          typeof req.query.sourceType === "string"
            ? req.query.sourceType
            : typeof req.query.source_type === "string"
              ? req.query.source_type
              : "";
        assertValidLogisticsDateQuery(etaFromRaw, "etaFrom");
        assertValidLogisticsDateQuery(etaToRaw, "etaTo");
        const appliedFilters = normalizeShipmentFilters({
          status: statusRaw,
          po: poRaw,
          supplier: supplierRaw,
          carrier: carrierRaw,
          risk: riskRaw,
          etaFrom: etaFromRaw,
          etaTo: etaToRaw,
          tracking: trackingRaw,
          direction: directionRaw,
          sourceType: sourceTypeRaw,
        });
        const shipments = await withTimeout(
          listOperationalShipments(appliedFilters),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        const queryMs = Date.now() - start;
        const generatedAt = new Date().toISOString();
        respondOk(res, shipments, 200, {
          appliedFilters,
          resultCount: shipments.length,
          queryMs,
          generatedAt,
        });
      } catch (err) {
        if (err instanceof ApiContractError) {
          throw err;
        }
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.post(
    "/api/logistics/shipments",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "update"),
    withApiContract(async (req: Request, res: Response) => {
      const body = req.body ?? {};
      const poNumber = typeof body.poNumber === "string" ? body.poNumber.trim() : "";
      if (!poNumber) {
        throw contractError(400, "PO_REQUIRED", "poNumber is required");
      }
      const carrier =
        typeof body.carrier === "string" && body.carrier.trim() ? body.carrier.trim() : null;
      const carrierIdRaw = body.carrierId ?? body.carrier_id;
      const carrierId =
        carrierIdRaw != null && Number.isFinite(Number(carrierIdRaw)) ? Number(carrierIdRaw) : null;
      const eta = typeof body.eta === "string" && body.eta.trim() ? new Date(body.eta) : null;
      const trackingNumber =
        typeof body.trackingNumber === "string"
          ? body.trackingNumber.trim() || null
          : typeof body.tracking_number === "string"
            ? body.tracking_number.trim() || null
            : null;
      const transportMode =
        typeof body.transportMode === "string"
          ? body.transportMode.trim()
          : typeof body.transport_mode === "string"
            ? body.transport_mode.trim()
            : null;
      const freightCostRaw = body.freightCost ?? body.freight_cost;
      const freightCost =
        freightCostRaw != null && Number.isFinite(Number(freightCostRaw)) ? Number(freightCostRaw) : null;
      const deliveryNoteRef =
        typeof body.deliveryNoteRef === "string"
          ? body.deliveryNoteRef.trim()
          : typeof body.delivery_note_ref === "string"
            ? body.delivery_note_ref.trim()
            : null;
      const vehicle = typeof body.vehicle === "string" ? body.vehicle.trim() : null;
      const driver = typeof body.driver === "string" ? body.driver.trim() : null;
      const direction = assertValidShipmentDirectionInput(
        typeof body.direction === "string" ? body.direction : null,
      );
      const sourceType = assertValidShipmentSourceTypeInput(
        typeof body.sourceType === "string"
          ? body.sourceType
          : typeof body.source_type === "string"
            ? body.source_type
            : null,
      );

      try {
        const row = await createOperationalShipment({
          poNumber,
          mode: "logistics_page",
          carrier,
          carrierId: carrierId && carrierId > 0 ? carrierId : null,
          transportMode,
          freightCost,
          trackingNumber,
          deliveryNoteRef,
          vehicle,
          driver,
          eta,
          direction,
          sourceType,
        });
        respondOk(
          res,
          {
            id: row.id,
            poNumber: row.poNumber,
            carrier: row.carrier,
            status: row.status,
            eta: row.eta,
            driftMinutes: row.driftMinutes,
            trackingNumber: row.trackingNumber,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            atRisk: row.atRisk,
            riskBucket: row.riskBucket,
            direction: row.direction,
            sourceType: row.sourceType,
            freightCost: row.freightCost,
          },
          201,
        );
      } catch (err) {
        mapShipmentError(err);
      }
    }),
  );

  app.patch(
    "/api/logistics/shipments/:id",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "update"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      try {
        const body = req.body ?? {};
        const carrier =
          typeof body.carrier === "string" ? body.carrier.trim() || null : undefined;
        const eta =
          typeof body.eta === "string" && body.eta.trim()
            ? new Date(body.eta)
            : body.eta === null
              ? null
              : undefined;
        const trackingNumber =
          typeof body.trackingNumber === "string"
            ? body.trackingNumber.trim() || null
            : typeof body.tracking_number === "string"
              ? body.tracking_number.trim() || null
              : undefined;

        let carrierId: number | null | undefined = undefined;
        if (body.carrierId !== undefined || body.carrier_id !== undefined) {
          const raw = body.carrierId ?? body.carrier_id;
          if (raw === null) carrierId = null;
          else {
            const n = Number(raw);
            if (!Number.isFinite(n) || n <= 0) {
              throw contractError(400, "INVALID_CARRIER_ID", "carrierId must be a positive number or null");
            }
            carrierId = n;
          }
        }

        const transportMode =
          typeof body.transportMode === "string"
            ? body.transportMode.trim() || null
            : typeof body.transport_mode === "string"
              ? body.transport_mode.trim() || null
              : undefined;
        let freightCost: number | null | undefined = undefined;
        if (body.freightCost !== undefined || body.freight_cost !== undefined) {
          const raw = body.freightCost ?? body.freight_cost;
          if (raw === null) freightCost = null;
          else {
            const n = Number(raw);
            freightCost = Number.isFinite(n) ? n : null;
          }
        }
        const vehicle =
          typeof body.vehicle === "string" ? body.vehicle.trim() || null : undefined;
        const driver = typeof body.driver === "string" ? body.driver.trim() || null : undefined;
        const deliveryNoteRef =
          typeof body.deliveryNoteRef === "string"
            ? body.deliveryNoteRef.trim() || null
            : typeof body.delivery_note_ref === "string"
              ? body.delivery_note_ref.trim() || null
              : undefined;
        const grnNumber =
          typeof body.grnNumber === "string"
            ? body.grnNumber.trim() || null
            : typeof body.grn_number === "string"
              ? body.grn_number.trim() || null
              : undefined;

        const detail = await withTimeout(
          patchOperationalShipmentMeta({
            shipmentId: req.params.id,
            carrier,
            carrierId,
            eta,
            trackingNumber,
            transportMode,
            freightCost,
            vehicle,
            driver,
            deliveryNoteRef,
            grnNumber,
            actor: resolveActor(req),
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        mapShipmentError(error);
      }
    }),
  );

  app.get(
    "/api/logistics/shipments/:id",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(404, "SHIPMENT_NOT_FOUND", "Shipment not found");
      }
      try {
        const detail = await withTimeout(
          getOperationalShipmentDetail(req.params.id),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(404, "SHIPMENT_NOT_FOUND", "Shipment not found");
        }
        mapShipmentError(error);
      }
    }),
  );

  app.post(
    "/api/logistics/shipments/:id/status",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "update"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
      const note = typeof req.body?.note === "string" ? req.body.note : "";

      try {
        const detail = await withTimeout(
          updateOperationalShipmentStatus({
            shipmentId: req.params.id,
            toStatus,
            note,
            actor: resolveActor(req),
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        mapShipmentError(error);
      }
    }),
  );

  app.delete(
    "/api/logistics/shipments/:id",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "delete"),
    withApiContract(async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        throw contractError(400, "INVALID_ID", "shipment id is invalid");
      }
      const deleted = await pool.query(`DELETE FROM shipments s WHERE s.id = $1 AND COALESCE(s.organization_id, (SELECT po.organization_id FROM purchase_orders po WHERE po.order_number = s.po_number AND po.organization_id = $2 LIMIT 1)) = $2 RETURNING id`, [id, getActiveOrganizationId()]);
      if (!deleted.rows[0]) {
        throw contractError(404, "SHIPMENT_NOT_FOUND", "Shipment not found");
      }
      respondOk(res, { id });
    }),
  );

  app.get(
    "/api/v2/exceptions",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const parsed = exceptionPageQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw contractError(400, "INVALID_QUERY", "Invalid exception pagination, filter, or sort value.", undefined, parsed.error.flatten());
      }
      const result = await withTimeout(listOperationalExceptionsPage(parsed.data), OPERATIONS_QUERY_TIMEOUT_MS);
      return respondOk(res, result);
    }),
  );

  app.get(
    "/api/exceptions",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
      }
      try {
        const severity = typeof req.query.severity === "string" ? req.query.severity : "";
        const status = typeof req.query.status === "string" ? req.query.status : "";
        const type = typeof req.query.type === "string" ? req.query.type : "";
        const exceptions = await withTimeout(
          listOperationalExceptions({ severity, status, type }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, exceptions);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.post(
    "/api/exceptions/run-checks",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "execute"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      try {
        const result = await withTimeout(
          runOperationalExceptionChecks(resolveActor(req)),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, result);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        throw error;
      }
    }),
  );

  app.get(
    "/api/exceptions/:id",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
      }
      try {
        const detail = await withTimeout(
          getOperationalExceptionDetail(req.params.id),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
        }
        mapExceptionLookupError(error);
      }
    }),
  );

  app.post(
    "/api/exceptions/:id/status",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "update"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      try {
        const current = await withTimeout(
          getOperationalExceptionDetail(req.params.id),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        const validated = validateExceptionStatusTransition({
          currentStatus: current.status,
          toStatus,
          note,
        });
        if (
          validated.toStatus !== validated.currentStatus &&
          !validated.allowedTargets.includes(validated.toStatus)
        ) {
          throw contractError(
            400,
            "INVALID_TRANSITION",
            "Invalid exception status transition",
            "Use one of the allowed targets.",
            {
              currentStatus: validated.currentStatus,
              requestedStatus: validated.toStatus,
              allowedTargets: validated.allowedTargets,
            },
          );
        }

        const detail = await withTimeout(
          transitionOperationalExceptionStatus(
            req.params.id,
            validated.toStatus,
            validated.note,
            resolveActor(req),
          ),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        mapExceptionMutationError(error);
      }
    }),
  );

  app.post(
    "/api/exceptions/:id/assign",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "update"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      try {
        const assignee = typeof req.body?.assignee === "string" ? req.body.assignee : "";
        const detail = await withTimeout(
          assignOperationalException(req.params.id, assignee, resolveActor(req)),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        mapExceptionMutationError(error);
      }
    }),
  );

  app.post(
    "/api/exceptions/:id/comment",
    auth.ensureAuthenticated,
    auth.ensurePermission("inventory", "update"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      try {
        const comment = typeof req.body?.comment === "string" ? req.body.comment : "";
        const author = req.user?.username || req.user?.email || "system";
        const detail = await withTimeout(
          addOperationalExceptionComment({
            idOrRef: req.params.id,
            author,
            comment,
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, detail);
      } catch (error) {
        if (toErrorMessage(error) === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        mapExceptionMutationError(error);
      }
    }),
  );

  app.get(
    "/api/v2/activity",
    auth.ensureAuthenticated,
    auth.ensurePermission("activity_logs", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);

      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      const pageSize = req.query.pageSize === undefined ? 25 : Number(req.query.pageSize);
      if (!Number.isInteger(page) || page < 1) {
        throw contractError(400, "INVALID_PAGE", "page must be a positive integer.");
      }
      if (![25, 50, 100].includes(pageSize)) {
        throw contractError(400, "INVALID_PAGE_SIZE", "pageSize must be one of 25, 50, or 100.");
      }

      const parseDate = (value: unknown, name: string, endOfDay = false): Date | undefined => {
        if (typeof value !== "string" || value.trim() === "") return undefined;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw contractError(400, "INVALID_DATE", `${name} must be a valid date.`);
        }
        if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          parsed.setUTCHours(23, 59, 59, 999);
        }
        return parsed;
      };

      const emptyPage = { items: [], total: 0, page, pageSize, hasNext: false };
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, emptyPage, 200, { fallback: "degraded" });
      }

      try {
        const result = await withTimeout(
          listOperationalActivityPage({
            page,
            pageSize,
            entityType: typeof req.query.entity_type === "string" ? req.query.entity_type : "",
            entityId: typeof req.query.entity_id === "string" ? req.query.entity_id : "",
            actor: typeof req.query.actor === "string" ? req.query.actor : "",
            action: typeof req.query.action === "string" ? req.query.action : "",
            from: parseDate(req.query.from, "from"),
            to: parseDate(req.query.to, "to", true),
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, result);
      } catch (err) {
        if (err instanceof ApiContractError) throw err;
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, emptyPage, 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.get(
    "/api/activity",
    auth.ensureAuthenticated,
    auth.ensurePermission("activity_logs", "read"),
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
      }
      try {
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
        const entityType = typeof req.query.entity_type === "string" ? req.query.entity_type : "";
        const entityId = typeof req.query.entity_id === "string" ? req.query.entity_id : "";
        const action = typeof req.query.action === "string" ? req.query.action : "";
        const actor = typeof req.query.actor === "string" ? req.query.actor.trim().toLowerCase() : "";
        const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
        const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
        const records = await withTimeout(
          listOperationalActivity({
            limit,
            entityType,
            entityId,
            action,
            actor,
            from: from && !Number.isNaN(from.getTime()) ? from : undefined,
            to: to && !Number.isNaN(to.getTime()) ? to : undefined,
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, records);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.get(
    "/api/integrations/runs",
    auth.ensureAuthenticated,
    auth.ensurePermission("settings", "configure"),
    withApiContract(async (req: Request, res: Response) => {
      setEndpointHeader(res, req.path);
      res.setHeader("X-InvTrack-Fallback", "disabled_by_configuration");
      respondOk(res, [], 200, { fallback: "disabled_by_configuration" });
    }),
  );

  app.post(
    "/api/integrations/:connector/run",
    auth.ensureAuthenticated,
    auth.ensurePermission("settings", "configure"),
    withApiContract(async (req: Request, res: Response) => {
      setEndpointHeader(res, req.path);
      throw contractError(
        501,
        "INTEGRATION_CONNECTOR_NOT_CONFIGURED",
        "No executable integration connector is configured.",
        "Configure a tenant-scoped connector adapter before starting a synchronization run.",
      );
    }),
  );

  app.get(
    "/api/control-tower/overview",
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(
          503,
          "CONTROL_TOWER_UNAVAILABLE",
          "Control Tower overview is temporarily unavailable.",
          "Check System Diagnostics and operational data sources before retrying.",
          { fallback: "degraded" },
        );
      }
      try {
        const overview = await withTimeout(
          getOperationalControlTowerOverview(),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, overview);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        throw contractError(
          503,
          "CONTROL_TOWER_UNAVAILABLE",
          "Control Tower overview is temporarily unavailable.",
          "Check System Diagnostics and operational data sources before retrying.",
          { fallback: getFallbackValue(err) },
        );
      }
    }),
  );

  app.get(
    "/api/dashboard/control-tower",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      const orgId =
        typeof res.locals.organizationId === "number" && Number.isFinite(res.locals.organizationId)
          ? res.locals.organizationId
          : 1;
      const daysRaw = Number(req.query.days);
      const trendDays = [7, 30, 90].includes(daysRaw) ? daysRaw : 7;
      const businessArea =
        typeof req.query.area === "string" && req.query.area.trim()
          ? req.query.area.trim().toLowerCase()
          : "all";

      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(
          503,
          "CONTROL_TOWER_UNAVAILABLE",
          "Control Tower dashboard is temporarily unavailable.",
          "Check System Diagnostics and operational data sources before retrying.",
          {
            fallback: "degraded",
            organizationId: orgId,
            trendDays,
            businessArea,
          },
        );
      }

      try {
        const data = await withTimeout(
          getControlTowerDashboard(orgId, { trendDays, businessArea }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, { ...data, meta: { ...data.meta, queryMs: Date.now() - start } });
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        throw contractError(
          503,
          "CONTROL_TOWER_UNAVAILABLE",
          "Control Tower dashboard is temporarily unavailable.",
          "Check System Diagnostics and operational data sources before retrying.",
          {
            fallback: getFallbackValue(err),
            organizationId: orgId,
            trendDays,
            businessArea,
          },
        );
      }
    }),
  );

  app.get(
    "/api/tutorial/status",
    auth.ensureAuthenticated,
    withApiContract(async (_req: Request, res: Response) => {
      setEndpointHeader(res, "/api/tutorial/status");
      const degraded = isOperationsDegraded();
      const dbOk = readiness.dbReady && readiness.schemaReady;
      const systemStatus = degraded ? "degraded" : dbOk ? "ok" : "degraded";
      respondOk(res, {
        systemStatus,
        demoReady: true,
      });
    }),
  );

  app.post(
    "/api/tutorial/start",
    auth.ensureAuthenticated,
    withApiContract(async (_req: Request, res: Response) => {
      setEndpointHeader(res, "/api/tutorial/start");
      const degraded = isOperationsDegraded();
      const dbOk = readiness.dbReady && readiness.schemaReady;
      const systemStatus = degraded ? "degraded" : dbOk ? "ok" : "degraded";

      const plan: {
        suggestedSku?: string;
        exceptionId?: number;
        poNumber?: string;
        shipmentId?: number;
      } = {};

      if (!degraded && dbOk) {
        try {
          await seedDatabaseIfEmpty();
          const opSeed = await seedOperationalIfEmpty();
          const inventory = await listOperationalInventory({});
          const firstSku = inventory[0]?.sku;
          if (firstSku) plan.suggestedSku = firstSku;
          const exceptions = await listOperationalExceptions({});
          const firstEx = exceptions[0];
          if (firstEx?.id) plan.exceptionId = firstEx.id;
          const orders = await listOperationalPurchaseOrders({});
          const firstPo = orders[0];
          if (firstPo?.poNumber) plan.poNumber = firstPo.poNumber;
          const shipments = await listOperationalShipments({});
          const firstShip = shipments[0];
          if (firstShip?.id) plan.shipmentId = firstShip.id;
        } catch {
          // still return status so client can show degraded and run tour
        }
      }

      respondOk(res, { systemStatus, plan });
    }),
  );

  app.post(
    ["/api/operations/demo-walkthrough", "/api/demo/walkthrough/run"],
    auth.ensureAuthenticated,
    auth.ensureAdmin,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (!isDemoWalkthroughEnabled()) {
        throw contractError(404, "DEMO_WALKTHROUGH_DISABLED", "Demo walkthrough mutations are not enabled for this deployment.");
      }
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      const actor = req.user?.username || req.user?.email || "demo-user";
      try {
        const result = await withTimeout(
          runOperationalDemoWalkthrough(actor, String(res.locals.requestId ?? "unknown-request-id")),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, result);
      } catch (error) {
        const message = toErrorMessage(error);
        if (message === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(
            503,
            "DEMO_WALKTHROUGH_TIMEOUT",
            "Demo walkthrough timed out. Check database and try again.",
          );
        }
        if (message === "inventory_empty") {
          throw contractError(400, "INVENTORY_EMPTY", "Cannot run walkthrough: no inventory");
        }
        if (message === "supplier_not_found") {
          throw contractError(400, "SUPPLIER_NOT_FOUND", "Cannot run walkthrough: no suppliers");
        }
        if (message === "item_not_found") {
          throw contractError(400, "ITEM_NOT_FOUND", "Cannot run walkthrough: item lookup failed");
        }
        throw error;
      }
    }),
  );
}
