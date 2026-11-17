import { useRef,useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { requestJson } from "@/lib/queryClient";
import { userFacingError } from "@/lib/user-facing-error";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { invalidateRequisitionDomain } from "@/lib/domain-invalidation";
import { intakeNeedSchema,type IntakeNeed,type IntakeEvaluation,type IntakeOption,type IntakeOptionKind,type IntakeRoute } from "@shared/procurement-intake";

const api="/api/v2/procurement/intake";
const labels:Record<IntakeRoute,string>={
  CATALOG_REQUISITION:"Catalogue requisition",CONTRACT_RELEASE:"Agreement-backed requisition",STANDARD_REQUISITION:"Standard requisition",
  RFQ_OR_SOURCING:"Competitive sourcing",SERVICE_REQUISITION:"Service requisition",SUPPLIER_ONBOARDING_REQUIRED:"Supplier onboarding required",
  MANUAL_PROCUREMENT_REVIEW:"Procurement review required",
};
const nextStep:Record<IntakeRoute,string>={
  CATALOG_REQUISITION:"Review the catalogue lines in your draft, then submit for approval when ready.",
  STANDARD_REQUISITION:"Review the new requisition before submitting for approval.",
  SERVICE_REQUISITION:"Review the service line before submitting it for approval.",
  CONTRACT_RELEASE:"Create a requisition draft first. The agreement release remains a separately approved action.",
  RFQ_OR_SOURCING:"Create a requisition draft first. After approval, use the linked RFQ workflow to set supplier response requirements.",
  SUPPLIER_ONBOARDING_REQUIRED:"Use the supplier register to complete independent onboarding. No draft is created here.",
  MANUAL_PROCUREMENT_REVIEW:"Ask your Procurement team to review the unresolved details. No draft is created here.",
};
type Context={organizationId:number;userId:number;warehouseId:number|null;create:boolean;suppliers:boolean;inventory:boolean};
type Recent={id:number;label:string;kind:"requisition"|"order";frequency:string;itemId:number|null};
type Favorite=Pick<IntakeNeed,"description"|"kind"|"itemId"|"siteId">;
type ApiIssue=Error&{status?:number;code?:string;details?:IntakeEvaluation};
const initial={description:"",kind:"unsure",quantity:1,requiredDate:"",justification:""} as IntakeNeed;

function Picker({scope,kind,label,value,department,onChange}:{scope:string;kind:IntakeOptionKind;label:string;
  value?:number;department?:number;onChange:(value?:number)=>void}){
  const [open,setOpen]=useState(false),[search,setSearch]=useState(""),[page,setPage]=useState(1);
  const [picked,setPicked]=useState<IntakeOption>();
  const q=useDebouncedValue(search,250);
  const params=new URLSearchParams({kind,search:q,page:String(page),...(department?{departmentId:String(department)}:{})});
  const list=useQuery({queryKey:[api,"options",scope,kind,q,page,department],enabled:open,retry:false,
    queryFn:()=>requestJson<{items:IntakeOption[];hasNext:boolean}>("GET",api+"/options?"+params)});
  return <div className="min-w-0 space-y-1">
    <Button type="button" variant="outline" className="h-auto min-h-9 w-full justify-start whitespace-normal break-words text-left"
      aria-expanded={open} aria-label={label} onClick={()=>setOpen(!open)}>
      {label}: {picked?.id===value&&picked?picked.label:value?`record #${value}`:"Choose"}
    </Button>
    {open&&<div className="space-y-2 rounded-md border p-2">
      <label className="block text-sm">{`Search ${label.toLowerCase()}`}
        <Input value={search} maxLength={80} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
      </label>
      {list.isPending&&<p role="status">Loading choices…</p>}
      {list.isError&&<><p role="alert">{userFacingError(list.error)}</p><Button type="button" variant="ghost" onClick={()=>void list.refetch()}>Retry choices</Button></>}
      {list.data&&!list.data.items.length&&<p>No choices match your search.</p>}
      <ul className="max-h-48 space-y-1 overflow-auto">{list.data?.items.map(i=><li key={i.id}>
        <button type="button" className="w-full break-words rounded px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-primary"
          onClick={()=>{setPicked(i);onChange(i.id);setOpen(false);}}>{i.label}</button>
      </li>)}</ul>
      <div className="flex flex-wrap gap-1">
        {value&&<Button type="button" variant="ghost" onClick={()=>{onChange(undefined);setPicked(undefined);setOpen(false);}}>Clear selection</Button>}
        {page>1&&<Button type="button" variant="ghost" onClick={()=>setPage(page-1)}>Previous choices</Button>}
        {list.data?.hasNext&&<Button type="button" variant="ghost" onClick={()=>setPage(page+1)}>Next choices</Button>}
      </div>
    </div>}
  </div>;
}

function IntakeWorkspace({context}:{context:Context}){
  const queryClient=useQueryClient();
  const scope=`${context.organizationId}:${context.userId}`, storageKey=`smart-intake:favorites:${scope}`;
  const [need,setNeed]=useState<IntakeNeed>(initial);
  const [result,setResult]=useState<IntakeEvaluation|null>(null);
  const [route,setRoute]=useState<IntakeRoute>();
  const [notice,setNotice]=useState("");
  const [issue,setIssue]=useState("");
  const [created,setCreated]=useState<number>();
  const [expert,setExpert]=useState<Recent>();
  const [favorites,setFavorites]=useState<Favorite[]>(()=>{
    try{
      const values:unknown=JSON.parse(localStorage.getItem(storageKey)??"[]");
      if(!Array.isArray(values))return [];
      return values.slice(0,8).flatMap(value=>{
        const parsed=intakeNeedSchema.pick({description:true,kind:true,itemId:true,siteId:true}).safeParse(value);
        return parsed.success?[parsed.data]:[];
      });
    }catch{return [];}
  });
  const confirmHeading=useRef<HTMLHeadingElement>(null);
  const retry=useRef<{signature:string;key:string}>();
  const history=useQuery({queryKey:[api,"recent",scope],queryFn:()=>requestJson<{items:Recent[];limited:boolean}>("GET",api+"/recent"),retry:false});
  const change=(update:Partial<IntakeNeed>)=>{setNeed(n=>({...n,...update}));setResult(null);setCreated(undefined);setNotice("");setIssue("");};
  const evaluate=useMutation({mutationFn:(value:IntakeNeed)=>requestJson<IntakeEvaluation>("POST",api+"/evaluate",value),
    onSuccess:e=>{setResult(e);setRoute(e.recommendation);setNotice("");setIssue("");requestAnimationFrame(()=>confirmHeading.current?.focus());},
    onError:e=>setIssue(userFacingError(e))});
  const convert=useMutation({
    mutationFn:({evaluation,selected}:{evaluation:IntakeEvaluation;selected:IntakeRoute})=>{
      const signature=evaluation.revision+":"+selected;
      if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
      return requestJson<{id:number}>("POST",api+"/convert",{need:evaluation.normalized,revision:evaluation.revision,route:selected},
        {headers:{"Idempotency-Key":retry.current.key}});
    },
    onSuccess:draft=>{setCreated(draft.id);setResult(null);setIssue("");setNotice("");void invalidateRequisitionDomain(queryClient);
      void queryClient.invalidateQueries({queryKey:[api,"recent",scope]});},
    onError:(error:ApiIssue)=>{
      if(error.code==="INTAKE_RECOMMENDATION_CHANGED"&&error.details?.revision){
        setResult(error.details);setRoute(error.details.recommendation);setNotice("The sources or policy changed. Review the updated recommendation before confirming again.");
        requestAnimationFrame(()=>confirmHeading.current?.focus());
      }else setIssue(userFacingError(error));
    },
  });
  const recent=useMutation({mutationFn:(entry:Recent)=>requestJson<{requiresExpert:boolean;need?:Partial<IntakeNeed>}>("GET",`${api}/recent/${entry.kind}/${entry.id}`),
    onSuccess:(data,entry)=>{
      if(data.requiresExpert){setExpert(entry);return;}
      setExpert(undefined);setNeed({...initial,...data.need});setResult(null);setCreated(undefined);setIssue("");
      setNotice("Starting point loaded. Enter a new date, justification and estimate; everything will be checked again.");
    },onError:e=>setIssue(userFacingError(e))});
  function saveFavorites(list:Favorite[]){
    setFavorites(list);
    try{localStorage.setItem(storageKey,JSON.stringify(list));}catch{setNotice("Favorites cannot be saved on this browser.");}
  }
  function submit(){
    const parsed=intakeNeedSchema.safeParse(need);
    if(!parsed.success){setIssue(`Check your request: ${parsed.error.issues.map(i=>i.path.join(".")).join(", ")}.`);return;}
    setIssue("");setNotice("");setCreated(undefined);evaluate.mutate(parsed.data);
  }
  const busy=evaluate.isPending||convert.isPending||recent.isPending;
  return <div className="mx-auto grid max-w-5xl min-w-0 gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <div className="min-w-0 space-y-4">
      <form className="space-y-4 rounded-lg border bg-card p-4" onSubmit={event=>{event.preventDefault();submit();}}>
        <fieldset className="min-w-0 space-y-4" disabled={busy}>
          <legend className="text-xl font-semibold">What do you need?</legend>
          <label className="block text-sm font-medium">Description of need
            <Textarea required minLength={3} maxLength={500} value={need.description} onChange={e=>change({description:e.target.value})}/>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Goods or service
              <select aria-label="Goods or service" className="block h-10 w-full rounded border bg-background px-2" value={need.kind} onChange={e=>change({kind:e.target.value as IntakeNeed["kind"]})}>
                <option value="unsure">Unsure</option><option value="goods">Goods</option><option value="service">Service</option>
              </select>
            </label>
            <label className="block text-sm font-medium">Quantity<Input required type="number" min={1} max={1000000} step={1} value={need.quantity||""} onChange={e=>change({quantity:Number(e.target.value)})}/></label>
            <label className="block text-sm font-medium">Estimated total value
              <Input inputMode="decimal" placeholder="Optional for priced catalogue or agreement items" value={need.estimatedValue??""} onChange={e=>change({estimatedValue:e.target.value||undefined})}/>
            </label>
            <label className="block text-sm font-medium">Required date<Input required type="date" value={need.requiredDate} onChange={e=>change({requiredDate:e.target.value})}/></label>
          </div>
          <label className="block text-sm font-medium">Business justification
            <Textarea required minLength={5} maxLength={2000} value={need.justification} onChange={e=>change({justification:e.target.value})}/>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Picker {...{scope}} kind="departments" label="Department" value={need.departmentId} onChange={departmentId=>change({departmentId,costCentreId:undefined})}/>
            <Picker {...{scope}} kind="costCentres" label="Cost centre" value={need.costCentreId} department={need.departmentId} onChange={costCentreId=>change({costCentreId})}/>
            <Picker {...{scope}} kind="sites" label="Delivery site" value={need.siteId} onChange={siteId=>change({siteId})}/>
            {context.inventory&&<Picker {...{scope}} kind="items" label="Known catalogue item" value={need.itemId} onChange={itemId=>change({itemId})}/>}
            {context.suppliers&&<Picker {...{scope}} kind="suppliers" label="Known supplier" value={need.supplierId} onChange={supplierId=>change({supplierId})}/>}
          </div>
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm font-medium">More details (agreement, currency, unit and tax)</summary>
            <div className="grid gap-2 sm:grid-cols-2">
              {context.suppliers&&<Picker {...{scope}} kind="contracts" label="Known agreement" value={need.contractId} onChange={contractId=>change({contractId})}/>}
              <Picker {...{scope}} kind="units" label="Unit of measure" value={need.unitId} onChange={unitId=>change({unitId})}/>
              <Picker {...{scope}} kind="taxes" label="Tax code" value={need.taxId} onChange={taxId=>change({taxId})}/>
              <label className="block text-sm font-medium">Currency code<Input maxLength={3} placeholder="Supplier or organization default" value={need.currency??""} onChange={e=>change({currency:e.target.value||undefined})}/></label>
            </div>
          </details>
          <Button type="submit">{evaluate.isPending?"Evaluating…":"Evaluate request"}</Button>
        </fieldset>
      </form>
      {notice&&<p role="status" className="rounded border p-3">{notice}</p>}
      {issue&&<p role="alert" className="break-words rounded border border-destructive p-3">{issue}</p>}
      {created&&<section role="status" className="space-y-2 rounded border p-4"><h2 className="font-semibold">Draft created</h2>
        <p>This draft was not submitted and no spend was committed.</p>
        <Button asChild><Link href={APP_ROUTES.procurement.requisition(created)}>Open requisition draft</Link></Button>
      </section>}
      {result&&<section aria-label="Intake recommendation" className="min-w-0 space-y-3 break-words rounded-lg border bg-card p-4">
        <h2 tabIndex={-1} ref={confirmHeading} className="text-lg font-semibold">Recommended: {labels[result.recommendation]}</h2>
        <p>{nextStep[result.recommendation]}</p>
        <ul className="list-disc space-y-1 pl-5">{result.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
        {result.blockers.length>0&&<ul className="space-y-1">{result.blockers.map(block=><li className="rounded border p-2" key={block.code}>
          <strong>{block.state==="setup_required"?"Setup required":block.state==="review"?"Manual review":"Blocked"}:</strong> {block.message}
        </li>)}</ul>}
        {result.supplier&&<p>Supplier: {result.supplier.name}</p>}
        {result.recommendation==="SUPPLIER_ONBOARDING_REQUIRED"&&result.supplier&&<Link className="text-primary underline" href={APP_ROUTES.procurement.supplier(result.supplier.id)}>Open supplier onboarding review</Link>}
        {result.agreement&&<p>Agreement {result.agreement.reference}: {result.agreement.currency} {result.agreement.unitPrice} per unit when evaluated.</p>}
        {result.alternatives.length>0&&<fieldset className="space-y-1"><legend className="font-medium">Available alternatives</legend>
          {[result.recommendation,...result.alternatives].map(r=><label key={r} className="flex items-center gap-2">
            <input type="radio" name="intake-route" value={r} checked={r===route} onChange={()=>setRoute(r)}/>{labels[r]}
          </label>)}
        </fieldset>}
        {!context.create&&<p>You can review recommendations, but cannot create drafts.</p>}
        {result.canCreateDraft&&route&&<Button type="button" disabled={busy} onClick={()=>{setIssue("");convert.mutate({evaluation:result,selected:route});}}>
          {convert.isPending?"Creating draft…":"Create controlled draft"}
        </Button>}
      </section>}
    </div>
    <aside className="min-w-0 space-y-4">
      <section className="min-w-0 space-y-2 break-words rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Recent purchases and requisitions</h2>
        {history.isPending&&<p role="status">Loading recent purchases…</p>}
        {history.isError&&<><p role="alert">{userFacingError(history.error)}</p><Button variant="ghost" onClick={()=>void history.refetch()}>Retry history</Button></>}
        {history.data?.limited&&<p>Purchase history is not available in your current access scope.</p>}
        {history.data&&!history.data.limited&&!history.data.items.length&&<p>No recent purchases yet.</p>}
        <ul className="space-y-1">{history.data?.items.map(i=><li key={`${i.kind}:${i.id}`}>
          <Button disabled={busy} type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal break-words text-left" onClick={()=>recent.mutate(i)}>
            {i.kind==="order"?"Repeat":"Start from"} {i.label}{i.itemId&&Number(i.frequency)>1?` · ${i.frequency} recent matches`:""}
          </Button>
        </li>)}</ul>
        {expert&&<p>This source needs the full requisition editor. <Link className="underline" href={`${APP_ROUTES.procurement.requisitionNew}?${expert.kind==="order"?"copyPoFrom":"copyFrom"}=${expert.id}`}>Open a new expert draft</Link></p>}
      </section>
      <section className="space-y-2 break-words rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Favorites on this browser</h2>
        {!favorites.length&&<p>Save a common need to start faster next time.</p>}
        {favorites.map((f,index)=><div key={index} className="flex flex-wrap items-center gap-1 border-b py-1">
          <Button variant="ghost" className="h-auto max-w-full whitespace-normal break-words text-left" type="button" disabled={busy}
            onClick={()=>{setNeed({...initial,...f});setResult(null);setCreated(undefined);setNotice("");setIssue("");}}>{f.description}</Button>
          <Button type="button" variant="ghost" aria-label={`Remove favorite ${f.description}`} onClick={()=>saveFavorites(favorites.filter((_,i)=>i!==index))}>Remove</Button>
        </div>)}
        <Button type="button" variant="outline" disabled={need.description.trim().length<3||favorites.length>=8}
          onClick={()=>saveFavorites([...favorites,{description:need.description.trim(),kind:need.kind,itemId:need.itemId,siteId:need.siteId}])}>Save as favorite</Button>
      </section>
    </aside>
  </div>;
}

export default function ProcurementIntakePage(){
  const {user}=useAuth();
  const org=(user as typeof user & {activeOrganizationId?:number})?.activeOrganizationId;
  const context=useQuery({queryKey:[api,"context",org,user?.id],enabled:!!user,retry:false,queryFn:()=>requestJson<Context>("GET",api+"/context")});
  return <main className="min-w-0" data-testid="procurement-intake-page">
    <header className="space-y-1 px-3 pt-4 sm:px-6">
      <h1 className="text-2xl font-bold">Smart Procurement Intake</h1>
      <p>Describe what you need. Check the recommended route before making a new draft.</p>
      <Link className="text-primary underline" href={APP_ROUTES.procurement.requisitionNew}>Open expert requisition form</Link>
    </header>
    {context.isPending&&<p role="status" className="p-4">Loading Smart Intake…</p>}
    {context.isError&&<div className="space-y-2 p-4"><p role="alert">{userFacingError(context.error)}</p>
      <Button variant="outline" onClick={()=>void context.refetch()}>Retry Intake</Button></div>}
    {context.data&&<IntakeWorkspace key={`${context.data.organizationId}:${context.data.userId}:${context.data.warehouseId}`} context={context.data}/>}
  </main>;
}
