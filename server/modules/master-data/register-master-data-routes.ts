import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, desc, eq, gt, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { storage } from "../../storage";
import { sendError, sendOk } from "../../api-response";
import { getApprovalSuggestions } from "../../approval-suggestions";
import {
  getApprovalWorkflowProgress,
  governedApprovalEntityTypes,
  isGovernedApprovalEntityType,
} from "../../services/approval-workflow-service";
import { getActiveOrganizationId } from "../../organization-context";
import { getCanonicalReportingCurrencyCode } from "../../lib/org-reporting-money";
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
  warehouseInventory,
  warehouses,
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
  getMdmDomainRegistry,
  createMdmDomainRecord,
  getImportBatchValidationReport,
  getMdmAudit,
  getMdmControlCentreHealth,
  getMdmDataQualityIssues,
  getMdmDisableDependencies,
  getPurchaseOrderContext,
  getRequisitionContext,
  isMdmDomain,
  listMdmDomain,
  previewDocumentSequence,
  scanMdmDataQuality,
  updateMdmDomainRecord,
  validateMdmTransaction,
} from "./mdm-control-centre";
import { getMdmDomainRegistryEntry, isHighRiskMdmField } from "./mdm-domain-registry";
import {
  addMdmChangeRequestComment,
  approveMdmChangeRequest,
  applyMdmChangeRequest,
  createMdmChangeRequest,
  getMdmChangeRequest,
  listMdmChangeRequests,
  rejectMdmChangeRequest,
} from "./mdm-change-request-service";
import { getMdmWhereUsed } from "./mdm-where-used-service";
import { getFxProviderStatus, getFxRateFreshness, importFxRatesForOrganizations } from "./fx-provider-service";
import { approvalRangesOverlap, type ApprovalPolicyCandidate } from "./approval-policy-overlap";
import { getMasterDataGovernanceOverview } from "./mdm-governance-overview";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensureTwoFactorAuthenticated: RequestHandler;
};

async function findApprovalPolicyConflicts(
  organizationId: number,
  candidate: ApprovalPolicyCandidate,
): Promise<Array<{ id: number; name: string; amountMin: number; amountMax: number | null; approvalLevel: number }>> {
  if (candidate.isActive === false) return [];
  const rows = await db
    .select({
      id: approvalPolicies.id,
      name: approvalPolicies.name,
      entityType: approvalPolicies.entityType,
      amountMin: approvalPolicies.amountMin,
      amountMax: approvalPolicies.amountMax,
      approvalLevel: approvalPolicies.approvalLevel,
      isActive: approvalPolicies.isActive,
    })
    .from(approvalPolicies)
    .where(
      and(
        eq(approvalPolicies.organizationId, organizationId),
        eq(approvalPolicies.entityType, candidate.entityType),
        eq(approvalPolicies.approvalLevel, candidate.approvalLevel),
        eq(approvalPolicies.isActive, true),
      ),
    );

  return rows
    .filter((row) => row.id !== candidate.id && approvalRangesOverlap(candidate, row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      amountMin: Number(row.amountMin),
      amountMax: row.amountMax == null ? null : Number(row.amountMax),
      approvalLevel: row.approvalLevel,
    }));
}

type MdmPermissionAction = "read" | "create" | "update" | "delete" | "approve" | "apply" | "comment" | "import" | "scan";

const MDM_PERMISSION_ALIASES: Record<string, Array<{ resource: string; permissionType: string }>> = {
  "master-data:read": [
    { resource: "master_data", permissionType: "read" },
    { resource: "settings", permissionType: "read" },
  ],
  "suppliers:manage": [
    { resource: "suppliers", permissionType: "manage" },
    { resource: "suppliers", permissionType: "update" },
  ],
  "supplier-bank:manage": [
    { resource: "suppliers", permissionType: "manage" },
    { resource: "suppliers", permissionType: "update" },
  ],
  "contracts:manage": [
    { resource: "purchases", permissionType: "manage" },
    { resource: "purchases", permissionType: "update" },
  ],
  "inventory:manage": [
    { resource: "inventory", permissionType: "manage" },
    { resource: "inventory", permissionType: "update" },
  ],
  "warehouses:manage": [
    { resource: "warehouses", permissionType: "manage" },
    { resource: "warehouses", permissionType: "update" },
  ],
  "departments:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
  ],
  "finance-mapping:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
  ],
  "tax:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
  ],
  "currencies:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
  ],
  "payment-terms:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
  ],
  "incoterms:manage": [
    { resource: "suppliers", permissionType: "manage" },
    { resource: "purchases", permissionType: "update" },
  ],
  "carriers:manage": [
    { resource: "warehouses", permissionType: "manage" },
    { resource: "warehouses", permissionType: "update" },
  ],
  "approval-policies:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
  ],
  "documents:manage": [
    { resource: "documents", permissionType: "manage" },
    { resource: "documents", permissionType: "update" },
  ],
  "settings:manage": [
    { resource: "settings", permissionType: "manage" },
    { resource: "settings", permissionType: "update" },
    { resource: "settings", permissionType: "configure" },
  ],
};

const MDM_REGISTRY_DOMAIN_ALIASES: Record<string, string> = {
  sites: "legal-entities",
  "supplier-documents": "supplier-compliance-documents",
  "supplier-bank-accounts": "supplier-banks",
  "supplier-items": "suppliers",
  "uom-classes": "units-of-measure",
  "exchange-rates": "fx-rates",
  "procurement-policies": "approval-rules",
  "document-templates": "document-sequences",
  "gl-mappings": "gl-accounts",
  "import-batches": "documents",
  "data-quality-issues": "settings",
};

function governedMdmFields(domain: string, payload: Record<string, unknown>): string[] {
  const registryKey = MDM_REGISTRY_DOMAIN_ALIASES[domain] ?? domain;
  return Object.keys(payload).filter((field) => isHighRiskMdmField(registryKey, field));
}

function requireGovernedMdmChange(res: Response, domain: string, payload: Record<string, unknown>) {
  const fields = governedMdmFields(domain, payload);
  if (fields.length === 0) return false;
  sendError(
    res,
    409,
    "MDM_CHANGE_REQUEST_REQUIRED",
    `Direct changes to controlled ${domain} fields are not allowed.`,
    {
      hint: "Create an MDM change request, obtain independent approval, then apply the approved version.",
      details: { domain, controlledFields: fields, changeRequestEndpoint: "/api/mdm/change-requests" },
    },
  );
  return true;
}

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

  app.get("/api/master-data/overview", ...masterRead, async (_req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      return sendOk(res, await getMasterDataGovernanceOverview(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error building Master Data governance overview:", error);
      return sendError(res, 500, "MASTER_DATA_OVERVIEW_FAILED", "Master Data governance could not be summarized.", {
        hint: "Retry the overview or open System Diagnostics with the request ID.",
      });
    }
  });

  async function hasResolvedPermission(
    req: Request,
    aliases: Array<{ resource: string; permissionType: string }>,
  ): Promise<boolean> {
    const user = (req as Request & { user?: { id?: number; role?: string } }).user;
    if (!user) return false;
    if (user.role === "admin") return true;
    for (const alias of aliases) {
      if (await storage.checkPermission(user.role ?? "", alias.resource, alias.permissionType)) {
        return true;
      }
      if (user.role === "custom" && user.id) {
        const customRoleId = await storage.getUserCustomRoleId(user.id);
        if (customRoleId && (await storage.checkCustomRolePermission(customRoleId, alias.resource as any, alias.permissionType as any))) {
          return true;
        }
      }
    }
    return false;
  }

  function requiredPermissionsForDomain(domain: string, action: MdmPermissionAction): string[] {
    const registryKey = getMdmDomainRegistryEntry(domain) ? domain : MDM_REGISTRY_DOMAIN_ALIASES[domain];
    const registryPermissions = registryKey ? getMdmDomainRegistryEntry(registryKey)?.requiredPermissions ?? [] : [];
    if (registryPermissions.length > 0) return registryPermissions;
    if (action === "read") return ["master-data:read"];
    if (action === "import") return ["master-data:read", "documents:manage"];
    return ["master-data:read", "settings:manage"];
  }

  function resolvePermissionAliases(permission: string): Array<{ resource: string; permissionType: string }> {
    const explicit = MDM_PERMISSION_ALIASES[permission];
    if (explicit) return explicit;
    const [resourceRaw, permissionTypeRaw] = permission.split(":");
    const resource = String(resourceRaw ?? "").replace(/-/g, "_");
    const permissionType = String(permissionTypeRaw ?? "read");
    return resource && permissionType ? [{ resource, permissionType }] : [];
  }

  function sendMdmPermissionDenied(
    res: Response,
    domain: string,
    action: MdmPermissionAction,
    requiredPermissions: string[],
  ) {
    return sendError(
      res,
      403,
      "MDM_PERMISSION_DENIED",
      `You do not have permission to ${action} Master Data domain ${domain}.`,
      {
        hint:
          "Ask an administrator to grant the required domain permission or submit the change through an approved steward role.",
        details: {
          domain,
          action,
          requiredPermissions,
        },
      },
    );
  }

  function requireMdmPermission(domainInput: string | ((req: Request) => string), action: MdmPermissionAction): RequestHandler {
    return async (req: Request, res: Response, next) => {
      const domain = typeof domainInput === "function" ? domainInput(req) : domainInput;
      const requiredPermissions = requiredPermissionsForDomain(domain, action);
      for (const permission of requiredPermissions) {
        const aliases = resolvePermissionAliases(permission);
        if (!(await hasResolvedPermission(req, aliases))) {
          return sendMdmPermissionDenied(res, domain, action, requiredPermissions);
        }
      }
      return next();
    };
  }

  async function requireMdmPermissionForChangeRequest(
    req: Request,
    res: Response,
    action: MdmPermissionAction,
  ): Promise<boolean> {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      sendError(res, 400, "INVALID_ID", "Invalid change request ID");
      return false;
    }
    const change = await getMdmChangeRequest(getActiveOrganizationId(), id);
    if (!change) {
      sendError(res, 404, "NOT_FOUND", "MDM change request not found");
      return false;
    }
    const domain = String((change as { domain?: unknown }).domain ?? "");
    const requiredPermissions = requiredPermissionsForDomain(domain, action);
    for (const permission of requiredPermissions) {
      const aliases = resolvePermissionAliases(permission);
      if (!(await hasResolvedPermission(req, aliases))) {
        sendMdmPermissionDenied(res, domain, action, requiredPermissions);
        return false;
      }
    }
    return true;
  }

  function sessionUserId(req: Request): number | undefined {
    const id = (req as Request & { user?: { id?: unknown } }).user?.id;
    const n = Number(id);
    return Number.isFinite(n) ? n : undefined;
  }

  function sendMdmApprovalError(res: Response, error: unknown) {
    if (error && typeof error === "object" && "status" in error && "code" in error) {
      const structured = error as { status?: unknown; code?: unknown; message?: unknown };
      return sendError(
        res,
        Number(structured.status) || 403,
        typeof structured.code === "string" ? structured.code : "MDM_APPROVAL_BLOCKED",
        typeof structured.message === "string" ? structured.message : "MDM approval was blocked",
      );
    }
    return null;
  }

  app.get("/api/mdm/control-centre/health", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getMdmControlCentreHealth(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error fetching MDM control-centre health:", error);
      return sendError(res, 500, "MDM_HEALTH_FAILED", "Failed to build Master Data control-centre health");
    }
  });

  app.get("/api/mdm/fx/status", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, { provider: getFxProviderStatus(), freshness: await getFxRateFreshness(getActiveOrganizationId()) });
    } catch (error) {
      console.error("Error loading FX provider status:", error);
      return sendError(res, 500, "FX_STATUS_FAILED", "FX provider and rate freshness could not be loaded.");
    }
  });

  app.post("/api/mdm/fx/import", ...masterRead, auth.ensureTwoFactorAuthenticated, requireMdmPermission("exchange-rates", "import"), async (_req: Request, res: Response) => {
    try {
      if (!process.env.FX_PROVIDER_URL) return sendError(res, 409, "FX_PROVIDER_NOT_CONFIGURED", "The FX provider is not configured.", { hint: "Set FX_PROVIDER_URL and optionally FX_PROVIDER_TOKEN on the server." });
      return sendOk(res, await importFxRatesForOrganizations());
    } catch (error) {
      console.error("FX provider import failed:", error);
      return sendError(res, 502, "FX_PROVIDER_IMPORT_FAILED", "FX rates could not be imported from the configured provider.");
    }
  });

  app.get("/api/mdm/domain-registry", ...masterRead, async (_req: Request, res: Response) => {
    return sendOk(res, getMdmDomainRegistry());
  });

  app.get("/api/mdm/change-requests", ...masterRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listMdmChangeRequests(getActiveOrganizationId()));
    } catch (error) {
      console.error("Error listing MDM change requests:", error);
      return sendError(res, 500, "MDM_CHANGE_REQUEST_LIST_FAILED", "Failed to list MDM change requests");
    }
  });

  app.get("/api/mdm/change-requests/:id", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid change request ID");
      const change = await getMdmChangeRequest(getActiveOrganizationId(), id);
      if (!change) return sendError(res, 404, "NOT_FOUND", "MDM change request not found");
      return sendOk(res, change);
    } catch (error) {
      console.error("Error fetching MDM change request:", error);
      return sendError(res, 500, "MDM_CHANGE_REQUEST_GET_FAILED", "Failed to fetch MDM change request");
    }
  });

  app.post(
    "/api/mdm/change-requests",
    ...masterRead,
    requireMdmPermission((req) => String(req.body?.domain ?? ""), "create"),
    async (req: Request, res: Response) => {
    try {
      return sendOk(
        res,
        await createMdmChangeRequest({
          organizationId: getActiveOrganizationId(),
          domain: String(req.body?.domain ?? ""),
          entityId: req.body?.entityId == null ? null : Number(req.body.entityId),
          action: String(req.body?.action ?? "update") as any,
          proposedPatch:
            req.body?.proposedPatch && typeof req.body.proposedPatch === "object" ? req.body.proposedPatch : {},
          beforeState: req.body?.beforeState && typeof req.body.beforeState === "object" ? req.body.beforeState : null,
          submittedBy: sessionUserId(req),
          reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
        }),
        201,
      );
    } catch (error) {
      console.error("Error creating MDM change request:", error);
      return sendError(
        res,
        500,
        "MDM_CHANGE_REQUEST_CREATE_FAILED",
        error instanceof Error ? error.message : "Failed to create MDM change request",
      );
    }
    },
  );

  app.post("/api/mdm/change-requests/:id/approve", ...masterRead, auth.ensureTwoFactorAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const actorId = sessionUserId(req);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid change request ID");
      if (!actorId) return sendError(res, 401, "UNAUTHENTICATED", "A signed-in user is required");
      if (!(await requireMdmPermissionForChangeRequest(req, res, "approve"))) return;
      const approved = await approveMdmChangeRequest({
        organizationId: getActiveOrganizationId(),
        id,
        actorId,
        reason: String(req.body?.reason ?? "Approved"),
        allowAdminOverride: req.body?.allowAdminOverride === true,
      });
      if (!approved) return sendError(res, 404, "NOT_FOUND", "MDM change request not found");
      return sendOk(res, approved);
    } catch (error) {
      console.error("Error approving MDM change request:", error);
      const structured = sendMdmApprovalError(res, error);
      if (structured) return structured;
      return sendError(res, 500, "MDM_CHANGE_REQUEST_APPROVAL_FAILED", "Failed to approve MDM change request");
    }
  });

  app.post("/api/mdm/change-requests/:id/reject", ...masterRead, auth.ensureTwoFactorAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const actorId = sessionUserId(req);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid change request ID");
      if (!actorId) return sendError(res, 401, "UNAUTHENTICATED", "A signed-in user is required");
      if (!(await requireMdmPermissionForChangeRequest(req, res, "approve"))) return;
      const rejected = await rejectMdmChangeRequest({
        organizationId: getActiveOrganizationId(),
        id,
        actorId,
        reason: String(req.body?.reason ?? "Rejected"),
      });
      if (!rejected) return sendError(res, 404, "NOT_FOUND", "MDM change request not found");
      return sendOk(res, rejected);
    } catch (error) {
      console.error("Error rejecting MDM change request:", error);
      const structured = sendMdmApprovalError(res, error);
      if (structured) return structured;
      return sendError(res, 500, "MDM_CHANGE_REQUEST_REJECT_FAILED", "Failed to reject MDM change request");
    }
  });

  app.post("/api/mdm/change-requests/:id/apply", ...masterRead, auth.ensureTwoFactorAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const actorId = sessionUserId(req);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid change request ID");
      if (!actorId) return sendError(res, 401, "UNAUTHENTICATED", "A signed-in user is required");
      if (!(await requireMdmPermissionForChangeRequest(req, res, "apply"))) return;
      const applied = await applyMdmChangeRequest({
        organizationId: getActiveOrganizationId(),
        id,
        actorId,
        reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
        allowAdminOverride: req.body?.allowAdminOverride === true,
      });
      if (!applied) return sendError(res, 404, "NOT_FOUND", "MDM change request not found");
      return sendOk(res, applied);
    } catch (error) {
      console.error("Error applying MDM change request:", error);
      const structured = sendMdmApprovalError(res, error);
      if (structured) return structured;
      return sendError(
        res,
        500,
        "MDM_CHANGE_REQUEST_APPLY_FAILED",
        error instanceof Error ? error.message : "Failed to apply MDM change request",
      );
    }
  });

  app.post("/api/mdm/change-requests/:id/comments", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const actorId = sessionUserId(req);
      const comment = String(req.body?.comment ?? "").trim();
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid change request ID");
      if (!actorId) return sendError(res, 401, "UNAUTHENTICATED", "A signed-in user is required");
      if (!comment) return sendError(res, 400, "MDM_COMMENT_REQUIRED", "A comment is required");
      if (!(await requireMdmPermissionForChangeRequest(req, res, "comment"))) return;
      const created = await addMdmChangeRequestComment({
        organizationId: getActiveOrganizationId(),
        id,
        actorId,
        comment,
      });
      if (!created) return sendError(res, 404, "NOT_FOUND", "MDM change request not found");
      return sendOk(res, created, 201);
    } catch (error) {
      console.error("Error adding MDM change request comment:", error);
      return sendError(res, 500, "MDM_CHANGE_REQUEST_COMMENT_FAILED", "Failed to add MDM change request comment");
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

  app.post("/api/mdm/data-quality/scan", ...masterRead, requireMdmPermission("data-quality-issues", "scan"), async (_req: Request, res: Response) => {
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

  app.get("/api/purchase-requisitions/:id/default-drift", ...masterRead, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_ID", "Invalid requisition ID");
    const organizationId = getActiveOrganizationId();
    const result = await pool.query(
      `SELECT requisition.*, supplier.default_currency_code, supplier.default_department_id
       FROM purchase_requisitions requisition
       LEFT JOIN suppliers supplier ON supplier.id = requisition.supplier_id AND supplier.organization_id = requisition.organization_id
       WHERE requisition.organization_id = $1 AND requisition.id = $2`,
      [organizationId, id],
    );
    const row = result.rows[0];
    if (!row) return sendError(res, 404, "REQUISITION_NOT_FOUND", "Requisition not found");
    const changes = [
      row.default_currency_code && row.default_currency_code !== row.currency_code ? { field: "currencyCode", current: row.currency_code, suggested: row.default_currency_code, source: "supplier" } : null,
      row.default_department_id && Number(row.default_department_id) !== Number(row.department_id) ? { field: "departmentId", current: row.department_id, suggested: row.default_department_id, source: "supplier" } : null,
    ].filter(Boolean);
    return sendOk(res, { id, status: row.status, revision: new Date(row.updated_at).toISOString(), mutable: row.status === "DRAFT", changes });
  });

  app.post("/api/purchase-requisitions/:id/refresh-defaults", ...masterRead, requireMdmPermission("procurement-policies", "update"), async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const expectedRevision = String(req.body?.expectedRevision ?? "");
    const fields = Array.isArray(req.body?.fields) ? req.body.fields.map(String) : [];
    if (!Number.isInteger(id) || id <= 0 || !expectedRevision) return sendError(res, 400, "INVALID_REFRESH_REQUEST", "A requisition ID and expectedRevision are required.");
    const organizationId = getActiveOrganizationId();
    const current = await pool.query(
      `SELECT requisition.*, supplier.default_currency_code, supplier.default_department_id
       FROM purchase_requisitions requisition LEFT JOIN suppliers supplier ON supplier.id = requisition.supplier_id AND supplier.organization_id = requisition.organization_id
       WHERE requisition.organization_id = $1 AND requisition.id = $2 FOR UPDATE`, [organizationId, id],
    );
    const row = current.rows[0];
    if (!row) return sendError(res, 404, "REQUISITION_NOT_FOUND", "Requisition not found");
    if (row.status !== "DRAFT") return sendError(res, 409, "DOCUMENT_IMMUTABLE", "Submitted or completed requisitions preserve their Master Data snapshot.");
    if (new Date(row.updated_at).toISOString() !== expectedRevision) return sendError(res, 409, "STALE_REVISION", "The requisition changed after drift review. Reload and review changes again.");
    const allowed = new Set(["currencyCode", "departmentId"]);
    if (fields.some((field: string) => !allowed.has(field))) return sendError(res, 400, "INVALID_REFRESH_FIELD", "Only reviewed Master Data fields can be refreshed.");
    const updated = await pool.query(
      `UPDATE purchase_requisitions SET
        currency_code = CASE WHEN $3::boolean THEN COALESCE($4, currency_code) ELSE currency_code END,
        department_id = CASE WHEN $5::boolean THEN COALESCE($6, department_id) ELSE department_id END,
        updated_at = now()
       WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, id, fields.includes("currencyCode"), row.default_currency_code, fields.includes("departmentId"), row.default_department_id],
    );
    return sendOk(res, updated.rows[0]);
  });

  app.get("/api/procurement/purchase-orders/:id/default-drift", ...masterRead, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const organizationId = getActiveOrganizationId();
    const result = await pool.query(
      `SELECT purchase_order.*, supplier.default_currency_code, supplier.payment_terms_id AS supplier_payment_terms_id,
        supplier.incoterm_id AS supplier_incoterm_id, supplier.default_department_id
       FROM purchase_orders purchase_order JOIN suppliers supplier ON supplier.id = purchase_order.supplier_id AND supplier.organization_id = purchase_order.organization_id
       WHERE purchase_order.organization_id = $1 AND purchase_order.id = $2`, [organizationId, id],
    );
    const row = result.rows[0];
    if (!row) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
    const comparisons = [
      ["currencyCode", row.currency_code, row.default_currency_code], ["paymentTermsId", row.payment_terms_id, row.supplier_payment_terms_id],
      ["incotermId", row.incoterm_id, row.supplier_incoterm_id], ["departmentId", row.department_id, row.default_department_id],
    ];
    const changes = comparisons.filter(([, currentValue, suggested]) => suggested != null && String(currentValue ?? "") !== String(suggested)).map(([field, currentValue, suggested]) => ({ field, current: currentValue, suggested, source: "supplier" }));
    return sendOk(res, { id, status: row.status, revision: Number(row.revision_number), mutable: row.status === "DRAFT", changes });
  });

  app.post("/api/procurement/purchase-orders/:id/refresh-defaults", ...masterRead, requireMdmPermission("procurement-policies", "update"), async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const expectedRevision = Number(req.body?.expectedRevision);
    const fields = Array.isArray(req.body?.fields) ? req.body.fields.map(String) : [];
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(expectedRevision)) return sendError(res, 400, "INVALID_REFRESH_REQUEST", "A purchase order ID and expectedRevision are required.");
    const allowed = new Set(["currencyCode", "paymentTermsId", "incotermId", "departmentId"]);
    if (fields.some((field: string) => !allowed.has(field))) return sendError(res, 400, "INVALID_REFRESH_FIELD", "Only reviewed Master Data fields can be refreshed.");
    const organizationId = getActiveOrganizationId();
    const result = await pool.query(
      `UPDATE purchase_orders purchase_order SET
        currency_code = CASE WHEN $4::boolean THEN COALESCE(supplier.default_currency_code, purchase_order.currency_code) ELSE purchase_order.currency_code END,
        payment_terms_id = CASE WHEN $5::boolean THEN COALESCE(supplier.payment_terms_id, purchase_order.payment_terms_id) ELSE purchase_order.payment_terms_id END,
        incoterm_id = CASE WHEN $6::boolean THEN COALESCE(supplier.incoterm_id, purchase_order.incoterm_id) ELSE purchase_order.incoterm_id END,
        department_id = CASE WHEN $7::boolean THEN COALESCE(supplier.default_department_id, purchase_order.department_id) ELSE purchase_order.department_id END,
        revision_number = purchase_order.revision_number + 1, updated_at = now()
       FROM suppliers supplier
       WHERE purchase_order.organization_id = $1 AND purchase_order.id = $2 AND purchase_order.revision_number = $3
         AND purchase_order.status = 'DRAFT' AND supplier.id = purchase_order.supplier_id AND supplier.organization_id = purchase_order.organization_id
       RETURNING purchase_order.*`,
      [organizationId, id, expectedRevision, fields.includes("currencyCode"), fields.includes("paymentTermsId"), fields.includes("incotermId"), fields.includes("departmentId")],
    );
    if (!result.rows[0]) {
      const exists = await pool.query("SELECT status, revision_number FROM purchase_orders WHERE organization_id = $1 AND id = $2", [organizationId, id]);
      if (!exists.rows[0]) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      if (exists.rows[0].status !== "DRAFT") return sendError(res, 409, "DOCUMENT_IMMUTABLE", "Approved or completed purchase orders preserve their Master Data snapshot.");
      return sendError(res, 409, "STALE_REVISION", "The purchase order changed after drift review. Reload and review changes again.");
    }
    return sendOk(res, result.rows[0]);
  });

  app.post("/api/mdm/validate-transaction", ...masterRead, requireMdmPermission("procurement-policies", "scan"), async (req: Request, res: Response) => {
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

  app.post("/api/mdm/import-batches", ...masterRead, requireMdmPermission((req) => String(req.body?.domain ?? "import-batches"), "import"), async (req: Request, res: Response) => {
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

  app.get("/api/mdm/:domain/:id/where-used", ...masterRead, async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid MDM record ID");
      return sendOk(res, await getMdmWhereUsed(domain, getActiveOrganizationId(), id));
    } catch (error) {
      console.error("Error fetching MDM where-used:", error);
      return sendError(res, 500, "MDM_WHERE_USED_FAILED", "Failed to fetch Master Data dependency usage");
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

  app.post("/api/mdm/:domain", ...masterRead, requireMdmPermission((req) => String(req.params.domain ?? ""), "create"), async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      if (!isMdmDomain(domain)) return sendError(res, 404, "MDM_DOMAIN_NOT_FOUND", "Unknown MDM domain");
      if (requireGovernedMdmChange(res, domain, req.body ?? {})) return;
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

  app.patch("/api/mdm/:domain/:id", ...masterRead, requireMdmPermission((req) => String(req.params.domain ?? ""), "update"), async (req: Request, res: Response) => {
    try {
      const domain = String(req.params.domain ?? "");
      if (!isMdmDomain(domain)) return sendError(res, 404, "MDM_DOMAIN_NOT_FOUND", "Unknown MDM domain");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_ID", "Invalid MDM record ID");
      if (req.body?.active === false) {
        const usage = await getMdmDisableDependencies(domain, getActiveOrganizationId(), id);
        if (usage.length > 0) {
          const total = usage.reduce((sum, entry) => sum + entry.count, 0);
          return sendError(
            res,
            409,
            "MDM_RECORD_IN_USE",
            `Cannot deactivate this ${domain} record while it is used by ${total} open workflow record${total === 1 ? "" : "s"}.`,
            { details: { usage } },
          );
        }
      }
      if (requireGovernedMdmChange(res, domain, req.body ?? {})) return;
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
        if (code === "MDM_STALE_VERSION" && Number.isFinite(status) && status >= 400 && status < 600) {
          return sendError(res, status, code, message);
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
    app.get(basePath, ...masterRead, async (req: Request, res: Response) => {
      try {
        const paginated = req.query.page != null || req.query.pageSize != null || req.query.q != null || req.query.status != null;
        if (!paginated) {
          let legacyQuery = db.select().from(table).$dynamic();
          if (table.organizationId) {
            legacyQuery = legacyQuery.where(eq(table.organizationId, getActiveOrganizationId()));
          }
          const rows = await legacyQuery;
          return sendOk(res, rows);
        }
        const page = Math.max(1, Number(req.query.page ?? 1) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25) || 25));
        const q = String(req.query.q ?? "").trim();
        const status = String(req.query.status ?? "all").trim();
        const clauses: any[] = table.organizationId ? [eq(table.organizationId, getActiveOrganizationId())] : [];
        const searchColumns = [table.code, table.name, table.description].filter(Boolean);
        if (q && searchColumns.length > 0) {
          clauses.push(or(...searchColumns.map((column: any) => ilike(column, `%${q}%`))));
        }
        if (table.active && status === "active") clauses.push(eq(table.active, true));
        if (table.active && status === "inactive") clauses.push(eq(table.active, false));
        const where = clauses.length > 0 ? and(...clauses) : undefined;
        let rowsQuery = db.select().from(table).$dynamic();
        let countQuery = db.select({
          count: sql<number>`count(*)::int`,
          active: table.active
            ? sql<number>`count(*) filter (where ${table.active} = true)::int`
            : sql<number>`count(*)::int`,
          inactive: table.active
            ? sql<number>`count(*) filter (where ${table.active} = false)::int`
            : sql<number>`0::int`,
        }).from(table).$dynamic();
        if (where) {
          rowsQuery = rowsQuery.where(where);
          countQuery = countQuery.where(where);
        }
        const rows = await rowsQuery
          .orderBy(table.code ? table.code : table.id)
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        const [countRow] = await countQuery;
        const total = Number(countRow?.count ?? 0);
        return sendOk(res, {
          items: rows,
          total,
          page,
          pageSize,
          hasNext: page * pageSize < total,
          summary: { active: Number(countRow?.active ?? total), inactive: Number(countRow?.inactive ?? 0) },
        });
      } catch (error) {
        console.error(`Error fetching ${basePath}:`, error);
        return sendError(res, 500, "MASTER_DATA_LIST_FAILED", "Failed to fetch records");
      }
    });

    app.get(`${basePath}/:id`, ...masterRead, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return sendError(res, 400, "INVALID_ID", "Invalid ID");
        const rowScope = table.organizationId ? and(eq(table.id, id), eq(table.organizationId, getActiveOrganizationId())) : eq(table.id, id);
        const rows = (await db.select().from(table).where(rowScope)) as any[];
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
        if (basePath === "/api/carriers") {
          return sendError(
            res,
            409,
            "CARRIER_SUPPLIER_AUTHORITY_REQUIRED",
            "Carrier profiles are created from approved suppliers classified as Carrier / logistics provider.",
            { hint: "Create or edit the business party in Procurement > Suppliers. Logistics and Master Data consume the synchronized carrier profile." },
          );
        }
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
        const scopedBody = table.organizationId && normalizedBody && typeof normalizedBody === "object"
          ? { ...(normalizedBody as Record<string, unknown>), organizationId: getActiveOrganizationId() }
          : normalizedBody;
        const payload = insertSchema.parse(scopedBody) as any;
        if (["/api/inventory-batches", "/api/inventory-serials", "/api/inventory-allocations", "/api/cycle-counts"].includes(basePath)) {
          const orgId = getActiveOrganizationId();
          const warehouseId = Number(payload.warehouseId);
          const [warehouse] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, orgId))).limit(1);
          if (!warehouse) return sendError(res, 400, "INVALID_WAREHOUSE", "Warehouse is required and must belong to the active organization");
          if (basePath !== "/api/cycle-counts") {
            const itemId = Number(payload.itemId);
            const [item] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.organizationId, orgId))).limit(1);
            if (!item) return sendError(res, 400, "INVALID_ITEM", "Item must belong to the active organization");
            if (basePath === "/api/inventory-allocations") {
              const [stock] = await db.select({ quantity: warehouseInventory.quantity }).from(warehouseInventory).where(and(eq(warehouseInventory.organizationId, orgId), eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.itemId, itemId))).limit(1);
              const [reserved] = await db.select({ quantity: sql<number>`coalesce(sum(${inventoryAllocations.quantity}), 0)::int` }).from(inventoryAllocations).where(and(eq(inventoryAllocations.organizationId, orgId), eq(inventoryAllocations.warehouseId, warehouseId), eq(inventoryAllocations.itemId, itemId), eq(inventoryAllocations.status, "reserved")));
              if (Number(payload.quantity) > Number(stock?.quantity ?? 0) - Number(reserved?.quantity ?? 0)) return sendError(res, 400, "INSUFFICIENT_AVAILABILITY", "Allocation quantity exceeds available warehouse stock");
            }
          }
        }
        const createdRows = (await db.insert(table).values(payload).returning()) as any[];
        const created = createdRows[0];
        if (basePath === "/api/currencies" && Number.isFinite(Number(created?.exchangeRateToZar)) && Number(created.exchangeRateToZar) > 0) {
          const toCode = await getCanonicalReportingCurrencyCode(getActiveOrganizationId());
          const fromCode = String(created.code ?? "").toUpperCase();
          if (fromCode && fromCode !== toCode) await pool.query(
            `INSERT INTO mdm_exchange_rates (organization_id, from_currency_code, to_currency_code, rate, source, effective_date, active)
             VALUES ($1,$2,$3,$4,'master_data_currency_editor',now(),true)`,
            [getActiveOrganizationId(), fromCode, toCode, Number(created.exchangeRateToZar)],
          );
        }
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
        if (
          basePath === "/api/carriers" &&
          patchBody &&
          typeof patchBody === "object" &&
          ["code", "name", "contact", "supplierId", "supplier_id"].some((field) =>
            Object.prototype.hasOwnProperty.call(patchBody, field),
          )
        ) {
          return sendError(
            res,
            409,
            "CARRIER_SUPPLIER_AUTHORITY_REQUIRED",
            "Carrier identity and contact fields are governed by the linked supplier.",
            { hint: "Update the carrier's supplier profile. The logistics carrier profile will synchronize automatically." },
          );
        }
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
          if ("exchangeRateToZar" in incoming) {
            const rate = Number(incoming.exchangeRateToZar);
            if (!Number.isFinite(rate) || rate <= 0) return sendError(res, 400, "INVALID_EXCHANGE_RATE", "Current exchange rate must be greater than zero.");
          }
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
        const updateScope = table.organizationId ? and(eq(table.id, id), eq(table.organizationId, getActiveOrganizationId())) : eq(table.id, id);
        const updatedRows = (await db.update(table).set(payload).where(updateScope).returning()) as any[];
        const updated = updatedRows[0];
        if (!updated) return sendError(res, 404, "NOT_FOUND", "Record not found");
        if (basePath === "/api/currencies" && patchBody && typeof patchBody === "object" && "exchangeRateToZar" in patchBody) {
          const rate = Number((patchBody as { exchangeRateToZar?: unknown }).exchangeRateToZar);
          const toCode = await getCanonicalReportingCurrencyCode(getActiveOrganizationId());
          const fromCode = String(updated.code ?? "").toUpperCase();
          if (fromCode && fromCode !== toCode) await pool.query(
            `INSERT INTO mdm_exchange_rates (organization_id, from_currency_code, to_currency_code, rate, source, effective_date, active)
             VALUES ($1,$2,$3,$4,'master_data_currency_editor',now(),true)`,
            [getActiveOrganizationId(), fromCode, toCode, rate],
          );
        }
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
        const deleteScope = table.organizationId ? and(eq(table.id, id), eq(table.organizationId, getActiveOrganizationId())) : eq(table.id, id);
        const deleted = (await db.delete(table).where(deleteScope).returning({ id: table.id })) as any[];
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

  app.get("/api/v2/inventory-allocations", ...masterRead, async (req: Request, res: Response) => {
    const parsePositiveInteger = (value: unknown, fallback: number) => {
      if (value == null || value === "") return fallback;
      const raw = String(value);
      if (!/^\d+$/.test(raw)) return null;
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    };

    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = parsePositiveInteger(req.query.pageSize, 25);
    const status = String(req.query.status ?? "reserved").trim().toLowerCase();
    const q = String(req.query.q ?? "").trim();
    if (page == null || pageSize == null || ![25, 50, 100].includes(pageSize)) {
      return sendError(res, 400, "INVALID_PAGINATION", "page must be a positive integer and pageSize must be 25, 50, or 100");
    }
    if (!["reserved", "fulfilled", "cancelled", "all"].includes(status)) {
      return sendError(res, 400, "INVALID_FILTER", "status must be reserved, fulfilled, cancelled, or all");
    }

    try {
      const organizationId = getActiveOrganizationId();
      const clauses = [
        eq(inventoryAllocations.organizationId, organizationId),
        gt(inventoryAllocations.quantity, 0),
      ];
      if (status !== "all") clauses.push(eq(inventoryAllocations.status, status));
      if (q) {
        clauses.push(or(
          ilike(inventoryItems.sku, `%${q}%`),
          ilike(inventoryItems.name, `%${q}%`),
          ilike(warehouses.name, `%${q}%`),
        )!);
      }
      const where = and(...clauses);
      const itemJoin = and(
        eq(inventoryItems.id, inventoryAllocations.itemId),
        eq(inventoryItems.organizationId, organizationId),
      );
      const warehouseJoin = and(
        eq(warehouses.id, inventoryAllocations.warehouseId),
        eq(warehouses.organizationId, organizationId),
      );
      const rows = await db
        .select({
          id: inventoryAllocations.id,
          itemId: inventoryAllocations.itemId,
          warehouseId: inventoryAllocations.warehouseId,
          quantity: inventoryAllocations.quantity,
          orderId: inventoryAllocations.orderId,
          requisitionId: inventoryAllocations.requisitionId,
          status: inventoryAllocations.status,
          createdAt: inventoryAllocations.createdAt,
          itemSku: inventoryItems.sku,
          itemName: inventoryItems.name,
          warehouseName: warehouses.name,
        })
        .from(inventoryAllocations)
        .leftJoin(inventoryItems, itemJoin)
        .leftJoin(warehouses, warehouseJoin)
        .where(where)
        .orderBy(desc(inventoryAllocations.createdAt), desc(inventoryAllocations.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryAllocations)
        .leftJoin(inventoryItems, itemJoin)
        .leftJoin(warehouses, warehouseJoin)
        .where(where);
      const total = Number(countRow?.count ?? 0);
      return sendOk(res, {
        items: rows,
        total,
        page,
        pageSize,
        hasNext: page * pageSize < total,
      });
    } catch (error) {
      console.error("Error fetching paginated inventory allocations:", error);
      return sendError(res, 500, "INVENTORY_ALLOCATIONS_LIST_FAILED", "Failed to fetch inventory allocations");
    }
  });

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

  app.get("/api/approval-policies", ...masterRead, async (req: Request, res: Response) => {
    try {
      const organizationId = getActiveOrganizationId();
      const paginated = req.query.page != null || req.query.pageSize != null || req.query.q != null || req.query.entityType != null || req.query.overlapOnly != null;
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25) || 25));
      const q = String(req.query.q ?? "").trim();
      const entityType = String(req.query.entityType ?? "").trim();
      const status = String(req.query.status ?? "all").trim();
      const overlapOnly = String(req.query.overlapOnly ?? "false") === "true";
      const clauses = [eq(approvalPolicies.organizationId, organizationId)];
      if (q) clauses.push(or(ilike(approvalPolicies.name, `%${q}%`), ilike(approvalPolicies.entityType, `%${q}%`))!);
      if (entityType && entityType !== "all") clauses.push(eq(approvalPolicies.entityType, entityType));
      if (status === "active") clauses.push(eq(approvalPolicies.isActive, true));
      if (status === "inactive") clauses.push(eq(approvalPolicies.isActive, false));
      if (overlapOnly) {
        clauses.push(sql<boolean>`EXISTS (
          SELECT 1 FROM approval_policies other
          WHERE other.organization_id = ${organizationId}
            AND other.id <> ${approvalPolicies.id}
            AND other.entity_type = ${approvalPolicies.entityType}
            AND other.approval_level = ${approvalPolicies.approvalLevel}
            AND COALESCE(other.is_active, true) = true
            AND COALESCE(${approvalPolicies.isActive}, true) = true
            AND other.amount_min <= COALESCE(${approvalPolicies.amountMax}, 'Infinity'::real)
            AND ${approvalPolicies.amountMin} <= COALESCE(other.amount_max, 'Infinity'::real)
        )`);
      }
      const where = and(...clauses);
      const rows = await db
        .select()
        .from(approvalPolicies)
        .where(where)
        .orderBy(desc(approvalPolicies.updatedAt), desc(approvalPolicies.id))
        .limit(paginated ? pageSize : 10_000)
        .offset(paginated ? (page - 1) * pageSize : 0);
      if (!paginated) return sendOk(res, rows);
      const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(approvalPolicies).where(where);
      const total = Number(countRow?.count ?? 0);
      return sendOk(res, { items: rows, total, page, pageSize, hasNext: page * pageSize < total });
    } catch (error) {
      console.error("Error fetching approval policies:", error);
      return sendError(res, 500, "APPROVAL_POLICIES_LIST_FAILED", "Failed to fetch approval policies");
    }
  });

  app.get("/api/approval-suggestions", ...masterRead, async (req: Request, res: Response) => {
    try {
      const entityType = String(req.query.entityType ?? "");
      const amount = Number(req.query.amount ?? NaN);
      if (!isGovernedApprovalEntityType(entityType)) {
        return sendError(
          res,
          400,
          "INVALID_ENTITY",
          `entityType must be one of: ${governedApprovalEntityTypes.join(", ")}`,
        );
      }
      if (!Number.isFinite(amount) || amount < 0) {
        return sendError(res, 400, "INVALID_AMOUNT", "amount must be a non-negative number");
      }
      const out = await getApprovalSuggestions(
        entityType,
        amount,
      );
      return sendOk(res, out);
    } catch (error) {
      console.error("Error building approval suggestions:", error);
      return sendError(res, 500, "SUGGESTIONS_FAILED", "Failed to load approval suggestions");
    }
  });

  app.get("/api/approval-workflows/:entityType/:entityId", ...masterRead, async (req: Request, res: Response) => {
    const entityType = String(req.params.entityType ?? "");
    const entityId = Number(req.params.entityId);
    const amount = Number(req.query.amount ?? 0);
    if (!isGovernedApprovalEntityType(entityType)) {
      return sendError(res, 400, "INVALID_APPROVAL_ENTITY", `entityType must be one of: ${governedApprovalEntityTypes.join(", ")}`);
    }
    if (!Number.isInteger(entityId) || entityId <= 0 || !Number.isFinite(amount) || amount < 0) {
      return sendError(res, 400, "INVALID_APPROVAL_WORKFLOW_QUERY", "entityId must be positive and amount must be non-negative.");
    }
    const progress = await getApprovalWorkflowProgress({
      organizationId: getActiveOrganizationId(),
      entityType,
      entityId,
      amount,
    });
    return sendOk(res, { entityType, entityId, amount, ...progress });
  });

  app.post("/api/approval-policies", ...masterWrite, async (req, res) => {
    try {
      const organizationId = getActiveOrganizationId();
      const payload = insertApprovalPolicySchema.parse({
        ...(req.body ?? {}),
        organizationId,
      });
      const conflicts = await findApprovalPolicyConflicts(organizationId, {
        entityType: payload.entityType,
        approvalLevel: Number(payload.approvalLevel ?? 1),
        amountMin: Number(payload.amountMin),
        amountMax: payload.amountMax == null ? null : Number(payload.amountMax),
        isActive: payload.isActive !== false,
      });
      if (conflicts.length > 0) {
        return sendError(
          res,
          409,
          "APPROVAL_POLICY_OVERLAP",
          "An active policy already covers this amount band at the same approval level.",
          { hint: "Adjust the amount band or approval level. Valid multi-level approval chains remain allowed.", details: { conflicts } },
        );
      }
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
      const rawBody = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      const expectedVersion = Number(rawBody.expectedVersion);
      const changeReason = typeof rawBody.changeReason === "string" ? rawBody.changeReason.trim() : "";
      const { expectedVersion: _expectedVersion, changeReason: _changeReason, version: _version, ...policyFields } = rawBody;
      const payload = insertApprovalPolicySchema.partial().parse(policyFields);
      const beforeRows = (await db
        .select()
        .from(approvalPolicies)
        .where(and(eq(approvalPolicies.id, id), eq(approvalPolicies.organizationId, getActiveOrganizationId())))
        .limit(1)) as any[];
      const before = beforeRows[0];
      if (!before) return sendError(res, 404, "NOT_FOUND", "Approval policy not found");
      if (Number.isFinite(expectedVersion) && expectedVersion !== Number(before.version ?? 1)) {
        return sendError(res, 409, "APPROVAL_POLICY_STALE", "This policy changed after you opened it.", {
          hint: "Reload the latest policy before saving your changes.",
          details: { expectedVersion, currentVersion: Number(before.version ?? 1) },
        });
      }
      const reasonFields = ["entityType", "amountMin", "amountMax", "approvalLevel", "approverRole", "approverUserId", "isActive"];
      const sensitiveChange = reasonFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field) && payload[field as keyof typeof payload] !== before[field]);
      if (sensitiveChange && !changeReason) {
        return sendError(res, 400, "APPROVAL_POLICY_CHANGE_REASON_REQUIRED", "Explain why approval routing is changing.", {
          details: { fieldIssues: { changeReason: ["A change reason is required for routing, threshold, approver, level, or activation changes."] } },
        });
      }
      const candidate = { ...before, ...payload } as ApprovalPolicyCandidate;
      const conflictControlledFields = ["entityType", "amountMin", "amountMax", "approvalLevel", "isActive"];
      const conflictShapeChanged = conflictControlledFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field) && payload[field as keyof typeof payload] !== before[field]);
      const isDeactivating = before.isActive !== false && candidate.isActive === false;
      const conflicts = conflictShapeChanged && !isDeactivating
        ? await findApprovalPolicyConflicts(getActiveOrganizationId(), {
            id,
            entityType: String(candidate.entityType),
            approvalLevel: Number(candidate.approvalLevel),
            amountMin: Number(candidate.amountMin),
            amountMax: candidate.amountMax == null ? null : Number(candidate.amountMax),
            isActive: candidate.isActive,
          })
        : [];
      if (conflicts.length > 0) {
        return sendError(
          res,
          409,
          "APPROVAL_POLICY_OVERLAP",
          "An active policy already covers this amount band at the same approval level.",
          { hint: "Adjust the amount band or approval level. Valid multi-level approval chains remain allowed.", details: { conflicts } },
        );
      }
      const updatedRows = (await db
        .update(approvalPolicies)
        .set({ ...payload, version: sql`${approvalPolicies.version} + 1`, updatedAt: new Date() })
        .where(and(
          eq(approvalPolicies.id, id),
          eq(approvalPolicies.organizationId, getActiveOrganizationId()),
          eq(approvalPolicies.version, Number(before.version ?? 1)),
        ))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return sendError(res, 409, "APPROVAL_POLICY_STALE", "This policy changed while you were saving it.", {
        hint: "Reload the latest policy before saving your changes.",
        details: { expectedVersion: Number(before.version ?? 1) },
      });
      if (req.user) {
        await storage.createActivityLog({
          action: "APPROVAL_POLICY_UPDATED",
          description: `Updated approval policy ${updated.name}. Old value: ${JSON.stringify(beforeRows[0] ?? null)}. New value: ${JSON.stringify(updated)}. Reason: ${changeReason || "Non-routing correction"}. Conflict state: ${conflicts.length ? "overlap" : "clear"}.`,
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
