import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {requestJson,errorMessageWithRequestId} from "@/lib/queryClient";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

const fields={total:"Invoice total",paidAmount:"Recorded payments",remainingBalance:"Remaining balance",currencyCode:"Original currency code",status:"Invoice status",issueDate:"Invoice issue date",dueDate:"Due date"};
type Event={id:string;eventKind:string;effectiveAt:string;actorProvenance:string;snapshot:Record<string,string|null>};
export function ApHistoricalCorrectionForm({onPrepared}:{onPrepared:(id:string)=>void}) {
  const [open,setOpen]=useState(false),[invoice,setInvoice]=useState(""),[page,setPage]=useState(1),[selected,setSelected]=useState<Event|null>(null);
  const [values,setValues]=useState<Record<string,string>>({}),[reason,setReason]=useState(""),[documents,setDocuments]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const history=useQuery({queryKey:["/api/v2/ap/invoices/balance-history",invoice,page],queryFn:()=>requestJson<{items:Event[];total:number}>("GET",`/api/v2/ap/invoices/${invoice}/balance-history?page=${page}&pageSize=25`),enabled:open&&/^[1-9][0-9]*$/.test(invoice),retry:false});
  async function prepare() {
    if(!selected)return;setBusy(true);setMessage("");
    try {
      const documentIds=documents.split(",").map(v=>Number(v.trim()));
      if(documentIds.some(id=>!Number.isSafeInteger(id)||id<1)) throw new Error("Enter the IDs of verified documents linked to this invoice, separated by commas.");
      const patch=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,key==="dueDate"&&!value?null:value]));
      const result=await requestJson<{id:string|number}>("POST","/api/v2/ap/balance-corrections",{invoiceId:Number(invoice),targetEventId:String(selected.id),patch,documentIds,reason});
      setMessage("Correction preview prepared. Review it below, then submit it for independent approval.");onPrepared(String(result.id));
    }catch(e){setMessage(errorMessageWithRequestId(e));}finally{setBusy(false);}
  }
  return <details className="rounded border p-3" onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-medium">Prepare a historical reporting correction</summary>{open?<div className="mt-3 space-y-3">
    <p className="text-sm">Corrections apply at the selected event timestamp until the next recorded state. They cannot create history before opening coverage. Source invoices and frozen reports are not edited. Current balances that disagree with operational records remain excluded pending reconciliation.</p>
    <label className="block">Invoice ID<Input type="number" min="1" value={invoice} onChange={e=>{setInvoice(e.target.value);setSelected(null);setPage(1);}}/></label>
    {history.isFetching?<p role="status">Loading captured events…</p>:null}
    {history.isError?<p role="alert">Invoice history could not be loaded. Check your access and the invoice ID.</p>:null}
    {history.data?<><label className="block">Captured balance event<select className="block w-full rounded border p-2" value={selected?.id??""} onChange={e=>{const event=history.data!.items.find(row=>String(row.id)===e.target.value)??null;setSelected(event);setValues(event?Object.fromEntries(Object.keys(fields).map(key=>[key,event.snapshot[key]??""])):{});setConfirmed(false);}}><option value="">Choose an event</option>{history.data.items.map(event=><option key={event.id} value={event.id} disabled={event.eventKind==="DELETED"}>#{event.id} · {event.eventKind} · {new Date(event.effectiveAt).toLocaleString()}</option>)}</select></label><div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous events</Button><Button variant="outline" disabled={page*25>=history.data.total} onClick={()=>setPage(page+1)}>Next events</Button></div></>:null}
    {selected?<><p>Original provenance: {selected.actorProvenance.replaceAll("_"," ")}. Effective time stays {new Date(selected.effectiveAt).toLocaleString()}.</p><div className="grid gap-3 sm:grid-cols-2">{Object.entries(fields).map(([key,label])=><label key={key} className="block space-y-1"><span>{label}</span><span className="block text-xs text-muted-foreground">Recorded: {selected.snapshot[key]??"Unavailable"}</span><Input value={values[key]??""} onChange={e=>setValues(previous=>({...previous,[key]:e.target.value}))}/></label>)}</div>
      <label className="block">Supporting invoice document IDs<Input value={documents} onChange={e=>setDocuments(e.target.value)} placeholder="IDs separated by commas"/></label><p className="text-xs text-muted-foreground">Use current documents linked to this invoice in Documents. Integrity checksums are required; missing or changed documents block approval.</p>
      <label className="block">Historical correction reason<Input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the supporting evidence and understand this is a reporting correction, not a payment or invoice amendment.</label>
      <Button disabled={busy||!confirmed||!reason.trim()||!documents.trim()} onClick={()=>void prepare()}>{busy?"Preparing correction…":"Prepare correction preview"}</Button></>:null}
    {message?<p role="status">{message}</p>:null}
  </div>:null}</details>;
}
