import {useEffect,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {requestJson} from "@/lib/queryClient";
import {userFacingError} from "@/lib/user-facing-error";
import {usePermissions} from "@/hooks/use-permissions";
import {FinancialMeasuresPanel,type FinancialMeasureSummary} from "@/components/financial-measures-panel";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

const labels:Record<string,string>={not_due:"Not due",due_7:"Due in 7 days",due_30:"Due in 30 days",od_1_30:"Overdue 1–30",od_31_60:"Overdue 31–60",od_60p:"Overdue 60+",unknown_due_date:"Due date unavailable"};
type RunRefs={runId:string;disputedRunId?:string;unapprovedRunId?:string};
type Report=RunRefs&{generatedAt:string;asOf:string;timezone:string;currencyCode:string|null;measures:FinancialMeasureSummary[];notice:string;total:number;
  buckets:Array<{bucket:string;count:number;excludedCount:number;amount:string|null;state:string}>;
  items:Array<{invoiceId:string;invoiceNumber:string;href:string;amount:string|null;originalAmount:string|null;originalCurrencyCode:string|null;dueDate:string|null;bucket:string;exclusion:string|null}>};

export function ApAgingPanel({showDetails=true,initialSupplierId}:{showDetails?:boolean;initialSupplierId?:number}) {
  const permissions=usePermissions(),client=useQueryClient();
  const [initial]=useState(()=>typeof window!=="undefined"?new URLSearchParams(window.location.search):new URLSearchParams());
  const [asOf,setAsOf]=useState(initial.get("asOf")??""),[supplier,setSupplier]=useState(initialSupplierId?String(initialSupplierId):initial.get("supplierId")??"");
  const [draftAsOf,setDraftAsOf]=useState(asOf),[draftSupplier,setDraftSupplier]=useState(supplier);
  const [bucket,setBucket]=useState(initial.get("bucket")??""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25);
  const [runs,setRuns]=useState<RunRefs|null>(initial.get("runId")?{runId:initial.get("runId")!}:null);
  const allowed=permissions.hasPermission("finance","read")&&permissions.hasPermission("reports","read");
  const query=useQuery({queryKey:["/api/v2/ap/aging",asOf,supplier,bucket,page,pageSize,runs],enabled:allowed,retry:false,staleTime:30000,
    queryFn:()=>{const p=new URLSearchParams({page:String(page),pageSize:String(pageSize)});if(asOf)p.set("asOf",asOf);if(supplier)p.set("supplierId",supplier);if(bucket)p.set("bucket",bucket);if(runs)for(const [key,value] of Object.entries(runs))if(value)p.set(key,value);return requestJson<Report>("GET",`/api/v2/ap/aging?${p}`);}});
  useEffect(()=>client.getQueryCache().subscribe(event=>{
    if(event.type==="updated"&&event.action.type==="invalidate"&&["/api/v2/ap/aging","/api/v2/analytics/financial-measures"].includes(String(event.query.queryKey[0]))&&!initial.get("runId")) setRuns(null);
  }),[client,initial]);
  function changeScope(action:()=>void){action();setRuns(null);setPage(1);}
  function freezePage(){if(query.data)setRuns({runId:query.data.runId,disputedRunId:query.data.disputedRunId,unapprovedRunId:query.data.unapprovedRunId});}
  function refresh(){setRuns(null);void client.invalidateQueries({queryKey:["/api/v2/ap/aging"]});}
  if(permissions.isLoading)return <p role="status">Checking financial-report access…</p>;
  if(!allowed)return <p role="status">Finance and reporting read access are required for AP balances.</p>;
  const requestId=(query.error as {requestId?:unknown}|null)?.requestId;
  return <section aria-label="AP balance reporting" className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><label className="space-y-1">As-of date (blank means current)<Input type="date" value={draftAsOf} onChange={e=>setDraftAsOf(e.target.value)}/></label><label className="space-y-1">Supplier ID (optional)<Input type="number" min="1" value={draftSupplier} onChange={e=>setDraftSupplier(e.target.value)}/></label><Button variant="outline" disabled={query.isFetching} onClick={()=>changeScope(()=>{setAsOf(draftAsOf);setSupplier(draftSupplier);})}>Apply AP filters</Button><Button variant="outline" disabled={query.isFetching} onClick={refresh}>Refresh AP observation</Button></div>
    {(draftAsOf!==asOf||draftSupplier!==supplier)?<p role="status" className="text-sm">Filter changes are not applied yet. Select Apply AP filters to update the report. Displayed figures still use the previous scope.</p>:null}
    <p className="text-sm text-muted-foreground">These reporting filters are separate from invoice/payment table filters. Historical dates require verified coverage; earlier balances are not reconstructed.</p>
    {query.isPending?<p role="status">Preparing AP balance evidence…</p>:query.isError?<div role="alert" className="space-y-2"><p>AP reporting is unavailable. {userFacingError(query.error)}</p>{typeof requestId==="string"&&requestId&&<p className="break-all text-xs">Request ID: {requestId}</p>}<Button disabled={query.isFetching} onClick={()=>void query.refetch()}>Retry AP report</Button></div>:query.data?<>
      <FinancialMeasuresPanel snapshot={{generatedAt:query.data.generatedAt,measures:query.data.measures}} filters={{asOf:query.data.asOf,supplierId:supplier?Number(supplier):undefined}} measures={query.data.measures.map(m=>m.measure)} onRefresh={refresh}/>
      <p className="text-xs text-muted-foreground">{query.data.notice} {query.isFetching?"Refreshing this view…":""}</p>
      {showDetails?<>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{query.data.buckets.map(b=><Card key={b.bucket}><CardHeader><CardTitle className="text-sm">{labels[b.bucket]}</CardTitle></CardHeader><CardContent><p className="text-xl tabular-nums">{b.amount===null?"Unavailable":`${query.data!.currencyCode} ${b.amount}`}</p><p>{b.count} included; {b.excludedCount} excluded · {b.state.replaceAll("_"," ")}</p></CardContent></Card>)}</div>
        <label>Evidence bucket (cards remain all buckets) <select className="rounded border p-2" value={bucket} onChange={e=>{freezePage();setBucket(e.target.value);setPage(1);}}><option value="">All buckets</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <Card><CardHeader><CardTitle>Approved AP balance evidence</CardTitle></CardHeader><CardContent className="space-y-2">{query.data.items.length?query.data.items.map(row=><div key={row.invoiceId} className="flex flex-wrap justify-between gap-2 rounded border p-3"><a className="underline" href={row.href}>{row.invoiceNumber}</a><span>{row.dueDate??"Due date unavailable"} · {labels[row.bucket]}</span><span>{row.amount===null?row.exclusion?.replaceAll("_"," ")??"Unavailable":`${query.data!.currencyCode} ${row.amount}`}</span></div>):<p>No eligible evidence rows in this bucket.</p>}</CardContent></Card>
        <div className="flex flex-wrap items-center gap-2"><label>Rows <select value={pageSize} onChange={e=>{freezePage();setPageSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>{freezePage();setPage(page-1);}}>Previous AP evidence</Button><span>Page {page} · {query.data.total} evidence rows</span><Button variant="outline" disabled={page*pageSize>=query.data.total||query.isFetching} onClick={()=>{freezePage();setPage(page+1);}}>Next AP evidence</Button></div>
      </>:null}
    </>:null}
  </section>;
}
