import { Router, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { sendOk, sendError } from "../api-response";

const requireAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated?.()) return next();
  return sendError(res, 401, "UNAUTHORIZED", "Authentication is required.");
};

const requireRole =
  (roles: string[]): RequestHandler =>
  (req, res, next) => {
    const role = req.user?.role;
    if (role && roles.includes(role)) return next();
    return sendError(res, 403, "FORBIDDEN", "This action requires a higher permission level.", {
      details: { requiredRoles: roles, currentRole: role ?? null },
    });
  };

/**
 * Multi-Warehouse Transfer Routes
 * Handles inventory transfers between warehouses with approval workflows
 */
export function registerMultiWarehouseTransferRoutes(app: Router) {
  // GET all warehouse transfers
  app.get(
    "/api/warehouse-transfers",
    requireAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { status } = req.query;
        
        // In production, query the database
        // For now, return empty array (schema would need to be added)
        const transfers = status && status !== ""
          ? [] // Filter by status
          : [];

        return sendOk(res, transfers, 200, { count: transfers.length });
      } catch (error) {
        return sendError(
          res,
          500,
          "WAREHOUSE_TRANSFERS_FETCH_FAILED",
          error instanceof Error ? error.message : "Failed to fetch transfers",
        );
      }
    }
  );

  // POST create new warehouse transfer
  app.post(
    "/api/warehouse-transfers",
    requireAuthenticated,
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
          return sendError(
            res,
            400,
            "WAREHOUSE_TRANSFER_SAME_WAREHOUSE",
            "Source and destination warehouses must be different",
          );
        }

        const userId = req.user?.id;
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
        return sendOk(res, transfer, 201, { action: "created" });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", "Validation failed", {
            details: { errors: error.errors },
          });
        }
        return sendError(
          res,
          500,
          "WAREHOUSE_TRANSFER_CREATE_FAILED",
          error instanceof Error ? error.message : "Failed to create transfer",
        );
      }
    }
  );

  // PATCH update warehouse transfer status
  app.patch(
    "/api/warehouse-transfers/:id",
    requireAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { status, items } = req.body;

        if (!status) {
          return sendError(res, 400, "VALIDATION_ERROR", "Status is required");
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
          return sendError(res, 400, "VALIDATION_ERROR", "Invalid status");
        }

        const userId = req.user?.id;

        // In production, update in database
        const transfer = {
          id: Number(id),
          status,
          approvedByUserId: status === "approved" ? userId : undefined,
          approvedAt: status === "approved" ? new Date().toISOString() : undefined,
          receivedAt: status === "received" ? new Date().toISOString() : undefined,
          items: items || [],
        };

        return sendOk(res, transfer, 200, { action: "updated" });
      } catch (error) {
        return sendError(
          res,
          500,
          "WAREHOUSE_TRANSFER_UPDATE_FAILED",
          error instanceof Error ? error.message : "Failed to update transfer",
        );
      }
    }
  );

  // DELETE cancel warehouse transfer
  app.delete(
    "/api/warehouse-transfers/:id",
    requireAuthenticated,
    requireRole(["admin", "manager"]),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        return sendOk(res, { id }, 200, { action: "cancelled" });
      } catch (error) {
        return sendError(
          res,
          500,
          "WAREHOUSE_TRANSFER_CANCEL_FAILED",
          error instanceof Error ? error.message : "Failed to cancel transfer",
        );
      }
    }
  );
}
