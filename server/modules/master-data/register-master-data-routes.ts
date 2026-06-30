import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
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
  inventoryItems,
  inventoryAllocations,
  inventoryBatches,
  inventorySerials,
  paymentTerms,
  purchaseOrders,
  purchaseOrderItems,
  purchaseRequisitions,
  retentionPolicies,
  supplierContracts,
  suppliers,
  taxCodes,
  unitsOfMeasure,
} from "@shared/schema";
import {
  createImportBatch,
  createMdmDomainRecord,
  getImportBatchValidationReport,
  getMdmAudit,
  getMdmControlCentreHealth,
  getMdmDataQualityIssues,
  getPurchaseOrderContext,
  getRequisitionContext,
  isMdmDomain,
  listMdmDomain,
  previewDocumentSequence,
  scanMdmDataQuality,
  updateMdmDomainRecord,
  validateMdmTransaction,
} from "./mdm-control-centre";

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

type MasterDataDependency = {
  label: string;
  table: any;
  column: any;
};

const masterDataDeleteDependencies: Record<string, MasterDataDependency[]> = {
  "/api/units-of-measure": [
    { label: "inventory items", table: inventoryItems, column: inventoryItems.unitOfMeasureId },
  ],
  "/api/tax-codes": [
    { label: "suppliers", table: suppliers, column: suppliers.taxCodeId },
    { label: "purchase orders", table: purchaseOrders, column: purchaseOrders.taxCodeId },
  ],
  "/api/commodity-codes": [
    { label: "purchase order items", table: purchaseOrderItems, column: purchaseOrderItems.commodityCodeId },
  ],
  "/api/incoterms": [
    { label: "suppliers", table: suppliers, column: suppliers.incotermId },
    { label: "supplier contracts", table: supplierContracts, column: supplierContracts.incotermId },
    { label: "purchase orders", table: purchaseOrders, column: purchaseOrders.incotermId },
  ],
  "/api/payment-terms": [
    { label: "suppliers", table: suppliers, column: suppliers.paymentTermsId },
    { label: "supplier contracts", table: supplierContracts, column: supplierContracts.paymentTermsId },
    { label: "purchase orders", table: purchaseOrders, column: purchaseOrders.paymentTermsId },
  ],
  "/api/departments": [
    { label: "suppliers", table: suppliers, column: suppliers.defaultDepartmentId },
    { label: "purchase requisitions", table: purchaseRequisitions, column: purchaseRequisitions.departmentId },
    { label: "purchase orders", table: purchaseOrders, column: purchaseOrders.departmentId },
  ],
  "/api/carriers": [
    { label: "suppliers", table: suppliers, column: suppliers.defaultCarrierId },
  ],
  "/api/inventory-batches": [],
};

async function getDeleteDependencies(basePath: string, id: number) {
  const checks = masterDataDeleteDependencies[basePath] ?? [];
  const results = [];
  for (const check of checks) {
    const rows = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(check.table)
      .where(eq(check.column, id))) as Array<{ count: number }>;
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) results.push({ label: check.label, count });
  }
  return results;
}

function buildDependencyBlockedErrorMessage(
  action: "deactivate" | "delete",
  dependencies: Array<{ label: string; count: number }>,
) {
  const dependencySummary = dependencies.map((dependency) => `${dependency.count} ${dependency.label}`).join(", ");
  const actionLabel = action === "deactivate" ? "deactivate" : "delete";
  return `Cannot ${actionLabel} this master-data record while it is still referenced by ${dependencySummary}.`;
}

/**
 * Reference data CRUD, cycle count post, approval policies, retention, supplier portal context.
 */
export function registerMasterDataRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  function sessionUserId(req: Request): number | undefined {
    const id = (req as Request & { user?: { id?: unknown } }).user?.id;
    const n = Number(id);
    return Number.isFinite(n) ? n : undefined;
  }

  app.get("/api/mdm/control-centre/health", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getMdmControlCentreHealth(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error fetching MDM control-centre health:", error);
      return sendError(res, 500, "MDM_HEALTH_FAILED", "Failed to build Master Data control-centre health");
    }
  });

  app.get("/api/mdm/data-quality/issues", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getMdmDataQualityIssues(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error fetching MDM data-quality issues:", error);
      return sendError(res, 500, "MDM_DATA_QUALITY_FAILED", "Failed to fetch Master Data quality issues");
    }
  });

  app.post("/api/mdm/data-quality/scan", ...masterWrite, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await scanMdmDataQuality(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error scanning MDM data quality:", error);
      return sendError(res, 500, "MDM_DATA_QUALITY_SCAN_FAILED", "Failed to scan Master Data quality");
    }
  });

  app.get("/api/mdm/defaults/requisition-context", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getRequisitionContext(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error fetching MDM requisition context:", error);
      return sendError(res, 500, "MDM_REQUISITION_CONTEXT_FAILED", "Failed to load requisition Master Data context");
    }
  });

  app.get("/api/mdm/defaults/po-context", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getPurchaseOrderContext(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error fetching MDM PO context:", error);
      return sendError(res, 500, "MDM_PO_CONTEXT_FAILED", "Failed to load purchase order Master Data context");
    }
  });

  app.post("/api/mdm/validate-transaction", ...masterWrite, async (req: Request, res: Response) => {
    try {
      return sendOk(res, await validateMdmTransaction(getActiveOrganizationId(), req.body ?? {}));
    } catch (error) {
      console.error("Error validating MDM transaction:", error);
      return sendError(res, 500, "MDM_TRANSACTION_VALIDATION_FAILED", "Failed to validate transaction against Master Data");
    }
  });

  app.post("/api/mdm/document-sequences/preview", ...masterRead, async (req: Request, res: Response) => {
    try {
      return sendOk(res, await previewDocumentSequence(getActiveOrganizationId(), req.body ?? {}));
    } catch (error) {
      console.error("Error previewing MDM document sequence:", error);
      return sendError(res, 500, "MDM_SEQUENCE_PREVIEW_FAILED", "Failed to preview document sequence");
    }
  });

  app.post("/api/mdm/import-batches", ...masterWrite, async (req: Request, res: Response) => {
    try {
      return sendOk(res, await createImportBatch(getActiveOrganizationId(), req.body ?? {}, sessionUserId(req)), 201);
    } catch (error) {
      console.error("Error creating MDM import batch:", error);
      return sendError(res, 500, "MDM_IMPORT_BATCH_FAILED", "Failed to create import validation batch");
    }
  });

  app.get("/api/mdm/import-batches/:id/validation-report", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid import batch ID");
      const report = await getImportBatchValidationReport(getActiveOrganizationId(), id);
      if (!report) return sendError(res, 404, "NOT_FOUND", "Import batch not found");
      return sendOk(res, report);
    } catch (error) {
      console.error("Error fetching MDM import validation report:", error);
      return sendError(res, 500, "MDM_IMPORT_REPORT_FAILED", "Failed to fetch import validation report");
    }
  });

  app.get("/api/mdm/:domain/:id/audit", ...masterRead, async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      if (!isMdmDomain(domain)) return sendError(res, 404, "MDM_DOMAIN_NOT_FOUND", "Unknown MDM domain");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid MDM record ID");
      return sendOk(res, await getMdmAudit(domain, getActiveOrganizationId(), id));
    } catch (error) {
      console.error("Error fetching MDM audit:", error);
      return sendError(res, 500, "MDM_AUDIT_FAILED", "Failed to fetch MDM audit history");
    }
  });

  app.get("/api/mdm/:domain", ...masterRead, async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      if (!isMdmDomain(domain)) return sendError(res, 404, "MDM_DOMAIN_NOT_FOUND", "Unknown MDM domain");
      return sendOk(res, await listMdmDomain(domain, getActiveOrganizationId(), String(req.query.search ?? "")));
    } catch (error) {
      console.error("Error listing MDM domain:", error);
      return sendError(res, 500, "MDM_LIST_FAILED", "Failed to fetch MDM records");
    }
  });

  app.post("/api/mdm/:domain", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      if (!isMdmDomain(domain)) return sendError(res, 404, "MDM_DOMAIN_NOT_FOUND", "Unknown MDM domain");
      return sendOk(
        res,
        await createMdmDomainRecord(domain, getActiveOrganizationId(), req.body ?? {}, sessionUserId(req)),
        201,
      );
    } catch (error) {
      console.error("Error creating MDM record:", error);
      const pgCode = pgErrorCode(error);
      if (pgCode === "23505") {
        return sendError(res, 409, "MDM_DUPLICATE_RECORD", "A Master Data record with this key already exists.");
      }
      return sendError(res, 500, "MDM_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create MDM record");
    }
  });

  app.patch("/api/mdm/:domain/:id", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      if (!isMdmDomain(domain)) return sendError(res, 404, "MDM_DOMAIN_NOT_FOUND", "Unknown MDM domain");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid MDM record ID");
      const updated = await updateMdmDomainRecord(domain, getActiveOrganizationId(), id, req.body ?? {}, sessionUserId(req));
      if (!updated) return sendError(res, 404, "NOT_FOUND", "MDM record not found");
      return sendOk(res, updated);
    } catch (error) {
      console.error("Error updating MDM record:", error);
      if (error && typeof error === "object" && "code" in error && "status" in error) {
        const structured = error as { code?: unknown; status?: unknown; message?: unknown; usage?: unknown };
        const status = Number(structured.status);
        const code = typeof structured.code === "string" ? structured.code : "MDM_UPDATE_BLOCKED";
        const message = typeof structured.message === "string" ? structured.message : "Master Data update was blocked.";
        if (code === "MDM_RECORD_IN_USE" && Number.isFinite(status) && status >= 400 && status < 600) {
          return sendError(res, status, code, message, { details: { usage: structured.usage } });
        }
        if (Number.isFinite(status) && status >= 400 && status < 600) {
          return sendError(res, status, code, message, { details: { usage: structured.usage } });
        }
      }
      const pgCode = pgErrorCode(error);
      if (pgCode === "23505") {
        return sendError(res, 409, "MDM_DUPLICATE_RECORD", "A Master Data record with this key already exists.");
      }
      return sendError(res, 500, "MDM_UPDATE_FAILED", "Failed to update MDM record");
    }
  });

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
        if (req.query.deleteCheck === "true") {
          const dependencies = await getDeleteDependencies(basePath, id);
          return sendOk(res, {
            record: row,
            canDelete: dependencies.length === 0,
            requiresConfirmation: dependencies.length > 0,
            dependencies,
            message:
              dependencies.length > 0
                ? "This master-data record is used by other parts of the app. Review dependencies before deleting it."
                : "No known dependencies were found for this master-data record.",
          });
        }
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
        const isDeactivationRequest =
          patchBody &&
          typeof patchBody === "object" &&
          "active" in patchBody &&
          (patchBody as { active?: unknown }).active === false;
        if (isDeactivationRequest) {
          const dependencies = await getDeleteDependencies(basePath, id);
          if (dependencies.length > 0) {
            return sendError(
              res,
              409,
              "MASTER_DATA_RECORD_IN_USE",
              buildDependencyBlockedErrorMessage("deactivate", dependencies),
              {
                hint: "Reassign or close the dependent records before deactivating this master-data record.",
                details: {
                  action: "deactivate",
                  dependencies,
                },
              },
            );
          }
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
        const dependencies = await getDeleteDependencies(basePath, id);
        if (dependencies.length > 0) {
          return sendError(
            res,
            409,
            "MASTER_DATA_RECORD_IN_USE",
            buildDependencyBlockedErrorMessage("delete", dependencies),
            {
              hint: "Reassign or close the dependent records before deleting this master-data record.",
              details: {
                action: "delete",
                dependencies,
              },
            },
          );
        }
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
      if (req.user) {
        await storage.createActivityLog({
          action: "APPROVAL_POLICY_CREATED",
          description: `Created approval policy ${created.name}. New value: ${JSON.stringify(created)}. Reason: Admin approval-control update.`,
          userId: req.user.id,
          referenceType: "approval_policy",
          referenceId: created.id,
        });
      }
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
      const beforeRows = (await db
        .select()
        .from(approvalPolicies)
        .where(and(eq(approvalPolicies.id, id), eq(approvalPolicies.organizationId, getActiveOrganizationId())))
        .limit(1)) as any[];
      const updatedRows = (await db
        .update(approvalPolicies)
        .set(payload)
        .where(and(eq(approvalPolicies.id, id), eq(approvalPolicies.organizationId, getActiveOrganizationId())))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return sendError(res, 404, "NOT_FOUND", "Approval policy not found");
      if (req.user) {
        await storage.createActivityLog({
          action: "APPROVAL_POLICY_UPDATED",
          description: `Updated approval policy ${updated.name}. Old value: ${JSON.stringify(beforeRows[0] ?? null)}. New value: ${JSON.stringify(updated)}. Reason: Admin approval-control update.`,
          userId: req.user.id,
          referenceType: "approval_policy",
          referenceId: updated.id,
        });
      }
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
      if (req.user) {
        await storage.createActivityLog({
          action: "APPROVAL_POLICY_DELETED",
          description: `Deleted approval policy #${id}. Old value: ${JSON.stringify({ id })}. Reason: Admin approval-control update.`,
          userId: req.user.id,
          referenceType: "approval_policy",
          referenceId: id,
        });
      }
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
