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
  formatMoney: (n: number | null | undefined) => string;
  previewApproversMutation: UseMutationResult<unknown, Error, number>;
  matchInvoiceMutation: UseMutationResult<unknown, Error, number>;
  submitApprovalMutation: UseMutationResult<unknown, Error, number>;
  approveInvoiceMutation: UseMutationResult<unknown, Error, number>;
  rejectInvoiceMutation: UseMutationResult<unknown, Error, number>;
};

export function ApApprovalsPanel({
  invoices,
  approvalQueue,
  formatMoney,
  previewApproversMutation,
  matchInvoiceMutation,
  submitApprovalMutation,
  approveInvoiceMutation,
  rejectInvoiceMutation,
}: Props) {
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
          {invoices.length === 0 ? (
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
    </div>
  );
}
