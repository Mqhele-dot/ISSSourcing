import type {SpendDimensions} from "./spend-cube";
export const financialMeasureDefinitions = {
  ordered: { label: "Ordered value", dateBasis: "order_date", taxBasis: "document_gross" },
  open_commitment: { label: "Open PO commitment", dateBasis: "order_date", taxBasis: "line_net" },
  received: { label: "Received value", dateBasis: "received_date", taxBasis: "receipt_net" },
  invoiced: { label: "Invoiced value", dateBasis: "issue_date", taxBasis: "document_gross" },
  recorded_payments: { label: "Recorded payments", dateBasis: "payment_date", taxBasis: "payment_amount", notice: "Recorded payments are not proof of bank settlement." },
  ap_outstanding: {label:"Approved AP outstanding",dateBasis:"as_of_balance_issue_date_fx",taxBasis:"remaining_document_gross",notice:"Approved unpaid obligations only; excludes disputed and unapproved exposure. Recorded payments are not proof of bank settlement."},
  ap_disputed: {label:"Disputed AP exposure",dateBasis:"as_of_balance_issue_date_fx",taxBasis:"remaining_document_gross"},
  ap_unapproved: {label:"Unapproved AP exposure",dateBasis:"as_of_balance_issue_date_fx",taxBasis:"remaining_document_gross"},
} as const;
export type FinancialMeasure = keyof typeof financialMeasureDefinitions;
export const financialMeasureKeys=["ordered","open_commitment","received","invoiced","recorded_payments","ap_outstanding","ap_disputed","ap_unapproved"] as const;
export function isApBalanceMeasure(measure:string):boolean {return ["ap_outstanding","ap_disputed","ap_unapproved"].includes(measure);}
export function financialMeasureResource(measure:FinancialMeasure):"finance"|"purchases" {return isApBalanceMeasure(measure)||["invoiced","recorded_payments"].includes(measure)?"finance":"purchases";}
export type FinancialEvidenceState = "complete" | "partial" | "unavailable" | "empty" | "setup_required";
export type FinancialExclusion = "missing_currency" | "missing_date" | "invalid_amount" | "missing_price_evidence" | "missing_approved_fx" | "missing_balance_history" | "unverified_balance_actor" | "balance_source_deleted" | "unreconciled_balance" | "unknown_invoice_status";
export interface FinancialContribution {
  dimensions?:SpendDimensions;
  sourceType: string;
  sourceId: string;
  sourceRevision: string;
  date: string | null;
  amount: string | null;
  currencyCode: string | null;
  exclusion?: FinancialExclusion;
  balanceEventId?:string|null;
  baselineId?:string|null;
  coverageStartsAt?:string|null;
  dueDate?:string|null;
  asOf?:string;
  balanceStatus?:string|null;
  historyRecordedAt?:string|null;
  correctionId?:string|null;
  targetEventId?:string|null;
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
  appliedAt?: string;
  publicationProvenance?: "applied" | "legacy_recorded";
  withdrawn?: boolean;
  supersededAt: string | null;
}
