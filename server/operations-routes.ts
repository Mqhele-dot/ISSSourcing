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
  receiveOperationalPurchaseOrder,
  runOperationalConnector,
  runOperationalDemoWalkthrough,
  transitionOperationalExceptionStatus,
  transitionOperationalPurchaseOrderStatus,
  updateOperationalShipmentStatus,
} from "./operations-core";
import { contractError, respondOk, withApiContract } from "./api-contract";

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error";
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
      const items = await listOperationalInventory({ q, location, category, low });
      respondOk(res, items);
    }),
  );

  app.post(
    "/api/inventory/:sku/adjust",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
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
        const result = await adjustOperationalInventory({
          skuOrId: sku,
          location,
          delta,
          reason,
          ref,
          createdBy,
        });
        respondOk(res, result);
      } catch (error) {
        mapAdjustInventoryError(error);
      }
    }),
  );

  app.get(
    "/api/inventory/:sku",
    withApiContract(async (req: Request, res: Response, next: NextFunction) => {
      const sku = req.params.sku;
      if (INVENTORY_ROUTE_RESERVED_SEGMENTS.has(sku)) {
        next();
        return;
      }

      const detail = await getOperationalInventoryDetail(sku);
      if (!detail) {
        throw contractError(404, "INVENTORY_NOT_FOUND", "Inventory item not found");
      }

      respondOk(res, detail);
    }),
  );

  app.get(
    "/api/purchase/orders",
    withApiContract(async (req: Request, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const supplier = typeof req.query.supplier === "string" ? req.query.supplier : "";
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const orders = await listOperationalPurchaseOrders({ status, supplier, q });
      respondOk(res, orders);
    }),
  );

  app.get(
    "/api/purchase/orders/:po",
    withApiContract(async (req: Request, res: Response) => {
      try {
        const detail = await getOperationalPurchaseOrderDetail(req.params.po);
        if (!detail) {
          throw contractError(404, "PO_NOT_FOUND", "Purchase order not found");
        }
        respondOk(res, detail);
      } catch (error) {
        mapPurchaseStatusError(error);
      }
    }),
  );

  app.post(
    "/api/purchase/orders/:po/status",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const toStatus =
        typeof req.body?.toStatus === "string"
          ? req.body.toStatus
          : typeof req.body?.status === "string"
            ? req.body.status
            : "";
      try {
        const detail = await transitionOperationalPurchaseOrderStatus(
          req.params.po,
          toStatus,
          resolveActor(req),
        );
        respondOk(res, detail);
      } catch (error) {
        mapPurchaseStatusError(error);
      }
    }),
  );

  app.post(
    "/api/purchase/orders/:po/approve",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      try {
        const detail = await transitionOperationalPurchaseOrderStatus(
          req.params.po,
          "approved",
          resolveActor(req),
        );
        respondOk(res, detail);
      } catch (error) {
        mapPurchaseStatusError(error);
      }
    }),
  );

  app.post(
    "/api/purchase/orders/:po/send",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      try {
        const detail = await transitionOperationalPurchaseOrderStatus(
          req.params.po,
          "sent",
          resolveActor(req),
        );
        respondOk(res, detail);
      } catch (error) {
        mapPurchaseStatusError(error);
      }
    }),
  );

  app.post(
    "/api/purchase/orders/:po/receive",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const bodyLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const lines = bodyLines.map(
        (line: { sku?: unknown; qty_received_now?: unknown; qtyReceivedNow?: unknown }) => ({
          sku: typeof line.sku === "string" ? line.sku : "",
          qty_received_now: Number(line.qty_received_now ?? line.qtyReceivedNow),
        }),
      );

      try {
        const result = await receiveOperationalPurchaseOrder(
          req.params.po,
          lines,
          resolveActor(req),
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
        mapPurchaseReceiveError(error);
      }
    }),
  );

  app.get(
    "/api/logistics/shipments",
    withApiContract(async (req: Request, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const po = typeof req.query.po === "string" ? req.query.po : "";
      const carrier = typeof req.query.carrier === "string" ? req.query.carrier : "";
      const risk = typeof req.query.risk === "string" ? req.query.risk : "";
      const shipments = await listOperationalShipments({ status, po, carrier, risk });
      respondOk(res, shipments);
    }),
  );

  app.get(
    "/api/logistics/shipments/:id",
    withApiContract(async (req: Request, res: Response) => {
      try {
        const detail = await getOperationalShipmentDetail(req.params.id);
        respondOk(res, detail);
      } catch (error) {
        mapShipmentError(error);
      }
    }),
  );

  app.post(
    "/api/logistics/shipments/:id/status",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
      const note = typeof req.body?.note === "string" ? req.body.note : "";

      try {
        const detail = await updateOperationalShipmentStatus({
          shipmentId: req.params.id,
          toStatus,
          note,
          actor: resolveActor(req),
        });
        respondOk(res, detail);
      } catch (error) {
        mapShipmentError(error);
      }
    }),
  );

  app.get(
    "/api/exceptions",
    withApiContract(async (req: Request, res: Response) => {
      const severity = typeof req.query.severity === "string" ? req.query.severity : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const type = typeof req.query.type === "string" ? req.query.type : "";
      const exceptions = await listOperationalExceptions({ severity, status, type });
      respondOk(res, exceptions);
    }),
  );

  app.get(
    "/api/exceptions/:id",
    withApiContract(async (req: Request, res: Response) => {
      try {
        const detail = await getOperationalExceptionDetail(req.params.id);
        respondOk(res, detail);
      } catch (error) {
        mapExceptionLookupError(error);
      }
    }),
  );

  app.post(
    "/api/exceptions/:id/status",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
      try {
        const current = await getOperationalExceptionDetail(req.params.id);
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

        const detail = await transitionOperationalExceptionStatus(
          req.params.id,
          normalizedTarget,
          resolveActor(req),
        );
        respondOk(res, detail);
      } catch (error) {
        mapExceptionMutationError(error);
      }
    }),
  );

  app.post(
    "/api/exceptions/:id/assign",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      try {
        const assignee = typeof req.body?.assignee === "string" ? req.body.assignee : "";
        const detail = await assignOperationalException(req.params.id, assignee, resolveActor(req));
        respondOk(res, detail);
      } catch (error) {
        mapExceptionMutationError(error);
      }
    }),
  );

  app.post(
    "/api/exceptions/:id/comment",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      try {
        const comment = typeof req.body?.comment === "string" ? req.body.comment : "";
        const author = req.user?.username || req.user?.email || "system";
        const detail = await addOperationalExceptionComment({
          idOrRef: req.params.id,
          author,
          comment,
        });
        respondOk(res, detail);
      } catch (error) {
        mapExceptionMutationError(error);
      }
    }),
  );

  app.get(
    "/api/activity",
    withApiContract(async (req: Request, res: Response) => {
      const limitRaw = Number(req.query.limit);
      const entityType = typeof req.query.entity_type === "string" ? req.query.entity_type : "";
      const entityId = typeof req.query.entity_id === "string" ? req.query.entity_id : "";

      const records = await listOperationalActivity({
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
        entityType,
        entityId,
      });

      respondOk(res, records);
    }),
  );

  app.get(
    "/api/integrations/runs",
    withApiContract(async (_req: Request, res: Response) => {
      const runs = await listOperationalIntegrationRuns(20);
      respondOk(res, runs);
    }),
  );

  app.post(
    "/api/integrations/:connector/run",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      try {
        const run = await runOperationalConnector(req.params.connector);
        respondOk(res, run, 201);
      } catch (error) {
        const message = toErrorMessage(error);
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
    withApiContract(async (_req: Request, res: Response) => {
      const overview = await getOperationalControlTowerOverview();
      respondOk(res, overview);
    }),
  );

  app.post(
    "/api/demo/walkthrough/run",
    auth.ensureAuthenticated,
    withApiContract(async (req: Request, res: Response) => {
      const actor = req.user?.username || req.user?.email || "demo-user";
      try {
        const result = await runOperationalDemoWalkthrough(actor);
        respondOk(res, result);
      } catch (error) {
        const message = toErrorMessage(error);
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
