import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePermissions } from "@/hooks/use-permissions";
import { requestJson } from "@/lib/queryClient";
import { userFacingError } from "@/lib/user-facing-error";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { maverickEvidenceFamilies, type MaverickEvidenceCoverage, type MaverickEvidenceFamily } from "@shared/maverick-evidence";

const modes: Record<string, string> = { WARNING_ONLY: "Warning only", WARN_APPROVAL: "Warning + elevated approval", HARD_BLOCK: "Hard block" };
const readinessLabels: Record<string, string> = { requireUomConversion: "unit conversion", requireTaxCode: "tax code", requireGlMapping: "GL mapping", requireFxRate: "FX rate" };
const sourcingLabels: Record<string, string> = { award_found: "approved award found", below_threshold: "below the configured threshold", not_configured: "no competition rule configured", threshold_unavailable: "threshold unavailable" };
type Policy = { code: string; updatedAt: string };
type SourcingDecision = { policy: Policy | null; outcome: string; threshold: number | null; award: { eventId: number; awardId: number } | null };
type Row = {
  coverage: MaverickEvidenceCoverage;
  id: number; orderNumber: string; orderDate: string | null; requisitionId: number | null; requisitionNumber: string | null;
  outcome: "within_budget" | "over_budget" | "no_matching_budget" | null;
  policyMode: string | null; policyRevision: string | null; evaluatedAt: string | null; budgetId: string | null; exceptionId: string | null;
  budgetCapturedAt: string | null; budgetConversionKind: string | null; exceptionRevision: string | null;
  approvedOverrideReason: string | null; overrideApprovedAt: string | null; overrideRuleRevision: string | null;
  sourcingEventId: number | null; sourcingAwardId: number | null;
  agreementId: number | null; agreementReleaseId: string | null; agreementVersion: number | null; agreementReference: string | null;
  submissionEvidence: { observedAt: string; readinessPolicy: Policy | null; readinessRules: Record<string, boolean>;
    sourcing: SourcingDecision | null } | null;
  conversionEvidence: { observedAt: string; sourcing: SourcingDecision | null; budgetTransferred: boolean;
    supplier: { supplierStatus: string | null; supplierComplianceStatus: string | null } | null } | null;
  orderedAmount: string | null; currencyCode: string | null;
};
const families = Object.entries(maverickEvidenceFamilies) as [MaverickEvidenceFamily, string][];
const coverageLabels = {recorded:"Recorded",unverified:"Unverified",not_linked:"No source linked"};
type SupplierChoice = {id:number; name:string};

function SourcingEvidence({ decision }: { decision: SourcingDecision }) {
  return <p>Competition: {sourcingLabels[decision.outcome] ?? "unverified"}
    {decision.threshold !== null && ` · Threshold ${decision.threshold} (reporting value)`}
    {decision.policy && ` · ${decision.policy.code} · Revision ${decision.policy.updatedAt}`}
    {decision.award && <> · <Link className="underline" href={APP_ROUTES.procurement.sourcingEvent(decision.award.eventId)}>
      Award #{decision.award.awardId}</Link></>}</p>;
}

export function MaverickSpendEvidence() {
  const [open, setOpen] = useState(false), [outcome, setOutcome] = useState("outside_budget"), [page, setPage] = useState(1);
  const [family,setFamily] = useState(""), [pageSize,setPageSize] = useState("25");
  const [from,setFrom] = useState(""), [to,setTo] = useState("");
  const [supplierSearch,setSupplierSearch] = useState(""), [supplierPage,setSupplierPage] = useState(1);
  const { user } = useAuth(), { hasPermission } = usePermissions();
  const read = hasPermission("purchases", "read"), supplierRead = hasPermission("suppliers","read");
  const org = (user as typeof user & { activeOrganizationId?: number })?.activeOrganizationId;
  const scope = `${org}:${user?.id}:${user?.warehouseId}`;
  const [selectedSupplier,setSelectedSupplier] = useState<{scope:string;supplier:SupplierChoice}|null>(null);
  const supplier = supplierRead && selectedSupplier?.scope===scope ? selectedSupplier.supplier : null;
  const q = useDebouncedValue(supplierSearch.trim(),250);
  const suppliers = useQuery({
    queryKey:["/api/v2/suppliers","maverick-picker",scope,supplierPage,q],
    queryFn:()=>requestJson<{items:SupplierChoice[];hasNext:boolean}>("GET",`/api/v2/suppliers?${new URLSearchParams({page:String(supplierPage),pageSize:"25",sort:"name_asc",q})}`),
    enabled:open&&read&&supplierRead&&!!user&&q===supplierSearch.trim(),retry:false,gcTime:0,
  });
  const supplierChoices = q===supplierSearch.trim() ? suppliers.data?.items ?? [] : [];
  const invalidDates = Boolean(from && to && from>to);
  const query = new URLSearchParams({outcome,page:String(page),pageSize});
  if(outcome==="unverified"&&family) query.set("evidenceFamily",family);
  if(from) query.set("from",from);
  if(to) query.set("to",to);
  if(supplier) query.set("supplierId",String(supplier.id));
  const evidence = useQuery({
    queryKey: ["maverick-spend-evidence", scope, query.toString(), read, supplierRead],
    queryFn: () => requestJson<{ items: Row[]; hasNext: boolean }>("GET", `/api/v2/procurement/maverick-spend?${query}`),
    enabled: open && read && !!user && !invalidDates, retry: false, gcTime: 0, staleTime: 0,
  });
  if (!read) return null;
  return <section aria-label="Maverick spend evidence" className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">Maverick spend evidence</h2>
    <p className="text-sm text-muted-foreground">Dated budget decisions, independently approved sourcing overrides, agreement releases, and PO conversion and submission checks. Each applies only to its recorded decision. Missing evidence does not mean compliance or a breach.</p>
    <Button variant="outline" onClick={() => setOpen(value => !value)}>{open ? "Hide budget evidence" : "Review budget evidence"}</Button>
    {open && <>
      <div className="grid gap-2 sm:grid-cols-2">
      <label className="min-w-0 text-sm">Budget evidence outcome<select className="mt-1 w-full rounded border bg-background p-2" value={outcome} onChange={event => {setOutcome(event.target.value);setFamily("");setPage(1);}}>
        <option value="outside_budget">Outside budget or no matching budget</option><option value="unverified">Unverified history</option>
        <option value="within_budget">Within budget</option><option value="approved_override">Approved sourcing overrides</option>
        <option value="agreement_release">Captured agreement releases</option><option value="po_submission">Captured PO submission checks</option>
        <option value="po_conversion">Captured requisition conversions</option><option value="all">All eligible orders</option>
      </select></label>
      {outcome==="unverified" && <label className="min-w-0 text-sm">Missing evidence type
        <select className="mt-1 w-full rounded border bg-background p-2" value={family} onChange={event=>{setFamily(event.target.value);setPage(1);}}>
          <option value="">Any unverified type</option>{families.map(([id,label])=><option key={id} value={id}>{label}</option>)}
        </select>
      </label>}
      <label className="min-w-0 text-sm">PO date from<Input className="mt-1 w-full" type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1);}} /></label>
      <label className="min-w-0 text-sm">PO date through<Input className="mt-1 w-full" type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1);}} /></label>
      {supplierRead && <fieldset className="min-w-0 space-y-2 sm:col-span-2">
        <legend className="text-sm">Supplier filter</legend>
        <label className="block text-sm">Search suppliers<Input value={supplierSearch} maxLength={80} className="mt-1" onChange={event=>{setSupplierSearch(event.target.value);setSupplierPage(1);}} /></label>
        <label className="block text-sm" htmlFor="maverick-supplier">Supplier</label>
        <select id="maverick-supplier" className="w-full rounded border bg-background p-2"
          value={supplier?.id ?? ""} onChange={event=>{
            const chosen = supplierChoices.find(item=>String(item.id)===event.target.value);
            setSelectedSupplier(chosen ? {scope,supplier:chosen} : null);setPage(1);
          }}>
          <option value="">All suppliers</option>
          {supplier && !supplierChoices.some(row=>row.id===supplier.id) && <option value={supplier.id}>{supplier.name}</option>}
          {supplierChoices.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}
        </select>
        {suppliers.isError ? <div><p role="alert">{userFacingError(suppliers.error)}</p><Button type="button" variant="outline" onClick={()=>void suppliers.refetch()}>Retry supplier search</Button></div>
          : suppliers.isFetching || q!==supplierSearch.trim() ? <p role="status">Loading suppliers…</p>
          : suppliers.data?.items.length===0 ? <p className="text-sm">No suppliers match this search.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={supplierPage===1} onClick={()=>setSupplierPage(p=>p-1)}>Previous supplier page</Button>
          <Button type="button" variant="outline" size="sm" disabled={!suppliers.data?.hasNext || q!==supplierSearch.trim()} onClick={()=>setSupplierPage(p=>p+1)}>Next supplier page</Button>
        </div>
      </fieldset>}
      <label className="min-w-0 text-sm">Orders per page<select className="mt-1 w-full rounded border bg-background p-2" value={pageSize} onChange={event=>{setPageSize(event.target.value);setPage(1);}}>
        {["25","50","100"].map(size=><option key={size}>{size}</option>)}
      </select></label>
      </div>
      {invalidDates ? <p role="alert">Start date must not follow the end date.</p> : evidence.isFetching ? <p role="status">Loading budget evidence…</p> : evidence.isError ? <>
        <p role="alert">{userFacingError(evidence.error)}</p><Button variant="outline" onClick={() => void evidence.refetch()}>Retry budget evidence</Button>
      </> : <>
        {!evidence.data?.items.length && <p>No orders on this page match the selected evidence outcome.</p>}
        <ul className="space-y-2">{evidence.data?.items.map(row => <li key={row.id} className="break-words rounded border p-3 text-sm">
          <p><Link className="font-semibold underline" href={APP_ROUTES.procurement.order(row.id)}>{row.orderNumber}</Link> · {row.orderDate ?? "Order date unavailable"}</p>
          <p>Ordered value (gross, original currency): {row.orderedAmount === null ? "Unavailable" : `${row.currencyCode} ${row.orderedAmount}`}</p>
          <details className="my-1"><summary>Evidence coverage</summary>
            <ul className="pl-3">{families.map(([key,label])=><li key={key}>{label}: {coverageLabels[row.coverage[key]]}</li>)}</ul>
            <p>No source linked does not prove a rule was inapplicable.</p>
          </details>
          <p>{row.outcome === "over_budget" ? "Requisition exceeded its available budget." : row.outcome === "no_matching_budget" ? "No matching budget existed at approval." :
            row.outcome === "within_budget" ? "Requisition was within its budget at approval." : "No verified budget decision is linked to this order."}</p>
          {row.policyMode && <p>Policy: {modes[row.policyMode] ?? row.policyMode} · Revision {row.policyRevision} · Decision {row.evaluatedAt?.replace("T", " ")}</p>}
          {row.budgetCapturedAt && <p>Budget evidence was saved for this order at conversion.</p>}
          {row.requisitionId && <p>Source: <Link className="underline" href={APP_ROUTES.procurement.requisition(row.requisitionId)}>{row.requisitionNumber}</Link>
            {row.budgetId && <> · Budget #{row.budgetId}</>}
            {row.exceptionId && <> · <Link className="underline" href={`${APP_ROUTES.procurement.exceptions}/${encodeURIComponent(row.exceptionId)}`}>Recorded exception #{row.exceptionId}</Link></>}</p>}
          {row.exceptionRevision && <p>Exception revision observed at conversion: {row.exceptionRevision}. The linked exception may have changed since then.</p>}
          {row.approvedOverrideReason && row.sourcingEventId && <p>Approved sourcing override: {row.approvedOverrideReason} · {row.overrideApprovedAt}
            {" · "}<Link className="underline" href={APP_ROUTES.procurement.sourcingEvent(row.sourcingEventId)}>Award #{row.sourcingAwardId} v{row.overrideRuleRevision}</Link></p>}
          {row.agreementId && row.agreementReleaseId && <p>Agreement used at release:{" "}
            <Link className="underline" href={`${APP_ROUTES.procurement.contracts}?agreementId=${row.agreementId}&releaseId=${encodeURIComponent(row.agreementReleaseId)}`}>
              {row.agreementReference} v{row.agreementVersion}
            </Link></p>}
          {row.submissionEvidence && <div className="space-y-1">
            <p>PO submission checks passed on {new Date(row.submissionEvidence.observedAt).toLocaleString()}; later PO edits are not evaluated here.</p>
            <p>Readiness policy: {row.submissionEvidence.readinessPolicy
              ? `${row.submissionEvidence.readinessPolicy.code} · Revision ${row.submissionEvidence.readinessPolicy.updatedAt}`
              : "No additional Master Data readiness policy selected"}. Configured checks: {Object.entries(row.submissionEvidence.readinessRules)
                .filter(([, required]) => required).map(([key]) => readinessLabels[key]).filter(Boolean).join(", ") || "none"}.</p>
            {row.submissionEvidence.sourcing && <SourcingEvidence decision={row.submissionEvidence.sourcing} />}
          </div>}
          {row.conversionEvidence && <div className="space-y-1">
            <p>Requisition converted on {new Date(row.conversionEvidence.observedAt).toLocaleString()}; later PO edits are not evaluated here.</p>
            {row.conversionEvidence.sourcing && <SourcingEvidence decision={row.conversionEvidence.sourcing} />}
            {row.conversionEvidence.supplier && <p>Supplier at conversion: {row.conversionEvidence.supplier.supplierStatus ?? "status not recorded"}
              {row.conversionEvidence.supplier.supplierComplianceStatus && ` · Compliance status: ${row.conversionEvidence.supplier.supplierComplianceStatus}`}</p>}
            <p>{row.conversionEvidence.budgetTransferred ? "Budget commitment transferred." : "No active requisition budget commitment transferred."}</p>
          </div>}
        </li>)}</ul>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous budget evidence page</Button>
          <Button variant="outline" disabled={!evidence.data?.hasNext || page === 10000} onClick={() => setPage(value => value + 1)}>Next budget evidence page</Button></div>
      </>}
    </>}
  </section>;
}
