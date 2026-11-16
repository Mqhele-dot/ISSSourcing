import { useEffect,useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { userFacingError } from "@/lib/user-facing-error";
import {useAuth} from "@/hooks/use-auth";
import {usePermissions} from "@/hooks/use-permissions";
import {Input} from "@/components/ui/input";
import {documentLibraryHref} from "@shared/document-query";

type Communication = { key: string; kind: string; occurredAt: string; summary: string; entityType: string; entityId: number; actorUserId: number | null; documentId: number | null };
type Page = { items: Communication[]; total: number; page: number; pageSize: number; hasNext: boolean; scopeNotice?:string };
type SupplierDocument = {id:number;fileName:string;version:number;fileStatus:string};
type SupplierDocumentPage = { items: SupplierDocument[];total:number;hasNext:boolean };

function destination(row: Communication,supplierId:number) {
  if (row.entityType === "purchase_order") return APP_ROUTES.procurement.order(row.entityId);
  if (row.entityType === "sourcing_event") return APP_ROUTES.procurement.sourcingEvent(row.entityId);
  if (row.entityType === "document") return documentLibraryHref("supplier",supplierId,row.entityId);
  return null;
}

export function SupplierCommunications({ supplierId }: { supplierId: number }) {
  const {user}=useAuth(),{hasPermission}=usePermissions();
  const canRead=hasPermission("suppliers","read"),canEdit=hasPermission("suppliers","update"),canDocs=hasPermission("documents","read"),canPurchases=hasPermission("purchases","read");
  const org=(user as typeof user&{activeOrganizationId?:number})?.activeOrganizationId;
  const scope=[user?.id,org,user?.warehouseId,canRead,canEdit,canDocs,canPurchases];
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState("phone");
  const [summary, setSummary] = useState("");
  const identity=JSON.stringify([user?.id,org,user?.warehouseId,supplierId]);
  const [selected,setSelected]=useState<(SupplierDocument&{scope:string})|null>(null);
  const selection=selected?.scope===identity?selected:null;
  const [documentSearch,setDocumentSearch]=useState(""),[documentPage,setDocumentPage]=useState(1);
  useEffect(()=>{setSummary("");setSelected(null);setDocumentSearch("");setDocumentPage(1);setPage(1);},[identity]);
  const key = ["/api/v2/suppliers", supplierId, "communications",...scope,page];
  const query = useQuery({ queryKey: key, enabled:Boolean(user&&org&&canRead),retry:false,queryFn: () => requestJson<Page>("GET", `/api/v2/suppliers/${supplierId}/communications?page=${page}&pageSize=25`) });
  const documents = useQuery({ queryKey: ["/api/v2/documents", "supplier",supplierId,...scope,documentSearch.trim(),documentPage],enabled:Boolean(user&&org&&canRead&&canEdit&&canDocs),retry:false,queryFn: () => {
    const params=new URLSearchParams({entityType:"supplier",entityId:String(supplierId),archived:"exclude",fileStatus:"available",pageSize:"25",page:String(documentPage)});
    if(documentSearch.trim())params.set("q",documentSearch.trim());
    return requestJson<SupplierDocumentPage>("GET",`/api/v2/documents?${params}`);
  } });
  const choices=canDocs&&!documents.isError?documents.data?.items??[]:[];
  const selectionBlocked=Boolean(selection&&(!canDocs||documents.isError));
  const add = useMutation({
    mutationFn: () => {
      if(selectionBlocked)throw new Error("Retry document access or explicitly clear the selected attachment before saving.");
      return requestJson("POST", `/api/v2/suppliers/${supplierId}/communications/notes`, { channel, summary, documentId: selection?.id??null });
    },
    onSuccess: () => { setSummary(""); setSelected(null); setPage(1); void client.invalidateQueries({ queryKey: ["/api/v2/suppliers", supplierId, "communications"] }); },
  });
  return <Card><CardHeader><CardTitle>Communication history</CardTitle><CardDescription>RFQs, orders, confirmations, documents, and manually logged contact. A note is not proof that a message was sent.</CardDescription></CardHeader><CardContent className="space-y-5">
    {canRead&&canEdit&&<form className="space-y-2 rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); add.mutate(); }}>
      <label className="block text-sm font-medium">Log a contact</label>
      <select className="rounded border p-2 text-sm" aria-label="Contact channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="phone">Phone</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="other">Other</option></select>
      <Textarea aria-label="Contact summary" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={2000} placeholder="Who was contacted and what was discussed?" />
      <label className="block text-sm" htmlFor="supplier-contact-document">Related document (optional)</label>
      {canDocs&&<><label className="block text-sm" htmlFor="supplier-document-search">Find supplier documents</label><Input id="supplier-document-search" value={documentSearch} maxLength={120} placeholder="Search available file names" onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}} onChange={event=>{setDocumentSearch(event.target.value);setDocumentPage(1);}} /></>}
      <select id="supplier-contact-document" className="w-full min-w-0 rounded border p-2 text-sm" value={canDocs&&!documents.isError?String(selection?.id??""):""} onChange={(event) => {
        if(!event.target.value){setSelected(null);return;}
        const chosen=choices.find(row=>String(row.id)===event.target.value);
        if(chosen)setSelected({...chosen,scope:identity});
      }} disabled={!canDocs || documents.isPending || documents.isError}>
        <option value="">No document</option>
        {selection&&!choices.some(row=>row.id===selection.id)&&canDocs&&!documents.isError&&<option value={selection.id}>{selection.fileName} — v{selection.version} (selected)</option>}
        {choices.map(document=><option key={document.id} value={document.id}>{document.fileName} — v{document.version} (#{document.id})</option>)}
      </select>
      {canDocs&&!documents.isError&&<div className="flex flex-wrap items-center gap-2 text-sm"><Button type="button" variant="outline" aria-label="Previous document choices" disabled={documents.isPending||documentPage===1} onClick={()=>setDocumentPage(value=>value-1)}>Previous files</Button><span role="status">{documents.isPending?"Loading available files…":`${documents.data?.total??0} available files · Page ${documentPage}`}</span><Button type="button" variant="outline" aria-label="Next document choices" disabled={documents.isPending||!documents.data?.hasNext} onClick={()=>setDocumentPage(value=>value+1)}>Next files</Button></div>}
      {canDocs&&!documents.isError&&!documents.isPending&&choices.length===0&&<p role="status">No available files match. Unverified, missing and archived files are not attachment choices.</p>}
      {documents.isError&&canDocs&&<div role="alert" className="text-sm text-muted-foreground">{selection?"The selected attachment cannot be rechecked. Retry or explicitly clear it; your note is preserved.":"Documents are unavailable; you can still log the contact without one."} <Button type="button" variant="outline" onClick={()=>void documents.refetch()}>Retry documents</Button></div>}
      {!canDocs&&<p role="status" className="text-sm text-muted-foreground">Document access is restricted. You can log a contact without an attachment.</p>}
      {selection&&<div className="flex flex-wrap items-center gap-2 text-sm"><span data-testid="supplier-selected-document" className="min-w-0 break-all">{selectionBlocked?"Selected attachment unavailable — retry or clear it.":`Selected document: ${selection.fileName} — v${selection.version}`}</span><Button type="button" variant="outline" onClick={()=>setSelected(null)}>Clear selected document</Button>{!selectionBlocked&&<Link className="underline" href={documentLibraryHref("supplier",supplierId,selection.id)}>Open selected document</Link>}</div>}
      <Button type="submit" disabled={summary.trim().length < 3 || add.isPending || selectionBlocked}>Save contact note</Button>
      {add.isError && <p role="alert" className="text-sm text-destructive">{userFacingError(add.error)}</p>}
    </form>}
    {!canRead?<p role="status">Supplier history requires supplier read access.</p>:query.isPending ? <p role="status">Loading supplier history…</p> : query.isError ? <div role="alert">{userFacingError(query.error)} <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div> : <>
      <p role="status" data-testid="supplier-history-scope" className="text-sm text-muted-foreground">{query.data.scopeNotice}</p>
      {query.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No supplier communications recorded yet.</p> : <ol className="space-y-2">{query.data.items.map((row) => <li key={row.key} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{row.summary}</span><time className="text-muted-foreground" dateTime={row.occurredAt}>{new Date(row.occurredAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-muted-foreground">{row.kind.replaceAll("_", " ")} · Actor {row.actorUserId ?? "system"}</p>{destination(row,supplierId) && <Link className="mt-2 inline-block underline" href={destination(row,supplierId)!}>Open source record</Link>}{row.kind === "contact_note" && row.documentId && <Link className="ml-3 inline-block underline" href={documentLibraryHref("supplier",supplierId,row.documentId)}>View related document</Link>}</li>)}</ol>}
      <div className="flex items-center gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">{query.data.total} events · Page {page}</span><Button variant="outline" disabled={!query.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button></div>
    </>}
  </CardContent></Card>;
}
