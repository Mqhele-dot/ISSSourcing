import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { sendError, sendFunctionError, sendOk } from "../../api-response";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";
import { getActiveOrganizationId, getOptionalTenantContext, getTenantContext } from "../../organization-context";
import {documentAccess,DocumentAccessError} from "../documents/document-access";
import { createSupplierRepository } from "../../repositories";
import { createSupplierService } from "../../services/supplier-service";
import { insertSupplierLogoSchema, PurchaseOrderStatus } from "@shared/schema";
import { detectSupplierDocumentMismatches } from "../procurement/supplier-defaults";
import type { AuthBundle } from "../procurement/types";
import { getReportingCurrencyCode } from "../../lib/org-reporting-money";
import { createInvoiceRecord } from "../accounts-payable/service";
import {
  dependencyBlockedMessage,
  getSupplierWhereUsed,
} from "../master-data/dependency-checks";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../db";
import { organizationMembers, organizations, supplierPortalMappings, suppliers as supplierTable, users } from "@shared/schema";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { registerSupplierDeliveryScorecardRoutes } from "./register-delivery-scorecard-routes";
import { registerSupplierPerformanceRoutes } from "./register-performance-routes";
import { publicSupplierProfile } from "../../../shared/supplier-public-profile";
import { hasSupplierBankingFields, hasSupplierDecisionFields, supplierProfileCommandSchema, supplierProfilePatchSchema } from "./supplier-profile-command";
import { approveSupplierOnboarding, startSupplierOnboarding, SupplierOnboardingError, updateSupplierProfile } from "./supplier-onboarding";
import { readPublishedSupplierCompliance } from "../master-data/governed-supplier-compliance";

const supplierRepo = createSupplierRepository(storage);
const supplierService = createSupplierService(supplierRepo, storage);

const SUPPLIER_TYPES = new Set(["goods", "service", "carrier", "logistics_provider", "contractor", "fuel"]);

function supplierCommandActor(req: Request) {
  const { organizationId, userId, correlationId } = getTenantContext();
  return { organizationId, userId, requestId: correlationId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? null };
}

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
  registerSupplierDeliveryScorecardRoutes(app, auth);
  registerSupplierPerformanceRoutes(app, auth);
  // Supplier endpoints - RBAC: viewer read-only; manager/admin can create/update/delete
  const supplierRead = [auth.ensureAuthenticated];
  const supplierWrite = [
    auth.ensureAuthenticated,
    auth.ensureTwoFactorAuthenticated,
    auth.ensureRole(["manager", "admin"]),
  ];

  app.get("/api/v2/suppliers/:id/compliance-evidence", ...supplierRead, auth.ensurePermission("suppliers", "read"), auth.ensurePermission("documents", "read"), async (req, res) => {
    const supplierId = Number(req.params.id);
    if (!Number.isSafeInteger(supplierId) || supplierId < 1 || supplierId > 2147483647) return sendError(res, 400, "INVALID_SUPPLIER_ID", "Choose a valid supplier.");
    let client;
    try {
      const actor = getTenantContext();
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const access = await documentAccess(client, actor);
      if (!access.types.includes("supplier")) throw new DocumentAccessError(403, "SUPPLIER_COMPLIANCE_ACCESS_DENIED", "Current supplier and document access are required.");
      const { rows: [supplier] } = await client.query("SELECT o.country_code FROM suppliers s JOIN organizations o ON o.id=s.organization_id WHERE s.organization_id=$1 AND s.id=$2", [actor.organizationId, supplierId]);
      if (!supplier) { await client.query("ROLLBACK"); return sendError(res, 404, "SUPPLIER_NOT_FOUND", "Supplier not found."); }
      const { getCountryPack } = await import("../master-data/country-pack-registry");
      const rows = await readPublishedSupplierCompliance(client, actor.organizationId, supplierId, new Date());
      await client.query("COMMIT");
      res.setHeader("Cache-Control", "private, no-store");
      return sendOk(res, { requiredTypes: getCountryPack(supplier.country_code).supplierCompliance,
        items: rows.map(({ sha256: _hash, sourceMatches: _sourceMatches, ...item }) => item) });
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (error instanceof DocumentAccessError) return sendError(res, error.status, error.code, error.message);
      return sendError(res, 503, "SUPPLIER_COMPLIANCE_UNAVAILABLE", "Published compliance evidence is unavailable. Retry or ask an administrator to check migration prerequisites.");
    } finally { client?.release(); }
  });

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

  app.get("/api/suppliers", ...supplierRead, auth.ensurePermission("suppliers", "read"), async (_req: Request, res: Response) => {
    try {
      const suppliers = await supplierRepo.findAll();
      res.json(suppliers.map(publicSupplierProfile));
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

  app.get("/api/suppliers/:id/portal-users", ...supplierRead, auth.ensurePermission("suppliers","read"),auth.ensurePermission("users","read"), async (req: Request, res: Response) => {
    let client;
    try {
      const supplierId = Number(req.params.id);
      const page=Number(req.query.page??1),pageSize=Number(req.query.pageSize??25),org=getActiveOrganizationId();
      if (!Number.isSafeInteger(supplierId)||supplierId<1||supplierId>2147483647||!Number.isSafeInteger(page)||page<1||page>100000||![25,50,100].includes(pageSize)||Object.keys(req.query).some(key=>!["page","pageSize"].includes(key))) return sendError(res,400,"INVALID_SUPPLIER_QUERY","Choose a valid supplier and 25, 50 or 100 rows.");
      client=await pool.connect();const access=await documentAccess(client,getTenantContext(),false);
      if(!await access.can("suppliers")||!await access.can("users"))throw new DocumentAccessError(403,"SUPPLIER_PORTAL_USERS_DENIED","Supplier and user read access is required to review portal identities.");
      const owned=await client.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=$2",[org,supplierId]);
      if(!owned.rowCount)return sendError(res,404,"SUPPLIER_NOT_FOUND","Supplier not available in your organization.");
      const rows=await client.query(`SELECT m.id,u.id AS "userId",u.username,u.email,u.full_name AS "fullName",m.active FROM supplier_portal_mappings m
        JOIN users u ON u.id=m.user_id AND u.active=true JOIN organization_members member ON member.user_id=u.id AND member.organization_id=m.organization_id
        AND member.active=true AND member.status='active' WHERE m.organization_id=$1 AND m.supplier_id=$2 AND m.active=true ORDER BY m.id LIMIT $3 OFFSET $4`,[org,supplierId,pageSize+1,(page-1)*pageSize]);
      res.setHeader("X-Page",String(page));res.setHeader("X-Page-Size",String(pageSize));res.setHeader("X-Has-Next",String(rows.rows.length>pageSize));res.setHeader("Cache-Control","private, no-store");
      if(rows.rows.length>pageSize)res.setHeader("Link",`</api/suppliers/${supplierId}/portal-users?page=${page+1}&pageSize=${pageSize}>; rel="next"`);
      return res.json(rows.rows.slice(0,pageSize));
    } catch (error) {
      if(error instanceof DocumentAccessError)return sendError(res,error.status,error.code,error.message);
      console.error("Error fetching supplier portal mappings:", error);
      return sendError(res, 500, "SUPPLIER_PORTAL_MAPPINGS_FAILED", "Supplier portal mappings could not be loaded.");
    }finally{client?.release();}
  });

  app.post("/api/suppliers/:id/portal-users", ...supplierWrite,auth.ensurePermission("suppliers","update"),auth.ensurePermission("users","update"), async (req: Request, res: Response) => {
    let client;
    try {
      const supplierId = Number(req.params.id);
      const userId = Number(req.body?.userId);
      if (!Number.isInteger(supplierId) || supplierId <= 0 || !Number.isInteger(userId) || userId <= 0) {
        return sendError(res, 400, "SUPPLIER_PORTAL_MAPPING_INVALID", "Valid supplier and user IDs are required.");
      }
      const organizationId = getActiveOrganizationId();
      client=await pool.connect();await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
      const access=await documentAccess(client,getTenantContext(),false,true);
      if(!await access.can("suppliers","update")||!await access.can("users","update"))throw new DocumentAccessError(403,"SUPPLIER_PORTAL_MAPPING_DENIED","Supplier and user update permission is required.");
      const supplier=await client.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=$2 FOR SHARE",[organizationId,supplierId]);
      const membership=await client.query("SELECT m.id FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active=true WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active=true AND m.status='active' FOR SHARE OF m,u",[organizationId,userId]);
      if(!supplier.rowCount||!membership.rowCount)throw new DocumentAccessError(404,"SUPPLIER_PORTAL_MAPPING_TARGET_NOT_FOUND","Supplier and active user must belong to your organization.");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`supplier-portal:${organizationId}:${userId}`]);
      const previous=await client.query("SELECT id,supplier_id,active FROM supplier_portal_mappings WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",[organizationId,userId]);
      if(previous.rows[0]?.supplier_id===supplierId&&previous.rows[0]?.active){await client.query("COMMIT");return res.json({id:previous.rows[0].id,supplierId,userId,active:true,replayed:true});}
      const inserted=await client.query(`INSERT INTO supplier_portal_mappings(organization_id,supplier_id,user_id,active,created_by_user_id) VALUES($1,$2,$3,true,$4)
        ON CONFLICT(organization_id,user_id) DO UPDATE SET supplier_id=$2,active=true,updated_at=clock_timestamp(),created_by_user_id=$4 RETURNING id`,[organizationId,supplierId,userId,req.user!.id]);
      await appendAuditEventWithClient(client,{organizationId,actor:{userId:req.user!.id},action:"SUPPLIER_PORTAL_MAPPING_UPDATED",resourceType:"supplier",resourceId:supplierId,
        after:{mappingId:inserted.rows[0].id,userId,supplierId},reason:String(req.body?.reason??"Supplier portal user mapping"),requestId:String(res.locals.requestId??"unknown-request-id")});
      await client.query("COMMIT");return res.status(201).json({id:inserted.rows[0].id,supplierId,userId,active:true});
    } catch (error) {
      await client?.query("ROLLBACK").catch(()=>undefined);
      if(error instanceof DocumentAccessError)return sendError(res,error.status,error.code,error.message);
      console.error("Error saving supplier portal mapping:", error);
      return sendError(res, 500, "SUPPLIER_PORTAL_MAPPING_FAILED", "Supplier portal mapping could not be saved.");
    }finally{client?.release();}
  });

  app.get("/api/v2/suppliers/:id/communications", auth.ensureAuthenticated, auth.ensurePermission("suppliers", "read"), async (req: Request, res: Response) => {
    const supplierId = Number(req.params.id);
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 25);
    if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || !Number.isSafeInteger(page) || page <= 0 || ![25,50,100].includes(pageSize))
      return sendError(res, 400, "SUPPLIER_TIMELINE_QUERY_INVALID", "Choose a valid supplier and page size.");
    const org = getActiveOrganizationId();
    let client;
    try {
      client=await pool.connect();await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");await client.query("SET LOCAL statement_timeout='5s'");
      const access=await documentAccess(client,getTenantContext(),false);
      if(!await access.can("suppliers"))throw new DocumentAccessError(403,"SUPPLIER_SOURCE_DENIED","Supplier access is unavailable.");
      const canPurchases=await access.can("purchases"),canDocuments=access.types.includes("supplier");
      const owned = await client.query("SELECT 1 FROM suppliers WHERE organization_id=$1 AND id=$2", [org, supplierId]);
      if (!owned.rowCount){await client.query("ROLLBACK");return sendError(res, 404, "SUPPLIER_NOT_FOUND", "Supplier not found.");}
      const source = `WITH timeline AS (
        SELECT ('invitation:'||i.id) AS key,'rfq_invitation' AS kind,i.invited_at AS occurred_at,
          ('RFQ invitation — '||i.status) AS summary,'sourcing_event' AS entity_type,i.event_id AS entity_id,i.invited_by_user_id AS actor_user_id,NULL::int AS document_id
        FROM sourcing_invitations i WHERE i.organization_id=$1 AND i.supplier_id=$2 AND $3::boolean
        UNION ALL SELECT ('quote:'||q.id),'rfq_response',q.created_at,('Supplier quotation — '||q.status),'sourcing_event',q.event_id,q.submitted_by_user_id,NULL::int
        FROM supplier_quotes q WHERE q.organization_id=$1 AND q.supplier_id=$2 AND $3::boolean
        UNION ALL SELECT ('po:'||p.id),'purchase_order',coalesce(p.email_sent_date,p.created_at),
          ('Purchase order '||p.order_number||' created'),
          'purchase_order',p.id,p.created_by_user_id,NULL::int FROM purchase_orders p WHERE p.organization_id=$1 AND p.supplier_id=$2 AND $3::boolean
        UNION ALL SELECT ('delivery:'||e.id),'outbound_email',e.occurred_at,
          (CASE WHEN e.source_type='sourcing_event' THEN 'RFQ invitation email — ' ELSE 'Purchase order email — ' END||e.status||CASE WHEN e.error_summary IS NOT NULL THEN ': '||e.error_summary ELSE '' END),
          e.source_type,e.source_id,e.actor_user_id,NULL::int FROM supplier_communication_events e
          WHERE e.organization_id=$1 AND e.supplier_id=$2 AND e.source_type IN ('purchase_order','sourcing_event') AND $3::boolean
        UNION ALL SELECT ('confirmation:'||c.id),'po_confirmation',c.created_at,('PO confirmation — '||c.status),
          'purchase_order',c.purchase_order_id,c.actor_user_id,NULL::int FROM po_supplier_confirmations c WHERE c.organization_id=$1 AND c.supplier_id=$2 AND $3::boolean
        UNION ALL SELECT ('document:'||d.id),'document',d.uploaded_at,('Document: '||d.file_name),
          'document',d.id,d.uploaded_by,d.id FROM documents d WHERE d.organization_id=$1 AND d.entity_type='supplier' AND d.entity_id=$2 AND d.archived_at IS NULL AND $4::boolean
        UNION ALL SELECT ('note:'||n.id),'contact_note',n.occurred_at,(n.channel||': '||n.summary),
          'supplier',n.supplier_id,n.actor_user_id,CASE WHEN $4::boolean AND EXISTS(SELECT 1 FROM documents linked WHERE linked.organization_id=$1 AND linked.entity_type='supplier' AND linked.entity_id=$2 AND linked.id=n.document_id AND linked.archived_at IS NULL) THEN n.document_id ELSE NULL END FROM supplier_communication_notes n WHERE n.organization_id=$1 AND n.supplier_id=$2
      )`;
      const count = await client.query(`${source} SELECT count(*)::int AS total FROM timeline`, [org, supplierId,canPurchases,canDocuments]);
      const items = await client.query(`${source} SELECT key,kind,occurred_at AS "occurredAt",summary,entity_type AS "entityType",entity_id AS "entityId",actor_user_id AS "actorUserId",document_id AS "documentId" FROM timeline ORDER BY occurred_at DESC,key DESC LIMIT $5 OFFSET $6`, [org, supplierId,canPurchases,canDocuments,pageSize,(page-1)*pageSize]);
      const total = Number(count.rows[0]?.total ?? 0);
      await client.query("COMMIT");res.setHeader("Cache-Control","private, no-store");
      return sendOk(res, { items: items.rows, total, page, pageSize, hasNext: page*pageSize<total,scope:{documents:canDocuments,procurement:canPurchases},scopeNotice:"Only authorized source records are included. Restricted sources and archived attachments are not counted." });
    } catch (error) {
      await client?.query("ROLLBACK").catch(()=>undefined);
      if(error instanceof DocumentAccessError)return sendError(res,error.status,error.code,error.message);
      console.error("Supplier communication timeline failed:", error);
      return sendError(res, 500, "SUPPLIER_TIMELINE_FAILED", "Could not load this supplier's activity. Retry after checking setup.");
    } finally{client?.release();}
  });

  app.post("/api/v2/suppliers/:id/communications/notes", auth.ensureAuthenticated, auth.ensurePermission("suppliers", "update"), async (req: Request, res: Response) => {
    const org = getActiveOrganizationId();
    const supplierId = Number(req.params.id);
    const channel = String(req.body?.channel ?? "").toLowerCase();
    const summary = String(req.body?.summary ?? "").trim();
    const documentId = req.body?.documentId == null || req.body.documentId === "" ? null : Number(req.body.documentId);
    if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || !["phone","email","meeting","other"].includes(channel) || summary.length < 3 || summary.length > 2000)
      return sendError(res, 400, "SUPPLIER_CONTACT_INVALID", "Choose a channel and enter a short contact summary.");
    if (documentId !== null && (!Number.isSafeInteger(documentId) || documentId <= 0))
      return sendError(res, 400, "SUPPLIER_DOCUMENT_INVALID", "Choose a valid supplier document.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const access=await documentAccess(client,getTenantContext(),false,true);
      if(!await access.can("suppliers","update")){await client.query("ROLLBACK");return sendError(res,403,"SUPPLIER_UPDATE_DENIED","You need supplier update access to record a contact.");}
      const supplier = await client.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=$2", [org, supplierId]);
      if (!supplier.rowCount) { await client.query("ROLLBACK"); return sendError(res, 404, "SUPPLIER_NOT_FOUND", "Supplier not found."); }
      if (documentId !== null) {
        if(!access.types.includes("supplier")){await client.query("ROLLBACK");return sendError(res,403,"SUPPLIER_DOCUMENT_DENIED","You need document and supplier read access to link this attachment.");}
        const document = await client.query("SELECT id FROM documents WHERE organization_id=$1 AND entity_type='supplier' AND entity_id=$2 AND id=$3 AND archived_at IS NULL", [org, supplierId, documentId]);
        if (!document.rowCount) { await client.query("ROLLBACK"); return sendError(res, 400, "SUPPLIER_DOCUMENT_INVALID", "This document is unavailable for this supplier."); }
      }
      const inserted = await client.query(`INSERT INTO supplier_communication_notes(organization_id,supplier_id,actor_user_id,channel,summary,document_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,occurred_at`, [org, supplierId, Number(req.user?.id), channel, summary, documentId]);
      await appendAuditEventWithClient(client, { organizationId: org, actor: { userId: Number(req.user?.id) }, action: "SUPPLIER_CONTACT_LOGGED", resourceType: "supplier", resourceId: supplierId, details: { noteId: inserted.rows[0].id, channel, summary, documentId } });
      await client.query("COMMIT");
      return sendOk(res, { id: inserted.rows[0].id, occurredAt: inserted.rows[0].occurred_at }, 201);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if(error instanceof DocumentAccessError)return sendError(res,error.status,error.code,error.message);
      console.error("Supplier contact note failed:", error);
      return sendError(res, 500, "SUPPLIER_CONTACT_FAILED", "Could not save the contact note. Please retry.");
    } finally { client.release(); }
  });

  app.get("/api/suppliers/:id", ...supplierRead, auth.ensurePermission("suppliers", "read"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const supplier = await supplierRepo.findById(id);

      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }

      res.json(publicSupplierProfile(supplier));
    } catch (error) {
      console.error("Error fetching supplier:", error);
      res.status(500).json({ message: "Failed to fetch supplier" });
    }
  });

  const rejectSupplierDecisionFields = (req: Request, res: Response, next: import("express").NextFunction) => {
    if (hasSupplierDecisionFields(req.body)) {
      return sendError(res, 409, "SUPPLIER_DECISION_FIELDS_PROTECTED", "Supplier ownership and approval evidence are managed by the server. Use the supplier approval and compliance workflows.");
    }
    next();
  };

  app.post("/api/suppliers", ...supplierWrite, auth.ensurePermission("suppliers", "create"), rejectSupplierDecisionFields, async (req: Request, res: Response) => {
    try {
      if (hasSupplierBankingFields(req.body)) {
        return sendError(res, 409, "SUPPLIER_BANK_GOVERNANCE_REQUIRED", "Supplier banking details must be created through the governed supplier-bank workflow.", {
          hint: "Create the supplier first, then submit a supplier-bank Master Data change request for independent verification and approval.",
        });
      }
      const validatedData = supplierProfileCommandSchema.parse(req.body);
      const supplierType = String(validatedData.supplierType ?? "goods").trim().toLowerCase();
      if (!SUPPLIER_TYPES.has(supplierType)) {
        return sendError(res, 400, "INVALID_SUPPLIER_TYPE", "Supplier type must be goods, service, carrier, contractor, or fuel.");
      }

      const actor = supplierCommandActor(req);
      const newSupplier = await startSupplierOnboarding(actor, { ...validatedData, supplierType });
      await storage.createActivityLog({ action: "Supplier Created", description: `Created supplier "${newSupplier.name}" (ID ${newSupplier.id})`, referenceType: "supplier", referenceId: newSupplier.id, userId: actor.userId }).catch(() => {});
      void recordSupplierConsistencyDiagnostics(actor.organizationId, newSupplier.id);
      res.status(201).json(publicSupplierProfile(newSupplier));
    } catch (error) {
      if (error instanceof SupplierOnboardingError) return sendError(res, error.status, error.code, error.message, { details: error.details });
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
      if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      if (hasSupplierBankingFields(req.body)) {
        return sendError(res, 409, "SUPPLIER_BANK_GOVERNANCE_REQUIRED", "Supplier banking details must be changed through the governed supplier-bank workflow.", {
          hint: "Create a supplier-bank Master Data change request for independent verification and approval.",
        });
      }
      const validatedData = supplierProfilePatchSchema.parse(req.body);
      if (validatedData.supplierType != null) {
        const supplierType = String(validatedData.supplierType).trim().toLowerCase();
        if (!SUPPLIER_TYPES.has(supplierType)) {
          return sendError(res, 400, "INVALID_SUPPLIER_TYPE", "Supplier type must be goods, service, carrier, contractor, or fuel.");
        }
        validatedData.supplierType = supplierType;
      }
      const actor = supplierCommandActor(req);
      const updatedSupplier = await updateSupplierProfile(actor, id, validatedData);
      await storage.createActivityLog({ action: "Supplier Updated", description: `Updated supplier "${updatedSupplier.name}" (ID ${id})`, referenceType: "supplier", referenceId: id, userId: actor.userId }).catch(() => {});
      void recordSupplierConsistencyDiagnostics(actor.organizationId, updatedSupplier.id);
      res.json(publicSupplierProfile(updatedSupplier));
    } catch (error) {
      if (error instanceof SupplierOnboardingError) return sendError(res, error.status, error.code, error.message, { details: error.details });
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating supplier:", error);
        res.status(500).json({ message: "Failed to update supplier" });
      }
    }
  };

  app.put("/api/suppliers/:id", ...supplierWrite, auth.ensurePermission("suppliers", "update"), rejectSupplierDecisionFields, handleUpdateSupplier);
  app.patch("/api/suppliers/:id", ...supplierWrite, auth.ensurePermission("suppliers", "update"), rejectSupplierDecisionFields, handleUpdateSupplier);

  app.post("/api/suppliers/:id/approve", ...supplierWrite, auth.ensurePermission("suppliers", "update"), rejectSupplierDecisionFields, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const { organizationId, userId: approverId, correlationId } = getTenantContext();
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const expectedRevision = req.body?.expectedRevision;
      if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return sendError(res, 400, "INVALID_SUPPLIER_ID", "A valid supplier ID is required.");
      if (reason.length < 5 || reason.length > 1000) return sendError(res, 400, "SUPPLIER_APPROVAL_REASON_REQUIRED", "An approval reason of 5–1000 characters is required.");
      if (typeof expectedRevision !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expectedRevision)) return sendError(res, 400, "SUPPLIER_PROFILE_REVISION_REQUIRED", "Reload and review the supplier profile before approval.");
      const approved = await approveSupplierOnboarding({ organizationId, supplierId: id, approverId, reason, expectedRevision, requestId: correlationId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
      return res.json(publicSupplierProfile(approved));
    } catch (error) {
      if (error instanceof SupplierOnboardingError) return sendError(res, error.status, error.code, error.message, { details: error.details });
      if (error instanceof Error && "status" in error && "code" in error && typeof error.status === "number" && typeof error.code === "string") return sendError(res, error.status, error.code, error.message);
      console.error("Supplier onboarding transaction failed", { code: (error as { code?: string } | null)?.code ?? "UNKNOWN" });
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
      const scopedOrders = orders.filter((order) => order.supplierId === supplierId);
      const confirmations = scopedOrders.length
        ? await pool.query(
            `SELECT DISTINCT ON (purchase_order_id) purchase_order_id,status,reason,promised_delivery_date,created_at
             FROM po_supplier_confirmations
             WHERE organization_id=$1 AND purchase_order_id=ANY($2::int[])
             ORDER BY purchase_order_id,created_at DESC,id DESC`,
            [getActiveOrganizationId(), scopedOrders.map((order) => order.id)],
          )
        : { rows: [] };
      const byOrder = new Map(confirmations.rows.map((row) => [Number(row.purchase_order_id), row]));
      res.json(scopedOrders.map((order) => {
        const confirmation = byOrder.get(order.id);
        return { ...order, confirmationStatus: confirmation?.status ?? null, confirmationReason: confirmation?.reason ?? null, promisedDeliveryDate: confirmation?.promised_delivery_date ?? null, confirmationUpdatedAt: confirmation?.created_at ?? null };
      }));
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
      await pool.query(
        `DELETE FROM po_supplier_confirmations WHERE organization_id=$1 AND purchase_order_id=$2 AND status='AWAITING'`,
        [getActiveOrganizationId(), id],
      );
      await pool.query(
        `INSERT INTO po_supplier_confirmations
          (organization_id,purchase_order_id,supplier_id,status,source,actor_user_id)
         VALUES ($1,$2,$3,'CONFIRMED','SUPPLIER_PORTAL',$4)`,
        [getActiveOrganizationId(), id, supplierId, (req as Request & { user?: { id?: number } }).user?.id ?? null],
      );
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
