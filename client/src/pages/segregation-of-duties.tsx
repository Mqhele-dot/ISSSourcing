import {useState,useEffect} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {requestJson,errorMessageWithRequestId} from "@/lib/queryClient";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Tabs,TabsList,TabsTrigger} from "@/components/ui/tabs";
import {usePermissions} from "@/hooks/use-permissions";
import type {SodAnalysis,SodAnalyze} from "@shared/procurement-governance";
import {userRoleEnum} from "@shared/schema";
const root="/api/v2/admin/sod";
const command=(path:string,body:unknown,key:string)=>requestJson("POST",root+path,body,{headers:{"Idempotency-Key":key}});
type Row=Record<string,unknown>;
export default function SegregationOfDuties(){
 const initialTab=()=>{const v=new URLSearchParams(window.location.search).get("view");return v&&["users","roles","conflicts","exceptions","rules"].includes(v)?v:"summary";};
 const cache=useQueryClient(),access=usePermissions(),[tab,setTab]=useState(initialTab),[page,setPage]=useState(1),[size,setSize]=useState(25);
 useEffect(()=>{const onPop=()=>{setTab(initialTab());setPage(1);};window.addEventListener("popstate",onPop);return()=>window.removeEventListener("popstate",onPop);},[]);
 const [kind,setKind]=useState<"user"|"role">("role"),[role,setRole]=useState("viewer"),[identity,setIdentity]=useState(""),[reason,setReason]=useState("");
 const [analysis,setAnalysis]=useState<SodAnalysis|null>(null),[proposal,setProposal]=useState<SodAnalyze|null>(null),[control,setControl]=useState(""),[days,setDays]=useState(7),[key,setKey]=useState(()=>crypto.randomUUID());
 const allowed=access.hasPermission("custom_roles","manage")||access.hasPermission("custom_roles","admin");
 const context=useQuery<{enabled:boolean}>({queryKey:[root,"context"],queryFn:()=>requestJson("GET",root+"/context"),enabled:allowed,retry:false});
 const feed=useQuery<Row>({queryKey:[root,tab,page,size],queryFn:()=>requestJson("GET",`${root}/${tab}?page=${page}&pageSize=${size}`),enabled:allowed&&context.data?.enabled===true,retry:false});
 const refresh=async()=>{await cache.invalidateQueries({queryKey:[root]});};
 const action=useMutation({mutationFn:async(task:{path:string;body:unknown})=>command(task.path,task.body,key),onSuccess:async()=>{setKey(crypto.randomUUID());await refresh();}});
 const inspect=useMutation({mutationFn:async()=>{
  const input:SodAnalyze=kind==="user"?{kind,userId:Number(identity)}:{kind,role:role as SodAnalyze["role"],...(role==="custom"?{customRoleId:Number(identity)}:{})};
  const result=await requestJson<SodAnalysis>("POST",root+"/analyze",input);setAnalysis(result);setProposal(input);return result;
 }});
 if(access.isLoading)return <p role="status">Loading access…</p>;
 if(!allowed)return <p role="alert">Role administration access is required. Ask an administrator to review your permissions.</p>;
 const rows=(feed.data?.items??[]) as Row[],total=Number(feed.data?.total??0);
 return <main className="mx-auto w-full max-w-6xl space-y-4 p-4" data-testid="sod-page">
  <h1 className="text-2xl font-semibold">Segregation of duties</h1>
  <p>Review dangerous access combinations before changes. Existing access is never silently removed. Approval limits and transaction-time independence still apply.</p>
  <a className="underline" href="/admin/user-roles">Open role management</a>
  {context.isLoading?<p role="status">Checking configuration…</p>:context.isError?<p role="alert">{errorMessageWithRequestId(context.error)} <Button onClick={()=>context.refetch()}>Retry configuration</Button></p>:!context.data?.enabled?<p role="status">Setup required: this capability remains disabled until its migration and acceptance gates are approved.</p>:<>
   <Tabs value={tab} onValueChange={v=>{setTab(v);setPage(1);const url=new URL(window.location.href);url.searchParams.set("view",v);window.history.pushState({},"",url);}}><TabsList className="flex h-auto flex-wrap justify-start">{["summary","users","roles","conflicts","exceptions","rules"].map(v=><TabsTrigger key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</TabsTrigger>)}</TabsList></Tabs>
   <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>feed.refetch()}>Refresh</Button><Button disabled={action.isPending} onClick={()=>action.mutate({path:"/scan",body:{}})}>Record access review</Button></div>
   {action.isError?<p role="alert">{errorMessageWithRequestId(action.error)}</p>:action.isSuccess?<p role="status">Review command saved. Acknowledging or reviewing access does not remove a conflict.</p>:null}
   {feed.isLoading?<p role="status">Loading review evidence…</p>:feed.isError?<p role="alert">{errorMessageWithRequestId(feed.error)} <Button onClick={()=>feed.refetch()}>Retry evidence</Button></p>:tab==="summary"?<div className="grid gap-3 sm:grid-cols-3">{["critical","high","users","roles","expiringExceptions"].map(k=><Card key={k}><CardHeader><CardTitle className="text-base">{({critical:"Critical conflicts",high:"High conflicts",users:"Users affected",roles:"Roles affected",expiringExceptions:"Expiring exceptions"} as Record<string,string>)[k]}</CardTitle></CardHeader><CardContent>{String(feed.data?.[k]??"Unavailable")}</CardContent></Card>)}</div>:<>
    {!rows.length?<p>No matching records in this organization.</p>:<div className="grid gap-3 md:grid-cols-2">{rows.map((r,i)=><Card key={String(r.id??r.subject_key??i)+String(r.rule_id??"")}><CardContent className="space-y-2 break-words pt-4">
     <h2 className="font-semibold">{String(r.label??r.name??r.subject_key??`Exception ${r.id}`)}</h2>
     {Object.entries(r).filter(([k])=>!["source_evidence","evidence","permission_fingerprint"].includes(k)).map(([k,v])=><p key={k} className="text-sm"><span className="font-medium">{k.replaceAll("_"," ")}: </span>{Array.isArray(v)?v.join(", "):v===null?"Not recorded":typeof v==="object"?"Review recorded evidence":String(v)}</p>)}
     {tab==="exceptions"&&["PENDING","APPROVED"].includes(String(r.status))?<Button disabled={action.isPending||reason.trim().length<10} onClick={()=>action.mutate({path:`/exceptions/${r.id}/${r.status==="PENDING"?"approve":"revoke"}`,body:{reason}})}>{r.status==="PENDING"?"Independently approve":"Revoke mitigation"}</Button>:null}
    </CardContent></Card>)}</div>}
    <div className="flex flex-wrap items-center gap-2"><label>Rows per page <select aria-label="Rows per page" value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page}; {total} records</span><Button disabled={page*size>=total} onClick={()=>setPage(page+1)}>Next</Button></div>
   </>}
   <Card><CardHeader><CardTitle>Analyze access</CardTitle></CardHeader><CardContent className="space-y-3">
    <div className="flex flex-wrap gap-2"><label>Subject <select aria-label="Subject" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="role">Role</option><option value="user">User</option></select></label>
     {kind==="role"?<label>Application role <select aria-label="Application role" value={role} onChange={e=>setRole(e.target.value)}>{userRoleEnum.enumValues.map(v=><option key={v}>{v}</option>)}</select></label>:null}
     {kind==="user"||role==="custom"?<Input aria-label="User or custom role ID" type="number" min="1" value={identity} onChange={e=>setIdentity(e.target.value)}/>:null}
     <Button disabled={inspect.isPending} onClick={()=>inspect.mutate()}>Analyze</Button></div>
    {inspect.isError?<p role="alert">{errorMessageWithRequestId(inspect.error)}</p>:null}
    {analysis?<section aria-label="Access analysis" className="space-y-2 break-words"><h2 className="font-semibold">{analysis.label}</h2><p>{analysis.limitation}</p><p>{analysis.conflicts.length} conflicts; {analysis.active?"active":"inactive"} access.</p>
     {analysis.conflicts.map(f=><div key={f.rule_id} className="rounded border p-3"><p>{f.severity}: {f.name} — {f.status}</p><p>{f.explanation}</p><p>{f.permissions.join(" + ")}</p><p>Next action: {f.mitigation}</p>{f.exception_expires_at?<p>Expires {new Date(f.exception_expires_at).toLocaleString()}</p>:null}
      {f.enforcement_mode==="REQUIRE_MITIGATION"&&!f.exception_id?<Button disabled={action.isPending||reason.trim().length<10||control.trim().length<10} onClick={()=>action.mutate({path:"/exceptions",body:{analysis:proposal,revision:analysis.revision,ruleId:f.rule_id,reason,control,startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+days*86400000).toISOString()}})}>Request independent mitigation</Button>:null}
     </div>)}{!analysis.conflicts.length?<p>No configured access conflict found. This is not payment clearance.</p>:null}</section>:null}
    <label className="block">Review reason<Input aria-label="Review reason" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label className="block">Compensating control<Input aria-label="Compensating control" maxLength={2000} value={control} onChange={e=>setControl(e.target.value)}/></label>
    <label>Mitigation duration (days)<Input aria-label="Mitigation duration (days)" type="number" min="1" max="89" value={days} onChange={e=>setDays(Math.max(1,Math.min(89,Number(e.target.value))))}/></label>
   </CardContent></Card>
  </>}
 </main>;
}
