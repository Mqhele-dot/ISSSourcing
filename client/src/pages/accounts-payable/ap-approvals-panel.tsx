import { FileCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApprovalQueue, Invoice } from "./types";
import { QueueList } from "./ap-shared";
import type { UseMutationResult } from "@tanstack/react-query";

type Props = {
  invoices: Invoice[];
  approvalQueue: ApprovalQueue;
  /** Submit / approve / reject / withdraw (admin-only on server). */
  canRunInvoiceApprovalActions: boolean;
  /** When true, invoice list failed to load — do not offer approval actions on assumed-empty data. */
  invoicesLoadFailed: boolean;
  /** When true, approval queue endpoint failed — queue cards may be empty or stale. */
  queueLoadFailed: boolean;
  formatMoney: (n: number | null | undefined) => string;
  previewApproversMutation: UseMutationResult<unknown, Error, number>;
  matchInvoiceMutation: UseMutationResult<unknown, Error, number>;
  submitApprovalMutation: UseMutationResult<unknown, Error, number>;
  approveInvoiceMutation: UseMutationResult<unknown, Error, number>;
  rejectInvoiceMutation: UseMutationResult<unknown, Error, number>;
  withdrawInvoiceApprovalMutation: UseMutationResult<unknown, Error, number>;
};

export function ApApprovalsPanel({
  invoices,
  approvalQueue,
  canRunInvoiceApprovalActions,
  invoicesLoadFailed,
  queueLoadFailed,
  formatMoney,
  previewApproversMutation,
  matchInvoiceMutation,
  submitApprovalMutation,
  approveInvoiceMutation,
  rejectInvoiceMutation,
  withdrawInvoiceApprovalMutation,
}: Props) {
  const actionsDisabled = invoicesLoadFailed;
  const anyMutationPending =
    previewApproversMutation.isPending ||
    matchInvoiceMutation.isPending ||
    submitApprovalMutation.isPending ||
    approveInvoiceMutation.isPending ||
    rejectInvoiceMutation.isPending ||
    withdrawInvoiceApprovalMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Invoice approval workbench
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!canRunInvoiceApprovalActions ? (
            <p className="mb-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Submitting for approval, approving, rejecting, and withdrawing invoices from the queue require an
              administrator account. You can still preview approvers and run matching from this tab.
            </p>
          ) : null}
          {invoicesLoadFailed ? (
            <p className="text-sm text-destructive">
              Invoices for AP could not be loaded. Use &quot;Retry invoices&quot; above — approval actions are
              disabled until data loads.
            </p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices available in AP.</p>
          ) : (
            <Table className="min-w-[44rem]">
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
                    <TableCell>{formatMoney(Number(invoice.dueAmount ?? invoice.total ?? 0))}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionsDisabled || anyMutationPending}
                          onClick={() => previewApproversMutation.mutate(invoice.id)}
                        >
                          Preview approvers
                        </Button>
                        {["DRAFT", "DISPUTED"].includes(invoice.status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionsDisabled || anyMutationPending}
                            onClick={() => matchInvoiceMutation.mutate(invoice.id)}
                          >
                            Match
                          </Button>
                        ) : null}
                        {canRunInvoiceApprovalActions && ["DRAFT", "DISPUTED"].includes(invoice.status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionsDisabled || anyMutationPending}
                            onClick={() => submitApprovalMutation.mutate(invoice.id)}
                          >
                            Submit
                          </Button>
                        ) : null}
                        {canRunInvoiceApprovalActions && invoice.status === "PENDING_APPROVAL" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={actionsDisabled || anyMutationPending}
                              onClick={() => approveInvoiceMutation.mutate(invoice.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionsDisabled || anyMutationPending}
                              onClick={() => rejectInvoiceMutation.mutate(invoice.id)}
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={actionsDisabled || anyMutationPending}
                              onClick={() => withdrawInvoiceApprovalMutation.mutate(invoice.id)}
                            >
                              Withdraw
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
          {queueLoadFailed ? (
            <p className="text-sm text-destructive md:col-span-2">
              Approval queue data could not be loaded. Retry the queue from the banner above — lists below may be
              incomplete.
            </p>
          ) : null}
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
    </div>
  );
}
