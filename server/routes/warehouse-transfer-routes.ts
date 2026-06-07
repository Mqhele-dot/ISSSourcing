import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../storage";
import { ensureAuthenticated, ensureRole } from "../auth";
import { sendOk, sendError } from "../api-response";

/**
 * Multi-Warehouse Transfer Routes
 * Handles inventory transfers between warehouses with approval workflows
 */
export function registerMultiWarehouseTransferRoutes(app: Router) {
  // GET all warehouse transfers
  app.get(
    "/api/warehouse-transfers",
    ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { status } = req.query;
        
        // In production, query the database
        // For now, return empty array (schema would need to be added)
        const transfers = status && status !== ""
          ? [] // Filter by status
          : [];

        return sendOk(res, transfers, { count: transfers.length });
      } catch (error: any) {
        return sendError(res, 500, error.message || "Failed to fetch transfers");
      }
    }
  );

  // POST create new warehouse transfer
  app.post(
    "/api/warehouse-transfers",
    ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const transferSchema = z.object({
          fromWarehouseId: z.number().int().positive(),
          toWarehouseId: z.number().int().positive(),
          items: z.array(
            z.object({
              itemId: z.number().int().positive(),
              quantity: z.number().int().positive(),
            })
          ),
          notes: z.string().optional(),
        });

        const validated = transferSchema.parse(req.body);
        
        // Validate warehouses are different
        if (validated.fromWarehouseId === validated.toWarehouseId) {
          return sendError(res, 400, "Source and destination warehouses must be different");
        }

        const userId = (req as any).user?.id;
        const referenceNumber = `WT-${Date.now()}`;

        // In production, create in database with proper schema
        const transfer = {
          id: Math.floor(Math.random() * 1000000),
          referenceNumber,
          fromWarehouseId: validated.fromWarehouseId,
          toWarehouseId: validated.toWarehouseId,
          status: "pending_approval",
          requestedByUserId: userId,
          createdAt: new Date().toISOString(),
          items: validated.items,
          notes: validated.notes,
        };

        // Log activity
        if ((req as any).storage?.createActivityLog) {
          await (req as any).storage.createActivityLog({
            action: "warehouse_transfer_created",
            description: `Created warehouse transfer ${referenceNumber}`,
            referenceType: "warehouse_transfer",
            referenceId: transfer.id,
            userId,
            entity: transfer,
          });
        }

        return sendOk(res, transfer, { action: "created" });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return sendError(res, 400, "Validation failed", { errors: error.errors });
        }
        return sendError(res, 500, error.message || "Failed to create transfer");
      }
    }
  );

  // PATCH update warehouse transfer status
  app.patch(
    "/api/warehouse-transfers/:id",
    ensureAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { status, items } = req.body;

        if (!status) {
          return sendError(res, 400, "Status is required");
        }

        const validStatuses = [
          "draft",
          "pending_approval",
          "approved",
          "in_transit",
          "received",
          "cancelled",
        ];
        if (!validStatuses.includes(status)) {
          return sendError(res, 400, "Invalid status");
        }

        const userId = (req as any).user?.id;

        // In production, update in database
        const transfer = {
          id: Number(id),
          status,
          approvedByUserId: status === "approved" ? userId : undefined,
          approvedAt: status === "approved" ? new Date().toISOString() : undefined,
          receivedAt: status === "received" ? new Date().toISOString() : undefined,
          items: items || [],
        };

        // Log activity
        if ((req as any).storage?.createActivityLog) {
          await (req as any).storage.createActivityLog({
            action: "warehouse_transfer_updated",
            description: `Updated transfer status to ${status}`,
            referenceType: "warehouse_transfer",
            referenceId: Number(id),
            userId,
            entity: transfer,
          });
        }

        return sendOk(res, transfer, { action: "updated" });
      } catch (error: any) {
        return sendError(res, 500, error.message || "Failed to update transfer");
      }
    }
  );

  // DELETE cancel warehouse transfer
  app.delete(
    "/api/warehouse-transfers/:id",
    ensureRole(["admin", "manager"]),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const userId = (req as any).user?.id;

        // In production, soft-delete in database (set status to cancelled)
        if ((req as any).storage?.createActivityLog) {
          await (req as any).storage.createActivityLog({
            action: "warehouse_transfer_cancelled",
            description: `Cancelled warehouse transfer`,
            referenceType: "warehouse_transfer",
            referenceId: Number(id),
            userId,
          });
        }

        return sendOk(res, { id }, { action: "cancelled" });
      } catch (error: any) {
        return sendError(res, 500, error.message || "Failed to cancel transfer");
      }
    }
  );
}
