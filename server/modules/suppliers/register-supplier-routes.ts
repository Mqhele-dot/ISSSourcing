import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { sendError, sendFunctionError, sendOk } from "../../api-response";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";
import { getActiveOrganizationId, getOptionalTenantContext } from "../../organization-context";
import { createSupplierRepository } from "../../repositories";
import { createSupplierService } from "../../services/supplier-service";
import { insertSupplierSchema, insertSupplierLogoSchema, PurchaseOrderStatus } from "@shared/schema";
import { detectSupplierDocumentMismatches } from "../procurement/supplier-defaults";
import type { AuthBundle } from "../procurement/types";
import { getReportingCurrencyCode } from "../../lib/org-reporting-money";
import { createInvoiceRecord } from "../accounts-payable/service";
import {
  dependencyBlockedMessage,
  getSupplierWhereUsed,
} from "../master-data/dependency-checks";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { mdmSupplierDocuments, organizationMembers, organizations, supplierPortalMappings, suppliers as supplierTable, users } from "@shared/schema";
import { appendAuditEvent } from "../../services/audit-chain-service";
import { getCountryPack } from "../master-data/country-pack-registry";

const supplierRepo = createSupplierRepository(storage);
const supplierService = createSupplierService(supplierRepo, storage);

async function recordSupplierConsistencyDiagnostics(orgId: number, supplierId: number): Promise<void> {
  try {
    const issues = await detectSupplierDocumentMismatches(orgId, supplierId);
    if (issues.length === 0) return;
    recordServerDiagnosticEvent({
      severity: "warning",
      source: "business-rule",
      title: "Supplier consistency warning",
      message: `${issues.length} downstream supplier document issue(s) detected after supplier change.`,
      details: { orgId, supplierId, examples: issues.slice(0, 5) },
    });
    await emitNotificationToRoles(["admin", "manager"], {
      type: "supplier_consistency_warning",
      title: "Supplier defaults need review",
      body: `${issues.length} supplier-linked document issue(s) need review in diagnostics.`,
      entityType: "supplier",
      entityId: supplierId,
    });
  } catch (error) {
    recordServerDiagnosticEvent({
      severity: "error",
      source: "business-rule",
      title: "Supplier consistency check failed",
      message: error instanceof Error ? error.message : String(error),
      details: { orgId, supplierId, error },
    });
  }
}

/**
 * Supplier CRUD, supplier portal, logos - org-scoped via repositories/storage.
 */
export function registerSupplierRoutes(app: Express, auth: AuthBundle): void {
  // Supplier endpoints - RBAC: viewer read-only; manager/admin can create/update/delete
  const supplierRead = [auth.ensureAuthenticated];
  const supplierWrite = [
    auth.ensureAuthenticated,
    auth.ensureTwoFactorAuthenticated,
    auth.ensureRole(["manager", "admin"]),
  ];

  const resolveSupplierIdForUser = async (req: Request): Promise<number | null> => {
    const user = (req as Request & { user?: { id: number; role?: string; email?: string } }).user;
    if (!user) return null;
    const explicit = Number(req.query.supplierId ?? req.body?.supplierId);
    const hasExplicit = Number.isFinite(explicit) && explicit > 0;
    const activeRole = getOptionalTenantContext()?.userRole ?? user.role;
    if (activeRole === "supplier") {
      const [tenantMapping] = await db
        .select({ supplierId: supplierPortalMappings.supplierId })
        .from(supplierPortalMappings)
        .innerJoin(
          supplierTable,
          and(
            eq(supplierTable.id, supplierPortalMappings.supplierId),
            eq(supplierTable.organizationId, getActiveOrganizationId()),
          ),
        )
        .where(
          and(
            eq(supplierPortalMappings.organizationId, getActiveOrganizationId()),
            eq(supplierPortalMappings.userId, user.id),
            eq(supplierPortalMappings.active, true),
          ),
        )
        .limit(1);
      if (tenantMapping?.supplierId) return tenantMapping.supplierId;
      const fullUser = await storage.getUser(Number(user.id));
      const legacySupplierId = Number(fullUser?.supplierId);
      if (Number.isFinite(legacySupplierId) && legacySupplierId > 0) {
        const [legacyMapping] = await db
          .select({ id: supplierTable.id })
          .from(supplierTable)
          .where(and(eq(supplierTable.id, legacySupplierId), eq(supplierTable.organizationId, getActiveOrganizationId())))
          .limit(1);
        if (legacyMapping) return legacyMapping.id;
      }
      return null;
    }
    if (activeRole === "admin" || activeRole === "manager") {
      return hasExplicit ? explicit : null;
    }
    return null;
  };

  app.get("/api/suppliers", ...supplierRead, async (_req: Request, res: Response) => {
    try {
      const suppliers = await supplierRepo.findAll();
      res.json(suppliers);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      recordServerDiagnosticEvent({
        severity: "error",
        source: "database",
        title: "Supplier list failed",
        message: error instanceof Error ? error.message : String(error),
        route: "/api/suppliers",
        method: "GET",
        details: error,
      });
      return sendError(res, 500, "SUPPLIERS_FETCH_FAILED", "Failed to fetch suppliers");
    }
  });

  app.get(["/api/suppliers/performance", "/api/v2/suppliers/performance"], ...supplierRead, async (req: Request, res: Response) => {
    try {
      const requestedIds = req.path.startsWith("/api/v2/")
        ? String(req.query.ids ?? "").split(",").filter(Boolean).map(Number)
        : [];
      if (req.path.startsWith("/api/v2/") && (requestedIds.length === 0 || requestedIds.length > 100 || requestedIds.some((id) => !Number.isInteger(id) || id <= 0))) {
        return sendError(res, 400, "INVALID_SUPPLIER_IDS", "ids must contain between 1 and 100 comma-separated supplier IDs");
      }
      const allSuppliers = await supplierRepo.findAll();
      const supplierList = requestedIds.length ? allSuppliers.filter((supplier) => requestedIds.includes(supplier.id)) : allSuppliers;
      const purchaseOrders = await storage.getAllPurchaseOrders();
      const stockMovements = await storage.getAllStockMovements();
      const invoices = await storage.getAllInvoices();

      const performance = supplierList.map((supplier) => {
        const supplierOrders = purchaseOrders.filter((po) => po.supplierId === supplier.id);
        const supplierInvoices = invoices.filter((invoice) => Number((invoice as any).supplierId ?? 0) === supplier.id);

        let onTimeCount = 0;
        let measuredOrders = 0;
        for (const order of supplierOrders) {
          if (!order.expectedDeliveryDate) continue;
          const receipts = stockMovements
            .filter(
              (movement) =>
                movement.referenceType === "purchase_order" &&
                Number(movement.referenceId ?? 0) === order.id &&
                movement.type === "RECEIPT",
            )
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          if (receipts.length === 0) continue;
          measuredOrders += 1;
          const eta = new Date(order.expectedDeliveryDate);
          const firstReceipt = new Date(receipts[0].receivedAt ?? receipts[0].timestamp);
          if (!Number.isNaN(eta.getTime()) && !Number.isNaN(firstReceipt.getTime()) && firstReceipt <= eta) {
            onTimeCount += 1;
          }
        }

        const disputeCount = supplierInvoices.filter((invoice) => String(invoice.status).toUpperCase() === "DISPUTED").length;
        const invoiceMeasured = supplierInvoices.length;
        const priceComplianceRate =
          invoiceMeasured > 0 ? Number((((invoiceMeasured - disputeCount) / invoiceMeasured) * 100).toFixed(1)) : 100;
        const onTimeDeliveryRate =
          measuredOrders > 0 ? Number(((onTimeCount / measuredOrders) * 100).toFixed(1)) : 0;
        const overallRating = Number(((onTimeDeliveryRate * 0.6 + priceComplianceRate * 0.4) / 20).toFixed(1)); // /5 scale

        return {
          supplierId: supplier.id,
          supplierName: supplier.name,
          onTimeDeliveryRate,
          priceComplianceRate,
          ordersMeasured: measuredOrders,
          invoicesMeasured: invoiceMeasured,
          overallRating,
        };
      });

      return req.path.startsWith("/api/v2/") ? sendOk(res, performance) : res.json(performance);
    } catch (error) {
      console.error("Error fetching supplier performance:", error);
      res.status(500).json({ message: "Failed to fetch supplier performance" });
    }
  });

  app.get("/api/suppliers/:id/portal-users", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (!Number.isInteger(supplierId) || supplierId <= 0) return sendError(res, 400, "INVALID_SUPPLIER_ID", "A valid supplier ID is required.");
      const rows = await db
        .select({ id: supplierPortalMappings.id, userId: users.id, username: users.username, email: users.email, fullName: users.fullName, active: supplierPortalMappings.active })
        .from(supplierPortalMappings)
        .innerJoin(users, eq(users.id, supplierPortalMappings.userId))
        .where(and(eq(supplierPortalMappings.organizationId, getActiveOrganizationId()), eq(supplierPortalMappings.supplierId, supplierId)));
      return res.json(rows);
    } catch (error) {
      console.error("Error fetching supplier portal mappings:", error);
      return sendError(res, 500, "SUPPLIER_PORTAL_MAPPINGS_FAILED", "Supplier portal mappings could not be loaded.");
    }
  });

  app.post("/api/suppliers/:id/portal-users", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      const userId = Number(req.body?.userId);
      if (!Number.isInteger(supplierId) || supplierId <= 0 || !Number.isInteger(userId) || userId <= 0) {
        return sendError(res, 400, "SUPPLIER_PORTAL_MAPPING_INVALID", "Valid supplier and user IDs are required.");
      }
      const organizationId = getActiveOrganizationId();
      const [[supplier], [membership]] = await Promise.all([
        db.select({ id: supplierTable.id }).from(supplierTable).where(and(eq(supplierTable.id, supplierId), eq(supplierTable.organizationId, organizationId))).limit(1),
        db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId), eq(organizationMembers.active, true))).limit(1),
      ]);
      if (!supplier || !membership) return sendError(res, 404, "SUPPLIER_PORTAL_MAPPING_TARGET_NOT_FOUND", "Supplier and active user membership must belong to this organization.");
      const [mapping] = await db.insert(supplierPortalMappings).values({ organizationId, supplierId, userId, active: true, createdByUserId: req.user!.id }).onConflictDoUpdate({ target: [supplierPortalMappings.organizationId, supplierPortalMappings.userId], set: { supplierId, active: true, updatedAt: new Date(), createdByUserId: req.user!.id } }).returning();
      await appendAuditEvent({ organizationId, actor: { userId: req.user!.id }, action: "SUPPLIER_PORTAL_MAPPING_UPDATED", resourceType: "supplier", resourceId: supplierId, after: { mappingId: mapping.id, userId, supplierId }, reason: String(req.body?.reason ?? "Supplier portal user mapping"), requestId: String(res.locals.requestId ?? "unknown-request-id"), ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
      return res.status(201).json(mapping);
    } catch (error) {
      console.error("Error saving supplier portal mapping:", error);
      return sendError(res, 500, "SUPPLIER_PORTAL_MAPPING_FAILED", "Supplier portal mapping could not be saved.");
    }
  });

  app.get("/api/suppliers/:id", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const supplier = await supplierRepo.findById(id);

      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }

      res.json(supplier);
    } catch (error) {
      console.error("Error fetching supplier:", error);
      res.status(500).json({ message: "Failed to fetch supplier" });
    }
  });

  app.post("/api/suppliers", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      if (["bankName", "bankAccountNumber", "bankSwift"].some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field))) {
        return sendError(res, 409, "SUPPLIER_BANK_GOVERNANCE_REQUIRED", "Supplier banking details must be created through the governed supplier-bank workflow.", {
          hint: "Create the supplier first, then submit a supplier-bank Master Data change request for independent verification and approval.",
        });
      }
      const validatedData = insertSupplierSchema.parse(req.body);

      // Check if supplier with this name already exists
      const existingSupplier = await supplierRepo.findByName(validatedData.name);
      if (existingSupplier) {
        return res.status(400).json({ message: "Supplier with this name already exists" });
      }

      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const orgId = getActiveOrganizationId();
      const newSupplier = await supplierService.create({
        ...validatedData,
        status: "prospective",
        onboardingStatus: "prospective",
        approvedAt: null,
        approvedByUserId: null,
        createdByUserId: userId,
      }, userId);
      await appendAuditEvent({ organizationId: orgId, actor: { userId }, action: "SUPPLIER_ONBOARDING_STARTED", resourceType: "supplier", resourceId: newSupplier.id, after: newSupplier, requestId: String(res.locals.requestId ?? "unknown-request-id"), ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
      void recordSupplierConsistencyDiagnostics(orgId, newSupplier.id);
      res.status(201).json(newSupplier);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating supplier:", error);
        res.status(500).json({ message: "Failed to create supplier" });
      }
    }
  });

  const handleUpdateSupplier = async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      const validatedData = insertSupplierSchema.partial().parse(req.body);
      if (["bankName", "bankAccountNumber", "bankSwift"].some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field))) {
        return sendError(res, 409, "SUPPLIER_BANK_GOVERNANCE_REQUIRED", "Supplier banking details must be changed through the governed supplier-bank workflow.", {
          hint: "Create a supplier-bank Master Data change request for independent verification and approval.",
        });
      }
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const orgId = getActiveOrganizationId();
      const existingSupplier = await supplierRepo.findById(id);
      if (!existingSupplier) return sendError(res, 404, "SUPPLIER_NOT_FOUND", "Supplier not found.");
      const requestedOnboardingStatus = String((validatedData as { onboardingStatus?: unknown }).onboardingStatus ?? "").toLowerCase();
      if (requestedOnboardingStatus === "approved" || (String(existingSupplier.onboardingStatus).toLowerCase() !== "approved" && String((validatedData as { status?: unknown }).status ?? "").toLowerCase() === "active")) {
        return sendError(res, 409, "SUPPLIER_APPROVAL_WORKFLOW_REQUIRED", "Prospective suppliers must be approved through the controlled onboarding action.", { hint: `Use POST /api/suppliers/${id}/approve with an independent approver and reason.` });
      }
      const status = String((validatedData as { status?: unknown }).status ?? "").toLowerCase();
      if (["inactive", "blocked", "suspended", "archived"].includes(status)) {
        const dependencies = await getSupplierWhereUsed(orgId, id);
        if (dependencies.length > 0) {
          await storage.createActivityLog({
            action: "Supplier Disable Blocked",
            description: dependencyBlockedMessage("supplier", "disable", dependencies),
            referenceType: "supplier",
            referenceId: id,
            userId: userId ?? undefined,
          }).catch(() => {});
          return res.status(409).json({
            code: "MASTER_DATA_RECORD_IN_USE",
            message: dependencyBlockedMessage("supplier", "disable", dependencies),
            hint: "Close or reassign open requisitions, POs, contracts, and AP records before disabling this supplier.",
            details: { action: "disable", dependencies },
          });
        }
      }
      const updatedSupplier = await supplierService.update(id, validatedData, userId);
      if (!updatedSupplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      void recordSupplierConsistencyDiagnostics(orgId, updatedSupplier.id);
      res.json(updatedSupplier);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating supplier:", error);
        res.status(500).json({ message: "Failed to update supplier" });
      }
    }
  };

  app.put("/api/suppliers/:id", ...supplierWrite, handleUpdateSupplier);
  app.patch("/api/suppliers/:id", ...supplierWrite, handleUpdateSupplier);

  app.post("/api/suppliers/:id/approve", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const approverId = Number(req.user?.id);
      const reason = String(req.body?.reason ?? "").trim();
      if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_SUPPLIER_ID", "A valid supplier ID is required.");
      if (reason.length < 5) return sendError(res, 400, "SUPPLIER_APPROVAL_REASON_REQUIRED", "An approval reason of at least 5 characters is required.");
      const organizationId = getActiveOrganizationId();
      const [supplier] = await db.select().from(supplierTable).where(and(eq(supplierTable.id, id), eq(supplierTable.organizationId, organizationId))).limit(1);
      if (!supplier) return sendError(res, 404, "SUPPLIER_NOT_FOUND", "Supplier not found.");
      if (supplier.createdByUserId === approverId) return sendError(res, 403, "SEGREGATION_OF_DUTIES_VIOLATION", "The supplier onboarding maker cannot approve their own supplier.", { hint: "Ask another authorized manager or administrator to complete approval." });
      if (!supplier.defaultCurrencyCode || !supplier.paymentTermsId || !supplier.taxCodeId) {
        return sendError(res, 409, "SUPPLIER_ONBOARDING_INCOMPLETE", "Supplier currency, payment terms, and tax code are required before approval.", { details: { missing: [!supplier.defaultCurrencyCode && "defaultCurrencyCode", !supplier.paymentTermsId && "paymentTermsId", !supplier.taxCodeId && "taxCodeId"].filter(Boolean) } });
      }
      if (supplier.isOnceOff && (!supplier.onceOffExpiresAt || supplier.onceOffExpiresAt.getTime() <= Date.now())) {
        return sendError(res, 409, "ONCE_OFF_SUPPLIER_EXPIRY_REQUIRED", "Once-off suppliers require a future expiration date before approval.");
      }
      const [organization] = await db.select({ countryCode: organizations.countryCode }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      const pack = getCountryPack(organization?.countryCode);
      const documents = await db.select().from(mdmSupplierDocuments).where(and(eq(mdmSupplierDocuments.organizationId, organizationId), eq(mdmSupplierDocuments.supplierId, id)));
      const validDocumentTypes = new Set(documents.filter((document) => String(document.status).toLowerCase() === "approved" && (!document.expiryDate || document.expiryDate.getTime() > Date.now())).map((document) => document.documentType));
      const missingDocuments = pack.supplierCompliance.filter((documentType) => !validDocumentTypes.has(documentType));
      if (missingDocuments.length > 0) return sendError(res, 409, "SUPPLIER_COMPLIANCE_INCOMPLETE", `Supplier is missing ${pack.name} compliance evidence.`, { hint: "Upload and approve the required compliance documents in Master Data.", details: { missingDocuments } });
      const [approved] = await db.update(supplierTable).set({ status: "active", onboardingStatus: "approved", approvedAt: new Date(), approvedByUserId: approverId, complianceStatus: "compliant", updatedAt: new Date() }).where(and(eq(supplierTable.id, id), eq(supplierTable.organizationId, organizationId))).returning();
      await appendAuditEvent({ organizationId, actor: { userId: approverId }, action: "SUPPLIER_ONBOARDING_APPROVED", resourceType: "supplier", resourceId: id, before: supplier, after: approved, reason, requestId: String(res.locals.requestId ?? "unknown-request-id"), ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
      return res.json(approved);
    } catch (error) {
      console.error("Error approving supplier onboarding:", error);
      return sendError(res, 500, "SUPPLIER_APPROVAL_FAILED", "Supplier approval could not be completed.");
    }
  });

  app.delete("/api/suppliers/:id", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const orgId = getActiveOrganizationId();
      const dependencies = await getSupplierWhereUsed(orgId, id);
      if (dependencies.length > 0) {
        await storage.createActivityLog({
          action: "Supplier Delete Blocked",
          description: dependencyBlockedMessage("supplier", "delete", dependencies),
          referenceType: "supplier",
          referenceId: id,
          userId: userId ?? undefined,
        }).catch(() => {});
        return res.status(409).json({
          code: "MASTER_DATA_RECORD_IN_USE",
          message: dependencyBlockedMessage("supplier", "delete", dependencies),
          hint: "Close or reassign dependent procurement and AP records before deleting this supplier.",
          details: { action: "delete", dependencies },
        });
      }
      const success = await supplierService.delete(id, userId);

      if (!success) {
        return res.status(404).json({ message: "Supplier not found" });
      }

      res.status(204).send();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "23503") {
        return res.status(400).json({
          message:
            "This supplier cannot be deleted while it is linked to purchase orders, requisitions, or other records.",
        });
      }
      console.error("Error deleting supplier:", error);
      res.status(500).json({ message: "Failed to delete supplier" });
    }
  });

  // Supplier portal APIs
  app.get("/api/supplier/orders", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!user) return sendFunctionError(res, 401, "getSupplierPortalOrders", "Unauthorized");
      if (!["supplier", "admin", "manager"].includes(String(user.role ?? ""))) {
        return sendFunctionError(res, 403, "getSupplierPortalOrders", "Forbidden");
      }
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "getSupplierPortalOrders", "Supplier mapping not found for user");
      const orders = await storage.getAllPurchaseOrders();
      res.json(orders.filter((order) => order.supplierId === supplierId));
    } catch (error) {
      console.error("Error fetching supplier orders:", error);
      return sendFunctionError(res, 500, "getSupplierPortalOrders", "Failed to fetch supplier orders", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/supplier/orders/:id/confirm", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "confirmSupplierPortalOrder", "Forbidden");
      }
      const id = Number(req.params.id);
      if (isNaN(id)) return sendFunctionError(res, 400, "confirmSupplierPortalOrder", "Invalid order ID");
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "confirmSupplierPortalOrder", "Supplier mapping not found for user");
      const order = await storage.getPurchaseOrder(id);
      if (!order || order.supplierId !== supplierId) return sendFunctionError(res, 404, "confirmSupplierPortalOrder", "Order not found");
      const updated = await storage.updatePurchaseOrderStatus(id, PurchaseOrderStatus.ACKNOWLEDGED);
      if (!updated) return sendFunctionError(res, 404, "confirmSupplierPortalOrder", "Unable to update order status");
      await storage.createActivityLog({
        action: "Supplier PO Confirmed",
        description: `Supplier acknowledged PO ${order.orderNumber}`,
        referenceType: "purchase_order",
        referenceId: id,
        userId: (req as Request & { user?: { id: number } }).user?.id ?? null,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error confirming supplier order:", error);
      return sendFunctionError(res, 500, "confirmSupplierPortalOrder", "Failed to confirm order", error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/supplier/orders/:id/delivery", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "updateSupplierPortalDelivery", "Forbidden");
      }
      const id = Number(req.params.id);
      if (isNaN(id)) return sendFunctionError(res, 400, "updateSupplierPortalDelivery", "Invalid order ID");
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "updateSupplierPortalDelivery", "Supplier mapping not found for user");
      const order = await storage.getPurchaseOrder(id);
      if (!order || order.supplierId !== supplierId) return sendFunctionError(res, 404, "updateSupplierPortalDelivery", "Order not found");
      const expectedDeliveryDate = req.body?.expectedDeliveryDate ? new Date(req.body.expectedDeliveryDate) : null;
      if (!expectedDeliveryDate || Number.isNaN(expectedDeliveryDate.getTime())) {
        return sendFunctionError(res, 400, "updateSupplierPortalDelivery", "Valid expectedDeliveryDate is required");
      }
      const updated = await storage.updatePurchaseOrder(id, { expectedDeliveryDate });
      if (!updated) return sendFunctionError(res, 404, "updateSupplierPortalDelivery", "Unable to update purchase order delivery date");
      await storage.createActivityLog({
        action: "Supplier Delivery Updated",
        description: `Supplier updated delivery for PO ${order.orderNumber}`,
        referenceType: "purchase_order",
        referenceId: id,
        userId: (req as Request & { user?: { id: number } }).user?.id ?? null,
      });
      await emitNotificationToRoles(["manager", "admin"], {
        type: "shipment_delay",
        title: `Supplier updated ETA for PO ${order.orderNumber}`,
        body: `Expected delivery changed to ${expectedDeliveryDate.toISOString().slice(0, 10)}.`,
        entityType: "purchase_order",
        entityId: id,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating supplier delivery:", error);
      return sendFunctionError(res, 500, "updateSupplierPortalDelivery", "Failed to update delivery", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/supplier/invoices", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "createSupplierPortalInvoice", "Forbidden");
      }
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "createSupplierPortalInvoice", "Supplier mapping not found for user");
      const payload = req.body as any;
      const poId = Number(payload?.purchaseOrderId);
      if (!Number.isFinite(poId)) return sendFunctionError(res, 400, "createSupplierPortalInvoice", "purchaseOrderId is required");
      const order = await storage.getPurchaseOrder(poId);
      if (!order || order.supplierId !== supplierId) return sendFunctionError(res, 404, "createSupplierPortalInvoice", "Purchase order not found");
      const now = new Date();
      const due = payload?.dueDate ? new Date(payload.dueDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const total = Number(payload?.total ?? order.totalAmount ?? 0);
      if (!Number.isFinite(total) || total <= 0) {
        return sendFunctionError(res, 400, "createSupplierPortalInvoice", "Invoice total must be a positive number");
      }
      const orgCurrency = await getReportingCurrencyCode(storage);
      const invoice = await createInvoiceRecord({
        invoiceNumber: payload?.invoiceNumber || `INV-SUP-${Date.now().toString().slice(-8)}`,
        issueDate: payload?.issueDate ? new Date(payload.issueDate) : now,
        dueDate: due,
        customerId: null,
        supplierId,
        purchaseOrderId: poId,
        subtotal: Number(payload?.subtotal ?? total),
        tax: Number(payload?.tax ?? 0),
        discount: Number(payload?.discount ?? 0),
        total,
        paidAmount: 0,
        dueAmount: total,
        currencyCode: payload?.currencyCode ?? payload?.currency ?? orgCurrency,
        status: "DRAFT",
        notes: payload?.notes ?? null,
        items: Array.isArray(payload?.items) ? payload.items : [],
      }, Number((req as Request & { user?: { id?: number } }).user?.id ?? 1));
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error creating supplier invoice:", error);
      if (error instanceof Error && /duplicate supplier invoice number/i.test(error.message)) {
        return res.status(409).json({
          ok: false,
          error: {
            code: "SUPPLIER_INVOICE_DUPLICATE",
            message: "This invoice number has already been submitted for this supplier.",
          },
          message: "This invoice number has already been submitted for this supplier.",
        });
      }
      return sendFunctionError(res, 500, "createSupplierPortalInvoice", "Failed to create supplier invoice", error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/api/supplier/invoices", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { role?: string } }).user;
      if (!["supplier", "admin", "manager"].includes(String(user?.role ?? ""))) {
        return sendFunctionError(res, 403, "getSupplierPortalInvoices", "Forbidden");
      }
      const supplierId = await resolveSupplierIdForUser(req);
      if (!supplierId) return sendFunctionError(res, 400, "getSupplierPortalInvoices", "Supplier mapping not found for user");
      const invoices = await storage.getAllInvoices();
      res.json(invoices.filter((invoice) => Number(invoice.supplierId) === supplierId));
    } catch (error) {
      console.error("Error fetching supplier invoices:", error);
      return sendFunctionError(res, 500, "getSupplierPortalInvoices", "Failed to fetch supplier invoices", error instanceof Error ? error.message : String(error));
    }
  });

  // Supplier Logo endpoints (same RBAC as suppliers)
  app.get("/api/suppliers/:id/logo", ...supplierRead, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const logo = await storage.getSupplierLogo(supplierId);
      if (!logo) {
        return res.status(404).json({ message: "Supplier logo not found" });
      }

      res.json(logo);
    } catch (error) {
      console.error("Error fetching supplier logo:", error);
      res.status(500).json({ message: "Failed to fetch supplier logo" });
    }
  });

  app.post("/api/suppliers/:id/logo", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      // Check if the supplier exists
      const supplier = await storage.getSupplier(supplierId);
      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }

      const validatedData = insertSupplierLogoSchema.parse({
        ...req.body,
        supplierId,
      });

      const logo = await storage.createSupplierLogo(validatedData);
      res.status(201).json(logo);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating supplier logo:", error);
        res.status(500).json({ message: "Failed to create supplier logo" });
      }
    }
  });

  app.put("/api/suppliers/:id/logo", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      if (!req.body.logoUrl) {
        return res.status(400).json({ message: "Logo URL is required" });
      }

      const updatedLogo = await storage.updateSupplierLogo(supplierId, req.body.logoUrl);
      if (!updatedLogo) {
        return res.status(404).json({ message: "Supplier logo not found" });
      }

      res.json(updatedLogo);
    } catch (error) {
      console.error("Error updating supplier logo:", error);
      res.status(500).json({ message: "Failed to update supplier logo" });
    }
  });

  app.delete("/api/suppliers/:id/logo", ...supplierWrite, async (req: Request, res: Response) => {
    try {
      const supplierId = Number(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const success = await storage.deleteSupplierLogo(supplierId);
      if (!success) {
        return res.status(404).json({ message: "Supplier logo not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting supplier logo:", error);
      res.status(500).json({ message: "Failed to delete supplier logo" });
    }
  });
}
