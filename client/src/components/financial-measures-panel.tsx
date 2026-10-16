import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { financialMeasureDefinitions, type FinancialMeasure, type FinancialEvidenceState } from "@shared/financial-measures";
import { requestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Filters = { from?: string; to?: string; supplierId?: number };
type Summary = { id:string; amount:string|null; currencyCode:string|null; state:FinancialEvidenceState;
  includedCount:number; excludedCount:number; generatedAt:string; calculationVersion:string; precisionNotice:string };
type Evidence = { total:number; items:Array<{sourceType:string;sourceId:string;amount:string|null;currencyCode:string|null;
  reportingAmount:string|null;exclusion:string|null;rate:string|null;rateVersion:number|null;rateEffectiveAt:string|null}> };
const states:Record<FinancialEvidenceState,string>={complete:"Complete",partial:"Partial total",unavailable:"Unavailable",
  empty:"No eligible transactions",setup_required:"Reporting currency setup required"};

function EvidenceRows({runId,measure}:{runId:string;measure:FinancialMeasure}) {
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(25);
  const query=useQuery({queryKey:["financial-evidence",runId,page,pageSize],queryFn:()=>requestJson<Evidence>("GET",
    `/api/v2/analytics/financial-measures/${measure}/evidence?runId=${runId}&page=${page}&pageSize=${pageSize}`),retry:false});
  if(query.isPending) return <p role="status">Loading evidence…</p>;
  if(query.isError) return <div role="alert"><p>Evidence could not be loaded. Your access may have changed.</p><Button variant="outline" onClick={()=>void query.refetch()}>Retry evidence</Button></div>;
  return <div className="space-y-3">
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Original amount</TableHead><TableHead>Rate evidence</TableHead><TableHead>Reporting amount / exclusion</TableHead></TableRow></TableHeader>
      <TableBody>{query.data.items.map(row=><TableRow key={`${row.sourceType}:${row.sourceId}`}>
        <TableCell>{row.sourceType.replaceAll("_"," ")} #{row.sourceId}</TableCell>
        <TableCell>{row.currencyCode ?? "Unknown currency"} {row.amount ?? "Unavailable"}</TableCell>
        <TableCell>{row.rate ?? "Unavailable"}{row.rateVersion!==null?` · version ${row.rateVersion}`:""}{row.rateEffectiveAt?` · ${row.rateEffectiveAt.slice(0,10)}`:""}</TableCell>
        <TableCell>{row.reportingAmount ?? row.exclusion?.replaceAll("_"," ") ?? "Unavailable"}</TableCell>
      </TableRow>)}</TableBody></Table></div>
    {query.data.total===0?<p>No eligible contributions.</p>:null}
    <div className="flex flex-wrap items-center gap-2"><label>Rows <select className="rounded border p-2" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1);}}>{[25,50,100].map(size=><option key={size}>{size}</option>)}</select></label>
      <Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button>
      <span role="status">Page {page} of {Math.max(1,Math.ceil(query.data.total/pageSize))} · {query.data.total} contributions</span>
      <Button variant="outline" disabled={page*pageSize>=query.data.total} onClick={()=>setPage(page+1)}>Next</Button></div>
  </div>;
}

function MeasureCard({measure,filters}:{measure:FinancialMeasure;filters:Filters}) {
  const [expanded,setExpanded]=useState(false);
  const definition=financialMeasureDefinitions[measure];
  const params=new URLSearchParams({measure});
  for(const [key,value] of Object.entries(filters)) if(value!==undefined) params.set(key,String(value));
  const query=useQuery({queryKey:["/api/v2/analytics/financial-measures",measure,filters],
    queryFn:()=>requestJson<Summary>("GET",`/api/v2/analytics/financial-measures?${params}`),retry:false,staleTime:0,refetchOnMount:"always"});
  const data=query.data;
  return <Card className="min-w-0"><CardHeader><CardTitle className="text-base">{definition.label}</CardTitle></CardHeader><CardContent className="space-y-3">
    {query.isPending?<p role="status">Loading financial evidence…</p>:query.isError?<div role="alert"><p>This measure is unavailable. Check your reporting and source-record access, or retry.</p><Button variant="outline" onClick={()=>void query.refetch()}>Retry {definition.label.toLowerCase()}</Button></div>:data?<>
      <p className="break-words text-xl font-semibold tabular-nums">{data.amount!==null?`${data.currencyCode} ${data.amount}`:"Unavailable"}</p>
      <p role="status" className={data.state==="partial"?"font-semibold text-amber-700 dark:text-amber-400":"text-sm text-muted-foreground"}>{states[data.state]}{query.isFetching?" · Refreshing…":""}</p>
      {data.state==="setup_required"?<a className="text-primary underline" href="/admin/settings">Configure reporting currency</a>:null}
      <p className="text-xs text-muted-foreground">{definition.taxBasis.replaceAll("_"," ")} · {definition.dateBasis.replaceAll("_"," ")}</p>
      {"notice" in definition?<p className="text-sm">{definition.notice}</p>:null}
      <Button variant="outline" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>Why this number?</Button>
      {expanded?<div className="space-y-3 border-t pt-3"><p>{data.includedCount} included; {data.excludedCount} excluded. Latest approved direct rate effective on each transaction date. No inverse or fallback rates.</p>
        <p className="text-xs">Generated {new Date(data.generatedAt).toLocaleString()} · {data.calculationVersion}. {data.precisionNotice}</p>
        <EvidenceRows key={data.id} runId={data.id} measure={measure}/></div>:null}
    </>:null}
  </CardContent></Card>;
}

export function FinancialMeasuresPanel({filters={},measures=["ordered","open_commitment","received","invoiced","recorded_payments"]}:{filters?:Filters;measures?:FinancialMeasure[]}) {
  return <section aria-label="Financial measures" className="space-y-3"><div><h2 className="text-lg font-semibold">Financial measures</h2><p className="text-sm text-muted-foreground">Separate lifecycle values—not amounts to add together as total spend. {filters.from||filters.to?`${filters.from??"Start"} to ${filters.to??"today"}.`:"All dates."}</p></div>
    <div className="grid gap-4 xl:grid-cols-2">{measures.map(measure=><MeasureCard key={measure} measure={measure} filters={filters}/>)}</div></section>;
}
