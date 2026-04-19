import { useEffect, useMemo, useState } from "react";
import { Link, Redirect, useLocation, useRoute } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    isLoading,
    isError,
    error,
    refetch,
  } = queries;

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
    <PageShell variant="wide-table">
      <PageHeader
        title="Accounts payable"
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

      <DataState
        loading={isLoading}
        error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
        data={overview ?? null}
        isEmpty={() => false}
        emptyTitle="No AP overview"
        onRetry={() => void refetch()}
      >
        {(stats) => (
          <>
            <ApOverviewHeader stats={stats} formatMoney={formatMoney} />

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
                {captures.length === 0 ? (
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
                <ApApprovalsPanel
                  invoices={invoices}
                  approvalQueue={approvalQueue}
                  formatMoney={formatMoney}
                  previewApproversMutation={mutations.previewApproversMutation}
                  matchInvoiceMutation={mutations.matchInvoiceMutation}
                  submitApprovalMutation={mutations.submitApprovalMutation}
                  approveInvoiceMutation={mutations.approveInvoiceMutation}
                  rejectInvoiceMutation={mutations.rejectInvoiceMutation}
                />
              </TabsContent>

              <TabsContent value="exceptions" className="space-y-4">
                <ApExceptionsPanel exceptions={exceptions} formatMoney={formatMoney} />
              </TabsContent>

              <TabsContent value="payments" className="space-y-4">
                <ApPaymentsPanel
                  readyForBatch={readyForBatch}
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
          </>
        )}
      </DataState>
    </PageShell>
  );
}
