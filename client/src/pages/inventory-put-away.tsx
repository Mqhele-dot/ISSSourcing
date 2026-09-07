import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, PackageCheck, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageDataState } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { queryClient, requestJson } from "@/lib/queryClient";

type PutAwayTask = {
  id: number; taskNumber: string; receiptId: number; receiptNumber: string; warehouseId: number; warehouseName: string;
  itemId: number; sku: string; itemName: string; quantity: string; fromLocation: string; toBin?: string | null;
  assignedUserName?: string | null; priority: string; status: string; dueAt?: string | null; exceptionReason?: string | null;
};
type PutAwayPage = { items: PutAwayTask[]; total: number; page: number; pageSize: number; hasNext: boolean; summary: { pending: number; assigned: number; inProgress: number; exception: number; overdue: number; completedToday: number } };

const statuses = ["ALL", "PENDING", "ASSIGNED", "IN_PROGRESS", "EXCEPTION", "COMPLETED", "CANCELLED"];

function SummaryCard({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <Card><CardContent className="flex min-h-24 items-center justify-between p-4"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>{warning ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <PackageCheck className="h-5 w-5 text-primary" />}</CardContent></Card>;
}

export default function InventoryPutAwayPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PutAwayTask | null>(null);
  const [toBin, setToBin] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status !== "ALL") params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    return params.toString();
  }, [page, search, status]);
  const tasks = useQuery({ queryKey: ["/api/v2/inventory/put-away", query], queryFn: () => requestJson<PutAwayPage>("GET", `/api/v2/inventory/put-away?${query}`), placeholderData: (previous) => previous });
  const refresh = useMutation({ mutationFn: () => requestJson<{ created: number; blocked: number; scanned: number }>("POST", "/api/v2/inventory/put-away/reconcile"), onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["/api/v2/inventory/put-away"] }); toast({ title: "Receipt tasks synchronized", description: `${result.created} task(s) created. ${result.blocked} receipt line(s) need warehouse evidence.` }); }, onError: (error: Error) => toast({ title: "Synchronization failed", description: error.message, variant: "destructive" }) });
  const start = useMutation({ mutationFn: (id: number) => requestJson("POST", `/api/v2/inventory/put-away/${id}/start`), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["/api/v2/inventory/put-away"] }) });
  const complete = useMutation({ mutationFn: () => requestJson("POST", `/api/v2/inventory/put-away/${selected?.id}/complete`, { toBin: toBin.trim() || undefined }), onSuccess: async () => { setSelected(null); setToBin(""); await Promise.all([queryClient.invalidateQueries({ queryKey: ["/api/v2/inventory/put-away"] }), queryClient.invalidateQueries({ queryKey: ["/api/v2/inventory"] }), queryClient.invalidateQueries({ queryKey: ["/api/warehouses"] })]); toast({ title: "Put-away completed", description: "The warehouse location and auditable movement evidence were updated." }); }, onError: (error: Error) => toast({ title: "Could not complete put-away", description: error.message, variant: "destructive" }) });
  const summary = tasks.data?.summary ?? { pending: 0, assigned: 0, inProgress: 0, exception: 0, overdue: 0, completedToday: 0 };
  const first = tasks.data?.total ? (tasks.data.page - 1) * tasks.data.pageSize + 1 : 0;
  const last = tasks.data ? Math.min(tasks.data.page * tasks.data.pageSize, tasks.data.total) : 0;

  return <div className="space-y-6" data-testid="inventory-put-away-page">
    <PageHeader title="Put-away" subtitle="Move accepted goods from the receiving bay to verified warehouse bins without changing received stock twice." actions={<div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href={APP_ROUTES.procurement.receiving}>Goods receipts</Link></Button><Button onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />Synchronize posted receipts</Button></div>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><SummaryCard label="Pending" value={summary.pending} /><SummaryCard label="Assigned" value={summary.assigned} /><SummaryCard label="In progress" value={summary.inProgress} /><SummaryCard label="Exceptions" value={summary.exception} warning /><SummaryCard label="Overdue" value={summary.overdue} warning /><SummaryCard label="Completed today" value={summary.completedToday} /></div>
    <Card><CardHeader className="pb-3"><CardTitle>Warehouse work queue</CardTitle><div className="grid gap-3 pt-3 sm:grid-cols-[minmax(220px,1fr)_220px]"><div><Label htmlFor="putaway-search" className="sr-only">Search put-away tasks</Label><Input id="putaway-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search task, GRN, SKU, or item" /></div><Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger aria-label="Filter by put-away status"><SelectValue /></SelectTrigger><SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{value === "ALL" ? "All statuses" : value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div></CardHeader>
      <CardContent className="p-0"><PageDataState isLoading={tasks.isLoading} error={tasks.error} isEmpty={!tasks.data} onRetry={() => void tasks.refetch()} emptyView={<div className="px-6 py-12 text-center"><PackageCheck className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 font-medium">No put-away tasks</p><p className="mt-1 text-sm text-muted-foreground">Synchronize posted receipts to create missing warehouse work.</p></div>}>{tasks.data ? <><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Task / GRN</TableHead><TableHead>Item</TableHead><TableHead>Warehouse</TableHead><TableHead>Quantity</TableHead><TableHead>Priority</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{tasks.data.items.map((task) => <TableRow key={task.id}><TableCell><span className="font-medium">{task.taskNumber}</span><div className="text-xs text-muted-foreground">{task.receiptNumber}</div></TableCell><TableCell>{task.sku}<div className="max-w-56 truncate text-xs text-muted-foreground" title={task.itemName}>{task.itemName}</div></TableCell><TableCell>{task.warehouseName}<div className="text-xs text-muted-foreground">{task.fromLocation}{task.toBin ? ` → ${task.toBin}` : ""}</div></TableCell><TableCell>{task.quantity}</TableCell><TableCell><Badge variant="outline">{task.priority}</Badge></TableCell><TableCell>{task.dueAt ? new Date(task.dueAt).toLocaleString() : "Not set"}</TableCell><TableCell><Badge variant={task.status === "EXCEPTION" ? "destructive" : task.status === "COMPLETED" ? "secondary" : "outline"}>{task.status.replaceAll("_", " ")}</Badge>{task.exceptionReason ? <div className="mt-1 max-w-48 truncate text-xs text-destructive" title={task.exceptionReason}>{task.exceptionReason}</div> : null}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2">{["PENDING", "ASSIGNED", "EXCEPTION"].includes(task.status) ? <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate(task.id)}>Start</Button> : null}{!["COMPLETED", "CANCELLED"].includes(task.status) ? <Button size="sm" onClick={() => { setSelected(task); setToBin(task.toBin ?? ""); }}>Complete</Button> : <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-600" aria-label="Completed" />}</div></TableCell></TableRow>)}{tasks.data.items.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No tasks match these filters.</TableCell></TableRow> : null}</TableBody></Table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm"><span className="text-muted-foreground">{first}–{last} of {tasks.data.total}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={!tasks.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button></div></div></> : null}</PageDataState></CardContent>
    </Card>
    <Dialog open={selected != null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Complete {selected?.taskNumber}</DialogTitle><DialogDescription>Confirm the destination bin. Configured warehouses only accept a bin from their Master Data setup.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="destination-bin">Destination bin</Label><Input id="destination-bin" value={toBin} onChange={(event) => setToBin(event.target.value)} placeholder="For example A-01-03" /><p className="text-xs text-muted-foreground">This records an internal location movement; it does not increase on-hand quantity.</p></div><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button disabled={complete.isPending} onClick={() => complete.mutate()}>{complete.isPending ? "Completing…" : "Complete put-away"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
