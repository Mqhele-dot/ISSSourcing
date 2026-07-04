import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { fetchInventory, fetchPurchaseOrdersEnvelope } from "@/api/client";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { requestJson } from "@/lib/queryClient";

type MobileCountsResponse = {
  sessions: Array<{
    id: number;
    status?: string | null;
    mode?: string | null;
    warehouseName?: string | null;
  }>;
};

type ApprovalQueueResponse = {
  invoices: Array<{ id: number; invoiceNumber: string }>;
  paymentBatches: Array<{ id: number; batchNumber: string }>;
};

type TaskCardModel = {
  key: string;
  href: string;
  title: string;
  description: string;
  count: number;
  icon: typeof ClipboardList;
  tone?: "default" | "warning";
  detail: string;
};

export default function MobileHubTasksPage() {
  const countsQuery = useQuery({
    queryKey: ["/api/mobile/counts/assigned", "tasks"],
    queryFn: () => requestJson<MobileCountsResponse>("GET", "/api/mobile/counts/assigned"),
    throwOnError: false,
  });

  const lowStockQuery = useQuery({
    queryKey: ["/api/inventory", "low-stock", "mobile-tasks"],
    queryFn: () => fetchInventory({ lowStock: true }),
    throwOnError: false,
  });

  const receiveQueueQuery = useQuery({
    queryKey: ["/api/purchase-orders", "mobile-receive-queue"],
    queryFn: async () => {
      const [approved, sent, partial] = await Promise.all([
        fetchPurchaseOrdersEnvelope({ status: "approved" }),
        fetchPurchaseOrdersEnvelope({ status: "sent" }),
        fetchPurchaseOrdersEnvelope({ status: "partially_received" }),
      ]);
      const merged = [...approved.data, ...sent.data, ...partial.data];
      const uniquePoNumbers = new Set(merged.map((order) => order.poNumber));
      return {
        count: uniquePoNumbers.size,
        nextPo:
          merged
            .slice()
            .sort((a, b) => String(b.poNumber).localeCompare(String(a.poNumber)))[0]
            ?.poNumber ?? null,
      };
    },
    throwOnError: false,
  });

  const approvalQueueQuery = useQuery({
    queryKey: ["/api/ap/approval-queue", "mobile-tasks"],
    queryFn: () => requestJson<ApprovalQueueResponse>("GET", "/api/ap/approval-queue"),
    throwOnError: false,
  });

  const taskCards = useMemo<TaskCardModel[]>(() => {
    const assignedSessions = countsQuery.data?.sessions ?? [];
    const lowStockRows = lowStockQuery.data ?? [];
    const approvalQueue = approvalQueueQuery.data ?? { invoices: [], paymentBatches: [] };
    const approvalCount = approvalQueue.invoices.length + approvalQueue.paymentBatches.length;
    const receiveCount = receiveQueueQuery.data?.count ?? 0;
    const firstCountSession = assignedSessions[0];
    const firstLowStock = lowStockRows[0];
    const firstInvoice = approvalQueue.invoices[0];
    const firstBatch = approvalQueue.paymentBatches[0];

    return [
      {
        key: "counts",
        href: APP_ROUTES.operations.mobileCounts,
        title: "Counts assigned",
        description: "Blind and spot counts ready for floor execution.",
        count: assignedSessions.length,
        icon: ClipboardList,
        detail: firstCountSession
          ? `${firstCountSession.mode === "spot" ? "Spot" : "Cycle"} count at ${firstCountSession.warehouseName ?? "assigned warehouse"}`
          : "No assigned count sessions right now.",
      },
      {
        key: "receive",
        href: APP_ROUTES.operations.mobileReceive,
        title: "Receipts waiting",
        description: "Approved and sent POs that can take a real mobile receipt.",
        count: receiveCount,
        icon: PackageCheck,
        detail: receiveQueueQuery.data?.nextPo
          ? `Next PO in queue: ${receiveQueueQuery.data.nextPo}`
          : "No purchase orders are currently ready for receipt.",
      },
      {
        key: "pick",
        href: APP_ROUTES.operations.mobilePick,
        title: "Low-stock picks",
        description: "Items below threshold that need replenishment or floor action.",
        count: lowStockRows.length,
        icon: Smartphone,
        tone: lowStockRows.length > 0 ? "warning" : "default",
        detail: firstLowStock
          ? `${firstLowStock.sku} has ${firstLowStock.available ?? 0} available against threshold ${firstLowStock.lowStockThreshold}.`
          : "No low-stock SKUs are currently flagged.",
      },
      {
        key: "approvals",
        href: APP_ROUTES.operations.mobileApprovals,
        title: "AP approvals",
        description: "Invoice and payment approvals blocking downstream execution.",
        count: approvalCount,
        icon: ReceiptText,
        tone: approvalCount > 0 ? "warning" : "default",
        detail: firstInvoice
          ? `Invoice ${firstInvoice.invoiceNumber} is waiting for approval.`
          : firstBatch
            ? `Payment batch ${firstBatch.batchNumber} is waiting for approval.`
            : "No AP approvals are waiting right now.",
      },
    ];
  }, [approvalQueueQuery.data, countsQuery.data, lowStockQuery.data, receiveQueueQuery.data]);

  const loading = countsQuery.isLoading || lowStockQuery.isLoading || receiveQueueQuery.isLoading || approvalQueueQuery.isLoading;
  const failedFeeds = [
    countsQuery.isError ? "counts" : null,
    lowStockQuery.isError ? "low-stock inventory" : null,
    receiveQueueQuery.isError ? "receiving queue" : null,
    approvalQueueQuery.isError ? "AP approvals" : null,
  ].filter((value): value is string => value !== null);

  return (
    <div className="space-y-4 p-4" data-testid="mobile-hub-tasks-page">
      <PageHeader title="Task list" description="Live operational work queues for the mobile shell" />

      <Card className="border-primary/20 bg-primary/5" data-testid="mobile-tasks-summary-card">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div className="space-y-1">
            <p className="font-semibold">Prioritize work that moves stock and approvals forward</p>
            <p className="text-sm text-muted-foreground">
              Counts, receipts, picks, and AP approvals stay in one mobile queue so floor teams do not have to bounce
              through the desktop navigation to find the next action.
            </p>
          </div>
        </CardContent>
      </Card>

      {failedFeeds.length > 0 ? (
        <Alert variant="destructive" data-testid="mobile-tasks-partial-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some mobile task feeds could not load</AlertTitle>
          <AlertDescription>
            {`The page is still usable, but ${failedFeeds.join(", ")} did not refresh. Retry from the destination workflow or use Desktop operations overview.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3">
        {taskCards.map(({ key, href, title, description, count, icon: Icon, tone = "default", detail }) => (
          <Link key={key} href={href}>
            <Card
              className={`transition-colors active:bg-accent/60 ${tone === "warning" ? "border-amber-500/40 bg-amber-500/5" : "hover:bg-accent/40"}`}
              data-testid={`mobile-task-card-${key}`}
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
          <Link href={APP_ROUTES.inventory.reorder}>
            <RefreshCw className="h-4 w-4" />
            Reorder requests
          </Link>
        </Button>
        <Button asChild variant="outline" className="justify-start gap-2">
          <Link href={APP_ROUTES.operations.root}>
            <ClipboardList className="h-4 w-4" />
            Desktop operations overview
          </Link>
        </Button>
      </div>
    </div>
  );
}
