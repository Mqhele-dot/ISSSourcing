import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { insertBarcodeSchema } from "@shared/schema";
import { storage } from "../../storage";

/**
 * Barcode CRUD + find item by barcode (moved from routes.ts).
 */
export function registerBarcodeRoutes(app: Express): void {
  app.get("/api/barcodes", async (_req: Request, res: Response) => {
    try {
      const barcodes = await storage.getAllBarcodes();
      res.json(barcodes);
    } catch (error) {
      console.error("Error fetching barcodes:", error);
      res.status(500).json({ message: "Failed to fetch barcodes" });
    }
  });

  app.get("/api/barcodes/item/:itemId", async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const barcodes = await storage.getBarcodesByItemId(itemId);
      res.json(barcodes);
    } catch (error) {
      console.error("Error fetching barcodes for item:", error);
      res.status(500).json({ message: "Failed to fetch barcodes for item" });
    }
  });

  app.get("/api/barcodes/value/:value", async (req: Request, res: Response) => {
    try {
      const value = req.params.value;
      const barcode = await storage.getBarcodeByValue(value);

      if (!barcode) {
        return res.status(404).json({ message: "Barcode not found" });
      }

      res.json(barcode);
    } catch (error) {
      console.error("Error fetching barcode by value:", error);
      res.status(500).json({ message: "Failed to fetch barcode by value" });
    }
  });

  app.get("/api/inventory/find-by-barcode/:value", async (req: Request, res: Response) => {
    try {
      const value = req.params.value;
      const item = await storage.findItemByBarcode(value);

      if (!item) {
        return res.status(404).json({ message: "No item found with the provided barcode" });
      }

      res.json(item);
    } catch (error) {
      console.error("Error finding item by barcode:", error);
      res.status(500).json({ message: "Failed to find item by barcode" });
    }
  });

  app.post("/api/barcodes", async (req: Request, res: Response) => {
    try {
      const validatedData = insertBarcodeSchema.parse(req.body);

      const existingBarcode = await storage.getBarcodeByValue(validatedData.value);
      if (existingBarcode) {
        return res.status(400).json({ message: "Barcode value already exists" });
      }

      const newBarcode = await storage.createBarcode(validatedData);
      res.status(201).json(newBarcode);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating barcode:", error);
        res.status(500).json({ message: "Failed to create barcode" });
      }
    }
  });

  app.put("/api/barcodes/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid barcode ID" });
      }

      const validatedData = insertBarcodeSchema.partial().parse(req.body);

      if (validatedData.value) {
        const existingBarcode = await storage.getBarcodeByValue(validatedData.value);
        if (existingBarcode && existingBarcode.id !== id) {
          return res.status(400).json({ message: "Barcode value already exists" });
        }
      }

      const updatedBarcode = await storage.updateBarcode(id, validatedData);

      if (!updatedBarcode) {
        return res.status(404).json({ message: "Barcode not found" });
      }

      res.json(updatedBarcode);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating barcode:", error);
        res.status(500).json({ message: "Failed to update barcode" });
      }
    }
  });

  app.delete("/api/barcodes/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid barcode ID" });
      }

      const success = await storage.deleteBarcode(id);

      if (!success) {
        return res.status(404).json({ message: "Barcode not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting barcode:", error);
      res.status(500).json({ message: "Failed to delete barcode" });
    }
  });
}
