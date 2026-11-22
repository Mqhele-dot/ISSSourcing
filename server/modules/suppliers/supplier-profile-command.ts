import { insertSupplierSchema } from "@shared/schema";
import type { z } from "zod";

// The persistence schema is also used by trusted writers. Do not use it as the
// public command schema: row ownership and decision evidence are server-owned.
const protectedFields = {
  organizationId: true,
  createdByUserId: true,
  approvedAt: true,
  approvedByUserId: true,
  onboardingStatus: true,
  complianceStatus: true,
} as const;

const bankingFields = { bankName: true, bankAccountNumber: true, bankSwift: true } as const;
export const supplierProfileCommandSchema = insertSupplierSchema.omit({ ...protectedFields, ...bankingFields });
export const supplierProfilePatchSchema = supplierProfileCommandSchema.partial();
export type SupplierProfileCommand = z.infer<typeof supplierProfileCommandSchema>;
export type SupplierProfilePatch = z.infer<typeof supplierProfilePatchSchema>;

const protectedKeys = Object.keys(protectedFields).flatMap(field => [
  field, field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
]);
const bankingKeys = Object.keys(bankingFields).flatMap(field => [
  field, field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
]);

export function hasSupplierDecisionFields(input: unknown): boolean {
  return input !== null && typeof input === "object" && protectedKeys.some(key => Object.hasOwn(input, key));
}

export function hasSupplierBankingFields(input: unknown): boolean {
  return input !== null && typeof input === "object" && bankingKeys.some(key => Object.hasOwn(input, key));
}
