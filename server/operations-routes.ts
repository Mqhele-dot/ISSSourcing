import type { Express, NextFunction, Request, Response } from "express";
import {
  adjustOperationalInventory,
  getOperationalInventoryDetail,
  getOperationalPurchaseOrderDetail,
  listOperationalInventory,
  listOperationalPurchaseOrders,
  receiveOperationalPurchaseOrder,
  transitionOperationalPurchaseOrderStatus,
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
        const lines = bodyLines.map((line) => ({
          sku: typeof line?.sku === "string" ? line.sku : "",
          qty_received_now: Number(line?.qty_received_now ?? line?.qtyReceivedNow),
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
}
