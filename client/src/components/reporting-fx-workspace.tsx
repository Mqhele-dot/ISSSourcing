import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {requestJson,queryClient} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {FxRevisionHistory} from './fx-revision-history';

type Rate={id:number;fromCurrencyCode:string;toCurrencyCode:string;rate:string;effectiveAt:string;expiresAt:string|null;active:boolean;
  eligibility:string;revisionId:string|null;revisionVersion:number|null;publishedRate:string|null;appliedAt:string|null;revisionMatchesMasterData:boolean;requestId:number|null;requestStatus:string|null};
type Rates={items:Rate[];total:number;page:number;pageSize:number};
const eligibility:Record<string,string>={unverified:'Unverified for reporting',awaiting_approval:'Awaiting independent approval',approved_awaiting_application:'Approved; awaiting application',applied:'Published reporting revision',withdrawn:'Reporting series withdrawn'};
const midnight=(date:string)=>`${date}T00:00:00.000Z`;

/** Proposals only. Existing Master Data approval/application commands remain authoritative. */
export function ReportingFxWorkspace({onProposed}:{onProposed:()=>void}) {
  const [page,setPage]=useState(1),[q,setQ]=useState('');
  const [selected,setSelected]=useState<Rate|null>(null);
  const [mode,setMode]=useState<'create'|'correct'|'publish'|'withdraw'>('create');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[rate,setRate]=useState('');
  const [effective,setEffective]=useState(''),[expires,setExpires]=useState(''),[reason,setReason]=useState('');
  const [validation,setValidation]=useState<string|null>(null),[submitted,setSubmitted]=useState<number|null>(null);
  const list=useQuery({queryKey:['/api/mdm/fx/rates',page,q],queryFn:()=>requestJson<Rates>('GET',`/api/mdm/fx/rates?page=${page}&pageSize=25&q=${encodeURIComponent(q)}`),retry:false});
  const submit=useMutation({mutationFn:()=>{
    const patch:Record<string,unknown>=mode==='create'?{fromCurrencyCode:from.trim().toUpperCase(),toCurrencyCode:to.trim().toUpperCase(),rate:rate.trim(),effectiveDate:midnight(effective),expiresAt:expires?midnight(expires):null,source:'Manual governed request'}
      :mode==='publish'?{}:mode==='withdraw'?{active:false}:{rate:rate.trim(),...(expires!==(selected?.expiresAt?.slice(0,10)??'')?{expiresAt:expires?midnight(expires):null}:{})};
    return requestJson<{id:number}>('POST','/api/mdm/change-requests',{domain:'exchange-rates',entityId:selected?.id??null,action:mode==='create'?'create':mode==='withdraw'?'deactivate':'update',proposedPatch:patch,reason:reason.trim()});
  },onSuccess:async result=>{setSubmitted(result.id);await queryClient.invalidateQueries({queryKey:['/api/mdm/change-requests']});await list.refetch();}});
  function edit(row:Rate,action:'correct'|'publish'|'withdraw') {
    setSelected(row);setMode(action);setFrom(row.fromCurrencyCode);setTo(row.toCurrencyCode);setRate(row.rate);
    setEffective(row.effectiveAt.slice(0,10));setExpires(row.expiresAt?.slice(0,10)??'');setReason('');setValidation(null);setSubmitted(null);submit.reset();
  }
  function startNew(){setSelected(null);setMode('create');setFrom('');setTo('');setRate('');setEffective('');setExpires('');setReason('');setValidation(null);setSubmitted(null);submit.reset();}
  function propose(){
    setValidation(null);
    if(reason.trim().length<10){setValidation('Explain the business reason using at least 10 characters.');return;}
    if(mode==='create'&&(!/^[A-Z]{3}$/.test(from.trim().toUpperCase())||!/^[A-Z]{3}$/.test(to.trim().toUpperCase())||from.trim().toUpperCase()===to.trim().toUpperCase()||!effective)){
      setValidation('Choose two different active currency codes and an effective date.');return;
    }
    if(['create','correct'].includes(mode)&&(!/^\d+(?:\.\d+)?$/.test(rate.trim())||!/[1-9]/.test(rate))){setValidation('Enter a positive decimal rate without commas or scientific notation.');return;}
    if(expires&&expires<=effective){setValidation('Expiry must be after the effective date. Expiry is excluded from validity.');return;}
    submit.mutate();
  }
  return <section className="min-w-0 space-y-4" aria-label="Reporting exchange rates" data-testid="reporting-fx-workspace">
    <div className="rounded border p-4 space-y-2"><h2 className="text-lg font-semibold">Governed reporting exchange rates</h2>
      <p className="text-sm">Create proposals here; a different authorized person must approve them in the existing approval queue. Approval alone does not change reports. Successful application publishes an immutable revision. Saved reports never recalculate.</p>
      <p className="text-sm">Use active <a className="underline" href="/admin/master-data/currencies">Master Data currencies</a>. Rates are direct pairs; the app never inverts or triangulates them.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={startNew}>Propose new rate series</Button><Button variant="outline" onClick={onProposed}>Open approval queue</Button></div>
    </div>
    <form className="rounded border p-4 space-y-3" aria-label="Reporting rate proposal" onSubmit={event=>{event.preventDefault();propose();}}>
      <h3 className="font-medium">{mode==='create'?'New reporting series':mode==='publish'?'Approve existing Master Data rate for reporting':mode==='withdraw'?'Withdraw reporting series':'Correct reporting rate'}{selected?` · #${selected.id}`:''}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><Label htmlFor="fx-from">From currency code</Label><Input id="fx-from" value={from} maxLength={3} disabled={mode!=='create'} onChange={e=>setFrom(e.target.value.toUpperCase())}/></div>
        <div><Label htmlFor="fx-to">Reporting currency code</Label><Input id="fx-to" value={to} maxLength={3} disabled={mode!=='create'} onChange={e=>setTo(e.target.value.toUpperCase())}/></div>
        <div><Label htmlFor="fx-rate">Exact direct rate</Label><Input id="fx-rate" value={rate} inputMode="decimal" disabled={mode==='publish'||mode==='withdraw'} onChange={e=>setRate(e.target.value)}/></div>
        <div><Label htmlFor="fx-effective">Effective date (00:00 UTC)</Label><Input id="fx-effective" type="date" value={effective} disabled={mode!=='create'} onChange={e=>setEffective(e.target.value)}/></div>
        <div><Label htmlFor="fx-expires">Expiry date, exclusive (optional)</Label><Input id="fx-expires" type="date" value={expires} disabled={mode==='publish'||mode==='withdraw'} onChange={e=>setExpires(e.target.value)}/></div>
      </div>
      <div><Label htmlFor="fx-reason">Business reason for FX proposal</Label><Input id="fx-reason" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></div>
      {validation?<p role="alert">{validation}</p>:null}
      {submit.isError?<p role="alert">The proposal could not be submitted. Check your domain permissions and active currencies, then retry. No rate has been published.</p>:null}
      <Button type="submit" disabled={submit.isPending||submitted!==null}>{submit.isPending?'Submitting proposal…':'Submit FX proposal for independent approval'}</Button>
      {submitted!==null?<div role="status"><p>Request #{submitted} submitted. Reporting has not changed.</p><Button type="button" variant="outline" onClick={onProposed}>Review submitted request</Button></div>:null}
    </form>
    <div className="space-y-2"><Label htmlFor="fx-search">Search currency pairs</Label><Input id="fx-search" value={q} maxLength={100} onChange={e=>{setPage(1);setQ(e.target.value);}}/></div>
    {list.isPending?<p role="status">Loading exchange rates…</p>:list.isError?<div role="alert"><p>Rates are unavailable. Check your FX access and reporting prerequisites.</p><Button variant="outline" onClick={()=>void list.refetch()}>Retry exchange rates</Button></div>:<>
      {list.data?.items.length===0?<p>No matching rate series. Create a governed proposal above; active legacy rates are not automatically approved.</p>:null}
      <ul className="space-y-3">{list.data?.items.map(row=><li key={row.id} className="min-w-0 rounded border p-3 space-y-2 break-words">
        <h3 className="font-medium">{row.fromCurrencyCode} → {row.toCurrencyCode} · Master Data rate {row.rate}</h3>
        <p>{eligibility[row.eligibility]??'Reporting eligibility not verified'}{row.revisionVersion?` · version ${row.revisionVersion} at ${row.publishedRate}`:''}</p>
        <p className="text-sm">Effective {row.effectiveAt}; expires {row.expiresAt??'without stated expiry'}. {row.appliedAt?`Published ${row.appliedAt}.`:''}</p>
        {row.revisionId&&!row.revisionMatchesMasterData?<p className="text-sm">The current Master Data fields differ from the published revision. Reporting still uses approved revision evidence.</p>:null}
        {row.requestId?<p className="text-sm">Latest request #{row.requestId}: {row.requestStatus}. Pending changes do not replace published rates.</p>:null}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>edit(row,'correct')}>Propose correction #{row.id}</Button>
          {!row.revisionId?<Button size="sm" variant="outline" onClick={()=>edit(row,'publish')}>Approve for reporting #{row.id}</Button>:null}
          {row.revisionId&&row.eligibility!=='withdrawn'?<Button size="sm" variant="outline" onClick={()=>edit(row,'withdraw')}>Propose withdrawal #{row.id}</Button>:null}</div>
      </li>)}</ul>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous rates</Button><span>Page {page} · {list.data?.total??0} series</span><Button variant="outline" disabled={page*25>=(list.data?.total??0)} onClick={()=>setPage(page+1)}>Next rates</Button><Button variant="outline" onClick={()=>void list.refetch()}>Refresh rates</Button></div>
    </>}
    {selected?<FxRevisionHistory key={selected.id} rateId={selected.id}/>:null}
  </section>;
}
