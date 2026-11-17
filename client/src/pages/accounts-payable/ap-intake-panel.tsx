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
import { SearchableRecordCombobox } from "@/components/searchable-record-combobox";
import type { ApPage, Capture, Supplier } from "./types";
import type { ApCapturePayload } from "./use-ap-workspace-mutations";
import type { UseMutationResult } from "@tanstack/react-query";

type Props = {
  suppliers: Supplier[];
  captures: Capture[];
  capturePage: ApPage<Capture>;
  captureQuery: string;
  onCaptureQueryChange: (value: string) => void;
  onCapturePageChange: (page: number) => void;
  captureSupplierId: string;
  setCaptureSupplierId: (v: string) => void;
  onSupplierSearchChange: (value: string) => void;
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
  capturePage,
  captureQuery,
  onCaptureQueryChange,
  onCapturePageChange,
  captureSupplierId,
  setCaptureSupplierId,
  onSupplierSearchChange,
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
            <SearchableRecordCombobox
              value={captureSupplierId}
              onValueChange={setCaptureSupplierId}
              onSearchChange={onSupplierSearchChange}
              serverFiltered
              maxSuggestions={25}
              ariaLabel="Supplier for invoice capture"
              placeholder="Choose supplier"
              searchPlaceholder="Search suppliers"
              options={[{ value: "none", label: "Choose supplier" }, ...suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name }))]}
            />
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
          <div className="mb-4">
            <Label htmlFor="capture-search" className="sr-only">Search invoice captures</Label>
            <Input id="capture-search" value={captureQuery} onChange={(event) => onCaptureQueryChange(event.target.value)} placeholder="Search invoice, supplier, or source" />
          </div>
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
          {capturePage.total > 0 ? <CapturePageControls page={capturePage} onPage={onCapturePageChange} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CapturePageControls({ page, onPage }: { page: ApPage<Capture>; onPage: (page: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));
  const first = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.total, page.page * page.pageSize);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{first}–{last} of {page.total} captures</span>
      <div className="flex flex-wrap gap-2" aria-label="Capture pagination">
        <Button type="button" size="sm" variant="outline" disabled={page.page <= 1} onClick={() => onPage(1)}>First</Button>
        <Button type="button" size="sm" variant="outline" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>Previous</Button>
        <Button type="button" size="sm" variant="outline" disabled={!page.hasNext} onClick={() => onPage(page.page + 1)}>Next</Button>
        <Button type="button" size="sm" variant="outline" disabled={page.page >= lastPage} onClick={() => onPage(lastPage)}>Last</Button>
      </div>
    </div>
  );
}
