import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  insertApInvoiceCaptureSchema,
  insertApReceiptItemSchema,
  insertApReceiptSchema,
  insertPaymentSchema,
} from "@shared/schema";
import { sendError, sendOk } from "../../api-response";
import { incrementMetric } from "../../observability/metrics";
import { storage } from "../../storage";
import { resolveRequestActor } from "../../auth/request-user";
import { parseApprovalContext, parseInvoiceFilters } from "./ap-route-adapters";
import {
  addInvoiceItemRecord,
  approveInvoice,
  approvePaymentBatch,
  createCapture,
  createInvoiceRecord,
  createPaymentBatchRecord,
  createPaymentRecord,
  createReceiptRecord,
  deleteInvoiceItemRecord,
  deleteInvoiceRecord,
  deletePaymentRecord,
  evaluateInvoiceMatch,
  getInvoiceDetail,
  getOverview,
  listApprovalQueue,
  listCaptures,
  listExceptions,
  listInvoiceItems,
  listInvoices,
  listPaymentBatches,
  listPayments,
  listReceipts,
  previewInvoiceApprovers,
  promoteCapture,
  rejectInvoice,
  releasePaymentBatch,
  submitInvoiceForApproval,
  updateInvoiceItemRecord,
  updateInvoiceRecord,
  updateInvoiceStatus,
  updatePaymentRecord,
} from "./service";

type AuthBundle = {
  ensureAuthenticated: import("express").RequestHandler;
  ensureRole: (roles: string[]) => import("express").RequestHandler;
};

function parseId(raw: string, label: string) {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return id;
}

function requestActor(req: Request) {
  return resolveRequestActor(req);
}

function recordApprovalFailure() {
  incrementMetric("ap.approval.failures");
}

function recordReleaseFailure() {
  incrementMetric("ap.release.failures");
}

export function registerApRoutes(app: Express, auth: AuthBundle): void {
  const apRead = [auth.ensureAuthenticated];
  const apWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/ap/overview", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getOverview());
    } catch (error) {
      console.error("Error fetching AP overview:", error);
      return sendError(res, 500, "AP_OVERVIEW_FAILED", "Failed to fetch AP overview");
    }
  });

  app.get("/api/ap/approval-queue", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listApprovalQueue());
    } catch (error) {
      console.error("Error fetching AP approval queue:", error);
      return sendError(res, 500, "AP_APPROVAL_QUEUE_FAILED", "Failed to fetch AP approval queue");
    }
  });

  app.get("/api/ap/exceptions", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listExceptions());
    } catch (error) {
      console.error("Error fetching AP exceptions:", error);
      return sendError(res, 500, "AP_EXCEPTIONS_FAILED", "Failed to fetch AP exceptions");
    }
  });

  app.get("/api/ap/captures", ...apRead, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      return sendOk(res, await listCaptures(status));
    } catch (error) {
      console.error("Error fetching AP captures:", error);
      return sendError(res, 500, "AP_CAPTURES_FAILED", "Failed to fetch AP captures");
    }
  });

  app.post("/api/ap/captures", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const payload = insertApInvoiceCaptureSchema.parse(req.body);
      return sendOk(res, await createCapture(payload, actor.userId), 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: error.flatten(),
        });
      }
      console.error("Error creating AP capture:", error);
      return sendError(res, 500, "AP_CAPTURE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create AP capture");
    }
  });

  app.post("/api/ap/captures/:id/promote", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "capture ID");
      const promoted = await promoteCapture(id, actor.userId, {
        overrideReason: typeof req.body?.overrideReason === "string" ? req.body.overrideReason : undefined,
      });
      if (!promoted) return sendError(res, 404, "AP_CAPTURE_NOT_FOUND", "AP capture not found");
      return sendOk(res, promoted);
    } catch (error) {
      console.error("Error promoting AP capture:", error);
      return sendError(res, 500, "AP_CAPTURE_PROMOTE_FAILED", error instanceof Error ? error.message : "Failed to promote AP capture");
    }
  });

  app.get("/api/ap/receipts", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listReceipts());
    } catch (error) {
      console.error("Error fetching AP receipts:", error);
      return sendError(res, 500, "AP_RECEIPTS_FAILED", "Failed to fetch AP receipts");
    }
  });

  app.post("/api/ap/receipts", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const receipt = insertApReceiptSchema.parse(payload);
      const items = Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items.map((item) => insertApReceiptItemSchema.parse(item))
        : [];
      return sendOk(res, await createReceiptRecord(receipt, items, actor.userId), 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: error.flatten(),
        });
      }
      console.error("Error creating AP receipt:", error);
      return sendError(res, 500, "AP_RECEIPT_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create AP receipt");
    }
  });

  app.get("/api/ap/invoices", ...apRead, async (req: Request, res: Response) => {
    try {
      return sendOk(res, await listInvoices(parseInvoiceFilters(req)));
    } catch (error) {
      console.error("Error fetching AP invoices:", error);
      return sendError(res, 500, "FETCH_INVOICES_FAILED", "Failed to fetch invoices");
    }
  });

  app.get("/api/ap/invoices/:id", ...apRead, async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id, "invoice ID");
      const invoice = await getInvoiceDetail(id);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      console.error("Error fetching AP invoice:", error);
      return sendError(res, 500, "FETCH_INVOICE_FAILED", "Failed to fetch invoice");
    }
  });

  app.post("/api/ap/invoices", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      return sendOk(res, await createInvoiceRecord(req.body, actor.userId), 201);
    } catch (error) {
      console.error("Error creating AP invoice:", error);
      return sendError(res, 400, "CREATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to create invoice");
    }
  });

  app.patch("/api/ap/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "invoice ID");
      const invoice = await updateInvoiceRecord(id, req.body, actor.userId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      console.error("Error updating AP invoice:", error);
      return sendError(res, 500, "UPDATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to update invoice");
    }
  });

  app.delete("/api/ap/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id, "invoice ID");
      const deleted = await deleteInvoiceRecord(id);
      if (!deleted) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, { success: true });
    } catch (error) {
      console.error("Error deleting AP invoice:", error);
      return sendError(res, 400, "DELETE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to delete invoice");
    }
  });

  app.post("/api/ap/invoices/:id/match", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "invoice ID");
      const result = await evaluateInvoiceMatch(id, req.body ?? {}, actor.userId);
      if (!result) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, result);
    } catch (error) {
      console.error("Error matching AP invoice:", error);
      return sendError(res, 400, "INVOICE_MATCH_FAILED", error instanceof Error ? error.message : "Failed to run invoice match");
    }
  });

  app.get("/api/ap/invoices/:id/approval-preview", ...apRead, async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id, "invoice ID");
      const preview = await previewInvoiceApprovers(id);
      if (!preview) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, preview);
    } catch (error) {
      console.error("Error previewing invoice approvers:", error);
      return sendError(res, 500, "INVOICE_APPROVAL_PREVIEW_FAILED", "Failed to preview invoice approvers");
    }
  });

  app.post("/api/ap/invoices/:id/submit-approval", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "invoice ID");
      const invoice = await submitInvoiceForApproval(id, actor.userId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      console.error("Error submitting invoice for approval:", error);
      return sendError(res, 500, "INVOICE_SUBMIT_APPROVAL_FAILED", "Failed to submit invoice for approval");
    }
  });

  app.post("/api/ap/invoices/:id/approve", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "invoice ID");
      const invoice = await approveInvoice(
        id,
        actor.userId,
        typeof req.body?.comment === "string" ? req.body.comment : undefined,
        parseApprovalContext(req, actor.role),
      );
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      recordApprovalFailure();
      console.error("Error approving invoice:", error);
      return sendError(res, 500, "INVOICE_APPROVE_FAILED", "Failed to approve invoice");
    }
  });

  app.post("/api/ap/invoices/:id/reject", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "invoice ID");
      const invoice = await rejectInvoice(
        id,
        actor.userId,
        typeof req.body?.comment === "string" ? req.body.comment : undefined,
        parseApprovalContext(req, actor.role),
      );
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      recordApprovalFailure();
      console.error("Error rejecting invoice:", error);
      return sendError(res, 500, "INVOICE_REJECT_FAILED", "Failed to reject invoice");
    }
  });

  app.get("/api/ap/payment-batches", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listPaymentBatches());
    } catch (error) {
      console.error("Error fetching payment batches:", error);
      return sendError(res, 500, "PAYMENT_BATCHES_FAILED", "Failed to fetch payment batches");
    }
  });

  app.post("/api/ap/payment-batches", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const batch = await createPaymentBatchRecord(
        {
          batchNumber: typeof raw.batchNumber === "string" ? raw.batchNumber : undefined,
          status: typeof raw.status === "string" ? (raw.status as any) : undefined,
          scheduledDate:
            typeof raw.scheduledDate === "string" && raw.scheduledDate
              ? new Date(raw.scheduledDate)
              : undefined,
          paymentMethod: typeof raw.paymentMethod === "string" ? (raw.paymentMethod as any) : undefined,
          exportMetadata:
            raw.exportMetadata && typeof raw.exportMetadata === "object"
              ? (raw.exportMetadata as Record<string, unknown>)
              : undefined,
          notes: typeof raw.notes === "string" ? raw.notes : undefined,
          invoiceIds: Array.isArray(raw.invoiceIds) ? raw.invoiceIds : [],
        },
        actor.userId,
      );
      return sendOk(res, batch, 201);
    } catch (error) {
      console.error("Error creating payment batch:", error);
      return sendError(res, 400, "PAYMENT_BATCH_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create payment batch");
    }
  });

  app.post("/api/ap/payment-batches/:id/approve", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "batch ID");
      const batch = await approvePaymentBatch(
        id,
        actor.userId,
        typeof req.body?.comment === "string" ? req.body.comment : undefined,
        parseApprovalContext(req, actor.role),
      );
      if (!batch) return sendError(res, 404, "PAYMENT_BATCH_NOT_FOUND", "Payment batch not found");
      return sendOk(res, batch);
    } catch (error) {
      recordApprovalFailure();
      console.error("Error approving payment batch:", error);
      return sendError(res, 500, "PAYMENT_BATCH_APPROVE_FAILED", error instanceof Error ? error.message : "Failed to approve payment batch");
    }
  });

  app.post("/api/ap/payment-batches/:id/release", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseId(req.params.id, "batch ID");
      const batch = await releasePaymentBatch(id, actor.userId, parseApprovalContext(req, actor.role));
      if (!batch) return sendError(res, 404, "PAYMENT_BATCH_NOT_FOUND", "Payment batch not found");
      return sendOk(res, batch);
    } catch (error) {
      recordReleaseFailure();
      console.error("Error releasing payment batch:", error);
      return sendError(res, 400, "PAYMENT_BATCH_RELEASE_FAILED", error instanceof Error ? error.message : "Failed to release payment batch");
    }
  });

  // Legacy compatibility routes
  app.get("/api/invoices", ...apRead, async (req: Request, res: Response) => {
    req.url = `/api/ap/invoices?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
    return sendOk(res, await listInvoices(parseInvoiceFilters(req)));
  });

  app.get("/api/invoices/:id", ...apRead, async (req: Request, res: Response) => {
    try {
      const invoice = await getInvoiceDetail(parseId(req.params.id, "invoice ID"));
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      return sendError(res, 500, "FETCH_INVOICE_FAILED", "Failed to fetch invoice");
    }
  });

  app.post("/api/invoices", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      return sendOk(res, await createInvoiceRecord(req.body, actor.userId), 201);
    } catch (error) {
      return sendError(res, 400, "CREATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to create invoice");
    }
  });

  app.patch("/api/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const updated = await updateInvoiceRecord(parseId(req.params.id, "invoice ID"), req.body, actor.userId);
      if (!updated) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, updated);
    } catch (error) {
      return sendError(res, 500, "UPDATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to update invoice");
    }
  });

  app.delete("/api/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const deleted = await deleteInvoiceRecord(parseId(req.params.id, "invoice ID"));
      if (!deleted) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, { success: true });
    } catch (error) {
      return sendError(res, 400, "DELETE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to delete invoice");
    }
  });

  app.post("/api/invoices/:id/match", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const result = await evaluateInvoiceMatch(parseId(req.params.id, "invoice ID"), req.body ?? {}, actor.userId);
      if (!result) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, result);
    } catch (error) {
      return sendError(res, 400, "INVOICE_MATCH_FAILED", error instanceof Error ? error.message : "Failed to run invoice match");
    }
  });

  app.post("/api/invoices/:id/send", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseId(req.params.id, "invoice ID");
      const existing = await storage.getInvoice(invoiceId);
      if (!existing) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (existing.status !== "DRAFT") {
        return sendError(res, 400, "INVOICE_SEND_NOT_ALLOWED", "Only invoices in DRAFT status can be sent");
      }
      const updated = await updateInvoiceStatus(invoiceId, "SENT", actor.userId);
      return sendOk(res, updated);
    } catch (error) {
      return sendError(res, 500, "SEND_INVOICE_FAILED", "Failed to send invoice");
    }
  });

  app.post("/api/invoices/:id/cancel", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseId(req.params.id, "invoice ID");
      const existing = await storage.getInvoice(invoiceId);
      if (!existing) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["PAID", "CANCELLED", "VOID"].includes(existing.status)) {
        return sendError(res, 400, "INVOICE_CANCEL_NOT_ALLOWED", "Cannot cancel an invoice that is already paid, cancelled, or void");
      }
      return sendOk(res, await updateInvoiceStatus(invoiceId, "CANCELLED", actor.userId));
    } catch (error) {
      return sendError(res, 500, "CANCEL_INVOICE_FAILED", "Failed to cancel invoice");
    }
  });

  app.post("/api/invoices/:id/void", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseId(req.params.id, "invoice ID");
      const existing = await storage.getInvoice(invoiceId);
      if (!existing) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (existing.status === "VOID") {
        return sendError(res, 400, "INVOICE_ALREADY_VOID", "Invoice is already void");
      }
      return sendOk(res, await updateInvoiceStatus(invoiceId, "VOID", actor.userId));
    } catch (error) {
      return sendError(res, 500, "VOID_INVOICE_FAILED", "Failed to void invoice");
    }
  });

  app.get("/api/invoices/:invoiceId/items", ...apRead, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseId(req.params.invoiceId, "invoice ID");
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, await listInvoiceItems(invoiceId));
    } catch (error) {
      return sendError(res, 500, "FETCH_INVOICE_ITEMS_FAILED", "Failed to fetch invoice items");
    }
  });

  app.post("/api/invoices/:invoiceId/items", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseId(req.params.invoiceId, "invoice ID");
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["PAID", "CANCELLED", "VOID"].includes(invoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      return sendOk(res, await addInvoiceItemRecord({ ...req.body, invoiceId }), 201);
    } catch (error) {
      return sendError(res, 500, "CREATE_INVOICE_ITEM_FAILED", error instanceof Error ? error.message : "Failed to create invoice item");
    }
  });

  app.patch("/api/invoices/:invoiceId/items/:itemId", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseId(req.params.invoiceId, "invoice ID");
      const itemId = parseId(req.params.itemId, "invoice item ID");
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["PAID", "CANCELLED", "VOID"].includes(invoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      const item = await storage.getInvoiceItem(itemId);
      if (!item || item.invoiceId !== invoiceId) {
        return sendError(res, 404, "INVOICE_ITEM_NOT_FOUND", "Invoice item not found");
      }
      return sendOk(res, await updateInvoiceItemRecord(itemId, req.body));
    } catch (error) {
      return sendError(res, 500, "UPDATE_INVOICE_ITEM_FAILED", "Failed to update invoice item");
    }
  });

  app.delete("/api/invoices/:invoiceId/items/:itemId", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseId(req.params.invoiceId, "invoice ID");
      const itemId = parseId(req.params.itemId, "invoice item ID");
      const item = await storage.getInvoiceItem(itemId);
      if (!item || item.invoiceId !== invoiceId) {
        return sendError(res, 404, "INVOICE_ITEM_NOT_FOUND", "Invoice item not found");
      }
      await deleteInvoiceItemRecord(itemId);
      return sendOk(res, { success: true });
    } catch (error) {
      return sendError(res, 500, "DELETE_INVOICE_ITEM_FAILED", "Failed to delete invoice item");
    }
  });

  app.get("/api/payments", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listPayments());
    } catch (error) {
      return sendError(res, 500, "FETCH_PAYMENTS_FAILED", "Failed to fetch payments");
    }
  });

  app.get("/api/invoices/:invoiceId/payments", ...apRead, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseId(req.params.invoiceId, "invoice ID");
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, await listPayments(invoiceId));
    } catch (error) {
      return sendError(res, 500, "FETCH_INVOICE_PAYMENTS_FAILED", "Failed to fetch invoice payments");
    }
  });

  app.post("/api/invoices/:invoiceId/payments", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseId(req.params.invoiceId, "invoice ID");
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["CANCELLED", "VOID"].includes(invoice.status)) {
        return sendError(res, 400, "CREATE_PAYMENT_FAILED", "Cannot add payments to a cancelled or void invoice");
      }
      const payload = insertPaymentSchema.parse({
        ...req.body,
        invoiceId,
        receivedBy: req.body?.receivedBy ?? actor.userId,
      });
      return sendOk(res, await createPaymentRecord(payload), 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: error.flatten(),
        });
      }
      return sendError(res, 500, "CREATE_PAYMENT_FAILED", error instanceof Error ? error.message : "Failed to create payment");
    }
  });

  app.patch("/api/payments/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id, "payment ID");
      const payment = await updatePaymentRecord(id, req.body);
      if (!payment) return sendError(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
      return sendOk(res, payment);
    } catch (error) {
      return sendError(res, 500, "UPDATE_PAYMENT_FAILED", "Failed to update payment");
    }
  });

  app.delete("/api/payments/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id, "payment ID");
      const deleted = await deletePaymentRecord(id);
      if (!deleted) return sendError(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
      return sendOk(res, { success: true });
    } catch (error) {
      return sendError(res, 500, "DELETE_PAYMENT_FAILED", "Failed to delete payment");
    }
  });
}
