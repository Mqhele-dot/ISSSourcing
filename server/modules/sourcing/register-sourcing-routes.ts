import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId, getOptionalTenantContext } from "../../organization-context";
import { getCanonicalReportingCurrencyCode } from "../../lib/org-reporting-money";
import {
  inventoryItems,
  purchaseRequisitionItems,
  purchaseRequisitions,
  sourcingEvents,
  sourcingEventLines,
  sourcingInvitations,
  supplierQuotes,
  supplierQuoteLines,
  supplierPortalMappings,
  suppliers,
} from "@shared/schema";
import type { AuthBundle } from "../procurement/types";
import {
  addSourcingClarification,
  approveSourcingAward,
  closeSourcingEvent,
  convertAwardToPurchaseOrders,
  createSourcingEvent,
  getQuoteComparison,
  getSourcingEventDetails,
  listSourcingEvents,
  previewSourcingInvitationEmails,
  publishSourcingEvent,
  saveQuoteEvaluation,
  SourcingError,
  submitSourcingAward,
  submitSupplierQuote,
  withdrawSupplierQuote,
  type SourcingActor,
} from "./service";

const eventSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(5000).optional().nullable(),
  deadline: z.coerce.date(),
  requisitionId: z.coerce.number().int().positive().optional().nullable(),
  legalEntityId: z.coerce.number().int().positive().optional().nullable(),
  reportingCurrencyCode: z.string().trim().length(3),
  minimumResponses: z.coerce.number().int().min(1).max(100).default(1),
  competitionRequired: z.boolean().default(true),
  terms: z.string().max(10000).optional().nullable(),
  supplierIds: z.array(z.coerce.number().int().positive()).min(1),
  lines: z.array(z.object({
    itemId: z.coerce.number().int().positive().optional().nullable(),
    description: z.string().trim().min(2).max(1000),
    quantity: z.coerce.number().positive(),
    unitOfMeasureId: z.coerce.number().int().positive().optional().nullable(),
    taxCodeId: z.coerce.number().int().positive().optional().nullable(),
    costCentreId: z.coerce.number().int().positive().optional().nullable(),
    glAccountCode: z.string().trim().min(1).max(100).optional().nullable(),
    deliverySiteId: z.coerce.number().int().positive().optional().nullable(),
    requiredDate: z.coerce.date().optional().nullable(),
    targetUnitPrice: z.coerce.number().nonnegative().optional().nullable(),
    targetCurrencyCode: z.string().trim().length(3).optional().nullable(),
    requirements: z.record(z.string(), z.unknown()).optional(),
  })).min(1),
  criteria: z.array(z.object({
    name: z.string().trim().min(2).max(200),
    criterionType: z.enum(["commercial", "technical", "compliance", "delivery", "risk"]),
    weight: z.coerce.number().positive().max(100),
    knockout: z.boolean().optional(),
    guidance: z.string().max(1000).optional().nullable(),
  })).min(1),
});

const quoteSchema = z.object({
  currencyCode: z.string().trim().length(3),
  validityDate: z.coerce.date().optional().nullable(),
  paymentTerms: z.string().trim().max(500).optional().nullable(),
  deliveryDays: z.coerce.number().int().nonnegative().max(3650).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  lines: z.array(z.object({
    eventLineId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().nonnegative(),
    taxAmount: z.coerce.number().nonnegative().optional(),
    freightAmount: z.coerce.number().nonnegative().optional(),
    promisedDate: z.coerce.date().optional().nullable(),
    supplierItemCode: z.string().max(200).optional().nullable(),
    alternativeDescription: z.string().max(1000).optional().nullable(),
    compliant: z.boolean().optional(),
    exceptionReason: z.string().max(2000).optional().nullable(),
  })).min(1),
});

const buyerQuoteSchema = quoteSchema.extend({
  eventId: z.coerce.number().int().positive(),
  supplierId: z.coerce.number().int().positive(),
});

const quotationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "Page size must be 25, 50, or 100.").default(25),
  q: z.string().trim().max(120).optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "WITHDRAWN", "SUPERSEDED"]).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  eventId: z.coerce.number().int().positive().optional(),
  sort: z.enum(["newest", "oldest", "total_desc", "total_asc", "supplier_asc"]).default("newest"),
});

const evaluationSchema = z.object({
  scores: z.array(z.object({
    criterionId: z.coerce.number().int().positive(),
    score: z.coerce.number().min(0).max(100),
    comment: z.string().max(2000).optional().nullable(),
  })).min(1),
});

const awardSchema = z.object({
  justification: z.string().trim().min(10).max(5000),
  overrideReason: z.string().trim().min(5).max(2000).optional().nullable(),
  lines: z.array(z.object({
    eventLineId: z.coerce.number().int().positive(),
    quoteLineId: z.coerce.number().int().positive(),
    awardedQuantity: z.coerce.number().positive(),
  })).min(1),
});

const clarificationSchema = z.object({
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(2).max(5000),
  visibility: z.enum(["PRIVATE", "ALL_INVITED"]).default("PRIVATE"),
  parentId: z.coerce.number().int().positive().optional().nullable(),
});

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new SourcingError("INVALID_ID", "A valid positive ID is required.", 400);
  return id;
}

function idempotencyKey(req: Request): string {
  return String(req.get("Idempotency-Key") ?? "").trim();
}

function actor(req: Request, res: Response): SourcingActor {
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) throw new SourcingError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
  return {
    organizationId: getActiveOrganizationId(),
    userId,
    requestId: String(res.locals.requestId ?? "unknown-request-id"),
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  };
}

function handleSourcingError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return sendError(res, 400, "SOURCING_VALIDATION_FAILED", "Sourcing details are invalid.", {
      fieldIssues: error.flatten().fieldErrors as Record<string, string[]>,
    });
  }
  if (error instanceof SourcingError) {
    return sendError(res, error.status, error.code, error.message, { hint: error.hint, details: error.details });
  }
  const known = error as { code?: string; status?: number; message?: string };
  if (known?.code && known?.status) return sendError(res, known.status, known.code, known.message ?? "Sourcing workflow failed.");
  console.error("Sourcing route failed:", error);
  return sendError(res, 500, "SOURCING_OPERATION_FAILED", "The sourcing operation could not be completed.");
}

async function mappedSupplierId(req: Request): Promise<number> {
  const tenantRole = getOptionalTenantContext()?.userRole ?? req.user?.role;
  if (tenantRole !== "supplier") throw new SourcingError("SUPPLIER_PORTAL_REQUIRED", "This action is only available to supplier portal users.", 403);
  const userId = Number(req.user?.id);
  const organizationId = getActiveOrganizationId();
  const [mapping] = await db
    .select({ supplierId: supplierPortalMappings.supplierId })
    .from(supplierPortalMappings)
    .innerJoin(suppliers, and(eq(suppliers.id, supplierPortalMappings.supplierId), eq(suppliers.organizationId, organizationId)))
    .where(and(
      eq(supplierPortalMappings.organizationId, organizationId),
      eq(supplierPortalMappings.userId, userId),
      eq(supplierPortalMappings.active, true),
    ))
    .limit(1);
  if (!mapping?.supplierId) {
    throw new SourcingError("SUPPLIER_MAPPING_REQUIRED", "Your account is not mapped to an approved supplier in this organization.", 403, "Ask the buying organization administrator to map your supplier portal account.");
  }
  return mapping.supplierId;
}

export function registerSourcingRoutes(app: Express, auth: AuthBundle): void {
  const buyerRead = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "read")];
  const buyerCreate = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "create")];
  const buyerManage = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "manage")];
  const buyerApprove = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("purchases", "approve")];

  app.get("/api/sourcing/events", ...buyerRead, async (_req, res) => {
    try { return sendOk(res, await listSourcingEvents(getActiveOrganizationId())); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/v2/procurement/quotations", ...buyerRead, async (req, res) => {
    try {
      const query = quotationListSchema.parse(req.query);
      const organizationId = getActiveOrganizationId();
      const filters = [eq(supplierQuotes.organizationId, organizationId)];
      if (query.status) filters.push(eq(supplierQuotes.status, query.status));
      if (query.supplierId) filters.push(eq(supplierQuotes.supplierId, query.supplierId));
      if (query.eventId) filters.push(eq(supplierQuotes.eventId, query.eventId));
      if (query.q) {
        const pattern = `%${query.q}%`;
        filters.push(or(
          ilike(supplierQuotes.quoteNumber, pattern),
          ilike(suppliers.name, pattern),
          ilike(sourcingEvents.eventNumber, pattern),
          ilike(sourcingEvents.title, pattern),
        )!);
      }
      const where = and(...filters);
      const orderBy = query.sort === "oldest" ? [asc(supplierQuotes.createdAt), asc(supplierQuotes.id)]
        : query.sort === "total_desc" ? [desc(supplierQuotes.reportingTotal), desc(supplierQuotes.id)]
          : query.sort === "total_asc" ? [asc(supplierQuotes.reportingTotal), asc(supplierQuotes.id)]
            : query.sort === "supplier_asc" ? [asc(suppliers.name), asc(supplierQuotes.id)]
              : [desc(supplierQuotes.createdAt), desc(supplierQuotes.id)];
      const base = db
        .select({
          id: supplierQuotes.id,
          quoteNumber: supplierQuotes.quoteNumber,
          eventId: supplierQuotes.eventId,
          eventNumber: sourcingEvents.eventNumber,
          eventTitle: sourcingEvents.title,
          supplierId: supplierQuotes.supplierId,
          supplierName: suppliers.name,
          status: supplierQuotes.status,
          version: supplierQuotes.version,
          currencyCode: supplierQuotes.currencyCode,
          landedCostTotal: supplierQuotes.landedCostTotal,
          reportingCurrencyCode: sourcingEvents.reportingCurrencyCode,
          reportingTotal: supplierQuotes.reportingTotal,
          validityDate: supplierQuotes.validityDate,
          submittedAt: supplierQuotes.submittedAt,
          createdAt: supplierQuotes.createdAt,
        })
        .from(supplierQuotes)
        .innerJoin(suppliers, and(eq(suppliers.id, supplierQuotes.supplierId), eq(suppliers.organizationId, organizationId)))
        .innerJoin(sourcingEvents, and(eq(sourcingEvents.id, supplierQuotes.eventId), eq(sourcingEvents.organizationId, organizationId)))
        .where(where);
      const [items, aggregate] = await Promise.all([
        base.orderBy(...orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db
          .select({
            total: sql<number>`count(*)::int`,
            submitted: sql<number>`count(*) filter (where ${supplierQuotes.status} = 'SUBMITTED')::int`,
            reportingTotal: sql<number>`coalesce(sum(${supplierQuotes.reportingTotal}) filter (where ${supplierQuotes.status} = 'SUBMITTED'), 0)::float8`,
          })
          .from(supplierQuotes)
          .innerJoin(suppliers, and(eq(suppliers.id, supplierQuotes.supplierId), eq(suppliers.organizationId, organizationId)))
          .innerJoin(sourcingEvents, and(eq(sourcingEvents.id, supplierQuotes.eventId), eq(sourcingEvents.organizationId, organizationId)))
          .where(where),
      ]);
      const total = aggregate[0]?.total ?? 0;
      return sendOk(res, {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasNext: query.page * query.pageSize < total,
        summary: {
          submitted: aggregate[0]?.submitted ?? 0,
          reportingTotal: aggregate[0]?.reportingTotal ?? 0,
        },
      });
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/procurement/quotations/:id", ...buyerRead, async (req, res) => {
    try {
      const organizationId = getActiveOrganizationId();
      const quoteId = parseId(req.params.id);
      const [record] = await db
        .select({ quote: supplierQuotes, supplierName: suppliers.name, event: sourcingEvents })
        .from(supplierQuotes)
        .innerJoin(suppliers, and(eq(suppliers.id, supplierQuotes.supplierId), eq(suppliers.organizationId, organizationId)))
        .innerJoin(sourcingEvents, and(eq(sourcingEvents.id, supplierQuotes.eventId), eq(sourcingEvents.organizationId, organizationId)))
        .where(and(eq(supplierQuotes.id, quoteId), eq(supplierQuotes.organizationId, organizationId)))
        .limit(1);
      if (!record) throw new SourcingError("QUOTE_NOT_FOUND", "The quotation was not found in this organization.", 404);
      const lines = await db
        .select({ line: supplierQuoteLines, eventLine: sourcingEventLines })
        .from(supplierQuoteLines)
        .innerJoin(sourcingEventLines, and(
          eq(sourcingEventLines.id, supplierQuoteLines.eventLineId),
          eq(sourcingEventLines.organizationId, organizationId),
        ))
        .where(and(eq(supplierQuoteLines.quoteId, quoteId), eq(supplierQuoteLines.organizationId, organizationId)))
        .orderBy(asc(sourcingEventLines.lineNumber));
      return sendOk(res, { ...record, lines });
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/procurement/quotations/context/:eventId", ...buyerRead, async (req, res) => {
    try {
      const details = await getSourcingEventDetails(getActiveOrganizationId(), parseId(req.params.eventId));
      return sendOk(res, {
        event: details.event,
        lines: details.lines,
        suppliers: details.invitations.map(({ invitation, supplierName, supplierStatus, complianceStatus }) => ({
          id: invitation.supplierId,
          name: supplierName,
          invitationStatus: invitation.status,
          status: supplierStatus,
          complianceStatus,
        })),
      });
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/procurement/quotations", ...buyerCreate, async (req, res) => {
    try {
      const input = buyerQuoteSchema.parse(req.body);
      const { eventId, supplierId, ...quoteInput } = input;
      return sendOk(res, await submitSupplierQuote(
        actor(req, res),
        eventId,
        supplierId,
        quoteInput,
        idempotencyKey(req),
        "buyer_capture",
      ), 201);
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/sourcing/requisition-context/:id", ...buyerRead, async (req, res) => {
    try {
      const organizationId = getActiveOrganizationId();
      const requisitionId = parseId(req.params.id);
      const [requisition] = await db
        .select()
        .from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.organizationId, organizationId)))
        .limit(1);
      if (!requisition) throw new SourcingError("REQUISITION_NOT_FOUND", "The requisition was not found in this organization.", 404);
      if (String(requisition.status).toUpperCase() !== "APPROVED") {
        throw new SourcingError(
          "REQUISITION_NOT_APPROVED",
          "Only an approved requisition can be converted into a sourcing event.",
          409,
          "Complete the requisition approval workflow before starting an RFQ.",
        );
      }
      const [lines, linkedEvents, organization] = await Promise.all([
        db
          .select({
            id: purchaseRequisitionItems.id,
            itemId: purchaseRequisitionItems.itemId,
            itemName: inventoryItems.name,
            sku: inventoryItems.sku,
            quantity: purchaseRequisitionItems.quantity,
            unitPrice: purchaseRequisitionItems.unitPrice,
            unitOfMeasureId: purchaseRequisitionItems.unitOfMeasureId,
            taxCodeId: purchaseRequisitionItems.taxCodeId,
            costCentreId: purchaseRequisitionItems.costCentreId,
            glAccountCode: purchaseRequisitionItems.glAccountCode,
            notes: purchaseRequisitionItems.notes,
          })
          .from(purchaseRequisitionItems)
          .innerJoin(
            inventoryItems,
            and(
              eq(inventoryItems.id, purchaseRequisitionItems.itemId),
              eq(inventoryItems.organizationId, organizationId),
            ),
          )
          .where(eq(purchaseRequisitionItems.requisitionId, requisitionId)),
        db
          .select({ id: sourcingEvents.id, eventNumber: sourcingEvents.eventNumber, status: sourcingEvents.status })
          .from(sourcingEvents)
          .where(and(eq(sourcingEvents.organizationId, organizationId), eq(sourcingEvents.requisitionId, requisitionId))),
        getCanonicalReportingCurrencyCode(organizationId),
      ]);
      return sendOk(res, {
        requisition: {
          id: requisition.id,
          requisitionNumber: requisition.requisitionNumber,
          justification: requisition.justification,
          requiredDate: requisition.requiredDate,
          currencyCode: requisition.currencyCode,
          supplierId: requisition.supplierId,
          totalAmount: requisition.totalAmount,
        },
        reportingCurrencyCode: organization,
        lines,
        linkedEvents,
      });
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/events", ...buyerCreate, async (req, res) => {
    try { return sendOk(res, await createSourcingEvent(actor(req, res), eventSchema.parse(req.body)), 201); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/sourcing/events/:id", ...buyerRead, async (req, res) => {
    try { return sendOk(res, await getSourcingEventDetails(getActiveOrganizationId(), parseId(req.params.id))); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/sourcing/events/:id/email-preview", ...buyerRead, async (req, res) => {
    try {
      return sendOk(
        res,
        await previewSourcingInvitationEmails(getActiveOrganizationId(), parseId(req.params.id)),
      );
    } catch (error) {
      return handleSourcingError(res, error);
    }
  });

  app.post("/api/sourcing/events/:id/publish", ...buyerManage, async (req, res) => {
    try { return sendOk(res, await publishSourcingEvent(actor(req, res), parseId(req.params.id), idempotencyKey(req))); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/events/:id/close", ...buyerManage, async (req, res) => {
    try {
      const reason = z.object({ overrideReason: z.string().trim().min(5).max(2000).optional().nullable() }).parse(req.body).overrideReason;
      return sendOk(res, await closeSourcingEvent(actor(req, res), parseId(req.params.id), idempotencyKey(req), reason));
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/sourcing/events/:id/comparison", ...buyerRead, async (req, res) => {
    try { return sendOk(res, await getQuoteComparison(getActiveOrganizationId(), parseId(req.params.id))); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/events/:eventId/quotes/:quoteId/evaluation", ...buyerManage, async (req, res) => {
    try {
      const input = evaluationSchema.parse(req.body);
      return sendOk(res, await saveQuoteEvaluation(actor(req, res), parseId(req.params.eventId), parseId(req.params.quoteId), input.scores));
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/events/:id/awards", ...buyerManage, async (req, res) => {
    try { return sendOk(res, await submitSourcingAward(actor(req, res), parseId(req.params.id), awardSchema.parse(req.body), idempotencyKey(req)), 201); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/awards/:id/approve", ...buyerApprove, async (req, res) => {
    try {
      const reason = z.object({ reason: z.string().trim().min(5).max(2000) }).parse(req.body).reason;
      return sendOk(res, await approveSourcingAward(actor(req, res), parseId(req.params.id), reason, idempotencyKey(req)));
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/awards/:id/convert-to-po", ...buyerApprove, async (req, res) => {
    try { return sendOk(res, await convertAwardToPurchaseOrders(actor(req, res), parseId(req.params.id), idempotencyKey(req))); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/events/:id/clarifications", ...buyerManage, async (req, res) => {
    try { return sendOk(res, await addSourcingClarification(actor(req, res), parseId(req.params.id), clarificationSchema.parse(req.body)), 201); }
    catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/sourcing/supplier/events", auth.ensureAuthenticated, async (req, res) => {
    try {
      const supplierId = await mappedSupplierId(req);
      const invitations = await db
        .select({ invitation: sourcingInvitations, event: sourcingEvents })
        .from(sourcingInvitations)
        .innerJoin(sourcingEvents, and(eq(sourcingEvents.id, sourcingInvitations.eventId), eq(sourcingEvents.organizationId, getActiveOrganizationId())))
        .where(and(eq(sourcingInvitations.organizationId, getActiveOrganizationId()), eq(sourcingInvitations.supplierId, supplierId)));
      return sendOk(res, invitations);
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.get("/api/sourcing/supplier/events/:id", auth.ensureAuthenticated, async (req, res) => {
    try {
      const supplierId = await mappedSupplierId(req);
      const eventId = parseId(req.params.id);
      const [invitation] = await db.select({ id: sourcingInvitations.id, status: sourcingInvitations.status }).from(sourcingInvitations).where(and(eq(sourcingInvitations.organizationId, getActiveOrganizationId()), eq(sourcingInvitations.eventId, eventId), eq(sourcingInvitations.supplierId, supplierId))).limit(1);
      if (!invitation) throw new SourcingError("SUPPLIER_NOT_INVITED", "You are not invited to this RFQ.", 403);
      await db.update(sourcingInvitations).set({
        viewedAt: new Date(),
        status: invitation.status === "INVITED" ? "VIEWED" : invitation.status,
      }).where(and(eq(sourcingInvitations.id, invitation.id), eq(sourcingInvitations.organizationId, getActiveOrganizationId())));
      const details = await getSourcingEventDetails(getActiveOrganizationId(), eventId);
      const supplierQuotes = details.quotes.filter(({ quote }) => quote.supplierId === supplierId);
      const supplierQuoteIds = supplierQuotes.map(({ quote }) => quote.id);
      const quoteLines = supplierQuoteIds.length
        ? await db
          .select()
          .from(supplierQuoteLines)
          .where(and(
            eq(supplierQuoteLines.organizationId, getActiveOrganizationId()),
            inArray(supplierQuoteLines.quoteId, supplierQuoteIds),
          ))
        : [];
      return sendOk(res, {
        event: details.event,
        lines: details.lines.map(({ targetUnitPrice: _target, ...line }) => line),
        criteria: details.criteria,
        quotes: supplierQuotes,
        quoteLines,
        clarifications: details.clarifications.filter((entry) => entry.visibility === "ALL_INVITED" || entry.supplierId === supplierId),
      });
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/supplier/events/:id/quotes", auth.ensureAuthenticated, async (req, res) => {
    try {
      const supplierId = await mappedSupplierId(req);
      return sendOk(res, await submitSupplierQuote(actor(req, res), parseId(req.params.id), supplierId, quoteSchema.parse(req.body), idempotencyKey(req)), 201);
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/supplier/events/:eventId/quotes/:quoteId/withdraw", auth.ensureAuthenticated, async (req, res) => {
    try {
      const supplierId = await mappedSupplierId(req);
      return sendOk(res, await withdrawSupplierQuote(actor(req, res), parseId(req.params.eventId), supplierId, parseId(req.params.quoteId), idempotencyKey(req)));
    } catch (error) { return handleSourcingError(res, error); }
  });

  app.post("/api/sourcing/supplier/events/:id/clarifications", auth.ensureAuthenticated, async (req, res) => {
    try {
      const supplierId = await mappedSupplierId(req);
      const eventId = parseId(req.params.id);
      const [invitation] = await db.select({ id: sourcingInvitations.id }).from(sourcingInvitations).where(and(eq(sourcingInvitations.organizationId, getActiveOrganizationId()), eq(sourcingInvitations.eventId, eventId), eq(sourcingInvitations.supplierId, supplierId))).limit(1);
      if (!invitation) throw new SourcingError("SUPPLIER_NOT_INVITED", "You are not invited to this RFQ.", 403);
      const input = clarificationSchema.parse({ ...req.body, supplierId, visibility: "PRIVATE" });
      return sendOk(res, await addSourcingClarification(actor(req, res), eventId, input), 201);
    } catch (error) { return handleSourcingError(res, error); }
  });
}
