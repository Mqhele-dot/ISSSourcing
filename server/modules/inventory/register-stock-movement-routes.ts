import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { insertStockMovementSchema } from "@shared/schema";
import { storage } from "../../storage";
import { sendFunctionError } from "../../api-response";

/**
 * Stock movement list/create/transfer/receipt/issue — extracted from legacy routes.ts.
 */
export function registerStockMovementRoutes(app: Express): void {
  app.get("/api/stock-movements", async (_req: Request, res: Response) => {
    try {
      const movements = await storage.getAllStockMovements();
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements:", error);
      res.status(500).json({ message: "Failed to fetch stock movements" });
    }
  });

  app.get("/api/stock-movements/item/:itemId", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const movements = await storage.getStockMovementsByItemId(itemId);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements for item:", error);
      res.status(500).json({ message: "Failed to fetch stock movements for item" });
    }
  });

  app.get("/api/stock-movements/warehouse/:warehouseId", async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      if (isNaN(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const movements = await storage.getStockMovementsByWarehouseId(warehouseId);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements for warehouse:", error);
      res.status(500).json({ message: "Failed to fetch stock movements for warehouse" });
    }
  });

  app.post("/api/stock-movements", async (req: Request, res: Response) => {
    try {
      const validatedData = insertStockMovementSchema.parse(req.body);
      if (Number(validatedData.quantity) === 0) {
        return sendFunctionError(res, 400, "createStockMovement", "Stock movement quantity must be non-zero");
      }
      const warehouseIds = [
        validatedData.warehouseId,
        validatedData.sourceWarehouseId,
        validatedData.destinationWarehouseId,
      ]
        .map((v) => (v == null ? null : Number(v)))
        .filter((v): v is number => Number.isFinite(v));
      for (const warehouseId of warehouseIds) {
        const warehouse = await storage.getWarehouse(warehouseId);
        if (!warehouse) {
          return sendFunctionError(
            res,
            400,
            "createStockMovement",
            `Warehouse ID ${warehouseId} does not exist`,
          );
        }
      }
      const movement = await storage.createStockMovement(validatedData);
      res.status(201).json(movement);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating stock movement:", error);
        res.status(500).json({ message: "Failed to create stock movement" });
      }
    }
  });

  app.post("/api/stock-movements/transfer", async (req: Request, res: Response) => {
    try {
      const { sourceWarehouseId, destinationWarehouseId, itemId, quantity, userId, reason } = req.body;

      if (!sourceWarehouseId || !destinationWarehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (sourceWarehouseId === destinationWarehouseId) {
        return res.status(400).json({ message: "Source and destination warehouses must be different" });
      }

      const sourceInventory = await storage.getWarehouseInventoryItem(Number(sourceWarehouseId), Number(itemId));

      const destinationInventory = await storage.getWarehouseInventoryItem(
        Number(destinationWarehouseId),
        Number(itemId),
      );

      if (!sourceInventory || sourceInventory.quantity < Number(quantity)) {
        return res.status(400).json({ message: "Insufficient stock in source warehouse" });
      }

      const movement = await storage.transferStock(
        Number(sourceWarehouseId),
        Number(destinationWarehouseId),
        Number(itemId),
        Number(quantity),
        userId ? Number(userId) : undefined,
        reason,
      );

      try {
        const { notifyInventoryUpdate } = await import("../../websocket-service");

        notifyInventoryUpdate(
          Number(itemId),
          Number(sourceWarehouseId),
          sourceInventory.quantity - Number(quantity),
          sourceInventory.quantity,
        );

        const prevDestQuantity = destinationInventory ? destinationInventory.quantity : 0;
        notifyInventoryUpdate(
          Number(itemId),
          Number(destinationWarehouseId),
          prevDestQuantity + Number(quantity),
          prevDestQuantity,
        );
      } catch (wsError) {
        console.error("Failed to notify inventory update via WebSocket:", wsError);
      }

      res.status(201).json(movement);
    } catch (error) {
      console.error("Error transferring stock:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to transfer stock" });
    }
  });

  app.post("/api/stock-movements/receipt", async (req: Request, res: Response) => {
    try {
      const { warehouseId, itemId, quantity, referenceId, referenceType, notes, userId, unitCost } = req.body;

      if (!warehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be positive for receipt" });
      }

      const whId = Number(warehouseId);
      const itId = Number(itemId);
      const qty = Number(quantity);
      let warehouseInventory = await storage.getWarehouseInventoryItem(whId, itId);
      if (!warehouseInventory) {
        warehouseInventory = await storage.createWarehouseInventory({
          warehouseId: whId,
          itemId: itId,
          quantity: 0,
        });
      }
      const previousQuantity = warehouseInventory.quantity ?? 0;
      await storage.updateWarehouseInventory(warehouseInventory.id, { quantity: previousQuantity + qty });

      const movement = await storage.createStockMovement({
        itemId: itId,
        quantity: qty,
        type: "RECEIPT",
        warehouseId: null,
        destinationWarehouseId: whId,
        sourceWarehouseId: null,
        referenceId: referenceId ? Number(referenceId) : null,
        referenceType: referenceType || null,
        notes: notes || null,
        userId: userId ? Number(userId) : null,
        unitCost: unitCost ? Number(unitCost) : null,
        previousQuantity,
        newQuantity: previousQuantity + qty,
      });

      try {
        const { notifyInventoryUpdate } = await import("../../websocket-service");
        notifyInventoryUpdate(itId, whId, previousQuantity + qty, previousQuantity);
      } catch (wsError) {
        console.error("Failed to notify inventory update via WebSocket:", wsError);
      }

      res.status(201).json(movement);
    } catch (error) {
      console.error("Error recording stock receipt:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to record stock receipt" });
    }
  });

  app.post("/api/stock-movements/issue", async (req: Request, res: Response) => {
    try {
      const { warehouseId, itemId, quantity, referenceId, referenceType, notes, userId } = req.body;

      if (!warehouseId || !itemId || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be positive for issue" });
      }

      const whId = Number(warehouseId);
      const itId = Number(itemId);
      const qty = Number(quantity);
      const warehouseInventory = await storage.getWarehouseInventoryItem(whId, itId);
      if (!warehouseInventory || (warehouseInventory.quantity ?? 0) < qty) {
        return res.status(400).json({ message: "Insufficient stock in warehouse" });
      }
      const previousQuantity = warehouseInventory.quantity ?? 0;
      await storage.updateWarehouseInventory(warehouseInventory.id, { quantity: previousQuantity - qty });

      const movement = await storage.createStockMovement({
        itemId: itId,
        quantity: -qty,
        type: "ISSUE",
        warehouseId: null,
        sourceWarehouseId: whId,
        destinationWarehouseId: null,
        referenceId: referenceId ? Number(referenceId) : null,
        referenceType: referenceType || null,
        notes: notes || null,
        userId: userId ? Number(userId) : null,
        previousQuantity,
        newQuantity: previousQuantity - qty,
      });

      try {
        const { notifyInventoryUpdate } = await import("../../websocket-service");
        notifyInventoryUpdate(itId, whId, previousQuantity - qty, previousQuantity);
      } catch (wsError) {
        console.error("Failed to notify inventory update via WebSocket:", wsError);
      }

      res.status(201).json(movement);
    } catch (error) {
      console.error("Error issuing stock:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to issue stock" });
    }
  });
}
