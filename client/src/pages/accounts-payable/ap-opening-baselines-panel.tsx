import {useEffect,useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {usePermissions} from "@/hooks/use-permissions";
import {useAuth} from "@/hooks/use-auth";
import {requestJson} from "@/lib/queryClient";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
import {ApHistoricalCorrectionForm} from "./ap-historical-correction-form";

type Candidate={id:number;invoiceNumber:string;currencyCode:string|null;total:string|null;paidAmount:string|null;remainingBalance:string|null;status:string};
type Baseline={id:number|string;status:string;reason:string;createdBy:number;submittedBy:number|null;invoiceCount:number;appliedAt:string|null;requestKind?:string;effectiveAt?:string;targetEventId?:string};
type Detail=Baseline&{proposal:Array<{invoiceId:number;sourceRevision:string;snapshot:Record<string,string|null>}>};
type Page<T>={items:T[];total:number;page:number;pageSize:number};

export function ApOpeningBaselinesPanel() {
  const section=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const reveal=()=>{if(window.location.hash!=="#opening-baselines"||!section.current)return;section.current.open=true;setOpen(true);section.current.scrollIntoView({block:"start"});section.current.querySelector<HTMLElement>('summary')?.focus();};
    reveal();window.addEventListener('hashchange',reveal);window.addEventListener('popstate',reveal);
    return()=>{window.removeEventListener('hashchange',reveal);window.removeEventListener('popstate',reveal);};
  },[]);
  const [open,setOpen]=useState(false),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25);
  const [selected,setSelected]=useState<number[]>([]),[reason,setReason]=useState(""),[baselineId,setBaselineId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const permissions=usePermissions(),{user}=useAuth(),client=useQueryClient();
  const allowed=permissions.hasPermission("finance","read")&&permissions.hasPermission("reports","read");
  const candidates=useQuery({queryKey:["/api/v2/ap/balance-baseline-candidates",page,pageSize],queryFn:()=>requestJson<Page<Candidate>>("GET",`/api/v2/ap/balance-baseline-candidates?page=${page}&pageSize=${pageSize}`),enabled:open&&allowed,retry:false});
  const baselines=useQuery({queryKey:["/api/v2/ap/balance-baselines",page,pageSize],queryFn:()=>requestJson<Page<Baseline>>("GET",`/api/v2/ap/balance-baselines?page=${page}&pageSize=${pageSize}`),enabled:open&&allowed,retry:false});
  const detail=useQuery({queryKey:["/api/v2/ap/balance-baselines",baselineId],queryFn:()=>requestJson<Detail>("GET",`/api/v2/ap/balance-baselines/${baselineId}`),enabled:open&&allowed&&baselineId!==null,retry:false});
  async function mutate(action:"prepare"|"submit"|"approve") {
    setBusy(true);setMessage("");
    try {
      if(action==="prepare") {
        const result=await requestJson<{id:string|number}>("POST","/api/v2/ap/balance-baselines",{invoiceIds:selected,reason});
        setBaselineId(String(result.id));setSelected([]);
      } else await requestJson("POST",`/api/v2/ap/balance-baselines/${baselineId}/${action}`,{});
      await Promise.all([client.invalidateQueries({queryKey:["/api/v2/ap/balance-baselines"]}),client.invalidateQueries({queryKey:["/api/v2/ap/balance-baseline-candidates"]})]);
      await Promise.all([client.invalidateQueries({queryKey:["/api/v2/ap/aging"]}),client.invalidateQueries({queryKey:["/api/v2/analytics/financial-measures"]})]);
      setMessage(action==="approve"?"Approval recorded. Review the status below; additional policy levels may still be required.":action==="submit"?"Submitted for independent approval.":"Preview prepared. Review every original-currency balance before submitting.");
    }catch {setMessage("This action could not be completed. Check unchanged invoice values, independent approval, two-factor requirements and the configured approval policy, then retry. No partial baseline is applied.");}
    finally {setBusy(false);}
  }
  return <details ref={section} id="opening-baselines" className="rounded-lg border p-4 scroll-mt-20" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">AP reporting opening baselines</summary>
    {open?<div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">Review legacy balances in their original currencies. A different authorized person must approve them. Coverage begins when approval is applied; earlier dates remain unavailable. This does not change invoices, make payments or establish bank settlement.</p>
      {!allowed?<p role="status">Finance and reporting read access are required.</p>:<>
        {candidates.isPending||baselines.isPending?<p role="status">Loading opening evidence…</p>:null}
        {candidates.isError||baselines.isError?<div role="alert"><p>Opening evidence is unavailable. An administrator may need to install the AP history migration through the approved process.</p><Button variant="outline" onClick={()=>{void candidates.refetch();void baselines.refetch();}}>Retry opening evidence</Button></div>:null}
        {candidates.data?<>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Select</TableHead><TableHead>Invoice</TableHead><TableHead>Status</TableHead><TableHead>Currency</TableHead><TableHead>Total</TableHead><TableHead>Recorded payments</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader><TableBody>
            {candidates.data.items.map(row=><TableRow key={row.id}><TableCell><input type="checkbox" aria-label={`Select ${row.invoiceNumber}`} checked={selected.includes(row.id)} disabled={!permissions.hasPermission("finance","create")||busy||(!selected.includes(row.id)&&selected.length>=100)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,row.id]:previous.filter(id=>id!==row.id))}/></TableCell><TableCell>{row.invoiceNumber}</TableCell><TableCell>{row.status}</TableCell><TableCell>{row.currencyCode??"Unknown"}</TableCell><TableCell>{row.total??"Unavailable"}</TableCell><TableCell>{row.paidAmount??"Unavailable"}</TableCell><TableCell>{row.remainingBalance??"Unavailable"}</TableCell></TableRow>)}
          </TableBody></Table></div>
          {candidates.data.total===0?<p>No invoices currently require an opening baseline.</p>:null}
          <label className="block space-y-1"><span>Finance review reason</span><Input value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000}/></label>
          <Button disabled={busy||!selected.length||!reason.trim()||!permissions.hasPermission("finance","create")} onClick={()=>void mutate("prepare")}>Prepare opening preview ({selected.length})</Button>
        </>:null}
        {permissions.hasPermission("finance","create")?<ApHistoricalCorrectionForm onPrepared={id=>{setBaselineId(id);void baselines.refetch();}}/>:null}
        {baselines.data?<div className="space-y-2"><h3 className="font-medium">Baseline and correction requests</h3>{baselines.data.items.length===0?<p>No opening baseline requests.</p>:baselines.data.items.map(row=><div key={row.id} className="flex flex-wrap items-center gap-2 rounded border p-2"><span>{row.requestKind==="CORRECTION"?"Historical correction":"Baseline"} #{row.id}: {row.status} · {row.invoiceCount} invoices</span><Button variant="outline" onClick={()=>setBaselineId(String(row.id))}>Review {row.requestKind==="CORRECTION"?"correction":"baseline"} {row.id}</Button></div>)}</div>:null}
        <div className="flex flex-wrap items-center gap-2"><label>Rows <select value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous opening page</Button><span>Page {page}</span><Button variant="outline" disabled={page*pageSize>=Math.max(candidates.data?.total??0,baselines.data?.total??0)} onClick={()=>setPage(page+1)}>Next opening page</Button></div>
        {detail.isError?<p role="alert">This baseline could not be loaded. Select it again or retry opening evidence.</p>:null}
        {detail.data?<div className="space-y-3 rounded border p-3"><h3 className="font-medium">Reviewed baseline #{detail.data.id}: {detail.data.status}</h3><p>{detail.data.reason}</p><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Currency</TableHead><TableHead>Remaining balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{detail.data.proposal.map(line=><TableRow key={line.invoiceId}><TableCell>{line.snapshot.invoiceNumber}</TableCell><TableCell>{line.snapshot.currencyCode??"Unknown"}</TableCell><TableCell>{line.snapshot.remainingBalance??"Unavailable"}</TableCell><TableCell>{line.snapshot.status}</TableCell></TableRow>)}</TableBody></Table></div>
          {detail.data.status==="DRAFT"&&Number(detail.data.createdBy)===user?.id?<Button disabled={busy} onClick={()=>void mutate("submit")}>Submit reviewed {detail.data.requestKind==="CORRECTION"?"correction":"baseline"}</Button>:null}
          {detail.data.status==="SUBMITTED"?Number(detail.data.createdBy)===user?.id||Number(detail.data.submittedBy)===user?.id?<p>A different authorized person must approve this baseline.</p>:<Button disabled={busy||!permissions.hasPermission("finance","approve")} onClick={()=>void mutate("approve")}>{detail.data.requestKind==="CORRECTION"?"Approve historical correction":"Approve opening baseline"}</Button>:null}
          {detail.data.appliedAt?<p>{detail.data.requestKind==="CORRECTION"?`Correction recorded ${new Date(detail.data.appliedAt).toLocaleString()}, effective at ${new Date(detail.data.effectiveAt!).toLocaleString()}. Source invoices and saved reports remain unchanged.`:`Coverage starts ${new Date(detail.data.appliedAt).toLocaleString()}. Earlier dates are not reconstructed.`}</p>:null}
        </div>:null}
      </>}
      {message?<p role="status">{message}</p>:null}
      <a className="text-primary underline" href="/finance/approval-policies">Configure approval policies</a>
    </div>:null}
  </details>;
}
