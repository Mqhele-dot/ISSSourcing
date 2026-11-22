import {useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {requestJson,errorMessageWithRequestId} from "@/lib/queryClient";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card,CardHeader,CardContent,CardTitle} from "@/components/ui/card";
import type {PaymentRiskView} from "@shared/procurement-governance";
import {invalidateAfterPaymentBatch} from "./ap-invalidate";
export function PaymentRiskPanel({batchId,canApprove,canRelease}:{batchId:number;canApprove:boolean;canRelease:boolean}){
 const cache=useQueryClient(),[reason,setReason]=useState(""),[page,setPage]=useState(1),[size,setSize]=useState(25),[key,setKey]=useState(()=>crypto.randomUUID());
 const [selectedAssessment,setSelectedAssessment]=useState<number|null>(null),[historyPage,setHistoryPage]=useState(1),[historySize,setHistorySize]=useState(25);
 const root=`/api/v2/ap/payment-batches/${batchId}/risk`;
 const risk=useQuery<PaymentRiskView|null>({queryKey:["payment-risk",batchId,page,size,selectedAssessment],queryFn:()=>requestJson("GET",`${root}?page=${page}&pageSize=${size}${selectedAssessment?`&assessmentId=${selectedAssessment}`:""}`),retry:false});
 const history=useQuery<{items:Array<{id:number;version:number;status:string;risk_level:string;score:number;assessed_at:string}>;total:number}>({queryKey:["payment-risk-history",batchId,historyPage,historySize],queryFn:()=>requestJson("GET",`${root}/history?page=${historyPage}&pageSize=${historySize}`),retry:false});
 const action=useMutation({mutationFn:(kind:"assess"|"review"|"approve"|"release")=>{
  const path=["assess","review"].includes(kind)?`${root}/${kind}`:`/api/ap/payment-batches/${batchId}/${kind}`;
  const body=kind==="assess"?{}:kind==="review"?{assessmentId:risk.data?.id,reason}:{riskAssessmentId:risk.data?.id,comment:reason};
  return requestJson("POST",path,body,{headers:{"Idempotency-Key":`${key}:${kind}`}});
 },onSuccess:async()=>{setKey(crypto.randomUUID());await Promise.all([cache.invalidateQueries({queryKey:["payment-risk"]}),cache.invalidateQueries({queryKey:["payment-risk-history"]}),cache.invalidateQueries({queryKey:["/api/v2/action-inbox"]}),invalidateAfterPaymentBatch()]);}});
 return <Card data-testid="payment-risk-panel"><CardHeader><CardTitle>Payment risk review — batch {batchId}</CardTitle></CardHeader><CardContent className="space-y-3 break-words">
  <p>Recorded payments are not proof of bank settlement. An assessment does not authorize a payment by itself.</p>
  {selectedAssessment?<Button variant="outline" onClick={()=>{setSelectedAssessment(null);setPage(1);}}>Return to current assessment</Button>:null}
  {risk.isLoading?<p role="status">Loading risk evidence…</p>:risk.isError?<p role="alert">{errorMessageWithRequestId(risk.error)} <Button onClick={()=>risk.refetch()}>Retry risk</Button></p>:!risk.data?<p>No assessment yet. Assess current evidence before requesting independent approval.</p>:<>
   <h3 className="font-semibold">{risk.data.riskLevel} — {risk.data.score}/100 · {risk.data.status}</h3>
   <p>Version {risk.data.version} · {new Date(risk.data.assessedAt).toLocaleString()} · {risk.data.amount} {risk.data.currency}</p>
   <p role="status">{risk.data.nextAction}</p>{risk.data.staleReason?<p>{risk.data.staleReason}</p>:null}
   <p>{risk.data.approvalBound?"Batch approval references this exact assessment.":"No batch approval is bound to this assessment."}</p>
   <ul className="space-y-2">{risk.data.signals.map(s=><li className="rounded border p-3" key={`${s.code}:${s.resourceKey}`}><p>+{s.points}: {s.explanation}</p><details><summary>Signal evidence</summary><p>{s.code} · {s.resourceKey}</p><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(s.evidence,null,2)}</pre></details></li>)}</ul>
   <div className="flex flex-wrap gap-2"><label>Signals per page <select aria-label="Signals per page" value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous signals</Button><span>Page {page}</span><Button disabled={risk.data.signals.length<size} onClick={()=>setPage(page+1)}>Next signals</Button></div>
  </>}
  <label className="block">Finance review reason<Input aria-label="Finance review reason" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
  <div className="flex flex-wrap gap-2"><Button disabled={action.isPending||risk.isError||risk.data?.canAssess===false} onClick={()=>action.mutate("assess")}>Assess current evidence</Button>
   <Button disabled={action.isPending||!risk.data?.canReview||risk.data.status!=="REVIEW_REQUIRED"||reason.trim().length<10} onClick={()=>action.mutate("review")}>Independently review risk</Button>
   <Button disabled={action.isPending||!canApprove||!risk.data?.canAssess||["STALE","BLOCKED","REVIEW_REQUIRED"].includes(risk.data?.status??"")} onClick={()=>action.mutate("approve")}>Approve exact assessment</Button>
   <Button disabled={action.isPending||!canRelease||!risk.data?.canAssess||!risk.data?.approvalBound||["STALE","BLOCKED","REVIEW_REQUIRED"].includes(risk.data?.status??"")} onClick={()=>action.mutate("release")}>Record approved batch payments</Button>
  </div>
  {action.isError?<p role="alert">{errorMessageWithRequestId(action.error)}</p>:action.isSuccess?<p role="status">Command saved. Current evidence and authority were checked by the server.</p>:null}
  <details><summary>Assessment history</summary>{history.isLoading?<p>Loading history…</p>:history.isError?<p role="alert">History unavailable. <Button onClick={()=>history.refetch()}>Retry history</Button></p>:<><p>{history.data?.total??0} versions; page {historyPage}.</p><ul>{history.data?.items.map(r=><li key={r.id} className="mb-2">Version {r.version}: {r.risk_level} {r.score}/100 — {r.status} · {new Date(r.assessed_at).toLocaleString()} <Button variant="outline" size="sm" onClick={()=>{setSelectedAssessment(Number(r.id));setPage(1);}}>View assessment version {r.version}</Button></li>)}</ul><div className="flex flex-wrap gap-2"><label>History per page <select aria-label="History per page" value={historySize} onChange={e=>{setHistorySize(Number(e.target.value));setHistoryPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><Button disabled={historyPage===1} onClick={()=>setHistoryPage(historyPage-1)}>Previous assessments</Button><Button disabled={historyPage*historySize>=(history.data?.total??0)} onClick={()=>setHistoryPage(historyPage+1)}>Next assessments</Button></div></>}</details>
 </CardContent></Card>;
}
