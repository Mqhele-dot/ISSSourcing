import { useState } from "react";
import { Landmark, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Invoice, PaymentBatch } from "./types";
import type { ApPaymentBatchApproveInput, ApPaymentBatchPayload } from "./use-ap-workspace-mutations";
import type { UseMutationResult } from "@tanstack/react-query";

type Props = {
  readyForBatch: Invoice[];
  /** When true, invoice list failed — selection UI may be empty without meaning “no payable invoices”. */
  invoicesLoadFailed: boolean;
  /** When true, batch list failed — do not show “no batches” as success state. */
  batchesLoadFailed: boolean;
  selectedInvoiceIds: number[];
  toggleInvoiceSelection: (invoiceId: number, checked: boolean) => void;
  selectedBatchTotal: number;
  /** Integer cents for exact E2E / QA (same as sumSelectedInvoicePayableCents). */
  selectedBatchTotalCents: string;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  scheduledDate: string;
  setScheduledDate: (v: string) => void;
  paymentBatchErrors: string[];
  formatMoney: (n: number | null | undefined) => string;
  paymentBatches: PaymentBatch[];
  createBatchMutation: UseMutationResult<unknown, Error, ApPaymentBatchPayload>;
  approveBatchMutation: UseMutationResult<unknown, Error, ApPaymentBatchApproveInput>;
  releaseBatchMutation: UseMutationResult<unknown, Error, ApPaymentBatchApproveInput>;
  onCreateBatch: () => void;
  /** Current user — used to enforce batch creator segregation in the UI */
  actorUserId?: number | null;
  actorRole?: string | null;
};

function apInvoiceDomId(invoiceNumber: string): string {
  return invoiceNumber.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function ApPaymentsPanel({
  readyForBatch,
  invoicesLoadFailed,
  batchesLoadFailed,
  selectedInvoiceIds,
  toggleInvoiceSelection,
  selectedBatchTotal,
  selectedBatchTotalCents,
  paymentMethod,
  setPaymentMethod,
  scheduledDate,
  setScheduledDate,
  paymentBatchErrors,
  formatMoney,
  paymentBatches,
  createBatchMutation,
  approveBatchMutation,
  releaseBatchMutation,
  onCreateBatch,
  actorUserId,
  actorRole,
}: Props) {
  const [batchSegregationReason, setBatchSegregationReason] = useState<Record<number, string>>({});

  const isAdmin = String(actorRole ?? "").toLowerCase() === "admin";

  return (
    <div className="space-y-4">
      {paymentBatchErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-inside list-disc text-sm">
              {paymentBatchErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" />
            Create payment batch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoicesLoadFailed ? (
            <p className="text-sm text-destructive">
              Payable invoice list did not load. Retry invoices above before creating a batch — an empty table may not
              mean there are no invoices.
            </p>
          ) : null}
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
              <div
                className="rounded-md border px-3 py-2 text-sm"
                data-testid="ap-selected-batch-total"
                data-batch-total-cents={selectedBatchTotalCents}
              >
                {formatMoney(selectedBatchTotal)}
              </div>
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
                const idSuffix = apInvoiceDomId(invoice.invoiceNumber);
                return (
                  <TableRow key={invoice.id} data-testid={`ap-ready-invoice-row-${idSuffix}`}>
                    <TableCell>
                      <Checkbox
                        data-testid={`ap-ready-invoice-checkbox-${idSuffix}`}
                        checked={checked}
                        disabled={invoicesLoadFailed}
                        onCheckedChange={(state) => toggleInvoiceSelection(invoice.id, state === true)}
                      />
                    </TableCell>
                    <TableCell>{invoice.invoiceNumber}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === "APPROVED" ? "default" : "outline"}>{invoice.status}</Badge>
                    </TableCell>
                    <TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(Number(invoice.dueAmount ?? invoice.total ?? 0))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Button
            type="button"
            data-testid="ap-create-batch-button"
            onClick={onCreateBatch}
            disabled={invoicesLoadFailed || createBatchMutation.isPending}
          >
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
          {batchesLoadFailed ? (
            <p className="text-sm text-destructive">
              Payment batches could not be loaded. Use Retry batches above.
            </p>
          ) : paymentBatches.length === 0 ? (
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
                {paymentBatches.map((batch) => {
                  const selfBatch =
                    batch.createdBy != null &&
                    actorUserId != null &&
                    Number(batch.createdBy) === Number(actorUserId);
                  const blockSelfApprove = selfBatch && !isAdmin;
                  const needsAdminOverride = selfBatch && isAdmin;
                  const overrideReason = batchSegregationReason[batch.id] ?? "";

                  return (
                  <TableRow key={batch.id}>
                    <TableCell>{batch.batchNumber}</TableCell>
                    <TableCell>
                      <Badge variant={batch.status === "RELEASED" ? "default" : "outline"}>{batch.status}</Badge>
                    </TableCell>
                    <TableCell>{batch.scheduledDate ? new Date(batch.scheduledDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>{batch.items.length}</TableCell>
                    <TableCell className="text-right">{formatMoney(Number(batch.totalAmount ?? 0))}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex min-w-[220px] flex-col items-end gap-2">
                        {blockSelfApprove ? (
                          <p className="max-w-xs text-left text-xs text-muted-foreground">
                            Batch creator cannot approve or release their own batch. Use another approver.
                          </p>
                        ) : null}
                        {needsAdminOverride && (batch.status === "PENDING_APPROVAL" || batch.status === "APPROVED") ? (
                          <div className="w-full space-y-1">
                            <Label className="text-xs font-normal text-muted-foreground">Admin override reason</Label>
                            <Input
                              value={overrideReason}
                              onChange={(e) =>
                                setBatchSegregationReason((prev) => ({ ...prev, [batch.id]: e.target.value }))
                              }
                              placeholder="Required for self-approval / self-release"
                              className="h-8 text-xs"
                            />
                          </div>
                        ) : null}
                        <div className="flex flex-wrap justify-end gap-2">
                        {batch.status === "PENDING_APPROVAL" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              blockSelfApprove ||
                              (needsAdminOverride && !overrideReason.trim()) ||
                              approveBatchMutation.isPending
                            }
                            onClick={() =>
                              needsAdminOverride
                                ? approveBatchMutation.mutate({
                                    batchId: batch.id,
                                    adminOverride: true,
                                    overrideReason: overrideReason.trim(),
                                  })
                                : approveBatchMutation.mutate(batch.id)
                            }
                          >
                            Approve
                          </Button>
                        ) : null}
                        {batch.status === "APPROVED" ? (
                          <Button
                            size="sm"
                            disabled={
                              blockSelfApprove ||
                              (needsAdminOverride && !overrideReason.trim()) ||
                              releaseBatchMutation.isPending
                            }
                            onClick={() =>
                              needsAdminOverride
                                ? releaseBatchMutation.mutate({
                                    batchId: batch.id,
                                    adminOverride: true,
                                    overrideReason: overrideReason.trim(),
                                  })
                                : releaseBatchMutation.mutate(batch.id)
                            }
                          >
                            Release
                          </Button>
                        ) : null}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
