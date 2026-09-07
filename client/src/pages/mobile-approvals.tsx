import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  FileStack,
  ReceiptText,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { fetchPurchaseOrdersEnvelope } from "@/api/client";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { requestJson } from "@/lib/queryClient";

type PurchaseRequisitionListEntry = {
  id: number;
  requisitionNumber?: string | null;
  status?: string | null;
  totalAmount?: number | null;
};

type ApprovalPolicyEntry = {
  id: number;
  name?: string | null;
  entityType?: string | null;
  isActive?: boolean | null;
};

type ApprovalQueueResponse = {
  invoices: Array<{ id: number; invoiceNumber: string }>;
  paymentBatches: Array<{ id: number; batchNumber: string }>;
};

type ApprovalCardModel = {
  key: string;
  href: string;
  title: string;
  description: string;
  count: number;
  icon: typeof ClipboardList;
  tone?: "default" | "warning";
  detail: string;
};

function normalizeArrayResponse<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object" && "data" in raw && Array.isArray((raw as { data: unknown }).data)) {
    return (raw as { data: T[] }).data;
  }
  return [];
}

export default function MobileApprovalsPage() {
  const requisitionsQuery = useQuery({
    queryKey: ["/api/purchase-requisitions", "mobile-approvals"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/purchase-requisitions");
      return normalizeArrayResponse<PurchaseRequisitionListEntry>(raw);
    },
    throwOnError: false,
  });

  const purchaseOrdersQuery = useQuery({
    queryKey: ["/api/purchase-orders", "mobile-approvals-open"],
    queryFn: async () => {
      const envelope = await fetchPurchaseOrdersEnvelope({ status: "open" });
      return envelope.data;
    },
    throwOnError: false,
  });

  const approvalQueueQuery = useQuery({
    queryKey: ["/api/ap/approval-queue", "mobile-approvals"],
    queryFn: () => requestJson<ApprovalQueueResponse>("GET", "/api/ap/approval-queue"),
    throwOnError: false,
  });

  const approvalPoliciesQuery = useQuery({
    queryKey: ["/api/approval-policies", "mobile-approvals"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/approval-policies");
      return normalizeArrayResponse<ApprovalPolicyEntry>(raw);
    },
    throwOnError: false,
  });

  const approvalCards = useMemo<ApprovalCardModel[]>(() => {
    const pendingRequisitions = (requisitionsQuery.data ?? []).filter(
      (row) => String(row.status ?? "").trim().toUpperCase() === "PENDING",
    );
    const openPurchaseOrders = purchaseOrdersQuery.data ?? [];
    const approvalQueue = approvalQueueQuery.data ?? { invoices: [], paymentBatches: [] };
    const activePolicies = (approvalPoliciesQuery.data ?? []).filter((row) => row.isActive !== false);
    const firstRequisition = pendingRequisitions[0];
    const firstPurchaseOrder = openPurchaseOrders[0];
    const firstInvoice = approvalQueue.invoices[0];
    const firstBatch = approvalQueue.paymentBatches[0];
    const firstPolicy = activePolicies[0];
    const apApprovalCount = approvalQueue.invoices.length + approvalQueue.paymentBatches.length;

    return [
      {
        key: "requisitions",
        href: APP_ROUTES.procurement.requisitions,
        title: "Requisitions waiting",
        description: "Demand requests still waiting for approval before PO creation.",
        count: pendingRequisitions.length,
        icon: FileStack,
        tone: pendingRequisitions.length > 0 ? "warning" : "default",
        detail: firstRequisition?.requisitionNumber
          ? `Next requisition: ${firstRequisition.requisitionNumber}`
          : "No requisitions are currently waiting for approval.",
      },
      {
        key: "purchase-orders",
        href: APP_ROUTES.procurement.orders,
        title: "PO approvals",
        description: "Purchase orders in the open state still awaiting approval or send decisions.",
        count: openPurchaseOrders.length,
        icon: ClipboardList,
        tone: openPurchaseOrders.length > 0 ? "warning" : "default",
        detail: firstPurchaseOrder?.poNumber
          ? `Next PO in queue: ${firstPurchaseOrder.poNumber}`
          : "No purchase orders are waiting for approval right now.",
      },
      {
        key: "ap",
        href: APP_ROUTES.finance.accountsPayableApprovals,
        title: "AP approvals",
        description: "Invoice and payment approvals blocking payables downstream.",
        count: apApprovalCount,
        icon: ReceiptText,
        tone: apApprovalCount > 0 ? "warning" : "default",
        detail: firstInvoice
          ? `Invoice ${firstInvoice.invoiceNumber} is waiting for approval.`
          : firstBatch
            ? `Payment batch ${firstBatch.batchNumber} is waiting for approval.`
            : "No AP approvals are waiting right now.",
      },
      {
        key: "policies",
        href: APP_ROUTES.finance.approvalPolicies,
        title: "Policy coverage",
        description: "Active approval rules that back procurement and finance decisions.",
        count: activePolicies.length,
        icon: Settings2,
        tone: activePolicies.length === 0 ? "warning" : "default",
        detail: firstPolicy?.name
          ? `${firstPolicy.name} is active for ${String(firstPolicy.entityType ?? "workflow").replaceAll("_", " ")}.`
          : "No active approval policies found; review the desktop policy center.",
      },
    ];
  }, [approvalPoliciesQuery.data, approvalQueueQuery.data, purchaseOrdersQuery.data, requisitionsQuery.data]);

  const loading =
    requisitionsQuery.isLoading ||
    purchaseOrdersQuery.isLoading ||
    approvalQueueQuery.isLoading ||
    approvalPoliciesQuery.isLoading;
  const failedFeeds = [
    requisitionsQuery.isError ? "requisitions" : null,
    purchaseOrdersQuery.isError ? "purchase orders" : null,
    approvalQueueQuery.isError ? "AP approvals" : null,
    approvalPoliciesQuery.isError ? "approval policies" : null,
  ].filter((value): value is string => value !== null);

  return (
    <div className="space-y-4 p-4" data-testid="mobile-approvals-page">
      <PageHeader
        title="Approvals"
        description="Live procurement and payables approval queues for the mobile shell"
      />

      <Card className="border-primary/20 bg-primary/5" data-testid="mobile-approvals-summary-card">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div className="space-y-1">
            <p className="font-semibold">Clear the queues that unblock buying, receiving, and payment</p>
            <p className="text-sm text-muted-foreground">
              Requisition, PO, and AP approvals stay visible in one mobile hub so supervisors can see which desk-side
              decision is holding back the floor.
            </p>
          </div>
        </CardContent>
      </Card>

      {failedFeeds.length > 0 ? (
        <Alert variant="destructive" data-testid="mobile-approvals-partial-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some approval feeds could not load</AlertTitle>
          <AlertDescription>
            {`The page is still usable, but ${failedFeeds.join(", ")} did not refresh. Open the destination workflow or desktop control center to retry.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3">
        {approvalCards.map(({ key, href, title, description, count, icon: Icon, tone = "default", detail }) => (
          <Link key={key} href={href}>
            <Card
              className={`transition-colors active:bg-accent/60 ${tone === "warning" ? "border-amber-500/40 bg-amber-500/5" : "hover:bg-accent/40"}`}
              data-testid={`mobile-approval-card-${key}`}
            >
              <CardContent className="flex items-start gap-3 p-4">
                <div className={`rounded-xl p-2 ${tone === "warning" ? "bg-amber-500/15 text-amber-700" : "bg-primary/10 text-primary"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold leading-tight">{title}</p>
                    <Badge variant={count > 0 ? "default" : "outline"}>{loading ? "..." : count}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{description}</p>
                  <p className="text-xs text-muted-foreground">{loading ? "Refreshing queue..." : detail}</p>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild variant="outline" className="justify-start gap-2">
          <Link href={APP_ROUTES.operations.controlTower}>
            <RefreshCw className="h-4 w-4" />
            Control tower
          </Link>
        </Button>
        <Button asChild variant="outline" className="justify-start gap-2">
          <Link href={APP_ROUTES.operations.mobileTasks}>
            <ClipboardList className="h-4 w-4" />
            Back to mobile tasks
          </Link>
        </Button>
      </div>
    </div>
  );
}
