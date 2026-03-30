import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { reorderRequestFormSchema, ReorderRequestStatus } from "@shared/schema";

type Auth = {
  ensureAuthenticated: import("express").RequestHandler;
};

/**
 * Reorder request CRUD + approve/reject/convert — extracted from `routes.ts`.
 * All routes require a signed-in session (aligned with procurement routes).
 */
export function registerReorderRequestRoutes(app: Express, auth: Auth): void {
  const r = [auth.ensureAuthenticated];

  app.get("/api/reorder-requests", ...r, async (req: Request, res: Response) => {
    try {
      const startDateParam = req.query.startDate as string;
      const endDateParam = req.query.endDate as string;

      if (startDateParam && endDateParam) {
        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid date format" });
        }

        const requests = await storage.getReorderRequestsByDateRange(startDate, endDate);
        return res.json(requests);
      }

      const requests = await storage.getAllReorderRequests();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching reorder requests:", error);
      res.status(500).json({ message: "Failed to fetch reorder requests" });
    }
  });

  app.get("/api/reorder-requests/:id", ...r, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }

      const request = await storage.getReorderRequestWithDetails(id);

      if (!request) {
        return res.status(404).json({ message: "Reorder request not found" });
      }

      res.json(request);
    } catch (error) {
      console.error("Error fetching reorder request:", error);
      res.status(500).json({ message: "Failed to fetch reorder request" });
    }
  });

  app.post("/api/reorder-requests", ...r, async (req: Request, res: Response) => {
    try {
      const validatedData = reorderRequestFormSchema.parse(req.body);

      if (!validatedData.status) {
        validatedData.status = ReorderRequestStatus.PENDING;
      }

      if (!validatedData.requestNumber) {
        const date = new Date();
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const day = date.getDate().toString().padStart(2, "0");
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
        validatedData.requestNumber = `RO-${year}${month}${day}-${random}`;
      }

      const newRequest = await storage.createReorderRequest(validatedData);
      res.status(201).json(newRequest);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating reorder request:", error);
        res.status(500).json({ message: "Failed to create reorder request" });
      }
    }
  });

  app.put("/api/reorder-requests/:id", ...r, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }

      const validatedData = reorderRequestFormSchema.partial().parse(req.body);
      const updatedRequest = await storage.updateReorderRequest(id, validatedData);

      if (!updatedRequest) {
        return res.status(404).json({ message: "Reorder request not found" });
      }

      res.json(updatedRequest);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating reorder request:", error);
        res.status(500).json({ message: "Failed to update reorder request" });
      }
    }
  });

  app.delete("/api/reorder-requests/:id", ...r, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }

      const success = await storage.deleteReorderRequest(id);

      if (!success) {
        return res.status(404).json({ message: "Reorder request not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting reorder request:", error);
      res.status(500).json({ message: "Failed to delete reorder request" });
    }
  });

  app.post("/api/reorder-requests/:id/approve", ...r, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }

      const approverId = req.body.approverId || 1;

      const approvedRequest = await storage.approveReorderRequest(id, approverId);

      if (!approvedRequest) {
        return res.status(404).json({ message: "Reorder request not found" });
      }

      res.json(approvedRequest);
    } catch (error) {
      console.error("Error approving reorder request:", error);
      res.status(500).json({ message: "Failed to approve reorder request" });
    }
  });

  app.post("/api/reorder-requests/:id/reject", ...r, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }

      const { approverId = 1, reason } = req.body;

      if (!reason) {
        return res.status(400).json({ message: "Rejection reason is required" });
      }

      const rejectedRequest = await storage.rejectReorderRequest(id, approverId, reason);

      if (!rejectedRequest) {
        return res.status(404).json({ message: "Reorder request not found" });
      }

      res.json(rejectedRequest);
    } catch (error) {
      console.error("Error rejecting reorder request:", error);
      res.status(500).json({ message: "Failed to reject reorder request" });
    }
  });

  app.post("/api/reorder-requests/:id/convert", ...r, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reorder request ID" });
      }

      const existing = await storage.getReorderRequest(id);
      if (!existing) {
        return res.status(404).json({ message: "Reorder request not found" });
      }
      if (existing.status !== "APPROVED") {
        return res.status(400).json({
          message: "Only approved reorder requests can be converted. Approve the request first, then convert.",
        });
      }
      if (existing.convertedToRequisition) {
        return res.status(400).json({ message: "This reorder request was already converted to a requisition." });
      }

      const requisition = await storage.convertReorderRequestToRequisition(id);

      if (!requisition) {
        return res.status(400).json({
          message:
            "Could not convert: linked inventory item may be missing or data could not be saved. Check the item and try again.",
        });
      }

      res.json(requisition);
    } catch (error) {
      console.error("Error converting reorder request to requisition:", error);
      res.status(500).json({ message: "Failed to convert reorder request to requisition" });
    }
  });
}
