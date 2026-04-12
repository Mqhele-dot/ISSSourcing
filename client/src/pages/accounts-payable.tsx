import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  FileCheck,
  Files,
  Landmark,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataState } from "@/components/ui/data-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type Supplier = { id: number; name: string };
type Invoice = {
  id: number;
  invoiceNumber: string;
  supplierId: number | null;
  status: string;
  dueDate: string | null;
  total: number | null;
  dueAmount: number | null;
  purchaseOrderId: number | null;
};
type Capture = {
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
type MatchException = {
  id: number;
  invoiceId: number;
  status: string;
  mismatchCount: number;
  mismatchSummary: Array<{ message?: string; type?: string }>;
  updatedAt: string;
};
type PaymentBatch = {
  id: number;
  batchNumber: string;
  status: string;
  totalAmount: number;
  scheduledDate: string | null;
  items: Array<{ id: number; invoiceId: number; amount: number; status: string }>;
};
type Overview = {
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
type ApprovalQueue = {
  invoices: Invoice[];
  paymentBatches: PaymentBatch[];
};
type Exceptions = {
  captureExceptions: Capture[];
  matchExceptions: MatchException[];
  disputedInvoices: Invoice[];
};
type ApprovalPreview = {
  suggestedApprovers: Array<{ username: string; approvalLevel: number }>;
};

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

async function invalidateApViews() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/ap/overview"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/ap/captures"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/ap/approval-queue"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/ap/exceptions"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/ap/payment-batches"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/ap/invoices"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }),
  ]);
}

export default function AccountsPayablePage() {
  const { toast } = useToast();
  const [captureSupplierId, setCaptureSupplierId] = useState("none");
  const [captureSource, setCaptureSource] = useState("manual_upload");
  const [captureInvoiceNumber, setCaptureInvoiceNumber] = useState("");
  const [captureTotalAmount, setCaptureTotalAmount] = useState("");
  const [captureConfidence, setCaptureConfidence] = useState("0.85");
  const [captureNotes, setCaptureNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [scheduledDate, setScheduledDate] = useState("");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<number[]>([]);

  const {
    data: overview,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/ap/overview"],
    queryFn: () => requestJson<Overview>("GET", "/api/ap/overview"),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers", "ap"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
  });

  const { data: captures = [] } = useQuery({
    queryKey: ["/api/ap/captures"],
    queryFn: () => requestJson<Capture[]>("GET", "/api/ap/captures"),
  });

  const { data: approvalQueue = { invoices: [], paymentBatches: [] } } = useQuery({
    queryKey: ["/api/ap/approval-queue"],
    queryFn: () => requestJson<ApprovalQueue>("GET", "/api/ap/approval-queue"),
  });

  const { data: exceptions = { captureExceptions: [], matchExceptions: [], disputedInvoices: [] } } = useQuery({
    queryKey: ["/api/ap/exceptions"],
    queryFn: () => requestJson<Exceptions>("GET", "/api/ap/exceptions"),
  });

  const { data: paymentBatches = [] } = useQuery({
    queryKey: ["/api/ap/payment-batches"],
    queryFn: () => requestJson<PaymentBatch[]>("GET", "/api/ap/payment-batches"),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["/api/ap/invoices"],
    queryFn: () => requestJson<Invoice[]>("GET", "/api/ap/invoices"),
  });

  const readyForBatch = useMemo(
    () => invoices.filter((invoice) => ["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(String(invoice.status))),
    [invoices],
  );

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

  const createCaptureMutation = useMutation({
    mutationFn: async () => {
      if (captureSupplierId === "none") throw new Error("Choose a supplier for the AP capture.");
      return requestJson("POST", "/api/ap/captures", {
        supplierId: Number(captureSupplierId),
        source: captureSource,
        invoiceNumber: captureInvoiceNumber || undefined,
        totalAmount: Number(captureTotalAmount || 0),
        confidenceScore: Number(captureConfidence || 0),
        reviewerNotes: captureNotes || undefined,
        extractedHeader: {
          enteredFrom: "accounts-payable-workspace",
        },
        extractedLines: [],
      });
    },
    onSuccess: async () => {
      setCaptureInvoiceNumber("");
      setCaptureTotalAmount("");
      setCaptureConfidence("0.85");
      setCaptureNotes("");
      await invalidateApViews();
      toast({ title: "AP capture staged", description: "The invoice capture is now in the AP inbox." });
    },
    onError: (mutationError) =>
      toast({
        title: "Capture failed",
        description: mutationError instanceof Error ? mutationError.message : String(mutationError),
        variant: "destructive",
      }),
  });

  const promoteCaptureMutation = useMutation({
    mutationFn: (captureId: number) => requestJson("POST", `/api/ap/captures/${captureId}/promote`),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Capture promoted", description: "The staged invoice has been converted into an AP invoice." });
    },
  });

  const previewApproversMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      requestJson<ApprovalPreview>("GET", `/api/ap/invoices/${invoiceId}/approval-preview`),
    onSuccess: (data) => {
      const summary =
        data.suggestedApprovers.length > 0
          ? data.suggestedApprovers.map((item) => `${item.username} (L${item.approvalLevel})`).join(", ")
          : "No approvers suggested for the current amount band.";
      toast({ title: "Approval preview", description: summary });
    },
    onError: (mutationError) =>
      toast({
        title: "Preview failed",
        description: mutationError instanceof Error ? mutationError.message : String(mutationError),
        variant: "destructive",
      }),
  });

  const submitApprovalMutation = useMutation({
    mutationFn: (invoiceId: number) => requestJson("POST", `/api/ap/invoices/${invoiceId}/submit-approval`, {}),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Invoice queued", description: "The invoice is now awaiting approval." });
    },
  });

  const matchInvoiceMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      requestJson("POST", `/api/ap/invoices/${invoiceId}/match`, {
        priceTolerancePct: 2,
        quantityTolerancePct: 2,
        taxTolerancePct: 0,
      }),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Match complete", description: "The invoice match result has been refreshed." });
    },
  });

  const approveInvoiceMutation = useMutation({
    mutationFn: (invoiceId: number) => requestJson("POST", `/api/ap/invoices/${invoiceId}/approve`, {}),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Invoice approved", description: "The invoice is now ready for payment batching." });
    },
  });

  const rejectInvoiceMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      requestJson("POST", `/api/ap/invoices/${invoiceId}/reject`, {
        comment: "Rejected from AP workbench",
      }),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Invoice rejected", description: "The invoice has been sent to exception handling." });
    },
  });

  const createBatchMutation = useMutation({
    mutationFn: () =>
      requestJson("POST", "/api/ap/payment-batches", {
        batchNumber: "",
        status: "PENDING_APPROVAL",
        paymentMethod,
        scheduledDate: scheduledDate || undefined,
        invoiceIds: selectedInvoiceIds,
      }),
    onSuccess: async () => {
      setSelectedInvoiceIds([]);
      setScheduledDate("");
      await invalidateApViews();
      toast({ title: "Batch created", description: "The payment batch is waiting for release approval." });
    },
    onError: (mutationError) =>
      toast({
        title: "Batch failed",
        description: mutationError instanceof Error ? mutationError.message : String(mutationError),
        variant: "destructive",
      }),
  });

  const approveBatchMutation = useMutation({
    mutationFn: (batchId: number) => requestJson("POST", `/api/ap/payment-batches/${batchId}/approve`, {}),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Batch approved", description: "The payment batch can now be released." });
    },
  });

  const releaseBatchMutation = useMutation({
    mutationFn: (batchId: number) => requestJson("POST", `/api/ap/payment-batches/${batchId}/release`, {}),
    onSuccess: async () => {
      await invalidateApViews();
      toast({ title: "Batch released", description: "Payments were posted for the batch items." });
    },
  });

  const toggleInvoiceSelection = (invoiceId: number, checked: boolean) => {
    setSelectedInvoiceIds((current) =>
      checked ? [...current, invoiceId] : current.filter((candidate) => candidate !== invoiceId),
    );
  };

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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard title="Capture review" value={stats.captureReviewCount} hint="Staged invoices needing AP review" icon={<Files className="h-4 w-4 text-muted-foreground" />} />
              <KpiCard title="Pending approvals" value={stats.pendingApprovalCount} hint="Invoices waiting for approvers" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />} />
              <KpiCard title="Exceptions" value={stats.exceptionCount + stats.disputedCount} hint="Match failures and disputed invoices" icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />} />
              <KpiCard title="Approved for pay" value={stats.approvedCount} hint="Invoices ready for batching" icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />} />
              <KpiCard title="Outstanding" value={money.format(stats.outstandingAmount ?? 0)} hint="Current unpaid AP exposure" icon={<Wallet className="h-4 w-4 text-muted-foreground" />} />
            </div>

            <Tabs defaultValue="intake" className="space-y-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="intake">Intake</TabsTrigger>
                <TabsTrigger value="approvals">Approvals</TabsTrigger>
                <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
                <TabsTrigger value="payments">Payments</TabsTrigger>
              </TabsList>

              <TabsContent value="intake" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Files className="h-4 w-4" />
                      Stage invoice capture
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Supplier</Label>
                      <Select value={captureSupplierId} onValueChange={setCaptureSupplierId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Choose supplier</SelectItem>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={String(supplier.id)}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select value={captureSource} onValueChange={setCaptureSource}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual_upload">Manual upload</SelectItem>
                          <SelectItem value="supplier_portal">Supplier portal</SelectItem>
                          <SelectItem value="document_extractor">Document extractor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Invoice number</Label>
                      <Input value={captureInvoiceNumber} onChange={(event) => setCaptureInvoiceNumber(event.target.value)} placeholder="INV-2026-001" />
                    </div>
                    <div className="space-y-2">
                      <Label>Total amount</Label>
                      <Input value={captureTotalAmount} onChange={(event) => setCaptureTotalAmount(event.target.value)} placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                      <Label>Confidence score</Label>
                      <Input value={captureConfidence} onChange={(event) => setCaptureConfidence(event.target.value)} placeholder="0.85" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Reviewer notes</Label>
                      <Textarea value={captureNotes} onChange={(event) => setCaptureNotes(event.target.value)} placeholder="Capture notes, extraction context, or validation reminders" />
                    </div>
                    <div className="md:col-span-2">
                      <Button onClick={() => createCaptureMutation.mutate()} disabled={createCaptureMutation.isPending}>
                        {createCaptureMutation.isPending ? "Staging..." : "Stage AP capture"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Receipt className="h-4 w-4" />
                      Capture inbox
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {captures.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No AP captures staged yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Confidence</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Warnings</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {captures.map((capture) => (
                            <TableRow key={capture.id}>
                              <TableCell>
                                <div className="font-medium">{capture.invoiceNumber || `Capture #${capture.id}`}</div>
                                <div className="text-xs text-muted-foreground">{capture.source}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={capture.status === "REVIEW_REQUIRED" ? "destructive" : "outline"}>
                                  {capture.status}
                                </Badge>
                              </TableCell>
                              <TableCell>{Number(capture.confidenceScore ?? 0).toFixed(2)}</TableCell>
                              <TableCell>{money.format(Number(capture.totalAmount ?? 0))}</TableCell>
                              <TableCell className="max-w-[20rem] text-xs text-muted-foreground">
                                {capture.warnings?.length ? capture.warnings.join(" | ") : "No warnings"}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={Boolean(capture.promotedInvoiceId) || promoteCaptureMutation.isPending}
                                  onClick={() => promoteCaptureMutation.mutate(capture.id)}
                                >
                                  {capture.promotedInvoiceId ? "Promoted" : "Promote"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="approvals" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldCheck className="h-4 w-4" />
                      Invoice approval workbench
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {invoices.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No invoices available in AP.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Due</TableHead>
                            <TableHead>Outstanding</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoices.slice(0, 16).map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell>
                                <div className="font-medium">{invoice.invoiceNumber}</div>
                                <div className="text-xs text-muted-foreground">PO #{invoice.purchaseOrderId ?? "—"}</div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    invoice.status === "DISPUTED"
                                      ? "destructive"
                                      : invoice.status === "APPROVED"
                                        ? "default"
                                        : "outline"
                                  }
                                >
                                  {invoice.status}
                                </Badge>
                              </TableCell>
                              <TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}</TableCell>
                              <TableCell>{money.format(Number(invoice.dueAmount ?? invoice.total ?? 0))}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button size="sm" variant="outline" onClick={() => previewApproversMutation.mutate(invoice.id)}>
                                    Preview approvers
                                  </Button>
                                  {["DRAFT", "DISPUTED"].includes(invoice.status) ? (
                                    <Button size="sm" variant="outline" onClick={() => matchInvoiceMutation.mutate(invoice.id)}>
                                      Match
                                    </Button>
                                  ) : null}
                                  {["DRAFT", "DISPUTED"].includes(invoice.status) ? (
                                    <Button size="sm" variant="outline" onClick={() => submitApprovalMutation.mutate(invoice.id)}>
                                      Submit
                                    </Button>
                                  ) : null}
                                  {invoice.status === "PENDING_APPROVAL" ? (
                                    <>
                                      <Button size="sm" onClick={() => approveInvoiceMutation.mutate(invoice.id)}>
                                        Approve
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => rejectInvoiceMutation.mutate(invoice.id)}>
                                        Reject
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileCheck className="h-4 w-4" />
                      Queues waiting right now
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <QueueList
                      title="Invoices waiting for approval"
                      rows={approvalQueue.invoices.map((invoice) => invoice.invoiceNumber)}
                    />
                    <QueueList
                      title="Payment batches waiting for approval"
                      rows={approvalQueue.paymentBatches.map((batch) => batch.batchNumber)}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="exceptions" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <ExceptionCard
                    title="Capture exceptions"
                    icon={<Files className="h-4 w-4" />}
                    items={exceptions.captureExceptions.map((capture) => ({
                      id: capture.id,
                      title: capture.invoiceNumber || `Capture #${capture.id}`,
                      subtitle: capture.warnings?.join(" | ") || "Requires AP review",
                    }))}
                  />
                  <ExceptionCard
                    title="Match exceptions"
                    icon={<ArrowRightLeft className="h-4 w-4" />}
                    items={exceptions.matchExceptions.map((result) => ({
                      id: result.id,
                      title: `Invoice #${result.invoiceId}`,
                      subtitle:
                        result.mismatchSummary?.[0]?.message ||
                        `${result.mismatchCount} mismatch(es) require AP resolution`,
                    }))}
                  />
                  <ExceptionCard
                    title="Disputed invoices"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    items={exceptions.disputedInvoices.map((invoice) => ({
                      id: invoice.id,
                      title: invoice.invoiceNumber,
                      subtitle: `Outstanding ${money.format(Number(invoice.dueAmount ?? invoice.total ?? 0))}`,
                    }))}
                  />
                </div>
              </TabsContent>

              <TabsContent value="payments" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Landmark className="h-4 w-4" />
                      Create payment batch
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Payment method</Label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                            <SelectItem value="CHECK">Check</SelectItem>
                            <SelectItem value="PAYPAL">PayPal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Scheduled date</Label>
                        <Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Selected total</Label>
                        <div className="rounded-md border px-3 py-2 text-sm">{money.format(selectedBatchTotal)}</div>
                      </div>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead />
                          <TableHead>Invoice</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Due date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {readyForBatch.map((invoice) => {
                          const checked = selectedInvoiceIds.includes(invoice.id);
                          return (
                            <TableRow key={invoice.id}>
                              <TableCell>
                                <Checkbox checked={checked} onCheckedChange={(state) => toggleInvoiceSelection(invoice.id, state === true)} />
                              </TableCell>
                              <TableCell>{invoice.invoiceNumber}</TableCell>
                              <TableCell>
                                <Badge variant={invoice.status === "APPROVED" ? "default" : "outline"}>{invoice.status}</Badge>
                              </TableCell>
                              <TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}</TableCell>
                              <TableCell className="text-right">{money.format(Number(invoice.dueAmount ?? invoice.total ?? 0))}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>

                    <Button onClick={() => createBatchMutation.mutate()} disabled={selectedInvoiceIds.length === 0 || createBatchMutation.isPending}>
                      {createBatchMutation.isPending ? "Creating batch..." : "Create AP payment batch"}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Wallet className="h-4 w-4" />
                      Payment batch execution
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {paymentBatches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No AP payment batches created yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Batch</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Scheduled</TableHead>
                            <TableHead>Items</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paymentBatches.map((batch) => (
                            <TableRow key={batch.id}>
                              <TableCell>{batch.batchNumber}</TableCell>
                              <TableCell>
                                <Badge variant={batch.status === "RELEASED" ? "default" : "outline"}>{batch.status}</Badge>
                              </TableCell>
                              <TableCell>{batch.scheduledDate ? new Date(batch.scheduledDate).toLocaleDateString() : "—"}</TableCell>
                              <TableCell>{batch.items.length}</TableCell>
                              <TableCell className="text-right">{money.format(Number(batch.totalAmount ?? 0))}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  {batch.status === "PENDING_APPROVAL" ? (
                                    <Button size="sm" variant="outline" onClick={() => approveBatchMutation.mutate(batch.id)}>
                                      Approve
                                    </Button>
                                  ) : null}
                                  {batch.status === "APPROVED" ? (
                                    <Button size="sm" onClick={() => releaseBatchMutation.mutate(batch.id)}>
                                      Release
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DataState>
    </PageShell>
  );
}

function KpiCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function QueueList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.slice(0, 8).map((row) => (
            <li key={row} className="rounded-md bg-muted px-3 py-2">
              {row}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExceptionCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ id: number; title: string; subtitle: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active exceptions.</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-md border p-3">
              <div className="font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.subtitle}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
