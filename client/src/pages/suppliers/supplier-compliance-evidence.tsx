import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { documentLibraryHref } from "@shared/document-query";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { requestJson } from "@/lib/queryClient";
import { userFacingError } from "@/lib/user-facing-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Publication = { id: string; documentType: string; sourceRecordId: number; documentId: number; documentVersion: number; effectiveAt: string; expiresAt: string | null; state: "verified" | "expired" | "withdrawn" | "unavailable" };
type Evidence = { requiredTypes: string[]; items: Publication[] };

export function SupplierComplianceEvidence({ supplierId, revision, onboardingStatus }: { supplierId: number; revision: string; onboardingStatus: string }) {
  const { user } = useAuth(), { hasPermission } = usePermissions();
  const organizationId = (user as typeof user & { activeOrganizationId?: number })?.activeOrganizationId;
  const canRead = hasPermission("suppliers", "read") && hasPermission("documents", "read");
  const canUpdate = hasPermission("suppliers", "update");
  const canSubmit = canUpdate && hasPermission("settings", "read");
  const [expanded, setExpanded] = useState(false), [documentType, setDocumentType] = useState(""), [documentId, setDocumentId] = useState(""), [expires, setExpires] = useState(""), [reason, setReason] = useState("");
  const [withdraw, setWithdraw] = useState<number | null>(null), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [approvalReason, setApprovalReason] = useState("");
  const scope = [organizationId, user?.id, user?.warehouseId, canRead, supplierId];
  const root = `/api/v2/suppliers/${supplierId}/compliance-evidence`;
  const cache = useQueryClient();
  const evidence = useQuery({ queryKey: ["supplier-compliance-evidence", ...scope], queryFn: () => requestJson<Evidence>("GET", root), enabled: Boolean(expanded && canRead && organizationId), retry: false, gcTime: 0 });
  const documents = useQuery({ queryKey: ["supplier-compliance-documents", ...scope, search, page], enabled: Boolean(expanded && canRead && canSubmit && !withdraw && organizationId), retry: false,
    queryFn: () => requestJson<{ items: Array<{ id: number; fileName: string; version: number }>; hasNext: boolean }>("GET", `/api/v2/documents?${new URLSearchParams({ entityType: "supplier", entityId: String(supplierId), fileStatus: "available", page: String(page), pageSize: "25", ...(search.trim() ? { q: search.trim() } : {}) })}`) });
  const submit = useMutation({ mutationFn: () => requestJson<{ id: number }>("POST", "/api/mdm/change-requests", {
    domain: "supplier-documents", action: withdraw ? "deactivate" : "create", entityId: withdraw,
    proposedPatch: withdraw ? {} : { supplierId, documentType, documentId: Number(documentId), expiryDate: expires ? `${expires}T23:59:59.999Z` : null }, reason: reason.trim(),
  }), onSuccess: () => { setReason(""); setWithdraw(null); void cache.invalidateQueries({ queryKey: ["/api/mdm/change-requests"] }); } });
  const approve = useMutation({ mutationFn: () => requestJson("POST", `/api/suppliers/${supplierId}/approve`, { reason: approvalReason.trim(), expectedRevision: revision }), onSuccess: () => {
    setApprovalReason(""); void cache.invalidateQueries({ queryKey: ["/api/suppliers", supplierId] });
  } });
  if (!canRead) return null;
  return <Card data-testid="supplier-compliance-evidence"><CardHeader><CardTitle>Dated compliance evidence</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">Only independently published document versions count for onboarding. Legacy status labels are not proof.</p>
    <Button variant="outline" onClick={() => {setExpanded(value => !value); if (!expanded && evidence.data) void evidence.refetch();}}>{expanded ? "Hide compliance evidence" : "Review compliance evidence"}</Button>
    {expanded && <>
      {evidence.isPending || evidence.isFetching ? <p role="status">Loading compliance evidence…</p> : evidence.isError ? <><p role="alert">{userFacingError(evidence.error)}</p><Button variant="outline" onClick={() => void evidence.refetch()}>Retry compliance evidence</Button></> : <>
        <p className="text-sm">Required for onboarding: {evidence.data.requiredTypes.join(", ") || "None"}</p>
        {!evidence.data.items.length && <p>No dated evidence published.</p>}
        <ul className="space-y-2">{evidence.data.items.map(item => <li className="rounded border p-3 text-sm break-words" key={item.id}>
          <strong>{item.documentType}</strong> · {item.state} · Published {new Date(item.effectiveAt).toLocaleString()}
          <p>{item.expiresAt ? `Expires ${new Date(item.expiresAt).toLocaleString()}` : "No expiry recorded"}</p>
          {item.state !== "unavailable" && <Link className="underline" href={documentLibraryHref("supplier", supplierId, item.documentId)}>Source document v{item.documentVersion}</Link>}
          {canSubmit && item.state !== "withdrawn" && <Button className="ml-2" variant="outline" size="sm" onClick={() => {setWithdraw(item.sourceRecordId);submit.reset();}}>Propose withdrawal</Button>}
        </li>)}</ul>
        {canSubmit && <form className="space-y-2" onSubmit={event => {event.preventDefault();submit.mutate();}}>
          {withdraw ? <p>Propose withdrawal of record #{withdraw}. <Button type="button" variant="ghost" onClick={() => setWithdraw(null)}>Cancel withdrawal</Button></p> : <>
            <label className="block text-sm">Evidence type<select className="block w-full rounded border p-2" value={documentType} onChange={event => setDocumentType(event.target.value)}><option value="">Choose type</option>{evidence.data.requiredTypes.map(type => <option key={type}>{type}</option>)}</select></label>
            <label className="block text-sm">Find verified supplier documents<input className="block w-full rounded border p-2" value={search} maxLength={120} onChange={event => {setSearch(event.target.value);setPage(1);setDocumentId("");}} /></label>
            {documents.isError && <p role="alert">{userFacingError(documents.error)}</p>}
            <label className="block text-sm">Evidence document<select className="block w-full rounded border p-2" value={documentId} onChange={event => setDocumentId(event.target.value)}><option value="">Choose a document</option>{!documents.isError && documents.data?.items.map(document => <option value={document.id} key={document.id}>{document.fileName} (v{document.version})</option>)}</select></label>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={page === 1} onClick={() => {setPage(value => value - 1);setDocumentId("");}}>Previous documents</Button><Button type="button" variant="outline" disabled={!documents.data?.hasNext} onClick={() => {setPage(value => value + 1);setDocumentId("");}}>Next documents</Button></div>
            <label className="block text-sm">Expiry date (end of UTC day, optional)<input className="block rounded border p-2" type="date" value={expires} onChange={event => setExpires(event.target.value)} /></label>
          </>}
          <label className="block text-sm">Compliance change reason<input className="block w-full rounded border p-2" value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>
          <Button type="submit" disabled={submit.isPending || reason.trim().length < 5 || (!withdraw && (!documentType || !documentId || documents.isError || documents.isFetching))}>Submit compliance request</Button>
          {submit.isSuccess && <p role="status">Request #{submit.data.id} submitted. <Link className="underline" href="/admin/master-data">Review in Master Data</Link></p>}
          {submit.isError && <p role="alert">{userFacingError(submit.error)}</p>}
        </form>}
        {canUpdate && onboardingStatus !== "approved" && <form className="space-y-2 border-t pt-3" onSubmit={event => {event.preventDefault();approve.mutate();}}>
          <label className="block text-sm">Independent onboarding approval reason<input className="block w-full rounded border p-2" value={approvalReason} maxLength={1000} onChange={event => setApprovalReason(event.target.value)} /></label>
          <Button type="submit" disabled={approve.isPending || approvalReason.trim().length < 5}>Approve reviewed supplier profile</Button>
          {approve.isError && <p role="alert">{userFacingError(approve.error)}</p>}
        </form>}
      </>}
    </>}
  </CardContent></Card>;
}
