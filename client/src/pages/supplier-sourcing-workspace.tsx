import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePenLine, MessageSquareText, RefreshCw, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { invalidateSourcingDomain } from "@/lib/domain-invalidation";
import { qk } from "@/lib/query-keys";
import { queryClient, requestJson } from "@/lib/queryClient";

type SupplierEventRow = {
  invitation: { id: number; status: string; respondedAt?: string | null };
  event: {
    id: number;
    eventNumber: string;
    title: string;
    status: string;
    deadline: string;
    reportingCurrencyCode: string;
  };
};

type SupplierEventDetails = {
  event: SupplierEventRow["event"] & { description?: string | null; terms?: string | null };
  lines: Array<{ id: number; lineNumber: number; description: string; quantity: number; targetCurrencyCode?: string | null; requirements?: Record<string, unknown> }>;
  criteria: Array<{ id: number; name: string; weight: number; guidance?: string | null }>;
  quotes: Array<{ quote: { id: number; quoteNumber: string; version: number; status: string; currencyCode: string; validityDate?: string | null; paymentTerms?: string | null; deliveryDays?: number | null; notes?: string | null; landedCostTotal: number; submittedAt?: string | null } }>;
  quoteLines: Array<{ quoteId: number; eventLineId: number; quantity: number; unitPrice: number; taxAmount: number; freightAmount: number; promisedDate?: string | null; supplierItemCode?: string | null; compliant: boolean; exceptionReason?: string | null }>;
  clarifications: Array<{ id: number; subject: string; message: string; createdAt: string; supplierId?: number | null }>;
};

type DraftQuoteLine = {
  eventLineId: number;
  quantity: string;
  unitPrice: string;
  taxAmount: string;
  freightAmount: string;
  promisedDate: string;
  supplierItemCode: string;
  compliant: boolean;
  exceptionReason: string;
};

function actionKey(prefix: string, eventId: number): string {
  return `${prefix}-${eventId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function QuoteEditor({ details }: { details: SupplierEventDetails }) {
  const { toast } = useToast();
  const latestQuote = details.quotes
    .filter(({ quote }) => quote.status === "SUBMITTED")
    .sort((a, b) => b.quote.version - a.quote.version)[0]?.quote;
  const latestLines = useMemo(
    () => new Map(details.quoteLines.filter((line) => line.quoteId === latestQuote?.id).map((line) => [line.eventLineId, line])),
    [details.quoteLines, latestQuote?.id],
  );
  const [currencyCode, setCurrencyCode] = useState(latestQuote?.currencyCode ?? details.event.reportingCurrencyCode);
  const [validityDate, setValidityDate] = useState(latestQuote?.validityDate?.slice(0, 10) ?? "");
  const [paymentTerms, setPaymentTerms] = useState(latestQuote?.paymentTerms ?? "");
  const [deliveryDays, setDeliveryDays] = useState(latestQuote?.deliveryDays == null ? "" : String(latestQuote.deliveryDays));
  const [notes, setNotes] = useState(latestQuote?.notes ?? "");
  const [lines, setLines] = useState<DraftQuoteLine[]>(() => details.lines.map((eventLine) => {
    const previous = latestLines.get(eventLine.id);
    return {
      eventLineId: eventLine.id,
      quantity: String(previous?.quantity ?? eventLine.quantity),
      unitPrice: previous == null ? "" : String(previous.unitPrice),
      taxAmount: previous == null ? "0" : String(previous.taxAmount),
      freightAmount: previous == null ? "0" : String(previous.freightAmount),
      promisedDate: previous?.promisedDate?.slice(0, 10) ?? "",
      supplierItemCode: previous?.supplierItemCode ?? "",
      compliant: previous?.compliant ?? true,
      exceptionReason: previous?.exceptionReason ?? "",
    };
  }));

  const submitMutation = useMutation({
    mutationFn: () => requestJson("POST", `/api/sourcing/supplier/events/${details.event.id}/quotes`, {
      currencyCode,
      validityDate: validityDate || null,
      paymentTerms: paymentTerms || null,
      deliveryDays: deliveryDays ? Number(deliveryDays) : null,
      notes: notes || null,
      lines: lines.map((line) => ({
        eventLineId: line.eventLineId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        taxAmount: Number(line.taxAmount || 0),
        freightAmount: Number(line.freightAmount || 0),
        promisedDate: line.promisedDate || null,
        supplierItemCode: line.supplierItemCode || null,
        compliant: line.compliant,
        exceptionReason: line.compliant ? null : line.exceptionReason,
      })),
    }, { headers: { "Idempotency-Key": actionKey("supplier-quote", details.event.id) } }),
    onSuccess: async () => {
      await invalidateSourcingDomain(queryClient, details.event.id);
      toast({ title: latestQuote ? "Quote revision submitted" : "Quote submitted", description: "The buyer can now evaluate this version. Earlier versions remain in the audit history." });
    },
  });
  const withdrawMutation = useMutation({
    mutationFn: () => requestJson("POST", `/api/sourcing/supplier/events/${details.event.id}/quotes/${latestQuote?.id}/withdraw`, {}, { headers: { "Idempotency-Key": actionKey("supplier-quote-withdraw", details.event.id) } }),
    onSuccess: async () => {
      await invalidateSourcingDomain(queryClient, details.event.id);
      toast({ title: "Quote withdrawn", description: "The buyer can no longer evaluate that version. You may submit a new revision before the deadline." });
    },
  });
  const invalid = details.event.status !== "OPEN"
    || new Date(details.event.deadline).getTime() <= Date.now()
    || lines.some((line) => Number(line.quantity) <= 0 || line.unitPrice === "" || Number(line.unitPrice) < 0 || (!line.compliant && !line.exceptionReason.trim()));

  return (
    <Card data-testid="supplier-rfq-quote-editor">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FilePenLine className="h-4 w-4" />{latestQuote ? `Revise ${latestQuote.quoteNumber}` : "Submit structured quote"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {details.event.status !== "OPEN" ? <Alert><AlertTitle>Quote entry closed</AlertTitle><AlertDescription>This RFQ is {details.event.status.toLowerCase()}. Existing submissions remain read-only.</AlertDescription></Alert> : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="supplier-quote-currency">Quote currency</Label><Input id="supplier-quote-currency" value={currencyCode} maxLength={3} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></div>
          <div className="space-y-1"><Label htmlFor="supplier-quote-validity">Valid until</Label><Input id="supplier-quote-validity" type="date" value={validityDate} onChange={(event) => setValidityDate(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="supplier-quote-delivery">Delivery lead time (days)</Label><Input id="supplier-quote-delivery" type="number" min="0" value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="supplier-quote-terms">Payment terms</Label><Input id="supplier-quote-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder="Net 30" /></div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Requirement</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-32">Unit price</TableHead><TableHead className="w-28">Tax</TableHead><TableHead className="w-28">Freight</TableHead><TableHead className="w-36">Promised date</TableHead><TableHead className="w-36">Item code</TableHead><TableHead className="w-24">Compliant</TableHead></TableRow></TableHeader>
            <TableBody>{details.lines.map((eventLine, index) => {
              const line = lines[index];
              return <TableRow key={eventLine.id}><TableCell><div className="font-medium">{eventLine.lineNumber}. {eventLine.description}</div><div className="text-xs text-muted-foreground">Requested {eventLine.quantity}</div>{!line.compliant ? <Input className="mt-2 min-w-48" aria-label={`Exception reason for line ${eventLine.lineNumber}`} value={line.exceptionReason} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, exceptionReason: event.target.value } : entry))} placeholder="Required exception reason" /> : null}</TableCell><TableCell><Input aria-label={`Quoted quantity for line ${eventLine.lineNumber}`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, quantity: event.target.value } : entry))} /></TableCell><TableCell><Input aria-label={`Unit price for line ${eventLine.lineNumber}`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, unitPrice: event.target.value } : entry))} /></TableCell><TableCell><Input aria-label={`Tax for line ${eventLine.lineNumber}`} type="number" min="0" step="0.01" value={line.taxAmount} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, taxAmount: event.target.value } : entry))} /></TableCell><TableCell><Input aria-label={`Freight for line ${eventLine.lineNumber}`} type="number" min="0" step="0.01" value={line.freightAmount} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, freightAmount: event.target.value } : entry))} /></TableCell><TableCell><Input aria-label={`Promised date for line ${eventLine.lineNumber}`} type="date" value={line.promisedDate} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, promisedDate: event.target.value } : entry))} /></TableCell><TableCell><Input aria-label={`Supplier item code for line ${eventLine.lineNumber}`} value={line.supplierItemCode} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, supplierItemCode: event.target.value } : entry))} /></TableCell><TableCell><Checkbox aria-label={`Compliant line ${eventLine.lineNumber}`} checked={line.compliant} onCheckedChange={(checked) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, compliant: checked === true } : entry))} /></TableCell></TableRow>;
            })}</TableBody>
          </Table>
        </div>
        <div className="space-y-1"><Label htmlFor="supplier-quote-notes">Commercial notes</Label><Textarea id="supplier-quote-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Assumptions, exclusions, warranty, and delivery notes" /></div>
        {submitMutation.error ? <Alert variant="destructive"><AlertTitle>Quote was not submitted</AlertTitle><AlertDescription>{submitMutation.error.message}</AlertDescription></Alert> : null}
        {withdrawMutation.error ? <Alert variant="destructive"><AlertTitle>Quote was not withdrawn</AlertTitle><AlertDescription>{withdrawMutation.error.message}</AlertDescription></Alert> : null}
        <div className="flex justify-end gap-2">{latestQuote && details.event.status === "OPEN" ? <Button variant="outline" disabled={withdrawMutation.isPending} onClick={() => withdrawMutation.mutate()}>Withdraw current version</Button> : null}<Button data-testid="supplier-quote-submit" disabled={invalid || submitMutation.isPending} onClick={() => submitMutation.mutate()}><Send className="mr-2 h-4 w-4" />{submitMutation.isPending ? "Submitting..." : latestQuote ? "Submit revision" : "Submit quote"}</Button></div>
      </CardContent>
    </Card>
  );
}

function SupplierEventDetail({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const detailsQuery = useQuery<SupplierEventDetails>({ queryKey: qk.supplierSourcingEvent(eventId), queryFn: () => requestJson("GET", `/api/sourcing/supplier/events/${eventId}`) });
  const clarificationMutation = useMutation({
    mutationFn: () => requestJson("POST", `/api/sourcing/supplier/events/${eventId}/clarifications`, { subject, message }),
    onSuccess: async () => {
      setSubject(""); setMessage("");
      await invalidateSourcingDomain(queryClient, eventId);
      toast({ title: "Clarification sent", description: "The buyer can respond within the event record." });
    },
  });
  if (detailsQuery.isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading RFQ requirements...</CardContent></Card>;
  if (detailsQuery.error) return <Alert variant="destructive"><AlertTitle>RFQ unavailable</AlertTitle><AlertDescription>{detailsQuery.error.message}<Button className="ml-3" size="sm" variant="outline" onClick={() => void detailsQuery.refetch()}>Retry</Button></AlertDescription></Alert>;
  if (!detailsQuery.data) return null;
  const details = detailsQuery.data;
  return <div className="space-y-4">
    <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{details.event.title}</CardTitle><p className="mt-1 font-mono text-xs text-muted-foreground">{details.event.eventNumber}</p></div><Badge>{details.event.status}</Badge></div></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="text-muted-foreground">Deadline</span><div className="font-medium">{new Date(details.event.deadline).toLocaleString()}</div></div><div><span className="text-muted-foreground">Reporting currency</span><div className="font-medium">{details.event.reportingCurrencyCode}</div></div><div><span className="text-muted-foreground">Evaluation</span><div className="font-medium">{details.criteria.map((criterion) => `${criterion.name} ${criterion.weight}%`).join(" / ")}</div></div>{details.event.description ? <p className="sm:col-span-3">{details.event.description}</p> : null}</CardContent></Card>
    <QuoteEditor key={`${eventId}-${details.quotes[0]?.quote.id ?? "new"}`} details={details} />
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4" />Clarifications</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-2">{details.clarifications.length === 0 ? <p className="text-sm text-muted-foreground">No clarification messages.</p> : details.clarifications.map((entry) => <div key={entry.id} className="rounded-md border p-3"><div className="flex justify-between gap-2"><span className="font-medium">{entry.subject}</span><span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm">{entry.message}</p></div>)}</div><div className="grid gap-2 sm:grid-cols-[15rem_minmax(0,1fr)_auto]"><Input aria-label="Clarification subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" /><Input aria-label="Clarification message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Question for the buyer" /><Button variant="outline" disabled={!subject.trim() || !message.trim() || clarificationMutation.isPending} onClick={() => clarificationMutation.mutate()}>Send question</Button></div>{clarificationMutation.error ? <p className="text-sm text-destructive">{clarificationMutation.error.message}</p> : null}</CardContent></Card>
  </div>;
}

export function SupplierSourcingWorkspace({ enabled }: { enabled: boolean }) {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const eventsQuery = useQuery<SupplierEventRow[]>({ queryKey: qk.supplierSourcing, queryFn: () => requestJson("GET", "/api/sourcing/supplier/events"), enabled });
  useEffect(() => {
    if (selectedEventId == null && eventsQuery.data?.[0]) setSelectedEventId(eventsQuery.data[0].event.id);
  }, [eventsQuery.data, selectedEventId]);
  if (!enabled) return <Alert><AlertTitle>Supplier account required</AlertTitle><AlertDescription>RFQ invitations are isolated to mapped supplier users. Buyer and administrator simulation is intentionally disabled for quote submission.</AlertDescription></Alert>;
  return <div className="space-y-4" data-testid="supplier-sourcing-workspace">
    <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">RFQ invitations</h2><p className="text-sm text-muted-foreground">Review requirements and submit version-controlled quotes before the deadline.</p></div><Button size="sm" variant="outline" onClick={() => void eventsQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    {eventsQuery.isLoading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading invitations...</CardContent></Card> : eventsQuery.error ? <Alert variant="destructive"><AlertTitle>Invitations unavailable</AlertTitle><AlertDescription>{eventsQuery.error.message}</AlertDescription></Alert> : eventsQuery.data?.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No RFQ invitations are assigned to this supplier account.</CardContent></Card> : <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]"><Card><CardContent className="space-y-1 p-2">{eventsQuery.data?.map(({ invitation, event }) => <button key={event.id} type="button" data-testid={`supplier-rfq-invitation-${event.id}`} onClick={() => setSelectedEventId(event.id)} className={`w-full rounded-md p-3 text-left transition-colors ${selectedEventId === event.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><div className="font-medium">{event.title}</div><div className={`mt-1 text-xs ${selectedEventId === event.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{event.eventNumber} / {invitation.status}</div><div className={`mt-1 text-xs ${selectedEventId === event.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>Due {new Date(event.deadline).toLocaleDateString()}</div></button>)}</CardContent></Card><div>{selectedEventId ? <SupplierEventDetail eventId={selectedEventId} /> : null}</div></div>}
  </div>;
}
