import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { documentLibraryHref } from "@shared/document-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { requestJson } from "@/lib/queryClient";
import { userFacingError } from "@/lib/user-facing-error";

type Row = {
  obligationId: string; revision: number; title: string; ownerUserId: number; ownerName: string | null;
  dueDate: string; state: "open" | "completed" | "cancelled"; note: string; overdue: boolean;
  recordedAt: string; documentId: number | null; documentVersion: number | null;
};
type Page<T> = { items: T[]; hasNext: boolean };
type ObligationPage = Page<Row> & { today: string; timezone: string };
type DocumentChoice = { id: number; version: number; fileName: string };
type Editor = { action: "create" | "revise" | "complete" | "cancel"; row?: Row };

export function ContractObligations({ contractId, focusedId }: { contractId: number; focusedId?: string }) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const org = (user as typeof user & { activeOrganizationId?: number })?.activeOrganizationId;
  const read = hasPermission("purchases", "read"), manage = hasPermission("purchases", "manage"), docs = hasPermission("documents", "read");
  const cache = useQueryClient();
  const root = `/api/v2/procurement/contracts/${contractId}/obligations`;
  const scope = [root, org, user?.id, user?.warehouseId, read, manage, docs];
  const [expanded, setExpanded] = useState(Boolean(focusedId)), [page, setPage] = useState(1), [history, setHistory] = useState(""), [historyPage, setHistoryPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null), [title, setTitle] = useState(""), [due, setDue] = useState(""), [note, setNote] = useState("");
  const [owner, setOwner] = useState(""), [ownerSearch, setOwnerSearch] = useState(""), [ownerPage, setOwnerPage] = useState(1);
  const [document, setDocument] = useState(""), [docSearch, setDocSearch] = useState(""), [docPage, setDocPage] = useState(1);
  const requestKey = useRef<{ signature: string; key: string } | null>(null);
  const enabled = !!(expanded && read && user);
  const terms = editor?.action === "create" || editor?.action === "revise";
  const rows = useQuery({ queryKey: ["contract-obligation-list", ...scope, page, focusedId], enabled, retry: false, gcTime: 0,
    queryFn: () => requestJson<ObligationPage>("GET", `${root}?${new URLSearchParams({page:String(page),...(focusedId?{obligationId:focusedId}:{})})}`) });
  const focusHeading = useRef<HTMLHeadingElement>(null), focusedOnce = useRef(false);
  const focusReady = Boolean(focusedId && rows.data && expanded && !rows.isFetching && !rows.isError);
  useEffect(()=>{
    if(focusReady && focusHeading.current && !focusedOnce.current){
      focusedOnce.current=true;
      focusHeading.current.focus();
    }
  },[focusReady]);
  const versions = useQuery({ queryKey: ["contract-obligation-history", ...scope, history, historyPage], enabled: enabled && !!history, retry: false, gcTime: 0,
    queryFn: () => requestJson<ObligationPage>("GET", `${root}/${history}/history?page=${historyPage}`) });
  const owners = useQuery({ queryKey: ["contract-obligation-owners", ...scope, ownerSearch, ownerPage], enabled: enabled && manage && !!terms, retry: false, gcTime: 0,
    queryFn: () => requestJson<Page<{ id: number; name: string }>>("GET", `${root}/owners?page=${ownerPage}&q=${encodeURIComponent(ownerSearch)}`) });
  const documents = useQuery({ queryKey: ["contract-obligation-documents", ...scope, docSearch, docPage], enabled: enabled && docs && editor?.action === "complete", retry: false, gcTime: 0,
    queryFn: () => requestJson<Page<DocumentChoice>>("GET", `/api/v2/documents?${new URLSearchParams({ entityType: "contract", entityId: String(contractId), page: String(docPage), fileStatus: "available", ...(docSearch.trim() ? { q: docSearch.trim() } : {}) })}`) });
  const selectedDocument = documents.data?.items.find(item => String(item.id) === document);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error("Choose an obligation action.");
      const body = { action: editor.action, note: note.trim(), ...(editor.row ? { obligationId: editor.row.obligationId, revision: editor.row.revision } : {}),
        ...(terms ? { title: title.trim(), dueDate: due, ownerUserId: Number(owner) } : {}),
        ...(selectedDocument && editor.action === "complete" ? { documentId: selectedDocument.id, documentVersion: selectedDocument.version } : {}) };
      const signature = JSON.stringify([scope, body]);
      if (requestKey.current?.signature !== signature) requestKey.current = { signature, key: crypto.randomUUID() };
      return requestJson("POST", root, body, { headers: { "Idempotency-Key": requestKey.current.key } });
    },
    onSuccess: async () => {
      setEditor(null); requestKey.current = null;
      await Promise.all([cache.invalidateQueries({ queryKey: ["contract-obligation-list", root] }),
        cache.invalidateQueries({ queryKey: ["contract-obligation-history", root] }),
        cache.invalidateQueries({ queryKey: ["/api/v2/action-inbox"] })]);
    },
  });
  function begin(action: Editor["action"], row?: Row) {
    setEditor({ action, row }); setTitle(row?.title ?? ""); setDue(row?.dueDate ?? "");
    setNote(""); setOwner(String(row?.ownerUserId ?? user?.id ?? "")); setOwnerSearch(""); setOwnerPage(1);
    setDocument(""); setDocSearch(""); setDocPage(1); mutation.reset();
  }
  function evidence(row: Row) {
    if (row.documentId) return <Link className="underline" href={documentLibraryHref("contract", contractId, row.documentId)}>Source document v{row.documentVersion}</Link>;
    return row.state === "completed" ? <p>Source document not currently available to this view.</p> : null;
  }
  if (!read) return focusedId ? <p role="alert">Purchase read access is required to open this obligation.</p> : null;
  return <section aria-label="Contract obligations" className="min-w-0 space-y-3 rounded border p-3">
    <h3 className="font-semibold">Contract obligations</h3>
    <p className="text-sm text-muted-foreground">Track owners and due dates without changing agreement terms. Completion requires a verified contract document. Overdue uses your organization’s calendar date.</p>
    <Button type="button" variant="outline" onClick={() => setExpanded(value => !value)}>{expanded ? "Hide obligations" : "Review obligations"}</Button>
    {expanded && <>
      {rows.isFetching ? <p role="status">Loading obligations…</p> : rows.isError ? <>
        <p role="alert">{userFacingError(rows.error)}</p><Button type="button" variant="outline" onClick={() => void rows.refetch()}>Retry obligations</Button>
      </> : <>
        {rows.data && <p className="text-sm text-muted-foreground">Checked for {rows.data.today} ({rows.data.timezone}).</p>}
        {!rows.data?.items.length && <p>No obligations recorded on this contract.</p>}
        <ul className="space-y-2">{rows.data?.items.map(row => <li key={row.obligationId} className="space-y-2 break-words rounded border p-2 text-sm">
          {row.obligationId===focusedId ? <h4 className="font-semibold" ref={focusHeading} tabIndex={-1}>{row.title}</h4> : <strong>{row.title}</strong>}
          <p>{row.overdue ? "Overdue" : row.state} · Due {row.dueDate} · {row.ownerName ?? "Owner no longer available"} · v{row.revision}</p>
          <p>{row.note}</p>{evidence(row)}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => {setHistory(history === row.obligationId ? "" : row.obligationId);setHistoryPage(1);}}>Version history</Button>
            {row.state === "open" && manage && <>
              <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => begin("revise", row)}>Revise</Button>
              <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => begin("cancel", row)}>Cancel obligation</Button>
            </>}
            {row.state === "open" && row.ownerUserId === user?.id && docs &&
              <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => begin("complete", row)}>Record completion</Button>}
          </div>
          {history === row.obligationId && (versions.isFetching ? <p role="status">Loading history…</p> : versions.isError ?
            <><p role="alert">{userFacingError(versions.error)}</p><Button type="button" onClick={() => void versions.refetch()}>Retry history</Button></> : <>
              <ol className="space-y-1">{versions.data?.items.map(version => <li key={version.revision}>v{version.revision} · {version.state} · {version.title} · Due {version.dueDate} · {version.ownerName ?? "Owner unavailable"} · {new Date(version.recordedAt).toLocaleString()} · {version.note} {evidence(version)}</li>)}</ol>
              <Pager page={historyPage} next={versions.data?.hasNext} set={setHistoryPage} label="history" />
            </>)}
        </li>)}</ul>
        {!focusedId && <Pager page={page} next={rows.data?.hasNext} set={setPage} label="obligations" />}
        {manage && !focusedId && <Button type="button" disabled={mutation.isPending} onClick={() => begin("create")}>Add obligation</Button>}
      </>}
      {editor && !rows.isError && <form className="space-y-2 rounded border p-3" onSubmit={event => {event.preventDefault();mutation.mutate();}}>
        <h4 className="font-medium">{editor.action === "create" ? "New obligation" : `${editor.action} obligation: ${editor.row?.title}`}</h4>
        {terms && <>
          <label className="block">Obligation title<Input value={title} maxLength={160} required onChange={event => setTitle(event.target.value)} /></label>
          <label className="block">Due date<Input type="date" value={due} required onChange={event => setDue(event.target.value)} /></label>
          <label className="block">Find an owner<Input value={ownerSearch} maxLength={80} onChange={event => {setOwnerSearch(event.target.value);setOwnerPage(1);}} /></label>
          <label className="block">Owner<select className="block w-full rounded border bg-background p-2" value={owner} onChange={event => setOwner(event.target.value)}>
            <option value="">Choose owner</option>
            {owner && !owners.data?.items.some(item => String(item.id) === owner) && <option value={owner}>{owner === String(user?.id) ? "Me" : editor.row?.ownerName ?? "Previously selected owner"}</option>}
            {owners.data?.items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          {owners.isError && <><p role="alert">{userFacingError(owners.error)}</p><Button type="button" onClick={() => void owners.refetch()}>Retry owners</Button></>}
          <Pager page={ownerPage} next={owners.data?.hasNext} set={setOwnerPage} label="owners" />
        </>}
        {editor.action === "complete" && <>
          <label className="block">Find a verified contract document<Input value={docSearch} maxLength={120} onChange={event => {setDocSearch(event.target.value);setDocPage(1);setDocument("");}} /></label>
          <label className="block">Completion document<select className="block w-full rounded border bg-background p-2" value={document} onChange={event => setDocument(event.target.value)}>
            <option value="">Choose document</option>{documents.data?.items.map(item => <option value={item.id} key={item.id}>{item.fileName} (v{item.version})</option>)}
          </select></label>
          {!documents.isFetching && !documents.isError && !documents.data?.items.length &&
            <p>No verified files found. <Link className="underline" href={documentLibraryHref("contract", contractId)}>Open contract documents</Link>.</p>}
          {documents.isError && <><p role="alert">{userFacingError(documents.error)}</p><Button type="button" onClick={() => void documents.refetch()}>Retry documents</Button></>}
          <Pager page={docPage} next={documents.data?.hasNext} set={value => {setDocPage(value);setDocument("");}} label="documents" />
        </>}
        <label className="block">Reason or evidence note<Input value={note} maxLength={1000} required onChange={event => setNote(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={mutation.isPending || note.trim().length < 5 || (!!terms && (!owner || !due || !title.trim() || owners.isError)) ||
            (editor.action === "complete" && (!selectedDocument || documents.isFetching || documents.isError))}>Save obligation change</Button>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setEditor(null)}>Discard form</Button>
        </div>
        {mutation.isError && <p role="alert">{userFacingError(mutation.error)}</p>}
      </form>}
      {mutation.isSuccess && <p role="status">Obligation change saved.</p>}
    </>}
  </section>;
}

function Pager({ page, next, set, label }: { page: number; next?: boolean; set: (page: number) => void; label: string }) {
  if (page === 1 && !next) return null;
  return <div className="flex flex-wrap gap-2">
    <Button type="button" size="sm" variant="outline" disabled={page === 1} onClick={() => set(page - 1)}>Previous {label}</Button>
    <Button type="button" size="sm" variant="outline" disabled={!next || page === 400} onClick={() => set(page + 1)}>Next {label}</Button>
  </div>;
}
