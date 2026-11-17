import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { DiagnosticFinding } from "@shared/diagnostics/findings";

type History = { total:number; schedules?:Array<{tier:string;nextRunAt:string;lastCompletedAt:string|null;lastOutcome:string|null;stale:boolean}>; items:Array<DiagnosticFinding & {lifecycle:string;lastPassedAt:string|null}> };
type DailySummaries={items:Array<{localDate:string;timezone:string;generatedAt:string;newCount:number;worsenedCount:number;recoveredCount:number;outstandingCount:number;monitoringFresh:boolean}>};
export function PersistentDiagnosticHistory() {
  const [page,setPage]=useState(1);
  const [actionError,setActionError]=useState<string|null>(null);
  const query=useQuery({queryKey:["/api/diagnostics/history",page],
    queryFn:()=>requestJson<History>("GET",`/api/diagnostics/history?page=${page}&pageSize=25`),retry:false});
  const summaries=useQuery({queryKey:["/api/diagnostics/daily-summaries"],queryFn:()=>requestJson<DailySummaries>("GET","/api/diagnostics/daily-summaries?page=1&pageSize=25"),retry:false});
  async function acknowledge(findingKey:string){
    setActionError(null);
    try{await requestJson("POST","/api/diagnostics/findings/acknowledge",{findingKey});await query.refetch();}
    catch{setActionError("The finding could not be acknowledged. Refresh it and try again.");}
  }
  return <section aria-label="Persistent diagnostic history" className="space-y-3 rounded-lg border p-4">
    <h2 className="text-lg font-semibold">Persistent diagnostic history</h2>
    <p className="text-sm text-muted-foreground">Saved safe-check results survive restarts. Acknowledgment does not mean recovery. Scheduled monitoring runs only while the server is online.</p>
    {actionError?<p role="alert" className="text-destructive">{actionError}</p>:null}
    {summaries.data?.items[0]?<div className="rounded border bg-muted/30 p-3" aria-label="Latest reliability summary">
      <h3 className="font-medium">Latest daily summary · {summaries.data.items[0].localDate}</h3>
      <p className="text-xs">Snapshot generated {new Date(summaries.data.items[0].generatedAt).toLocaleString(undefined,{timeZone:summaries.data.items[0].timezone})} ({summaries.data.items[0].timezone}). Counts reflect that cutoff, not later findings below.</p>
      <p className="text-sm">{summaries.data.items[0].newCount} new · {summaries.data.items[0].worsenedCount} worsened · {summaries.data.items[0].recoveredCount} recovered · {summaries.data.items[0].outstandingCount} outstanding at cutoff · monitoring {summaries.data.items[0].monitoringFresh?"current":"needs attention"}</p>
    </div>:null}
    {query.isPending?<p role="status">Loading saved checks…</p>:query.isError?<div role="alert">
      <p>Saved history is unavailable. Ask your administrator to check the diagnostic storage migration, then retry.</p>
      <Button variant="outline" onClick={()=>void query.refetch()}>Retry history</Button>
    </div>:<>
      {!query.data?.schedules?.length?<p>Automatic monitoring has not registered a schedule. Check migrations and worker configuration.</p>:query.data.schedules.map(schedule=><p key={schedule.tier} role="status" className="text-sm">
        {schedule.tier}: {schedule.stale?"Overdue — monitoring evidence is stale":schedule.lastOutcome==="failed"?"Last check could not complete — retry scheduled":schedule.lastOutcome??"Not yet checked"}
        {" · "}Last completed {schedule.lastCompletedAt?new Date(schedule.lastCompletedAt).toLocaleString():"not yet verified"}
        {" · "}Next due {new Date(schedule.nextRunAt).toLocaleString()}
      </p>)}
      {query.data?.items.length===0?<p>No saved checks. Run safe probes to record evidence.</p>:null}
      <ul className="space-y-3">{query.data?.items.map(item=><li key={item.id} className="rounded border p-3">
        <h3 className="font-medium">{item.title}</h3><p>{item.message}</p>
        <p className="text-sm">{item.lifecycle} · {item.status} · {item.occurrences} failed observations</p>
        <p className="text-xs">Last checked: {new Date(item.lastSeen).toLocaleString()} · Last passed: {item.lastPassedAt?new Date(item.lastPassedAt).toLocaleString():"Not verified"}</p>
        {item.remediation?<p className="text-sm">Next action: {item.remediation}</p>:null}
        <a className="block text-sm underline" href={`/admin/audit-logs?view=governed&findingKey=${encodeURIComponent(item.id)}`}>View governed audit evidence</a>
        {item.lifecycle==="open"?<Button className="mt-2" size="sm" variant="outline" onClick={()=>void acknowledge(item.id)}>Acknowledge</Button>:null}
      </li>)}</ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous checks</Button>
        <span>Page {page} · {query.data?.total??0} findings</span>
        <Button variant="outline" disabled={page*25>=(query.data?.total??0)} onClick={()=>setPage(page+1)}>Next checks</Button>
        <Button variant="outline" onClick={()=>{void query.refetch();void summaries.refetch();}}>Refresh history</Button>
      </div>
    </>}
  </section>;
}
