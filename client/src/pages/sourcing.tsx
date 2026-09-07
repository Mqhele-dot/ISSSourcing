import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Gavel, Mail, Plus, RefreshCw, Send, Scale, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageDataState, PageShell, PageToolbar } from "@/components/page-shell";
import { PanelInlineError } from "@/components/panel-inline-error";
import { Can } from "@/components/auth/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { invalidateSourcingDomain } from "@/lib/domain-invalidation";
import { qk } from "@/lib/query-keys";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { queryClient, requestJson } from "@/lib/queryClient";

type SourcingEvent = {
  id: number;
  eventNumber: string;
  title: string;
  description?: string | null;
  status: string;
  deadline: string;
  reportingCurrencyCode: string;
  minimumResponses: number;
  ownerUserId: number;
  updatedAt: string;
};

type EventLine = {
  id: number;
  lineNumber: number;
  description: string;
  quantity: number;
  unitOfMeasureId?: number | null;
  targetUnitPrice?: number | null;
};

type Criterion = { id: number; name: string; criterionType: string; weight: number; knockout: boolean };
type Invitation = { invitation: { id: number; supplierId: number; status: string }; supplierName: string; supplierStatus: string; complianceStatus: string | null };
type QuoteSummary = { quote: { id: number; quoteNumber: string; supplierId: number; status: string; version: number; currencyCode: string; reportingTotal: number; complianceStatus: string }; supplierName: string };
type Award = { id: number; status: string; justification: string; recommendedByUserId: number; approvedByUserId?: number | null; convertedPurchaseOrderId?: number | null };
type EventDetails = { event: SourcingEvent; lines: EventLine[]; criteria: Criterion[]; invitations: Invitation[]; quotes: QuoteSummary[]; clarifications: unknown[]; awards: Award[] };
type RfqEmailPreview = {
  event: Pick<SourcingEvent, "id" | "eventNumber" | "title" | "status" | "deadline" | "reportingCurrencyCode">;
  portalPath: string;
  previews: Array<{
    supplierId: number;
    supplierName: string;
    to: string | null;
    recipientState: "ready" | "missing_email";
    subject: string;
    text: string;
    html: string;
  }>;
};
type ComparisonLine = { id: number; quoteId: number; eventLineId: number; quantity: number; unitPrice: number; landedCost: number; compliant: boolean };
type Comparison = Array<{ quote: QuoteSummary["quote"]; supplierName: string; lines: ComparisonLine[]; weightedScore: number | null }>;
type Supplier = { id: number; name: string; status: string; onboardingStatus?: string | null; complianceStatus?: string | null };
type Currency = { code: string; active: boolean };

function asCollection<T>(value: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}
type RequisitionSourcingContext = {
  requisition: { id: number; requisitionNumber: string; justification?: string | null; requiredDate?: string | null; supplierId?: number | null };
  reportingCurrencyCode: string;
  lines: Array<{ itemId: number; itemName: string; sku: string; quantity: number; unitPrice: number; unitOfMeasureId?: number | null; taxCodeId?: number | null; costCentreId?: number | null; glAccountCode?: string | null; notes?: string | null }>;
  linkedEvents: Array<{ id: number; eventNumber: string; status: string }>;
};

type DraftLine = {
  description: string;
  quantity: string;
  targetUnitPrice: string;
  itemId?: number | null;
  unitOfMeasureId?: number | null;
  taxCodeId?: number | null;
  costCentreId?: number | null;
  glAccountCode?: string | null;
  requiredDate?: string | null;
};
type DraftCriterion = { name: string; criterionType: "commercial" | "technical" | "compliance" | "delivery" | "risk"; weight: string };

function mutationKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["OPEN", "AWARDED", "APPROVED", "SUBMITTED", "COMPLIANT"].includes(status)) return "default";
  if (["CANCELLED", "REJECTED", "WITHDRAWN", "EXCEPTION"].includes(status)) return "destructive";
  if (["DRAFT", "INVITED"].includes(status)) return "outline";
  return "secondary";
}

function NewEventDialog({ open, onOpenChange, requisitionId }: { open: boolean; onOpenChange: (open: boolean) => void; requisitionId?: number | null }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [currency, setCurrency] = useState("ZAR");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierIds, setSupplierIds] = useState<number[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", quantity: "1", targetUnitPrice: "" }]);
  const [criteria, setCriteria] = useState<DraftCriterion[]>([
    { name: "Total landed cost", criterionType: "commercial", weight: "70" },
    { name: "Delivery capability", criterionType: "delivery", weight: "30" },
  ]);
  const prefillApplied = useRef(false);

  const suppliersQuery = useQuery<{ items: Supplier[] }>({ queryKey: ["/api/v2/suppliers", "sourcing-picker", supplierSearch], queryFn: () => requestJson("GET", `/api/v2/suppliers?page=1&pageSize=25&q=${encodeURIComponent(supplierSearch)}&status=active&sort=name_asc`) });
  const currenciesQuery = useQuery<Currency[] | { items?: Currency[] }>({ queryKey: ["/api/currencies", "sourcing-picker"], queryFn: () => requestJson("GET", "/api/currencies") });
  const organizationQuery = useQuery<{ organization?: { defaultCurrencyCode?: string | null } }>({ queryKey: ["/api/organization/settings", "sourcing-currency"], queryFn: () => requestJson("GET", "/api/organization/settings") });
  const requisitionQuery = useQuery<RequisitionSourcingContext>({
    queryKey: ["/api/sourcing/requisition-context", requisitionId],
    queryFn: () => requestJson("GET", `/api/sourcing/requisition-context/${requisitionId}`),
    enabled: Boolean(requisitionId),
  });
  useEffect(() => {
    if (prefillApplied.current) return;
    const context = requisitionQuery.data;
    if (context) {
      prefillApplied.current = true;
      setTitle(`RFQ for ${context.requisition.requisitionNumber}`);
      setDescription(context.requisition.justification ?? "");
      setCurrency(context.reportingCurrencyCode);
      setSupplierIds(context.requisition.supplierId ? [context.requisition.supplierId] : []);
      setLines(context.lines.map((line) => ({
        description: `${line.sku} - ${line.itemName}${line.notes ? ` / ${line.notes}` : ""}`,
        quantity: String(line.quantity),
        targetUnitPrice: String(line.unitPrice),
        itemId: line.itemId,
        unitOfMeasureId: line.unitOfMeasureId,
        taxCodeId: line.taxCodeId,
        costCentreId: line.costCentreId,
        glAccountCode: line.glAccountCode,
        requiredDate: context.requisition.requiredDate,
      })));
      return;
    }
    const organizationCurrency = organizationQuery.data?.organization?.defaultCurrencyCode?.trim().toUpperCase();
    if (!requisitionId && organizationCurrency) {
      prefillApplied.current = true;
      setCurrency(organizationCurrency);
    }
  }, [organizationQuery.data, requisitionId, requisitionQuery.data]);
  const eligibleSuppliers = useMemo(() => asCollection(suppliersQuery.data).filter((supplier) => {
    const eligible = String(supplier.status).toLowerCase() === "active"
      && String(supplier.onboardingStatus ?? "approved").toLowerCase() === "approved"
      && String(supplier.complianceStatus ?? "").toLowerCase() !== "blocked";
    return eligible && supplier.name.toLowerCase().includes(supplierSearch.toLowerCase());
  }), [supplierSearch, suppliersQuery.data]);
  const totalWeight = criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0);

  const createMutation = useMutation({
    mutationFn: () => requestJson<EventDetails>("POST", "/api/sourcing/events", {
      title,
      description: description || null,
      deadline,
      requisitionId: requisitionId ?? null,
      reportingCurrencyCode: currency,
      minimumResponses: Math.min(Math.max(supplierIds.length > 1 ? 2 : 1, 1), supplierIds.length),
      competitionRequired: supplierIds.length > 1,
      supplierIds,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        targetUnitPrice: line.targetUnitPrice ? Number(line.targetUnitPrice) : null,
        targetCurrencyCode: currency,
        itemId: line.itemId ?? null,
        unitOfMeasureId: line.unitOfMeasureId ?? null,
        taxCodeId: line.taxCodeId ?? null,
        costCentreId: line.costCentreId ?? null,
        glAccountCode: line.glAccountCode ?? null,
        requiredDate: line.requiredDate ?? null,
      })),
      criteria: criteria.map((criterion) => ({ name: criterion.name, criterionType: criterion.criterionType, weight: Number(criterion.weight) })),
    }),
    onSuccess: async (details) => {
      await invalidateSourcingDomain(queryClient, details.event.id);
      toast({ title: "RFQ draft created", description: `${details.event.eventNumber} is ready for review and publication.` });
      onOpenChange(false);
      navigate(APP_ROUTES.procurement.sourcingEvent(details.event.id));
    },
  });
  const invalid = !title.trim() || !deadline || supplierIds.length === 0 || lines.some((line) => !line.description.trim() || Number(line.quantity) <= 0) || criteria.some((criterion) => !criterion.name.trim() || Number(criterion.weight) <= 0) || Math.abs(totalWeight - 100) > 0.01;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="sourcing-create-dialog">
        <DialogHeader>
          <DialogTitle>Create sourcing event</DialogTitle>
          <DialogDescription>{requisitionId ? "Review the approved requisition, add competing suppliers, and publish a controlled RFQ." : "Define the commercial requirement, invite approved suppliers, and set a weighted evaluation model."}</DialogDescription>
        </DialogHeader>
        {requisitionQuery.error ? <PanelInlineError title="Requisition could not be loaded" description={requisitionQuery.error.message} /> : null}
        {requisitionQuery.data?.linkedEvents.some((event) => !["CANCELLED", "ARCHIVED"].includes(event.status)) ? (
          <PanelInlineError title="RFQ already exists" description={`This requisition is linked to ${requisitionQuery.data.linkedEvents[0].eventNumber}. Open the existing event instead of creating a duplicate.`} />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="rfq-title">Event title</Label><Input id="rfq-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Office equipment framework RFQ" /></div>
          <div className="space-y-2"><Label htmlFor="rfq-deadline">Submission deadline</Label><Input id="rfq-deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></div>
          <div className="space-y-2"><Label>Reporting currency</Label><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{asCollection(currenciesQuery.data).filter((item) => item.active).map((item) => <SelectItem key={item.code} value={item.code}>{item.code}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="rfq-description">Commercial brief</Label><Textarea id="rfq-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Scope, delivery expectations, compliance requirements, and award assumptions." /></div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between"><div><h3 className="font-semibold">RFQ lines</h3><p className="text-sm text-muted-foreground">Each line is quoted separately and carried through to award and PO.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", targetUnitPrice: "" }])}><Plus className="mr-2 h-4 w-4" />Add line</Button></div>
          {lines.map((line, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_7rem_8rem_2.5rem] gap-2"><Input aria-label={`Line ${index + 1} description`} value={line.description} onChange={(event) => setLines((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, description: event.target.value } : entry))} placeholder="Requirement description" /><Input aria-label={`Line ${index + 1} quantity`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: event.target.value } : entry))} /><Input aria-label={`Line ${index + 1} target price`} type="number" min="0" step="0.01" value={line.targetUnitPrice} onChange={(event) => setLines((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, targetUnitPrice: event.target.value } : entry))} placeholder="Target" /><Button type="button" size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove line"><X className="h-4 w-4" /></Button></div>)}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between"><div><h3 className="font-semibold">Evaluation model</h3><p className="text-sm text-muted-foreground">Weights must total 100%. Current total: {totalWeight}%.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setCriteria((current) => [...current, { name: "", criterionType: "technical", weight: "0" }])}><Plus className="mr-2 h-4 w-4" />Add criterion</Button></div>
          {criteria.map((criterion, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_10rem_6rem_2.5rem] gap-2"><Input aria-label={`Criterion ${index + 1} name`} value={criterion.name} onChange={(event) => setCriteria((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, name: event.target.value } : entry))} placeholder="Criterion" /><Select value={criterion.criterionType} onValueChange={(value: DraftCriterion["criterionType"]) => setCriteria((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, criterionType: value } : entry))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["commercial", "technical", "compliance", "delivery", "risk"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Input aria-label={`Criterion ${index + 1} weight`} type="number" min="1" max="100" value={criterion.weight} onChange={(event) => setCriteria((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, weight: event.target.value } : entry))} /><Button type="button" size="icon" variant="ghost" disabled={criteria.length === 1} onClick={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove criterion"><X className="h-4 w-4" /></Button></div>)}
        </div>

        <div className="space-y-3">
          <div><h3 className="font-semibold">Invited suppliers</h3><p className="text-sm text-muted-foreground">Only active, non-blocked suppliers are available.</p></div>
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder="Search approved suppliers" /></div>
          <div className="max-h-40 overflow-y-auto rounded-md border p-2">{eligibleSuppliers.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No eligible suppliers match this search.</p> : eligibleSuppliers.map((supplier) => <label key={supplier.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-muted"><Checkbox checked={supplierIds.includes(supplier.id)} onCheckedChange={(checked) => setSupplierIds((current) => checked ? [...current, supplier.id] : current.filter((id) => id !== supplier.id))} /><span className="flex-1 text-sm font-medium">{supplier.name}</span><Badge variant="outline">{supplier.status}</Badge></label>)}</div>
        </div>
        {createMutation.error ? <PanelInlineError title="RFQ could not be created" description={createMutation.error.message} /> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" disabled={invalid || createMutation.isPending} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Creating..." : "Create draft"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvaluationAndAwardPanel({ eventId, details, comparison }: { eventId: number; details: EventDetails; comparison: Comparison }) {
  const { toast } = useToast();
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>(comparison[0] ? String(comparison[0].quote.id) : "");
  const [scores, setScores] = useState<Record<number, string>>(() => Object.fromEntries(details.criteria.map((criterion) => [criterion.id, ""] as const)));
  const [awardSelections, setAwardSelections] = useState<Record<number, string>>(() => Object.fromEntries(details.lines.map((line) => {
    const first = comparison.flatMap((entry) => entry.lines).find((quoteLine) => quoteLine.eventLineId === line.id && quoteLine.compliant);
    return [line.id, first ? String(first.id) : ""] as const;
  })));
  const [justification, setJustification] = useState("");
  const [approvalReason, setApprovalReason] = useState("");

  const refresh = async () => invalidateSourcingDomain(queryClient, eventId);
  const evaluationMutation = useMutation({
    mutationFn: () => requestJson("POST", `/api/sourcing/events/${eventId}/quotes/${selectedQuoteId}/evaluation`, {
      scores: details.criteria.map((criterion) => ({ criterionId: criterion.id, score: Number(scores[criterion.id]), comment: null })),
    }),
    onSuccess: async () => { await refresh(); toast({ title: "Evaluation saved", description: "Weighted comparison has been recalculated." }); },
  });
  const awardMutation = useMutation({
    mutationFn: () => requestJson<{ award: Award }>("POST", `/api/sourcing/events/${eventId}/awards`, {
      justification,
      lines: details.lines.map((line) => ({ eventLineId: line.id, quoteLineId: Number(awardSelections[line.id]), awardedQuantity: line.quantity })),
    }, { headers: { "Idempotency-Key": mutationKey() } }),
    onSuccess: async () => { await refresh(); toast({ title: "Award submitted", description: "An independent sourcing approver must approve it before PO conversion." }); },
  });
  const awardActionMutation = useMutation({
    mutationFn: ({ awardId, action }: { awardId: number; action: "approve" | "convert-to-po" }) => requestJson("POST", `/api/sourcing/awards/${awardId}/${action}`, action === "approve" ? { reason: approvalReason } : {}, { headers: { "Idempotency-Key": mutationKey() } }),
    onSuccess: async (_data, variables) => { await refresh(); toast({ title: variables.action === "approve" ? "Award approved" : "Purchase order created", description: variables.action === "approve" ? "The approved award is ready for controlled PO conversion." : "Awarded pricing and MDM evidence were carried into the PO." }); },
  });
  const selectedQuote = comparison.find((entry) => String(entry.quote.id) === selectedQuoteId);
  const latestAward = details.awards[0];
  const scoreInvalid = !selectedQuoteId || details.criteria.some((criterion) => {
    const score = Number(scores[criterion.id]);
    return scores[criterion.id] === "" || !Number.isFinite(score) || score < 0 || score > 100;
  });
  const awardInvalid = justification.trim().length < 10 || details.lines.some((line) => !awardSelections[line.id]);

  return <div className="grid gap-4 xl:grid-cols-2" data-testid="sourcing-evaluation-award-panel">
    <Card><CardHeader><CardTitle className="text-base">Weighted evaluation</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="space-y-1"><Label>Supplier quote</Label><Select value={selectedQuoteId} onValueChange={setSelectedQuoteId}><SelectTrigger><SelectValue placeholder="Select quote" /></SelectTrigger><SelectContent>{comparison.map((entry) => <SelectItem key={entry.quote.id} value={String(entry.quote.id)}>{entry.supplierName} / {entry.quote.quoteNumber}</SelectItem>)}</SelectContent></Select></div>
      {details.criteria.map((criterion) => <div key={criterion.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3"><div><Label htmlFor={`score-${criterion.id}`}>{criterion.name} ({criterion.weight}%)</Label><p className="text-xs text-muted-foreground">Score from 0 to 100</p></div><Input id={`score-${criterion.id}`} type="number" min="0" max="100" value={scores[criterion.id] ?? ""} onChange={(event) => setScores((current) => ({ ...current, [criterion.id]: event.target.value }))} /></div>)}
      {selectedQuote?.weightedScore != null ? <p className="text-sm">Current weighted score: <span className="font-semibold">{selectedQuote.weightedScore.toFixed(1)}</span></p> : null}
      {evaluationMutation.error ? <PanelInlineError title="Evaluation was not saved" description={evaluationMutation.error.message} /> : null}
      <Can resource="purchases" permissionType="manage" reason="Scoring requires sourcing management permission"><Button disabled={scoreInvalid || evaluationMutation.isPending} onClick={() => evaluationMutation.mutate()}><CheckCircle2 className="mr-2 h-4 w-4" />Save evaluation</Button></Can>
    </CardContent></Card>

    <Card><CardHeader><CardTitle className="text-base">Award recommendation</CardTitle></CardHeader><CardContent className="space-y-4">
      {latestAward ? <div className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">Award #{latestAward.id}</span><Badge variant={statusVariant(latestAward.status)}>{latestAward.status}</Badge></div><p className="mt-2 text-muted-foreground">{latestAward.justification}</p></div> : details.lines.map((line) => {
        const candidates = comparison.flatMap((entry) => entry.lines.filter((quoteLine) => quoteLine.eventLineId === line.id).map((quoteLine) => ({ ...quoteLine, supplierName: entry.supplierName, currencyCode: entry.quote.currencyCode })));
        return <div key={line.id} className="space-y-1"><Label>Line {line.lineNumber}: {line.description}</Label><Select value={awardSelections[line.id] ?? ""} onValueChange={(value) => setAwardSelections((current) => ({ ...current, [line.id]: value }))}><SelectTrigger><SelectValue placeholder="Choose winning quote" /></SelectTrigger><SelectContent>{candidates.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)} disabled={!candidate.compliant}>{candidate.supplierName} / {candidate.currencyCode} {candidate.unitPrice.toFixed(2)}{candidate.compliant ? "" : " / exception"}</SelectItem>)}</SelectContent></Select></div>;
      })}
      {!latestAward ? <><div className="space-y-1"><Label htmlFor="award-justification">Award justification</Label><Textarea id="award-justification" value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Explain the commercial and non-commercial basis for the recommendation." /></div>{awardMutation.error ? <PanelInlineError title="Award was not submitted" description={awardMutation.error.message} /> : null}<Can resource="purchases" permissionType="manage" reason="Award recommendation requires sourcing management permission"><Button disabled={awardInvalid || awardMutation.isPending} onClick={() => awardMutation.mutate()}><Gavel className="mr-2 h-4 w-4" />Submit award</Button></Can></> : null}
      {latestAward?.status === "SUBMITTED" ? <><div className="space-y-1"><Label htmlFor="award-approval-reason">Independent approval reason</Label><Input id="award-approval-reason" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="Required approval rationale" /></div><Can resource="purchases" permissionType="approve" reason="Award approval requires independent purchasing approval and 2FA"><Button disabled={approvalReason.trim().length < 5 || awardActionMutation.isPending} onClick={() => awardActionMutation.mutate({ awardId: latestAward.id, action: "approve" })}>Approve award</Button></Can></> : null}
      {latestAward?.status === "APPROVED" ? <Can resource="purchases" permissionType="approve" reason="PO conversion requires purchasing approval"><Button disabled={awardActionMutation.isPending} onClick={() => awardActionMutation.mutate({ awardId: latestAward.id, action: "convert-to-po" })}>Convert award to PO</Button></Can> : null}
      {latestAward?.status === "CONVERTED" ? <p className="text-sm text-muted-foreground">This award has been converted to controlled purchase order records.</p> : null}
      {awardActionMutation.error ? <PanelInlineError title="Award action failed" description={awardActionMutation.error.message} /> : null}
    </CardContent></Card>
  </div>;
}

function EventDetail({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const detailsQuery = useQuery<EventDetails>({ queryKey: qk.sourcingEvent(eventId), queryFn: () => requestJson("GET", `/api/sourcing/events/${eventId}`) });
  const comparisonQuery = useQuery<Comparison>({ queryKey: qk.sourcingComparison(eventId), queryFn: () => requestJson("GET", `/api/sourcing/events/${eventId}/comparison`), enabled: Boolean(detailsQuery.data && !["DRAFT", "OPEN"].includes(detailsQuery.data.event.status)) });
  const emailPreviewQuery = useQuery<RfqEmailPreview>({
    queryKey: ["/api/sourcing/events", eventId, "email-preview"],
    queryFn: () => requestJson("GET", `/api/sourcing/events/${eventId}/email-preview`),
    enabled: emailPreviewOpen,
  });
  const workflowMutation = useMutation({
    mutationFn: (action: "publish" | "close") => requestJson("POST", `/api/sourcing/events/${eventId}/${action}`, {}, { headers: { "Idempotency-Key": mutationKey() } }),
    onSuccess: async (_result, action) => {
      await invalidateSourcingDomain(queryClient, eventId);
      toast({ title: action === "publish" ? "RFQ published" : "RFQ closed for evaluation" });
    },
  });
  return <PageDataState isLoading={detailsQuery.isLoading} error={detailsQuery.error} isEmpty={!detailsQuery.data} onRetry={() => void detailsQuery.refetch()} emptyView={<div>RFQ not found.</div>}>
    {detailsQuery.data ? <div className="space-y-5" data-testid="sourcing-event-detail">
      <PageHeader title={detailsQuery.data.event.title} subtitle={`${detailsQuery.data.event.eventNumber} / closes ${new Date(detailsQuery.data.event.deadline).toLocaleString()}`} breadcrumb={<Link href={APP_ROUTES.procurement.sourcing}>Sourcing / RFQs</Link>} actions={<div className="flex flex-wrap gap-2"><Badge variant={statusVariant(detailsQuery.data.event.status)} className="self-center">{detailsQuery.data.event.status}</Badge><Button type="button" variant="outline" onClick={() => setEmailPreviewOpen(true)}><Mail className="mr-2 h-4 w-4" />Preview supplier emails</Button>{detailsQuery.data.event.status === "OPEN" ? <Button asChild variant="outline"><Link href={`${APP_ROUTES.procurement.quotationNew}?eventId=${detailsQuery.data.event.id}`}><Plus className="mr-2 h-4 w-4" />Capture quotation</Link></Button> : null}{detailsQuery.data.event.status === "DRAFT" ? <Can resource="purchases" permissionType="manage" reason="Publishing requires sourcing management permission"><Button onClick={() => workflowMutation.mutate("publish")} disabled={workflowMutation.isPending}><Send className="mr-2 h-4 w-4" />Publish RFQ</Button></Can> : null}{detailsQuery.data.event.status === "OPEN" ? <Can resource="purchases" permissionType="manage" reason="Closing requires sourcing management permission"><Button onClick={() => workflowMutation.mutate("close")} disabled={workflowMutation.isPending}><ClipboardCheck className="mr-2 h-4 w-4" />Close for evaluation</Button></Can> : null}</div>} />
      {workflowMutation.error ? <PanelInlineError title="Workflow action failed" description={workflowMutation.error.message} /> : null}
      <div className="grid gap-4 lg:grid-cols-3"><Card><CardHeader><CardTitle className="text-base">Commercial lines</CardTitle></CardHeader><CardContent className="space-y-2">{detailsQuery.data.lines.map((line) => <div key={line.id} className="flex justify-between border-b pb-2 text-sm"><span>{line.lineNumber}. {line.description}</span><span className="font-medium">{line.quantity}</span></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Invited suppliers</CardTitle></CardHeader><CardContent className="space-y-2">{detailsQuery.data.invitations.map((entry) => <div key={entry.invitation.id} className="flex items-center justify-between text-sm"><span>{entry.supplierName}</span><Badge variant={statusVariant(entry.invitation.status)}>{entry.invitation.status}</Badge></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Evaluation criteria</CardTitle></CardHeader><CardContent className="space-y-2">{detailsQuery.data.criteria.map((criterion) => <div key={criterion.id} className="flex items-center justify-between text-sm"><span>{criterion.name}</span><span className="font-medium">{criterion.weight}%</span></div>)}</CardContent></Card></div>
      <Card><CardHeader><CardTitle className="text-base">Quote comparison</CardTitle></CardHeader><CardContent>{detailsQuery.data.quotes.length === 0 ? <p className="text-sm text-muted-foreground">No supplier responses yet. The empty state reflects live RFQ data.</p> : <Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Quote</TableHead><TableHead>Compliance</TableHead><TableHead className="text-right">Reporting total</TableHead><TableHead className="text-right">Weighted score</TableHead></TableRow></TableHeader><TableBody>{(comparisonQuery.data ?? detailsQuery.data.quotes.map((entry) => ({ ...entry, weightedScore: null }))).map((entry) => <TableRow key={entry.quote.id}><TableCell className="font-medium">{entry.supplierName}</TableCell><TableCell>{entry.quote.quoteNumber} v{entry.quote.version}</TableCell><TableCell><Badge variant={statusVariant(entry.quote.complianceStatus)}>{entry.quote.complianceStatus}</Badge></TableCell><TableCell className="text-right">{entry.quote.currencyCode} {entry.quote.reportingTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell><TableCell className="text-right">{entry.weightedScore == null ? "Not scored" : entry.weightedScore.toFixed(1)}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
      {["EVALUATING", "AWARDED"].includes(detailsQuery.data.event.status) && comparisonQuery.data?.length ? <EvaluationAndAwardPanel eventId={eventId} details={detailsQuery.data} comparison={comparisonQuery.data} /> : null}
      <Dialog open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl" data-testid="rfq-email-preview-dialog">
          <DialogHeader>
            <DialogTitle>Supplier email preview</DialogTitle>
            <DialogDescription>Review the exact recipient, subject, RFQ lines, deadline, and secure supplier-workspace link before publishing. This preview does not send email.</DialogDescription>
          </DialogHeader>
          <PageDataState
            isLoading={emailPreviewQuery.isLoading}
            error={emailPreviewQuery.error}
            isEmpty={Boolean(emailPreviewQuery.data && emailPreviewQuery.data.previews.length === 0)}
            onRetry={() => void emailPreviewQuery.refetch()}
            emptyView={<p className="text-sm text-muted-foreground">No invited suppliers are available for preview.</p>}
          >
            <div className="space-y-4">
              {emailPreviewQuery.data?.previews.map((preview) => (
                <Card key={preview.supplierId}>
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">{preview.supplierName}</CardTitle>
                      <Badge variant={preview.recipientState === "ready" ? "secondary" : "destructive"}>
                        {preview.recipientState === "ready" ? "Recipient ready" : "Supplier email missing"}
                      </Badge>
                    </div>
                    <p className="text-sm"><span className="font-medium">To:</span> {preview.to ?? "Add an email in Supplier Master Data"}</p>
                    <p className="text-sm"><span className="font-medium">Subject:</span> {preview.subject}</p>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-sans text-sm leading-6">{preview.text}</pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          </PageDataState>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEmailPreviewOpen(false)}>Close preview</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div> : null}
  </PageDataState>;
}

export default function SourcingPage() {
  const [match, params] = useRoute<{ id: string }>("/procurement/sourcing/:id");
  const [createOpen, setCreateOpen] = useState(false);
  const requisitionId = Number(new URLSearchParams(globalThis.location?.search ?? "").get("requisitionId")) || null;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const eventsQuery = useQuery<{ items: SourcingEvent[]; total: number; page: number; pageSize: number; hasNext: boolean }>({ queryKey: [...qk.sourcing, "v2", search, page], queryFn: () => requestJson("GET", `/api/v2/procurement/sourcing-events?page=${page}&pageSize=25&q=${encodeURIComponent(search)}&sort=updated_desc`), enabled: !match });
  const events = eventsQuery.data?.items ?? [];
  useEffect(() => {
    if (requisitionId && !match) setCreateOpen(true);
  }, [match, requisitionId]);
  if (match) return <PageShell variant="wide-table"><EventDetail eventId={Number(params.id)} /></PageShell>;
  return <PageShell variant="wide-table" data-testid="sourcing-workspace">
    <PageHeader title="Sourcing & RFQs" subtitle="Competitive events, supplier quotes, evaluation, and controlled awards" icon={Scale} actions={<Can resource="purchases" permissionType="create" reason="Creating RFQs requires purchasing create permission"><Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />New RFQ</Button></Can>} />
    <PageToolbar><div className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search event number, title, or status" /></div><Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></PageToolbar>
    <Card><CardContent className="p-0"><PageDataState isLoading={eventsQuery.isLoading} error={eventsQuery.error} isEmpty={events.length === 0} onRetry={() => void eventsQuery.refetch()} emptyView={<div className="p-10 text-center"><Scale className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No sourcing events</p><p className="text-sm text-muted-foreground">Create an RFQ when competitive sourcing evidence is required.</p></div>}><><Table><TableHeader><TableRow><TableHead>RFQ</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Deadline</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => <TableRow key={event.id}><TableCell className="font-mono text-xs">{event.eventNumber}</TableCell><TableCell className="font-medium">{event.title}</TableCell><TableCell><Badge variant={statusVariant(event.status)}>{event.status}</Badge></TableCell><TableCell>{new Date(event.deadline).toLocaleString()}</TableCell><TableCell>{event.reportingCurrencyCode}</TableCell><TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link href={APP_ROUTES.procurement.sourcingEvent(event.id)}>Open</Link></Button></TableCell></TableRow>)}</TableBody></Table>{eventsQuery.data ? <div className="flex items-center justify-between border-t p-3 text-sm"><span>{eventsQuery.data.total === 0 ? "0 results" : `${(page - 1) * 25 + 1}–${Math.min(page * 25, eventsQuery.data.total)} of ${eventsQuery.data.total}`}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={!eventsQuery.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button></div></div> : null}</></PageDataState></CardContent></Card>
    <NewEventDialog open={createOpen} onOpenChange={setCreateOpen} requisitionId={requisitionId} />
  </PageShell>;
}
