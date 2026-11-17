import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { SupplierDeliveryScorecard as Scorecard } from "@shared/supplier-delivery-scorecard";
import { supplierDeliveryQueryKey } from "@shared/supplier-delivery-scorecard";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { requestJson } from "@/lib/queryClient";
import { userFacingError } from "@/lib/user-facing-error";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const outcomes = { on_time: "On time", late: "Late", missing_promise: "Promised date missing", missing_accepted_receipt: "No accepted receipt evidence" };
export function SupplierDeliveryScorecard({ supplierId }: { supplierId: number }) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  // /api/user supplies the active session organization; defaultOrganizationId is not session ownership.
  const organizationId = (user as (typeof user & { activeOrganizationId?: number | null }))?.activeOrganizationId;
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [filters, setFilters] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState<string | null>(null), [showHistory, setShowHistory] = useState(false), [historyPage, setHistoryPage] = useState(1);
  const captureKey = useRef<{ scope: string; id: string } | null>(null);
  const historyRoot = `/api/v2/suppliers/${supplierId}/delivery-observations`;
  const scope = [organizationId, user?.id, user?.warehouseId, supplierId] as const;
  const history = useQuery({ queryKey: [historyRoot, ...scope, historyPage], queryFn: () => requestJson<{ items: Array<{ id: string; observedAt: string }>; hasNext: boolean }>("GET", `${historyRoot}?page=${historyPage}`), enabled: Boolean(user && organizationId && showHistory), retry: false });
  const capture = useMutation({ mutationFn: () => {
    const payload = { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) };
    const keyScope = JSON.stringify([scope, payload]);
    if (captureKey.current?.scope !== keyScope) captureKey.current = { scope: keyScope, id: crypto.randomUUID() };
    return requestJson<{ id: string }>("POST", historyRoot, payload, { headers: { "Idempotency-Key": captureKey.current.id } });
  }, onSuccess: result => { captureKey.current = null; setSaved(result.id); setPage(1); setExpanded(true); setHistoryPage(1); setShowHistory(true); void history.refetch(); } });
  const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  const query = useQuery({ queryKey: saved ? [historyRoot, ...scope, saved, page, pageSize] : supplierDeliveryQueryKey({ userId: user?.id ?? 0,
    organizationId: organizationId ?? 0, warehouseId: user?.warehouseId ?? null }, supplierId, filters, page, pageSize),
    queryFn: () => requestJson<Scorecard>("GET", saved ? `${historyRoot}/${saved}?page=${page}&pageSize=${pageSize}` : `/api/v2/suppliers/${supplierId}/delivery-scorecard?${search}`),
    enabled: Boolean(user && organizationId), retry: false, gcTime: saved ? 0 : undefined });
  return <Card data-testid="supplier-delivery-scorecard"><CardHeader><CardTitle>Delivery evidence</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{saved ? "Saved observation — frozen at capture time." : "A live observation of first accepted receipts, not a historical supplier rating or complete-delivery score."}</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setSaved(null); setPage(1); setFilters({ from, to }); }}>
        <label className="text-sm">PO order date from<input className="block rounded border p-2" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label className="text-sm">PO order date to<input className="block rounded border p-2" type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
        <Button type="submit" variant="outline">Apply delivery dates</Button>
        <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh delivery evidence</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {saved && <Button variant="outline" onClick={() => {setSaved(null);setPage(1);}}>Return to live evidence</Button>}
        <Button variant="outline" onClick={() => setShowHistory(value => !value)}>{showHistory ? "Hide saved observations" : "Show saved observations"}</Button>
        {!saved && hasPermission("suppliers", "update") && <Button variant="outline" disabled={capture.isPending || query.isPending || query.isError} onClick={() => capture.mutate()}>Save current observation</Button>}
      </div>
      {capture.isError && <p role="alert">{userFacingError(capture.error)}</p>}
      {showHistory && <div className="space-y-2 rounded border p-3">
        {history.isPending ? <p role="status">Loading saved observations…</p> : history.isError ? <><p role="alert">{userFacingError(history.error)}</p><Button variant="outline" onClick={() => void history.refetch()}>Retry saved observations</Button></> : <>
          {!history.data.items.length && <p>No saved observations on this page.</p>}
          {history.data.items.map(item => <Button key={item.id} variant={item.id === saved ? "secondary" : "outline"} className="mr-2 mb-2" onClick={() => {if (item.id === saved && page === 1) void query.refetch();setSaved(item.id);setPage(1);setExpanded(true);}}>Open {new Date(item.observedAt).toLocaleString()}</Button>)}
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={historyPage === 1} onClick={() => setHistoryPage(value => value - 1)}>Previous observations</Button><Button variant="outline" disabled={!history.data.hasNext} onClick={() => setHistoryPage(value => value + 1)}>Next observations</Button></div>
        </>}
      </div>}
      {query.isPending || (saved && query.isFetching) ? <p role="status">Loading delivery evidence…</p> : query.isError ? <div role="alert"><p>{userFacingError(query.error)}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>Retry delivery evidence</Button></div> : <>
        <p role="status">{query.data.state === "empty" ? "No eligible orders in this period." : query.data.state === "insufficient_evidence" ? "Insufficient evidence — no delivery rate is available." : query.data.state === "partial" ? "Partial evidence — the rate excludes orders without sufficient evidence." : "Observed delivery evidence."}</p>
        <p className="text-lg font-semibold">First accepted receipt on time: {query.data.onTimePercent === null ? "Unavailable" : `${query.data.onTimePercent}%`}</p>
        <p className="text-sm">{query.data.measured} measured of {query.data.total} eligible orders · {query.data.onTime} on time · {query.data.late} late · {query.data.missingPromise} missing promised date · {query.data.missingReceipt} missing accepted receipt</p>
        <p className="text-xs text-muted-foreground">Observed {new Date(query.data.observedAt).toLocaleString()}</p>
        <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer font-medium">Why this delivery number?</summary>
          <p className="mt-2 text-sm">{query.data.basis}</p><p className="mt-2 text-sm">{query.data.limitation}</p>
          <p className="mt-2 text-sm">Formula: on-time first accepted receipts ÷ measured orders × 100. Each PO counts once.</p>
          <ol className="my-3 space-y-2">{query.data.items.map(row => <li key={row.purchaseOrderId} className="rounded border p-3 text-sm">
            <Link className="break-all underline" href={APP_ROUTES.procurement.order(row.purchaseOrderId)}>{row.orderNumber}</Link>
            <p>{outcomes[row.outcome]}</p><p>Promised: {row.promisedAt ? new Date(row.promisedAt).toLocaleString() : "Unknown"}</p>
            <p>First accepted receipt: {row.firstAcceptedReceiptAt ? new Date(row.firstAcceptedReceiptAt).toLocaleString() : "Unknown"}</p>
            <p className="break-all text-xs text-muted-foreground">{saved ? "Captured" : "Current"} source revision: {row.sourceRevision}</p>
          </li>)}</ol>
          <div className="flex flex-wrap items-center gap-2"><label>Delivery rows <select className="rounded border p-2" value={pageSize} onChange={event => { setPage(1); setPageSize(Number(event.target.value)); }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label>
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous delivery page</Button>
            <span>Page {page} of {Math.max(1, Math.ceil(query.data.total / pageSize))}</span>
            <Button variant="outline" disabled={page * pageSize >= query.data.total} onClick={() => setPage(page + 1)}>Next delivery page</Button>
          </div>
        </details>
      </>}
    </CardContent></Card>;
}
