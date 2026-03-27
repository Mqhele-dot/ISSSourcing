import { z } from "zod";

export const supplierFormSchema = z.object({
  name: z.string().min(2, "Supplier name must be at least 2 characters"),
  contactName: z.string().nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  taxIdentificationNumber: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankSwift: z.string().nullable().optional(),
  paymentTermsId: z.number().int().positive().nullable().optional(),
  defaultCurrencyCode: z.string().nullable().optional(),
  insuranceExpiry: z.string().nullable().optional(),
  complianceNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

export const emptySupplierFormValues = (): SupplierFormValues => ({
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  taxIdentificationNumber: "",
  bankName: "",
  bankAccountNumber: "",
  bankSwift: "",
  paymentTermsId: null,
  defaultCurrencyCode: "",
  insuranceExpiry: "",
  complianceNotes: "",
  notes: "",
});
