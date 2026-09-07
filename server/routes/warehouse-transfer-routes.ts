import type { Router, Request, RequestHandler, Response } from "express";
import { sendError } from "../api-response";

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

function sendWarehouseTransfersUnavailable(res: Response) {
  return sendError(
    res,
    403,
    "FEATURE_DISABLED",
    "Multi-warehouse transfers are not enabled in this build because transfer persistence and stock movement settlement are not configured yet.",
    {
      hint: "Use Warehouse Operations for current inventory movement workflows. Enable this API only after transfer tables, approvals, stock movements, and tests are wired.",
      details: {
        feature: "warehouse_transfers",
        state: "planned",
      },
    },
  );
}

/**
 * Multi-Warehouse Transfer Routes
 * Handles inventory transfers between warehouses with approval workflows
 */
export function registerMultiWarehouseTransferRoutes(app: Router) {
  // GET all warehouse transfers
  app.get(
    "/api/warehouse-transfers",
    requireAuthenticated,
    async (_req: Request, res: Response) => {
      return sendWarehouseTransfersUnavailable(res);
    }
  );

  // POST create new warehouse transfer
  app.post(
    "/api/warehouse-transfers",
    requireAuthenticated,
    async (_req: Request, res: Response) => {
      return sendWarehouseTransfersUnavailable(res);
    }
  );

  // PATCH update warehouse transfer status
  app.patch(
    "/api/warehouse-transfers/:id",
    requireAuthenticated,
    async (_req: Request, res: Response) => {
      return sendWarehouseTransfersUnavailable(res);
    }
  );

  // DELETE cancel warehouse transfer
  app.delete(
    "/api/warehouse-transfers/:id",
    requireAuthenticated,
    requireRole(["admin", "manager"]),
    async (_req: Request, res: Response) => {
      return sendWarehouseTransfersUnavailable(res);
    }
  );
}
