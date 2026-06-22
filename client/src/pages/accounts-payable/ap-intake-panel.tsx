import { Files, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Capture, Supplier } from "./types";
import type { ApCapturePayload } from "./use-ap-workspace-mutations";
import type { UseMutationResult } from "@tanstack/react-query";

type Props = {
  suppliers: Supplier[];
  captures: Capture[];
  captureSupplierId: string;
  setCaptureSupplierId: (v: string) => void;
  captureSource: string;
  setCaptureSource: (v: string) => void;
  captureInvoiceNumber: string;
  setCaptureInvoiceNumber: (v: string) => void;
  captureTotalAmount: string;
  setCaptureTotalAmount: (v: string) => void;
  captureConfidence: string;
  setCaptureConfidence: (v: string) => void;
  captureNotes: string;
  setCaptureNotes: (v: string) => void;
  intakeErrors: string[];
  formatMoney: (n: number | null | undefined) => string;
  createCaptureMutation: UseMutationResult<unknown, Error, ApCapturePayload>;
  promoteCaptureMutation: UseMutationResult<unknown, Error, number>;
  onSubmitCapture: () => void;
};

export function ApIntakePanel({
  suppliers,
  captures,
  captureSupplierId,
  setCaptureSupplierId,
  captureSource,
  setCaptureSource,
  captureInvoiceNumber,
  setCaptureInvoiceNumber,
  captureTotalAmount,
  setCaptureTotalAmount,
  captureConfidence,
  setCaptureConfidence,
  captureNotes,
  setCaptureNotes,
  intakeErrors,
  formatMoney,
  createCaptureMutation,
  promoteCaptureMutation,
  onSubmitCapture,
}: Props) {
  return (
    <div className="space-y-4">
      {intakeErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-inside list-disc text-sm">
              {intakeErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

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
              <SelectTrigger aria-invalid={intakeErrors.some((e) => e.includes("supplier"))}>
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
            <Input
              value={captureInvoiceNumber}
              onChange={(event) => setCaptureInvoiceNumber(event.target.value)}
              placeholder="INV-2026-001"
            />
          </div>
          <div className="space-y-2">
            <Label>Total amount</Label>
            <Input
              value={captureTotalAmount}
              onChange={(event) => setCaptureTotalAmount(event.target.value)}
              placeholder="0.00"
              aria-invalid={intakeErrors.some((e) => e.includes("amount") || e.includes("Amount"))}
            />
          </div>
          <div className="space-y-2">
            <Label>Confidence score</Label>
            <Input
              value={captureConfidence}
              onChange={(event) => setCaptureConfidence(event.target.value)}
              placeholder="0.85"
              aria-invalid={intakeErrors.some((e) => e.includes("Confidence"))}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Reviewer notes</Label>
            <Textarea
              value={captureNotes}
              onChange={(event) => setCaptureNotes(event.target.value)}
              placeholder="Capture notes, extraction context, or validation reminders"
            />
          </div>
          <div className="md:col-span-2">
            <Button type="button" onClick={onSubmitCapture} disabled={createCaptureMutation.isPending}>
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
        <CardContent className="overflow-x-auto">
          {captures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AP captures staged yet.</p>
          ) : (
            <Table className="min-w-[52rem]">
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
                    <TableCell>{formatMoney(Number(capture.totalAmount ?? 0))}</TableCell>
                    <TableCell className="max-w-[20rem] break-words text-xs text-muted-foreground">
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
    </div>
  );
}
