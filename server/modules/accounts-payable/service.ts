import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { storage } from "../../storage";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { getApprovalSuggestions } from "../../approval-suggestions";
import { enforceApprovalPolicy } from "./ap-approval-policy";
import { writeApAuditLog, type ApAuditAction } from "./ap-audit-log";
import { resolveSupplierCommercialDefaults } from "../procurement/supplier-defaults";
import {
  assertBatchReleaseApproverSeparation,
  assertNotSelfBatchApproval,
  assertNotSelfInvoiceApproval,
} from "./ap-segregation-controls";
import { assertInvoiceTransition, assertPaymentBatchTransition } from "./ap-state-machine";
import {
  apInvoiceCaptures,
  apInvoiceMatchResults,
  apPaymentBatchItems,
  apPaymentBatches,
  apReceiptItems,
  apReceipts,
  approvalHistory,
  invoices,
  invoiceItems,
  inventoryItems,
  paymentTerms,
  paymentMethodEnum,
  payments,
  purchaseOrders,
  purchaseOrderItems,
  stockMovements,
  warehouseInventory,
  type InsertApInvoiceCapture,
  type InsertApPaymentBatch,
  type InsertApReceipt,
  type InsertApReceiptItem,
  type InsertInvoice,
  type InsertInvoiceItem,
  type InsertPayment,
  type Payment,
} from "@shared/schema";

type ApprovalActionContext = {
  actorRole: string;
  overrideExplicit?: boolean;
  overrideReason?: string;
  comment?: string;
};

type InvoiceFilters = {
  customerId?: number;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  overdue?: boolean;
  dueInDays?: number;
};

type MatchOptions = {
  priceTolerancePct?: number;
  quantityTolerancePct?: number;
  taxTolerancePct?: number;
};

/** Same defaults as the AP workbench "Match" action — used when submitting for approval without a prior match row. */
const DEFAULT_MATCH_ON_SUBMIT_APPROVAL: MatchOptions = {
  priceTolerancePct: 2,
  quantityTolerancePct: 2,
  taxTolerancePct: 0,
};

function toDateOrUndefined(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPct(value: unknown): number {
  const parsed = toNumber(value, 0);
  return parsed < 0 ? 0 : parsed;
}

function buildDuplicateCheckKey(input: {
  supplierId?: number | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  issueDate?: Date | string | null;
}): string {
  const issueDate = toDateOrUndefined(input.issueDate)?.toISOString().slice(0, 10) ?? "unknown-date";
  return [
    String(input.supplierId ?? "unknown-supplier"),
    String(input.invoiceNumber ?? "unknown-invoice").trim().toUpperCase(),
    toNumber(input.totalAmount, 0).toFixed(2),
    issueDate,
  ].join("|");
}

async function invoiceNumberExistsForSupplier(input: {
  orgId: number;
  supplierId: number;
  invoiceNumber: string;
  excludeInvoiceId?: number;
}): Promise<boolean> {
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, input.orgId),
        eq(invoices.supplierId, input.supplierId),
        eq(invoices.invoiceNumber, input.invoiceNumber),
      ),
    );
  return rows.some((row) => row.id !== input.excludeInvoiceId);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function getPaymentTermNetDays(paymentTermsId: number | null | undefined): Promise<number | null> {
  if (!paymentTermsId || !Number.isFinite(Number(paymentTermsId))) return null;
  const rows = await db
    .select({ netDays: paymentTerms.netDays })
    .from(paymentTerms)
    .where(eq(paymentTerms.id, Number(paymentTermsId)))
    .limit(1);
  return rows[0]?.netDays ?? null;
}

function normalizeDateOnly(value: Date | null | undefined): string {
  if (!value) return "unknown-date";
  return new Date(value).toISOString().slice(0, 10);
}

async function getLatestMatchResult(invoiceId: number, orgId: number) {
  const rows = await db
    .select()
    .from(apInvoiceMatchResults)
    .where(and(eq(apInvoiceMatchResults.organizationId, orgId), eq(apInvoiceMatchResults.invoiceId, invoiceId)))
    .orderBy(desc(apInvoiceMatchResults.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function createApprovalHistoryEntry(input: {
  organizationId: number;
  entityType: "invoice" | "payment_batch";
  entityId: number;
  action: string;
  performedBy: number;
  previousStatus?: string | null;
  newStatus?: string | null;
  comment?: string | null;
}) {
  await db.insert(approvalHistory).values({
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    performedBy: input.performedBy,
    previousStatus: input.previousStatus ?? null,
    newStatus: input.newStatus ?? null,
    comment: input.comment ?? null,
  });
}

async function emitApDomainEvent(input: {
  organizationId: number;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  await db.execute(sql`
    INSERT INTO event_outbox (organization_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (${input.organizationId}, ${input.aggregateType}, ${input.aggregateId}, ${input.eventType}, 1, ${JSON.stringify(input.payload)}::jsonb)
  `);
}

async function postInvoiceApprovedSubledger(input: {
  organizationId: number;
  invoiceId: number;
  invoiceNumber: string;
  supplierId: number | null;
  amount: number;
  currency: string;
}) {
  const amount = Number(input.amount.toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) return;
  const sourceId = String(input.invoiceId);
  const eventRows = await db.execute(sql`
    INSERT INTO subledger_events (organization_id, source_type, source_id, event_type, currency, amount, payload)
    VALUES (
      ${input.organizationId},
      'invoice',
      ${sourceId},
      'invoice_approved',
      ${input.currency},
      ${amount},
      ${JSON.stringify({ invoiceId: input.invoiceId, invoiceNumber: input.invoiceNumber, supplierId: input.supplierId })}::jsonb
    )
    ON CONFLICT (organization_id, source_type, source_id, event_type)
    DO UPDATE SET event_time = subledger_events.event_time
    RETURNING id
  `);
  const subledgerEventId = Number((eventRows.rows[0] as { id?: unknown } | undefined)?.id);
  if (!Number.isFinite(subledgerEventId)) return;
  const batchKey = `AP-INV-${input.invoiceId}`;
  const batchRows = await db.execute(sql`
    INSERT INTO journal_batches (organization_id, batch_key, status)
    VALUES (${input.organizationId}, ${batchKey}, 'posted')
    ON CONFLICT (organization_id, batch_key)
    DO UPDATE SET status = journal_batches.status
    RETURNING id
  `);
  const batchId = Number((batchRows.rows[0] as { id?: unknown } | undefined)?.id);
  if (!Number.isFinite(batchId)) return;
  const existingEntry = await db.execute(sql`
    SELECT id FROM journal_entries
    WHERE organization_id = ${input.organizationId}
      AND subledger_event_id = ${subledgerEventId}
    LIMIT 1
  `);
  if (existingEntry.rows.length > 0) return;
  const entryRows = await db.execute(sql`
    INSERT INTO journal_entries (organization_id, batch_id, subledger_event_id, entry_number, description)
    VALUES (${input.organizationId}, ${batchId}, ${subledgerEventId}, ${`JE-AP-${input.invoiceId}`}, ${`AP invoice approved: ${input.invoiceNumber}`})
    RETURNING id
  `);
  const entryId = Number((entryRows.rows[0] as { id?: unknown } | undefined)?.id);
  if (!Number.isFinite(entryId)) return;
  await db.execute(sql`
    INSERT INTO journal_lines (journal_entry_id, line_no, account_code, dr_amount, cr_amount)
    VALUES
      (${entryId}, 1, 'AP_EXPENSE_CLEARING', ${amount}, 0),
      (${entryId}, 2, 'ACCOUNTS_PAYABLE', 0, ${amount})
  `);
}

export async function listInvoices(filters: InvoiceFilters = {}) {
  if (filters.overdue) return storage.getOverdueInvoices();
  if (filters.dueInDays != null) return storage.getInvoiceDueInDays(filters.dueInDays);
  if (filters.customerId != null) return storage.getInvoicesByCustomerId(filters.customerId);
  if (filters.status) return storage.getInvoicesByStatus(filters.status);
  if (filters.fromDate && filters.toDate) return storage.getInvoicesByDateRange(filters.fromDate, filters.toDate);
  return storage.getAllInvoices();
}

export async function getInvoiceDetail(invoiceId: number) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return undefined;

  const [items, invoicePayments, latestMatchRows] = await Promise.all([
    storage.getInvoiceItems(invoiceId),
    storage.getPaymentsByInvoiceId(invoiceId),
    db
      .select()
      .from(apInvoiceMatchResults)
      .where(
        and(
          eq(apInvoiceMatchResults.invoiceId, invoiceId),
          eq(apInvoiceMatchResults.organizationId, getActiveOrganizationId()),
        ),
      )
      .orderBy(desc(apInvoiceMatchResults.createdAt)),
  ]);

  return {
    ...invoice,
    items,
    payments: invoicePayments,
    latestMatchResult: latestMatchRows[0] ?? null,
  };
}

export async function createInvoiceRecord(invoiceData: Record<string, unknown>, userId: number) {
  const orgId = getActiveOrganizationId();
  const items = Array.isArray(invoiceData.items) ? (invoiceData.items as InsertInvoiceItem[]) : [];
  const supplierId = toNumber(invoiceData.supplierId, 0);
  if (!supplierId) {
    throw new Error("Supplier is required");
  }

  const supplier = await storage.getSupplier(supplierId);
  if (!supplier) {
    throw new Error("Supplier does not exist");
  }
  const supplierCommercialDefaults = await resolveSupplierCommercialDefaults(supplierId, {
    transactionLabel: "new AP invoices",
  });

  const purchaseOrderId = invoiceData.purchaseOrderId == null ? null : toNumber(invoiceData.purchaseOrderId, 0);
  let purchaseOrder: Awaited<ReturnType<typeof storage.getPurchaseOrder>> | null = null;
  if (purchaseOrderId) {
    purchaseOrder = (await storage.getPurchaseOrder(purchaseOrderId)) ?? null;
    if (!purchaseOrder) throw new Error("Purchase order does not exist");
    if (Number(purchaseOrder.supplierId) !== supplierId) {
      throw new Error("Invoice supplier must match purchase order supplier");
    }
  }

  for (let i = 0; i < items.length; i += 1) {
    const line = items[i];
    if (toNumber(line.quantity) <= 0 || toNumber(line.unitPrice) <= 0) {
      throw new Error(`Invoice item ${i + 1} must have positive quantity and unit price`);
    }
    if (!toNumber(line.itemId, 0)) {
      throw new Error(`Invoice item ${i + 1} must include a valid itemId`);
    }
  }

  const poDefaults = purchaseOrder as { paymentTermsId?: number | null; currencyCode?: string | null } | null;
  const explicitPaymentTermsId = invoiceData.paymentTermsId == null ? null : toNumber(invoiceData.paymentTermsId, 0);
  const paymentTermsId =
    explicitPaymentTermsId || poDefaults?.paymentTermsId || supplierCommercialDefaults?.paymentTermsId || null;
  const supplierDefaultCurrencyCode =
    supplierCommercialDefaults?.contractCurrencyCode ?? supplierCommercialDefaults?.supplierCurrencyCode ?? null;
  const explicitCurrency =
    typeof invoiceData.currencyCode === "string" && invoiceData.currencyCode.trim()
      ? invoiceData.currencyCode.trim().toUpperCase()
      : null;
  const currencyCode = explicitCurrency || poDefaults?.currencyCode || supplierDefaultCurrencyCode;
  const issueDate = toDateOrUndefined(invoiceData.issueDate) ?? new Date();
  const paymentTermNetDays = await getPaymentTermNetDays(paymentTermsId);
  const dueDate =
    toDateOrUndefined(invoiceData.dueDate) ??
    addDays(issueDate, paymentTermNetDays ?? 30);
  const total = toNumber(invoiceData.total ?? invoiceData.totalAmount, 0);
  const subtotal = toNumber(invoiceData.subtotal, total);
  const tax = toNumber(invoiceData.tax ?? invoiceData.totalTax, 0);
  const discount = toNumber(invoiceData.discount, 0);

  const invoiceNumber =
    typeof invoiceData.invoiceNumber === "string" && invoiceData.invoiceNumber.trim()
      ? invoiceData.invoiceNumber.trim()
      : `INV-${Date.now().toString().slice(-8)}`;
  if (await invoiceNumberExistsForSupplier({ orgId, supplierId, invoiceNumber })) {
    throw new Error("Duplicate supplier invoice number detected for this supplier.");
  }

  const created = await storage.createInvoice(
    {
      invoiceNumber,
      supplierId,
      customerId: invoiceData.customerId == null ? null : toNumber(invoiceData.customerId, 0),
      purchaseOrderId: purchaseOrderId || null,
      paymentTermsId,
      currencyCode,
      issueDate,
      dueDate,
      status: String(invoiceData.status ?? "DRAFT") as InsertInvoice["status"],
      subtotal,
      tax,
      discount,
      total,
      dueAmount: toNumber(invoiceData.dueAmount, total),
      paidAmount: toNumber(invoiceData.paidAmount, 0),
      notes: typeof invoiceData.notes === "string" ? invoiceData.notes : null,
      termsAndConditions:
        typeof invoiceData.termsAndConditions === "string" ? invoiceData.termsAndConditions : null,
      createdBy: userId,
    },
    items,
  );

  await storage.createActivityLog({
    action: "AP_INVOICE_CREATED",
    description: `Invoice ${created.invoiceNumber} created in AP workflow`,
    referenceType: "invoice",
    referenceId: created.id,
    userId,
  }).catch(() => {});

  if (purchaseOrderId) {
    await evaluateInvoiceMatch(created.id, { priceTolerancePct: 0, quantityTolerancePct: 0, taxTolerancePct: 0 }, userId)
      .catch((error) => {
        console.warn("Initial AP match case creation failed:", error);
      });
  }

  return created;
}

export async function updateInvoiceRecord(
  invoiceId: number,
  patch: Record<string, unknown>,
  userId: number,
) {
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return undefined;

  const nextIssueDate = toDateOrUndefined(patch.issueDate);
  const nextDueDate = toDateOrUndefined(patch.dueDate);
  const updated = await storage.updateInvoice(invoiceId, {
    ...patch,
    issueDate: nextIssueDate ?? undefined,
    dueDate: nextDueDate ?? undefined,
  });

  if (updated) {
    await storage.createActivityLog({
      action: "AP_INVOICE_UPDATED",
      description: `Invoice ${updated.invoiceNumber} updated in AP workflow`,
      referenceType: "invoice",
      referenceId: updated.id,
      userId,
    }).catch(() => {});
  }

  return updated;
}

export async function deleteInvoiceRecord(invoiceId: number) {
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return false;
  if (existing.status === "PAID" || existing.status === "PARTIALLY_PAID") {
    throw new Error("Cannot delete a paid invoice. Consider cancelling it instead.");
  }
  return storage.deleteInvoice(invoiceId);
}

export async function updateInvoiceStatus(
  invoiceId: number,
  status: NonNullable<InsertInvoice["status"]>,
  userId: number,
  comment?: string,
) {
  const orgId = getActiveOrganizationId();
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return undefined;
  assertInvoiceTransition(String(existing.status), String(status));
  const updated = await storage.updateInvoice(invoiceId, { status });
  if (!updated) return undefined;

  await createApprovalHistoryEntry({
    organizationId: orgId,
    entityType: "invoice",
    entityId: invoiceId,
    action: String(status).toLowerCase(),
    performedBy: userId,
    previousStatus: existing.status,
    newStatus: status,
    comment,
  }).catch(() => {});

  const prior = String(existing.status);
  const next = String(status);
  let auditAction: ApAuditAction = "AP_INVOICE_SUBMITTED";
  if (next === "APPROVED") auditAction = "AP_INVOICE_APPROVED";
  else if (next === "DISPUTED") auditAction = "AP_INVOICE_REJECTED";
  else if (prior === "PENDING_APPROVAL" && next === "DRAFT") auditAction = "AP_INVOICE_WITHDRAWN_FROM_APPROVAL";

  await writeApAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    action: auditAction,
    entityType: "invoice",
    entityId: invoiceId,
    priorState: existing.status,
    nextState: status,
    reason: comment,
  }).catch(() => {});

  return updated;
}

export async function withdrawInvoiceFromApproval(
  invoiceId: number,
  userId: number,
  comment?: string,
) {
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return undefined;
  if (String(existing.status) !== "PENDING_APPROVAL") {
    throw new Error(`Invoice must be PENDING_APPROVAL before withdraw; current status is ${existing.status}.`);
  }
  return updateInvoiceStatus(invoiceId, "DRAFT", userId, comment);
}

export async function submitInvoiceForApproval(invoiceId: number, userId: number) {
  const orgId = getActiveOrganizationId();
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return undefined;
  assertInvoiceTransition(String(invoice.status), "PENDING_APPROVAL");
  let latestMatch = await getLatestMatchResult(invoiceId, orgId);
  if (!latestMatch) {
    await evaluateInvoiceMatch(invoiceId, DEFAULT_MATCH_ON_SUBMIT_APPROVAL, userId);
    latestMatch = await getLatestMatchResult(invoiceId, orgId);
  }
  if (!latestMatch) {
    throw new Error("Invoice must be matched before submission for approval.");
  }
  if (latestMatch.status === "EXCEPTION") {
    throw new Error("Invoice has unresolved matching exceptions and cannot be submitted.");
  }
  const updated = await storage.updateInvoice(invoiceId, { status: "PENDING_APPROVAL" });
  if (!updated) return undefined;

  await createApprovalHistoryEntry({
    organizationId: orgId,
    entityType: "invoice",
    entityId: invoiceId,
    action: "submitted",
    performedBy: userId,
    previousStatus: invoice.status,
    newStatus: "PENDING_APPROVAL",
  }).catch(() => {});

  await writeApAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    action: "AP_INVOICE_SUBMITTED",
    entityType: "invoice",
    entityId: invoiceId,
    priorState: invoice.status,
    nextState: "PENDING_APPROVAL",
  }).catch(() => {});

  await emitNotificationToRoles(["manager", "admin"], {
    type: "ap_invoice_pending_approval",
    title: `Invoice ${invoice.invoiceNumber} ready for approval`,
    body: `Invoice ${invoice.invoiceNumber} is awaiting AP approval.`,
    entityType: "invoice",
    entityId: invoiceId,
  }).catch(() => {});

  return updated;
}

export async function approveInvoice(
  invoiceId: number,
  userId: number,
  comment?: string,
  context: ApprovalActionContext = { actorRole: "" },
) {
  const orgId = getActiveOrganizationId();
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return undefined;
  if (String(existing.status) !== "PENDING_APPROVAL") {
    throw new Error(`Invoice must be PENDING_APPROVAL before approval; current status is ${existing.status}.`);
  }
  assertNotSelfInvoiceApproval({
    actorUserId: userId,
    actorRole: context.actorRole,
    invoiceCreatedBy: existing.createdBy,
    overrideExplicit: context.overrideExplicit,
    overrideReason: context.overrideReason,
  });
  await enforceApprovalPolicy({
    organizationId: orgId,
    entityType: "invoice",
    amount: toNumber(existing.total ?? 0),
    actorUserId: userId,
    actorRole: context.actorRole,
  });
  const updated = await updateInvoiceStatus(invoiceId, "APPROVED", userId, comment ?? context.overrideReason);
  if (updated) {
    await emitApDomainEvent({
      organizationId: orgId,
      aggregateType: "invoice",
      aggregateId: String(updated.id),
      eventType: "ap_invoice.approved",
      payload: {
        invoiceId: updated.id,
        invoiceNumber: updated.invoiceNumber,
        supplierId: updated.supplierId,
        amount: updated.total,
        approvedBy: userId,
      },
    }).catch(() => {});
    await postInvoiceApprovedSubledger({
      organizationId: orgId,
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
      supplierId: updated.supplierId ?? null,
      amount: toNumber(updated.total, 0),
      currency: "ZAR",
    }).catch((error) => {
      console.warn("AP invoice subledger posting failed:", error);
    });
    await emitNotificationToRoles(["manager", "admin"], {
      type: "ap_invoice_approved",
      title: `Invoice ${updated.invoiceNumber} approved`,
      body: `Invoice ${updated.invoiceNumber} is now ready for payment batching.`,
      entityType: "invoice",
      entityId: invoiceId,
    }).catch(() => {});
  }
  return updated;
}

export async function rejectInvoice(
  invoiceId: number,
  userId: number,
  comment?: string,
  context: ApprovalActionContext = { actorRole: "" },
) {
  const orgId = getActiveOrganizationId();
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return undefined;
  if (String(existing.status) !== "PENDING_APPROVAL") {
    throw new Error(`Invoice must be PENDING_APPROVAL before rejection; current status is ${existing.status}.`);
  }
  await enforceApprovalPolicy({
    organizationId: orgId,
    entityType: "invoice",
    amount: toNumber(existing.total ?? 0),
    actorUserId: userId,
    actorRole: context.actorRole,
  });
  return updateInvoiceStatus(invoiceId, "DISPUTED", userId, comment ?? context.overrideReason);
}

export async function listApprovalQueue() {
  const orgId = getActiveOrganizationId();
  const [invoiceQueue, batchQueue] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, "PENDING_APPROVAL")))
      .orderBy(desc(invoices.updatedAt)),
    db
      .select()
      .from(apPaymentBatches)
      .where(
        and(
          eq(apPaymentBatches.organizationId, orgId),
          eq(apPaymentBatches.status, "PENDING_APPROVAL"),
        ),
      )
      .orderBy(desc(apPaymentBatches.updatedAt)),
  ]);

  return { invoices: invoiceQueue, paymentBatches: batchQueue };
}

export async function listInvoiceItems(invoiceId: number) {
  return storage.getInvoiceItems(invoiceId);
}

export async function addInvoiceItemRecord(item: InsertInvoiceItem) {
  return storage.addInvoiceItem(item);
}

export async function updateInvoiceItemRecord(itemId: number, patch: Partial<InsertInvoiceItem>) {
  return storage.updateInvoiceItem(itemId, patch);
}

export async function deleteInvoiceItemRecord(itemId: number) {
  return storage.deleteInvoiceItem(itemId);
}

export async function listPayments(invoiceId?: number) {
  return invoiceId != null ? storage.getPaymentsByInvoiceId(invoiceId) : storage.getAllPayments();
}

export async function createPaymentRecord(payment: InsertPayment) {
  return storage.createPayment(payment);
}

export async function updatePaymentRecord(id: number, patch: Partial<InsertPayment>) {
  return storage.updatePayment(id, patch);
}

export async function deletePaymentRecord(id: number) {
  return storage.deletePayment(id);
}

export async function listCaptures(status?: string) {
  const orgId = getActiveOrganizationId();
  if (!status) {
    return db
      .select()
      .from(apInvoiceCaptures)
      .where(eq(apInvoiceCaptures.organizationId, orgId))
      .orderBy(desc(apInvoiceCaptures.updatedAt));
  }

  return db
    .select()
    .from(apInvoiceCaptures)
    .where(
      and(
        eq(apInvoiceCaptures.organizationId, orgId),
        eq(apInvoiceCaptures.status, status as any),
      ),
    )
    .orderBy(desc(apInvoiceCaptures.updatedAt));
}

export async function createCapture(input: InsertApInvoiceCapture, userId: number) {
  const orgId = getActiveOrganizationId();
  const supplierCommercialDefaults = await resolveSupplierCommercialDefaults(input.supplierId, {
    transactionLabel: "new AP captures",
  });
  const supplierDefaultCurrencyCode =
    supplierCommercialDefaults?.contractCurrencyCode ?? supplierCommercialDefaults?.supplierCurrencyCode ?? null;
  const issueDate = input.issueDate ?? null;
  const paymentTermNetDays = await getPaymentTermNetDays(supplierCommercialDefaults?.paymentTermsId ?? null);
  const defaultDueDate = issueDate && paymentTermNetDays != null ? addDays(new Date(issueDate), paymentTermNetDays) : null;
  const duplicateCheckKey = buildDuplicateCheckKey({
    supplierId: input.supplierId ?? null,
    invoiceNumber: input.invoiceNumber ?? null,
    totalAmount: input.totalAmount ?? null,
    issueDate: input.issueDate ?? null,
  });

  const duplicateInvoice =
    input.supplierId && input.invoiceNumber
      ? await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, orgId),
              eq(invoices.supplierId, Number(input.supplierId)),
              eq(invoices.invoiceNumber, String(input.invoiceNumber)),
            ),
          )
      : [];

  const activeCaptureDupes =
    input.supplierId && input.invoiceNumber
      ? await db
          .select({ id: apInvoiceCaptures.id })
          .from(apInvoiceCaptures)
          .where(
            and(
              eq(apInvoiceCaptures.organizationId, orgId),
              eq(apInvoiceCaptures.supplierId, Number(input.supplierId)),
              eq(apInvoiceCaptures.invoiceNumber, String(input.invoiceNumber)),
              inArray(apInvoiceCaptures.status, ["STAGED", "REVIEW_REQUIRED", "READY_TO_PROMOTE"]),
            ),
          )
      : [];

  const nearDuplicateMatches =
    input.supplierId && input.issueDate
      ? await db
          .select({
            id: apInvoiceCaptures.id,
            issueDate: apInvoiceCaptures.issueDate,
            totalAmount: apInvoiceCaptures.totalAmount,
          })
          .from(apInvoiceCaptures)
          .where(
            and(
              eq(apInvoiceCaptures.organizationId, orgId),
              eq(apInvoiceCaptures.supplierId, Number(input.supplierId)),
              inArray(apInvoiceCaptures.status, ["STAGED", "REVIEW_REQUIRED", "READY_TO_PROMOTE", "PROMOTED"]),
            ),
          )
      : [];

  const warnings = [...(input.warnings ?? [])];
  let duplicateRiskScore = 0;
  if (duplicateInvoice.length > 0) {
    warnings.push("Potential duplicate invoice found in AP ledger.");
    duplicateRiskScore += 100;
  }
  if (activeCaptureDupes.length > 0) {
    warnings.push("Potential duplicate capture already exists in active capture queue.");
    duplicateRiskScore += 90;
  }
  for (const candidate of nearDuplicateMatches) {
    const issueA = normalizeDateOnly(toDateOrUndefined(input.issueDate));
    const issueB = normalizeDateOnly(toDateOrUndefined(candidate.issueDate));
    const dayDelta =
      Math.abs(new Date(`${issueA}T00:00:00.000Z`).getTime() - new Date(`${issueB}T00:00:00.000Z`).getTime()) /
      (24 * 60 * 60 * 1000);
    const amountDelta = Math.abs(toNumber(input.totalAmount, 0) - toNumber(candidate.totalAmount, 0));
    if (dayDelta <= 7 && amountDelta <= 1) {
      duplicateRiskScore = Math.max(duplicateRiskScore, 70);
    }
  }
  if (duplicateRiskScore >= 70) {
    warnings.push("Duplicate risk threshold exceeded; review required before promotion.");
  }

  const readyToPromote = Boolean(input.supplierId && input.invoiceNumber);
  const status =
    duplicateRiskScore >= 70 || !readyToPromote ? "REVIEW_REQUIRED" : input.status ?? "READY_TO_PROMOTE";

  const [created] = await db
    .insert(apInvoiceCaptures)
    .values({
      organizationId: orgId,
      source: input.source ?? "manual_upload",
      status,
      documentId: input.documentId ?? null,
      supplierId: input.supplierId ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      issueDate,
      dueDate: input.dueDate ?? defaultDueDate,
      currencyCode: input.currencyCode ?? supplierDefaultCurrencyCode,
      subtotalAmount: toNumber(input.subtotalAmount, 0),
      taxAmount: toNumber(input.taxAmount, 0),
      totalAmount: toNumber(input.totalAmount, 0),
      confidenceScore: toNumber(input.confidenceScore, 0),
      duplicateCheckKey,
      extractedHeader: input.extractedHeader ?? {},
      extractedLines: input.extractedLines ?? [],
      warnings,
      reviewerNotes: input.reviewerNotes ?? null,
      promotedInvoiceId: null,
      createdBy: userId,
      reviewedBy: null,
    })
    .returning();

  await writeApAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    action: "AP_CAPTURE_CREATED",
    entityType: "capture",
    entityId: created.id,
    nextState: created.status,
    extra: { duplicateRiskScore, warningCount: warnings.length },
  }).catch(() => {});

  return created;
}

export async function promoteCapture(
  captureId: number,
  userId: number,
  options?: { overrideReason?: string },
) {
  const orgId = getActiveOrganizationId();
  const [capture] = await db
    .select()
    .from(apInvoiceCaptures)
    .where(and(eq(apInvoiceCaptures.id, captureId), eq(apInvoiceCaptures.organizationId, orgId)));

  if (!capture) return undefined;
  if (capture.promotedInvoiceId) {
    return storage.getInvoice(capture.promotedInvoiceId);
  }
  if (!capture.supplierId) {
    throw new Error("Capture must be linked to a supplier before promotion.");
  }
  const duplicateLedgerRows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, orgId),
        eq(invoices.supplierId, Number(capture.supplierId)),
        eq(invoices.invoiceNumber, String(capture.invoiceNumber ?? "")),
      ),
    );
  const activeCaptureRows = await db
    .select({ id: apInvoiceCaptures.id })
    .from(apInvoiceCaptures)
    .where(
      and(
        eq(apInvoiceCaptures.organizationId, orgId),
        eq(apInvoiceCaptures.supplierId, Number(capture.supplierId)),
        eq(apInvoiceCaptures.invoiceNumber, String(capture.invoiceNumber ?? "")),
        inArray(apInvoiceCaptures.status, ["STAGED", "REVIEW_REQUIRED", "READY_TO_PROMOTE", "PROMOTED"]),
      ),
    );
  const duplicateRiskScore = duplicateLedgerRows.length > 0 || activeCaptureRows.length > 1 ? 100 : 0;
  if (duplicateRiskScore >= 70 && !options?.overrideReason?.trim()) {
    throw new Error("Capture promotion blocked due to duplicate risk. Provide an explicit override reason.");
  }

  const extractedLines = Array.isArray(capture.extractedLines)
    ? capture.extractedLines
    : [];
  const items: InsertInvoiceItem[] = extractedLines
    .map((line) => ({
      invoiceId: 0,
      itemId: toNumber(line.itemId, 0),
      description: typeof line.description === "string" ? line.description : `Captured line`,
      quantity: toNumber(line.quantity, 0),
      unitPrice: toNumber(line.unitPrice, 0),
      taxRate: toNumber(line.taxRate, 0),
      taxAmount: toNumber(line.taxAmount, 0),
      totalPrice:
        toNumber(line.totalPrice, 0) ||
        toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0) + toNumber(line.taxAmount, 0),
      glCode: typeof line.glCode === "string" ? line.glCode : null,
      costCenter: typeof line.costCenter === "string" ? line.costCenter : null,
      projectCode: typeof line.projectCode === "string" ? line.projectCode : null,
      taxCode: typeof line.taxCode === "string" ? line.taxCode : null,
    }))
    .filter((line) => line.itemId > 0 && line.quantity > 0);

  const created = await createInvoiceRecord(
    {
      supplierId: capture.supplierId,
      invoiceNumber: capture.invoiceNumber ?? undefined,
      issueDate: capture.issueDate ?? undefined,
      dueDate: capture.dueDate ?? undefined,
      currencyCode: capture.currencyCode ?? undefined,
      subtotal: capture.subtotalAmount ?? 0,
      tax: capture.taxAmount ?? 0,
      total: capture.totalAmount ?? 0,
      status: "DRAFT",
      notes: capture.reviewerNotes ?? undefined,
      items,
    },
    userId,
  );

  await db
    .update(apInvoiceCaptures)
    .set({
      status: "PROMOTED",
      promotedInvoiceId: created.id,
      reviewedBy: userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(apInvoiceCaptures.id, captureId), eq(apInvoiceCaptures.organizationId, orgId)));

  await writeApAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    action: "AP_CAPTURE_PROMOTED",
    entityType: "capture",
    entityId: captureId,
    priorState: capture.status,
    nextState: "PROMOTED",
    reason: options?.overrideReason ?? null,
    extra: { promotedInvoiceId: created.id, duplicateRiskScore },
  }).catch(() => {});

  return created;
}

export async function listReceipts() {
  return db
    .select()
    .from(apReceipts)
    .where(eq(apReceipts.organizationId, getActiveOrganizationId()))
    .orderBy(desc(apReceipts.receivedDate));
}

export async function createReceiptRecord(
  receipt: InsertApReceipt,
  items: InsertApReceiptItem[],
  userId: number,
  options: { warehouseId?: number | null; warehouseLocation?: string | null } = {},
) {
  const orgId = getActiveOrganizationId();
  const po = await storage.getPurchaseOrder(Number(receipt.purchaseOrderId));
  if (!po || Number(po.organizationId) !== orgId) {
    throw new Error("Purchase order not found in active organization.");
  }
  if (receipt.supplierId != null && Number(receipt.supplierId) !== Number(po.supplierId)) {
    throw new Error("Receipt supplier must match purchase order supplier.");
  }
  const poLines = await storage.getPurchaseOrderItems(po.id);
  const poLineById = new Map(poLines.map((line) => [Number(line.id), line]));
  const poLineByItem = new Map<number, (typeof poLines)[number]>();
  for (const line of poLines) {
    if (!poLineByItem.has(Number(line.itemId))) {
      poLineByItem.set(Number(line.itemId), line);
    }
  }
  return db.transaction(async (tx) => {
    const requestedByLineId = new Map<number, number>();
    for (const item of items) {
      const lineId = item.purchaseOrderItemId ? Number(item.purchaseOrderItemId) : null;
      const poLine = lineId ? poLineById.get(lineId) : poLineByItem.get(Number(item.itemId));
      if (!poLine) {
        throw new Error(`Receipt line item ${item.itemId} is not part of the purchase order.`);
      }
      if (Number(poLine.itemId) !== Number(item.itemId)) {
        throw new Error(`Receipt line item ${item.itemId} does not match purchase order line item.`);
      }
      const accepted = toNumber(item.acceptedQuantity, item.quantity);
      const priorRequested = requestedByLineId.get(Number(poLine.id)) ?? 0;
      const remaining = Math.max(toNumber(poLine.quantity, 0) - toNumber(poLine.receivedQuantity, 0) - priorRequested, 0);
      if (accepted > remaining) {
        throw new Error(`Receipt quantity exceeds remaining receivable quantity for PO line ${poLine.id}.`);
      }
      requestedByLineId.set(Number(poLine.id), priorRequested + accepted);
    }

    const [created] = await tx
      .insert(apReceipts)
      .values({
        organizationId: orgId,
        receiptNumber:
          receipt.receiptNumber?.trim() || `RCV-${Date.now().toString().slice(-8)}`,
        purchaseOrderId: Number(receipt.purchaseOrderId),
        supplierId: receipt.supplierId ?? null,
        status: receipt.status ?? "POSTED",
        receivedDate: receipt.receivedDate ?? new Date(),
        receivedBy: receipt.receivedBy ?? userId,
        notes: receipt.notes ?? null,
      })
      .returning();

    for (const item of items) {
      const poLine =
        (item.purchaseOrderItemId ? poLineById.get(Number(item.purchaseOrderItemId)) : undefined) ??
        poLineByItem.get(Number(item.itemId));
      if (!poLine) {
        throw new Error("Unable to resolve purchase order line for receipt item.");
      }
      const acceptedQty = toNumber(item.acceptedQuantity, item.quantity);
      await tx.insert(apReceiptItems).values({
        receiptId: created.id,
        purchaseOrderItemId: Number(poLine.id),
        itemId: Number(item.itemId),
        quantity: toNumber(item.quantity, 0),
        acceptedQuantity: acceptedQty,
        rejectedQuantity: toNumber(item.rejectedQuantity, 0),
        notes: item.notes ?? null,
      });
      await tx
        .update(purchaseOrderItems)
        .set({
          receivedQuantity: sql`${purchaseOrderItems.receivedQuantity} + ${acceptedQty}`,
        })
        .where(eq(purchaseOrderItems.id, Number(poLine.id)));

      const warehouseId =
        options.warehouseId != null && Number.isFinite(Number(options.warehouseId)) && Number(options.warehouseId) > 0
          ? Number(options.warehouseId)
          : null;
      const receiptInventoryQty = Math.round(acceptedQty);
      if (warehouseId && receiptInventoryQty > 0) {
        const [itemRow] = await tx
          .select({ quantity: inventoryItems.quantity })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.id, Number(item.itemId)), eq(inventoryItems.organizationId, orgId)))
          .limit(1);
        const previousItemQty = toNumber(itemRow?.quantity, 0);
        await tx
          .update(inventoryItems)
          .set({
            quantity: previousItemQty + receiptInventoryQty,
            updatedAt: new Date(),
          })
          .where(and(eq(inventoryItems.id, Number(item.itemId)), eq(inventoryItems.organizationId, orgId)));

        const [warehouseRow] = await tx
          .select({ id: warehouseInventory.id, quantity: warehouseInventory.quantity })
          .from(warehouseInventory)
          .where(
            and(
              eq(warehouseInventory.organizationId, orgId),
              eq(warehouseInventory.warehouseId, warehouseId),
              eq(warehouseInventory.itemId, Number(item.itemId)),
            ),
          )
          .limit(1);
        const previousWarehouseQty = toNumber(warehouseRow?.quantity, 0);
        if (warehouseRow) {
          await tx
            .update(warehouseInventory)
            .set({
              quantity: previousWarehouseQty + receiptInventoryQty,
              location: options.warehouseLocation ?? undefined,
              updatedAt: new Date(),
            })
            .where(eq(warehouseInventory.id, warehouseRow.id));
        } else {
          await tx.insert(warehouseInventory).values({
            organizationId: orgId,
            warehouseId,
            itemId: Number(item.itemId),
            quantity: receiptInventoryQty,
            location: options.warehouseLocation ?? null,
            updatedAt: new Date(),
          });
        }

        await tx.insert(stockMovements).values({
          organizationId: orgId,
          itemId: Number(item.itemId),
          warehouseId,
          type: "RECEIPT",
          quantity: receiptInventoryQty,
          referenceId: created.id,
          referenceType: "ap_receipt",
          notes: `AP receipt ${created.receiptNumber} for PO ${po.orderNumber}`,
          userId,
          receiverUserId: userId,
          warehouseLocation: options.warehouseLocation ?? null,
          receivedAt: receipt.receivedDate ?? new Date(),
          previousQuantity: previousWarehouseQty,
          newQuantity: previousWarehouseQty + receiptInventoryQty,
          timestamp: new Date(),
        });
      }
    }

    return created;
  });
}

/** Idempotent AP receipt for operational PO receive (does not double-update PO line quantities). */
export async function syncOperationalReceiveToApReceipt(params: {
  purchaseOrderId: number;
  receiptLines: Array<{ purchaseOrderItemId: number; itemId: number; acceptedQty: number }>;
  receivedByUserId?: number | null;
}): Promise<{ receiptId: number | null; idempotent: boolean }> {
  if (params.receiptLines.length === 0) {
    return { receiptId: null, idempotent: false };
  }
  const orgId = getActiveOrganizationId();
  const payload = [...params.receiptLines]
    .map((r) => ({ id: r.purchaseOrderItemId, i: r.itemId, q: r.acceptedQty }))
    .sort((a, b) => a.id - b.id || a.i - b.i || a.q - b.q);
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
  const receiptNumber = `OP-${params.purchaseOrderId}-${hash}`;

  const [existing] = await db
    .select()
    .from(apReceipts)
    .where(and(eq(apReceipts.organizationId, orgId), eq(apReceipts.receiptNumber, receiptNumber)))
    .limit(1);

  let receiptId = existing?.id ?? null;
  const idempotent = Boolean(existing);

  if (!existing) {
    const po = await storage.getPurchaseOrder(params.purchaseOrderId);
    if (!po || Number(po.organizationId) !== orgId) {
      return { receiptId: null, idempotent: false };
    }
    receiptId = await db.transaction(async (tx) => {
      const [rec] = await tx
        .insert(apReceipts)
        .values({
          organizationId: orgId,
          receiptNumber,
          purchaseOrderId: params.purchaseOrderId,
          supplierId: po.supplierId ?? null,
          status: "POSTED",
          receivedDate: new Date(),
          receivedBy: params.receivedByUserId ?? null,
          notes: "Synced from operational PO receive",
        })
        .returning();
      for (const line of params.receiptLines) {
        await tx.insert(apReceiptItems).values({
          receiptId: rec.id,
          purchaseOrderItemId: line.purchaseOrderItemId,
          itemId: line.itemId,
          quantity: line.acceptedQty,
          acceptedQuantity: line.acceptedQty,
          rejectedQuantity: 0,
        });
      }
      return rec.id;
    });
  }

  const matchUserId =
    params.receivedByUserId != null && Number.isFinite(Number(params.receivedByUserId))
      ? Number(params.receivedByUserId)
      : 1;
  const linkedInvoices = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.purchaseOrderId, params.purchaseOrderId)));
  for (const inv of linkedInvoices) {
    try {
      await evaluateInvoiceMatch(inv.id, DEFAULT_MATCH_ON_SUBMIT_APPROVAL, matchUserId);
    } catch {
      /* non-fatal */
    }
  }

  return { receiptId, idempotent };
}

export async function evaluateInvoiceMatch(
  invoiceId: number,
  options: MatchOptions,
  userId: number,
) {
  const orgId = getActiveOrganizationId();
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return undefined;
  if (!invoice.purchaseOrderId) {
    throw new Error("Invoice is not linked to a purchase order");
  }

  const po = await storage.getPurchaseOrder(invoice.purchaseOrderId);
  if (!po) {
    throw new Error("Linked purchase order not found");
  }

  const [poItems, invItems, receiptRows] = await Promise.all([
    storage.getPurchaseOrderItems(po.id),
    storage.getInvoiceItems(invoiceId),
    db
      .select()
      .from(apReceipts)
      .where(
        and(
          eq(apReceipts.organizationId, orgId),
          eq(apReceipts.purchaseOrderId, po.id),
          eq(apReceipts.status, "POSTED"),
        ),
      ),
  ]);

  const receiptItemsByItemId = new Map<number, number>();
  const receiptIds = receiptRows.map((row) => row.id);
  const receiptLineRows =
    receiptIds.length > 0
      ? await db.select().from(apReceiptItems).where(inArray(apReceiptItems.receiptId, receiptIds))
      : [];
  for (const line of receiptLineRows) {
    const current = receiptItemsByItemId.get(line.itemId) ?? 0;
    receiptItemsByItemId.set(line.itemId, current + toNumber(line.acceptedQuantity, line.quantity));
  }

  const priceTolerancePct = clampPct(options.priceTolerancePct);
  const quantityTolerancePct = clampPct(options.quantityTolerancePct);
  const taxTolerancePct = clampPct(options.taxTolerancePct);

  const mismatches: Array<Record<string, unknown>> = [];
  let matchedLineCount = 0;

  for (const invItem of invItems) {
    const poItem = poItems.find((candidate) => candidate.itemId === invItem.itemId);
    if (!poItem) {
      mismatches.push({
        code: "MISSING_PO_LINE",
        itemId: invItem.itemId,
        message: "Item not found on purchase order",
        severity: "high",
      });
      continue;
    }

    const poUnitPrice = toNumber(poItem.unitPrice, 0);
    const invoiceUnitPrice = toNumber(invItem.unitPrice, 0);
    const priceDeltaPct =
      poUnitPrice <= 0 ? 0 : (Math.abs(invoiceUnitPrice - poUnitPrice) / poUnitPrice) * 100;
    if (priceDeltaPct > priceTolerancePct) {
      mismatches.push({
        code: "PRICE_MISMATCH",
        itemId: invItem.itemId,
        message: `Invoice unit price ${invoiceUnitPrice} differs from PO ${poUnitPrice}`,
        deltaPct: Number(priceDeltaPct.toFixed(2)),
        severity: "high",
      });
    }

    const receivedQty =
      receiptItemsByItemId.get(invItem.itemId) ?? toNumber(poItem.receivedQuantity, 0);
    const invoicedQty = toNumber(invItem.quantity, 0);
    const maxQty = receivedQty * (1 + quantityTolerancePct / 100);
    if (invoicedQty > maxQty) {
      mismatches.push({
        code: "QTY_MISMATCH",
        itemId: invItem.itemId,
        message: `Invoice quantity ${invoicedQty} exceeds received quantity ${receivedQty}`,
        expectedMax: maxQty,
        severity: "high",
      });
    }

    const invoiceTaxRate = toNumber(invItem.taxRate, 0);
    if (invoiceTaxRate > taxTolerancePct && taxTolerancePct === 0 && toNumber(invItem.taxAmount, 0) > 0) {
      mismatches.push({
        code: "TAX_REVIEW_REQUIRED",
        itemId: invItem.itemId,
        message: `Invoice line has tax amount ${toNumber(invItem.taxAmount, 0)} and requires AP review`,
        severity: "medium",
      });
    }

    const hasMismatchForLine = mismatches.some((entry) => entry.itemId === invItem.itemId);
    if (!hasMismatchForLine) {
      matchedLineCount += 1;
    }
  }

  await db
    .delete(apInvoiceMatchResults)
    .where(
      and(
        eq(apInvoiceMatchResults.organizationId, orgId),
        eq(apInvoiceMatchResults.invoiceId, invoiceId),
      ),
    );

  const status =
    mismatches.length === 0
      ? priceTolerancePct > 0 || quantityTolerancePct > 0
        ? "MATCHED_WITH_TOLERANCE"
        : "MATCHED"
      : "EXCEPTION";
  const [created] = await db
    .insert(apInvoiceMatchResults)
    .values({
      organizationId: orgId,
      invoiceId,
      purchaseOrderId: po.id,
      status,
      matchType: receiptRows.length > 0 ? "three_way" : "po_only",
      priceTolerancePct,
      quantityTolerancePct,
      taxTolerancePct,
      matchedLineCount,
      mismatchCount: mismatches.length,
      mismatchSummary: mismatches,
      reviewedBy: userId,
      reviewedAt: new Date(),
    })
    .returning();

  await storage.createActivityLog({
    action: mismatches.length === 0 ? "AP_INVOICE_MATCH_PASSED" : "AP_INVOICE_MATCH_FAILED",
    description: `Invoice ${invoice.invoiceNumber} match status: ${status}`,
    referenceType: "invoice",
    referenceId: invoiceId,
    userId,
  }).catch(() => {});

  await writeApAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    action: "AP_INVOICE_MATCHED",
    entityType: "match_result",
    entityId: created.id,
    priorState: null,
    nextState: created.status,
    extra: {
      invoiceId,
      recommendedNextState: mismatches.length === 0 ? "PENDING_APPROVAL" : "DISPUTED",
      mismatchCodes: mismatches.map((entry) => entry.code),
    },
  }).catch(() => {});

  return {
    invoiceId,
    purchaseOrderId: po.id,
    matched: mismatches.length === 0,
    status: invoice.status,
    recommendedNextState: mismatches.length === 0 ? "PENDING_APPROVAL" : "DISPUTED",
    matchResult: created,
    mismatches,
  };
}

export async function listExceptions() {
  const orgId = getActiveOrganizationId();
  const [captureRows, matchRows, disputedInvoices] = await Promise.all([
    db
      .select()
      .from(apInvoiceCaptures)
      .where(
        and(
          eq(apInvoiceCaptures.organizationId, orgId),
          eq(apInvoiceCaptures.status, "REVIEW_REQUIRED"),
        ),
      )
      .orderBy(desc(apInvoiceCaptures.updatedAt)),
    db
      .select()
      .from(apInvoiceMatchResults)
      .where(
        and(
          eq(apInvoiceMatchResults.organizationId, orgId),
          eq(apInvoiceMatchResults.status, "EXCEPTION"),
        ),
      )
      .orderBy(desc(apInvoiceMatchResults.updatedAt)),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, "DISPUTED")))
      .orderBy(desc(invoices.updatedAt)),
  ]);

  return {
    captureExceptions: captureRows,
    matchExceptions: matchRows,
    disputedInvoices,
  };
}

export async function getOverview() {
  const orgId = getActiveOrganizationId();
  const [allInvoices, captures, exceptionMatches, batches] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.organizationId, orgId)),
    db.select().from(apInvoiceCaptures).where(eq(apInvoiceCaptures.organizationId, orgId)),
    db
      .select()
      .from(apInvoiceMatchResults)
      .where(
        and(
          eq(apInvoiceMatchResults.organizationId, orgId),
          eq(apInvoiceMatchResults.status, "EXCEPTION"),
        ),
      ),
    db.select().from(apPaymentBatches).where(eq(apPaymentBatches.organizationId, orgId)),
  ]);

  const outstandingAmount = allInvoices.reduce((sum, invoice) => {
    const dueRaw = invoice.dueAmount;
    const useDue = dueRaw != null && Number.isFinite(Number(dueRaw));
    const part = useDue ? toNumber(dueRaw, 0) : toNumber(invoice.total, 0);
    return sum + part;
  }, 0);
  return {
    invoiceCount: allInvoices.length,
    pendingApprovalCount: allInvoices.filter((row) => row.status === "PENDING_APPROVAL").length,
    approvedCount: allInvoices.filter((row) => row.status === "APPROVED").length,
    disputedCount: allInvoices.filter((row) => row.status === "DISPUTED").length,
    overdueCount: allInvoices.filter((row) => row.status === "OVERDUE").length,
    captureReviewCount: captures.filter((row) => row.status === "REVIEW_REQUIRED").length,
    readyToPromoteCount: captures.filter((row) => row.status === "READY_TO_PROMOTE").length,
    exceptionCount: exceptionMatches.length,
    paymentBatchCount: batches.length,
    pendingPaymentBatchCount: batches.filter((row) => row.status === "PENDING_APPROVAL").length,
    outstandingAmount: Number(outstandingAmount.toFixed(2)),
  };
}

export async function createPaymentBatchRecord(
  input: InsertApPaymentBatch & { invoiceIds?: number[] },
  userId: number,
) {
  const orgId = getActiveOrganizationId();
  const invoiceIds = Array.isArray(input.invoiceIds)
    ? Array.from(new Set(input.invoiceIds.map((id) => Number(id)).filter((id) => id > 0)))
    : [];
  if (invoiceIds.length === 0) {
    throw new Error("Select at least one approved invoice for the batch.");
  }

  const blockedInvoices = await db
    .select({ invoiceId: apPaymentBatchItems.invoiceId })
    .from(apPaymentBatchItems)
    .innerJoin(apPaymentBatches, eq(apPaymentBatches.id, apPaymentBatchItems.batchId))
    .where(
      and(
        eq(apPaymentBatches.organizationId, orgId),
        inArray(apPaymentBatches.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED"]),
        inArray(apPaymentBatchItems.invoiceId, invoiceIds),
      ),
    );
  if (blockedInvoices.length > 0) {
    throw new Error("One or more invoices are already attached to an active unreleased payment batch.");
  }

  const invoiceRows = await Promise.all(invoiceIds.map((id) => storage.getInvoice(id)));
  const eligibleInvoices = invoiceRows.filter(
    (row): row is NonNullable<(typeof invoiceRows)[number]> => {
      if (!row) return false;
      return (
        ["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(String(row.status)) &&
        toNumber(row.dueAmount ?? row.total, 0) > 0
      );
    },
  );

  if (eligibleInvoices.length === 0) {
    throw new Error("No eligible invoices were selected for payment batching.");
  }

  return db.transaction(async (tx) => {
    const totalAmount = eligibleInvoices.reduce(
      (sum, row) => sum + toNumber(row.dueAmount ?? row.total, 0),
      0,
    );
    const [batch] = await tx
      .insert(apPaymentBatches)
      .values({
        organizationId: orgId,
        batchNumber: input.batchNumber?.trim() || `APB-${Date.now().toString().slice(-8)}`,
        status: input.status ?? "PENDING_APPROVAL",
        scheduledDate: input.scheduledDate ?? null,
        totalAmount,
        paymentMethod:
          input.paymentMethod && paymentMethodEnum.enumValues.includes(input.paymentMethod)
            ? input.paymentMethod
            : "BANK_TRANSFER",
        exportMetadata: input.exportMetadata ?? {},
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning();
    assertPaymentBatchTransition("DRAFT", batch.status);

    for (const invoice of eligibleInvoices) {
      await tx.insert(apPaymentBatchItems).values({
        batchId: batch.id,
        invoiceId: invoice.id,
        amount: toNumber(invoice.dueAmount ?? invoice.total, 0),
        status: "PENDING",
      });
    }

    await createApprovalHistoryEntry({
      organizationId: orgId,
      entityType: "payment_batch",
      entityId: batch.id,
      action: "submitted",
      performedBy: userId,
      newStatus: batch.status,
    }).catch(() => {});

    await writeApAuditLog({
      organizationId: orgId,
      actorUserId: userId,
      action: "AP_PAYMENT_BATCH_CREATED",
      entityType: "payment_batch",
      entityId: batch.id,
      nextState: batch.status,
      extra: { invoiceCount: eligibleInvoices.length, totalAmount },
    }).catch(() => {});

    return batch;
  });
}

export async function listPaymentBatches() {
  const orgId = getActiveOrganizationId();
  const batches = await db
    .select()
    .from(apPaymentBatches)
    .where(eq(apPaymentBatches.organizationId, orgId))
    .orderBy(desc(apPaymentBatches.createdAt));

  const result = [];
  for (const batch of batches) {
    const items = await db.select().from(apPaymentBatchItems).where(eq(apPaymentBatchItems.batchId, batch.id));
    result.push({ ...batch, items });
  }
  return result;
}

export async function approvePaymentBatch(
  batchId: number,
  userId: number,
  comment?: string,
  context: ApprovalActionContext = { actorRole: "" },
) {
  const orgId = getActiveOrganizationId();
  const [existing] = await db
    .select()
    .from(apPaymentBatches)
    .where(and(eq(apPaymentBatches.id, batchId), eq(apPaymentBatches.organizationId, orgId)));
  if (!existing) return undefined;
  assertPaymentBatchTransition(String(existing.status), "APPROVED");
  assertNotSelfBatchApproval({
    actorUserId: userId,
    actorRole: context.actorRole,
    batchCreatedBy: existing.createdBy,
    overrideExplicit: context.overrideExplicit,
    overrideReason: context.overrideReason,
  });
  await enforceApprovalPolicy({
    organizationId: orgId,
    entityType: "payment_batch",
    amount: toNumber(existing.totalAmount, 0),
    actorUserId: userId,
    actorRole: context.actorRole,
  });

  const [updated] = await db
    .update(apPaymentBatches)
    .set({
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(apPaymentBatches.id, batchId), eq(apPaymentBatches.organizationId, orgId)))
    .returning();

  await createApprovalHistoryEntry({
    organizationId: orgId,
    entityType: "payment_batch",
    entityId: batchId,
    action: "approved",
    performedBy: userId,
    previousStatus: existing.status,
    newStatus: "APPROVED",
    comment: comment ?? context.overrideReason,
  }).catch(() => {});

  await writeApAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    action: "AP_PAYMENT_BATCH_APPROVED",
    entityType: "payment_batch",
    entityId: batchId,
    priorState: existing.status,
    nextState: "APPROVED",
    reason: comment ?? context.overrideReason,
  }).catch(() => {});

  return updated;
}

export async function releasePaymentBatch(
  batchId: number,
  userId: number,
  context: ApprovalActionContext = { actorRole: "" },
) {
  const orgId = getActiveOrganizationId();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ap_payment_batches WHERE id = ${batchId} AND organization_id = ${orgId} FOR UPDATE`,
    );
    const [batch] = await tx
      .select()
      .from(apPaymentBatches)
      .where(and(eq(apPaymentBatches.id, batchId), eq(apPaymentBatches.organizationId, orgId)));
    if (!batch) return undefined;
    if (batch.status === "RELEASED") {
      return batch;
    }
    assertPaymentBatchTransition(String(batch.status), "RELEASED");
    assertNotSelfBatchApproval({
      actorUserId: userId,
      actorRole: context.actorRole,
      batchCreatedBy: batch.createdBy,
      overrideExplicit: context.overrideExplicit,
      overrideReason: context.overrideReason,
    });

    const items = await tx
      .select()
      .from(apPaymentBatchItems)
      .where(eq(apPaymentBatchItems.batchId, batchId));
    const unreleasedItems = items.filter((item) => !item.paymentId);
    const invoiceRows =
      unreleasedItems.length > 0
        ? await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.organizationId, orgId),
                inArray(
                  invoices.id,
                  unreleasedItems.map((item) => Number(item.invoiceId)),
                ),
              ),
            )
        : [];
    const invoiceById = new Map(invoiceRows.map((row) => [Number(row.id), row]));
    const historyRows =
      unreleasedItems.length > 0
        ? await tx
            .select()
            .from(approvalHistory)
            .where(
              and(
                eq(approvalHistory.organizationId, orgId),
                eq(approvalHistory.entityType, "invoice"),
                eq(approvalHistory.action, "approved"),
                inArray(
                  approvalHistory.entityId,
                  unreleasedItems.map((item) => Number(item.invoiceId)),
                ),
              ),
            )
        : [];
    assertBatchReleaseApproverSeparation({
      actorUserId: userId,
      actorRole: context.actorRole,
      approvedByIds: historyRows.map((row) => Number(row.performedBy)),
      overrideExplicit: context.overrideExplicit,
      overrideReason: context.overrideReason,
    });

    for (const item of unreleasedItems) {
      const invoice = invoiceById.get(Number(item.invoiceId));
      if (!invoice) throw new Error(`Invoice ${item.invoiceId} no longer exists in active organization.`);
      if (!["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(String(invoice.status))) {
        throw new Error(`Invoice ${invoice.invoiceNumber} is no longer payable.`);
      }
      const remainingDue = toNumber(invoice.dueAmount ?? invoice.total, 0);
      const paymentAmount = toNumber(item.amount, 0);
      if (remainingDue <= 0) {
        throw new Error(`Invoice ${invoice.invoiceNumber} has no due balance remaining.`);
      }
      if (paymentAmount > remainingDue) {
        throw new Error(`Payment amount for invoice ${invoice.invoiceNumber} exceeds remaining due.`);
      }

      const [payment] = await tx
        .insert(payments)
        .values({
          invoiceId: Number(item.invoiceId),
          amount: paymentAmount,
          method: batch.paymentMethod as Payment["method"],
          receivedBy: userId,
          notes: `Released via AP payment batch ${batch.batchNumber}`,
          transactionReference: null,
          paymentDate: new Date(),
        })
        .returning();

      const nextPaid = toNumber(invoice.paidAmount, 0) + paymentAmount;
      const nextDue = Math.max(toNumber(invoice.total, 0) - nextPaid, 0);
      const nextInvoiceStatus = nextDue <= 0 ? "PAID" : nextPaid > 0 ? "PARTIALLY_PAID" : invoice.status;
      await tx
        .update(invoices)
        .set({
          paidAmount: nextPaid,
          dueAmount: nextDue,
          status: nextInvoiceStatus as any,
          paidDate: nextDue <= 0 ? new Date() : invoice.paidDate,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, Number(item.invoiceId)), eq(invoices.organizationId, orgId)));

      await tx
        .update(apPaymentBatchItems)
        .set({
          paymentId: payment.id,
          status: "RELEASED",
          updatedAt: new Date(),
        })
        .where(eq(apPaymentBatchItems.id, item.id));
    }

    const [updated] = await tx
      .update(apPaymentBatches)
      .set({
        status: "RELEASED",
        releasedAt: new Date(),
        releasedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(apPaymentBatches.id, batchId), eq(apPaymentBatches.organizationId, orgId)))
      .returning();

    await createApprovalHistoryEntry({
      organizationId: orgId,
      entityType: "payment_batch",
      entityId: batchId,
      action: "released",
      performedBy: userId,
      previousStatus: batch.status,
      newStatus: "RELEASED",
      comment: context.comment ?? context.overrideReason ?? null,
    }).catch(() => {});

    await writeApAuditLog({
      organizationId: orgId,
      actorUserId: userId,
      action: "AP_PAYMENT_BATCH_RELEASED",
      entityType: "payment_batch",
      entityId: batchId,
      priorState: batch.status,
      nextState: "RELEASED",
      reason: context.comment ?? context.overrideReason ?? null,
      extra: { releasedItemCount: unreleasedItems.length },
    }).catch(() => {});

    return updated;
  });
}

export async function previewInvoiceApprovers(invoiceId: number) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return undefined;
  return getApprovalSuggestions("invoice", toNumber(invoice.total ?? 0));
}
