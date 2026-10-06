import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requestJson } from "@/lib/queryClient";
import { notificationTarget } from "@/lib/notifications/notification-target";
import { userFacingError } from "@/lib/user-facing-error";

type Action = { id: string; title: string; body: string | null; type: string; entityType: string | null;
  entityId: number | null; targetPath: string | null; dueAt: string | null; priority: string; state: string;
  readAt: string | null; archivedAt: string | null; lastOccurredAt: string };
type ActionPage = { items: Action[]; total: number; page: number; pageSize: number; hasNext: boolean };
type Preferences = { dailyDigestEnabled?: boolean; reminderEnabled?: boolean };

export default function ActionInboxPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"active" | "history">("active");
  const query = useQuery({ queryKey: ["/api/v2/action-inbox", state, page],
    queryFn: () => requestJson<ActionPage>("GET", `/api/v2/action-inbox?state=${state}&page=${page}&pageSize=25`), refetchInterval: 30000 });
  const prefs = useQuery({ queryKey: ["/api/notification-preferences"],
    queryFn: () => requestJson<Preferences>("GET", "/api/notification-preferences") });
  const updatePrefs = useMutation({ mutationFn: (patch: Partial<Preferences>) => requestJson("PATCH", "/api/notification-preferences", patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["/api/notification-preferences"] }) });
  return <div className="mx-auto max-w-5xl space-y-5 p-4" data-testid="action-inbox-page">
    <PageHeader title="Action Inbox" subtitle="One place for assigned work and important updates. Reading an alert never completes its task." />
    <Card><CardHeader><CardTitle>Delivery preferences</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-5 text-sm">
      <label><input type="checkbox" checked={prefs.data?.reminderEnabled ?? true} disabled={prefs.isPending || updatePrefs.isPending} onChange={(event) => updatePrefs.mutate({ reminderEnabled: event.target.checked })} /> Due-date reminders</label>
      <label><input type="checkbox" checked={prefs.data?.dailyDigestEnabled ?? false} disabled={prefs.isPending || updatePrefs.isPending} onChange={(event) => updatePrefs.mutate({ dailyDigestEnabled: event.target.checked })} /> Optional daily email digest</label>
      {updatePrefs.isError && <p role="alert" className="text-destructive">{userFacingError(updatePrefs.error)}</p>}
    </CardContent></Card>
    <div className="flex gap-2"><Button variant={state === "active" ? "default" : "outline"} onClick={() => { setState("active"); setPage(1); }}>Needs attention</Button><Button variant={state === "history" ? "default" : "outline"} onClick={() => { setState("history"); setPage(1); }}>History</Button></div>
    {query.isPending ? <p role="status">Loading your actions…</p> : query.isError ? <div role="alert">Could not load your action inbox. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div> : <>
      <p className="text-sm text-muted-foreground">{query.data.total} {state === "active" ? "active" : "historical"} item(s)</p>
      {query.data.items.length === 0 ? <Card><CardContent className="p-5">Nothing here right now.</CardContent></Card> : <ul className="space-y-2">{query.data.items.map((item) => {
        const target = notificationTarget(item);
        return <li key={item.id} className="rounded-lg border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{item.body}</p></div><span className="rounded border px-2 py-1 text-xs">{item.priority} · {item.state}</span></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span>Updated {new Date(item.lastOccurredAt).toLocaleString()}</span>{item.dueAt && <span>Due {new Date(item.dueAt).toLocaleString()}</span>}</div>{target && <Link className="mt-3 inline-block text-sm underline" href={target}>Open work item</Link>}</li>;
      })}</ul>}
      <div className="flex items-center gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!query.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button></div>
    </>}
  </div>;
}
