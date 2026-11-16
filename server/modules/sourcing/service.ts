import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { db, pool } from "../../db";
import { appendAuditEvent } from "../../services/audit-chain-service";
import { appendAuditEventWithClient } from "../../services/audit-chain-client";
import { getOrganizationDocumentBranding } from "../../services/organization-document-branding";
import { applySupplierDefaultsToPurchaseOrder, assertSupplierTransactionAllowed } from "../procurement/supplier-defaults";
import { lockConversionRequisition } from "../procurement/requisition-po-conversion";
import { transferRequisitionBudget } from "../procurement/requisition-budget-transfer";
import { bindPurchaseOrderBudgetProvenance } from "../procurement/purchase-order-budget-provenance";
import {
  inventoryItems,
  mdmExchangeRates,
  mdmLegalEntities,
  purchaseRequisitions,
  purchaseRequisitionItems,
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

type RequisitionRfqInput = Pick<CreateEventInput, "deadline"|"supplierIds"|"criteria"|"terms"|"competitionRequired"> & {
  title?: string;
  minimumResponses?: number;
};
type LockedRequisition = NonNullable<Awaited<ReturnType<typeof lockConversionRequisition>>>;

export function createSourcingEvent(actor: SourcingActor, input: CreateEventInput, key?: string) {
  return createSourcingDraft(actor, input.requisitionId ?? null, input, key, "RFQ_CREATE", async () => input);
}

export function convertRequisitionToSourcingDraft(actor: SourcingActor, requisitionId: number, request: RequisitionRfqInput, key?: string) {
  return createSourcingDraft(actor, requisitionId, request, key, "REQUISITION_CONVERT_TO_RFQ", async (tx, requisition) => {
    if (!requisition) throw new SourcingError("REQUISITION_NOT_FOUND", "The linked requisition was not found in this organization.", 404);
    const lines = await tx.select().from(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId, requisition.id))
      .orderBy(asc(purchaseRequisitionItems.lineNumber),asc(purchaseRequisitionItems.id)).limit(5001).for("share");
    const currency = requisition.currencyCode;
    if (!currency) throw new SourcingError("RFQ_CURRENCY_REQUIRED","Confirm the requisition currency before creating the RFQ.");
    return {
      ...request, title: request.title ?? `RFQ for ${requisition.requisitionNumber}`,
      description: requisition.justification ?? requisition.notes, requisitionId, reportingCurrencyCode: currency,
      minimumResponses: request.minimumResponses ?? Math.min(2,new Set(request.supplierIds).size),
      lines: lines.map(line => ({ itemId:line.itemId,description:line.description??line.itemDescriptionSnapshot??`Line ${line.lineNumber}`,
        quantity:line.quantity,unitOfMeasureId:line.unitOfMeasureId,taxCodeId:line.taxCodeId,costCentreId:line.costCentreId,
        glAccountCode:line.glAccountCode,requiredDate:requisition.requiredDate,targetUnitPrice:line.unitPrice,targetCurrencyCode:currency })),
    };
  });
}

async function createSourcingDraft(actor:SourcingActor,requisitionId:number|null,request:unknown,suppliedKey:string|undefined,
  action:"RFQ_CREATE"|"REQUISITION_CONVERT_TO_RFQ",prepare:(tx:SourcingTransaction,requisition:LockedRequisition|null)=>Promise<CreateEventInput>) {
  const org=actor.organizationId,key=suppliedKey?.trim();
  if (key && key.length>256) throw new SourcingError("IDEMPOTENCY_KEY_INVALID","Provide an Idempotency-Key of at most 256 characters.",400);
  const commandHash=createHash("sha256").update(JSON.stringify([requisitionId,request])).digest("hex");
  const eventId=await withSourcingCommand(async(client,tx)=>{
    const requisition=requisitionId===null?null:(await lockConversionRequisition(tx,org,requisitionId))??null;
    if(requisitionId!==null&&!requisition) throw new SourcingError("REQUISITION_NOT_FOUND","The linked requisition was not found in this organization.",404);
    if(key){
      const [replay]=await tx.select().from(workflowIdempotency).where(and(eq(workflowIdempotency.organizationId,org),eq(workflowIdempotency.idempotencyKey,key)));
      if(replay){
        const [event]=replay.action===action&&replay.resourceType==="sourcing_event"&&replay.resourceId!=null&&replay.response?.commandHash===commandHash
          ?await tx.select().from(sourcingEvents).where(and(eq(sourcingEvents.id,replay.resourceId),eq(sourcingEvents.organizationId,org)))
          :[];
        if(!event||event.requisitionId!==requisitionId) throw new SourcingError("IDEMPOTENCY_KEY_REUSED","This key belongs to a different RFQ request.");
        return event.id;
      }
    }
    if(requisition){
      const [active]=await tx.select({id:sourcingEvents.id,eventNumber:sourcingEvents.eventNumber}).from(sourcingEvents)
        .where(and(eq(sourcingEvents.organizationId,org),eq(sourcingEvents.requisitionId,requisition.id),
          sql`upper(${sourcingEvents.status}) NOT IN ('CANCELLED','ARCHIVED')`)).orderBy(asc(sourcingEvents.id)).limit(1);
      if(active) throw new SourcingError("REQUISITION_RFQ_ALREADY_EXISTS",`Requisition is already linked to sourcing event ${active.eventNumber}.`,409,
        "Open the existing sourcing event instead of creating a duplicate.",{eventId:active.id});
      if(String(requisition.status).toUpperCase()!=="APPROVED") throw new SourcingError("REQUISITION_NOT_APPROVED","The linked requisition must be approved before an RFQ is created.");
      const [order]=await tx.select({id:purchaseOrders.id}).from(purchaseOrders)
        .where(and(eq(purchaseOrders.organizationId,org),eq(purchaseOrders.requisitionId,requisition.id))).limit(1);
      if(order) throw new SourcingError("REQUISITION_PO_ALREADY_EXISTS","A purchase order already exists for this requisition.");
    }
    const input=await prepare(tx,requisition);
    const event=await writeSourcingDraft(tx,actor,input);
    let linkedDraftRecovery: Awaited<ReturnType<typeof readLinkedDraftRecovery>> | null = null;
    if(requisition) {
      const [converted] = await tx.update(purchaseRequisitions).set({status:"CONVERTED_TO_RFQ",updatedAt:new Date()})
        .where(and(eq(purchaseRequisitions.id,requisition.id),eq(purchaseRequisitions.organizationId,org))).returning();
      linkedDraftRecovery = await readLinkedDraftRecovery(client, tx, converted);
    }
    if(key) await tx.insert(workflowIdempotency).values({organizationId:org,idempotencyKey:key,action,resourceType:"sourcing_event",
      resourceId:event.id,response:{eventId:event.id,commandHash}});
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor.userId},action:"RFQ_CREATED",resourceType:"sourcing_event",
      resourceId:event.id,before:requisition?{requisitionId:requisition.id,requisitionStatus:requisition.status}:null,
      after:{...event,deadline:event.deadline.toISOString(),requisitionStatus:requisition?"CONVERTED_TO_RFQ":null},
      details:{linkedDraftRecovery},
      requestId:actor.requestId,ipAddress:actor.ipAddress,userAgent:actor.userAgent});
    return event.id;
  });
  return getSourcingEventDetails(org,eventId);
}

async function readLinkedDraftRecovery(client:PoolClient, tx:SourcingTransaction, requisition:LockedRequisition) {
  if(!requisition.approverId||!requisition.approvalDate||!requisition.requestorId||requisition.approverId===requisition.requestorId) return null;
  const scope=[requisition.organizationId,requisition.id];
  const {rows:[latest]}=await client.query<{id:string;matches:boolean;supersedes:boolean}>(`SELECT h.id::text,
    (h.performed_by=r.approver_id AND lower(h.action)='approved' AND upper(h.new_status)='APPROVED'
      AND h.performed_at>=r.approval_date AND h.performed_at<r.approval_date+interval '1 minute') AS matches,
    (h.performed_at>=r.approval_date) AS supersedes
    FROM approval_history h JOIN purchase_requisitions r ON r.organization_id=h.organization_id AND r.id=h.entity_id
    WHERE h.organization_id=$1 AND h.entity_type='requisition' AND h.entity_id=$2
    ORDER BY h.performed_at DESC,h.id DESC LIMIT 1 FOR SHARE OF h`,scope);
  if(latest?.supersedes&&!latest.matches) return null;
  let proof=latest?.matches ? {kind:"approval_history",id:latest.id} : null;
  const {rows:[schema]}=await client.query("SELECT to_regclass('public.purchase_budget_policy_evidence') IS NOT NULL AS installed");
  if(schema.installed){
    const {rows:[budgetProof]}=await client.query<{kind:string;id:string}>(`SELECT 'budget_policy' AS kind,
      e.requisition_id::text || ':' || e.approved_at::text AS id FROM public.purchase_budget_policy_evidence e
      JOIN purchase_requisitions r ON r.organization_id=e.organization_id AND r.id=e.requisition_id
      WHERE e.organization_id=$1 AND e.requisition_id=$2 AND e.approved_at=r.approval_date AND e.approver_user_id=r.approver_id`,scope);
    proof=budgetProof??proof;
  }
  if(!proof) return null;
  const lines=await tx.select().from(purchaseRequisitionItems).where(eq(purchaseRequisitionItems.requisitionId,requisition.id))
    .orderBy(asc(purchaseRequisitionItems.id)).limit(5001).for("share");
  if(!lines.length||lines.length>5000) return null;
  // No source lines or financial data are copied into the audit; compare hashes of the locked revision.
  return {version:1,approvalKind:proof.kind,approvalId:proof.id,
    sourceHash:createHash("sha256").update(JSON.stringify([requisition,lines])).digest("hex")};
}

export async function withdrawLinkedSourcingDraft(actor:SourcingActor,eventId:number,reason:string,idempotencyKey:string) {
  const org=actor.organizationId,key=idempotencyKey.trim();
  if(!key||key.length>256) throw new SourcingError("IDEMPOTENCY_KEY_INVALID","Provide an Idempotency-Key of at most 256 characters.",400);
  reason=reason.trim();
  if(reason.length<5||reason.length>2000) throw new SourcingError("RFQ_WITHDRAWAL_REASON_REQUIRED","Explain why the linked draft should be withdrawn (5–2,000 characters).",400);
  const commandHash=createHash("sha256").update(JSON.stringify([eventId,reason])).digest("hex");
  return withSourcingCommand(async(client,tx)=>{
    const [event]=await tx.select().from(sourcingEvents)
      .where(and(eq(sourcingEvents.organizationId,org),eq(sourcingEvents.id,eventId))).for("update");
    if(!event) throw new SourcingError("SOURCING_EVENT_NOT_FOUND","Sourcing event was not found.",404);
    const [replay]=await tx.select().from(workflowIdempotency).where(and(eq(workflowIdempotency.organizationId,org),eq(workflowIdempotency.idempotencyKey,key)));
    if(replay){
      if(replay.action!=="RFQ_DRAFT_WITHDRAW"||replay.resourceType!=="sourcing_event"||replay.resourceId!==eventId||replay.response?.commandHash!==commandHash)
        throw new SourcingError("IDEMPOTENCY_KEY_REUSED","This key belongs to a different RFQ request.");
      return {eventId,requisitionId:event.requisitionId,status:"CANCELLED",duplicate:true};
    }
    if(event.status!=="DRAFT"||event.version!==1||event.requisitionId==null||event.publishedAt||event.closedAt||event.archivedAt)
      throw new SourcingError("RFQ_DRAFT_WITHDRAWAL_BLOCKED","Only an unused, unpublished linked RFQ draft can be withdrawn.");
    const requisition=await lockConversionRequisition(tx,org,event.requisitionId);
    if(!requisition||requisition.status!=="CONVERTED_TO_RFQ")
      throw new SourcingError("RFQ_REQUISITION_RECOVERY_BLOCKED","The linked requisition is no longer available for recovery.");
    const {rows:[use]}=await client.query(`SELECT
      EXISTS(SELECT 1 FROM sourcing_invitations WHERE organization_id=$1 AND event_id=$2
        AND (status<>'INVITED' OR viewed_at IS NOT NULL OR responded_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM supplier_communication_events WHERE organization_id=$1 AND source_type='sourcing_event' AND source_id=$2)
      OR EXISTS(SELECT 1 FROM supplier_quotes WHERE organization_id=$1 AND event_id=$2)
      OR EXISTS(SELECT 1 FROM sourcing_awards WHERE organization_id=$1 AND event_id=$2)
      OR EXISTS(SELECT 1 FROM sourcing_clarifications WHERE organization_id=$1 AND event_id=$2)
      OR EXISTS(SELECT 1 FROM purchase_orders WHERE organization_id=$1 AND requisition_id=$3)
      OR EXISTS(SELECT 1 FROM sourcing_events WHERE organization_id=$1 AND requisition_id=$3 AND id<>$2
        AND status NOT IN ('CANCELLED','ARCHIVED'))
      OR EXISTS(SELECT 1 FROM audit_logs WHERE organization_id=$1 AND resource_type='sourcing_event' AND resource_id=$2
        AND (action='RFQ_PUBLISHED' OR action LIKE 'RFQ_INVITATION_EMAIL_%')) AS used`,[org,eventId,requisition.id]);
    if(use.used) throw new SourcingError("RFQ_DRAFT_WITHDRAWAL_BLOCKED","This draft has sourcing or order activity and cannot be withdrawn automatically.");
    const current=await readLinkedDraftRecovery(client,tx,requisition);
    const proof=current ? await client.query(`SELECT id FROM audit_logs WHERE organization_id=$1 AND resource_type='sourcing_event'
      AND resource_id=$2 AND action='RFQ_CREATED' AND event_hash IS NOT NULL
      AND details #>> '{before,requisitionId}'=$3::int::text AND details #>> '{before,requisitionStatus}'='APPROVED'
      AND details #>> '{after,requisitionStatus}'='CONVERTED_TO_RFQ'
      AND details->'linkedDraftRecovery'=$4::jsonb ORDER BY id DESC LIMIT 1`,[org,eventId,requisition.id,JSON.stringify(current)]) : null;
    if(!proof?.rowCount)
      throw new SourcingError("RFQ_REQUISITION_RECOVERY_BLOCKED","The original approved requisition revision cannot be verified. No records were changed; ask Procurement to review it.");
    const now=new Date();
    await tx.update(sourcingEvents).set({status:"CANCELLED",updatedAt:now,version:event.version+1})
      .where(and(eq(sourcingEvents.organizationId,org),eq(sourcingEvents.id,eventId)));
    await tx.update(purchaseRequisitions).set({status:"APPROVED",updatedAt:now})
      .where(and(eq(purchaseRequisitions.organizationId,org),eq(purchaseRequisitions.id,requisition.id)));
    const result={eventId,requisitionId:requisition.id,status:"CANCELLED"};
    await tx.insert(workflowIdempotency).values({organizationId:org,idempotencyKey:key,action:"RFQ_DRAFT_WITHDRAW",
      resourceType:"sourcing_event",resourceId:eventId,response:{...result,commandHash}});
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor.userId},action:"RFQ_DRAFT_WITHDRAWN",
      resourceType:"sourcing_event",resourceId:eventId,reason,
      before:{status:"DRAFT",requisitionId:requisition.id,requisitionStatus:requisition.status},
      after:{...result,requisitionStatus:"APPROVED"},details:{creationAuditId:String(proof.rows[0].id),approval:current},
      requestId:actor.requestId,ipAddress:actor.ipAddress,userAgent:actor.userAgent});
    return {...result,duplicate:false};
  });
}

async function writeSourcingDraft(tx:SourcingTransaction,actor:SourcingActor,input:CreateEventInput) {
  if (!Number.isFinite(input.deadline.getTime()) || input.deadline.getTime() <= Date.now()) {
    throw new SourcingError("RFQ_DEADLINE_INVALID", "RFQ deadline must be in the future.", 400);
  }
  if (input.lines.length < 1 || input.lines.length > 5000) throw new SourcingError("RFQ_LINES_REQUIRED", "Provide between 1 and 5,000 RFQ lines.", 400);
  const uniqueSupplierIds = [...new Set(input.supplierIds)];
  if (uniqueSupplierIds.length < 1 || uniqueSupplierIds.length > 100) throw new SourcingError("RFQ_SUPPLIERS_REQUIRED", "Select between 1 and 100 approved suppliers.", 400);
  if (!Number.isInteger(input.minimumResponses)||input.minimumResponses<1||input.minimumResponses>uniqueSupplierIds.length) {
    throw new SourcingError("RFQ_MINIMUM_RESPONSES_INVALID","Minimum responses must be between one and the number of invited suppliers.",400);
  }
  const criterionWeight = input.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (input.criteria.length < 1 || input.criteria.length > 100 || !Number.isFinite(criterionWeight) || Math.abs(criterionWeight - 100) > 0.01) {
    throw new SourcingError("RFQ_CRITERIA_WEIGHT_INVALID", "Evaluation criteria must total exactly 100%.", 400);
  }
  const supplierRows = await tx
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, actor.organizationId), inArray(suppliers.id, uniqueSupplierIds))).orderBy(asc(suppliers.id)).for("share");
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
    const [legalEntity] = await tx.select({ id: mdmLegalEntities.id }).from(mdmLegalEntities).where(and(eq(mdmLegalEntities.id, input.legalEntityId), eq(mdmLegalEntities.organizationId, actor.organizationId), eq(mdmLegalEntities.active, true))).limit(1).for("share");
    if (!legalEntity) throw new SourcingError("LEGAL_ENTITY_NOT_ACTIVE", "Legal entity is missing or inactive.", 400);
  }
  const itemIds = input.lines.map((line) => line.itemId).filter((id): id is number => Boolean(id));
  if (itemIds.length > 0) {
    const activeItems = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.organizationId, actor.organizationId), eq(inventoryItems.status, "active"), inArray(inventoryItems.id, itemIds))).for("share");
    if (new Set(activeItems.map((row) => row.id)).size !== new Set(itemIds).size) {
      throw new SourcingError("RFQ_ITEM_NOT_ACTIVE", "One or more RFQ items are missing, inactive, or belong to another organization.", 409);
    }
  }

  const reportingCurrencyCode = normalizeCurrency(input.reportingCurrencyCode);
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
    const eventLines=input.lines.map((line, index) => ({
      organizationId: actor.organizationId,
      eventId: event.id,
      lineNumber: index + 1,
      ...line,
      targetCurrencyCode: line.targetCurrencyCode ? normalizeCurrency(line.targetCurrencyCode) : reportingCurrencyCode,
    }));
    for(let i=0;i<eventLines.length;i+=500) await tx.insert(sourcingEventLines).values(eventLines.slice(i,i+500));
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
  const key = idempotencyKey.trim(), org = actor.organizationId;
  if (!key || key.length > 256) throw new SourcingError("IDEMPOTENCY_KEY_INVALID", "Provide a stable Idempotency-Key of at most 256 characters.", 400);
  if (!input.lines.length || input.lines.length > 5000) throw new SourcingError("AWARD_LINES_UNAVAILABLE", "An award must contain between 1 and 5,000 lines.", 400);
  const lines = input.lines.slice().sort((a,b)=>a.eventLineId-b.eventLineId||a.quoteLineId-b.quoteLineId);
  const commandHash = createHash("sha256").update(JSON.stringify([
    eventId, input.justification, input.overrideReason ?? null, lines.map(line=>[line.eventLineId,line.quoteLineId,line.awardedQuantity]),
  ])).digest("hex");
  return withSourcingCommand(async (client, tx) => {
  const [event] = await tx.select().from(sourcingEvents)
    .where(and(eq(sourcingEvents.id,eventId),eq(sourcingEvents.organizationId,org))).for("update");
  if (!event) throw new SourcingError("SOURCING_EVENT_NOT_FOUND", "Sourcing event was not found.", 404);
  const [replay] = await tx.select().from(workflowIdempotency).where(and(
    eq(workflowIdempotency.organizationId,org),eq(workflowIdempotency.idempotencyKey,key)));
  if (replay) {
    const [award] = replay.action==="RFQ_AWARD_SUBMIT" && replay.resourceType==="sourcing_award" && replay.resourceId!=null
      ? await tx.select().from(sourcingAwards).where(and(eq(sourcingAwards.organizationId,org),
        eq(sourcingAwards.eventId,eventId),eq(sourcingAwards.id,replay.resourceId)))
      : [];
    if (!award || replay.response?.commandHash!==commandHash) {
      throw new SourcingError("IDEMPOTENCY_KEY_REUSED", "This key belongs to another award request or does not have matching replay evidence.");
    }
    return { duplicate:true, awardId:award.id, status:replay.response.status, award };
  }
  if (event.status !== "EVALUATING") throw new SourcingError("RFQ_NOT_EVALUATING", "An award can only be submitted while the RFQ is being evaluated.");
  const [prior] = await tx.select({id:sourcingAwards.id}).from(sourcingAwards)
    .where(and(eq(sourcingAwards.organizationId,org),eq(sourcingAwards.eventId,eventId),
      inArray(sourcingAwards.status,["SUBMITTED","APPROVED","CONVERTED"]))).limit(1);
  if(prior) throw new SourcingError("RFQ_AWARD_ALREADY_EXISTS","This RFQ already has an award awaiting or past approval. Open that award.");
  const eventLines = await tx.select().from(sourcingEventLines).where(and(eq(sourcingEventLines.organizationId,org),eq(sourcingEventLines.eventId,eventId))).limit(5001).for("share");
  const expected = new Map(eventLines.map(line=>[line.id,line.quantity]));
  if(!expected.size||expected.size>5000) throw new SourcingError("AWARD_LINES_UNAVAILABLE","The RFQ must have between 1 and 5,000 lines.");
  const quoteLineIds = lines.map(line=>line.quoteLineId);
  const quoteLines = await tx.select({line:supplierQuoteLines,quote:supplierQuotes}).from(supplierQuoteLines)
    .innerJoin(supplierQuotes,and(eq(supplierQuotes.id,supplierQuoteLines.quoteId),eq(supplierQuotes.organizationId,org)))
    .where(and(eq(supplierQuoteLines.organizationId,org),inArray(supplierQuoteLines.id,quoteLineIds),
      eq(supplierQuotes.eventId,eventId),eq(supplierQuotes.status,"SUBMITTED"))).for("share");
  if (quoteLines.length !== quoteLineIds.length) throw new SourcingError("AWARD_QUOTE_LINE_INVALID", "One or more award lines are not from submitted quotes for this RFQ.", 400);
  const quoteLineMap = new Map(quoteLines.map((row) => [row.line.id, row]));
  if (lines.some(entry => !expected.has(entry.eventLineId) || quoteLineMap.get(entry.quoteLineId)?.line.eventLineId !== entry.eventLineId)) {
    throw new SourcingError("AWARD_QUOTE_LINE_INVALID", "An awarded quote line must match the RFQ line it was submitted for.", 400);
  }
  const expiredQuote = quoteLines.find(({ quote }) => quote.validityDate && new Date(quote.validityDate).getTime() < Date.now());
  if (expiredQuote && !input.overrideReason?.trim()) {
    throw new SourcingError(
      "AWARD_QUOTE_EXPIRED",
      `Quote ${expiredQuote.quote.quoteNumber} has expired and cannot be awarded without an approved override reason.`,
      409,
      "Request a refreshed quotation or provide a documented exception reason.",
    );
  }
  const totals = new Map<number,number>();
  for (const line of lines) {
    if(!Number.isFinite(line.awardedQuantity)||line.awardedQuantity<=0) throw new SourcingError("AWARD_QUANTITY_INVALID","Award quantities must be positive and finite.",400);
    totals.set(line.eventLineId,(totals.get(line.eventLineId)??0)+line.awardedQuantity);
  }
  for (const line of eventLines) {
    const awarded = totals.get(line.id)??0;
    if (Math.abs(awarded - line.quantity) > 0.0001) throw new SourcingError("AWARD_QUANTITY_INVALID", `Awarded quantity for RFQ line ${line.lineNumber} must equal ${line.quantity}.`, 400);
  }
    const [award] = await tx.insert(sourcingAwards).values({ organizationId: org, eventId, status: "SUBMITTED", recommendedByUserId: actor.userId, justification: input.justification, overrideReason: input.overrideReason, submittedAt: new Date() }).returning();
    const awardLines=lines.map((entry) => {
      const source = quoteLineMap.get(entry.quoteLineId)!;
      return { organizationId:org, awardId:award.id, eventLineId:entry.eventLineId, quoteLineId:entry.quoteLineId, supplierId:source.quote.supplierId,
        awardedQuantity:entry.awardedQuantity, awardedUnitPrice:source.line.unitPrice, currencyCode:source.quote.currencyCode,
        reportingAmount:entry.awardedQuantity*source.line.unitPrice*source.quote.exchangeRateToReporting };
    });
    for(let i=0;i<awardLines.length;i+=500) await tx.insert(sourcingAwardLines).values(awardLines.slice(i,i+500));
    await tx.insert(workflowIdempotency).values({ organizationId:org, idempotencyKey:key, action:"RFQ_AWARD_SUBMIT",resourceType:"sourcing_award",
      resourceId:award.id, response:{awardId:award.id,status:award.status,commandHash} });
    await auditAward(client,actor,"RFQ_AWARD_SUBMITTED",award.id,null,{...award,submittedAt:award.submittedAt?.toISOString(),lines:awardLines},input.justification);
    return {duplicate:false,award};
  });
}

type AwardAction = "RFQ_AWARD_APPROVE" | "RFQ_AWARD_CONVERT";
type SourcingTransaction = Pick<typeof db, "select" | "insert" | "update">;

async function withSourcingCommand<T>(execute:(client:PoolClient,tx:SourcingTransaction)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='10s'");
    const result=await execute(client,drizzle(client));
    await client.query("COMMIT");
    return result;
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    const pgCode=(error as {cause?:{code?:string};code?:string})?.cause?.code??(error as {code?:string})?.code;
    if(["23505","40001","40P01"].includes(pgCode??"")) throw new SourcingError("AWARD_COMMAND_CONFLICT","The sourcing state or retry key changed. Refresh and retry.");
    throw error;
  } finally {client.release();}
}

async function postAwardCommand(actor: SourcingActor, awardId: number, idempotencyKey: string, action: AwardAction,
  post: (state: {
    client: PoolClient; tx: SourcingTransaction; award: typeof sourcingAwards.$inferSelect;
    event: typeof sourcingEvents.$inferSelect;
  }) => Promise<{ response: Record<string, unknown>; result: Record<string, unknown> }>) {
  const key = idempotencyKey.trim(), org = actor.organizationId;
  if (!key || key.length > 256) throw new SourcingError("IDEMPOTENCY_KEY_INVALID", "Provide a stable Idempotency-Key of at most 256 characters.", 400);
  return withSourcingCommand(async (client,tx)=>{
    const [award] = await tx.select().from(sourcingAwards)
      .where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, org))).for("update");
    if (!award) throw new SourcingError("AWARD_NOT_FOUND", "Sourcing award was not found.", 404);
    const [event] = await tx.select().from(sourcingEvents)
      .where(and(eq(sourcingEvents.id, award.eventId), eq(sourcingEvents.organizationId, org))).for("update");
    if (!event) throw new SourcingError("SOURCING_EVENT_NOT_FOUND", "Sourcing event was not found.", 404);
    if (action === "RFQ_AWARD_APPROVE" && (award.recommendedByUserId === actor.userId || event.ownerUserId === actor.userId)) {
      throw new SourcingError("SEGREGATION_OF_DUTIES_VIOLATION", "The event owner or award recommender cannot approve their own award.", 403, "Assign an independent sourcing approver.");
    }
    const [replay] = await tx.select().from(workflowIdempotency).where(and(
      eq(workflowIdempotency.organizationId, org), eq(workflowIdempotency.idempotencyKey, key)));
    if (replay && (replay.action !== action || replay.resourceType !== "sourcing_award" || replay.resourceId !== awardId)) {
      throw new SourcingError("IDEMPOTENCY_KEY_REUSED", "This key already belongs to another action or award.");
    }
    if (replay) return { ...replay.response, duplicate: true };
    const posted = await post({ client, tx, award, event });
    await tx.insert(workflowIdempotency).values({ organizationId: org, idempotencyKey: key, action,
      resourceType: "sourcing_award", resourceId: awardId, response: posted.response });
    return { ...posted.result, duplicate: false };
  });
}

function auditAward(client: PoolClient, actor: SourcingActor, action: string, awardId: number, before: unknown, after: unknown, reason?: string) {
  return appendAuditEventWithClient(client, { organizationId: actor.organizationId, actor: { userId: actor.userId },
    action, resourceType: "sourcing_award", resourceId: awardId, before, after, reason,
    requestId: actor.requestId, ipAddress: actor.ipAddress, userAgent: actor.userAgent });
}

export function approveSourcingAward(actor: SourcingActor, awardId: number, reason: string, idempotencyKey: string) {
  return postAwardCommand(actor, awardId, idempotencyKey, "RFQ_AWARD_APPROVE", async ({ client, tx, award, event }) => {
    if (award.status !== "SUBMITTED" || event.status !== "EVALUATING") {
      throw new SourcingError("AWARD_STATUS_INVALID", "Only a submitted award for an RFQ under evaluation can be approved.");
    }
    const now = new Date();
    const [updated] = await tx.update(sourcingAwards).set({ status: "APPROVED", approvedByUserId: actor.userId, approvedAt: now, updatedAt: now })
      .where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, actor.organizationId))).returning();
    await tx.update(sourcingEvents).set({ status: "AWARDED", updatedAt: now, version: event.version + 1 })
      .where(and(eq(sourcingEvents.id, event.id), eq(sourcingEvents.organizationId, actor.organizationId)));
    await auditAward(client, actor, "RFQ_AWARD_APPROVED", awardId, award, { ...updated, approvedAt: now.toISOString() }, reason);
    return { response: { awardId, status: updated.status }, result: { award: updated } };
  });
}

export function convertAwardToPurchaseOrders(actor: SourcingActor, awardId: number, idempotencyKey: string) {
  const org = actor.organizationId;
  return postAwardCommand(actor, awardId, idempotencyKey, "RFQ_AWARD_CONVERT", async ({ client, tx, award, event }) => {
    if (award.status !== "APPROVED" || event.status !== "AWARDED" || !award.approvedByUserId || !award.approvedAt
      || award.approvedByUserId === award.recommendedByUserId || award.approvedByUserId === event.ownerUserId) {
      throw new SourcingError("AWARD_NOT_APPROVED", "An independently approved award is required before PO conversion.");
    }
    const proof = await client.query(`SELECT id FROM audit_logs WHERE organization_id=$1 AND resource_type='sourcing_award'
      AND resource_id=$2 AND action='RFQ_AWARD_APPROVED' AND event_hash IS NOT NULL AND user_id=$3
      AND details #>> '{before,status}'='SUBMITTED' AND details #>> '{after,status}'='APPROVED'
      AND details #>> '{after,id}'=$2::int::text AND details #>> '{after,eventId}'=$4::int::text
      AND details #>> '{after,version}'=$5::int::text
      AND (details #>> '{after,approvedAt}'=$6 OR details #> '{after,approvedAt}'='{}'::jsonb)
      AND details #>> '{after,overrideReason}' IS NOT DISTINCT FROM $7::text
      ORDER BY id DESC LIMIT 1`, [org, awardId, award.approvedByUserId, event.id, award.version, award.approvedAt.toISOString(), award.overrideReason]);
    if (!proof.rowCount) {
      throw new SourcingError("AWARD_APPROVAL_EVIDENCE_REQUIRED", "The saved independent approval could not be verified. Ask a sourcing approver to review the award.");
    }
    const requisition = event.requisitionId == null ? null : await lockConversionRequisition(tx, org, event.requisitionId);
    if (event.requisitionId != null && !requisition) throw new SourcingError("AWARD_REQUISITION_UNAVAILABLE", "The linked requisition is unavailable.", 404);
    if (requisition && !["APPROVED", "CONVERTED_TO_RFQ"].includes(requisition.status.toUpperCase())) {
      throw new SourcingError("AWARD_REQUISITION_NOT_CONVERTIBLE", "The linked requisition is no longer available for PO conversion.");
    }
    if (requisition) {
      const [existing] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.organizationId, org), eq(purchaseOrders.requisitionId, requisition.id))).limit(1);
      if (existing) throw new SourcingError("AWARD_REQUISITION_NOT_CONVERTIBLE", "A purchase order already exists for the linked requisition.");
    }
    const rows = await tx.select({ awardLine: sourcingAwardLines, quoteLine: supplierQuoteLines, eventLine: sourcingEventLines,
      quote: { currencyCode: supplierQuotes.currencyCode, status: supplierQuotes.status },
      item: { id: inventoryItems.id, status: inventoryItems.status } }).from(sourcingAwardLines)
      .leftJoin(supplierQuoteLines, and(eq(supplierQuoteLines.id, sourcingAwardLines.quoteLineId), eq(supplierQuoteLines.organizationId, org),
        eq(supplierQuoteLines.eventLineId, sourcingAwardLines.eventLineId)))
      .leftJoin(supplierQuotes, and(eq(supplierQuotes.id, supplierQuoteLines.quoteId), eq(supplierQuotes.organizationId, org),
        eq(supplierQuotes.eventId, event.id), eq(supplierQuotes.supplierId, sourcingAwardLines.supplierId)))
      .leftJoin(sourcingEventLines, and(eq(sourcingEventLines.id, sourcingAwardLines.eventLineId),
        eq(sourcingEventLines.organizationId, org), eq(sourcingEventLines.eventId, event.id)))
      .leftJoin(inventoryItems, and(eq(inventoryItems.id, sourcingEventLines.itemId), or(eq(inventoryItems.organizationId, org), isNull(inventoryItems.organizationId))))
      .where(and(eq(sourcingAwardLines.awardId, awardId), eq(sourcingAwardLines.organizationId, org)))
      .orderBy(asc(sourcingAwardLines.id)).limit(5001).for("share", { of: sourcingAwardLines });
    if (!rows.length || rows.length > 5000) throw new SourcingError("AWARD_LINES_UNAVAILABLE", "The award must have between 1 and 5,000 conversion lines.");
    const groups = new Map<number, { currency: string; lines: Array<typeof purchaseOrderItems.$inferInsert> }>();
    for (const { awardLine, quote, quoteLine, eventLine, item } of rows) {
      if (!eventLine || !quote?.currencyCode || !quoteLine || quote.status !== "SUBMITTED"
        || awardLine.currencyCode !== quote.currencyCode || awardLine.awardedUnitPrice !== quoteLine.unitPrice) {
        throw new SourcingError("AWARD_SOURCE_UNAVAILABLE", "An awarded line no longer matches its submitted supplier quotation and RFQ.");
      }
      if (!item?.id || String(item.status).toLowerCase() !== "active") {
        throw new SourcingError("AWARD_ITEM_MAPPING_REQUIRED", "Every awarded RFQ line must map to an available active catalogue or approved once-off item.", 409, "Complete item stewardship in Master Data, then retry conversion.");
      }
      const quantity = awardLine.awardedQuantity, unitPrice = awardLine.awardedUnitPrice;
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
        throw new SourcingError("AWARD_QUANTITY_NOT_PO_COMPATIBLE", "PO conversion requires positive whole-number awarded quantities.");
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new SourcingError("AWARD_PRICE_INVALID", "An awarded line has an invalid price.");
      const group = groups.get(awardLine.supplierId) ?? { currency: quote.currencyCode, lines: [] };
      if (group.currency !== quote.currencyCode) throw new SourcingError("AWARD_MIXED_SUPPLIER_CURRENCY", "A supplier's award lines must use one currency for PO conversion.");
      group.lines.push({ orderId: 0, lineNumber: group.lines.length + 1, itemId: item.id, quantity, unitPrice,
        totalPrice: quantity * unitPrice, unitOfMeasureId: eventLine.unitOfMeasureId, taxCodeId: eventLine.taxCodeId,
        costCentreId: eventLine.costCentreId, glAccountCode: eventLine.glAccountCode, notes: `Sourcing award line ${awardLine.id}` });
      groups.set(awardLine.supplierId, group);
    }
    if (requisition && groups.size > 1) {
      const reserved = await client.query(`SELECT id FROM budget_commitments WHERE organization_id=$1 AND source_type='REQUISITION'
        AND source_id=$2 AND status='ACTIVE' FOR UPDATE`, [org, requisition.id]);
      if (reserved.rowCount) throw new SourcingError("AWARD_BUDGET_SPLIT_REVIEW_REQUIRED", "This split award has an active requisition budget reservation. Finance must review the allocation before conversion.");
    }
    const orders = [];
    for (const [supplierId, group] of [...groups].sort(([left], [right]) => left - right)) {
      const prepared = await applySupplierDefaultsToPurchaseOrder({
        organizationId: org, orderNumber: `PO-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
        supplierId, requisitionId: requisition?.id ?? null, departmentId: requisition?.departmentId ?? null,
        projectId: requisition?.projectId ?? null, currencyCode: group.currency, status: "DRAFT", approvalStatus: "DRAFT",
        createdByUserId: actor.userId, sourcingAwardId: awardId, totalAmount: group.lines.reduce((sum, line) => sum + line.totalPrice, 0),
        notes: `Created from approved sourcing award ${awardId} (${event.eventNumber}).`,
      }, { database: tx });
      const [order] = await tx.insert(purchaseOrders).values(prepared).returning();
      for (let i = 0; i < group.lines.length; i += 500) {
        await tx.insert(purchaseOrderItems).values(group.lines.slice(i, i + 500).map(line => ({ ...line, orderId: order.id })));
      }
      orders.push(order);
    }
    const now = new Date();
    const budgetTransfer = requisition && orders.length === 1 ? await transferRequisitionBudget(client, org, requisition.id, orders[0].id) : null;
    if (requisition) await tx.update(purchaseRequisitions).set({ status: "CONVERTED_TO_PO", updatedAt: now })
      .where(and(eq(purchaseRequisitions.organizationId, org), eq(purchaseRequisitions.id, requisition.id)));
    await tx.update(sourcingAwards).set({ status: "CONVERTED", convertedPurchaseOrderId: orders[0].id, updatedAt: now })
      .where(and(eq(sourcingAwards.id, awardId), eq(sourcingAwards.organizationId, org)));
    const purchaseOrderIds = orders.map(order => order.id);
    if (requisition) await bindPurchaseOrderBudgetProvenance(client, org, requisition.id, purchaseOrderIds, "sourcing_award");
    await auditAward(client, actor, "RFQ_AWARD_CONVERTED_TO_PO", awardId, award,
      { purchaseOrderIds, requisitionId: requisition?.id ?? null, approvalAuditId: String(proof.rows[0].id), budgetTransfer });
    return { response: { awardId, purchaseOrderIds }, result: { purchaseOrders: orders } };
  });
}

export async function addSourcingClarification(actor: SourcingActor, eventId: number, input: { supplierId?: number | null; subject: string; message: string; visibility: "PRIVATE" | "ALL_INVITED"; parentId?: number | null }, supplierPortal = false) {
  return withSourcingCommand(async (client,tx)=>{
    // Share the same event lock as withdrawal, so a draft cannot gain activity after the withdrawal checks it.
    const [event]=await tx.select().from(sourcingEvents)
      .where(and(eq(sourcingEvents.organizationId,actor.organizationId),eq(sourcingEvents.id,eventId))).for("update");
    if(!event) throw new SourcingError("SOURCING_EVENT_NOT_FOUND","Sourcing event was not found.",404);
    if(["CANCELLED","ARCHIVED","AWARDED"].includes(event.status)||(supplierPortal&&event.status==="DRAFT"))
      throw new SourcingError("RFQ_CLARIFICATION_CLOSED","Clarifications are closed for this RFQ.");
    const [clarification]=await tx.insert(sourcingClarifications).values({organizationId:actor.organizationId,eventId,
      supplierId:input.supplierId,createdByUserId:actor.userId,subject:input.subject,message:input.message,visibility:input.visibility,parentId:input.parentId}).returning();
    await appendAuditEventWithClient(client,{organizationId:actor.organizationId,actor:{userId:actor.userId},action:"RFQ_CLARIFICATION_ADDED",
      resourceType:"sourcing_event",resourceId:eventId,after:clarification,requestId:actor.requestId,ipAddress:actor.ipAddress,userAgent:actor.userAgent});
    return clarification;
  });
}
