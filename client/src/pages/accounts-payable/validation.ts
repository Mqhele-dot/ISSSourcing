import { z } from "zod";

const PAYMENT_METHODS = ["BANK_TRANSFER", "CHECK", "PAYPAL"] as const;

export const apIntakeFormSchema = z.object({
  supplierId: z.string().refine((s) => s !== "none", "Choose a supplier"),
  totalAmountRaw: z
    .string()
    .trim()
    .min(1, "Enter a total amount")
    .refine((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0;
    }, "Amount must be a positive number"),
  confidenceRaw: z
    .string()
    .trim()
    .min(1, "Enter confidence")
    .refine((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 && n <= 1;
    }, "Confidence must be between 0 and 1"),
});

export type ApIntakeFormInput = z.infer<typeof apIntakeFormSchema>;

export function parseApIntakeForSubmit(input: {
  supplierId: string;
  totalAmountRaw: string;
  confidenceRaw: string;
}): { ok: true; data: ApIntakeFormInput } | { ok: false; errors: string[] } {
  const r = apIntakeFormSchema.safeParse(input);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((e) => e.message) };
  }
  return { ok: true, data: r.data };
}

export const apPaymentBatchSchema = z.object({
  selectedInvoiceIds: z.array(z.number()).min(1, "Select at least one invoice"),
  paymentMethod: z.enum(PAYMENT_METHODS),
  scheduledDateRaw: z.string().optional(),
});

export function parsePaymentBatchForSubmit(input: {
  selectedInvoiceIds: number[];
  paymentMethod: string;
  scheduledDateRaw: string;
}): { ok: true; data: z.infer<typeof apPaymentBatchSchema> } | { ok: false; errors: string[] } {
  const r = apPaymentBatchSchema.safeParse({
    selectedInvoiceIds: input.selectedInvoiceIds,
    paymentMethod: input.paymentMethod,
    scheduledDateRaw: input.scheduledDateRaw?.trim() || undefined,
  });
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((e) => e.message) };
  }
  if (r.data.scheduledDateRaw) {
    const d = new Date(r.data.scheduledDateRaw);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, errors: ["Scheduled date is not valid"] };
    }
  }
  return { ok: true, data: r.data };
}
