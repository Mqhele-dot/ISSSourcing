import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { requestJson, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Rule={required:boolean;revision:number;configured:boolean};
export function InspectionRuleEditor({subjectType,subjectId}:{subjectType:"item"|"supplier";subjectId:number}) {
  const [open,setOpen]=useState(false);
  return <section className="rounded border p-3">
    <Button variant="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>Receipt inspection rule</Button>
    {open&&<RuleForm key={`${subjectType}:${subjectId}`} subjectType={subjectType} subjectId={subjectId}/>}
  </section>;
}
function RuleForm({subjectType,subjectId}:{subjectType:"item"|"supplier";subjectId:number}) {
  const path=`/api/v2/inventory/inspection-rules/${subjectType}/${subjectId}`;
  const [reason,setReason]=useState("");
  const query=useQuery({queryKey:[path],queryFn:()=>requestJson<Rule>("GET",path)});
  const save=useMutation({mutationFn:(required:boolean)=>requestJson("PUT",path,{required,revision:query.data?.revision,reason}),onSuccess:async()=>{setReason("");await Promise.all([query.refetch(),queryClient.invalidateQueries({queryKey:["item-availability"]})]);}});
  return <div className="mt-3 space-y-3 text-sm">
    <p>Requires inventory approval permission and all-warehouse access. Inspection is required if either the item or supplier rule requires it.</p>
    <p>Conservative mode: each new PO receipt holds this item in <strong>all warehouses</strong>, including existing stock, until a different approver releases its hold with inspection evidence. Disabling a rule does not release existing holds. This is not receipt-only or lot-level inspection.</p>
    {query.isPending&&<p role="status">Loading inspection policy…</p>}
    {query.isError&&<p role="alert">{query.error.message} <Button onClick={()=>query.refetch()}>Retry</Button></p>}
    {query.data&&<>
      <p>Current rule: {query.data.required?"Inspection required":"No inspection required by this rule"} · revision {query.data.revision}</p>
      <label className="block">Change reason (required)<Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label>
      <Button disabled={save.isPending||query.isFetching||reason.trim().length<5} onClick={()=>save.mutate(!query.data!.required)}>{query.data.required?"Disable future inspection requirement":"Require inspection with item-wide holds"}</Button>
    </>}
    {save.isError&&<p role="alert">{save.error.message} <Button variant="outline" onClick={()=>query.refetch()}>Reload rule</Button></p>}
    {save.isSuccess&&<p role="status">Rule saved. Existing holds are unchanged.</p>}
  </div>;
}
