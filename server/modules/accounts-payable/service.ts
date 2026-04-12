import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { storage } from "../../storage";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { getApprovalSuggestions } from "../../approval-suggestions";
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
  paymentMethodEnum,
  payments,
  purchaseOrders,
  purchaseOrderItems,
  type InsertApInvoiceCapture,
  type InsertApPaymentBatch,
  type InsertApReceipt,
  type InsertApReceiptItem,
  type InsertInvoice,
  type InsertInvoiceItem,
  type InsertPayment,
  type Payment,
} from "@shared/schema";

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

async function createApprovalHistoryEntry(input: {
  entityType: "invoice" | "payment_batch";
  entityId: number;
  action: string;
  performedBy: number;
  previousStatus?: string | null;
  newStatus?: string | null;
  comment?: string | null;
}) {
  await db.insert(approvalHistory).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    performedBy: input.performedBy,
    previousStatus: input.previousStatus ?? null,
    newStatus: input.newStatus ?? null,
    comment: input.comment ?? null,
  });
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
  const items = Array.isArray(invoiceData.items) ? (invoiceData.items as InsertInvoiceItem[]) : [];
  const supplierId = toNumber(invoiceData.supplierId, 0);
  if (!supplierId) {
    throw new Error("Supplier is required");
  }

  const supplier = await storage.getSupplier(supplierId);
  if (!supplier) {
    throw new Error("Supplier does not exist");
  }

  const purchaseOrderId = invoiceData.purchaseOrderId == null ? null : toNumber(invoiceData.purchaseOrderId, 0);
  if (purchaseOrderId) {
    const po = await storage.getPurchaseOrder(purchaseOrderId);
    if (!po) throw new Error("Purchase order does not exist");
    if (Number(po.supplierId) !== supplierId) {
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

  const issueDate = toDateOrUndefined(invoiceData.issueDate) ?? new Date();
  const dueDate =
    toDateOrUndefined(invoiceData.dueDate) ??
    new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const total = toNumber(invoiceData.total ?? invoiceData.totalAmount, 0);
  const subtotal = toNumber(invoiceData.subtotal, total);
  const tax = toNumber(invoiceData.tax ?? invoiceData.totalTax, 0);
  const discount = toNumber(invoiceData.discount, 0);

  const created = await storage.createInvoice(
    {
      invoiceNumber:
        typeof invoiceData.invoiceNumber === "string" && invoiceData.invoiceNumber.trim()
          ? invoiceData.invoiceNumber.trim()
          : `INV-${Date.now().toString().slice(-8)}`,
      supplierId,
      customerId: invoiceData.customerId == null ? null : toNumber(invoiceData.customerId, 0),
      purchaseOrderId: purchaseOrderId || null,
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
  const existing = await storage.getInvoice(invoiceId);
  if (!existing) return undefined;
  const updated = await storage.updateInvoice(invoiceId, { status });
  if (!updated) return undefined;

  await createApprovalHistoryEntry({
    entityType: "invoice",
    entityId: invoiceId,
    action: String(status).toLowerCase(),
    performedBy: userId,
    previousStatus: existing.status,
    newStatus: status,
    comment,
  }).catch(() => {});

  return updated;
}

export async function submitInvoiceForApproval(invoiceId: number, userId: number) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return undefined;
  const updated = await storage.updateInvoice(invoiceId, { status: "PENDING_APPROVAL" });
  if (!updated) return undefined;

  await createApprovalHistoryEntry({
    entityType: "invoice",
    entityId: invoiceId,
    action: "submitted",
    performedBy: userId,
    previousStatus: invoice.status,
    newStatus: "PENDING_APPROVAL",
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

export async function approveInvoice(invoiceId: number, userId: number, comment?: string) {
  const updated = await updateInvoiceStatus(invoiceId, "APPROVED", userId, comment);
  if (updated) {
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

export async function rejectInvoice(invoiceId: number, userId: number, comment?: string) {
  return updateInvoiceStatus(invoiceId, "DISPUTED", userId, comment);
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

  const warnings = [...(input.warnings ?? [])];
  if (duplicateInvoice.length > 0) {
    warnings.push("Potential duplicate invoice found in AP ledger.");
  }

  const readyToPromote = Boolean(input.supplierId && input.invoiceNumber);
  const status =
    duplicateInvoice.length > 0 || !readyToPromote ? "REVIEW_REQUIRED" : input.status ?? "READY_TO_PROMOTE";

  const [created] = await db
    .insert(apInvoiceCaptures)
    .values({
      organizationId: orgId,
      source: input.source ?? "manual_upload",
      status,
      documentId: input.documentId ?? null,
      supplierId: input.supplierId ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      issueDate: input.issueDate ?? null,
      dueDate: input.dueDate ?? null,
      currencyCode: input.currencyCode ?? null,
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

  return created;
}

export async function promoteCapture(captureId: number, userId: number) {
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
) {
  const orgId = getActiveOrganizationId();
  return db.transaction(async (tx) => {
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
      await tx.insert(apReceiptItems).values({
        receiptId: created.id,
        purchaseOrderItemId: item.purchaseOrderItemId ?? null,
        itemId: Number(item.itemId),
        quantity: toNumber(item.quantity, 0),
        acceptedQuantity: toNumber(item.acceptedQuantity, item.quantity),
        rejectedQuantity: toNumber(item.rejectedQuantity, 0),
        notes: item.notes ?? null,
      });
    }

    return created;
  });
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
  for (const receipt of receiptRows) {
    const receiptItems = await db
      .select()
      .from(apReceiptItems)
      .where(eq(apReceiptItems.receiptId, receipt.id));
    for (const line of receiptItems) {
      const current = receiptItemsByItemId.get(line.itemId) ?? 0;
      receiptItemsByItemId.set(line.itemId, current + toNumber(line.acceptedQuantity, line.quantity));
    }
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
        type: "MISSING_PO_LINE",
        itemId: invItem.itemId,
        message: "Item not found on purchase order",
      });
      continue;
    }

    const poUnitPrice = toNumber(poItem.unitPrice, 0);
    const invoiceUnitPrice = toNumber(invItem.unitPrice, 0);
    const priceDeltaPct =
      poUnitPrice <= 0 ? 0 : (Math.abs(invoiceUnitPrice - poUnitPrice) / poUnitPrice) * 100;
    if (priceDeltaPct > priceTolerancePct) {
      mismatches.push({
        type: "PRICE_MISMATCH",
        itemId: invItem.itemId,
        message: `Invoice unit price ${invoiceUnitPrice} differs from PO ${poUnitPrice}`,
        deltaPct: Number(priceDeltaPct.toFixed(2)),
      });
    }

    const receivedQty =
      receiptItemsByItemId.get(invItem.itemId) ?? toNumber(poItem.receivedQuantity, 0);
    const invoicedQty = toNumber(invItem.quantity, 0);
    const maxQty = receivedQty * (1 + quantityTolerancePct / 100);
    if (invoicedQty > maxQty) {
      mismatches.push({
        type: "QTY_MISMATCH",
        itemId: invItem.itemId,
        message: `Invoice quantity ${invoicedQty} exceeds received quantity ${receivedQty}`,
      });
    }

    const invoiceTaxRate = toNumber(invItem.taxRate, 0);
    if (invoiceTaxRate > taxTolerancePct && taxTolerancePct === 0 && toNumber(invItem.taxAmount, 0) > 0) {
      mismatches.push({
        type: "TAX_REVIEW",
        itemId: invItem.itemId,
        message: `Invoice line has tax amount ${toNumber(invItem.taxAmount, 0)} and requires AP review`,
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

  const status = mismatches.length === 0 ? (priceTolerancePct > 0 || quantityTolerancePct > 0 ? "MATCHED_WITH_TOLERANCE" : "MATCHED") : "EXCEPTION";
  const [created] = await db
    .insert(apInvoiceMatchResults)
    .values({
      organizationId: orgId,
      invoiceId,
      purchaseOrderId: po.id,
      status,
      matchType: receiptRows.length > 0 ? "3_way" : "2.5_way",
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

  const nextInvoiceStatus = mismatches.length === 0 ? "PENDING_APPROVAL" : "DISPUTED";
  await storage.updateInvoice(invoiceId, { status: nextInvoiceStatus });

  await storage.createActivityLog({
    action: mismatches.length === 0 ? "AP_INVOICE_MATCH_PASSED" : "AP_INVOICE_MATCH_FAILED",
    description: `Invoice ${invoice.invoiceNumber} match status: ${status}`,
    referenceType: "invoice",
    referenceId: invoiceId,
    userId,
  }).catch(() => {});

  return {
    invoiceId,
    purchaseOrderId: po.id,
    matched: mismatches.length === 0,
    status: nextInvoiceStatus,
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

  const outstandingAmount = allInvoices.reduce((sum, invoice) => sum + toNumber(invoice.dueAmount, 0), 0);
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
  const invoiceIds = Array.isArray(input.invoiceIds) ? input.invoiceIds.map((id) => Number(id)).filter((id) => id > 0) : [];
  if (invoiceIds.length === 0) {
    throw new Error("Select at least one approved invoice for the batch.");
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

    for (const invoice of eligibleInvoices) {
      await tx.insert(apPaymentBatchItems).values({
        batchId: batch.id,
        invoiceId: invoice.id,
        amount: toNumber(invoice.dueAmount ?? invoice.total, 0),
        status: "PENDING",
      });
    }

    await createApprovalHistoryEntry({
      entityType: "payment_batch",
      entityId: batch.id,
      action: "submitted",
      performedBy: userId,
      newStatus: batch.status,
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

export async function approvePaymentBatch(batchId: number, userId: number, comment?: string) {
  const orgId = getActiveOrganizationId();
  const [existing] = await db
    .select()
    .from(apPaymentBatches)
    .where(and(eq(apPaymentBatches.id, batchId), eq(apPaymentBatches.organizationId, orgId)));
  if (!existing) return undefined;

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
    entityType: "payment_batch",
    entityId: batchId,
    action: "approved",
    performedBy: userId,
    previousStatus: existing.status,
    newStatus: "APPROVED",
    comment,
  }).catch(() => {});

  return updated;
}

export async function releasePaymentBatch(batchId: number, userId: number) {
  const orgId = getActiveOrganizationId();
  const [batch] = await db
    .select()
    .from(apPaymentBatches)
    .where(and(eq(apPaymentBatches.id, batchId), eq(apPaymentBatches.organizationId, orgId)));
  if (!batch) return undefined;
  if (batch.status !== "APPROVED") {
    throw new Error("Payment batch must be approved before release.");
  }

  const items = await db.select().from(apPaymentBatchItems).where(eq(apPaymentBatchItems.batchId, batchId));
  for (const item of items) {
    if (item.paymentId) continue;
    const payment = await createPaymentRecord({
      invoiceId: item.invoiceId,
      amount: item.amount,
      method: batch.paymentMethod as Payment["method"],
      receivedBy: userId,
      notes: `Released via AP payment batch ${batch.batchNumber}`,
    });
    await db
      .update(apPaymentBatchItems)
      .set({
        paymentId: payment.id,
        status: "RELEASED",
        updatedAt: new Date(),
      })
      .where(eq(apPaymentBatchItems.id, item.id));
  }

  const [updated] = await db
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
    entityType: "payment_batch",
    entityId: batchId,
    action: "released",
    performedBy: userId,
    previousStatus: batch.status,
    newStatus: "RELEASED",
  }).catch(() => {});

  return updated;
}

export async function previewInvoiceApprovers(invoiceId: number) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return undefined;
  return getApprovalSuggestions("invoice", toNumber(invoice.total ?? 0));
}
