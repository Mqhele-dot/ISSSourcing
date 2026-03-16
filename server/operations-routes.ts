import type { Express, NextFunction, Request, Response } from "express";
import {
  addOperationalExceptionComment,
  adjustOperationalInventory,
  assignOperationalException,
  getOperationalControlTowerOverview,
  getOperationalExceptionDetail,
  getOperationalInventoryDetail,
  getOperationalPurchaseOrderDetail,
  getOperationalShipmentDetail,
  listOperationalActivity,
  listOperationalExceptions,
  listOperationalIntegrationRuns,
  listOperationalInventory,
  listOperationalPurchaseOrders,
  listOperationalShipments,
  runOperationalExceptionChecks,
  receiveOperationalPurchaseOrder,
  runOperationalConnector,
  runOperationalDemoWalkthrough,
  transitionOperationalExceptionStatus,
  transitionOperationalPurchaseOrderStatus,
  updateOperationalShipmentStatus,
} from "./operations-core";
import { contractError, respondOk, withApiContract } from "./api-contract";
import { pool } from "./db";
import { readiness } from "./readiness";
import { seedOperationalIfEmpty } from "./seed-operational";
import { seedDatabaseIfEmpty } from "./seed";

type AuthGuards = {
  ensureAuthenticated: (req: Request, res: Response, next: NextFunction) => void;
};

const INVENTORY_ROUTE_RESERVED_SEGMENTS = new Set([
  "low-stock",
  "out-of-stock",
  "stats",
  "bulk-import",
  "find-by-barcode",
]);

const EXCEPTION_STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed", "open"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

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

function resolveActor(req: Request): string {
  return req.user?.username || req.user?.email || "system";
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
  if (message === "location_required") {
    throw contractError(
      400,
      "LOCATION_REQUIRED",
      "location is required",
      "Choose a location before submitting the adjustment.",
    );
  }
  if (message === "sku_not_found") {
    throw contractError(404, "SKU_NOT_FOUND", "sku not found");
  }
  if (message === "location_not_found") {
    throw contractError(
      400,
      "LOCATION_NOT_FOUND",
      "location not found",
      "Use an existing warehouse/location identifier.",
    );
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
  throw error;
}

function mapShipmentError(error: unknown): never {
  const message = toErrorMessage(error);
  if (message === "shipment_not_found") {
    throw contractError(404, "SHIPMENT_NOT_FOUND", "Shipment not found");
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
  app.get(
    "/api/inventory",
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
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
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
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
      const location = typeof req.body?.location === "string" ? req.body.location : "";
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
            location,
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
    withApiContract(async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      const sku = req.params.sku;
      if (INVENTORY_ROUTE_RESERVED_SEGMENTS.has(sku)) {
        next();
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

  app.get(
    "/api/purchase/orders",
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
    "/api/purchase/orders/:po",
    withApiContract(async (req: Request, res: Response) => {
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
    "/api/purchase/orders/:po/status",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
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
    "/api/purchase/orders/:po/approve",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
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
    "/api/purchase/orders/:po/send",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      try {
        const detail = await withTimeout(
          transitionOperationalPurchaseOrderStatus(
            req.params.po,
            "sent",
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
    "/api/purchase/orders/:po/receive",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
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
        received_at:
          typeof (req.body?.received_at ?? req.body?.receivedAt) === "string"
            ? new Date(String(req.body?.received_at ?? req.body?.receivedAt))
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

  app.get(
    "/api/logistics/shipments",
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
      }
      try {
        const status = typeof req.query.status === "string" ? req.query.status : "";
        const po = typeof req.query.po === "string" ? req.query.po : "";
        const carrier = typeof req.query.carrier === "string" ? req.query.carrier : "";
        const risk = typeof req.query.risk === "string" ? req.query.risk : "";
        const shipments = await withTimeout(
          listOperationalShipments({ status, po, carrier, risk }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, shipments);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.post(
    "/api/logistics/shipments",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const poNumber = typeof req.body?.poNumber === "string" ? req.body.poNumber.trim() : "";
      const carrier = typeof req.body?.carrier === "string" ? req.body.carrier.trim() : null;
      const eta = typeof req.body?.eta === "string" ? new Date(req.body.eta) : null;
      if (!poNumber) {
        throw contractError(400, "PO_REQUIRED", "poNumber is required");
      }
      const inserted = await pool.query(
        `INSERT INTO shipments (po_number, carrier, status, eta, drift_minutes, created_at, updated_at)
         VALUES ($1, $2, 'created', $3, 0, now(), now())
         RETURNING id, po_number AS "poNumber", carrier, status, eta, drift_minutes AS "driftMinutes", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [poNumber, carrier, eta],
      );
      respondOk(res, inserted.rows[0], 201);
    }),
  );

  app.get(
    "/api/logistics/shipments/:id",
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
    withApiContract(async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        throw contractError(400, "INVALID_ID", "shipment id is invalid");
      }
      const deleted = await pool.query(`DELETE FROM shipments WHERE id = $1 RETURNING id`, [id]);
      if (!deleted.rows[0]) {
        throw contractError(404, "SHIPMENT_NOT_FOUND", "Shipment not found");
      }
      respondOk(res, { id });
    }),
  );

  app.get(
    "/api/exceptions",
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
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
      try {
        const current = await withTimeout(
          getOperationalExceptionDetail(req.params.id),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        const currentStatus = current.status.toLowerCase();
        const normalizedTarget = toStatus.trim().toLowerCase();
        const allowedTargets = EXCEPTION_STATUS_TRANSITIONS[currentStatus] ?? [];

        if (!normalizedTarget) {
          throw contractError(400, "INVALID_TARGET_STATUS", "toStatus is required");
        }
        if (
          normalizedTarget !== currentStatus &&
          !allowedTargets.includes(normalizedTarget)
        ) {
          throw contractError(
            400,
            "INVALID_TRANSITION",
            "Invalid exception status transition",
            "Use one of the allowed targets.",
            {
              currentStatus,
              requestedStatus: normalizedTarget,
              allowedTargets,
            },
          );
        }

        const detail = await withTimeout(
          transitionOperationalExceptionStatus(
            req.params.id,
            normalizedTarget,
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
    "/api/activity",
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
      }
      try {
        const limitRaw = Number(req.query.limit);
        const entityType = typeof req.query.entity_type === "string" ? req.query.entity_type : "";
        const entityId = typeof req.query.entity_id === "string" ? req.query.entity_id : "";
        const actor = typeof req.query.actor === "string" ? req.query.actor.trim().toLowerCase() : "";
        const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
        const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
        const records = await withTimeout(
          listOperationalActivity({
            limit: Number.isFinite(limitRaw) ? limitRaw : 20,
            entityType,
            entityId,
          }),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        const filtered = records.filter((record) => {
          if (actor && !String(record.actor ?? "").toLowerCase().includes(actor)) return false;
          const createdAt = record.createdAt ? new Date(record.createdAt) : null;
          if (from && createdAt && createdAt < from) return false;
          if (to && createdAt && createdAt > to) return false;
          return true;
        });
        respondOk(res, filtered);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.get(
    "/api/integrations/runs",
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, [], 200, { fallback: "degraded" });
      }
      try {
        const runs = await withTimeout(
          listOperationalIntegrationRuns(20),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, runs);
      } catch (err) {
        logOperationalError(req.path, Date.now() - start, err);
        setFallbackHeader(res, err);
        respondOk(res, [], 200, { fallback: getFallbackValue(err) });
      }
    }),
  );

  app.post(
    "/api/integrations/:connector/run",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      try {
        const run = await withTimeout(
          runOperationalConnector(req.params.connector),
          OPERATIONS_QUERY_TIMEOUT_MS,
        );
        respondOk(res, run, 201);
      } catch (error) {
        const message = toErrorMessage(error);
        if (message === "OPERATIONS_QUERY_TIMEOUT") {
          logOperationalError(req.path, Date.now() - start, error);
          setFallbackHeader(res, error);
          throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
        }
        if (message === "unsupported_connector") {
          throw contractError(
            400,
            "UNSUPPORTED_CONNECTOR",
            "Unsupported connector",
            "Supported connectors: erp, wms, tms",
          );
        }
        throw error;
      }
    }),
  );

  app.get(
    "/api/control-tower/overview",
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      const stubOverview = {
        kpis: {
          exceptionsBySeverity: {} as Record<string, number>,
          lateShipments: 0,
          posAwaitingAction: 0,
          lowStockSkus: 0,
        },
        activity: [] as Array<{ id: string; eventType: string; title: string; details: string | null; relatedRefs: Record<string, unknown>; createdAt: string }>,
      };
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        return respondOk(res, stubOverview, 200, { fallback: "degraded" });
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
        respondOk(res, stubOverview, 200, { fallback: getFallbackValue(err) });
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
    "/api/demo/walkthrough/run",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const start = Date.now();
      setEndpointHeader(res, req.path);
      if (isOperationsDegraded()) {
        res.setHeader("X-InvTrack-Fallback", "degraded");
        throw contractError(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
      }
      const actor = req.user?.username || req.user?.email || "demo-user";
      try {
        const result = await withTimeout(
          runOperationalDemoWalkthrough(actor),
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
