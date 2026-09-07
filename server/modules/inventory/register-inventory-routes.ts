import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { insertInventoryItemSchema, inventoryItemFormSchema } from "@shared/schema";
import { ensurePlanLimitAllowsCreate } from "../../plan-limit-service";
import { getActiveOrganizationId } from "../../organization-context";
import {
  dependencyBlockedMessage,
  getInventoryItemWhereUsed,
} from "../master-data/dependency-checks";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

/**
 * Core inventory item HTTP surface (org-scoped via storage + ALS).
 * Mounted from `registerRoutes` after `setupAuth`.
 */
export function registerInventoryCrudRoutes(app: Express, auth: AuthBundle): void {
  const invRead = [auth.ensureAuthenticated];
  const invCreate = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "create")];
  const invWrite = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "update")];

  /** List/search GET `/api/inventory` stays in `operations-routes` when registered before this module. */

  app.get("/api/inventory/low-stock", ...invRead, async (_req: Request, res: Response) => {
    try {
      const items = await storage.getLowStockItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching low stock items:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/inventory/out-of-stock", ...invRead, async (_req: Request, res: Response) => {
    try {
      const items = await storage.getOutOfStockItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching out of stock items:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/inventory/expiring", ...invRead, async (req: Request, res: Response) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
      const now = new Date();
      const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const all = await storage.getAllInventoryItems();
      const expiring = all.filter((row) => {
        const exp = (row as { expiryDate?: Date | string | null }).expiryDate;
        if (exp == null) return false;
        const d = exp instanceof Date ? exp : new Date(exp);
        if (Number.isNaN(d.getTime())) return false;
        return d >= now && d <= horizon;
      });
      res.json(expiring);
    } catch (error) {
      console.error("Error fetching expiring inventory:", error);
      res.status(200).json([]);
    }
  });

  app.get("/api/inventory/stats", ...invRead, async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getInventoryStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching inventory stats:", error);
      res.status(200).json({
        totalItems: 0,
        lowStockItems: 0,
        outOfStockItems: 0,
        inventoryValue: 0,
      });
    }
  });

  /** Numeric id only — avoids capturing SKU strings like `PEN-BP-12` (operational GET lives on the same path prefix). */
  app.get("/api/inventory/:id(\\d+)", ...invRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }

      const item = await storage.getInventoryItem(id);

      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      const [warehouseRows, movements] = await Promise.all([
        storage.getItemWarehouseInventory(id),
        storage.getStockMovementsByItemId(id),
      ]);
      const positions = await Promise.all(
        warehouseRows.map(async (position) => {
          const warehouse = await storage.getWarehouse(position.warehouseId);
          const onHand = Number(position.quantity ?? 0);
          return {
            id: position.id,
            warehouseId: position.warehouseId,
            warehouseName: warehouse?.name ?? `Warehouse #${position.warehouseId}`,
            location: position.location,
            aisle: position.aisle,
            bin: position.bin,
            onHand,
            allocated: 0,
            available: onHand,
            updatedAt: position.updatedAt,
          };
        }),
      );
      const warehouseQuantity = positions.reduce((sum, position) => sum + position.onHand, 0);
      const unassignedQuantity = Number((item as { quantity?: number }).quantity ?? 0);
      const onHand = warehouseQuantity + unassignedQuantity;
      const payload = {
        ...item,
        onHand,
        allocated: 0,
        available: onHand,
        warehouseQuantity,
        unassignedQuantity,
        hasCanonicalWarehouseStock: positions.length > 0,
        summary: {
          onHand,
          allocated: 0,
          available: onHand,
          warehouseQuantity,
          unassignedQuantity,
        },
        positions,
        movements: movements.slice(0, 100),
      };
      res.json(payload);
    } catch (error) {
      console.error("Error fetching inventory item:", error);
      res.status(500).json({ message: "Failed to fetch inventory item" });
    }
  });

  app.post("/api/inventory", ...invCreate, async (req: Request, res: Response) => {
    try {
      const validatedData = inventoryItemFormSchema.parse({
        ...req.body,
        sku: typeof req.body?.sku === "string" ? req.body.sku.trim() : req.body?.sku,
        name: typeof req.body?.name === "string" ? req.body.name.trim() : req.body?.name,
      });
      const settings = await storage.getSettings();
      const effectiveWarehouseId = validatedData.defaultWarehouseId ?? settings.defaultWarehouseId ?? null;
      if (effectiveWarehouseId && !(await storage.getWarehouse(effectiveWarehouseId))) {
        return res.status(400).json({
          code: "INVENTORY_DEFAULT_WAREHOUSE_INVALID",
          message: "The default warehouse must be active and belong to this organization.",
        });
      }
      if (settings.requireLocationForItems && !validatedData.location?.trim()) {
        return res.status(400).json({
          code: "INVENTORY_LOCATION_REQUIRED",
          message: "Inventory Settings require a storage location for every new item.",
          hint: "Enter the item location or disable the location requirement in Production Control Plane settings.",
        });
      }
      const effectiveData = {
        ...validatedData,
        defaultWarehouseId: effectiveWarehouseId,
        lowStockThreshold: validatedData.lowStockThreshold ?? settings.lowStockDefaultThreshold ?? 10,
        unitOfMeasure: validatedData.unitOfMeasure || settings.defaultUnit || "each",
      };
      const existingItems = await storage.getAllInventoryItems();
      if (!(await ensurePlanLimitAllowsCreate(res, "skus", existingItems.length))) return;

      const existingItem = await storage.getInventoryItemBySku(validatedData.sku);
      if (existingItem) {
        return res.status(409).json({
          code: "INVENTORY_SKU_EXISTS",
          message: "Item with this SKU already exists",
          details: { sku: validatedData.sku },
        });
      }

      if (validatedData.barcode?.trim()) {
        const existingBarcode = await storage.getBarcodeByValue(validatedData.barcode.trim());
        if (existingBarcode) {
          return res.status(409).json({
            code: "INVENTORY_BARCODE_EXISTS",
            message: "This barcode is already linked to another inventory item.",
            details: { barcode: validatedData.barcode.trim() },
          });
        }
      }

      const newItem = await storage.createInventoryItem(effectiveData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({
          code: "INVENTORY_ITEM_VALIDATION_FAILED",
          message: validationError.message,
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      } else {
        console.error("Error creating inventory item:", error);
        res.status(500).json({ message: "Failed to create inventory item" });
      }
    }
  });

  app.put("/api/inventory/:id(\\d+)", ...invWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }

      if (req.body?.quantity !== undefined) {
        return res.status(400).json({
          code: "INVENTORY_QUANTITY_ADJUSTMENT_REQUIRED",
          message: "Warehouse quantity cannot be edited as item master data.",
          hint: "Use Adjust stock or the barcode Scan in/Scan out workflow so the movement remains auditable.",
        });
      }
      const validatedData = insertInventoryItemSchema
        .omit({ organizationId: true, quantity: true })
        .partial()
        .parse(req.body);
      const currentItem = await storage.getInventoryItem(id);
      if (!currentItem) {
        return res.status(404).json({ message: "Inventory item not found" });
      }
      const settings = await storage.getSettings();
      const effectiveWarehouseId = validatedData.defaultWarehouseId === undefined
        ? currentItem.defaultWarehouseId
        : validatedData.defaultWarehouseId;
      if (effectiveWarehouseId && !(await storage.getWarehouse(effectiveWarehouseId))) {
        return res.status(400).json({
          code: "INVENTORY_DEFAULT_WAREHOUSE_INVALID",
          message: "The default warehouse must be active and belong to this organization.",
        });
      }
      const effectiveLocation = validatedData.location === undefined ? currentItem.location : validatedData.location;
      if (settings.requireLocationForItems && !effectiveLocation?.trim()) {
        return res.status(400).json({
          code: "INVENTORY_LOCATION_REQUIRED",
          message: "Inventory Settings require every active item to retain a storage location.",
        });
      }
      if (validatedData.sku?.trim() && validatedData.sku.trim() !== currentItem.sku) {
        const skuOwner = await storage.getInventoryItemBySku(validatedData.sku.trim());
        if (skuOwner && skuOwner.id !== id) {
          return res.status(409).json({
            code: "INVENTORY_SKU_EXISTS",
            message: "Another inventory item already uses this SKU.",
          });
        }
      }
      if (validatedData.barcode?.trim()) {
        const barcodeOwner = await storage.getBarcodeByValue(validatedData.barcode.trim());
        if (barcodeOwner && barcodeOwner.itemId !== id) {
          return res.status(409).json({
            code: "INVENTORY_BARCODE_EXISTS",
            message: "Another inventory item already uses this barcode.",
          });
        }
      }
      const status = String((validatedData as { status?: unknown }).status ?? "").toLowerCase();
      if (["inactive", "discontinued", "blocked", "archived"].includes(status)) {
        const dependencies = await getInventoryItemWhereUsed(getActiveOrganizationId(), id);
        if (dependencies.length > 0) {
          const userId = (req as Request & { user?: { id?: number } }).user?.id;
          await storage.createActivityLog({
            action: "Inventory Item Disable Blocked",
            description: dependencyBlockedMessage("inventory item", "disable", dependencies),
            referenceType: "inventory_item",
            referenceId: id,
            userId,
          }).catch(() => {});
          return res.status(409).json({
            code: "MASTER_DATA_RECORD_IN_USE",
            message: dependencyBlockedMessage("inventory item", "disable", dependencies),
            hint: "Close or reassign open requisitions, PO lines, invoice lines, and stock before disabling this item.",
            details: { action: "disable", dependencies },
          });
        }
      }
      const updatedItem = await storage.updateInventoryItem(id, validatedData);

      if (!updatedItem) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      await storage.createActivityLog({
        action: "Inventory Item Updated",
        description: `Updated ${updatedItem.name} (${updatedItem.sku}). Master-data fields changed without directly changing warehouse stock.`,
        referenceType: "inventory_item",
        referenceId: id,
        itemId: id,
        userId: (req as Request & { user?: { id?: number } }).user?.id,
      }).catch(() => {});

      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating inventory item:", error);
        res.status(500).json({ message: "Failed to update inventory item" });
      }
    }
  });

  app.delete("/api/inventory/:id(\\d+)", ...invWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }

      const dependencies = await getInventoryItemWhereUsed(getActiveOrganizationId(), id);
      if (dependencies.length > 0) {
        const userId = (req as Request & { user?: { id?: number } }).user?.id;
        await storage.createActivityLog({
          action: "Inventory Item Delete Blocked",
          description: dependencyBlockedMessage("inventory item", "delete", dependencies),
          referenceType: "inventory_item",
          referenceId: id,
          userId,
        }).catch(() => {});
        return res.status(409).json({
          code: "MASTER_DATA_RECORD_IN_USE",
          message: dependencyBlockedMessage("inventory item", "delete", dependencies),
          hint: "Clear dependent transactions and stock before deleting this item.",
          details: { action: "delete", dependencies },
        });
      }

      const success = await storage.deleteInventoryItem(id);

      if (!success) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting inventory item:", error);
      res.status(500).json({ message: "Failed to delete inventory item" });
    }
  });
}
