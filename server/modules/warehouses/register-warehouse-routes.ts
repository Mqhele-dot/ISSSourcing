import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { createWarehouseRepository } from "../../repositories";
import { insertWarehouseSchema, insertWarehouseInventorySchema } from "@shared/schema";
import type { AuthBundle } from "../procurement/types";
import { ensurePlanLimitAllowsCreate } from "../../plan-limit-service";
import { getActiveOrganizationId } from "../../organization-context";
import {
  dependencyBlockedMessage,
  getWarehouseWhereUsed,
} from "../master-data/dependency-checks";

const warehouseRepo = createWarehouseRepository(storage);

/** Warehouses CRUD, warehouse inventory, per-item warehouse breakdown. */
export function registerWarehouseRoutes(app: Express, auth: AuthBundle): void {
  const warehouseRead = [auth.ensureAuthenticated];
  const warehouseWrite = [auth.ensureAuthenticated, auth.ensurePermission("warehouses", "update")];

  app.get("/api/warehouses", ...warehouseRead, async (_req: Request, res: Response) => {
    try {
      const warehouses = await warehouseRepo.findAll();
      res.json(warehouses);
    } catch (error) {
      console.error("Error fetching warehouses:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/warehouses/default", ...warehouseRead, async (_req: Request, res: Response) => {
    try {
      const warehouse = await warehouseRepo.findDefault();
      if (!warehouse) {
        return res.status(404).json({ message: "No default warehouse found" });
      }
      res.json(warehouse);
    } catch (error) {
      console.error("Error fetching default warehouse:", error);
      res.status(500).json({ message: "Failed to fetch default warehouse" });
    }
  });

  app.get("/api/warehouses/:id", ...warehouseRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const warehouse = await warehouseRepo.findById(id);

      if (!warehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      res.json(warehouse);
    } catch (error) {
      console.error("Error fetching warehouse:", error);
      res.status(500).json({ message: "Failed to fetch warehouse" });
    }
  });

  app.post("/api/warehouses", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = insertWarehouseSchema.parse(req.body);
      const existingWarehouses = await warehouseRepo.findAll();
      if (!(await ensurePlanLimitAllowsCreate(res, "warehouses", existingWarehouses.length))) return;
      const newWarehouse = await warehouseRepo.create(validatedData);
      res.status(201).json(newWarehouse);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating warehouse:", error);
        res.status(500).json({ message: "Failed to create warehouse" });
      }
    }
  });

  app.put("/api/warehouses/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const validatedData = insertWarehouseSchema.partial().parse(req.body);
      const updatedWarehouse = await warehouseRepo.update(id, validatedData);

      if (!updatedWarehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      res.json(updatedWarehouse);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating warehouse:", error);
        res.status(500).json({ message: "Failed to update warehouse" });
      }
    }
  });

  app.patch("/api/warehouses/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const validatedData = insertWarehouseSchema.partial().parse(req.body);
      const updatedWarehouse = await warehouseRepo.update(id, validatedData);

      if (!updatedWarehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      res.json(updatedWarehouse);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating warehouse:", error);
        res.status(500).json({ message: "Failed to update warehouse" });
      }
    }
  });

  app.delete("/api/warehouses/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const dependencies = await getWarehouseWhereUsed(getActiveOrganizationId(), id);
      if (dependencies.length > 0) {
        const userId = (req as Request & { user?: { id?: number } }).user?.id;
        await storage.createActivityLog({
          action: "Warehouse Delete Blocked",
          description: dependencyBlockedMessage("warehouse", "delete", dependencies),
          referenceType: "warehouse",
          referenceId: id,
          userId,
        }).catch(() => {});
        return res.status(409).json({
          code: "MASTER_DATA_RECORD_IN_USE",
          message: dependencyBlockedMessage("warehouse", "delete", dependencies),
          hint: "Move stock, close movement history dependencies, and reassign defaults before deleting this warehouse.",
          details: { action: "delete", dependencies },
        });
      }

      const success = await warehouseRepo.delete(id);

      if (!success) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting warehouse:", error);
      res.status(500).json({ message: "Failed to delete warehouse" });
    }
  });

  app.put("/api/warehouses/:id/set-default", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const warehouse = await warehouseRepo.setDefault(id);

      if (!warehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      res.json(warehouse);
    } catch (error) {
      console.error("Error setting default warehouse:", error);
      res.status(500).json({ message: "Failed to set default warehouse" });
    }
  });

  app.get("/api/warehouse-inventory/:warehouseId", ...warehouseRead, async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      if (isNaN(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const inventory = await storage.getWarehouseInventory(warehouseId);
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching warehouse inventory:", error);
      res.status(500).json({ message: "Failed to fetch warehouse inventory" });
    }
  });

  app.get("/api/warehouse-inventory/:warehouseId/:itemId", ...warehouseRead, async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      const itemId = Number(req.params.itemId);
      if (isNaN(warehouseId) || isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid warehouse or item ID" });
      }

      const inventoryItem = await storage.getWarehouseInventoryItem(warehouseId, itemId);

      if (!inventoryItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }

      res.json(inventoryItem);
    } catch (error) {
      console.error("Error fetching warehouse inventory item:", error);
      res.status(500).json({ message: "Failed to fetch warehouse inventory item" });
    }
  });

  app.post("/api/warehouse-inventory", ...warehouseWrite, (_req: Request, res: Response) =>
    res.status(410).json({
      code: "STOCK_MOVEMENT_REQUIRED",
      message: "Warehouse balances cannot be created directly.",
      hint: "Use an authenticated receipt, issue, transfer, or adjustment workflow.",
    }),
  );

  app.put("/api/warehouse-inventory/:id", ...warehouseWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ message: "Invalid warehouse inventory row ID" });
      }

      const allowedFields = new Set(["location", "aisle", "bin"]);
      const rejectedFields = Object.keys(req.body ?? {}).filter((field) => !allowedFields.has(field));
      if (rejectedFields.length > 0) {
        return res.status(409).json({
          code: "STOCK_MOVEMENT_REQUIRED",
          message: "Only put-away location metadata can be edited on a warehouse balance.",
          hint: "Use an authenticated stock movement to change quantity.",
          details: { rejectedFields },
        });
      }
      const validatedData = insertWarehouseInventorySchema.pick({ location: true, aisle: true, bin: true }).partial().parse(req.body);

      const previousItem = await storage.getWarehouseInventoryById(id);
      if (!previousItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }

      const updatedItem = await storage.updateWarehouseInventory(id, validatedData);

      if (!updatedItem) {
        return res.status(404).json({ message: "Warehouse inventory item not found" });
      }

      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating warehouse inventory item:", error);
        res.status(500).json({ message: "Failed to update warehouse inventory item" });
      }
    }
  });

  app.delete("/api/warehouse-inventory/:id", ...warehouseWrite, (_req: Request, res: Response) =>
    res.status(410).json({
      code: "STOCK_MOVEMENT_REQUIRED",
      message: "Warehouse balances cannot be deleted directly.",
      hint: "Use a controlled stock adjustment to bring the balance to zero while retaining its audit trail.",
    }),
  );

  app.get("/api/inventory/:itemId/warehouses", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const inventory = await storage.getItemWarehouseInventory(itemId);
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching item warehouse inventory:", error);
      res.status(500).json({ message: "Failed to fetch item warehouse inventory" });
    }
  });
}
