import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { storage } from "../../storage";
import { db, pool } from "../../db";
import { sendError, sendFunctionError, sendOk } from "../../api-response";
import { emitNotification } from "../../services/notification-emitter";
import {
  insertPurchaseRequisitionSchema,
  insertPurchaseRequisitionItemSchema,
  insertPurchaseOrderSchema,
  insertPurchaseOrderItemSchema,
  departments,
  projects,
  approvalHistory,
  purchaseOrderRevisions,
  supplierContracts,
  paymentTerms,
  incoterms,
  currencies,
  taxCodes,
  mdmProcurementPolicies,
  purchaseOrders,
  sourcingAwards,
  sourcingEvents,
  workflowIdempotency,
  PurchaseRequisitionStatus,
  PurchaseOrderStatus,
  PaymentStatus,
  type InsertPurchaseRequisitionItem,
  type InsertPurchaseOrder,
  type InsertPurchaseOrderItem,
} from "@shared/schema";
import { canUpdatePurchaseOrder } from "@shared/purchase-order-status";
import { getActiveOrganizationId } from "../../organization-context";
import { getApplicableRequisitionPolicyForOrg, roleMatchesPolicy } from "./service";
import { applySupplierDefaultsToPurchaseOrder, assertSupplierTransactionAllowed } from "./supplier-defaults";
import { validatePurchaseOrderWorkflowReadiness } from "./po-validation";
import { validateMdmTransaction } from "../master-data/mdm-control-centre";
import type { AuthBundle } from "./types";
import { getReportingCurrencyCode } from "../../lib/org-reporting-money";
import { appendAuditEvent } from "../../services/audit-chain-service";

async function resolveWorkflowReplay(input: {
  organizationId: number;
  idempotencyKey: string;
  action: string;
  resourceId: number;
}) {
  if (!input.idempotencyKey) return null;
  const [existing] = await db
    .select()
    .from(workflowIdempotency)
    .where(
      and(
        eq(workflowIdempotency.organizationId, input.organizationId),
        eq(workflowIdempotency.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) return null;
  if (existing.action !== input.action || existing.resourceId !== input.resourceId) {
    return { conflict: true as const, existing };
  }
  return { conflict: false as const, existing };
}

async function recordWorkflowResult(input: {
  organizationId: number;
  idempotencyKey: string;
  action: string;
  resourceId: number;
  response: Record<string, unknown>;
}) {
  if (!input.idempotencyKey) return;
  await db
    .insert(workflowIdempotency)
    .values({
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      action: input.action,
      resourceType: "purchase_order",
      resourceId: input.resourceId,
      response: input.response,
    })
    .onConflictDoNothing();
}

async function assertRequisitionSourcingEvidence(input: {
  organizationId: number;
  requisitionId: number;
  reportingValue: number;
}): Promise<{ ok: true } | { ok: false; code: string; message: string; hint: string }> {
  const policies = await db
    .select({ config: mdmProcurementPolicies.config })
    .from(mdmProcurementPolicies)
    .where(
      and(
        eq(mdmProcurementPolicies.organizationId, input.organizationId),
        eq(mdmProcurementPolicies.policyType, "sourcing"),
        eq(mdmProcurementPolicies.active, true),
      ),
    );
  const policy = policies
    .map((row) => row.config ?? {})
    .find((config) => config.competitionRequired === true || config.competitionRequired === "true");
  const threshold = Number(policy?.competitionThreshold ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(threshold) || input.reportingValue < threshold) return { ok: true };
  const evidence = await db
    .select({ eventId: sourcingEvents.id, eventNumber: sourcingEvents.eventNumber, awardStatus: sourcingAwards.status })
    .from(sourcingEvents)
    .innerJoin(
      sourcingAwards,
      and(
        eq(sourcingAwards.eventId, sourcingEvents.id),
        eq(sourcingAwards.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(sourcingEvents.organizationId, input.organizationId),
        eq(sourcingEvents.requisitionId, input.requisitionId),
      ),
    );
  if (evidence.some((row) => ["APPROVED", "CONVERTED"].includes(String(row.awardStatus).toUpperCase()))) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "RFQ_EVIDENCE_REQUIRED",
    message: `This requisition exceeds the competitive sourcing threshold of ${threshold.toFixed(2)} in reporting currency.`,
    hint: "Create an RFQ, obtain compliant supplier responses, and complete independent award approval before PO conversion.",
  };
}

async function validateProjectIdForOrg(
  projectId: number | null | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (projectId == null) return { ok: true };
  const orgId = getActiveOrganizationId();
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1);
  if (!row) return { ok: false, message: "Project not found in this organization" };
  return { ok: true };
}

async function assertPurchaseOrderCommercialReferences(params: {
  organizationId: number;
  supplierId: number;
  patch: Pick<
    Partial<InsertPurchaseOrder>,
    "departmentId" | "contractId" | "paymentTermsId" | "incotermId"
  >;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const { organizationId, supplierId, patch } = params;

  if (patch.departmentId != null) {
    const [row] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, patch.departmentId), eq(departments.organizationId, organizationId)))
      .limit(1);
    if (!row) {
      return { ok: false, code: "PO_DEPARTMENT_NOT_FOUND", message: "Department not found for this organization." };
    }
  }

  if (patch.contractId != null) {
    const [row] = await db
      .select({ id: supplierContracts.id })
      .from(supplierContracts)
      .where(
        and(
          eq(supplierContracts.id, patch.contractId),
          eq(supplierContracts.organizationId, organizationId),
          eq(supplierContracts.supplierId, supplierId),
        ),
      )
      .limit(1);
    if (!row) {
      return {
        ok: false,
        code: "PO_CONTRACT_NOT_FOUND",
        message: "Contract not found for this supplier and organization.",
      };
    }
  }

  if (patch.paymentTermsId != null) {
    const [row] = await db
      .select({ id: paymentTerms.id })
      .from(paymentTerms)
      .where(and(eq(paymentTerms.id, patch.paymentTermsId), eq(paymentTerms.active, true)))
      .limit(1);
    if (!row) {
      return { ok: false, code: "PO_PAYMENT_TERMS_NOT_FOUND", message: "Payment terms not found or inactive." };
    }
  }

  if (patch.incotermId != null) {
    const [row] = await db
      .select({ id: incoterms.id })
      .from(incoterms)
      .where(and(eq(incoterms.id, patch.incotermId), eq(incoterms.active, true)))
      .limit(1);
    if (!row) {
      return { ok: false, code: "PO_INCOTERM_NOT_FOUND", message: "Incoterm not found or inactive." };
    }
  }

  return { ok: true };
}

async function assertPurchaseOrderTaxCodeAllowed(
  taxCodeId: number | null | undefined,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (taxCodeId == null) return { ok: true };
  const [row] = await db
    .select({ id: taxCodes.id })
    .from(taxCodes)
    .where(and(eq(taxCodes.id, taxCodeId), eq(taxCodes.active, true)))
    .limit(1);
  if (!row) {
    return { ok: false, code: "PO_TAX_CODE_NOT_FOUND", message: "Tax code not found or inactive." };
  }
  return { ok: true };
}

async function assertPurchaseOrderCurrencyCodeAllowed(
  currencyCode: string | null | undefined,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (currencyCode == null) return { ok: true };
  const code = String(currencyCode).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return { ok: false, code: "PO_CURRENCY_INVALID", message: "Currency must be a 3-letter ISO 4217 code." };
  }
  const [row] = await db
    .select({ id: currencies.id })
    .from(currencies)
    .where(and(eq(currencies.code, code), eq(currencies.active, true)))
    .limit(1);
  if (!row) {
    return {
      ok: false,
      code: "PO_CURRENCY_UNKNOWN",
      message: `Currency ${code} is not an active Master Data currency.`,
    };
  }
  return { ok: true };
}

async function resolveActiveCurrencyForRequisition(
  currencyCode: unknown,
): Promise<{ ok: true; currencyCode: string; exchangeRateToZar: number } | { ok: false; code: string; message: string }> {
  const reportingCurrency = await getReportingCurrencyCode(storage);
  const requested = String(currencyCode ?? reportingCurrency).trim().toUpperCase() || reportingCurrency;
  const rows = await db
    .select({ code: currencies.code, exchangeRateToZar: currencies.exchangeRateToZar })
    .from(currencies)
    .where(and(eq(currencies.code, requested), eq(currencies.active, true)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      code: "REQUISITION_CURRENCY_NOT_ACTIVE",
      message: `Currency ${requested} is not active in Master Data.`,
    };
  }
  let rate = requested === reportingCurrency ? 1 : 0;
  if (requested !== reportingCurrency) {
    const rateRows = await pool.query<{ rate: number }>(
      `SELECT rate FROM mdm_exchange_rates
       WHERE organization_id = $1
         AND upper(from_currency_code) = $2
         AND upper(to_currency_code) = $3
         AND COALESCE(active, TRUE) = TRUE
         AND effective_date <= NOW()
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY effective_date DESC
       LIMIT 1`,
      [getActiveOrganizationId(), requested, reportingCurrency],
    );
    rate = Number(rateRows.rows[0]?.rate ?? 0);
    if (rate <= 0 && reportingCurrency === "ZAR") rate = Number(row.exchangeRateToZar ?? 0);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      ok: false,
      code: "REQUISITION_EXCHANGE_RATE_INVALID",
      message: `Currency ${requested} needs a positive ${requested}/${reportingCurrency} exchange rate in Master Data.`,
    };
  }
  return { ok: true, currencyCode: row.code, exchangeRateToZar: rate };
}

const purchaseOrderCommercialPatchSchema = z
  .object({
    departmentId: z.union([z.number().int().positive(), z.null()]).optional(),
    contractId: z.union([z.number().int().positive(), z.null()]).optional(),
    paymentTermsId: z.union([z.number().int().positive(), z.null()]).optional(),
    incotermId: z.union([z.number().int().positive(), z.null()]).optional(),
    currencyCode: z
      .string()
      .length(3)
      .regex(/^[A-Za-z]{3}$/)
      .transform((c) => c.toUpperCase())
      .optional(),
    taxCodeId: z.union([z.number().int().positive(), z.null()]).optional(),
    confirmCurrencyOverride: z.boolean().optional(),
  })
  .strict();

function normalizeRequisitionLineInput(item: unknown, index: number) {
  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const lineType = String(row.lineType ?? "CATALOG").trim().toUpperCase();
  if (!(["CATALOG", "NON_STOCK", "SERVICE"] as const).includes(lineType as "CATALOG" | "NON_STOCK" | "SERVICE")) {
    throw Object.assign(new Error(`Line ${index + 1}: line type is invalid`), { status: 400, code: "REQUISITION_LINE_TYPE_INVALID" });
  }
  const itemIdValue = Number(row.itemId);
  const itemId = Number.isFinite(itemIdValue) && itemIdValue > 0 ? itemIdValue : null;
  const description = typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
  const manualEntryReason =
    typeof row.manualEntryReason === "string" && row.manualEntryReason.trim() ? row.manualEntryReason.trim() : null;
  const qty = Number(row.quantity);
  const unit = Number(row.unitPrice);
  if (lineType === "CATALOG" && !itemId) {
    throw Object.assign(new Error(`Line ${index + 1}: catalogue item is required`), { status: 400, code: "REQUISITION_CATALOG_ITEM_REQUIRED" });
  }
  if (lineType !== "CATALOG" && (!description || !manualEntryReason)) {
    throw Object.assign(new Error(`Line ${index + 1}: manual description and business reason are required`), { status: 400, code: "REQUISITION_MANUAL_LINE_DETAILS_REQUIRED" });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw Object.assign(new Error(`Line ${index + 1}: quantity must be greater than zero`), { status: 400, code: "REQUISITION_LINE_QUANTITY_INVALID" });
  }
  if (!Number.isFinite(unit) || unit <= 0) {
    throw Object.assign(new Error(`Line ${index + 1}: unit price must be greater than zero`), { status: 400, code: "REQUISITION_LINE_PRICE_INVALID" });
  }
  const id = row.id == null ? null : Number(row.id);
  const unitOfMeasureId = Number(row.unitOfMeasureId);
  const taxCodeId = Number(row.taxCodeId);
  const costCentreId = Number(row.costCentreId);
  const glAccountCode =
    typeof row.glAccountCode === "string" && row.glAccountCode.trim() ? row.glAccountCode.trim() : null;
  return {
    id: id !== null && Number.isFinite(id) && id > 0 ? id : undefined,
    itemId,
    lineNumber: index + 1,
    lineType,
    description,
    manualEntryReason,
    fulfilmentType: lineType === "SERVICE" ? "SERVICE_CONFIRMATION" : "GOODS_RECEIPT",
    receiptRequired: row.receiptRequired == null ? true : row.receiptRequired === true,
    quantity: qty,
    unitPrice: unit,
    totalPrice: qty * unit,
    unitOfMeasureId: Number.isFinite(unitOfMeasureId) && unitOfMeasureId > 0 ? unitOfMeasureId : null,
    taxCodeId: Number.isFinite(taxCodeId) && taxCodeId > 0 ? taxCodeId : null,
    costCentreId: Number.isFinite(costCentreId) && costCentreId > 0 ? costCentreId : null,
    glAccountCode,
    notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null,
  };
}

async function validateRequisitionLineMasterDataPolicy(
  items: Array<Pick<InsertPurchaseRequisitionItem, "unitOfMeasureId" | "taxCodeId">>,
): Promise<{ ok: true } | { ok: false; errors: Array<{ code: string; message: string; line: number }> }> {
  const policies = await pool.query<{ config: Record<string, unknown> | null }>(
    `
      SELECT config
      FROM mdm_procurement_policies
      WHERE organization_id = $1
        AND COALESCE(active, TRUE) = TRUE
        AND LOWER(COALESCE(policy_type, '')) IN ('requisition', 'purchase_order', 'procurement_control')
      ORDER BY id DESC
      LIMIT 1
    `,
    [getActiveOrganizationId()],
  );
  const config = policies.rows[0]?.config ?? {};
  const requireUom =
    config.requireUom === true ||
    config.requireUom === "true" ||
    config.requireUomConversion === true ||
    config.requireUomConversion === "true";
  const requireTaxCode = config.requireTaxCode === true || config.requireTaxCode === "true";
  const errors: Array<{ code: string; message: string; line: number }> = [];

  items.forEach((item, index) => {
    const line = index + 1;
    if (requireUom && !item.unitOfMeasureId) {
      errors.push({
        code: "REQUISITION_LINE_UOM_REQUIRED",
        message: `Line ${line}: purchase UOM is required by procurement policy.`,
        line,
      });
    }
    if (requireTaxCode && !item.taxCodeId) {
      errors.push({
        code: "REQUISITION_LINE_TAX_CODE_REQUIRED",
        message: `Line ${line}: tax code is required by procurement policy.`,
        line,
      });
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Domain PO list (`GET /api/purchase-orders` + `GET /api/procurement/purchase-orders/records`).
 * Must register **before** `registerOperationalRoutes` so `/records` is not captured by operational `/:po`.
 */
export function registerPurchaseOrderListRoutesBeforeOperationalMount(app: Express, auth: AuthBundle): void {
  const poRead = [auth.ensureAuthenticated];
  app.get(
    ["/api/purchase-orders", "/api/procurement/purchase-orders/records"],
    ...poRead,
    async (_req: Request, res: Response) => {
      try {
        const orders = await storage.getAllPurchaseOrders();
        return sendOk(res, orders);
      } catch (error) {
        console.error("Error fetching purchase orders:", error);
        return sendError(res, 500, "FETCH_PURCHASE_ORDERS_FAILED", "Failed to fetch purchase orders");
      }
    },
  );
}

/**
 * Purchase requisitions, purchase orders, line items, receive — org-scoped via storage.
 */
export function registerProcurementRoutes(app: Express, auth: AuthBundle): void {
  // Purchase Requisition & Purchase Order — RBAC: viewer read-only; manager/admin for create/update/delete/approve
  const poRead = [auth.ensureAuthenticated];
  const poWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "planner", "admin"])];
  const poCreate = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "create")];
  const poApprove = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("purchases", "approve")];
    app.get("/api/purchase-requisitions", ...poRead, async (_req: Request, res: Response) => {
    try {
      const requisitions = await storage.getAllPurchaseRequisitions();
      return sendOk(res, requisitions);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Error fetching purchase requisitions:", error);
      return sendError(res, 500, "FETCH_REQUISITIONS_FAILED", "Failed to fetch purchase requisitions", {
        details: process.env.NODE_ENV !== "production" ? { detail: errMsg } : undefined,
      });
    }
  });

  app.get("/api/purchase-requisitions/:id", ...poRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_REQUISITION_ID", "Invalid purchase requisition ID");
      }
      
      const requisition = await storage.getRequisitionWithDetails(id);
      
      if (!requisition) {
        return sendError(res, 404, "REQUISITION_NOT_FOUND", "Purchase requisition not found");
      }
      
      return sendOk(res, requisition);
    } catch (error) {
      console.error("Error fetching purchase requisition:", error);
      return sendError(res, 500, "FETCH_REQUISITION_FAILED", "Failed to fetch purchase requisition");
    }
  });

  app.post("/api/purchase-requisitions", ...poCreate, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "At least one item is required");
      }
      for (let i = 0; i < req.body.items.length; i++) {
        const it = req.body.items[i];
        if (Number(it?.quantity) <= 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: quantity must be greater than zero`);
        }
        const price = Number(it?.unitPrice);
        if (price < 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: unit price cannot be negative`);
        }
        if (price === 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: unit price must be greater than zero`);
        }
      }
      
      const requisitionInput = { ...(req.body ?? {}) } as Record<string, unknown>;
      // Generate business defaults before strict schema parsing.
      if (!requisitionInput.requisitionNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const entropy = `${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
        requisitionInput.requisitionNumber = `REQ-${year}${month}-${entropy}`;
      }
      if (!requisitionInput.status) {
        requisitionInput.status = PurchaseRequisitionStatus.PENDING;
      }
      if (typeof requisitionInput.requiredDate === "string" && requisitionInput.requiredDate.trim()) {
        const parsedRequiredDate = new Date(requisitionInput.requiredDate);
        if (!Number.isNaN(parsedRequiredDate.getTime())) {
          requisitionInput.requiredDate = parsedRequiredDate;
        }
      }
      await applySupplierDefaultsToPurchaseOrder(requisitionInput);
      const requisitionCurrency = await resolveActiveCurrencyForRequisition(requisitionInput.currencyCode);
      if (!requisitionCurrency.ok) {
        return sendError(res, 400, requisitionCurrency.code, requisitionCurrency.message);
      }
      requisitionInput.currencyCode = requisitionCurrency.currencyCode;
      requisitionInput.exchangeRateToZar = requisitionCurrency.exchangeRateToZar;

      const validatedReqData = insertPurchaseRequisitionSchema.parse(requisitionInput);
      const validatedItemsData: InsertPurchaseRequisitionItem[] = req.body.items.map((item: unknown, index: number) => {
        const normalized = normalizeRequisitionLineInput(item, index);
        return {
          itemId: normalized.itemId,
          lineNumber: normalized.lineNumber,
          lineType: normalized.lineType,
          description: normalized.description,
          manualEntryReason: normalized.manualEntryReason,
          fulfilmentType: normalized.fulfilmentType,
          receiptRequired: normalized.receiptRequired,
          quantity: normalized.quantity,
          unitPrice: normalized.unitPrice,
          totalPrice: normalized.totalPrice,
          unitOfMeasureId: normalized.unitOfMeasureId,
          taxCodeId: normalized.taxCodeId,
          costCentreId: normalized.costCentreId,
          glAccountCode: normalized.glAccountCode,
          notes: normalized.notes,
        };
      });
      if (!validatedReqData.supplierId) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Supplier is required");
      }
      const linePolicyValidation = await validateRequisitionLineMasterDataPolicy(validatedItemsData);
      if (!linePolicyValidation.ok) {
        return sendError(
          res,
          400,
          "REQUISITION_LINE_MDM_VALIDATION_FAILED",
          "Requisition line Master Data validation failed.",
          { details: { errors: linePolicyValidation.errors } },
        );
      }
      const supplier = await storage.getSupplier(Number(validatedReqData.supplierId));
      if (!supplier) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Supplier does not exist");
      }
      assertSupplierTransactionAllowed(
        {
          supplierName: supplier.name,
          status: supplier.status,
          complianceStatus: supplier.complianceStatus,
          blockedReason: supplier.blockedReason,
        },
        "new requisitions",
      );
      if (validatedReqData.departmentId) {
        const deptRows = await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, Number(validatedReqData.departmentId)))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", "Department does not exist");
        }
      }
      const mdmValidation = await validateMdmTransaction(getActiveOrganizationId(), {
        transactionType: "requisition",
        supplierId: validatedReqData.supplierId,
        itemIds: validatedItemsData.map((item) => item.itemId).filter((itemId): itemId is number => itemId != null),
        currencyCode: validatedReqData.currencyCode,
      });
      if (!mdmValidation.valid) {
        return sendError(
          res,
          400,
          "REQUISITION_MDM_VALIDATION_FAILED",
          "Master Data validation blocked this requisition.",
          { details: mdmValidation },
        );
      }
      const projectCheck = await validateProjectIdForOrg(validatedReqData.projectId ?? undefined);
      if (!projectCheck.ok) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", projectCheck.message);
      }

      const newRequisition = await storage.createPurchaseRequisition(
        validatedReqData, 
        validatedItemsData
      );
      
      return sendOk(res, newRequisition, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendFunctionError(res, 400, "createPurchaseRequisition", validationError.message);
      }
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to create purchase requisition");
      }
      console.error("Error creating purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "createPurchaseRequisition",
        "Failed to create purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.put("/api/purchase-requisitions/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "updatePurchaseRequisition", "Invalid purchase requisition ID");
      }
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const { items, revisionReason: _revisionReason, ...headerPatch } = body;
      const requisitionPatch: Record<string, unknown> = { ...headerPatch };
      // Match POST: JSON sends requiredDate as ISO string; insert schema expects Date.
      if (typeof requisitionPatch.requiredDate === "string") {
        const trimmed = requisitionPatch.requiredDate.trim();
        if (!trimmed) {
          delete requisitionPatch.requiredDate;
        } else {
          const parsedRequiredDate = new Date(trimmed);
          if (Number.isNaN(parsedRequiredDate.getTime())) {
            return sendFunctionError(
              res,
              400,
              "updatePurchaseRequisition",
              "requiredDate must be a valid ISO date string",
            );
          }
          requisitionPatch.requiredDate = parsedRequiredDate;
        }
      }
      if (Object.prototype.hasOwnProperty.call(requisitionPatch, "currencyCode")) {
        const requisitionCurrency = await resolveActiveCurrencyForRequisition(requisitionPatch.currencyCode);
        if (!requisitionCurrency.ok) {
          return sendError(res, 400, requisitionCurrency.code, requisitionCurrency.message);
        }
        requisitionPatch.currencyCode = requisitionCurrency.currencyCode;
        requisitionPatch.exchangeRateToZar = requisitionCurrency.exchangeRateToZar;
      }
      const validatedData = insertPurchaseRequisitionSchema.partial().parse(requisitionPatch);
      if (validatedData.supplierId != null) {
        const supplier = await storage.getSupplier(Number(validatedData.supplierId));
        if (!supplier) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Supplier does not exist");
        }
        assertSupplierTransactionAllowed(
          {
            supplierName: supplier.name,
            status: supplier.status,
            complianceStatus: supplier.complianceStatus,
            blockedReason: supplier.blockedReason,
          },
          "updated requisitions",
        );
      }
      if (validatedData.departmentId != null) {
        const deptRows = await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, Number(validatedData.departmentId)))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Department does not exist");
        }
      }
      const projectCheckPut = await validateProjectIdForOrg(validatedData.projectId ?? undefined);
      if (!projectCheckPut.ok) {
        return sendFunctionError(res, 400, "updatePurchaseRequisition", projectCheckPut.message);
      }
      let updatedRequisition = await storage.updatePurchaseRequisition(id, validatedData);
      
      if (!updatedRequisition) {
        return sendFunctionError(res, 404, "updatePurchaseRequisition", "Purchase requisition not found");
      }

      if (Array.isArray(items)) {
        if (items.length === 0) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "At least one requisition line is required");
        }
        const normalizedLines = items.map((item, index) => normalizeRequisitionLineInput(item, index));
        const linePolicyValidation = await validateRequisitionLineMasterDataPolicy(normalizedLines);
        if (!linePolicyValidation.ok) {
          return sendError(
            res,
            400,
            "REQUISITION_LINE_MDM_VALIDATION_FAILED",
            "Requisition line Master Data validation failed.",
            { details: { errors: linePolicyValidation.errors } },
          );
        }
        const existingLines = await storage.getPurchaseRequisitionItems(id);
        const existingById = new Map(existingLines.map((line) => [line.id, line]));
        const keptIds = new Set<number>();
        for (const line of normalizedLines) {
          const payload = {
            requisitionId: id,
            itemId: line.itemId,
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            description: line.description,
            manualEntryReason: line.manualEntryReason,
            fulfilmentType: line.fulfilmentType,
            receiptRequired: line.receiptRequired,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            totalPrice: line.totalPrice,
            unitOfMeasureId: line.unitOfMeasureId,
            taxCodeId: line.taxCodeId,
            costCentreId: line.costCentreId,
            glAccountCode: line.glAccountCode,
            notes: line.notes,
          };
          if (line.id && existingById.has(line.id)) {
            await storage.updatePurchaseRequisitionItem(line.id, payload);
            keptIds.add(line.id);
          } else {
            const created = await storage.addPurchaseRequisitionItem(payload);
            keptIds.add(created.id);
          }
        }
        for (const existing of existingLines) {
          if (!keptIds.has(existing.id)) {
            await storage.deletePurchaseRequisitionItem(existing.id);
          }
        }
        const totalAmount = normalizedLines.reduce((sum, line) => sum + line.totalPrice, 0);
        updatedRequisition = await storage.updatePurchaseRequisition(id, { totalAmount }) ?? updatedRequisition;
        await storage.createActivityLog({
          action: "Requisition Lines Revised",
          description: `Revised ${normalizedLines.length} line(s) on requisition ${updatedRequisition.requisitionNumber}`,
          referenceType: "requisition",
          referenceId: id,
          userId: (req as Request & { user?: { id?: number } }).user?.id ?? null,
        }).catch(() => {});
        await db.insert(approvalHistory).values({
          organizationId: getActiveOrganizationId(),
          entityType: "requisition",
          entityId: id,
          level: 0,
          action: "revised",
          performedBy: Number((req as Request & { user?: { id?: number } }).user?.id ?? 0),
          previousStatus: updatedRequisition.status,
          newStatus: updatedRequisition.status,
          comment: typeof body.revisionReason === "string" ? body.revisionReason : "Requisition lines revised",
        } as any).catch(() => {});
      }
      
      return sendOk(res, updatedRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendFunctionError(res, 400, "updatePurchaseRequisition", validationError.message);
      }
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to update purchase requisition");
      }
      console.error("Error updating purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "updatePurchaseRequisition",
        "Failed to update purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.delete("/api/purchase-requisitions/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_REQUISITION_ID", "Invalid purchase requisition ID");
      }
      
      const success = await storage.deletePurchaseRequisition(id);
      
      if (!success) {
        return sendError(res, 404, "REQUISITION_NOT_FOUND", "Purchase requisition not found");
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase requisition:", error);
      return sendError(res, 500, "DELETE_REQUISITION_FAILED", "Failed to delete purchase requisition");
    }
  });

  app.post("/api/purchase-requisitions/:id/approve", ...poApprove, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "approvePurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const approverId = req.body?.approverId != null ? Number(req.body.approverId) : (req as any).user?.id ?? 0;
      const approverRole = String((req as any).user?.role ?? "");
      const existing = await storage.getPurchaseRequisition(id);
      if (!existing) return sendFunctionError(res, 404, "approvePurchaseRequisition", "Purchase requisition not found");
      if (![PurchaseRequisitionStatus.PENDING, PurchaseRequisitionStatus.DRAFT].includes(existing.status as PurchaseRequisitionStatus)) {
        return sendFunctionError(
          res,
          409,
          "approvePurchaseRequisition",
          `Requisition must be PENDING or DRAFT before approval; current status is ${existing.status}`,
        );
      }
      if (existing.requestorId != null && approverId === existing.requestorId && approverRole.toLowerCase() !== "admin") {
        return sendFunctionError(res, 403, "approvePurchaseRequisition", "Requester cannot approve their own requisition");
      }
      const requisitionTotal = Number(existing.totalAmount ?? 0);
      const approverUser = await storage.getUser(approverId);
      const userCap = approverUser?.approverAmountLimit != null ? Number(approverUser.approverAmountLimit) : null;
      if (userCap != null && userCap > 0 && requisitionTotal > userCap) {
        return sendFunctionError(
          res,
          403,
          "approvePurchaseRequisition",
          `Requisition total exceeds your approver limit (${userCap.toFixed(2)}).`,
        );
      }
      const applicable = await getApplicableRequisitionPolicyForOrg(getActiveOrganizationId(), requisitionTotal);
      if (applicable) {
        if (applicable.approverUserId != null && Number(applicable.approverUserId) !== approverId) {
          return sendFunctionError(res, 403, "approvePurchaseRequisition", "Only the configured approver can approve this requisition");
        }
        if (!roleMatchesPolicy(applicable.approverRole, approverRole)) {
          return sendFunctionError(res, 403, "approvePurchaseRequisition", "Your role is not allowed to approve this requisition amount");
        }
      }
      
      const updatedRequisition = await storage.approvePurchaseRequisition(id, approverId);
      
      if (!updatedRequisition) return sendFunctionError(res, 404, "approvePurchaseRequisition", "Purchase requisition not found");
      await db.insert(approvalHistory).values({
        organizationId: getActiveOrganizationId(),
        entityType: "requisition",
        entityId: id,
        level: Number(applicable?.approvalLevel ?? 1),
        action: "approved",
        performedBy: approverId,
        previousStatus: existing.status,
        newStatus: updatedRequisition.status,
        comment: typeof req.body?.comment === "string" ? req.body.comment : null,
      } as any);
      if (existing.requestorId) {
        await emitNotification({
          userId: Number(existing.requestorId),
          type: "approval_request",
          title: `Requisition ${existing.requisitionNumber ?? `#${id}`} approved`,
          body: `Your requisition has been approved.`,
          entityType: "requisition",
          entityId: id,
        });
      }
      
      return sendOk(res, updatedRequisition);
    } catch (error) {
      console.error("Error approving purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "approvePurchaseRequisition",
        "Failed to approve purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/reject", ...poApprove, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "rejectPurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const approverId = req.body?.approverId != null ? Number(req.body.approverId) : (req as any).user?.id ?? 0;
      const approverRole = String((req as any).user?.role ?? "");
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const existing = await storage.getPurchaseRequisition(id);
      if (!existing) return sendFunctionError(res, 404, "rejectPurchaseRequisition", "Purchase requisition not found");
      if (existing.requestorId != null && approverId === existing.requestorId && approverRole.toLowerCase() !== "admin") {
        return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Requester cannot reject their own requisition");
      }
      const requisitionTotal = Number(existing.totalAmount ?? 0);
      const applicable = await getApplicableRequisitionPolicyForOrg(getActiveOrganizationId(), requisitionTotal);
      if (applicable) {
        if (applicable.approverUserId != null && Number(applicable.approverUserId) !== approverId) {
          return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Only the configured approver can reject this requisition");
        }
        if (!roleMatchesPolicy(applicable.approverRole, approverRole)) {
          return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Your role is not allowed to reject this requisition amount");
        }
      }
      
      const updatedRequisition = await storage.rejectPurchaseRequisition(id, approverId, reason);
      
      if (!updatedRequisition) return sendFunctionError(res, 404, "rejectPurchaseRequisition", "Purchase requisition not found");
      await db.insert(approvalHistory).values({
        organizationId: getActiveOrganizationId(),
        entityType: "requisition",
        entityId: id,
        level: Number(applicable?.approvalLevel ?? 1),
        action: "rejected",
        performedBy: approverId,
        previousStatus: existing.status,
        newStatus: updatedRequisition.status,
        comment: reason || null,
      } as any);
      if (existing.requestorId) {
        await emitNotification({
          userId: Number(existing.requestorId),
          type: "approval_request",
          title: `Requisition ${existing.requisitionNumber ?? `#${id}`} rejected`,
          body: reason || "Your requisition has been rejected.",
          entityType: "requisition",
          entityId: id,
        });
      }
      
      return sendOk(res, updatedRequisition);
    } catch (error) {
      console.error("Error rejecting purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "rejectPurchaseRequisition",
        "Failed to reject purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/convert", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "convertPurchaseRequisitionToPO", "Invalid purchase requisition ID");
      }
      
      const organizationId = getActiveOrganizationId();
      const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
      if (process.env.NODE_ENV === "production" && !idempotencyKey) {
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for requisition conversion.", {
          hint: "Retry with one stable unique key for this conversion action.",
        });
      }
      if (idempotencyKey) {
        const [duplicate] = await db
          .select()
          .from(workflowIdempotency)
          .where(
            and(
              eq(workflowIdempotency.organizationId, organizationId),
              eq(workflowIdempotency.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (duplicate) {
          if (duplicate.action !== "REQUISITION_CONVERT_TO_PO") {
            return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another workflow action.");
          }
          const purchaseOrderId = Number((duplicate.response as Record<string, unknown> | null)?.purchaseOrderId ?? 0);
          const existingOrder = purchaseOrderId ? await storage.getPurchaseOrder(purchaseOrderId) : undefined;
          if (existingOrder) return sendOk(res, { ...existingOrder, duplicate: true });
        }
      }
      const requisition = await storage.getPurchaseRequisition(id);
      if (!requisition) return sendError(res, 404, "REQUISITION_NOT_FOUND", "Purchase requisition not found.");
      const sourcingEvidence = await assertRequisitionSourcingEvidence({
        organizationId,
        requisitionId: id,
        reportingValue: Number(requisition.totalAmount ?? 0) * Number(requisition.exchangeRateToZar ?? 1),
      });
      if (!sourcingEvidence.ok) {
        return sendError(res, 409, sourcingEvidence.code, sourcingEvidence.message, { hint: sourcingEvidence.hint });
      }
      const purchaseOrder = await storage.createPurchaseOrderFromRequisition(id);

      if (!purchaseOrder) {
        return sendError(
          res,
          404,
          "CONVERT_REQUISITION_FAILED",
          "Could not convert: the requisition must exist, be approved, and have valid lines and supplier.",
        );
      }

      const actorUserId = Number(req.user?.id);
      const [attributedOrder] = await db
        .update(purchaseOrders)
        .set({ createdByUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, purchaseOrder.id), eq(purchaseOrders.organizationId, organizationId)))
        .returning();
      if (idempotencyKey) {
        await db.insert(workflowIdempotency).values({
          organizationId,
          idempotencyKey,
          action: "REQUISITION_CONVERT_TO_PO",
          resourceType: "purchase_order",
          resourceId: purchaseOrder.id,
          response: { purchaseOrderId: purchaseOrder.id },
        });
      }
      await appendAuditEvent({
        organizationId,
        actor: { userId: actorUserId },
        action: "REQUISITION_CONVERTED_TO_PO",
        resourceType: "purchase_order",
        resourceId: purchaseOrder.id,
        before: { requisitionId: id, requisitionStatus: requisition.status },
        after: attributedOrder ?? purchaseOrder,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });

      return sendOk(res, attributedOrder ?? purchaseOrder, 201);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to convert requisition to purchase order");
      }
      console.error("Error converting requisition to purchase order:", error);
      return sendFunctionError(
        res,
        500,
        "convertPurchaseRequisitionToPO",
        "Failed to convert requisition to purchase order",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/share", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id < 1) {
        return sendError(res, 400, "INVALID_ID", "Invalid purchase requisition ID");
      }
      const { userIds } = req.body as { userIds?: number[] };
      if (!Array.isArray(userIds)) {
        return sendError(res, 400, "INVALID_BODY", "userIds must be an array of user IDs");
      }
      const normalized = userIds
        .map((u) => Number(u))
        .filter((u) => Number.isFinite(u) && u >= 1);
      if (normalized.length !== userIds.length) {
        return sendError(res, 400, "INVALID_USER_IDS", "userIds must contain only positive integer user IDs");
      }
      const updated = await storage.updatePurchaseRequisition(id, { sharedWithUserIds: normalized });
      if (!updated) {
        return sendError(res, 404, "NOT_FOUND", "Purchase requisition not found");
      }
      return sendOk(res, updated);
    } catch (error) {
      console.error("Error sharing requisition:", error);
      return sendError(res, 500, "SHARE_REQUISITION_FAILED", "Failed to share requisition");
    }
  });

  // Purchase Requisition Items endpoints
  app.get("/api/purchase-requisitions/:reqId/items", ...poRead, async (req: Request, res: Response) => {
    try {
      const reqId = Number(req.params.reqId);
      if (isNaN(reqId)) {
        return sendError(res, 400, "INVALID_REQUISITION_ID", "Invalid purchase requisition ID");
      }

      const requisition = await storage.getPurchaseRequisition(reqId);
      if (!requisition) {
        return sendError(res, 404, "REQUISITION_NOT_FOUND", "Purchase requisition not found");
      }

      const items = await storage.getPurchaseRequisitionItems(reqId);
      return sendOk(res, items);
    } catch (error) {
      console.error("Error fetching purchase requisition items:", error);
      return sendError(res, 500, "FETCH_REQUISITION_ITEMS_FAILED", "Failed to fetch purchase requisition items");
    }
  });

  app.post("/api/purchase-requisitions/:reqId/items", ...poWrite, async (req: Request, res: Response) => {
    try {
      const reqId = Number(req.params.reqId);
      if (isNaN(reqId)) {
        return sendError(res, 400, "INVALID_REQUISITION_ID", "Invalid purchase requisition ID");
      }
      
      const validatedData = insertPurchaseRequisitionItemSchema.parse({
        ...req.body,
        requisitionId: reqId
      });
      
      const newItem = await storage.addPurchaseRequisitionItem(validatedData);
      return sendOk(res, newItem, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendError(res, 400, "VALIDATION_ERROR", validationError.message);
      } else {
        console.error("Error adding purchase requisition item:", error);
        return sendError(res, 500, "ADD_REQUISITION_ITEM_FAILED", "Failed to add purchase requisition item");
      }
    }
  });

  app.put("/api/purchase-requisitions-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_REQUISITION_ITEM_ID", "Invalid purchase requisition item ID");
      }
      
      const validatedData = insertPurchaseRequisitionItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updatePurchaseRequisitionItem(id, validatedData);
      
      if (!updatedItem) {
        return sendError(res, 404, "REQUISITION_ITEM_NOT_FOUND", "Purchase requisition item not found");
      }
      
      return sendOk(res, updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendError(res, 400, "VALIDATION_ERROR", validationError.message);
      } else {
        console.error("Error updating purchase requisition item:", error);
        return sendError(res, 500, "UPDATE_REQUISITION_ITEM_FAILED", "Failed to update purchase requisition item");
      }
    }
  });

  app.delete("/api/purchase-requisitions-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_REQUISITION_ITEM_ID", "Invalid purchase requisition item ID");
      }
      
      const success = await storage.deletePurchaseRequisitionItem(id);
      
      if (!success) {
        return sendError(res, 404, "REQUISITION_ITEM_NOT_FOUND", "Purchase requisition item not found");
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase requisition item:", error);
      return sendError(res, 500, "DELETE_REQUISITION_ITEM_FAILED", "Failed to delete purchase requisition item");
    }
  });

  // Purchase Order endpoints (same RBAC as requisitions) — list routes registered early in routes.ts

  app.get(
    ["/api/purchase-orders/:id", "/api/procurement/purchase-orders/records/:id"],
    ...poRead,
    async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const order = await storage.getPurchaseOrderWithDetails(id);
      
      if (!order) {
        return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      }
      
      return sendOk(res, order);
    } catch (error) {
      console.error("Error fetching purchase order:", error);
      return sendError(res, 500, "FETCH_PURCHASE_ORDER_FAILED", "Failed to fetch purchase order");
    }
  },
  );

  app.post("/api/purchase-orders", ...poWrite, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return sendError(res, 400, "ITEMS_REQUIRED", "At least one item is required");
      }
      
      const purchaseOrderInput = { ...(req.body ?? {}) } as Record<string, unknown>;
      // Generate business defaults before strict schema parsing.
      if (!purchaseOrderInput.orderNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
        purchaseOrderInput.orderNumber = `PO-${year}${month}-${random}`;
      }
      if (!purchaseOrderInput.status) {
        purchaseOrderInput.status = PurchaseOrderStatus.DRAFT;
      }
      purchaseOrderInput.approvalStatus = "DRAFT";
      purchaseOrderInput.createdByUserId = Number(req.user?.id) || null;
      if (
        process.env.NODE_ENV === "production"
        && !Number(purchaseOrderInput.requisitionId)
        && !Number(purchaseOrderInput.sourcingAwardId)
      ) {
        return sendError(res, 409, "PO_SOURCE_REQUIRED", "Production purchase orders must originate from an approved requisition or sourcing award.", {
          hint: "Complete requisition approval or controlled RFQ award conversion first.",
        });
      }
      if (typeof purchaseOrderInput.orderDate === "string" && purchaseOrderInput.orderDate.trim()) {
        const parsedOrderDate = new Date(purchaseOrderInput.orderDate);
        if (!Number.isNaN(parsedOrderDate.getTime())) {
          purchaseOrderInput.orderDate = parsedOrderDate;
        }
      }
      if (
        typeof purchaseOrderInput.expectedDeliveryDate === "string" &&
        purchaseOrderInput.expectedDeliveryDate.trim()
      ) {
        const parsedExpectedDate = new Date(purchaseOrderInput.expectedDeliveryDate);
        if (!Number.isNaN(parsedExpectedDate.getTime())) {
          purchaseOrderInput.expectedDeliveryDate = parsedExpectedDate;
        }
      }

      await applySupplierDefaultsToPurchaseOrder(purchaseOrderInput);
      const validatedOrderData = insertPurchaseOrderSchema.parse(purchaseOrderInput);
      if (validatedOrderData.requisitionId) {
        const sourceRequisition = await storage.getPurchaseRequisition(validatedOrderData.requisitionId);
        if (!sourceRequisition || String(sourceRequisition.status).toUpperCase() !== "APPROVED") {
          return sendError(res, 409, "REQUISITION_NOT_APPROVED", "The source requisition must be approved and belong to this organization.");
        }
      }
      const validatedItemsData: InsertPurchaseOrderItem[] = req.body.items.map((item: any, index: number) => {
        const qty = Number(item?.quantity);
        const unit = Number(item?.unitPrice);
        const itemId = Number(item?.itemId);
        if (!Number.isFinite(itemId) || itemId <= 0) {
          throw new Error(`createPurchaseOrder:item_${index + 1}_itemId_invalid`);
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`createPurchaseOrder:item_${index + 1}_quantity_invalid`);
        }
        if (!Number.isFinite(unit) || unit <= 0) {
          throw new Error(`createPurchaseOrder:item_${index + 1}_unitPrice_invalid`);
        }
        const providedTotal = Number(item?.totalPrice);
        const totalPrice =
          Number.isFinite(providedTotal) && providedTotal > 0 ? providedTotal : qty * unit;
        const unitOfMeasureId = Number(item?.unitOfMeasureId);
        const taxCodeId = Number(item?.taxCodeId);
        const costCentreId = Number(item?.costCentreId);
        const glAccountCode =
          typeof item?.glAccountCode === "string" && item.glAccountCode.trim() ? item.glAccountCode.trim() : null;
        return {
          itemId,
          quantity: qty,
          unitPrice: unit,
          totalPrice,
          unitOfMeasureId: Number.isFinite(unitOfMeasureId) && unitOfMeasureId > 0 ? unitOfMeasureId : null,
          taxCodeId: Number.isFinite(taxCodeId) && taxCodeId > 0 ? taxCodeId : null,
          costCentreId: Number.isFinite(costCentreId) && costCentreId > 0 ? costCentreId : null,
          glAccountCode,
          notes: typeof item?.notes === "string" ? item.notes : null,
        };
      });
      const projectCheckPo = await validateProjectIdForOrg(validatedOrderData.projectId ?? undefined);
      if (!projectCheckPo.ok) {
        return sendError(res, 400, "INVALID_PROJECT", projectCheckPo.message);
      }
      const currencyValidation = await assertPurchaseOrderCurrencyCodeAllowed(validatedOrderData.currencyCode);
      if (!currencyValidation.ok) {
        return sendError(res, 400, currencyValidation.code, currencyValidation.message);
      }
      const taxValidation = await assertPurchaseOrderTaxCodeAllowed(validatedOrderData.taxCodeId);
      if (!taxValidation.ok) {
        return sendError(res, 400, taxValidation.code, taxValidation.message);
      }
      const refCheck = await assertPurchaseOrderCommercialReferences({
        organizationId: getActiveOrganizationId(),
        supplierId: validatedOrderData.supplierId,
        patch: {
          departmentId: validatedOrderData.departmentId,
          contractId: validatedOrderData.contractId,
          paymentTermsId: validatedOrderData.paymentTermsId,
          incotermId: validatedOrderData.incotermId,
        },
      });
      if (!refCheck.ok) {
        return sendError(res, 400, refCheck.code, refCheck.message);
      }

      const workflowValidation = await validatePurchaseOrderWorkflowReadiness({
        organizationId: getActiveOrganizationId(),
        currencyCode: validatedOrderData.currencyCode,
        taxCodeId: validatedOrderData.taxCodeId,
        items: validatedItemsData.map((item) => ({
          itemId: item.itemId,
          lineType: item.lineType,
          description: item.description,
          glAccountCode: item.glAccountCode,
          unitOfMeasureId: item.unitOfMeasureId,
          taxCodeId: item.taxCodeId,
        })),
      });
      if (!workflowValidation.ok) {
        return sendError(
          res,
          workflowValidation.status,
          workflowValidation.code,
          workflowValidation.message,
          workflowValidation.details,
        );
      }

      const newOrder = await storage.createPurchaseOrder(
        validatedOrderData, 
        validatedItemsData
      );
      const creatorId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      await db.insert(purchaseOrderRevisions).values({
        organizationId: getActiveOrganizationId(),
        orderId: newOrder.id,
        revisionNumber: 1,
        snapshot: {
          order: newOrder,
          items: validatedItemsData,
          source: "create",
        },
        createdBy: creatorId,
      } as any);
      
      return sendOk(res, newOrder, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendError(res, 400, "VALIDATION_ERROR", validationError.message);
      } else {
        const e = error as { code?: string; status?: number; message?: string };
        if (e?.code && e?.status) {
          return sendError(res, e.status, e.code, e.message || "Supplier defaults could not be applied.");
        }
        console.error("Error creating purchase order:", error);
        return sendError(res, 500, "CREATE_PURCHASE_ORDER_FAILED", "Failed to create purchase order");
      }
    }
  });

  const handlePurchaseOrderCommercialUpdate = async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return sendError(res, 400, "PO_INVALID_ID", "Invalid purchase order ID");
      }

      const parsedBody = purchaseOrderCommercialPatchSchema.safeParse(req.body);
      if (!parsedBody.success) {
        const validationError = fromZodError(parsedBody.error);
        return sendError(res, 400, "PO_COMMERCIAL_VALIDATION_FAILED", validationError.message);
      }
      const patchPayload = parsedBody.data;

      const currencyValidation = await assertPurchaseOrderCurrencyCodeAllowed(patchPayload.currencyCode);
      if (!currencyValidation.ok) {
        return sendError(res, 400, currencyValidation.code, currencyValidation.message);
      }

      if (patchPayload.taxCodeId !== undefined) {
        const taxValidation = await assertPurchaseOrderTaxCodeAllowed(patchPayload.taxCodeId);
        if (!taxValidation.ok) {
          return sendError(res, 400, taxValidation.code, taxValidation.message);
        }
      }

      const existingOrder = await storage.getPurchaseOrder(id);
      if (!existingOrder) {
        return sendError(res, 404, "PO_NOT_FOUND", "Purchase order not found");
      }

      if (!canUpdatePurchaseOrder(existingOrder.status)) {
        return sendError(
          res,
          409,
          "PO_COMMERCIAL_UPDATE_LOCKED",
          "Commercial terms can only be updated before the PO is sent.",
          { hint: String(existingOrder.status) },
        );
      }
      if (String(existingOrder.approvalStatus).toUpperCase() !== "DRAFT") {
        const approved = String(existingOrder.approvalStatus).toUpperCase() === "APPROVED";
        return sendError(
          res,
          409,
          approved ? "PO_APPROVED_REVISION_REQUIRED" : "PO_APPROVAL_IN_PROGRESS",
          approved
            ? "Material changes to an approved PO require a controlled revision and re-approval."
            : "Commercial terms are locked while PO approval is in progress.",
          { hint: "Create a revision with a reason instead of editing the approved commercial snapshot." },
        );
      }

      const defaultedPatch = await applySupplierDefaultsToPurchaseOrder({
        supplierId: existingOrder.supplierId,
        contractId: patchPayload.contractId ?? existingOrder.contractId,
        departmentId: patchPayload.departmentId ?? existingOrder.departmentId,
        paymentTermsId: patchPayload.paymentTermsId ?? existingOrder.paymentTermsId,
        incotermId: patchPayload.incotermId ?? existingOrder.incotermId,
        currencyCode: patchPayload.currencyCode ?? existingOrder.currencyCode,
        taxCodeId: patchPayload.taxCodeId ?? existingOrder.taxCodeId,
        confirmCurrencyOverride: patchPayload.confirmCurrencyOverride,
      });

      const validatedData: Partial<InsertPurchaseOrder> = {};
      (
        [
          "departmentId",
          "contractId",
          "paymentTermsId",
          "incotermId",
          "currencyCode",
          "taxCodeId",
        ] as const
      ).forEach((key) => {
        const value = defaultedPatch[key];
        if (value !== undefined) {
          validatedData[key] = value as never;
        }
      });

      if (Object.keys(validatedData).length === 0) {
        return sendError(res, 400, "PO_COMMERCIAL_EMPTY", "Provide at least one commercial field to update.");
      }

      const orgId = getActiveOrganizationId();
      const refCheck = await assertPurchaseOrderCommercialReferences({
        organizationId: orgId,
        supplierId: existingOrder.supplierId,
        patch: {
          departmentId: validatedData.departmentId,
          contractId: validatedData.contractId,
          paymentTermsId: validatedData.paymentTermsId,
          incotermId: validatedData.incotermId,
        },
      });
      if (!refCheck.ok) {
        return sendError(res, 400, refCheck.code, refCheck.message);
      }

      const updatedOrder = await storage.updatePurchaseOrder(id, validatedData);

      if (!updatedOrder) {
        return sendError(res, 404, "PO_NOT_FOUND", "Purchase order not found");
      }

      const rev = await pool.query<{ max: number }>(
        "SELECT COALESCE(MAX(revision_number), 0) AS max FROM purchase_order_revisions WHERE order_id = $1",
        [id],
      );
      const nextRevision = Number(rev.rows[0]?.max ?? 0) + 1;
      const updaterId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      await db.insert(purchaseOrderRevisions).values({
        organizationId: orgId,
        orderId: id,
        revisionNumber: nextRevision,
        snapshot: {
          update: validatedData,
          orderAfterUpdate: updatedOrder,
          source: "commercial_update",
        },
        createdBy: updaterId,
      } as any);
      return sendOk(res, updatedOrder);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Supplier defaults could not be applied.");
      }
      console.error("Error updating purchase order:", error);
      return sendError(res, 500, "UPDATE_PURCHASE_ORDER_FAILED", "Failed to update purchase order");
    }
  };

  app.put("/api/purchase-orders/:id", ...poWrite, handlePurchaseOrderCommercialUpdate);
  app.patch(
    "/api/procurement/purchase-orders/records/:id/commercial",
    ...poWrite,
    handlePurchaseOrderCommercialUpdate,
  );

  app.post(
    [
      "/api/purchase-orders/:id/revisions/start",
      "/api/procurement/purchase-orders/records/:id/revisions/start",
    ],
    ...poWrite,
    auth.ensureTwoFactorAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
        const reason = String(req.body?.reason ?? "").trim();
        if (reason.length < 10) return sendError(res, 400, "PO_REVISION_REASON_REQUIRED", "A material revision reason of at least 10 characters is required.");
        const organizationId = getActiveOrganizationId();
        const order = await storage.getPurchaseOrder(id);
        if (!order) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
        if (String(order.approvalStatus).toUpperCase() !== "APPROVED") {
          return sendError(res, 409, "PO_REVISION_NOT_AVAILABLE", "Only an approved PO can enter a controlled revision workflow.");
        }
        const items = await storage.getPurchaseOrderItems(id);
        const actorUserId = Number(req.user?.id);
        const revisionResult = await pool.query<{ max: number }>(
          "SELECT COALESCE(MAX(revision_number), 0) AS max FROM purchase_order_revisions WHERE organization_id = $1 AND order_id = $2",
          [organizationId, id],
        );
        const nextRevision = Number(revisionResult.rows[0]?.max ?? order.revisionNumber ?? 1) + 1;
        const updated = await db.transaction(async (tx) => {
          await tx.insert(purchaseOrderRevisions).values({
            organizationId,
            orderId: id,
            revisionNumber: nextRevision,
            snapshot: { source: "approved_revision_started", reason, supersededOrder: order, items },
            createdBy: actorUserId,
          });
          const [row] = await tx
            .update(purchaseOrders)
            .set({
              status: PurchaseOrderStatus.DRAFT,
              approvalStatus: "DRAFT",
              approvedByUserId: null,
              approvedAt: null,
              revisionNumber: nextRevision,
              dispatchStatus: "NOT_SENT",
              dispatchError: null,
              updatedAt: new Date(),
            })
            .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.approvalStatus, "APPROVED")))
            .returning();
          return row;
        });
        if (!updated) return sendError(res, 409, "PO_CONCURRENT_UPDATE", "The approved PO changed before the revision could start.");
        await appendAuditEvent({
          organizationId,
          actor: { userId: actorUserId },
          action: "PURCHASE_ORDER_REVISION_STARTED",
          resourceType: "purchase_order",
          resourceId: id,
          before: order,
          after: updated,
          reason,
          requestId: String(res.locals.requestId ?? "unknown-request-id"),
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? null,
        });
        return sendOk(res, updated);
      } catch (error) {
        console.error("Error starting purchase order revision:", error);
        return sendError(res, 500, "PO_REVISION_START_FAILED", "Purchase order revision could not be started.");
      }
    },
  );

  app.get(
    [
      "/api/purchase-orders/:id/revisions",
      "/api/procurement/purchase-orders/records/:id/revisions",
    ],
    ...poRead,
    async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      const rows = await db
        .select()
        .from(purchaseOrderRevisions)
        .where(
          and(
            eq(purchaseOrderRevisions.organizationId, getActiveOrganizationId()),
            eq(purchaseOrderRevisions.orderId, id),
          ),
        );
      return sendOk(res, rows);
    } catch (error) {
      console.error("Error fetching purchase order revisions:", error);
      return sendError(res, 500, "FETCH_PO_REVISIONS_FAILED", "Failed to fetch purchase order revisions");
    }
  },
  );

  app.delete("/api/purchase-orders/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const success = await storage.deletePurchaseOrder(id);
      
      if (!success) {
        return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase order:", error);
      return sendError(res, 500, "DELETE_PURCHASE_ORDER_FAILED", "Failed to delete purchase order");
    }
  });

  app.post("/api/purchase-orders/:id/submit", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      const organizationId = getActiveOrganizationId();
      const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
      if (process.env.NODE_ENV === "production" && !idempotencyKey) {
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for PO submission.");
      }
      const replay = await resolveWorkflowReplay({ organizationId, idempotencyKey, action: "PURCHASE_ORDER_SUBMIT", resourceId: id });
      if (replay?.conflict) return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another workflow action.");
      if (replay) {
        const current = await storage.getPurchaseOrder(id);
        return sendOk(res, { ...current, duplicate: true });
      }
      const order = await storage.getPurchaseOrder(id);
      if (!order) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      if (String(order.approvalStatus).toUpperCase() !== "DRAFT") {
        return sendError(res, 409, "PO_APPROVAL_STATUS_INVALID", `Only draft POs can be submitted; current approval status is ${order.approvalStatus}.`);
      }
      const items = await storage.getPurchaseOrderItems(id);
      const validation = await validatePurchaseOrderWorkflowReadiness({
        organizationId,
        currencyCode: order.currencyCode,
        taxCodeId: order.taxCodeId,
        items,
      });
      if (!validation.ok) return sendError(res, validation.status, validation.code, validation.message, { details: validation.details });
      if (order.requisitionId) {
        const requisition = await storage.getPurchaseRequisition(order.requisitionId);
        const evidence = await assertRequisitionSourcingEvidence({
          organizationId,
          requisitionId: order.requisitionId,
          reportingValue: Number(requisition?.totalAmount ?? order.totalAmount) * Number(requisition?.exchangeRateToZar ?? 1),
        });
        if (!evidence.ok) return sendError(res, 409, evidence.code, evidence.message, { hint: evidence.hint });
      }
      const [updated] = await db
        .update(purchaseOrders)
        .set({ status: "OPEN", approvalStatus: "PENDING", updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.approvalStatus, "DRAFT")))
        .returning();
      if (!updated) return sendError(res, 409, "PO_CONCURRENT_UPDATE", "The PO changed while it was being submitted. Refresh and retry.");
      await appendAuditEvent({
        organizationId,
        actor: { userId: Number(req.user?.id) },
        action: "PURCHASE_ORDER_SUBMITTED",
        resourceType: "purchase_order",
        resourceId: id,
        before: order,
        after: updated,
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      await recordWorkflowResult({
        organizationId,
        idempotencyKey,
        action: "PURCHASE_ORDER_SUBMIT",
        resourceId: id,
        response: { purchaseOrderId: id, approvalStatus: updated.approvalStatus },
      });
      return sendOk(res, updated);
    } catch (error) {
      console.error("Error submitting purchase order:", error);
      return sendError(res, 500, "PO_SUBMIT_FAILED", "Purchase order could not be submitted for approval.");
    }
  });

  app.post("/api/purchase-orders/:id/approve", ...poApprove, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      const organizationId = getActiveOrganizationId();
      const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
      if (process.env.NODE_ENV === "production" && !idempotencyKey) {
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for PO approval.");
      }
      const replay = await resolveWorkflowReplay({ organizationId, idempotencyKey, action: "PURCHASE_ORDER_APPROVE", resourceId: id });
      if (replay?.conflict) return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another workflow action.");
      if (replay) {
        const current = await storage.getPurchaseOrder(id);
        return sendOk(res, { ...current, duplicate: true });
      }
      const order = await storage.getPurchaseOrder(id);
      if (!order) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      if (String(order.approvalStatus).toUpperCase() !== "PENDING") {
        return sendError(res, 409, "PO_APPROVAL_STATUS_INVALID", "Only a submitted PO can be approved.");
      }
      const actorUserId = Number(req.user?.id);
      if (order.createdByUserId && order.createdByUserId === actorUserId) {
        return sendError(res, 403, "SEGREGATION_OF_DUTIES_VIOLATION", "A PO creator cannot approve the same purchase order.", {
          hint: "Assign an independent purchasing approver.",
        });
      }
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 5) return sendError(res, 400, "APPROVAL_REASON_REQUIRED", "Provide an approval reason of at least 5 characters.");
      const [updated] = await db
        .update(purchaseOrders)
        .set({
          status: "APPROVED",
          approvalStatus: "APPROVED",
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.approvalStatus, "PENDING")))
        .returning();
      if (!updated) return sendError(res, 409, "PO_CONCURRENT_UPDATE", "The PO changed while it was being approved. Refresh and retry.");
      await appendAuditEvent({
        organizationId,
        actor: { userId: actorUserId },
        action: "PURCHASE_ORDER_APPROVED",
        resourceType: "purchase_order",
        resourceId: id,
        before: order,
        after: updated,
        reason,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      await recordWorkflowResult({
        organizationId,
        idempotencyKey,
        action: "PURCHASE_ORDER_APPROVE",
        resourceId: id,
        response: { purchaseOrderId: id, approvalStatus: updated.approvalStatus },
      });
      return sendOk(res, updated);
    } catch (error) {
      console.error("Error approving purchase order:", error);
      return sendError(res, 500, "PO_APPROVAL_FAILED", "Purchase order approval failed.");
    }
  });

  app.post("/api/purchase-orders/:id/update-status", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const { status } = req.body;
      if (!status || !Object.values(PurchaseOrderStatus).includes(status as PurchaseOrderStatus)) {
        return sendError(res, 400, "INVALID_PO_STATUS", "Valid status is required");
      }
      if (status === PurchaseOrderStatus.SENT) {
        const order = await storage.getPurchaseOrder(id);
        if (!order) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
        if (String(order.approvalStatus).toUpperCase() !== "APPROVED") {
          return sendError(res, 409, "PO_APPROVAL_REQUIRED", "Purchase order must be independently approved before it can be sent.");
        }
        return sendError(res, 409, "PO_DISPATCH_ENDPOINT_REQUIRED", "Use the controlled PO dispatch action to mark an approved purchase order as sent.", {
          hint: "Dispatch records provider status and leaves the PO approved if delivery fails.",
        });
      }
      
      const updatedOrder = await storage.updatePurchaseOrderStatus(id, status);
      
      if (!updatedOrder) {
        return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      }
      
      return sendOk(res, updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order status:", error);
      return sendError(res, 500, "UPDATE_PO_STATUS_FAILED", "Failed to update purchase order status");
    }
  });

  app.post("/api/purchase-orders/:id/update-payment", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const { paymentStatus, reference } = req.body;
      if (!paymentStatus || !Object.values(PaymentStatus).includes(paymentStatus as PaymentStatus)) {
        return sendError(res, 400, "INVALID_PAYMENT_STATUS", "Valid payment status is required");
      }
      
      const updatedOrder = await storage.updatePurchaseOrderPaymentStatus(id, paymentStatus, reference);
      
      if (!updatedOrder) {
        return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      }
      
      return sendOk(res, updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order payment status:", error);
      return sendError(res, 500, "UPDATE_PO_PAYMENT_FAILED", "Failed to update purchase order payment status");
    }
  });

  app.post(
    "/api/purchase-orders/:id/send-email",
    ...poWrite,
    auth.ensureTwoFactorAuthenticated,
    async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return sendError(res, 400, "EMAIL_REQUIRED", "A valid recipient email is required");
      }
      const organizationId = getActiveOrganizationId();
      const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
      if (process.env.NODE_ENV === "production" && !idempotencyKey) {
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for PO dispatch.");
      }
      const replay = await resolveWorkflowReplay({ organizationId, idempotencyKey, action: "PURCHASE_ORDER_DISPATCH", resourceId: id });
      if (replay?.conflict) return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another workflow action.");
      if (replay) return sendOk(res, { message: "Purchase order was already dispatched for this request.", duplicate: true });
      const order = await storage.getPurchaseOrder(id);
      if (!order) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      if (String(order.approvalStatus).toUpperCase() !== "APPROVED") {
        return sendError(res, 409, "PO_APPROVAL_REQUIRED", "Purchase order must be independently approved before dispatch.");
      }
      if (
        process.env.NODE_ENV === "production"
        && (!process.env.EMAIL_HOST?.trim() || !process.env.EMAIL_USER?.trim() || !process.env.EMAIL_PASS?.trim())
      ) {
        return sendError(res, 503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Purchase order dispatch is not configured.", {
          hint: "Configure the hosted SMTP provider before issuing purchase orders.",
        });
      }
      
      const success = await storage.sendPurchaseOrderEmail(id, email);
      
      if (!success) {
        await db
          .update(purchaseOrders)
          .set({ dispatchStatus: "FAILED", dispatchError: "Email provider rejected the dispatch request.", updatedAt: new Date() })
          .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
        return sendError(res, 502, "SEND_PO_EMAIL_FAILED", "Purchase order dispatch failed. The order remains approved and has not been marked as sent.", {
          hint: "Verify the email provider and recipient, then retry the same approved revision.",
        });
      }
      
      // Update the order status to SENT if successful
      await db
        .update(purchaseOrders)
        .set({ status: PurchaseOrderStatus.SENT, dispatchStatus: "DISPATCHED", dispatchError: null, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
      await appendAuditEvent({
        organizationId,
        actor: { userId: Number(req.user?.id) },
        action: "PURCHASE_ORDER_DISPATCHED",
        resourceType: "purchase_order",
        resourceId: id,
        before: order,
        after: { status: PurchaseOrderStatus.SENT, dispatchStatus: "DISPATCHED", recipient: email },
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      await recordWorkflowResult({
        organizationId,
        idempotencyKey,
        action: "PURCHASE_ORDER_DISPATCH",
        resourceId: id,
        response: { purchaseOrderId: id, status: PurchaseOrderStatus.SENT, recipient: email },
      });
      
      return sendOk(res, { message: "Purchase order email sent successfully" });
    } catch (error) {
      console.error("Error sending purchase order email:", error);
      return sendError(res, 500, "SEND_PO_EMAIL_FAILED", "Failed to send purchase order email");
    }
    },
  );

  // Purchase Order Items endpoints
  app.get(
    [
      "/api/purchase-orders/:orderId/items",
      "/api/procurement/purchase-orders/records/:orderId/items",
    ],
    ...poRead,
    async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const items = await storage.getPurchaseOrderItems(orderId);
      return sendOk(res, items);
    } catch (error) {
      console.error("Error fetching purchase order items:", error);
      return sendError(res, 500, "FETCH_PO_ITEMS_FAILED", "Failed to fetch purchase order items");
    }
  },
  );

  app.post(
    [
      "/api/purchase-orders/:orderId/items",
      "/api/procurement/purchase-orders/records/:orderId/items",
    ],
    ...poWrite,
    async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      }
      
      const validatedData = insertPurchaseOrderItemSchema.parse({
        ...req.body,
        orderId,
      });
      const isCatalogLine = String(validatedData.lineType ?? "CATALOG").toUpperCase() === "CATALOG";
      if (isCatalogLine && !validatedData.itemId) {
        return sendError(res, 400, "PO_CATALOG_ITEM_REQUIRED", "Catalogue PO lines require an inventory item.");
      }
      if (!isCatalogLine && (!validatedData.description?.trim() || !validatedData.manualEntryReason?.trim())) {
        return sendError(res, 400, "PO_MANUAL_LINE_DETAILS_REQUIRED", "Manual PO lines require a description and approved exception reason.");
      }
      const inv = validatedData.itemId ? await storage.getInventoryItem(validatedData.itemId) : undefined;
      const enriched: InsertPurchaseOrderItem = {
        ...validatedData,
        unitOfMeasureId: validatedData.unitOfMeasureId ?? inv?.unitOfMeasureId ?? null,
        commodityCodeId: validatedData.commodityCodeId ?? inv?.commodityCodeId ?? null,
        taxCodeId: validatedData.taxCodeId ?? null,
      };

      const newItem = await storage.addPurchaseOrderItem(enriched);
      return sendOk(res, newItem, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendError(res, 400, "VALIDATION_ERROR", validationError.message);
      } else {
        console.error("Error adding purchase order item:", error);
        return sendError(res, 500, "ADD_PO_ITEM_FAILED", "Failed to add purchase order item");
      }
    }
  },
  );

  app.put("/api/purchase-order-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ITEM_ID", "Invalid purchase order item ID");
      }
      
      const validatedData = insertPurchaseOrderItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updatePurchaseOrderItem(id, validatedData);
      
      if (!updatedItem) {
        return sendError(res, 404, "PURCHASE_ORDER_ITEM_NOT_FOUND", "Purchase order item not found");
      }
      
      return sendOk(res, updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendError(res, 400, "VALIDATION_ERROR", validationError.message);
      } else {
        console.error("Error updating purchase order item:", error);
        return sendError(res, 500, "UPDATE_PO_ITEM_FAILED", "Failed to update purchase order item");
      }
    }
  });

  app.delete("/api/purchase-order-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ITEM_ID", "Invalid purchase order item ID");
      }
      
      const success = await storage.deletePurchaseOrderItem(id);
      
      if (!success) {
        return sendError(res, 404, "PURCHASE_ORDER_ITEM_NOT_FOUND", "Purchase order item not found");
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase order item:", error);
      return sendError(res, 500, "DELETE_PO_ITEM_FAILED", "Failed to delete purchase order item");
    }
  });

  app.post("/api/purchase-order-items/:id/receive", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendError(res, 400, "INVALID_PURCHASE_ORDER_ITEM_ID", "Invalid purchase order item ID");
      }
      
      const { receivedQuantity, receiverName, warehouseLocation, receivedAt, receiverUserId } = req.body ?? {};
      if (receivedQuantity === undefined || isNaN(Number(receivedQuantity)) || Number(receivedQuantity) < 0) {
        return sendError(res, 400, "INVALID_RECEIVED_QUANTITY", "Valid received quantity is required");
      }

      const meta =
        receiverName != null || warehouseLocation != null || receivedAt != null || receiverUserId != null
          ? {
              receiverName: typeof receiverName === "string" ? receiverName : null,
              warehouseLocation: typeof warehouseLocation === "string" ? warehouseLocation : null,
              receivedAt: typeof receivedAt === "string" ? receivedAt : null,
              receiverUserId:
                receiverUserId != null && !isNaN(Number(receiverUserId)) ? Number(receiverUserId) : null,
            }
          : undefined;

      const updatedItem = await storage.recordPurchaseOrderItemReceived(id, Number(receivedQuantity), meta);
      
      if (!updatedItem) {
        return sendError(res, 404, "PURCHASE_ORDER_ITEM_NOT_FOUND", "Purchase order item not found");
      }
      
      return sendOk(res, updatedItem);
    } catch (error) {
      if (error instanceof Error && error.message === "RECEIVE_EXCEEDS_REMAINING") {
        return sendError(res, 400, "RECEIVE_EXCEEDS_REMAINING", "Quantity cannot exceed remaining quantity");
      }
      console.error("Error recording received quantity:", error);
      return sendError(res, 500, "RECORD_RECEIVE_FAILED", "Failed to record received quantity");
    }
  });

}
