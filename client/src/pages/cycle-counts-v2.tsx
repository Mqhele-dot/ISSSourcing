import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestJson, queryClient } from "@/lib/queryClient";
import { invalidateInventoryDomain } from "@/lib/domain-invalidation";

type Count = {id:number;warehouseId:number;status:string;currentAttempt:number;countedBy:number|null};
type Line = {id:number;sku:string;name:string;location:string|null;countedQuantity:string|null;expectedQuantity?:string;variance?:string;varianceValue?:string|null};
type Page<T> = {items:T[];total:number};
const base = "/api/v2/inventory/cycle-counts";
function Pager({page,total,size,change}:{page:number;total:number;size:number;change:(page:number)=>void}) {
  const last=Math.max(1,Math.ceil(total/size));
  return <div className="flex flex-wrap items-center gap-2 py-3">
    <span>{total?`${(page-1)*size+1}–${Math.min(page*size,total)} of ${total}`:"0 results"}</span>
    {([ ["First",1,page<=1],["Previous",page-1,page<=1],["Next",page+1,page>=last],["Last",last,page>=last]] as const).map(([label,target,disabled])=><Button key={label} variant="outline" disabled={disabled} onClick={()=>change(target)}>{label}</Button>)}
  </div>;
}
function Entry({line,enabled,save}:{line:Line;enabled:boolean;save:(id:number,quantity:number)=>void}) {
  const [quantity,setQuantity]=useState("");
  return line.countedQuantity!==null?<span>Recorded: {line.countedQuantity}</span>:<div className="flex flex-wrap items-center gap-2">
    <Label htmlFor={`count-${line.id}`}>Counted quantity for {line.sku}</Label>
    <Input className="w-28" id={`count-${line.id}`} type="number" min="0" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} disabled={!enabled}/>
    <Button disabled={!enabled||quantity===""||!Number.isInteger(Number(quantity))||Number(quantity)<0} onClick={()=>save(line.id,Number(quantity))}>Record</Button>
  </div>;
}
export default function CycleCountsPage() {
  const [page,setPage]=useState(1),[size,setSize]=useState(25),[linePage,setLinePage]=useState(1);
  const [selected,setSelected]=useState<number|null>(null),[warehouse,setWarehouse]=useState("");
  const [review,setReview]=useState(false),[reason,setReason]=useState(""),[error,setError]=useState("");
  const [keys]=useState(()=>new Map<number,string>());
  const counts=useQuery({queryKey:[base,page,size],queryFn:()=>requestJson<Page<Count>>("GET",`${base}?page=${page}&pageSize=${size}`),placeholderData:keepPreviousData});
  const detail=useQuery({queryKey:[base,"detail",selected],queryFn:()=>requestJson<Count>("GET",`${base}/${selected}`),enabled:selected!==null});
  const lines=useQuery({queryKey:[base,"lines",selected,linePage,size,review],queryFn:()=>requestJson<Page<Line>>("GET",`${base}/${selected}/${review?"review":"lines"}?page=${linePage}&pageSize=${size}`),enabled:selected!==null,retry:false});
  const warehouses=useQuery({queryKey:["/api/warehouses"],queryFn:()=>requestJson<Array<{id:number;name:string}>>("GET","/api/warehouses")});
  const refresh=()=>queryClient.invalidateQueries({queryKey:[base]});
  const mutation=useMutation({mutationFn:async(input:{action:string;lineId?:number;quantity?:number})=>{
    if(input.action==="create") return requestJson<Count>("POST",base,{warehouseId:Number(warehouse)});
    if(input.action==="entry") return requestJson("PUT",`${base}/${selected}/lines/${input.lineId}`,{countedQuantity:input.quantity});
    const headers:Record<string,string>={};
    if(input.action==="post"&&selected!==null) {if(!keys.has(selected)) keys.set(selected,crypto.randomUUID());headers["Idempotency-Key"]=keys.get(selected)!;}
    return requestJson("POST",`${base}/${selected}/${input.action}`,["cancel","recount"].includes(input.action)?{reason}:{},{headers});
  },onSuccess:async(result,input)=>{setError("");if(input.action==="create"){setSelected((result as Count).id);setLinePage(1);setReview(false);}await refresh();if(input.action==="post")await invalidateInventoryDomain(queryClient);},
  onError:async(err)=>{setError(err instanceof Error?err.message:"Request failed");await refresh();}});
  const status=detail.data?.status;
  return <div className="space-y-5" data-testid="cycle-counts-page">
    <PageHeader title="Cycle counts" description="Blind counts with server snapshots and independent variance approval."/>
    <Card><CardHeader><CardTitle>Plan a warehouse count</CardTitle></CardHeader><CardContent className="space-y-3">
      <p>Start snapshots all warehouse positions. Normal operations continue; changed stock requires a recount. Entries cannot be overwritten. Use Recount to correct an entry.</p>
      <div className="flex flex-wrap items-center gap-3"><Label htmlFor="count-warehouse">Warehouse</Label>
      <select id="count-warehouse" className="h-10 max-w-full rounded-md border bg-background px-3" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">Select warehouse</option>{warehouses.data?.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <Button disabled={!warehouse||mutation.isPending} onClick={()=>mutation.mutate({action:"create"})}>Create count</Button></div>
      {warehouses.isError&&<p role="alert">Warehouses unavailable. <Button onClick={()=>warehouses.refetch()}>Retry warehouses</Button></p>}
    </CardContent></Card>
    {error&&<p role="alert" className="rounded border border-destructive p-3">{error}</p>}
    <Card><CardHeader><CardTitle>Counts</CardTitle></CardHeader><CardContent>
      <Label htmlFor="count-page-size">Rows per page</Label>{" "}<select id="count-page-size" value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);setLinePage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select>
      {counts.isPending&&<p role="status">Loading counts…</p>}{counts.isError&&<p role="alert">Counts unavailable. <Button onClick={()=>counts.refetch()}>Retry</Button></p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Count</th><th>Warehouse</th><th>Status</th><th>Actions</th></tr></thead><tbody>{counts.data?.items.map(c=><tr key={c.id} className="border-t"><td className="p-3">#{c.id}</td><td>{warehouses.data?.find(w=>w.id===c.warehouseId)?.name??`#${c.warehouseId}`}</td><td>{c.status}</td><td><Button variant="outline" disabled={counts.isPlaceholderData} onClick={()=>{setSelected(c.id);setLinePage(1);setReview(false);setError("");}}>Open count #{c.id}</Button></td></tr>)}</tbody></table></div>
      <Pager page={page} size={size} total={counts.data?.total??0} change={setPage}/>
    </CardContent></Card>
    {selected!==null&&<Card><CardHeader><CardTitle>Count #{selected} — {status??"Loading"}</CardTitle></CardHeader><CardContent className="space-y-4">
      {detail.isError&&<p role="alert">Count unavailable. <Button onClick={()=>detail.refetch()}>Retry detail</Button></p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={mutation.isPending||!["PLANNED","planned","in_progress","RECOUNT_REQUIRED"].includes(status??"")} onClick={()=>mutation.mutate({action:"start"})}>Start / snapshot</Button>
        <Button disabled={mutation.isPending||status!=="COUNTING"} onClick={()=>mutation.mutate({action:"submit"})}>Submit count</Button>
        <Button variant="outline" onClick={()=>{setReview(!review);setLinePage(1);}}>{review?"Return to blind entries":"Open independent review"}</Button>
        <Button disabled={mutation.isPending||status!=="PENDING_APPROVAL"||!review||lines.isError} onClick={()=>mutation.mutate({action:"approve"})}>Approve variance</Button>
        <Button disabled={mutation.isPending||status!=="APPROVED"} onClick={()=>mutation.mutate({action:"post"})}>Post approved count</Button>
      </div>
      <p className="text-sm text-muted-foreground">Review requires approval permission and a different user from the counter. Historical completed counts remain immutable.</p>
      <Label htmlFor="count-reason">Reason for recount or cancellation (at least five characters)</Label><Input id="count-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/>
      <div className="flex gap-2"><Button variant="outline" disabled={mutation.isPending||reason.trim().length<5||!["COUNTING","PENDING_APPROVAL","APPROVED","RECOUNT_REQUIRED"].includes(status??"")} onClick={()=>mutation.mutate({action:"recount"})}>Request recount</Button>
      <Button variant="outline" disabled={mutation.isPending||reason.trim().length<5||!status||["POSTED","completed","CANCELLED"].includes(status)} onClick={()=>mutation.mutate({action:"cancel"})}>Cancel count</Button></div>
      {lines.isPending&&<p role="status">Loading positions…</p>}{lines.isError&&<p role="alert">{lines.error.message} <Button onClick={()=>lines.refetch()}>Retry lines</Button></p>}
      <div className="space-y-3">{lines.data?.items.map(line=><div className="rounded-md border p-3 space-y-2" key={line.id}><p>{line.sku} — {line.name} · {line.location??"Unassigned location"}</p>
        {review?<p>Expected: {line.expectedQuantity} · Counted: {line.countedQuantity??"Not entered"} · Variance: {line.variance??"Not calculated"} · Value variance: {line.varianceValue??"Cost evidence unavailable"}</p>:<Entry line={line} enabled={status==="COUNTING"&&!mutation.isPending} save={(lineId,quantity)=>mutation.mutate({action:"entry",lineId,quantity})}/>}
      </div>)}</div><Pager page={linePage} size={size} total={lines.data?.total??0} change={setLinePage}/>
    </CardContent></Card>}
  </div>;
}
