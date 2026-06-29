export type Supplier = { id: number; name: string };
export type Invoice = {
  id: number;
  invoiceNumber: string;
  supplierId: number | null;
  status: string;
  dueDate: string | null;
  total: number | null;
  dueAmount: number | null;
  purchaseOrderId: number | null;
  latestMatchResult?: {
    id?: number;
    status?: string | null;
    matched?: boolean | null;
    mismatchSummary?: Array<{ message?: string; type?: string; code?: string }> | null;
    updatedAt?: string | null;
    createdAt?: string | null;
  } | null;
};
export type Capture = {
  id: number;
  source: string;
  status: string;
  supplierId: number | null;
  invoiceNumber: string | null;
  totalAmount: number | null;
  confidenceScore: number | null;
  warnings: string[] | null;
  promotedInvoiceId: number | null;
  createdAt: string;
};
export type MatchException = {
  id: number;
  invoiceId: number;
  status: string;
  mismatchCount: number;
  mismatchSummary: Array<{ message?: string; type?: string; code?: string }>;
  updatedAt: string;
};
export type PaymentBatch = {
  id: number;
  batchNumber: string;
  status: string;
  totalAmount: number;
  scheduledDate: string | null;
  items: Array<{ id: number; invoiceId: number; amount: number; status: string }>;
  createdBy?: number | null;
};
export type Overview = {
  invoiceCount: number;
  pendingApprovalCount: number;
  approvedCount: number;
  disputedCount: number;
  overdueCount: number;
  captureReviewCount: number;
  readyToPromoteCount: number;
  exceptionCount: number;
  paymentBatchCount: number;
  pendingPaymentBatchCount: number;
  outstandingAmount: number;
};
export type ApprovalQueue = {
  invoices: Invoice[];
  paymentBatches: PaymentBatch[];
};
export type Exceptions = {
  captureExceptions: Capture[];
  matchExceptions: MatchException[];
  disputedInvoices: Invoice[];
};
export type ApprovalPreview = {
  suggestedApprovers: Array<{ username: string; approvalLevel: number }>;
};

export type ApWorkspaceTab = "intake" | "approvals" | "exceptions" | "payments";

export const AP_WORKSPACE_TAB_ORDER: readonly ApWorkspaceTab[] = [
  "intake",
  "approvals",
  "exceptions",
  "payments",
];

export function isApWorkspaceTab(value: string | undefined): value is ApWorkspaceTab {
  return Boolean(value && (AP_WORKSPACE_TAB_ORDER as readonly string[]).includes(value));
}
