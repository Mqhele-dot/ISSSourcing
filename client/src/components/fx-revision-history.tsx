import {useState} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {requestJson,queryClient} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
type History={current:{fromCurrencyCode:string;toCurrencyCode:string;rate:string;effectiveAt:string;expiresAt:string|null};total:number;items:Array<{id:string;version:number;rate:string;fromCurrencyCode:string;toCurrencyCode:string;effectiveAt:string;expiresAt:string|null;approvedAt:string;approvedBy:number;appliedAt:string;withdrawn:boolean}>};
export function FxRevisionHistory({rateId}:{rateId:number}) {
  const [page,setPage]=useState(1);
  const [reason,setReason]=useState('');
  const submit=useMutation({mutationFn:()=>requestJson('POST','/api/mdm/change-requests',{domain:'exchange-rates',entityId:rateId,action:'update',proposedPatch:{},reason:reason.trim()}),onSuccess:()=>queryClient.invalidateQueries({queryKey:['/api/mdm/change-requests']})});
  const query=useQuery({queryKey:['/api/mdm/fx/revisions',rateId,page],queryFn:()=>requestJson<History>('GET',`/api/mdm/fx/${rateId}/revisions?page=${page}&pageSize=25`),retry:false});
  if(query.isPending)return <p role="status">Loading reporting revisions…</p>;
  if(query.isError)return <div role="alert"><p>Reporting history is unavailable. Check your FX access or retry.</p><Button variant="outline" onClick={()=>void query.refetch()}>Retry history</Button></div>;
  return <section aria-label="Reporting FX revisions" className="space-y-2"><h3 className="font-medium">Reporting revision history</h3>
    <p>Current Master Data: {query.data.current.fromCurrencyCode} → {query.data.current.toCurrencyCode} at {query.data.current.rate}, effective {query.data.current.effectiveAt}. This is not proof of reporting approval.</p>
    {!query.data.total?<p>Unverified for reporting. Submit this rate for independent approval; an active Master Data rate alone does not qualify.</p>:null}
    {!query.data.total?<div className="space-y-2"><label className="block">Reason for reporting approval<input className="block w-full rounded border p-2" value={reason} maxLength={2000} onChange={event=>setReason(event.target.value)}/></label><Button disabled={reason.trim().length<5||submit.isPending||submit.isSuccess} onClick={()=>submit.mutate()}>Submit for reporting approval</Button>{submit.isSuccess?<p role="status">Submitted for independent review. Reporting has not changed.</p>:null}{submit.isError?<p role="alert">The request could not be submitted. Check your permissions and retry.</p>:null}</div>:null}
    {query.data.items.map(row=><div key={row.id} className="rounded border p-3 text-sm break-words">
      <p className="font-medium">Version {row.version}: {row.fromCurrencyCode} → {row.toCurrencyCode} · {row.rate} · {row.withdrawn?'Withdrawn':'Applied'}</p>
      <p>Effective {row.effectiveAt} through {row.expiresAt??'no stated expiry'} (expiry excluded).</p>
      <p>Approved {row.approvedAt} by user #{row.approvedBy}. Published {row.appliedAt}.</p>
    </div>)}
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous revisions</Button><span>Page {page} of {Math.max(1,Math.ceil(query.data.total/25))}</span><Button variant="outline" disabled={page*25>=query.data.total} onClick={()=>setPage(page+1)}>Next revisions</Button></div>
  </section>;
}
