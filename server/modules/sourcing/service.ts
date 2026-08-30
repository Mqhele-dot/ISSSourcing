import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { appendAuditEvent } from "../../services/audit-chain-service";
import { getOrganizationDocumentBranding } from "../../services/organization-document-branding";
import { applySupplierDefaultsToPurchaseOrder, assertSupplierTransactionAllowed } from "../procurement/supplier-defaults";
import {
  inventoryItems,
  mdmExchangeRates,
  mdmLegalEntities,
  purchaseRequisitions,
  purchaseOrderItems,
  purchaseOrders,
  sourcingAwardLines,
  sourcingAwards,
  sourcingClarifications,
  sourcingEvaluationCriteria,
  sourcingEvaluations,
  sourcingEventLines,
  sourcingEvents,
  sourcingInvitations,
  supplierQuoteLines,
  supplierQuotes,
  suppliers,
  workflowIdempotency,
} from "@shared/schema";

export type SourcingActor = {
  organizationId: number;
  userId: number;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export class SourcingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly hint?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type CreateEventInput = {
  title: string;
  description?: string | null;
  deadline: Date;
  requisitionId?: number | null;
  legalEntityId?: number | null;
  reportingCurrencyCode: string;
  minimumResponses: number;
  competitionRequired: boolean;
  terms?: string | null;
  lines: Array<{
    itemId?: number | null;
    description: string;
    quantity: number;
    unitOfMeasureId?: number | null;
    taxCodeId?: number | null;
    costCentreId?: number | null;
    glAccountCode?: string | null;
    deliverySiteId?: number | null;
    requiredDate?: Date | null;
    targetUnitPrice?: number | null;
    targetCurrencyCode?: string | null;
    requirements?: Record<string, unknown>;
  }>;
  criteria: Array<{
    name: string;
    criterionType: string;
    weight: number;
    knockout?: boolean;
    guidance?: string | null;
  }>;
  supplierIds: number[];
};

type SubmitQuoteInput = {
  currencyCode: string;
  validityDate?: Date | null;
  paymentTerms?: string | null;
  deliveryDays?: number | null;
  notes?: string | null;
  lines: Array<{
    eventLineId: number;
    quantity: number;
    unitPrice: number;
    taxAmount?: number;
    freightAmount?: number;
    promisedDate?: Date | null;
    supplierItemCode?: string | null;
    alternativeDescription?: string | null;
    compliant?: boolean;
    exceptionReason?: string | null;
  }>;
};

function eventNumber(): string {
  const year = new Date().getUTCFullYear();
  return `RFQ-${year}-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

function normalizeCurrency(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new SourcingError("CURRENCY_INVALID", "Currency must be a 3-letter ISO 4217 code.", 400);
  }
  return code;
}

async function eventForOrganization(organizationId: number, eventId: number) {
  const [event] = await db
    .select()
    .from(sourcingEvents)
    .where(and(eq(sourcingEvents.id, eventId), eq(sourcingEvents.organizationId, organizationId)))
    .limit(1);
  if (!event) throw new SourcingError("SOURCING_EVENT_NOT_FOUND", "Sourcing event was not found.", 404);
  return event;
}

async function requireIdempotencyKey(organizationId: number, idempotencyKey: string, action: string) {
  const key = idempotencyKey.trim();
  if (!key) {
    throw new SourcingError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is required for this workflow action.",
      400,
      "Retry with a stable unique key for this action.",
    );
  }
  const [existing] = await db
    .select()
    .from(workflowIdempotency)
    .where(and(eq(workflowIdempotency.organizationId, organizationId), eq(workflowIdempotency.idempotencyKey, key)))
    .limit(1);
  if (existing && existing.action !== action) {
    throw new SourcingError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different action.", 409);
  }
  return existing;
}

async function audit(actor: SourcingActor, action: string, resourceType: string, resourceId: number, before: unknown, after: unknown, reason?: string | null) {
  return appendAuditEvent({
    organizationId: actor.organizationId,
    actor: { userId: actor.userId },
    action,
    resourceType,
    resourceId,
    before,
    after,
    reason,
    requestId: actor.requestId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

export async function listSourcingEvents(organizationId: number) {
  return db
    .select()
    .from(sourcingEvents)
    .where(eq(sourcingEvents.organizationId, organizationId))
    .orderBy(desc(sourcingEvents.updatedAt));
}

export async function getSourcingEventDetails(organizationId: number, eventId: number) {
  const event = await eventForOrganization(organizationId, eventId);
  const [lines, criteria, invitations, quotes, clarifications, awards] = await Promise.all([
    db.select().from(sourcingEventLines).where(and(eq(sourcingEventLines.organizationId, organizationId), eq(sourcingEventLines.eventId, eventId))).orderBy(asc(sourcingEventLines.lineNumber)),
    db.select().from(sourcingEvaluationCriteria).where(and(eq(sourcingEvaluationCriteria.organizationId, organizationId), eq(sourcingEvaluationCriteria.eventId, eventId))).orderBy(asc(sourcingEvaluationCriteria.sortOrder)),
    db
      .select({ invitation: sourcingInvitations, supplierName: suppliers.name, supplierStatus: suppliers.status, complianceStatus: suppliers.complianceStatus })
      .from(sourcingInvitations)
      .innerJoin(suppliers, and(eq(suppliers.id, sourcingInvitations.supplierId), eq(suppliers.organizationId, organizationId)))
      .where(and(eq(sourcingInvitations.organizationId, organizationId), eq(sourcingInvitations.eventId, eventId))),
    db
      .select({ quote: supplierQuotes, supplierName: suppliers.name })
      .from(supplierQuotes)
      .innerJoin(suppliers, and(eq(suppliers.id, supplierQuotes.supplierId), eq(suppliers.organizationId, organizationId)))
      .where(and(eq(supplierQuotes.organizationId, organizationId), eq(supplierQuotes.eventId, eventId)))
      .orderBy(desc(supplierQuotes.version)),
    db.select().from(sourcingClarifications).where(and(eq(sourcingClarifications.organizationId, organizationId), eq(sourcingClarifications.eventId, eventId))).orderBy(asc(sourcingClarifications.createdAt)),
    db.select().from(sourcingAwards).where(and(eq(sourcingAwards.organizationId, organizationId), eq(sourcingAwards.eventId, eventId))).orderBy(desc(sourcingAwards.version)),
  ]);
  return { event, lines, criteria, invitations, quotes, clarifications, awards };
}

export async function previewSourcingInvitationEmails(organizationId: number, eventId: number) {
  const event = await eventForOrganization(organizationId, eventId);
  const [lines, recipients, branding] = await Promise.all([
    db
      .select({ lineNumber: sourcingEventLines.lineNumber, description: sourcingEventLines.description, quantity: sourcingEventLines.quantity })
      .from(sourcingEventLines)
      .where(and(eq(sourcingEventLines.organizationId, organizationId), eq(sourcingEventLines.eventId, eventId)))
      .orderBy(asc(sourcingEventLines.lineNumber)),
    db
      .select({
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        contactName: suppliers.contactName,
        email: suppliers.email,
      })
      .from(sourcingInvitations)
      .innerJoin(
        suppliers,
        and(eq(suppliers.id, sourcingInvitations.supplierId), eq(suppliers.organizationId, organizationId)),
      )
      .where(
        and(
          eq(sourcingInvitations.organizationId, organizationId),
          eq(sourcingInvitations.eventId, eventId),
        ),
      ),
    getOrganizationDocumentBranding(organizationId),
  ]);
  if (recipients.length === 0) {
    throw new SourcingError("RFQ_SUPPLIERS_REQUIRED", "Invite at least one supplier before previewing RFQ emails.", 409);
  }

  const companyName = branding.displayName;
  const portalPath = `/procurement/supplier-portal?event=${event.id}`;
  const lineText = lines.map((line) => `- ${line.lineNumber}. ${line.description} — quantity ${line.quantity}`).join("\n");
  const lineHtml = lines
    .map((line) => `<li><strong>${line.lineNumber}. ${escapeEmailHtml(line.description)}</strong> — quantity ${line.quantity}</li>`)
    .join("");
  return {
    event: {
      id: event.id,
      eventNumber: event.eventNumber,
      title: event.title,
      status: event.status,
      deadline: event.deadline,
      reportingCurrencyCode: event.reportingCurrencyCode,
    },
    portalPath,
    previews: recipients.map((recipient) => {
      const greetingName = recipient.contactName?.trim() || recipient.supplierName;
      const subject = `${event.eventNumber}: Request for quotation — ${event.title}`;
      const text = [
        `Hello ${greetingName},`,
        "",
        `${companyName} invites ${recipient.supplierName} to respond to ${event.eventNumber}: ${event.title}.`,
        `Submission deadline: ${event.deadline.toISOString()}`,
        `Reporting currency: ${event.reportingCurrencyCode}`,
        "",
        "Requested items:",
        lineText,
        "",
        `Open the secure supplier workspace: ${portalPath}`,
        "",
        "This is a preview. Publishing the RFQ controls the actual invitation workflow.",
      ].join("\n");
      const html = `<p>Hello ${escapeEmailHtml(greetingName)},</p><p>${escapeEmailHtml(companyName)} invites <strong>${escapeEmailHtml(recipient.supplierName)}</strong> to respond to <strong>${escapeEmailHtml(event.eventNumber)}: ${escapeEmailHtml(event.title)}</strong>.</p><p><strong>Submission deadline:</strong> ${event.deadline.toISOString()}<br/><strong>Reporting currency:</strong> ${escapeEmailHtml(event.reportingCurrencyCode)}</p><ul>${lineHtml}</ul><p><a href="${portalPath}">Open the secure supplier workspace</a></p><p><em>This is a preview. Publishing the RFQ controls the actual invitation workflow.</em></p>`;
      return {
        supplierId: recipient.supplierId,
        supplierName: recipient.supplierName,
        to: recipient.email?.trim() || null,
        recipientState: recipient.email?.trim() ? "ready" : "missing_email",
        subject,
        text,
        html,
      };
    }),
  };
}

function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function createSourcingEvent(actor: SourcingActor, input: CreateEventInput) {
  if (input.deadline.getTime() <= Date.now()) {
    throw new SourcingError("RFQ_DEADLINE_INVALID", "RFQ deadline must be in the future.", 400);
  }
  if (input.lines.length === 0) throw new SourcingError("RFQ_LINES_REQUIRED", "At least one RFQ line is required.", 400);
  if (input.supplierIds.length === 0) throw new SourcingError("RFQ_SUPPLIERS_REQUIRED", "Invite at least one approved supplier.", 400);
  const criterionWeight = input.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (input.criteria.length === 0 || Math.abs(criterionWeight - 100) > 0.01) {
    throw new SourcingError("RFQ_CRITERIA_WEIGHT_INVALID", "Evaluation criteria must total exactly 100%.", 400);
  }
  if (input.requisitionId) {
    const [requisition] = await db
      .select({ id: purchaseRequisitions.id, status: purchaseRequisitions.status })
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.id, input.requisitionId),
          eq(purchaseRequisitions.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!requisition) {
      throw new SourcingError("REQUISITION_NOT_FOUND", "The linked requisition was not found in this organization.", 404);
    }
    if (String(requisition.status).toUpperCase() !== "APPROVED") {
      throw new SourcingError("REQUISITION_NOT_APPROVED", "The linked requisition must be approved before an RFQ is created.", 409);
    }
    const existing = await db
      .select({ id: sourcingEvents.id, eventNumber: sourcingEvents.eventNumber, status: sourcingEvents.status })
      .from(sourcingEvents)
      .where(and(eq(sourcingEvents.organizationId, actor.organizationId), eq(sourcingEvents.requisitionId, input.requisitionId)));
    const active = existing.find((event) => !["CANCELLED", "ARCHIVED"].includes(String(event.status).toUpperCase()));
    if (active) {
      throw new SourcingError(
        "REQUISITION_RFQ_ALREADY_EXISTS",
        `Requisition is already linked to sourcing event ${active.eventNumber}.`,
        409,
        "Open the existing sourcing event instead of creating a duplicate.",
        { eventId: active.id },
      );
    }
  }

  const uniqueSupplierIds = [...new Set(input.supplierIds)];
  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, actor.organizationId), inArray(suppliers.id, uniqueSupplierIds)));
  if (supplierRows.length !== uniqueSupplierIds.length) {
    throw new SourcingError("RFQ_SUPPLIER_NOT_FOUND", "One or more invited suppliers do not belong to this organization.", 400);
  }
  for (const supplier of supplierRows) {
    assertSupplierTransactionAllowed(
      { supplierName: supplier.name, status: supplier.status, complianceStatus: supplier.complianceStatus, blockedReason: supplier.blockedReason },
      "RFQ invitations",
    );
    if (!['approved', 'active'].includes(String(supplier.status).toLowerCase())) {
      throw new SourcingError("SUPPLIER_NOT_APPROVED", `${supplier.name} is not approved for sourcing events.`, 409);
    }
    if (String(supplier.onboardingStatus).toLowerCase() !== "approved") {
      throw new SourcingError("SUPPLIER_NOT_APPROVED", `${supplier.name} has not completed governed supplier onboarding.`, 409);
    }
  }
  if (input.legalEntityId) {
    const [legalEntity] = await db.select({ id: mdmLegalEntities.id }).from(mdmLegalEntities).where(and(eq(mdmLegalEntities.id, input.legalEntityId), eq(mdmLegalEntities.organizationId, actor.organizationId), eq(mdmLegalEntities.active, true))).limit(1);
    if (!legalEntity) throw new SourcingError("LEGAL_ENTITY_NOT_ACTIVE", "Legal entity is missing or inactive.", 400);
  }
  const itemIds = input.lines.map((line) => line.itemId).filter((id): id is number => Boolean(id));
  if (itemIds.length > 0) {
    const activeItems = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.organizationId, actor.organizationId), eq(inventoryItems.status, "active"), inArray(inventoryItems.id, itemIds)));
    if (new Set(activeItems.map((row) => row.id)).size !== new Set(itemIds).size) {
      throw new SourcingError("RFQ_ITEM_NOT_ACTIVE", "One or more RFQ items are missing, inactive, or belong to another organization.", 409);
    }
  }

  const reportingCurrencyCode = normalizeCurrency(input.reportingCurrencyCode);
  const created = await db.transaction(async (tx) => {
    const [event] = await tx.insert(sourcingEvents).values({
      organizationId: actor.organizationId,
      eventNumber: eventNumber(),
      title: input.title,
      description: input.description,
      status: "DRAFT",
      ownerUserId: actor.userId,
      requisitionId: input.requisitionId,
      legalEntityId: input.legalEntityId,
      reportingCurrencyCode,
      deadline: input.deadline,
      minimumResponses: input.minimumResponses,
      competitionRequired: input.competitionRequired,
      terms: input.terms,
    }).returning();
    await tx.insert(sourcingEventLines).values(input.lines.map((line, index) => ({
      organizationId: actor.organizationId,
      eventId: event.id,
      lineNumber: index + 1,
      ...line,
      targetCurrencyCode: line.targetCurrencyCode ? normalizeCurrency(line.targetCurrencyCode) : reportingCurrencyCode,
    })));
    await tx.insert(sourcingEvaluationCriteria).values(input.criteria.map((criterion, index) => ({
      organizationId: actor.organizationId,
      eventId: event.id,
      name: criterion.name,
      criterionType: criterion.criterionType,
      weight: criterion.weight,
      knockout: criterion.knockout ?? false,
      sortOrder: index,
      guidance: criterion.guidance,
    })));
    await tx.insert(sourcingInvitations).values(uniqueSupplierIds.map((supplierId) => ({
      organizationId: actor.organizationId,
      eventId: event.id,
      supplierId,
      invitedByUserId: actor.userId,
    })));
    return event;
  });
  await audit(actor, "RFQ_CREATED", "sourcing_event", created.id, null, created);
  return getSourcingEventDetails(actor.organizationId, created.id);
}

export async function publishSourcingEvent(actor: SourcingActor, eventId: number, idempotencyKey: string) {
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, "RFQ_PUBLISH");
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (event.status !== "DRAFT") throw new SourcingError("RFQ_STATUS_INVALID", "Only draft RFQs can be published.");
  if (event.deadline.getTime() <= Date.now()) throw new SourcingError("RFQ_DEADLINE_PASSED", "The RFQ deadline has passed.");
  const [lineCount, invitationCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(sourcingEventLines).where(and(eq(sourcingEventLines.organizationId, actor.organizationId), eq(sourcingEventLines.eventId, eventId))),
    db.select({ count: sql<number>`count(*)::int` }).from(sourcingInvitations).where(and(eq(sourcingInvitations.organizationId, actor.organizationId), eq(sourcingInvitations.eventId, eventId))),
  ]);
  if (!lineCount[0]?.count || !invitationCount[0]?.count) throw new SourcingError("RFQ_NOT_READY", "RFQ requires lines and invited suppliers before publication.", 409);
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(sourcingEvents).set({ status: "OPEN", publishedAt: new Date(), updatedAt: new Date(), version: event.version + 1 }).where(and(eq(sourcingEvents.id, eventId), eq(sourcingEvents.organizationId, actor.organizationId), eq(sourcingEvents.status, "DRAFT"))).returning();
    if (!row) throw new SourcingError("RFQ_CONCURRENT_UPDATE", "RFQ was changed by another user. Refresh and retry.", 409);
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: "RFQ_PUBLISH", resourceType: "sourcing_event", resourceId: eventId, response: { eventId, status: row.status } });
    return [row] as const;
  });
  await audit(actor, "RFQ_PUBLISHED", "sourcing_event", eventId, event, updated);
  return { duplicate: false, event: updated };
}

async function exchangeRateForQuote(organizationId: number, event: typeof sourcingEvents.$inferSelect, currencyCode: string) {
  if (currencyCode === event.reportingCurrencyCode) return 1;
  const snapshot = event.lockedFxSnapshot ?? {};
  if (Number(snapshot[currencyCode]) > 0) return Number(snapshot[currencyCode]);
  const now = new Date();
  const [rate] = await db.select().from(mdmExchangeRates).where(and(
    eq(mdmExchangeRates.organizationId, organizationId),
    eq(mdmExchangeRates.fromCurrencyCode, currencyCode),
    eq(mdmExchangeRates.toCurrencyCode, event.reportingCurrencyCode),
    eq(mdmExchangeRates.active, true),
    lte(mdmExchangeRates.effectiveDate, now),
    or(isNull(mdmExchangeRates.expiresAt), sql`${mdmExchangeRates.expiresAt} > ${now}`),
  )).orderBy(desc(mdmExchangeRates.effectiveDate)).limit(1);
  if (!rate || Number(rate.rate) <= 0) {
    throw new SourcingError("FX_RATE_REQUIRED", `No active ${currencyCode}/${event.reportingCurrencyCode} rate is available.`, 409, "Add and approve an effective FX rate in Master Data before submitting this quote.");
  }
  await db.update(sourcingEvents).set({ lockedFxSnapshot: { ...snapshot, [currencyCode]: Number(rate.rate) }, updatedAt: new Date() }).where(and(eq(sourcingEvents.id, event.id), eq(sourcingEvents.organizationId, organizationId)));
  return Number(rate.rate);
}

export async function submitSupplierQuote(
  actor: SourcingActor,
  eventId: number,
  supplierId: number,
  input: SubmitQuoteInput,
  idempotencyKey: string,
  submissionMode: "supplier" | "buyer_capture" = "supplier",
) {
  const idempotencyAction = submissionMode === "buyer_capture" ? "QUOTE_CAPTURE" : "QUOTE_SUBMIT";
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, idempotencyAction);
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (event.status !== "OPEN") throw new SourcingError("RFQ_NOT_OPEN", "Quotes can only be submitted while the RFQ is open.", 409);
  if (event.deadline.getTime() <= Date.now()) throw new SourcingError("RFQ_DEADLINE_PASSED", "The RFQ deadline has passed.", 409);
  const [invitation] = await db.select().from(sourcingInvitations).where(and(eq(sourcingInvitations.organizationId, actor.organizationId), eq(sourcingInvitations.eventId, eventId), eq(sourcingInvitations.supplierId, supplierId))).limit(1);
  if (!invitation) throw new SourcingError("SUPPLIER_NOT_INVITED", "This supplier is not invited to the RFQ.", 403);
  const [supplier] = await db.select().from(suppliers).where(and(eq(suppliers.organizationId, actor.organizationId), eq(suppliers.id, supplierId))).limit(1);
  if (!supplier || String(supplier.onboardingStatus ?? "").toUpperCase() !== "APPROVED") {
    throw new SourcingError("SUPPLIER_NOT_APPROVED", "Supplier approval is no longer active for this sourcing event.", 409, "Complete supplier onboarding or ask the buyer to remove the invitation.");
  }
  assertSupplierTransactionAllowed({
    supplierName: supplier.name,
    status: supplier.status,
    complianceStatus: supplier.complianceStatus,
    blockedReason: supplier.blockedReason,
  }, "quote submission");
  const eventLines = await db.select().from(sourcingEventLines).where(and(eq(sourcingEventLines.organizationId, actor.organizationId), eq(sourcingEventLines.eventId, eventId)));
  const eventLineIds = new Set(eventLines.map((line) => line.id));
  if (input.lines.length !== eventLines.length || input.lines.some((line) => !eventLineIds.has(line.eventLineId))) {
    throw new SourcingError("QUOTE_LINES_INCOMPLETE", "A quote line is required for every RFQ line.", 400);
  }
  const currencyCode = normalizeCurrency(input.currencyCode);
  const exchangeRate = await exchangeRateForQuote(actor.organizationId, event, currencyCode);
  const [latestQuote] = await db.select().from(supplierQuotes).where(and(eq(supplierQuotes.organizationId, actor.organizationId), eq(supplierQuotes.eventId, eventId), eq(supplierQuotes.supplierId, supplierId))).orderBy(desc(supplierQuotes.version)).limit(1);
  const previous = latestQuote?.status === "SUBMITTED" ? latestQuote : null;
  const version = (latestQuote?.version ?? 0) + 1;
  const totals = input.lines.reduce((sum, line) => {
    const subtotal = line.quantity * line.unitPrice;
    const tax = line.taxAmount ?? 0;
    const freight = line.freightAmount ?? 0;
    return { subtotal: sum.subtotal + subtotal, tax: sum.tax + tax, landed: sum.landed + subtotal + tax + freight };
  }, { subtotal: 0, tax: 0, landed: 0 });
  const quote = await db.transaction(async (tx) => {
    if (previous) await tx.update(supplierQuotes).set({ status: "SUPERSEDED", updatedAt: new Date() }).where(and(eq(supplierQuotes.id, previous.id), eq(supplierQuotes.organizationId, actor.organizationId)));
    const [created] = await tx.insert(supplierQuotes).values({
      organizationId: actor.organizationId,
      eventId,
      supplierId,
      quoteNumber: `Q-${event.eventNumber}-${supplierId}-V${version}`,
      status: "SUBMITTED",
      version,
      supersedesQuoteId: latestQuote?.id,
      submittedByUserId: actor.userId,
      currencyCode,
      exchangeRateToReporting: exchangeRate,
      subtotal: totals.subtotal,
      taxTotal: totals.tax,
      landedCostTotal: totals.landed,
      reportingTotal: totals.landed * exchangeRate,
      validityDate: input.validityDate,
      paymentTerms: input.paymentTerms,
      deliveryDays: input.deliveryDays,
      notes: input.notes,
      complianceStatus: input.lines.every((line) => line.compliant !== false) ? "COMPLIANT" : "EXCEPTION",
      submittedAt: new Date(),
    }).returning();
    await tx.insert(supplierQuoteLines).values(input.lines.map((line) => ({
      organizationId: actor.organizationId,
      quoteId: created.id,
      eventLineId: line.eventLineId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxAmount: line.taxAmount ?? 0,
      freightAmount: line.freightAmount ?? 0,
      landedCost: line.quantity * line.unitPrice + (line.taxAmount ?? 0) + (line.freightAmount ?? 0),
      promisedDate: line.promisedDate,
      supplierItemCode: line.supplierItemCode,
      alternativeDescription: line.alternativeDescription,
      compliant: line.compliant ?? true,
      exceptionReason: line.exceptionReason,
    })));
    await tx.update(sourcingInvitations).set({ status: "RESPONDED", respondedAt: new Date() }).where(eq(sourcingInvitations.id, invitation.id));
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: idempotencyAction, resourceType: "supplier_quote", resourceId: created.id, response: { quoteId: created.id, version } });
    return created;
  });
  const auditAction = submissionMode === "buyer_capture"
    ? (latestQuote ? "SUPPLIER_QUOTE_CAPTURE_REVISED" : "SUPPLIER_QUOTE_CAPTURED")
    : (latestQuote ? "SUPPLIER_QUOTE_REVISED" : "SUPPLIER_QUOTE_SUBMITTED");
  await audit(actor, auditAction, "supplier_quote", quote.id, latestQuote ?? null, quote);
  return { duplicate: false, quote };
}

export async function withdrawSupplierQuote(actor: SourcingActor, eventId: number, supplierId: number, quoteId: number, idempotencyKey: string) {
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, "QUOTE_WITHDRAW");
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (event.status !== "OPEN" || event.deadline.getTime() <= Date.now()) {
    throw new SourcingError("RFQ_DEADLINE_PASSED", "A quote can only be withdrawn while the RFQ is open and before its deadline.", 409);
  }
  const [quote] = await db.select().from(supplierQuotes).where(and(
    eq(supplierQuotes.id, quoteId),
    eq(supplierQuotes.eventId, eventId),
    eq(supplierQuotes.supplierId, supplierId),
    eq(supplierQuotes.organizationId, actor.organizationId),
    eq(supplierQuotes.status, "SUBMITTED"),
  )).limit(1);
  if (!quote) throw new SourcingError("QUOTE_NOT_WITHDRAWABLE", "The submitted quote was not found or is no longer withdrawable.", 404);
  const [newer] = await db.select({ id: supplierQuotes.id }).from(supplierQuotes).where(and(
    eq(supplierQuotes.organizationId, actor.organizationId),
    eq(supplierQuotes.eventId, eventId),
    eq(supplierQuotes.supplierId, supplierId),
    eq(supplierQuotes.status, "SUBMITTED"),
    sql`${supplierQuotes.version} > ${quote.version}`,
  )).limit(1);
  if (newer) throw new SourcingError("QUOTE_NOT_LATEST_VERSION", "Only the latest submitted quote version can be withdrawn.", 409);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(supplierQuotes).set({ status: "WITHDRAWN", withdrawnAt: new Date(), updatedAt: new Date() }).where(and(eq(supplierQuotes.id, quoteId), eq(supplierQuotes.organizationId, actor.organizationId), eq(supplierQuotes.status, "SUBMITTED"))).returning();
    await tx.update(sourcingInvitations).set({ status: "VIEWED" }).where(and(eq(sourcingInvitations.organizationId, actor.organizationId), eq(sourcingInvitations.eventId, eventId), eq(sourcingInvitations.supplierId, supplierId)));
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: "QUOTE_WITHDRAW", resourceType: "supplier_quote", resourceId: quoteId, response: { quoteId, status: row.status } });
    return row;
  });
  await audit(actor, "SUPPLIER_QUOTE_WITHDRAWN", "supplier_quote", quoteId, quote, updated);
  return { duplicate: false, quote: updated };
}

export async function closeSourcingEvent(actor: SourcingActor, eventId: number, idempotencyKey: string, overrideReason?: string | null) {
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, "RFQ_CLOSE");
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (event.status !== "OPEN") throw new SourcingError("RFQ_STATUS_INVALID", "Only open RFQs can be closed.");
  if (new Date(event.deadline).getTime() > Date.now() && !overrideReason?.trim()) {
    throw new SourcingError(
      "RFQ_EARLY_CLOSE_REASON_REQUIRED",
      "Closing an RFQ before its submission deadline requires an approved override reason.",
      409,
      "Wait until the deadline or provide a documented early-close reason.",
    );
  }
  const [responseCount] = await db.select({ count: sql<number>`count(*)::int` }).from(supplierQuotes).where(and(eq(supplierQuotes.organizationId, actor.organizationId), eq(supplierQuotes.eventId, eventId), eq(supplierQuotes.status, "SUBMITTED")));
  if ((responseCount?.count ?? 0) < event.minimumResponses && !overrideReason?.trim()) {
    throw new SourcingError("RFQ_MINIMUM_RESPONSE_NOT_MET", `RFQ requires ${event.minimumResponses} compliant response(s) before evaluation.`, 409, "Invite additional suppliers or provide an approved exception reason.");
  }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(sourcingEvents).set({ status: "EVALUATING", closedAt: new Date(), updatedAt: new Date(), version: event.version + 1 }).where(and(eq(sourcingEvents.id, eventId), eq(sourcingEvents.organizationId, actor.organizationId), eq(sourcingEvents.status, "OPEN"))).returning();
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: "RFQ_CLOSE", resourceType: "sourcing_event", resourceId: eventId, response: { eventId, status: row.status } });
    return [row] as const;
  });
  await audit(actor, "RFQ_CLOSED_FOR_EVALUATION", "sourcing_event", eventId, event, updated, overrideReason);
  return { duplicate: false, event: updated };
}

export async function saveQuoteEvaluation(actor: SourcingActor, eventId: number, quoteId: number, scores: Array<{ criterionId: number; score: number; comment?: string | null }>) {
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (!['EVALUATING', 'CLOSED'].includes(event.status)) throw new SourcingError("RFQ_NOT_EVALUATING", "Evaluations can only be recorded after the RFQ is closed.");
  const [quote] = await db.select().from(supplierQuotes).where(and(eq(supplierQuotes.id, quoteId), eq(supplierQuotes.eventId, eventId), eq(supplierQuotes.organizationId, actor.organizationId), eq(supplierQuotes.status, "SUBMITTED"))).limit(1);
  if (!quote) throw new SourcingError("QUOTE_NOT_FOUND", "Submitted quote was not found for this event.", 404);
  const criteria = await db.select().from(sourcingEvaluationCriteria).where(and(eq(sourcingEvaluationCriteria.organizationId, actor.organizationId), eq(sourcingEvaluationCriteria.eventId, eventId)));
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  if (scores.length !== criteria.length || scores.some((entry) => !byId.has(entry.criterionId) || entry.score < 0 || entry.score > 100)) {
    throw new SourcingError("EVALUATION_INCOMPLETE", "Score every criterion from 0 to 100.", 400);
  }
  await db.transaction(async (tx) => {
    for (const entry of scores) {
      const criterion = byId.get(entry.criterionId)!;
      await tx.insert(sourcingEvaluations).values({ organizationId: actor.organizationId, eventId, quoteId, criterionId: entry.criterionId, evaluatorUserId: actor.userId, score: entry.score, weightedScore: entry.score * (criterion.weight / 100), comment: entry.comment }).onConflictDoUpdate({ target: [sourcingEvaluations.quoteId, sourcingEvaluations.criterionId, sourcingEvaluations.evaluatorUserId], set: { score: entry.score, weightedScore: entry.score * (criterion.weight / 100), comment: entry.comment, updatedAt: new Date() } });
    }
  });
  await audit(actor, "QUOTE_EVALUATED", "supplier_quote", quoteId, null, { scores });
  return getQuoteComparison(actor.organizationId, eventId);
}

export async function getQuoteComparison(organizationId: number, eventId: number) {
  await eventForOrganization(organizationId, eventId);
  const quoteRows = await db.select({ quote: supplierQuotes, supplierName: suppliers.name }).from(supplierQuotes).innerJoin(suppliers, and(eq(suppliers.id, supplierQuotes.supplierId), eq(suppliers.organizationId, organizationId))).where(and(eq(supplierQuotes.organizationId, organizationId), eq(supplierQuotes.eventId, eventId), eq(supplierQuotes.status, "SUBMITTED")));
  const quoteIds = quoteRows.map((row) => row.quote.id);
  if (quoteIds.length === 0) return [];
  const [lines, evaluations] = await Promise.all([
    db.select().from(supplierQuoteLines).where(and(eq(supplierQuoteLines.organizationId, organizationId), inArray(supplierQuoteLines.quoteId, quoteIds))),
    db.select().from(sourcingEvaluations).where(and(eq(sourcingEvaluations.organizationId, organizationId), inArray(sourcingEvaluations.quoteId, quoteIds))),
  ]);
  return quoteRows.map(({ quote, supplierName }) => {
    const quoteEvaluations = evaluations.filter((entry) => entry.quoteId === quote.id);
    const evaluators = new Set(quoteEvaluations.map((entry) => entry.evaluatorUserId));
    const weightedScore = evaluators.size === 0 ? null : quoteEvaluations.reduce((sum, entry) => sum + entry.weightedScore, 0) / evaluators.size;
    return { quote, supplierName, lines: lines.filter((line) => line.quoteId === quote.id), weightedScore };
  }).sort((left, right) => (right.weightedScore ?? -1) - (left.weightedScore ?? -1) || left.quote.reportingTotal - right.quote.reportingTotal);
}

export async function submitSourcingAward(actor: SourcingActor, eventId: number, input: { justification: string; overrideReason?: string | null; lines: Array<{ eventLineId: number; quoteLineId: number; awardedQuantity: number }> }, idempotencyKey: string) {
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, "RFQ_AWARD_SUBMIT");
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (event.status !== "EVALUATING") throw new SourcingError("RFQ_NOT_EVALUATING", "An award can only be submitted while the RFQ is being evaluated.");
  const eventLines = await db.select().from(sourcingEventLines).where(and(eq(sourcingEventLines.organizationId, actor.organizationId), eq(sourcingEventLines.eventId, eventId)));
  const quoteLineIds = input.lines.map((line) => line.quoteLineId);
  const quoteLines = await db.select({ line: supplierQuoteLines, quote: supplierQuotes }).from(supplierQuoteLines).innerJoin(supplierQuotes, and(eq(supplierQuotes.id, supplierQuoteLines.quoteId), eq(supplierQuotes.organizationId, actor.organizationId))).where(and(eq(supplierQuoteLines.organizationId, actor.organizationId), inArray(supplierQuoteLines.id, quoteLineIds), eq(supplierQuotes.eventId, eventId), eq(supplierQuotes.status, "SUBMITTED")));
  if (quoteLines.length !== quoteLineIds.length) throw new SourcingError("AWARD_QUOTE_LINE_INVALID", "One or more award lines are not from submitted quotes for this RFQ.", 400);
  const expiredQuote = quoteLines.find(({ quote }) => quote.validityDate && new Date(quote.validityDate).getTime() < Date.now());
  if (expiredQuote && !input.overrideReason?.trim()) {
    throw new SourcingError(
      "AWARD_QUOTE_EXPIRED",
      `Quote ${expiredQuote.quote.quoteNumber} has expired and cannot be awarded without an approved override reason.`,
      409,
      "Request a refreshed quotation or provide a documented exception reason.",
    );
  }
  for (const line of eventLines) {
    const awarded = input.lines.filter((entry) => entry.eventLineId === line.id).reduce((sum, entry) => sum + entry.awardedQuantity, 0);
    if (Math.abs(awarded - line.quantity) > 0.0001) throw new SourcingError("AWARD_QUANTITY_INVALID", `Awarded quantity for RFQ line ${line.lineNumber} must equal ${line.quantity}.`, 400);
  }
  const quoteLineMap = new Map(quoteLines.map((row) => [row.line.id, row]));
  const award = await db.transaction(async (tx) => {
    const [created] = await tx.insert(sourcingAwards).values({ organizationId: actor.organizationId, eventId, status: "SUBMITTED", recommendedByUserId: actor.userId, justification: input.justification, overrideReason: input.overrideReason, submittedAt: new Date() }).returning();
    await tx.insert(sourcingAwardLines).values(input.lines.map((entry) => {
      const source = quoteLineMap.get(entry.quoteLineId)!;
      return { organizationId: actor.organizationId, awardId: created.id, eventLineId: entry.eventLineId, quoteLineId: entry.quoteLineId, supplierId: source.quote.supplierId, awardedQuantity: entry.awardedQuantity, awardedUnitPrice: source.line.unitPrice, currencyCode: source.quote.currencyCode, reportingAmount: entry.awardedQuantity * source.line.unitPrice * source.quote.exchangeRateToReporting };
    }));
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: "RFQ_AWARD_SUBMIT", resourceType: "sourcing_award", resourceId: created.id, response: { awardId: created.id, status: created.status } });
    return created;
  });
  await audit(actor, "RFQ_AWARD_SUBMITTED", "sourcing_award", award.id, null, award, input.justification);
  return { duplicate: false, award };
}

export async function approveSourcingAward(actor: SourcingActor, awardId: number, reason: string, idempotencyKey: string) {
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, "RFQ_AWARD_APPROVE");
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const [award] = await db.select().from(sourcingAwards).where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, actor.organizationId))).limit(1);
  if (!award) throw new SourcingError("AWARD_NOT_FOUND", "Sourcing award was not found.", 404);
  if (award.status !== "SUBMITTED") throw new SourcingError("AWARD_STATUS_INVALID", "Only submitted awards can be approved.");
  const event = await eventForOrganization(actor.organizationId, award.eventId);
  if (award.recommendedByUserId === actor.userId || event.ownerUserId === actor.userId) {
    throw new SourcingError("SEGREGATION_OF_DUTIES_VIOLATION", "The event owner or award recommender cannot approve their own award.", 403, "Assign an independent sourcing approver.");
  }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(sourcingAwards).set({ status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, actor.organizationId), eq(sourcingAwards.status, "SUBMITTED"))).returning();
    await tx.update(sourcingEvents).set({ status: "AWARDED", updatedAt: new Date(), version: event.version + 1 }).where(and(eq(sourcingEvents.id, event.id), eq(sourcingEvents.organizationId, actor.organizationId)));
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: "RFQ_AWARD_APPROVE", resourceType: "sourcing_award", resourceId: awardId, response: { awardId, status: row.status } });
    return [row] as const;
  });
  await audit(actor, "RFQ_AWARD_APPROVED", "sourcing_award", awardId, award, updated, reason);
  return { duplicate: false, award: updated };
}

export async function convertAwardToPurchaseOrders(actor: SourcingActor, awardId: number, idempotencyKey: string) {
  const duplicate = await requireIdempotencyKey(actor.organizationId, idempotencyKey, "RFQ_AWARD_CONVERT");
  if (duplicate) return { duplicate: true, ...(duplicate.response ?? {}) };
  const [award] = await db.select().from(sourcingAwards).where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, actor.organizationId))).limit(1);
  if (!award) throw new SourcingError("AWARD_NOT_FOUND", "Sourcing award was not found.", 404);
  if (award.status !== "APPROVED") throw new SourcingError("AWARD_NOT_APPROVED", "Only approved awards can be converted to purchase orders.");
  const event = await eventForOrganization(actor.organizationId, award.eventId);
  let linkedRequisitionDepartmentId: number | null = null;
  if (event.requisitionId) {
    const [linkedRequisition] = await db
      .select({ departmentId: purchaseRequisitions.departmentId })
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.id, event.requisitionId),
          eq(purchaseRequisitions.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    linkedRequisitionDepartmentId = linkedRequisition?.departmentId ?? null;
  }
  const rows = await db.select({ awardLine: sourcingAwardLines, quoteLine: supplierQuoteLines, eventLine: sourcingEventLines }).from(sourcingAwardLines).innerJoin(supplierQuoteLines, eq(supplierQuoteLines.id, sourcingAwardLines.quoteLineId)).innerJoin(sourcingEventLines, eq(sourcingEventLines.id, sourcingAwardLines.eventLineId)).where(and(eq(sourcingAwardLines.organizationId, actor.organizationId), eq(sourcingAwardLines.awardId, awardId)));
  const supplierIds = [...new Set(rows.map((row) => row.awardLine.supplierId))];
  const prepared = [] as Array<{ supplierId: number; order: typeof purchaseOrders.$inferInsert; lines: Array<typeof purchaseOrderItems.$inferInsert> }>;
  for (const supplierId of supplierIds) {
    const supplierLines = rows.filter((row) => row.awardLine.supplierId === supplierId);
    if (supplierLines.some((row) => !Number.isInteger(row.awardLine.awardedQuantity))) throw new SourcingError("AWARD_QUANTITY_NOT_PO_COMPATIBLE", "PO conversion currently requires whole-number awarded quantities.", 409);
    if (supplierLines.some((row) => !row.eventLine.itemId)) {
      throw new SourcingError("AWARD_ITEM_MAPPING_REQUIRED", "Every awarded RFQ line must be mapped to an active catalogue or approved once-off item before PO conversion.", 409, "Complete item stewardship in Master Data, then retry conversion.");
    }
    const quoteId = supplierLines[0]!.quoteLine.quoteId;
    const [quote] = await db.select().from(supplierQuotes).where(and(eq(supplierQuotes.id, quoteId), eq(supplierQuotes.organizationId, actor.organizationId))).limit(1);
    const order = await applySupplierDefaultsToPurchaseOrder({ organizationId: actor.organizationId, orderNumber: `PO-${new Date().getUTCFullYear()}-${Date.now().toString(36).toUpperCase()}-${supplierId}`, supplierId, requisitionId: event.requisitionId, departmentId: linkedRequisitionDepartmentId, currencyCode: quote.currencyCode, status: "DRAFT", approvalStatus: "DRAFT", createdByUserId: actor.userId, sourcingAwardId: awardId, totalAmount: supplierLines.reduce((sum, row) => sum + row.awardLine.awardedQuantity * row.awardLine.awardedUnitPrice, 0), notes: `Created from approved sourcing award ${awardId} (${event.eventNumber}).` });
    prepared.push({ supplierId, order, lines: supplierLines.map((row) => ({ orderId: 0, itemId: row.eventLine.itemId!, quantity: row.awardLine.awardedQuantity, unitPrice: row.awardLine.awardedUnitPrice, totalPrice: row.awardLine.awardedQuantity * row.awardLine.awardedUnitPrice, unitOfMeasureId: row.eventLine.unitOfMeasureId, taxCodeId: row.eventLine.taxCodeId, costCentreId: row.eventLine.costCentreId, glAccountCode: row.eventLine.glAccountCode, notes: `Sourcing award line ${row.awardLine.id}` })) });
  }
  const createdOrders = await db.transaction(async (tx) => {
    const orders = [];
    for (const entry of prepared) {
      const [order] = await tx.insert(purchaseOrders).values(entry.order).returning();
      await tx.insert(purchaseOrderItems).values(entry.lines.map((line) => ({ ...line, orderId: order.id })));
      orders.push(order);
    }
    await tx.update(sourcingAwards).set({ status: "CONVERTED", convertedPurchaseOrderId: orders[0]?.id, updatedAt: new Date() }).where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, actor.organizationId)));
    await tx.insert(workflowIdempotency).values({ organizationId: actor.organizationId, idempotencyKey, action: "RFQ_AWARD_CONVERT", resourceType: "sourcing_award", resourceId: awardId, response: { awardId, purchaseOrderIds: orders.map((order) => order.id) } });
    return orders;
  });
  await audit(actor, "RFQ_AWARD_CONVERTED_TO_PO", "sourcing_award", awardId, award, { purchaseOrderIds: createdOrders.map((order) => order.id) });
  return { duplicate: false, purchaseOrders: createdOrders };
}

export async function addSourcingClarification(actor: SourcingActor, eventId: number, input: { supplierId?: number | null; subject: string; message: string; visibility: "PRIVATE" | "ALL_INVITED"; parentId?: number | null }) {
  const event = await eventForOrganization(actor.organizationId, eventId);
  if (['CANCELLED', 'ARCHIVED', 'AWARDED'].includes(event.status)) throw new SourcingError("RFQ_CLARIFICATION_CLOSED", "Clarifications are closed for this RFQ.");
  const [clarification] = await db.insert(sourcingClarifications).values({ organizationId: actor.organizationId, eventId, supplierId: input.supplierId, createdByUserId: actor.userId, subject: input.subject, message: input.message, visibility: input.visibility, parentId: input.parentId }).returning();
  await audit(actor, "RFQ_CLARIFICATION_ADDED", "sourcing_event", eventId, null, clarification);
  return clarification;
}
