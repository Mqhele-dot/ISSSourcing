export const financialMeasureDefinitions = {
  ordered: { label: "Ordered value", dateBasis: "order_date", taxBasis: "document_gross" },
  open_commitment: { label: "Open PO commitment", dateBasis: "order_date", taxBasis: "line_net" },
  received: { label: "Received value", dateBasis: "received_date", taxBasis: "receipt_net" },
  invoiced: { label: "Invoiced value", dateBasis: "issue_date", taxBasis: "document_gross" },
  recorded_payments: { label: "Recorded payments", dateBasis: "payment_date", taxBasis: "payment_amount", notice: "Recorded payments are not proof of bank settlement." },
} as const;
export type FinancialMeasure = keyof typeof financialMeasureDefinitions;
export type FinancialEvidenceState = "complete" | "partial" | "unavailable" | "empty" | "setup_required";
export type FinancialExclusion = "missing_currency" | "missing_date" | "invalid_amount" | "missing_price_evidence" | "missing_approved_fx";
export interface FinancialContribution {
  sourceType: string;
  sourceId: string;
  sourceRevision: string;
  date: string | null;
  amount: string | null;
  currencyCode: string | null;
  exclusion?: FinancialExclusion;
}
export interface ApprovedReportingRate {
  id: string;
  version: number;
  organizationId: number;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: string;
  effectiveAt: string;
  expiresAt: string | null;
  approvedAt: string;
  supersededAt: string | null;
}
