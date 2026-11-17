/** General supplier profiles are not the governed beneficiary/bank authority.
 * Never replace a legacy value with a masked string that a caller could pay.
 * Keep internal supplier rows and immutable business/audit evidence unchanged.
 */
export const SUPPLIER_BANKING_GUIDANCE = "Banking details are not disclosed in supplier profiles. Review Supplier Banks in Master Data with an authorized steward; this profile is not a payment instruction.";
export const SUPPLIER_DISCLOSURE_POLICY = "supplier-profile-no-banking-v1";
const bankingKeys = ["bankName", "bankAccountNumber", "bankSwift", "bank_name", "bank_account_number", "bank_swift"] as const;
export function publicSupplierProfile<T extends object>(source: T) {
  const result = { ...source } as Record<string, unknown>;
  for (const key of bankingKeys) delete result[key];
  return { ...result, bankingDisclosure: "governed_workflow_only" as const } as Omit<T, typeof bankingKeys[number]> & { bankingDisclosure: "governed_workflow_only" };
}
