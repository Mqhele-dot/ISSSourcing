import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { sendError, sendOk } from "../../api-response";
import { getApprovalSuggestions } from "../../approval-suggestions";
import { getActiveOrganizationId } from "../../organization-context";
import {
  insertApprovalPolicySchema,
  insertCarrierSchema,
  insertCommodityCodeSchema,
  insertCurrencySchema,
  insertCycleCountLineSchema,
  insertCycleCountSchema,
  insertDepartmentSchema,
  insertIncotermSchema,
  insertInventoryAllocationSchema,
  insertInventoryBatchSchema,
  insertInventorySerialSchema,
  insertPaymentTermSchema,
  insertRetentionPolicySchema,
  insertTaxCodeSchema,
  insertUnitOfMeasureSchema,
  approvalPolicies,
  approvalHistory,
  carriers,
  commodityCodes,
  currencies,
  cycleCountLines,
  cycleCounts,
  departments,
  documents,
  incoterms,
  inventoryAllocations,
  inventoryBatches,
  inventorySerials,
  paymentTerms,
  retentionPolicies,
  taxCodes,
  unitsOfMeasure,
} from "@shared/schema";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
};

function pgErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const c = (error as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

/**
 * Reference data CRUD, cycle count post, approval policies, retention, supplier portal context.
 */
export function registerMasterDataRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  const registerMasterDataCrud = <TInsert>(
    basePath: string,
    table: any,
    insertSchema: { parse: (input: unknown) => TInsert },
  ) => {
    app.get(basePath, ...masterRead, async (_req: Request, res: Response) => {
      try {
        const rows = await db.select().from(table);
        return sendOk(res, rows);
      } catch (error) {
        console.error(`Error fetching ${basePath}:`, error);
        return sendError(res, 500, "MASTER_DATA_LIST_FAILED", "Failed to fetch records");
      }
    });

    app.get(`${basePath}/:id`, ...masterRead, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid ID");
        const rows = (await db.select().from(table).where(eq(table.id, id))) as any[];
        const row = rows[0];
        if (!row) return sendError(res, 404, "NOT_FOUND", "Record not found");
        return sendOk(res, row);
      } catch (error) {
        console.error(`Error fetching ${basePath} item:`, error);
        return sendError(res, 500, "MASTER_DATA_GET_FAILED", "Failed to fetch record");
      }
    });

    app.post(basePath, ...masterWrite, async (req: Request, res: Response) => {
      try {
        const normalizedBody =
          basePath === "/api/currencies" &&
          req.body &&
          typeof req.body === "object" &&
          (!("symbol" in req.body) || !String((req.body as { symbol?: unknown }).symbol ?? "").trim())
            ? {
                ...(req.body as Record<string, unknown>),
                symbol: String((req.body as { code?: unknown }).code ?? "").trim().slice(0, 3) || "$",
              }
            : req.body;
        const payload = insertSchema.parse(normalizedBody) as any;
        const createdRows = (await db.insert(table).values(payload).returning()) as any[];
        const created = createdRows[0];
        return sendOk(res, created, 201);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
            details: error.flatten(),
          });
        }
        const pgCode = pgErrorCode(error);
        if (pgCode === "23505") {
          return sendError(
            res,
            400,
            "DUPLICATE_RECORD",
            "A record with this unique value already exists (for example duplicate batch number or serial).",
          );
        }
        console.error(`Error creating ${basePath}:`, error);
        return sendError(res, 500, "MASTER_DATA_CREATE_FAILED", "Failed to create record");
      }
    });

    app.patch(`${basePath}/:id`, ...masterWrite, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid ID");
        let patchBody = req.body;
        if (basePath === "/api/currencies" && patchBody && typeof patchBody === "object") {
          const rows = (await db.select().from(table).where(eq(table.id, id))) as Array<{
            code?: string;
            symbol?: string;
          }>;
          const existing = rows[0];
          if (!existing) return sendError(res, 404, "NOT_FOUND", "Record not found");
          const incoming = { ...(patchBody as Record<string, unknown>) };
          if (!("symbol" in incoming) || !String(incoming.symbol ?? "").trim()) {
            const codeStr = String(incoming.code ?? existing.code ?? "").trim();
            incoming.symbol = codeStr.slice(0, 3) || String(existing.symbol ?? "").trim() || "$";
          }
          patchBody = incoming;
        }
        const payload = (insertSchema as any).partial().parse(patchBody);
        const updatedRows = (await db.update(table).set(payload).where(eq(table.id, id)).returning()) as any[];
        const updated = updatedRows[0];
        if (!updated) return sendError(res, 404, "NOT_FOUND", "Record not found");
        return sendOk(res, updated);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
            details: error.flatten(),
          });
        }
        console.error(`Error updating ${basePath}:`, error);
        return sendError(res, 500, "MASTER_DATA_UPDATE_FAILED", "Failed to update record");
      }
    });

    app.delete(`${basePath}/:id`, ...masterWrite, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid ID");
        const deleted = (await db.delete(table).where(eq(table.id, id)).returning({ id: table.id })) as any[];
        if (deleted.length === 0) return sendError(res, 404, "NOT_FOUND", "Record not found");
        return res.status(204).send();
      } catch (error) {
        const pgCode = pgErrorCode(error);
        if (pgCode === "23503") {
          return sendError(
            res,
            400,
            "REFERENCED_RECORD",
            "Cannot delete: other records still reference this row.",
          );
        }
        console.error(`Error deleting ${basePath}:`, error);
        return sendError(res, 500, "MASTER_DATA_DELETE_FAILED", "Failed to delete record");
      }
    });
  };

  registerMasterDataCrud("/api/units-of-measure", unitsOfMeasure, insertUnitOfMeasureSchema as any);
  registerMasterDataCrud("/api/currencies", currencies, insertCurrencySchema as any);
  registerMasterDataCrud("/api/tax-codes", taxCodes, insertTaxCodeSchema as any);
  registerMasterDataCrud("/api/commodity-codes", commodityCodes, insertCommodityCodeSchema as any);
  registerMasterDataCrud("/api/incoterms", incoterms, insertIncotermSchema as any);
  registerMasterDataCrud("/api/payment-terms", paymentTerms, insertPaymentTermSchema as any);
  registerMasterDataCrud("/api/departments", departments, insertDepartmentSchema as any);
  registerMasterDataCrud("/api/carriers", carriers, insertCarrierSchema as any);
  registerMasterDataCrud("/api/inventory-batches", inventoryBatches, insertInventoryBatchSchema as any);
  registerMasterDataCrud("/api/inventory-serials", inventorySerials, insertInventorySerialSchema as any);
  registerMasterDataCrud("/api/inventory-allocations", inventoryAllocations, insertInventoryAllocationSchema as any);
  registerMasterDataCrud("/api/cycle-counts", cycleCounts, insertCycleCountSchema as any);
  registerMasterDataCrud("/api/cycle-count-lines", cycleCountLines, insertCycleCountLineSchema as any);

  app.post("/api/cycle-counts/:id/post", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid cycle count ID");

      const cycleCountRows = await db.select().from(cycleCounts).where(eq(cycleCounts.id, id));
      const cycleCount = cycleCountRows[0];
      if (!cycleCount) return sendError(res, 404, "NOT_FOUND", "Cycle count not found");

      const lines = await db.select().from(cycleCountLines).where(eq(cycleCountLines.cycleCountId, id));
      if (lines.length === 0) {
        return sendError(res, 400, "CYCLE_COUNT_EMPTY", "Cycle count has no lines to post");
      }

      let totalVariance = 0;
      const adjustments: Array<{ itemId: number; variance: number; movementId: number }> = [];
      for (const line of lines) {
        const counted = Number(line.countedQuantity ?? 0);
        const system = Number(line.systemQuantity ?? 0);
        const variance = counted - system;
        totalVariance += variance;

        await db
          .update(cycleCountLines)
          .set({ variance })
          .where(eq(cycleCountLines.id, line.id));

        if (variance !== 0) {
          const movement = await storage.createStockMovement({
            itemId: line.itemId,
            warehouseId: cycleCount.warehouseId,
            type: "ADJUSTMENT",
            quantity: variance,
            destinationWarehouseId: cycleCount.warehouseId,
            notes: `Cycle count #${id} adjustment`,
            referenceId: id,
            referenceType: "cycle_count",
            userId: (req as Request & { user?: { id: number } }).user?.id ?? null,
          } as any);
          adjustments.push({ itemId: line.itemId, variance, movementId: movement.id });
        }
      }

      const updatedRows = (await db
        .update(cycleCounts)
        .set({
          status: "completed",
          variance: totalVariance,
          countedBy: (req as Request & { user?: { id: number } }).user?.id ?? null,
          countDate: new Date(),
        } as any)
        .where(eq(cycleCounts.id, id))
        .returning()) as any[];
      const updated = updatedRows[0];

      return sendOk(res, {
        cycleCount: updated,
        adjustments,
        totalVariance,
      });
    } catch (error) {
      console.error("Error posting cycle count:", error);
      return sendError(res, 500, "CYCLE_COUNT_POST_FAILED", "Failed to post cycle count");
    }
  });

  app.get("/api/approval-policies", ...masterRead, async (_req, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(approvalPolicies)
        .where(eq(approvalPolicies.organizationId, getActiveOrganizationId()));
      return sendOk(res, rows);
    } catch (error) {
      console.error("Error fetching approval policies:", error);
      return sendError(res, 500, "APPROVAL_POLICIES_LIST_FAILED", "Failed to fetch approval policies");
    }
  });

  app.get("/api/approval-suggestions", ...masterRead, async (req: Request, res: Response) => {
    try {
      const entityType = String(req.query.entityType ?? "");
      const amount = Number(req.query.amount ?? NaN);
      if (!["requisition", "purchase_order", "invoice", "payment_batch"].includes(entityType)) {
        return sendError(
          res,
          400,
          "INVALID_ENTITY",
          "entityType must be requisition, purchase_order, invoice, or payment_batch",
        );
      }
      if (!Number.isFinite(amount) || amount < 0) {
        return sendError(res, 400, "INVALID_AMOUNT", "amount must be a non-negative number");
      }
      const out = await getApprovalSuggestions(
        entityType as "requisition" | "purchase_order" | "invoice" | "payment_batch",
        amount,
      );
      return sendOk(res, out);
    } catch (error) {
      console.error("Error building approval suggestions:", error);
      return sendError(res, 500, "SUGGESTIONS_FAILED", "Failed to load approval suggestions");
    }
  });

  app.post("/api/approval-policies", ...masterWrite, async (req, res) => {
    try {
      const payload = insertApprovalPolicySchema.parse({
        ...(req.body ?? {}),
        organizationId: getActiveOrganizationId(),
      });
      const createdRows = (await db.insert(approvalPolicies).values(payload).returning()) as any[];
      const created = createdRows[0];
      return sendOk(res, created, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: (error as ZodError).flatten(),
        });
      }
      console.error("Error creating approval policy:", error);
      return sendError(res, 500, "APPROVAL_POLICY_CREATE_FAILED", "Failed to create approval policy");
    }
  });

  app.patch("/api/approval-policies/:id", ...masterWrite, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid policy ID");
      const payload = insertApprovalPolicySchema.partial().parse(req.body);
      const updatedRows = (await db
        .update(approvalPolicies)
        .set(payload)
        .where(and(eq(approvalPolicies.id, id), eq(approvalPolicies.organizationId, getActiveOrganizationId())))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return sendError(res, 404, "NOT_FOUND", "Approval policy not found");
      return sendOk(res, updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: (error as ZodError).flatten(),
        });
      }
      console.error("Error updating approval policy:", error);
      return sendError(res, 500, "APPROVAL_POLICY_UPDATE_FAILED", "Failed to update approval policy");
    }
  });

  app.delete("/api/approval-policies/:id", ...masterWrite, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid policy ID");
      const deleted = await db
        .delete(approvalPolicies)
        .where(and(eq(approvalPolicies.id, id), eq(approvalPolicies.organizationId, getActiveOrganizationId())))
        .returning({ id: approvalPolicies.id });
      if (deleted.length === 0) return sendError(res, 404, "NOT_FOUND", "Approval policy not found");
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting approval policy:", error);
      return sendError(res, 500, "APPROVAL_POLICY_DELETE_FAILED", "Failed to delete approval policy");
    }
  });

  app.get("/api/approval-history/:entityType/:entityId", ...masterRead, async (req, res) => {
    try {
      const entityType = String(req.params.entityType);
      const entityId = Number(req.params.entityId);
      if (isNaN(entityId)) return sendError(res, 400, "INVALID_ENTITY_ID", "Invalid entity ID");
      const rows = await db
        .select()
        .from(approvalHistory)
        .where(
          and(
            eq(approvalHistory.organizationId, getActiveOrganizationId()),
            eq(approvalHistory.entityType, entityType),
            eq(approvalHistory.entityId, entityId),
          ),
        );
      return sendOk(res, rows);
    } catch (error) {
      console.error("Error fetching approval history:", error);
      return sendError(res, 500, "APPROVAL_HISTORY_FAILED", "Failed to fetch approval history");
    }
  });

  registerMasterDataCrud("/api/retention-policies", retentionPolicies, insertRetentionPolicySchema as any);

  app.post("/api/retention-policies/run", ...masterWrite, async (_req: Request, res: Response) => {
    try {
      const policies = await db.select().from(retentionPolicies);
      let archivedCount = 0;
      for (const policy of policies as any[]) {
        const years = Number(policy.retentionYears ?? 0);
        if (!Number.isFinite(years) || years <= 0) continue;
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - years);
        const updatedRows = (await db
          .update(documents)
          .set({ archivedAt: new Date() } as any)
          .where(
            and(
              eq(documents.entityType, String(policy.documentType ?? "")),
              isNull(documents.archivedAt),
              lte(documents.uploadedAt, cutoff),
            ),
          )
          .returning({ id: documents.id })) as any[];
        archivedCount += updatedRows.length;
      }
      return sendOk(res, { archivedCount });
    } catch (error) {
      console.error("Error running retention policy job:", error);
      return sendError(res, 500, "RETENTION_RUN_FAILED", "Failed to run retention policies");
    }
  });

  /** Supplier portal: maps authenticated supplier user → suppliers.id (see users.supplier_id). */
  app.get("/api/supplier/context", ...masterRead, async (req: Request, res: Response) => {
    const sessionUser = (req as Request & { user?: { id?: number; role?: string } }).user;
    const role = String(sessionUser?.role ?? "").toLowerCase();
    if (role !== "supplier") {
      return sendError(res, 403, "FORBIDDEN", "Supplier role required");
    }
    const uid = sessionUser?.id;
    if (uid == null) {
      return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    }
    const u = await storage.getUser(Number(uid));
    const mappedSupplierId = u?.supplierId != null ? Number(u.supplierId) : null;
    return sendOk(res, {
      mappedSupplierId,
      note:
        mappedSupplierId == null
          ? "Set Supplier ID on this user in Employee Profiles to scope portal orders."
          : null,
    });
  });
}
