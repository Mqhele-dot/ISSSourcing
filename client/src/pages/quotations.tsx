import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, Printer, Receipt, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageDataState, PageShell, PageToolbar } from "@/components/page-shell";
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
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { queryClient, requestJson } from "@/lib/queryClient";

type QuoteRow = {
  id: number;
  quoteNumber: string;
  eventId: number;
  eventNumber: string;
  eventTitle: string;
  supplierId: number;
  supplierName: string;
  status: string;
  version: number;
  currencyCode: string;
  landedCostTotal: number;
  reportingCurrencyCode: string;
  reportingTotal: number;
  validityDate?: string | null;
  submittedAt?: string | null;
  createdAt: string;
};

type QuotePage = {
  items: QuoteRow[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  summary?: { submitted: number; reportingTotal: number };
};

type EventPage = {
  items: Array<{ id: number; eventNumber: string; title: string; status: string; deadline: string; reportingCurrencyCode: string }>;
};

type QuoteContext = {
  event: { id: number; eventNumber: string; title: string; status: string; deadline: string; reportingCurrencyCode: string };
  lines: Array<{ id: number; lineNumber: number; description: string; quantity: number }>;
  suppliers: Array<{ id: number; name: string; invitationStatus: string; status: string; complianceStatus?: string | null }>;
};

type QuoteDetail = {
  quote: QuoteRow & { subtotal: number; taxTotal: number; paymentTerms?: string | null; deliveryDays?: number | null; notes?: string | null; complianceStatus: string };
  supplierName: string;
  event: QuoteContext["event"];
  lines: Array<{
    line: { id: number; quantity: number; unitPrice: number; taxAmount: number; freightAmount: number; landedCost: number; promisedDate?: string | null; supplierItemCode?: string | null; compliant: boolean; exceptionReason?: string | null };
    eventLine: { lineNumber: number; description: string; quantity: number };
  }>;
};

type DraftLine = {
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

function money(value: number | string | null | undefined, currency: string): string {
  const amount = Number(value ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
}

function actionKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function QuoteList() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const query = useQuery<QuotePage>({
    queryKey: ["/api/v2/procurement/quotations", { page, q, status }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25", sort: "newest" });
      if (q.trim()) params.set("q", q.trim());
      if (status !== "all") params.set("status", status);
      return requestJson("GET", `/api/v2/procurement/quotations?${params}`);
    },
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.items ?? [];
  const start = query.data?.total ? (page - 1) * 25 + 1 : 0;
  const end = query.data ? Math.min(page * 25, query.data.total) : 0;

  return <PageShell variant="wide-table" data-testid="quotations-page">
    <PageHeader
      title="Supplier quotations"
      subtitle="Capture quotations received outside the supplier portal, review their reporting-currency value, and continue to RFQ comparison and award."
      actions={<div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href={APP_ROUTES.procurement.supplierQuotationNew}><FilePlus2 className="mr-2 h-4 w-4" />Capture supplier response</Link></Button><Button asChild><Link href={APP_ROUTES.procurement.quotationNew}>Build customer quotation</Link></Button></div>}
    />
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Filtered quotations</p><p className="text-2xl font-semibold">{query.data?.total ?? "—"}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Submitted versions</p><p className="text-2xl font-semibold">{query.data?.summary?.submitted ?? "—"}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Workflow</p><p className="text-sm font-medium">RFQ → quotation → evaluation → award → PO</p></CardContent></Card>
    </div>
    <PageToolbar>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 sm:max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search quotations" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="Quote, RFQ, or supplier" /></div>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger className="w-44" aria-label="Quotation status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="SUBMITTED">Submitted</SelectItem><SelectItem value="WITHDRAWN">Withdrawn</SelectItem><SelectItem value="SUPERSEDED">Superseded</SelectItem><SelectItem value="DRAFT">Draft</SelectItem></SelectContent></Select>
      </div>
      <Button variant="outline" asChild><Link href={APP_ROUTES.procurement.sourcing}>Open RFQs</Link></Button>
    </PageToolbar>
    <Card><CardContent className="p-0">
      <PageDataState isLoading={query.isLoading} error={query.error} isEmpty={rows.length === 0} onRetry={() => void query.refetch()} emptyView={<div className="p-12 text-center"><Receipt className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">No quotations match these filters</p><p className="mt-1 text-sm text-muted-foreground">Create one against an open RFQ or wait for a supplier portal response.</p></div>}>
        <><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Quotation</TableHead><TableHead>Supplier</TableHead><TableHead>RFQ</TableHead><TableHead>Status</TableHead><TableHead>Quote value</TableHead><TableHead>Reporting value</TableHead><TableHead>Valid until</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><div className="font-mono text-xs">{row.quoteNumber}</div><div className="text-xs text-muted-foreground">Version {row.version}</div></TableCell><TableCell className="font-medium">{row.supplierName}</TableCell><TableCell><div>{row.eventNumber}</div><div className="max-w-56 truncate text-xs text-muted-foreground">{row.eventTitle}</div></TableCell><TableCell><Badge variant={row.status === "SUBMITTED" ? "default" : "secondary"}>{row.status}</Badge></TableCell><TableCell>{money(row.landedCostTotal, row.currencyCode)}</TableCell><TableCell>{money(row.reportingTotal, row.reportingCurrencyCode)}</TableCell><TableCell>{row.validityDate ? new Date(row.validityDate).toLocaleDateString() : "Not specified"}</TableCell><TableCell className="text-right"><Button asChild size="sm" variant="ghost"><Link href={APP_ROUTES.procurement.quotation(row.id)}>Review</Link></Button></TableCell></TableRow>)}</TableBody></Table></div><div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm"><span>{start === 0 ? "0 results" : `${start}–${end} of ${query.data?.total ?? 0}`}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!query.data?.hasNext} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div></>
      </PageDataState>
    </CardContent></Card>
  </PageShell>;
}

function QuoteCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const initialEventId = Number(new URLSearchParams(window.location.search).get("eventId")) || 0;
  const [eventId, setEventId] = useState(initialEventId);
  const [supplierId, setSupplierId] = useState(0);
  const [currencyCode, setCurrencyCode] = useState("");
  const [validityDate, setValidityDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const eventsQuery = useQuery<EventPage>({ queryKey: ["/api/v2/procurement/sourcing-events", "OPEN"], queryFn: () => requestJson("GET", "/api/v2/procurement/sourcing-events?page=1&pageSize=100&status=OPEN&sort=deadline_asc") });
  const contextQuery = useQuery<QuoteContext>({ queryKey: ["/api/procurement/quotations/context", eventId], queryFn: () => requestJson("GET", `/api/procurement/quotations/context/${eventId}`), enabled: eventId > 0 });
  useEffect(() => {
    if (!contextQuery.data) return;
    setCurrencyCode(contextQuery.data.event.reportingCurrencyCode);
    setSupplierId(0);
    setLines(contextQuery.data.lines.map((line) => ({ eventLineId: line.id, quantity: String(line.quantity), unitPrice: "", taxAmount: "0", freightAmount: "0", promisedDate: "", supplierItemCode: "", compliant: true, exceptionReason: "" })));
  }, [contextQuery.data]);
  const totals = useMemo(() => lines.reduce((sum, line) => ({
    subtotal: sum.subtotal + Number(line.quantity || 0) * Number(line.unitPrice || 0),
    tax: sum.tax + Number(line.taxAmount || 0),
    freight: sum.freight + Number(line.freightAmount || 0),
  }), { subtotal: 0, tax: 0, freight: 0 }), [lines]);
  const invalid = !eventId || !supplierId || currencyCode.trim().length !== 3 || lines.length === 0 || lines.some((line) => Number(line.quantity) <= 0 || line.unitPrice === "" || Number(line.unitPrice) < 0 || Number(line.taxAmount) < 0 || Number(line.freightAmount) < 0 || (!line.compliant && !line.exceptionReason.trim()));
  const mutation = useMutation<{ quote: { id: number } }>({
    mutationFn: () => requestJson("POST", "/api/procurement/quotations", { eventId, supplierId, currencyCode: currencyCode.toUpperCase(), validityDate: validityDate || null, paymentTerms: paymentTerms || null, deliveryDays: deliveryDays ? Number(deliveryDays) : null, notes: notes || null, lines: lines.map((line) => ({ ...line, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), taxAmount: Number(line.taxAmount || 0), freightAmount: Number(line.freightAmount || 0), promisedDate: line.promisedDate || null, supplierItemCode: line.supplierItemCode || null, exceptionReason: line.compliant ? null : line.exceptionReason })) }, { headers: { "Idempotency-Key": actionKey() } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/v2/procurement/quotations"] });
      toast({ title: "Quotation captured", description: "The version is now available in RFQ comparison and the audit trail." });
      navigate(APP_ROUTES.procurement.quotation(result.quote.id));
    },
  });
  const events = eventsQuery.data?.items ?? [];
  const suppliers = contextQuery.data?.suppliers ?? [];

  return <PageShell variant="wide-table" data-testid="quotation-create-page">
    <PageHeader title="Create supplier quotation" subtitle="Capture a quotation received by email, phone, or another controlled channel against an existing open RFQ." breadcrumb={<Link href={APP_ROUTES.procurement.quotations}>Quotations</Link>} />
    <Alert><AlertTitle>Controlled capture</AlertTitle><AlertDescription>The quotation must belong to an invited, approved supplier. Saving creates a submitted, version-controlled record; evaluation and award remain separate actions.</AlertDescription></Alert>
    <Card><CardHeader><CardTitle className="text-lg">RFQ and supplier</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="quotation-event">Open RFQ</Label><Select value={eventId ? String(eventId) : ""} onValueChange={(value) => setEventId(Number(value))} disabled={eventsQuery.isLoading}><SelectTrigger id="quotation-event"><SelectValue placeholder={eventsQuery.isLoading ? "Loading RFQs…" : "Select an open RFQ"} /></SelectTrigger><SelectContent>{events.map((event) => <SelectItem key={event.id} value={String(event.id)}>{event.eventNumber} — {event.title}</SelectItem>)}</SelectContent></Select>{eventsQuery.error ? <p className="text-sm text-destructive">{eventsQuery.error.message}</p> : null}{!eventsQuery.isLoading && events.length === 0 ? <p className="text-sm text-muted-foreground">No RFQs are open. <Link className="underline" href={APP_ROUTES.procurement.sourcing}>Create or publish an RFQ first.</Link></p> : null}</div>
      <div className="space-y-2"><Label htmlFor="quotation-supplier">Invited supplier</Label><Select value={supplierId ? String(supplierId) : ""} onValueChange={(value) => setSupplierId(Number(value))} disabled={!contextQuery.data}><SelectTrigger id="quotation-supplier"><SelectValue placeholder={contextQuery.isLoading ? "Loading invited suppliers…" : "Select supplier"} /></SelectTrigger><SelectContent>{suppliers.map((supplier) => <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.name} — {supplier.invitationStatus}</SelectItem>)}</SelectContent></Select>{contextQuery.data && suppliers.length === 0 ? <p className="text-sm text-destructive">This RFQ has no invited suppliers.</p> : null}</div>
    </CardContent></Card>
    {contextQuery.error ? <Alert variant="destructive"><AlertTitle>RFQ details unavailable</AlertTitle><AlertDescription>{contextQuery.error.message}<Button className="ml-3" size="sm" variant="outline" onClick={() => void contextQuery.refetch()}>Retry</Button></AlertDescription></Alert> : null}
    {contextQuery.data ? <>
      <Card><CardHeader><CardTitle className="text-lg">Commercial terms</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-2"><Label htmlFor="quotation-currency">Quote currency</Label><Input id="quotation-currency" maxLength={3} value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></div><div className="space-y-2"><Label htmlFor="quotation-validity">Valid until</Label><Input id="quotation-validity" type="date" value={validityDate} onChange={(event) => setValidityDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="quotation-delivery">Lead time (days)</Label><Input id="quotation-delivery" type="number" min="0" value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="quotation-terms">Payment terms</Label><Input id="quotation-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder="e.g. Net 30" /></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Quoted lines</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>RFQ requirement</TableHead><TableHead className="w-24">Quantity</TableHead><TableHead className="w-32">Unit price</TableHead><TableHead className="w-28">Tax</TableHead><TableHead className="w-28">Freight</TableHead><TableHead className="w-40">Promised date</TableHead><TableHead className="w-36">Supplier code</TableHead><TableHead className="w-24">Compliant</TableHead></TableRow></TableHeader><TableBody>{contextQuery.data.lines.map((eventLine, index) => { const line = lines[index]; if (!line) return null; const update = (patch: Partial<DraftLine>) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, ...patch } : entry)); return <TableRow key={eventLine.id}><TableCell className="min-w-64"><div className="font-medium">{eventLine.lineNumber}. {eventLine.description}</div><div className="text-xs text-muted-foreground">Requested quantity {eventLine.quantity}</div>{!line.compliant ? <Input className="mt-2" aria-label={`Exception reason for line ${eventLine.lineNumber}`} value={line.exceptionReason} onChange={(event) => update({ exceptionReason: event.target.value })} placeholder="Required exception reason" /> : null}</TableCell><TableCell><Input aria-label={`Quantity for line ${eventLine.lineNumber}`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => update({ quantity: event.target.value })} /></TableCell><TableCell><Input aria-label={`Unit price for line ${eventLine.lineNumber}`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => update({ unitPrice: event.target.value })} /></TableCell><TableCell><Input aria-label={`Tax for line ${eventLine.lineNumber}`} type="number" min="0" step="0.01" value={line.taxAmount} onChange={(event) => update({ taxAmount: event.target.value })} /></TableCell><TableCell><Input aria-label={`Freight for line ${eventLine.lineNumber}`} type="number" min="0" step="0.01" value={line.freightAmount} onChange={(event) => update({ freightAmount: event.target.value })} /></TableCell><TableCell><Input aria-label={`Promised date for line ${eventLine.lineNumber}`} type="date" value={line.promisedDate} onChange={(event) => update({ promisedDate: event.target.value })} /></TableCell><TableCell><Input aria-label={`Supplier item code for line ${eventLine.lineNumber}`} value={line.supplierItemCode} onChange={(event) => update({ supplierItemCode: event.target.value })} /></TableCell><TableCell><Checkbox aria-label={`Line ${eventLine.lineNumber} is compliant`} checked={line.compliant} onCheckedChange={(checked) => update({ compliant: checked === true })} /></TableCell></TableRow>; })}</TableBody></Table></div></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"><Card><CardHeader><CardTitle className="text-lg">Notes and evidence</CardTitle></CardHeader><CardContent><Label htmlFor="quotation-notes" className="sr-only">Commercial notes</Label><Textarea id="quotation-notes" rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Source, assumptions, warranty, exclusions, and supporting evidence reference" /></CardContent></Card><Card><CardHeader><CardTitle className="text-lg">Quotation total</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><strong>{money(totals.subtotal, currencyCode)}</strong></div><div className="flex justify-between"><span>Tax</span><strong>{money(totals.tax, currencyCode)}</strong></div><div className="flex justify-between"><span>Freight</span><strong>{money(totals.freight, currencyCode)}</strong></div><div className="flex justify-between border-t pt-2 text-base"><span>Total</span><strong>{money(totals.subtotal + totals.tax + totals.freight, currencyCode)}</strong></div><p className="pt-2 text-xs text-muted-foreground">The server applies the RFQ’s approved FX snapshot and stores the reporting-currency total on submission.</p></CardContent></Card></div>
      {mutation.error ? <Alert variant="destructive"><AlertTitle>Quotation was not created</AlertTitle><AlertDescription>{mutation.error.message}</AlertDescription></Alert> : null}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => navigate(APP_ROUTES.procurement.quotations)}>Cancel</Button><Button data-testid="quotation-submit" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Creating…" : "Create quotation"}</Button></div>
    </> : null}
  </PageShell>;
}

function QuoteReview({ quoteId }: { quoteId: number }) {
  const query = useQuery<QuoteDetail>({ queryKey: ["/api/procurement/quotations", quoteId], queryFn: () => requestJson("GET", `/api/procurement/quotations/${quoteId}`) });
  if (query.isLoading) return <PageShell><div className="py-16 text-center text-muted-foreground">Loading quotation…</div></PageShell>;
  if (query.error || !query.data) return <PageShell><Alert variant="destructive"><AlertTitle>Quotation unavailable</AlertTitle><AlertDescription>{query.error?.message ?? "The quotation could not be loaded."}<Button className="ml-3" size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></AlertDescription></Alert></PageShell>;
  const { quote, event, supplierName, lines } = query.data;
  return <PageShell variant="wide-table" data-testid="quotation-review-page">
    <PageHeader title={quote.quoteNumber} subtitle={`Supplier quotation from ${supplierName}`} breadcrumb={<Link href={APP_ROUTES.procurement.quotations}>Quotations</Link>} actions={<div className="flex gap-2 print:hidden"><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button><Button asChild><Link href={APP_ROUTES.procurement.sourcingEvent(event.id)}>Compare in RFQ</Link></Button></div>} />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Supplier</p><p className="font-semibold">{supplierName}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">RFQ</p><Link className="font-semibold underline" href={APP_ROUTES.procurement.sourcingEvent(event.id)}>{event.eventNumber}</Link></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Status</p><Badge>{quote.status}</Badge></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Version</p><p className="font-semibold">{quote.version}</p></CardContent></Card></div>
    <Card><CardHeader><CardTitle>Commercial summary</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-sm text-muted-foreground">Quote total</p><p className="text-lg font-semibold">{money(quote.landedCostTotal, quote.currencyCode)}</p></div><div><p className="text-sm text-muted-foreground">Reporting value</p><p className="text-lg font-semibold">{money(quote.reportingTotal, event.reportingCurrencyCode)}</p></div><div><p className="text-sm text-muted-foreground">Payment terms</p><p className="font-medium">{quote.paymentTerms || "Not specified"}</p></div><div><p className="text-sm text-muted-foreground">Delivery</p><p className="font-medium">{quote.deliveryDays == null ? "Not specified" : `${quote.deliveryDays} days`}</p></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Quotation lines</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Line</TableHead><TableHead>Description</TableHead><TableHead>Quantity</TableHead><TableHead>Unit price</TableHead><TableHead>Tax</TableHead><TableHead>Freight</TableHead><TableHead>Landed</TableHead><TableHead>Compliance</TableHead></TableRow></TableHeader><TableBody>{lines.map(({ line, eventLine }) => <TableRow key={line.id}><TableCell>{eventLine.lineNumber}</TableCell><TableCell><div className="font-medium">{eventLine.description}</div>{line.supplierItemCode ? <div className="text-xs text-muted-foreground">Supplier code: {line.supplierItemCode}</div> : null}{line.exceptionReason ? <div className="text-xs text-destructive">{line.exceptionReason}</div> : null}</TableCell><TableCell>{line.quantity}</TableCell><TableCell>{money(line.unitPrice, quote.currencyCode)}</TableCell><TableCell>{money(line.taxAmount, quote.currencyCode)}</TableCell><TableCell>{money(line.freightAmount, quote.currencyCode)}</TableCell><TableCell className="font-medium">{money(line.landedCost, quote.currencyCode)}</TableCell><TableCell><Badge variant={line.compliant ? "outline" : "destructive"}>{line.compliant ? "Compliant" : "Exception"}</Badge></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    {quote.notes ? <Card><CardHeader><CardTitle>Commercial notes</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{quote.notes}</p></CardContent></Card> : null}
    <Button className="print:hidden" variant="outline" asChild><Link href={APP_ROUTES.procurement.quotations}><ArrowLeft className="mr-2 h-4 w-4" />Back to quotations</Link></Button>
  </PageShell>;
}

export default function QuotationsPage() {
  const [isDetail, detailParams] = useRoute(`${APP_ROUTES.procurement.quotations}/:id`);
  const [location] = useLocation();
  if (location === APP_ROUTES.procurement.supplierQuotationNew) return <QuoteCreate />;
  if (isDetail) {
    const quoteId = Number(detailParams?.id);
    if (Number.isInteger(quoteId) && quoteId > 0) return <QuoteReview quoteId={quoteId} />;
  }
  return <QuoteList />;
}
