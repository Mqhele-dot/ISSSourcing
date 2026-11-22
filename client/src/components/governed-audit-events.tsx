import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {requestJson} from '@/lib/queryClient';
import {usePermissions} from '@/hooks/use-permissions';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

type Event={id:number;createdAt:string;actorUserId:number|null;action:string;resourceType:string;resourceId:number|null;reason:string|null;findingKey:string|null;requestId:string|null};
export function GovernedAuditEvents(){
  const permissions=usePermissions();const [page,setPage]=useState(1),[size,setSize]=useState(25);
  const [filters,setFilters]=useState(()=>Object.fromEntries(new URLSearchParams(location.search).entries()));
  const allowed=permissions.hasPermission('audit_logs','read');
  const query=useQuery({queryKey:['/api/audit/events',filters,page,size],enabled:allowed,retry:false,queryFn:()=>{const params=new URLSearchParams({page:String(page),pageSize:String(size)});for(const key of ['actor','action','resourceType','resourceId','findingKey','from','to'])if(filters[key])params.set(key,filters[key]);return requestJson<{items:Event[];total:number}>('GET',`/api/audit/events?${params}`);}});
  if(!allowed)return <p>Audit-history read access is required.</p>;
  return <section aria-label="Governed audit" className="space-y-3"><p>Append-only evidence of authorized actions. This is separate from operational activity. Empty results do not establish audit-chain integrity.</p><div className="flex flex-wrap gap-3">{['actor','action','resourceType','resourceId','findingKey','from','to'].map(key=><label key={key}>{key}<Input value={filters[key]??''} placeholder={key==='from'||key==='to'?'ISO date/time with timezone':undefined} onChange={e=>{setPage(1);setFilters({...filters,[key]:e.target.value});}}/></label>)}</div>
    {query.isPending?<p role="status">Loading governed audit…</p>:query.isError?<div role="alert">Audit history is unavailable. Check filters or retry.<Button onClick={()=>void query.refetch()}>Retry governed audit</Button></div>:query.data?.items.length?query.data.items.map(row=><article key={row.id} className="rounded border p-3"><h3>{row.action.replaceAll('_',' ').toLowerCase()}</h3><p>{new Date(row.createdAt).toLocaleString()} · Actor {row.actorUserId??'system'} · {row.resourceType} {row.resourceId??'(no record ID)'}</p><p>{row.reason}</p><details><summary>Technical details</summary><p>Event {row.id} · Finding {row.findingKey??'not applicable'} · Request {row.requestId??'not recorded'}</p></details></article>):<p>No governed events match these filters.</p>}
    <div className="flex flex-wrap gap-2"><label>Audit rows <select value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous governed events</Button><span>Page {page} · {query.data?.total??0} events</span><Button disabled={page*size>=(query.data?.total??0)} onClick={()=>setPage(page+1)}>Next governed events</Button></div>
  </section>;
}
