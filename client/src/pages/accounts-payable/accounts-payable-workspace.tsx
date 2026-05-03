import { useEffect, useMemo, useState } from "react";
import { Link, Redirect, useLocation, useRoute } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { ApIntakePanel } from "./ap-intake-panel";
import { ApApprovalsPanel } from "./ap-approvals-panel";
import { ApExceptionsPanel } from "./ap-exceptions-panel";
import { ApPaymentsPanel } from "./ap-payments-panel";
import { ApOverviewHeader } from "./ap-overview-header";
import { useApWorkspaceQueries } from "./use-ap-workspace-queries";
import { useApWorkspaceMutations } from "./use-ap-workspace-mutations";
import { useApIntakeFormState } from "./use-ap-intake-form-state";
import { parseApIntakeForSubmit, parsePaymentBatchForSubmit } from "./validation";
import type { ApWorkspaceTab } from "./types";
import { isApWorkspaceTab } from "./types";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";

const TAB_TO_ROUTE: Record<ApWorkspaceTab, string> = {
  intake: APP_ROUTES.finance.accountsPayableIntake,
  approvals: APP_ROUTES.finance.accountsPayableApprovals,
  exceptions: APP_ROUTES.finance.accountsPayableExceptions,
  payments: APP_ROUTES.finance.accountsPayablePayments,
};

export default function AccountsPayableWorkspace() {
  const productSetupComplete = useProductSetupComplete();
  const { toast } = useToast();
  const { formatMoney } = useReportingMoney();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/finance/accounts-payable/:section");

  const [captureSupplierId, setCaptureSupplierId] = useState("none");
  const [captureSource, setCaptureSource] = useState("manual_upload");
  const [captureInvoiceNumber, setCaptureInvoiceNumber] = useState("");
  const [captureTotalAmount, setCaptureTotalAmount] = useState("");
  const [captureConfidence, setCaptureConfidence] = useState("0.85");
  const [captureNotes, setCaptureNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [scheduledDate, setScheduledDate] = useState("");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<number[]>([]);
  const [paymentBatchErrors, setPaymentBatchErrors] = useState<string[]>([]);

  const { intakeErrors, validateForSubmit } = useApIntakeFormState({
    supplierId: captureSupplierId,
    source: captureSource,
    invoiceNumber: captureInvoiceNumber,
    totalAmountRaw: captureTotalAmount,
    confidenceRaw: captureConfidence,
    notes: captureNotes,
  });

  const queries = useApWorkspaceQueries();
  const mutations = useApWorkspaceMutations({ toast });

  const {
    overview,
    suppliers,
    captures,
    approvalQueue,
    exceptions,
    paymentBatches,
    invoices,
    readyForBatch,
    overviewQuery,
    suppliersQuery,
    capturesQuery,
    approvalQueueQuery,
    exceptionsQuery,
    paymentBatchesQuery,
    invoicesQuery,
  } = queries;

  const overviewLoading = overviewQuery.isPending && !overviewQuery.data;
  const overviewErr = overviewQuery.isError ? overviewQuery.error : null;

  const partialWorkspaceDataError =
    !overviewErr &&
    Boolean(overview) &&
    overviewQuery.isFetched &&
    (suppliersQuery.isError ||
      capturesQuery.isError ||
      approvalQueueQuery.isError ||
      exceptionsQuery.isError ||
      paymentBatchesQuery.isError ||
      invoicesQuery.isError);

  const section = params?.section;
  const activeTab = isApWorkspaceTab(section) ? section : null;

  const selectedReadyInvoices = useMemo(
    () => readyForBatch.filter((invoice) => selectedInvoiceIds.includes(invoice.id)),
    [readyForBatch, selectedInvoiceIds],
  );

  const selectedBatchTotal = useMemo(
    () =>
      selectedReadyInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.dueAmount ?? invoice.total ?? 0),
        0,
      ),
    [selectedReadyInvoices],
  );

  useEffect(() => {
    setPaymentBatchErrors([]);
  }, [selectedInvoiceIds, paymentMethod, scheduledDate]);

  const toggleInvoiceSelection = (invoiceId: number, checked: boolean) => {
    setSelectedInvoiceIds((current) =>
      checked ? [...current, invoiceId] : current.filter((candidate) => candidate !== invoiceId),
    );
  };

  const onSubmitCapture = () => {
    if (!validateForSubmit()) return;
    const parsed = parseApIntakeForSubmit({
      supplierId: captureSupplierId,
      totalAmountRaw: captureTotalAmount,
      confidenceRaw: captureConfidence,
    });
    if (!parsed.ok) return;
    mutations.createCaptureMutation.mutate(
      {
        supplierId: Number(parsed.data.supplierId),
        source: captureSource,
        invoiceNumber: captureInvoiceNumber.trim() || undefined,
        totalAmount: Number(parsed.data.totalAmountRaw),
        confidenceScore: Number(parsed.data.confidenceRaw),
        reviewerNotes: captureNotes.trim() || undefined,
        extractedHeader: {
          enteredFrom: "accounts-payable-workspace",
        },
        extractedLines: [],
      },
      {
        onSuccess: () => {
          setCaptureInvoiceNumber("");
          setCaptureTotalAmount("");
          setCaptureConfidence("0.85");
          setCaptureNotes("");
        },
      },
    );
  };

  const onCreateBatch = () => {
    const parsed = parsePaymentBatchForSubmit({
      selectedInvoiceIds,
      paymentMethod,
      scheduledDateRaw: scheduledDate,
    });
    if (!parsed.ok) {
      setPaymentBatchErrors(parsed.errors);
      return;
    }
    setPaymentBatchErrors([]);
    mutations.createBatchMutation.mutate(
      {
        paymentMethod: parsed.data.paymentMethod,
        scheduledDate: parsed.data.scheduledDateRaw || undefined,
        invoiceIds: parsed.data.selectedInvoiceIds,
      },
      {
        onSuccess: () => {
          setSelectedInvoiceIds([]);
          setScheduledDate("");
        },
      },
    );
  };

  if (!match || !activeTab) {
    return <Redirect to={APP_ROUTES.finance.accountsPayableIntake} />;
  }

  return (
    <PageShell variant="wide-table" data-testid="accounts-payable-page">
      <PageHeader
        title="Accounts payable"
        titleTestId="page-title"
        subtitle="Enterprise AP inbox, approvals, exception handling, and payment batching."
        breadcrumb={<span>Finance / Accounts payable</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.admin.documentExtractor}>Document extractor</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.finance.approvalPolicies}>Approval policies</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.finance.invoices}>Legacy invoices</Link>
            </Button>
          </div>
        }
      />

      {overviewLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Loading AP overview…
        </div>
      ) : null}

      {overviewErr ? (
        <Alert variant="destructive">
          <AlertTitle>AP overview unavailable</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>{overviewErr instanceof Error ? overviewErr.message : String(overviewErr)}</span>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void overviewQuery.refetch()}>
              Retry overview
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {overview ? <ApOverviewHeader stats={overview} formatMoney={formatMoney} /> : null}

      {partialWorkspaceDataError ? (
        <Alert>
          <AlertTitle>Partial workspace load</AlertTitle>
          <AlertDescription className="text-sm">
            The AP overview loaded, but at least one list (suppliers, captures, queue, invoices, exceptions, or batches)
            failed. Open the affected tab and use its retry actions—each tab reflects its own data status.
          </AlertDescription>
        </Alert>
      ) : null}

      {!overviewQuery.isFetched && !overviewErr ? (
        <p className="text-sm text-muted-foreground">Preparing workspace requests…</p>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(next) => {
          const tab = next as ApWorkspaceTab;
          if (isApWorkspaceTab(tab)) {
            setLocation(TAB_TO_ROUTE[tab]);
          }
        }}
        className="space-y-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="intake" className="space-y-4">
          {suppliersQuery.isError || capturesQuery.isError ? (
            <Alert>
              <AlertTitle>Some intake lists failed to load</AlertTitle>
              <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>You can retry suppliers or captures independently of the overview.</span>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void suppliersQuery.refetch()}>
                    Retry suppliers
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void capturesQuery.refetch()}>
                    Retry captures
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {!capturesQuery.isError &&
          !capturesQuery.isPending &&
          capturesQuery.isFetched &&
          captures.length === 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">No invoice captures yet</CardTitle>
                      <CardDescription>
                        {productSetupComplete
                          ? "Stage a capture below or run documents through the extractor."
                          : "Finish product setup so suppliers, currency, and defaults align with intake."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {productSetupComplete ? (
                        <>
                          <Button asChild size="sm">
                            <Link href={APP_ROUTES.admin.documentExtractor}>Document extractor</Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={APP_ROUTES.procurement.suppliers}>Suppliers</Link>
                          </Button>
                        </>
                      ) : (
                        <Button asChild size="sm">
                          <Link href={APP_ROUTES.setup.product}>Continue product setup</Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
                <ApIntakePanel
                  suppliers={suppliers}
                  captures={captures}
                  captureSupplierId={captureSupplierId}
                  setCaptureSupplierId={setCaptureSupplierId}
                  captureSource={captureSource}
                  setCaptureSource={setCaptureSource}
                  captureInvoiceNumber={captureInvoiceNumber}
                  setCaptureInvoiceNumber={setCaptureInvoiceNumber}
                  captureTotalAmount={captureTotalAmount}
                  setCaptureTotalAmount={setCaptureTotalAmount}
                  captureConfidence={captureConfidence}
                  setCaptureConfidence={setCaptureConfidence}
                  captureNotes={captureNotes}
                  setCaptureNotes={setCaptureNotes}
                  intakeErrors={intakeErrors}
                  formatMoney={formatMoney}
                  createCaptureMutation={mutations.createCaptureMutation}
                  promoteCaptureMutation={mutations.promoteCaptureMutation}
                  onSubmitCapture={onSubmitCapture}
                />
        </TabsContent>

        <TabsContent value="approvals" className="space-y-4">
          {invoicesQuery.isError || approvalQueueQuery.isError ? (
            <Alert>
              <AlertTitle>Some approvals data failed to load</AlertTitle>
              <AlertDescription className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void invoicesQuery.refetch()}>
                  Retry invoices
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void approvalQueueQuery.refetch()}>
                  Retry queue
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <ApApprovalsPanel
                  invoices={invoices}
                  approvalQueue={approvalQueue}
                  invoicesLoadFailed={invoicesQuery.isError}
                  queueLoadFailed={approvalQueueQuery.isError}
                  formatMoney={formatMoney}
                  previewApproversMutation={mutations.previewApproversMutation}
                  matchInvoiceMutation={mutations.matchInvoiceMutation}
                  submitApprovalMutation={mutations.submitApprovalMutation}
                  approveInvoiceMutation={mutations.approveInvoiceMutation}
                  rejectInvoiceMutation={mutations.rejectInvoiceMutation}
                />
        </TabsContent>

        <TabsContent value="exceptions" className="space-y-4">
          {exceptionsQuery.isError ? (
            <Alert>
              <AlertTitle>Exceptions could not be loaded</AlertTitle>
              <AlertDescription className="mt-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void exceptionsQuery.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <ApExceptionsPanel exceptions={exceptions} formatMoney={formatMoney} loadFailed={exceptionsQuery.isError} />
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          {paymentBatchesQuery.isError || invoicesQuery.isError ? (
            <Alert>
              <AlertTitle>Some payments data failed to load</AlertTitle>
              <AlertDescription className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void paymentBatchesQuery.refetch()}>
                  Retry batches
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void invoicesQuery.refetch()}>
                  Retry invoices
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <ApPaymentsPanel
                  readyForBatch={readyForBatch}
                  invoicesLoadFailed={invoicesQuery.isError}
                  batchesLoadFailed={paymentBatchesQuery.isError}
                  selectedInvoiceIds={selectedInvoiceIds}
                  toggleInvoiceSelection={toggleInvoiceSelection}
                  selectedBatchTotal={selectedBatchTotal}
                  paymentMethod={paymentMethod}
                  setPaymentMethod={setPaymentMethod}
                  scheduledDate={scheduledDate}
                  setScheduledDate={setScheduledDate}
                  paymentBatchErrors={paymentBatchErrors}
                  formatMoney={formatMoney}
                  paymentBatches={paymentBatches}
                  createBatchMutation={mutations.createBatchMutation}
                  approveBatchMutation={mutations.approveBatchMutation}
                  releaseBatchMutation={mutations.releaseBatchMutation}
                  onCreateBatch={onCreateBatch}
                />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
