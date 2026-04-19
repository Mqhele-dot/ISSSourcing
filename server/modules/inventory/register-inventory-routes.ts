import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { insertInventoryItemSchema } from "@shared/schema";

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

  app.get("/api/inventory/:id", ...invRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }

      const item = await storage.getInventoryItem(id);

      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      const qty = Number((item as { quantity?: number }).quantity ?? 0);
      const payload = {
        ...item,
        onHand: qty,
        allocated: 0,
        available: qty,
        summary: {
          onHand: qty,
          allocated: 0,
          available: qty,
        },
        positions: [
          {
            location: (item as { location?: string }).location ?? "Main Warehouse",
            onHand: qty,
            allocated: 0,
            available: qty,
            updatedAt: (item as { updatedAt?: Date }).updatedAt,
          },
        ],
        movements: [] as unknown[],
      };
      res.json(payload);
    } catch (error) {
      console.error("Error fetching inventory item:", error);
      res.status(500).json({ message: "Failed to fetch inventory item" });
    }
  });

  app.post("/api/inventory", ...invWrite, async (req: Request, res: Response) => {
    try {
      const validatedData = insertInventoryItemSchema.parse(req.body);

      const existingItem = await storage.getInventoryItemBySku(validatedData.sku);
      if (existingItem) {
        return res.status(400).json({ message: "Item with this SKU already exists" });
      }

      const newItem = await storage.createInventoryItem(validatedData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating inventory item:", error);
        res.status(500).json({ message: "Failed to create inventory item" });
      }
    }
  });

  app.put("/api/inventory/:id", ...invWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
      }

      const validatedData = insertInventoryItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updateInventoryItem(id, validatedData);

      if (!updatedItem) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

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

  app.delete("/api/inventory/:id", ...invWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item ID" });
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
