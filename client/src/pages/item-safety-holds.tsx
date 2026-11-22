import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { requestJson, queryClient } from "@/lib/queryClient";
import { invalidateInventoryDomain } from "@/lib/domain-invalidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InspectionRuleEditor } from "@/components/inventory/inspection-rule-editor";
import { ItemAvailabilityPanel } from "@/components/inventory/item-availability-panel";
type Hold={id:string;kind:string;reason:string;createdBy:number;createdAt:string;releasedAt:string|null;releaseReason:string|null};
export function ItemSafetyHolds({itemId,sku,onClose}:{itemId:number;sku:string;onClose:()=>void}) {
  const [reason,setReason]=useState(""),[kind,setKind]=useState("QUARANTINE"),[page,setPage]=useState(1);
  const [key,setKey]=useState(()=>crypto.randomUUID());
  const path=`/api/v2/inventory/items/${itemId}/safety-holds`;
  const query=useQuery({queryKey:[path,page],queryFn:()=>requestJson<{items:Hold[];total:number}>("GET",`${path}?page=${page}&pageSize=25`)});
  const mutation=useMutation({mutationFn:(id?:string)=>requestJson("POST",id?`${path}/${id}/release`:path,id?{reason}:{kind,reason,requestKey:key}),onSuccess:async()=>{setReason("");setKey(crypto.randomUUID());await queryClient.invalidateQueries({queryKey:[path]});await queryClient.invalidateQueries({queryKey:["/api/v2/inventory"]});await invalidateInventoryDomain(queryClient);}});
  return <section className="space-y-3 rounded-md border p-4" aria-label={`Safety holds for ${sku}`}>
    <h2 className="text-lg font-semibold">Item-wide safety holds — {sku}</h2>
    <InspectionRuleEditor subjectType="item" subjectId={itemId}/>
    <ItemAvailabilityPanel itemId={itemId}/>
    <p>A hold blocks stock decreases for this item in every warehouse. Receipts remain held. It does not classify individual bins or lots. Approval permission and all-warehouse access are required; a different approver must release each hold.</p>
    <Label className="block" htmlFor="hold-kind">Hold type</Label><select id="hold-kind" value={kind} onChange={e=>{setKind(e.target.value);setKey(crypto.randomUUID());}} className="block w-full rounded border p-2">{["INSPECTION","QUARANTINE","DAMAGED","BLOCKED"].map(x=><option key={x}>{x}</option>)}</select>
    <Label className="block" htmlFor="hold-reason">Reason / inspection evidence (required for apply or release)</Label><Input id="hold-reason" value={reason} onChange={e=>{setReason(e.target.value);setKey(crypto.randomUUID());}} maxLength={2000}/>
    <Button disabled={mutation.isPending||query.isPending||query.isError||reason.trim().length<5} onClick={()=>mutation.mutate(undefined)}>Hold item in all warehouses</Button>
    {mutation.isError&&<p role="alert">{mutation.error.message}</p>}{mutation.isSuccess&&<p role="status">Safety evidence saved.</p>}
    {query.isPending&&<p role="status">Loading holds…</p>}{query.isError&&<p role="alert">{query.error.message} <Button onClick={()=>query.refetch()}>Retry</Button></p>}
    {query.data?.items.map(h=><article key={h.id} className="space-y-2 rounded border p-3"><p>{h.kind} — {h.releasedAt?"Released":"Active"}</p><p>{h.reason}</p><p>Created by #{h.createdBy} · {new Date(h.createdAt).toLocaleString()}</p>{h.releasedAt?<p>Released {new Date(h.releasedAt).toLocaleString()}: {h.releaseReason}</p>:<Button variant="outline" disabled={mutation.isPending||reason.trim().length<5} onClick={()=>mutation.mutate(h.id)}>Release hold #{h.id}</Button>}</article>)}
    {query.data?.total===0&&<p>No recorded safety holds. This is not an inspection clearance.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page} · {query.data?.total??0} records</span><Button variant="outline" disabled={!query.data||page*25>=query.data.total} onClick={()=>setPage(page+1)}>Next</Button><Button variant="outline" onClick={onClose}>Close safety holds</Button></div>
  </section>;
}
