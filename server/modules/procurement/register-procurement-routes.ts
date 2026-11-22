import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { storage } from "../../storage";
import { db, pool } from "../../db";
import { sendError, sendFunctionError, sendOk } from "../../api-response";
import { emitNotification } from "../../services/notification-emitter";
import {
  insertPurchaseRequisitionSchema,
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
  unitsOfMeasure,
  mdmCostCentres,
  mdmProcurementPolicies,
  purchaseOrders,
  purchaseOrderItems,
  purchaseRequisitions,
  purchaseRequisitionItems,
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
import { applySupplierDefaultsToPurchaseOrder, assertSupplierTransactionAllowed } from "./supplier-defaults";
import { validatePurchaseOrderWorkflowReadiness } from "./po-validation";
import { lockConversionRequisition, writeRequisitionPurchaseOrder } from "./requisition-po-conversion";
import { transferRequisitionBudget } from "./requisition-budget-transfer";
import { bindPurchaseOrderBudgetProvenance } from "./purchase-order-budget-provenance";
import { validateMdmTransaction } from "../master-data/mdm-control-centre";
import type { AuthBundle } from "./types";
import { getCanonicalReportingCurrencyCode, getReportingCurrencyCode } from "../../lib/org-reporting-money";
import { appendAuditEvent } from "../../services/audit-chain-service";
import { appendAuditEventWithClient } from "../../services/audit-chain-client";
import { authorizeApprovalStep } from "../../services/approval-workflow-service";

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

export async function readRequisitionSourcingPolicy(organizationId: number, database: Pick<typeof db, "select"> = db) {
  const policies = await database
    .select({ id: mdmProcurementPolicies.id, code: mdmProcurementPolicies.code,
      updatedAt: mdmProcurementPolicies.updatedAt, config: mdmProcurementPolicies.config })
    .from(mdmProcurementPolicies)
    .where(
      and(
        eq(mdmProcurementPolicies.organizationId, organizationId),
        eq(mdmProcurementPolicies.policyType, "sourcing"),
        eq(mdmProcurementPolicies.active, true),
      ),
    ).orderBy(asc(mdmProcurementPolicies.id)).for("share");
  const policy = policies.find(({ config }) => config?.competitionRequired === true || config?.competitionRequired === "true");
  const threshold = Number(policy?.config?.competitionThreshold ?? Number.POSITIVE_INFINITY);
  return {policy,threshold};
}

async function assertRequisitionSourcingEvidence(input: {
  organizationId: number;
  requisitionId: number;
  reportingValue: number;
}, database: Pick<typeof db, "select"> = db) {
  const {policy,threshold}=await readRequisitionSourcingPolicy(input.organizationId,database);
  const decision = { requisitionId: input.requisitionId, reportingValue: input.reportingValue,
    threshold: Number.isFinite(threshold) ? threshold : null,
    policy: policy ? { id: policy.id, code: policy.code, updatedAt: policy.updatedAt.toISOString() } : null };
  if (!Number.isFinite(threshold) || input.reportingValue < threshold) return { ok: true as const,
    decision: { ...decision, outcome: !policy ? "not_configured" : !Number.isFinite(threshold) ? "threshold_unavailable" : "below_threshold", award: null } };
  const evidence = await database
    .select({ eventId: sourcingEvents.id, awardId: sourcingAwards.id, awardStatus: sourcingAwards.status, awardVersion: sourcingAwards.version })
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
    ).orderBy(asc(sourcingAwards.id));
  const award = evidence.find((row) => ["APPROVED", "CONVERTED"].includes(String(row.awardStatus).toUpperCase()));
  if (award) {
    return { ok: true as const, decision: { ...decision, outcome: "award_found", award } };
  }
  return {
    ok: false as const,
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
    .where(and(
      eq(taxCodes.id, taxCodeId),
      eq(taxCodes.organizationId, getActiveOrganizationId()),
      eq(taxCodes.active, true),
    ))
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
    .where(and(
      eq(currencies.organizationId, getActiveOrganizationId()),
      eq(currencies.code, code),
      eq(currencies.active, true),
    ))
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

export async function resolveActiveCurrencyForRequisition(
  currencyCode: unknown,
  client?: PoolClient,
): Promise<{ ok: true; currencyCode: string; exchangeRateToZar: number } | { ok: false; code: string; message: string }> {
  const database=client?drizzle(client):db;
  const reportingCurrency=client?await getCanonicalReportingCurrencyCode(getActiveOrganizationId(),database):await getReportingCurrencyCode(storage);
  const requested = String(currencyCode ?? reportingCurrency).trim().toUpperCase() || reportingCurrency;
  const rows = await database
    .select({ code: currencies.code, exchangeRateToZar: currencies.exchangeRateToZar })
    .from(currencies)
    .where(and(eq(currencies.organizationId, getActiveOrganizationId()), eq(currencies.code, requested), eq(currencies.active, true)))
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
    const rateRows = await (client??pool).query<{ rate: number }>(
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

export function normalizeRequisitionLineInput(item: unknown, index: number) {
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

export async function validateRequisitionLineMasterDataPolicy(
  items: Array<Pick<InsertPurchaseRequisitionItem, "unitOfMeasureId" | "taxCodeId" | "costCentreId" | "glAccountCode">>,
  client?: PoolClient,
): Promise<{ ok: true } | { ok: false; errors: Array<{ code: string; message: string; line: number }> }> {
  const database=client?drizzle(client):db;
  const policies = await (client??pool).query<{ config: Record<string, unknown> | null }>(
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
    config.requireUom !== false && config.requireUom !== "false" &&
    config.requiresUom !== false && config.requiresUom !== "false";
  const requireTaxCode =
    config.requireTaxCode === true || config.requireTaxCode === "true" ||
    config.requiresTaxCode === true || config.requiresTaxCode === "true";
  const requireCostCentre =
    config.requireCostCentre === true || config.requireCostCentre === "true" ||
    config.requiresCostCentre === true || config.requiresCostCentre === "true";
  const requireGlMapping =
    config.requireGlMapping === true || config.requireGlMapping === "true" ||
    config.requiresGlMapping === true || config.requiresGlMapping === "true";
  const errors: Array<{ code: string; message: string; line: number }> = [];
  const organizationId = getActiveOrganizationId();
  const uomIds = [...new Set(items.map((item) => Number(item.unitOfMeasureId)).filter((id) => id > 0))];
  const taxIds = [...new Set(items.map((item) => Number(item.taxCodeId)).filter((id) => id > 0))];
  const costCentreIds = [...new Set(items.map((item) => Number(item.costCentreId)).filter((id) => id > 0))];
  const [validUoms, validTaxes, validCostCentres] = await Promise.all([
    uomIds.length
      ? database.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(and(eq(unitsOfMeasure.organizationId, organizationId), eq(unitsOfMeasure.active, true)))
      : Promise.resolve([]),
    taxIds.length
      ? database.select({ id: taxCodes.id }).from(taxCodes).where(and(eq(taxCodes.organizationId, organizationId), eq(taxCodes.active, true)))
      : Promise.resolve([]),
    costCentreIds.length
      ? database.select({ id: mdmCostCentres.id }).from(mdmCostCentres).where(and(eq(mdmCostCentres.organizationId, organizationId), eq(mdmCostCentres.active, true)))
      : Promise.resolve([]),
  ]);
  const validUomIds = new Set(validUoms.map((row) => row.id));
  const validTaxIds = new Set(validTaxes.map((row) => row.id));
  const validCostCentreIds = new Set(validCostCentres.map((row) => row.id));

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
    if (requireCostCentre && !item.costCentreId) {
      errors.push({
        code: "REQUISITION_LINE_COST_CENTRE_REQUIRED",
        message: `Line ${line}: cost centre is required by procurement policy.`,
        line,
      });
    }
    if (requireGlMapping && !String(item.glAccountCode ?? "").trim()) {
      errors.push({
        code: "REQUISITION_LINE_GL_MAPPING_REQUIRED",
        message: `Line ${line}: GL mapping is required by procurement policy.`,
        line,
      });
    }
    if (item.unitOfMeasureId && !validUomIds.has(Number(item.unitOfMeasureId))) {
      errors.push({ code: "REQUISITION_LINE_UOM_INVALID", message: `Line ${line}: purchase UOM is inactive or belongs to another organization.`, line });
    }
    if (item.taxCodeId && !validTaxIds.has(Number(item.taxCodeId))) {
      errors.push({ code: "REQUISITION_LINE_TAX_CODE_INVALID", message: `Line ${line}: tax code is inactive or belongs to another organization.`, line });
    }
    if (item.costCentreId && !validCostCentreIds.has(Number(item.costCentreId))) {
      errors.push({ code: "REQUISITION_LINE_COST_CENTRE_INVALID", message: `Line ${line}: cost centre is inactive or belongs to another organization.`, line });
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
  app.get("/api/v2/procurement/purchase-orders/recent", auth.ensureAuthenticated, auth.ensurePermission("purchases", "read"), async (_req: Request, res: Response) => {
    try {
      const rows = await pool.query(`SELECT id,order_number AS "orderNumber",supplier_id AS "supplierId",created_at AS "createdAt"
        FROM purchase_orders WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10`, [getActiveOrganizationId()]);
      return sendOk(res, { items: rows.rows });
    } catch (error) {
      console.error("Recent purchase orders failed:", error);
      return sendError(res, 500, "RECENT_PURCHASE_ORDERS_FAILED", "Could not load recent purchases. Please retry.");
    }
  });
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
      if (requisitionInput.status != null && requisitionInput.status !== "DRAFT")
        return sendError(res, 400, "REQUISITION_LIFECYCLE_FIELD_FORBIDDEN", "Create a draft, then use the submit and approval commands.");
      requisitionInput.status = "DRAFT";
      requisitionInput.organizationId = getActiveOrganizationId();
      requisitionInput.requestorId = Number(req.user?.id);
      requisitionInput.totalAmount = 0;
      delete requisitionInput.approverId;
      delete requisitionInput.approvalDate;
      delete requisitionInput.rejectionReason;
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
      if (!validatedReqData.departmentId) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Department is required");
      }
      if (!validatedReqData.requiredDate) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Required date is required");
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
          .where(and(
            eq(departments.id, Number(validatedReqData.departmentId)),
            eq(departments.organizationId, getActiveOrganizationId()),
            eq(departments.active, true),
          ))
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
      const currentRequisition = await storage.getPurchaseRequisition(id);
      if (!currentRequisition) return sendError(res, 404, "REQUISITION_NOT_FOUND", "Purchase requisition not found");
      const editableStatus = String(currentRequisition.status ?? "").toUpperCase();
      if (!["DRAFT", "NEEDS_INFO"].includes(editableStatus)) {
        return sendError(res, 409, "REQUISITION_LOCKED", "Submitted requisitions cannot be edited.", {
          hint: "Use comments or attachments for supporting information, or request information to return the requisition to an editable state.",
        });
      }
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const { items, revisionReason: _revisionReason, ...headerPatch } = body;
      if (["organizationId","requestorId","status","approverId","approvalDate","rejectionReason","totalAmount","sharedWithUserIds"]
        .some(key => Object.hasOwn(headerPatch,key))) {
        return sendError(res,400,"REQUISITION_LIFECYCLE_FIELD_FORBIDDEN","Use the governed requisition actions to change ownership or workflow state.");
      }
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
          .where(and(
            eq(departments.id, Number(validatedData.departmentId)),
            eq(departments.organizationId, getActiveOrganizationId()),
            eq(departments.active, true),
          ))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Department does not exist");
        }
      }
      const projectCheckPut = await validateProjectIdForOrg(validatedData.projectId ?? undefined);
      if (!projectCheckPut.ok) {
        return sendFunctionError(res, 400, "updatePurchaseRequisition", projectCheckPut.message);
      }
      const normalizedLines = Array.isArray(items) ? items.map((item,index)=>normalizeRequisitionLineInput(item,index)) : null;
      if (normalizedLines) {
        if (!normalizedLines.length) return sendError(res,400,"REQUISITION_ITEMS_REQUIRED","At least one requisition line is required.");
        const validation=await validateRequisitionLineMasterDataPolicy(normalizedLines);
        if (!validation.ok) return sendError(res,400,"REQUISITION_LINE_MDM_VALIDATION_FAILED",
          "Requisition line Master Data validation failed.",{details:{errors:validation.errors}});
      }
      const organizationId=getActiveOrganizationId();
      const updatedRequisition=await db.transaction(async tx=>{
        const locked=await lockConversionRequisition(tx,organizationId,id);
        if (!locked || !["DRAFT","NEEDS_INFO"].includes(String(locked.status).toUpperCase()) ||
            +locked.updatedAt!==+currentRequisition.updatedAt)
          throw Object.assign(new Error("The requisition changed. Refresh before saving."),{status:409,code:"REQUISITION_REVISION_CHANGED"});
        let totalAmount=locked.totalAmount;
        if (normalizedLines) {
          const existing=await tx.select({id:purchaseRequisitionItems.id}).from(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId,id));
          const pending=new Set(existing.map(line=>line.id));
          for (const line of normalizedLines) {
            const {id:knownId,...fields}=line;
            const values={...fields,requisitionId:id};
            if (knownId && pending.delete(knownId))
              await tx.update(purchaseRequisitionItems).set(values).where(and(eq(purchaseRequisitionItems.id,knownId),eq(purchaseRequisitionItems.requisitionId,id)));
            else await tx.insert(purchaseRequisitionItems).values(values);
          }
          if (pending.size) await tx.delete(purchaseRequisitionItems).where(and(eq(purchaseRequisitionItems.requisitionId,id),inArray(purchaseRequisitionItems.id,[...pending])));
          totalAmount=normalizedLines.reduce((sum,line)=>sum+line.totalPrice,0);
        }
        const [updated]=await tx.update(purchaseRequisitions).set({...validatedData,totalAmount,updatedAt:new Date()})
          .where(and(eq(purchaseRequisitions.organizationId,organizationId),eq(purchaseRequisitions.id,id))).returning();
        await tx.insert(approvalHistory).values({organizationId,entityType:"requisition",entityId:id,level:0,action:"revised",
          performedBy:Number(req.user?.id), previousStatus:locked.status,newStatus:updated.status,
          comment:typeof body.revisionReason==="string"?body.revisionReason:"Requisition revised"});
        return updated;
      });
      
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

  // Approve/reject compatibility routes mount with the canonical v2 command.

  app.post("/api/purchase-requisitions/:id/convert", ...poWrite, async (req: Request, res: Response) => {
    let client: PoolClient | undefined;
    let committed = false;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return sendError(res, 400, "INVALID_ID", "Invalid purchase requisition ID");
      }
      const organizationId = getActiveOrganizationId();
      const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
      if (process.env.NODE_ENV === "production" && !idempotencyKey) {
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for requisition conversion.", {
          hint: "Retry with one stable unique key for this conversion action.",
        });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10s'");
      const transactionDb = drizzle(client);
      const requisition = await lockConversionRequisition(transactionDb, organizationId, id);
      if (!requisition) return sendError(res, 404, "REQUISITION_NOT_FOUND", "Purchase requisition not found.");

      if (idempotencyKey) {
        const [replay] = await transactionDb.select().from(workflowIdempotency).where(and(
          eq(workflowIdempotency.organizationId, organizationId), eq(workflowIdempotency.idempotencyKey, idempotencyKey)));
        if (replay) {
          const orderId = Number((replay.response as Record<string, unknown> | null)?.purchaseOrderId ?? 0);
          const [existing] = replay.action === "REQUISITION_CONVERT_TO_PO" && Number.isInteger(orderId) && orderId > 0
            ? await transactionDb.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, orderId),
              eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.requisitionId, id)))
            : [];
          if (!existing || replay.resourceId !== existing.id) {
            return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "This key belongs to a different workflow action or requisition.");
          }
          return sendOk(res, { ...existing, duplicate: true });
        }
      }

      if (requisition.status !== PurchaseRequisitionStatus.APPROVED) {
        return sendError(res, 409, "REQUISITION_NOT_APPROVED", "Only an approved requisition can be converted.");
      }
      const sourcingEvidence = await assertRequisitionSourcingEvidence({
        organizationId, requisitionId: id,
        reportingValue: Number(requisition.totalAmount ?? 0) * Number(requisition.exchangeRateToZar ?? 1),
      }, transactionDb);
      if (!sourcingEvidence.ok) {
        return sendError(res, 409, sourcingEvidence.code, sourcingEvidence.message, { hint: sourcingEvidence.hint });
      }

      const userId = Number(req.user?.id);
      const actorUserId = Number.isInteger(userId) && userId > 0 ? userId : null;
      const { order, supplierDecision } = await writeRequisitionPurchaseOrder(transactionDb, requisition, { actorUserId, canonical: true });
      const transferred = await transferRequisitionBudget(client, organizationId, id, order.id);
      await bindPurchaseOrderBudgetProvenance(client, organizationId, id, [order.id], "requisition");

      await appendAuditEventWithClient(client, {
        organizationId, actor: { userId: actorUserId }, action: "REQUISITION_CONVERTED_TO_PO", resourceType: "purchase_order", resourceId: order.id,
        before: { requisitionId: id, requisitionStatus: requisition.status }, after: order,
        details: { conversionPolicyDecision: { schemaVersion: 1, sourcing: sourcingEvidence.decision, supplier: supplierDecision,
          budgetTransferred: Boolean(transferred), budgetTransfer: transferred } },
        requestId: String(res.locals.requestId ?? "unknown-request-id"), ipAddress: req.ip, userAgent: req.get("user-agent") ?? null,
      });
      if (idempotencyKey) {
        await transactionDb.insert(workflowIdempotency).values({
          organizationId, idempotencyKey, action: "REQUISITION_CONVERT_TO_PO", resourceType: "purchase_order", resourceId: order.id,
          response: { purchaseOrderId: order.id },
        });
      }
      await client.query("COMMIT");
      committed = true;
      return sendOk(res, order, 201);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string; cause?: { code?: string } };
      if (e.status && e.code) return sendError(res, e.status, e.code, e.message ?? "Conversion was not allowed.");
      if (["40001", "40P01", "23505"].includes(e.cause?.code ?? e.code ?? "")) {
        return sendError(res, 409, "REQUISITION_CONVERSION_CONFLICT", "The requisition or retry key changed while converting. Refresh and retry.");
      }
      console.error("Error converting requisition to purchase order:", error);
      return sendError(res, 500, "CONVERT_REQUISITION_FAILED", "Failed to convert requisition to purchase order. No changes were saved.");
    } finally {
      if (client) {
        if (!committed) await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
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

  const useRequisitionDraft = (_req: Request, res: Response) => sendError(res,409,
    "REQUISITION_DRAFT_EDIT_REQUIRED","Edit requisition lines together with the draft so its total and approval revision stay in sync.");
  app.post("/api/purchase-requisitions/:reqId/items", ...poWrite, useRequisitionDraft);
  app.put("/api/purchase-requisitions-items/:id", ...poWrite, useRequisitionDraft);
  app.delete("/api/purchase-requisitions-items/:id", ...poWrite, useRequisitionDraft);

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
        contractId: patchPayload.contractId === undefined ? existingOrder.contractId : patchPayload.contractId,
        departmentId: patchPayload.departmentId === undefined ? existingOrder.departmentId : patchPayload.departmentId,
        paymentTermsId: patchPayload.paymentTermsId === undefined ? existingOrder.paymentTermsId : patchPayload.paymentTermsId,
        incotermId: patchPayload.incotermId === undefined ? existingOrder.incotermId : patchPayload.incotermId,
        currencyCode: patchPayload.currencyCode ?? existingOrder.currencyCode,
        taxCodeId: patchPayload.taxCodeId === undefined ? existingOrder.taxCodeId : patchPayload.taxCodeId,
        confirmCurrencyOverride: patchPayload.confirmCurrencyOverride,
      }, { applyDefaults: false });

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
    let client: PoolClient | undefined;
    let committed = false;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_PURCHASE_ORDER_ID", "Invalid purchase order ID");
      const organizationId = getActiveOrganizationId();
      const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
      if (process.env.NODE_ENV === "production" && !idempotencyKey) {
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for PO submission.");
      }
      client = await pool.connect();
      // The shared audit chain reads its latest predecessor after acquiring
      // the tenant chain lock. A fixed snapshot could miss that predecessor.
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10s'");
      const transactionDb = drizzle(client);
      const scope = and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId));
      const [order] = await transactionDb.select().from(purchaseOrders).where(scope).for("update");
      if (!order) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      if (idempotencyKey) {
        const [replay] = await transactionDb.select().from(workflowIdempotency).where(and(
          eq(workflowIdempotency.organizationId, organizationId), eq(workflowIdempotency.idempotencyKey, idempotencyKey)));
        if (replay && (replay.action !== "PURCHASE_ORDER_SUBMIT" || replay.resourceId !== id)) {
          return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another workflow action.");
        }
        if (replay) return sendOk(res, { ...order, duplicate: true });
      }
      if (String(order.approvalStatus).toUpperCase() !== "DRAFT") {
        return sendError(res, 409, "PO_APPROVAL_STATUS_INVALID", `Only draft POs can be submitted; current approval status is ${order.approvalStatus}.`);
      }
      const items = await transactionDb.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id)).orderBy(asc(purchaseOrderItems.id)).for("share");
      const validation = await validatePurchaseOrderWorkflowReadiness({
        organizationId,
        currencyCode: order.currencyCode,
        taxCodeId: order.taxCodeId,
        items,
      }, client, transactionDb);
      if (!validation.ok) return sendError(res, validation.status, validation.code, validation.message, { details: validation.details });
      let sourcingDecision = null;
      if (order.requisitionId) {
        const [requisition] = await transactionDb.select().from(purchaseRequisitions).where(and(
          eq(purchaseRequisitions.id, order.requisitionId), eq(purchaseRequisitions.organizationId, organizationId))).for("share");
        const evidence = await assertRequisitionSourcingEvidence({
          organizationId,
          requisitionId: order.requisitionId,
          reportingValue: Number(requisition?.totalAmount ?? order.totalAmount) * Number(requisition?.exchangeRateToZar ?? 1),
        }, transactionDb);
        if (!evidence.ok) return sendError(res, 409, evidence.code, evidence.message, { hint: evidence.hint });
        if (requisition) sourcingDecision = evidence.decision;
      }
      const [updated] = await transactionDb
        .update(purchaseOrders)
        .set({ status: "OPEN", approvalStatus: "PENDING", updatedAt: new Date() })
        .where(scope)
        .returning();
      if (!updated) return sendError(res, 409, "PO_CONCURRENT_UPDATE", "The PO changed while it was being submitted. Refresh and retry.");
      await transactionDb.insert(approvalHistory).values({
        organizationId, entityType: "purchase_order", entityId: id, level: 0,
        action: "submitted", performedBy: Number(req.user?.id),
        previousStatus: String(order.approvalStatus), newStatus: "PENDING",
        comment: typeof req.body?.reason === "string" ? req.body.reason : null,
      } as any);
      await appendAuditEventWithClient(client, {
        organizationId,
        actor: { userId: Number(req.user?.id) },
        action: "PURCHASE_ORDER_SUBMITTED",
        resourceType: "purchase_order",
        resourceId: id,
        before: order,
        after: updated,
        details: { submissionPolicyDecision: { schemaVersion: 1, readiness: validation.decision, sourcing: sourcingDecision } },
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      if (idempotencyKey) await transactionDb.insert(workflowIdempotency).values({
        organizationId, idempotencyKey, action: "PURCHASE_ORDER_SUBMIT", resourceType: "purchase_order", resourceId: id,
        response: { purchaseOrderId: id, approvalStatus: updated.approvalStatus },
      });
      await client.query("COMMIT");
      committed = true;
      return sendOk(res, updated);
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code === "40001" || code === "40P01" || code === "23505") {
        return sendError(res, 409, "PO_CONCURRENT_UPDATE", "The PO or retry key changed while submitting. Refresh and retry.");
      }
      console.error("Error submitting purchase order:", error);
      return sendError(res, 500, "PO_SUBMIT_FAILED", "Purchase order could not be submitted for approval.");
    } finally {
      if (client) {
        if (!committed) await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
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
      const workflowStep = await authorizeApprovalStep({
        organizationId,
        entityType: "purchase_order",
        entityId: id,
        amount: Number(order.totalAmount ?? 0),
        actorUserId,
        actorRole: String(req.user?.role ?? ""),
        actorPreferences: req.user?.preferences,
      });
      if (!workflowStep.isFinal) {
        await db.insert(approvalHistory).values({
          organizationId, entityType: "purchase_order", entityId: id,
          level: workflowStep.level, action: "approved", performedBy: actorUserId,
          previousStatus: "PENDING", newStatus: "PENDING", comment: reason,
        } as any);
        return sendOk(res, {
          ...order,
          approvalProgress: {
            completedLevels: [...workflowStep.progress.completedLevels, workflowStep.level],
            requiredLevels: workflowStep.progress.requiredLevels,
            state: "pending",
          },
        });
      }
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
      await db.insert(approvalHistory).values({
        organizationId, entityType: "purchase_order", entityId: id,
        level: workflowStep.level, action: "approved", performedBy: actorUserId,
        previousStatus: "PENDING", newStatus: "APPROVED", comment: reason,
      } as any);
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
      const structured = error as { status?: number; code?: string; message?: string };
      if (structured.status && structured.code) {
        return sendError(res, structured.status, structured.code, structured.message ?? "Purchase order approval was not allowed");
      }
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
    let communicationEventId: number | null = null;
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
      if (!process.env.EMAIL_HOST?.trim() || !process.env.EMAIL_USER?.trim() || !process.env.EMAIL_PASS?.trim()) {
        return sendError(res, 503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Purchase order dispatch is not configured.", {
          hint: "Configure and verify the SMTP provider before issuing purchase orders. A local preview is not proof of delivery.",
        });
      }

      const queued = await pool.query<{ id: number }>(`INSERT INTO supplier_communication_events
        (organization_id,supplier_id,source_type,source_id,channel,status,recipient,actor_user_id)
        VALUES($1,$2,'purchase_order',$3,'email','queued',$4,$5) RETURNING id`,
        [organizationId, order.supplierId, id, email, Number(req.user?.id) || null]);
      communicationEventId = queued.rows[0].id;
      
      const success = await storage.sendPurchaseOrderEmail(id, email);
      
      if (!success) {
        await pool.query(`UPDATE supplier_communication_events SET status='failed',error_summary=$2
          WHERE id=$1 AND organization_id=$3`, [communicationEventId, "The email provider rejected the dispatch request.", organizationId]);
        await db
          .update(purchaseOrders)
          .set({ dispatchStatus: "FAILED", dispatchError: "Email provider rejected the dispatch request.", updatedAt: new Date() })
          .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
        return sendError(res, 502, "SEND_PO_EMAIL_FAILED", "Purchase order dispatch failed. The order remains approved and has not been marked as sent.", {
          hint: "Verify the email provider and recipient, then retry the same approved revision.",
        });
      }
      await pool.query(`UPDATE supplier_communication_events SET status='sent',occurred_at=now()
        WHERE id=$1 AND organization_id=$2`, [communicationEventId, organizationId]);
      
      // Update the order status to SENT if successful
      await db
        .update(purchaseOrders)
        .set({ status: PurchaseOrderStatus.SENT, dispatchStatus: "DISPATCHED", dispatchError: null, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
      await pool.query(
        `INSERT INTO po_supplier_confirmations
          (organization_id,purchase_order_id,supplier_id,status,source,actor_user_id)
         VALUES ($1,$2,$3,'AWAITING','SYSTEM',$4)
         ON CONFLICT DO NOTHING`,
        [organizationId, id, order.supplierId, Number(req.user?.id) || null],
      );
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
      if (communicationEventId !== null) {
        await pool.query(`UPDATE supplier_communication_events SET status='failed',error_summary=$2
          WHERE id=$1 AND status='queued'`, [communicationEventId, "The dispatch did not complete; check the provider before retrying."]).catch(() => undefined);
      }
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
