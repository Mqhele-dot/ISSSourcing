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
  listOperationalExceptions,
  listOperationalIntegrationRuns,
  listOperationalInventory,
  listOperationalPurchaseOrders,
  listOperationalShipments,
  receiveOperationalPurchaseOrder,
  runOperationalConnector,
  transitionOperationalExceptionStatus,
  transitionOperationalPurchaseOrderStatus,
  updateOperationalShipmentStatus,
} from "./operations-core";

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

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

export function registerOperationalRoutes(app: Express, auth: AuthGuards) {
  app.get("/api/inventory", async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string"
          ? req.query.q
          : typeof req.query.search === "string"
            ? req.query.search
            : "";
      const location =
        typeof req.query.location === "string"
          ? req.query.location
          : "";
      const category =
        typeof req.query.category === "string"
          ? req.query.category
          : typeof req.query.categoryId === "string"
            ? req.query.categoryId
            : "";
      const low = parseBooleanFlag(req.query.low) || parseBooleanFlag(req.query.lowStock);

      const items = await listOperationalInventory({ q, location, category, low });
      res.json(items);
    } catch (error) {
      console.error("Operational inventory list error:", error);
      res.status(500).json({ message: "Failed to fetch operational inventory data" });
    }
  });

  app.post(
    "/api/inventory/:sku/adjust",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const sku = req.params.sku;
        const location = typeof req.body?.location === "string" ? req.body.location : "";
        const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
        const ref = typeof req.body?.ref === "string" ? req.body.ref : undefined;
        const delta = Number(req.body?.delta);
        const createdBy = req.user?.username || req.user?.email || "system";

        if (!reason.trim()) {
          return res.status(400).json({ message: "reason is required" });
        }

        const result = await adjustOperationalInventory({
          skuOrId: sku,
          location,
          delta,
          reason,
          ref,
          createdBy,
        });

        res.status(200).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "adjust_failed";

        if (message === "delta_must_be_non_zero") {
          return res.status(400).json({ message: "delta must be non-zero" });
        }
        if (message === "location_required") {
          return res.status(400).json({ message: "location is required" });
        }
        if (message === "sku_not_found") {
          return res.status(404).json({ message: "sku not found" });
        }
        if (message === "location_not_found") {
          return res.status(400).json({ message: "location not found" });
        }

        console.error("Inventory adjust error:", error);
        return res.status(500).json({ message: "Failed to adjust inventory" });
      }
    },
  );

  app.get("/api/inventory/:sku", async (req: Request, res: Response, next: NextFunction) => {
    const sku = req.params.sku;
    if (INVENTORY_ROUTE_RESERVED_SEGMENTS.has(sku)) {
      return next();
    }

    try {
      const detail = await getOperationalInventoryDetail(sku);
      if (!detail) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      return res.json(detail);
    } catch (error) {
      console.error("Operational inventory detail error:", error);
      return res.status(500).json({ message: "Failed to fetch inventory detail" });
    }
  });

  app.get("/api/purchase/orders", async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const supplier = typeof req.query.supplier === "string" ? req.query.supplier : "";
      const q = typeof req.query.q === "string" ? req.query.q : "";

      const orders = await listOperationalPurchaseOrders({ status, supplier, q });
      res.json(orders);
    } catch (error) {
      console.error("Operational purchase order list error:", error);
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });

  app.get("/api/purchase/orders/:po", async (req: Request, res: Response) => {
    try {
      const detail = await getOperationalPurchaseOrderDetail(req.params.po);
      if (!detail) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      return res.json(detail);
    } catch (error) {
      console.error("Operational purchase order detail error:", error);
      return res.status(500).json({ message: "Failed to fetch purchase order detail" });
    }
  });

  app.post(
    "/api/purchase/orders/:po/status",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const toStatus =
          typeof req.body?.toStatus === "string"
            ? req.body.toStatus
            : typeof req.body?.status === "string"
              ? req.body.status
              : "";
        const detail = await transitionOperationalPurchaseOrderStatus(req.params.po, toStatus);
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "status_update_failed";
        if (message === "po_not_found") {
          return res.status(404).json({ message: "Purchase order not found" });
        }
        if (message === "invalid_target_status") {
          return res.status(400).json({ message: "toStatus is required" });
        }
        if (message === "invalid_transition") {
          return res.status(400).json({ message: "Invalid status transition" });
        }
        console.error("Operational purchase status update error:", error);
        return res.status(500).json({ message: "Failed to update purchase order status" });
      }
    },
  );

  app.post(
    "/api/purchase/orders/:po/approve",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const detail = await transitionOperationalPurchaseOrderStatus(req.params.po, "approved");
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "approve_failed";
        if (message === "po_not_found") {
          return res.status(404).json({ message: "Purchase order not found" });
        }
        if (message === "invalid_transition") {
          return res.status(400).json({ message: "Invalid status transition" });
        }
        console.error("Operational PO approve error:", error);
        return res.status(500).json({ message: "Failed to approve purchase order" });
      }
    },
  );

  app.post(
    "/api/purchase/orders/:po/send",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const detail = await transitionOperationalPurchaseOrderStatus(req.params.po, "sent");
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "send_failed";
        if (message === "po_not_found") {
          return res.status(404).json({ message: "Purchase order not found" });
        }
        if (message === "invalid_transition") {
          return res.status(400).json({ message: "Invalid status transition" });
        }
        console.error("Operational PO send error:", error);
        return res.status(500).json({ message: "Failed to mark purchase order as sent" });
      }
    },
  );

  app.post(
    "/api/purchase/orders/:po/receive",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const bodyLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
        const lines = bodyLines.map((line: { sku?: unknown; qty_received_now?: unknown; qtyReceivedNow?: unknown }) => ({
          sku: typeof line.sku === "string" ? line.sku : "",
          qty_received_now: Number(line.qty_received_now ?? line.qtyReceivedNow),
        }));

        const result = await receiveOperationalPurchaseOrder(req.params.po, lines);
        return res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "receive_failed";
        if (message === "po_not_found") {
          return res.status(404).json({ message: "Purchase order not found" });
        }
        if (message === "invalid_receive_state") {
          return res.status(400).json({ message: "Only approved/sent purchase orders can receive" });
        }
        if (message === "lines_required") {
          return res.status(400).json({ message: "lines are required" });
        }
        if (message.startsWith("line_not_found:")) {
          return res.status(400).json({ message: `Unknown SKU in receive payload: ${message.split(":")[1]}` });
        }
        if (message.startsWith("invalid_receive_qty:")) {
          return res.status(400).json({ message: `Invalid receive quantity for SKU: ${message.split(":")[1]}` });
        }
        console.error("Operational purchase receive error:", error);
        return res.status(500).json({ message: "Failed to receive purchase order lines" });
      }
    },
  );

  app.get("/api/logistics/shipments", async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const po = typeof req.query.po === "string" ? req.query.po : "";
      const carrier = typeof req.query.carrier === "string" ? req.query.carrier : "";
      const shipments = await listOperationalShipments({ status, po, carrier });
      res.json(shipments);
    } catch (error) {
      console.error("Operational shipments list error:", error);
      res.status(500).json({ message: "Failed to fetch shipments" });
    }
  });

  app.get("/api/logistics/shipments/:id", async (req: Request, res: Response) => {
    try {
      const detail = await getOperationalShipmentDetail(req.params.id);
      res.json(detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "shipment_failed";
      if (message === "shipment_not_found") {
        return res.status(404).json({ message: "Shipment not found" });
      }
      console.error("Operational shipment detail error:", error);
      return res.status(500).json({ message: "Failed to fetch shipment detail" });
    }
  });

  app.post(
    "/api/logistics/shipments/:id/status",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
        const note = typeof req.body?.note === "string" ? req.body.note : "";
        const detail = await updateOperationalShipmentStatus({
          shipmentId: req.params.id,
          toStatus,
          note,
        });
        res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "shipment_status_failed";
        if (message === "shipment_not_found") {
          return res.status(404).json({ message: "Shipment not found" });
        }
        if (message === "invalid_target_status") {
          return res.status(400).json({ message: "toStatus is required" });
        }
        if (message === "invalid_transition") {
          return res.status(400).json({ message: "Invalid shipment status transition" });
        }
        console.error("Operational shipment status update error:", error);
        return res.status(500).json({ message: "Failed to update shipment status" });
      }
    },
  );

  app.get("/api/exceptions", async (req: Request, res: Response) => {
    try {
      const severity = typeof req.query.severity === "string" ? req.query.severity : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const type = typeof req.query.type === "string" ? req.query.type : "";
      const exceptions = await listOperationalExceptions({ severity, status, type });
      res.json(exceptions);
    } catch (error) {
      console.error("Operational exceptions list error:", error);
      res.status(500).json({ message: "Failed to fetch exceptions" });
    }
  });

  app.get("/api/exceptions/:id", async (req: Request, res: Response) => {
    try {
      const detail = await getOperationalExceptionDetail(req.params.id);
      res.json(detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "exception_failed";
      if (message === "exception_not_found") {
        return res.status(404).json({ message: "Exception not found" });
      }
      console.error("Operational exception detail error:", error);
      return res.status(500).json({ message: "Failed to fetch exception detail" });
    }
  });

  app.post(
    "/api/exceptions/:id/status",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const toStatus = typeof req.body?.toStatus === "string" ? req.body.toStatus : "";
        const detail = await transitionOperationalExceptionStatus(req.params.id, toStatus);
        res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "exception_status_failed";
        if (message === "exception_not_found") {
          return res.status(404).json({ message: "Exception not found" });
        }
        if (message === "invalid_target_status") {
          return res.status(400).json({ message: "toStatus is required" });
        }
        if (message === "invalid_transition") {
          return res.status(400).json({ message: "Invalid exception status transition" });
        }
        console.error("Operational exception status update error:", error);
        return res.status(500).json({ message: "Failed to update exception status" });
      }
    },
  );

  app.post(
    "/api/exceptions/:id/assign",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const assignee = typeof req.body?.assignee === "string" ? req.body.assignee : "";
        const detail = await assignOperationalException(req.params.id, assignee);
        res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "exception_assign_failed";
        if (message === "exception_not_found") {
          return res.status(404).json({ message: "Exception not found" });
        }
        console.error("Operational exception assign error:", error);
        return res.status(500).json({ message: "Failed to assign exception" });
      }
    },
  );

  app.post(
    "/api/exceptions/:id/comment",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const comment = typeof req.body?.comment === "string" ? req.body.comment : "";
        const author = req.user?.username || req.user?.email || "system";
        const detail = await addOperationalExceptionComment({
          idOrRef: req.params.id,
          author,
          comment,
        });
        res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "exception_comment_failed";
        if (message === "exception_not_found") {
          return res.status(404).json({ message: "Exception not found" });
        }
        if (message === "comment_required") {
          return res.status(400).json({ message: "comment is required" });
        }
        console.error("Operational exception comment error:", error);
        return res.status(500).json({ message: "Failed to add comment" });
      }
    },
  );

  app.get("/api/integrations/runs", async (_req: Request, res: Response) => {
    try {
      const runs = await listOperationalIntegrationRuns(20);
      res.json(runs);
    } catch (error) {
      console.error("Operational integrations list error:", error);
      res.status(500).json({ message: "Failed to fetch integration runs" });
    }
  });

  app.post(
    "/api/integrations/:connector/run",
    auth.ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const run = await runOperationalConnector(req.params.connector);
        res.status(201).json(run);
      } catch (error) {
        const message = error instanceof Error ? error.message : "run_failed";
        if (message === "unsupported_connector") {
          return res.status(400).json({ message: "Unsupported connector" });
        }
        console.error("Operational integration run error:", error);
        return res.status(500).json({ message: "Failed to run connector" });
      }
    },
  );

  app.get("/api/control-tower/overview", async (_req: Request, res: Response) => {
    try {
      const overview = await getOperationalControlTowerOverview();
      res.json(overview);
    } catch (error) {
      console.error("Operational control tower overview error:", error);
      res.status(500).json({ message: "Failed to fetch control tower overview" });
    }
  });
}
