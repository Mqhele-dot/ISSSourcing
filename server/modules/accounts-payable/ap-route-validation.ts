import type { Response } from "express";
import { z } from "zod";
import { sendError } from "../../api-response";

const PAYMENT_METHODS = [
  "CASH",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "BANK_TRANSFER",
  "CHECK",
  "PAYPAL",
  "OTHER",
] as const;

/** Path / query IDs: positive integers only. */
export function parseRouteId(res: Response, raw: string | undefined, label: string): number | null {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
    sendError(res, 400, "INVALID_ID", `Invalid ${label}: expected a positive integer.`);
    return null;
  }
  return id;
}

/** POST /api/ap/invoices/:id/match and POST /api/invoices/:id/match body (optional tolerances). */
export const apInvoiceMatchBodySchema = z
  .object({
    priceTolerancePct: z.coerce.number().min(0).max(100).optional(),
    quantityTolerancePct: z.coerce.number().min(0).max(100).optional(),
    taxTolerancePct: z.coerce.number().min(0).max(100).optional(),
  })
  .strict();

/** POST /api/ap/captures/:id/promote */
export const apPromoteCaptureBodySchema = z
  .object({
    overrideReason: z.string().max(4000).optional(),
  })
  .strict();

/** Shared AP approval/release actions with explicit override audit context. */
export const apApprovalActionBodySchema = z
  .object({
    adminOverride: z.boolean().optional(),
    overrideReason: z.string().trim().max(4000).optional(),
    comment: z.string().trim().max(4000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.adminOverride && !value.overrideReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overrideReason is required when adminOverride is true.",
        path: ["overrideReason"],
      });
    }
  });

/** POST /api/ap/payment-batches */
export const apPaymentBatchCreateSchema = z.object({
  batchNumber: z.string().optional(),
  status: z.string().optional(),
  scheduledDate: z
    .preprocess((v) => (v === "" || v === null ? undefined : v), z.union([z.string(), z.undefined()]).optional()),
  paymentMethod: z.enum(PAYMENT_METHODS),
  exportMetadata: z.unknown().optional(),
  notes: z.string().optional(),
  invoiceIds: z.array(z.coerce.number().int().positive()).min(1, "Select at least one invoice"),
});

/** POST /api/invoices/:invoiceId/items */
export const legacyInvoiceItemCreateSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discount: z.coerce.number().optional(),
  taxRate: z.coerce.number().nonnegative().optional(),
  taxAmount: z.coerce.number().nonnegative().optional(),
  totalPrice: z.coerce.number().nonnegative(),
});

/** PATCH /api/invoices/:invoiceId/items/:itemId */
export const legacyInvoiceItemPatchSchema = z
  .object({
    quantity: z.coerce.number().positive().optional(),
    unitPrice: z.coerce.number().nonnegative().optional(),
    discount: z.coerce.number().optional(),
    taxRate: z.coerce.number().optional(),
    taxAmount: z.coerce.number().optional(),
    totalPrice: z.coerce.number().optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field is required to update a line." });
