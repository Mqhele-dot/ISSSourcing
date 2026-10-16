import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { userFacingError } from "@/lib/user-facing-error";

type Communication = { key: string; kind: string; occurredAt: string; summary: string; entityType: string; entityId: number; actorUserId: number | null; documentId: number | null };
type Page = { items: Communication[]; total: number; page: number; pageSize: number; hasNext: boolean };
type SupplierDocumentPage = { items: { id: number; fileName: string; fileStatus: string }[] };

function destination(row: Communication) {
  if (row.entityType === "purchase_order") return APP_ROUTES.procurement.order(row.entityId);
  if (row.entityType === "sourcing_event") return APP_ROUTES.procurement.sourcingEvent(row.entityId);
  if (row.entityType === "document") return APP_ROUTES.admin.documents;
  return null;
}

export function SupplierCommunications({ supplierId }: { supplierId: number }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState("phone");
  const [summary, setSummary] = useState("");
  const [documentId, setDocumentId] = useState("");
  const key = ["/api/v2/suppliers", supplierId, "communications", page];
  const query = useQuery({ queryKey: key, queryFn: () => requestJson<Page>("GET", `/api/v2/suppliers/${supplierId}/communications?page=${page}&pageSize=25`) });
  const documents = useQuery({ queryKey: ["/api/v2/documents", "supplier", supplierId], queryFn: () => requestJson<SupplierDocumentPage>("GET", `/api/v2/documents?entityType=supplier&entityId=${supplierId}&archived=exclude&pageSize=100`) });
  const add = useMutation({
    mutationFn: () => requestJson("POST", `/api/v2/suppliers/${supplierId}/communications/notes`, { channel, summary, documentId: documentId ? Number(documentId) : null }),
    onSuccess: () => { setSummary(""); setDocumentId(""); setPage(1); void client.invalidateQueries({ queryKey: ["/api/v2/suppliers", supplierId, "communications"] }); },
  });
  return <Card><CardHeader><CardTitle>Communication history</CardTitle><CardDescription>RFQs, orders, confirmations, documents, and manually logged contact. A note is not proof that a message was sent.</CardDescription></CardHeader><CardContent className="space-y-5">
    <form className="space-y-2 rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); add.mutate(); }}>
      <label className="block text-sm font-medium">Log a contact</label>
      <select className="rounded border p-2 text-sm" aria-label="Contact channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="phone">Phone</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="other">Other</option></select>
      <Textarea aria-label="Contact summary" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={2000} placeholder="Who was contacted and what was discussed?" />
      <label className="block text-sm" htmlFor="supplier-contact-document">Related document (optional)</label>
      <select id="supplier-contact-document" className="w-full rounded border p-2 text-sm" value={documentId} onChange={(event) => setDocumentId(event.target.value)} disabled={documents.isPending || documents.isError}>
        <option value="">No document</option>{documents.data?.items.filter((document) => document.fileStatus === "available").map((document) => <option key={document.id} value={document.id}>{document.fileName}</option>)}
      </select>
      {documents.isError && <p role="status" className="text-sm text-muted-foreground">Documents are unavailable; you can still log the contact without one.</p>}
      <Button type="submit" disabled={summary.trim().length < 3 || add.isPending}>Save contact note</Button>
      {add.isError && <p role="alert" className="text-sm text-destructive">{userFacingError(add.error)}</p>}
    </form>
    {query.isPending ? <p role="status">Loading supplier history…</p> : query.isError ? <div role="alert">Could not load supplier history. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div> : <>
      {query.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No supplier communications recorded yet.</p> : <ol className="space-y-2">{query.data.items.map((row) => <li key={row.key} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{row.summary}</span><time className="text-muted-foreground" dateTime={row.occurredAt}>{new Date(row.occurredAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-muted-foreground">{row.kind.replaceAll("_", " ")} · Actor {row.actorUserId ?? "system"}</p>{destination(row) && <Link className="mt-2 inline-block underline" href={destination(row)!}>Open source record</Link>}{row.kind === "contact_note" && row.documentId && <Link className="ml-3 inline-block underline" href={APP_ROUTES.admin.documents}>View related document</Link>}</li>)}</ol>}
      <div className="flex items-center gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">{query.data.total} events · Page {page}</span><Button variant="outline" disabled={!query.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button></div>
    </>}
  </CardContent></Card>;
}
