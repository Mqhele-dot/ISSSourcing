import { useState } from "react";
import { ItemSafetyHolds } from "./item-safety-holds";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient, requestJson } from "@/lib/queryClient";
import { invalidateInventoryDomain } from "@/lib/domain-invalidation";
type Option={id:number;code?:string;name?:string};
type Position={qualityState:string;id:number;sku:string;name:string;itemId:number;warehouseId:number;warehouseName:string;onHand:string;revision:string;legacyBin:string|null;legacyLocation:string|null;locationState:string;binCode:string|null;siteName:string|null;zoneName:string|null;warehouseItemReserved:string;lastVerifiedAt:string|null};
type Page<T>={items:T[];total:number;summary?:{onHand:string;reconciled:number;unresolved:number}};
type Evidence={id:string;binId:number;siteId:number;quantitySnapshot:string;revision:string;reason:string;verifiedBy:number;verifiedAt:string};
const base="/api/v2/inventory";
function Pager({page,size,total,onPage}:{page:number;size:number;total:number;onPage:(n:number)=>void}) {
  const last=Math.max(1,Math.ceil(total/size));
  return <div className="flex flex-wrap items-center gap-2 py-2"><span>{total?`${(page-1)*size+1}–${Math.min(page*size,total)} of ${total}`:"No records"}</span>{([["First",1,page<=1],["Previous",page-1,page<=1],["Next",page+1,page>=last],["Last",last,page>=last]] as const).map(([label,n,disabled])=><Button key={label} variant="outline" disabled={disabled} onClick={()=>onPage(n)}>{label}</Button>)}</div>;
}
function LocationPicker({kind,warehouseId,value,onChange,label}:{kind:string;warehouseId?:number;value:string;onChange:(value:string)=>void;label:string}) {
  const [q,setQ]=useState(""),[page,setPage]=useState(1);
  const query=useQuery({queryKey:[base,"locations",kind,warehouseId,q,page],queryFn:()=>requestJson<Page<Option>>("GET",`${base}/locations?kind=${kind}&q=${encodeURIComponent(q)}&page=${page}&pageSize=25${warehouseId?`&warehouseId=${warehouseId}`:""}`),placeholderData:keepPreviousData});
  const control=`location-${label.replaceAll(" ","-")}`;
  return <div className="min-w-0 space-y-2"><Label htmlFor={control}>{label}</Label><Input aria-label={`Search ${label}`} value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="Search codes or names"/>
    <select id={control} className="h-10 w-full rounded-md border bg-background px-2" value={value} onChange={e=>onChange(e.target.value)} disabled={query.isPlaceholderData||query.isPending||query.isError}><option value="">Select {label.toLowerCase()}</option>{value&&!query.data?.items.some(x=>String(x.id)===value)&&<option value={value}>Selected #{value}</option>}{query.data?.items.map(x=><option key={x.id} value={x.id}>{x.code??x.name}{x.code&&x.name?` — ${x.name}`:""} (#{x.id})</option>)}</select>
    {query.isError?<p role="alert">Locations unavailable. <Button variant="outline" onClick={()=>query.refetch()}>Retry</Button></p>:<Pager page={page} size={25} total={query.data?.total??0} onPage={setPage}/>}
  </div>;
}
function PositionHistory({position,onClose}:{position:Position;onClose:()=>void}) {
  const [page,setPage]=useState(1);
  const query=useQuery({queryKey:[base,"history",position.id,page],queryFn:()=>requestJson<Page<Evidence>>("GET",`${base}/positions/${position.id}/history?page=${page}&pageSize=25`)});
  return <Card><CardHeader><CardTitle>Reconciliation history — {position.sku}</CardTitle></CardHeader><CardContent className="space-y-3">
    <p>Historical snapshots are immutable. Location IDs identify the references verified at the time; quantities here are not current stock.</p>
    {query.isPending&&<p role="status">Loading history…</p>}{query.isError&&<p role="alert">{query.error.message} <Button onClick={()=>query.refetch()}>Retry history</Button></p>}
    {query.data?.items.map(e=><article key={e.id} className="rounded-md border p-3"><p>Site #{e.siteId} / Bin #{e.binId} · {e.quantitySnapshot} units · Revision {e.revision}</p><p>{e.reason}</p><p className="text-sm text-muted-foreground">Verified by user #{e.verifiedBy} at {new Date(e.verifiedAt).toLocaleString()}</p></article>)}
    <Pager page={page} size={25} total={query.data?.total??0} onPage={setPage}/><Button variant="outline" onClick={onClose}>Close history</Button>
  </CardContent></Card>;
}
export default function InventoryPositionsPage() {
  const [q,setQ]=useState(""),[status,setStatus]=useState("all"),[page,setPage]=useState(1),[size,setSize]=useState(25);
  const [warehouse,setWarehouse]=useState(""),[site,setSite]=useState(""),[zone,setZone]=useState(""),[code,setCode]=useState(""),[name,setName]=useState("");
  const [binCode,setBinCode]=useState(""),[aisle,setAisle]=useState(""),[bay,setBay]=useState(""),[shelf,setShelf]=useState("");
  const [selected,setSelected]=useState<Position|null>(null),[bin,setBin]=useState(""),[reason,setReason]=useState(""),[setupReason,setSetupReason]=useState(""),[message,setMessage]=useState("");
  const [history,setHistory]=useState<Position|null>(null);
  const [safety,setSafety]=useState<Position|null>(null);
  const query=useQuery({queryKey:[base,"positions",q,status,page,size],queryFn:()=>requestJson<Page<Position>>("GET",`${base}/positions?q=${encodeURIComponent(q)}&status=${status}&page=${page}&pageSize=${size}`),placeholderData:keepPreviousData});
  const mutation=useMutation({mutationFn:({path,body}:{path:string;body:unknown})=>requestJson("POST",`${base}/${path}`,body),onSuccess:async()=>{setMessage("Saved. Quantity has not changed.");setSelected(null);setReason("");await queryClient.invalidateQueries({queryKey:[base]});await queryClient.invalidateQueries({queryKey:["/api/warehouses"]});await invalidateInventoryDomain(queryClient);},onError:(error)=>setMessage(error instanceof Error?error.message:"Operation failed")});
  const save=(path:string,body:unknown)=>{setMessage("");mutation.mutate({path,body});};
  return <div className="space-y-5" data-testid="inventory-positions-page">
    <PageHeader title="Stock positions" description="Verify existing warehouse balances against normalized sites, zones and bins."/>
    <div role="note" className="rounded-md border bg-muted/30 p-4 space-y-2"><p>Location verification does not split balances or change quantities. Item-wide holds and PO receipt inspection rules are available under Safety holds after applying their migrations.</p><p>Per-bin/lot quality eligibility is not enabled. Safety holds includes a limited organization-wide PO supply enquiry, not a full dated supply/demand forecast. Item-wide safety holds override available stock to zero. Existing reservations are shown at warehouse/item level, not as bin reservations. Any stock change invalidates the reconciliation snapshot.</p><Link href="/admin/master-data/sites" className="underline">Manage canonical sites in Master Data</Link></div>
    {message&&<p role="status" className="rounded border p-3">{message}</p>}
    <details className="rounded-md border p-4"><summary className="cursor-pointer font-semibold">Location setup — warehouse permissions required</summary><div className="mt-4 grid gap-5 lg:grid-cols-3">
      <section className="space-y-3"><h2 className="font-semibold">1. Link a warehouse to a site</h2><LocationPicker kind="warehouses" value={warehouse} onChange={value=>{setWarehouse(value);setZone("");}} label="Setup warehouse"/><LocationPicker kind="sites" value={site} onChange={setSite} label="Master Data site"/>
      <Label htmlFor="site-link-reason">Reason</Label><Input id="site-link-reason" value={setupReason} onChange={e=>setSetupReason(e.target.value)}/><Button disabled={mutation.isPending||!warehouse||!site||setupReason.trim().length<5} onClick={()=>save("locations/warehouse-site",{warehouseId:Number(warehouse),siteId:Number(site),reason:setupReason})}>Link site</Button></section>
      <section className="space-y-3"><h2 className="font-semibold">2. Define a zone</h2><p>Uses the selected setup warehouse.</p><Label htmlFor="zone-code">Zone code</Label><Input id="zone-code" value={code} onChange={e=>setCode(e.target.value)}/><Label htmlFor="zone-name">Zone name</Label><Input id="zone-name" value={name} onChange={e=>setName(e.target.value)}/><Button disabled={mutation.isPending||!warehouse||!code.trim()||!name.trim()} onClick={()=>save("locations/zones",{warehouseId:Number(warehouse),code,name})}>Create zone</Button></section>
      <section className="space-y-3"><h2 className="font-semibold">3. Define or register a bin</h2>{warehouse&&<LocationPicker key={warehouse} kind="zones" warehouseId={Number(warehouse)} value={zone} onChange={setZone} label="Bin zone"/>}
      <Label htmlFor="bin-code">Bin code</Label><Input id="bin-code" value={binCode} onChange={e=>setBinCode(e.target.value)}/>{([["Aisle",aisle,setAisle],["Bay",bay,setBay],["Shelf",shelf,setShelf]] as const).map(([label,value,set])=><div key={label}><Label htmlFor={`bin-${label}`}>{label} (optional)</Label><Input id={`bin-${label}`} value={value} onChange={e=>set(e.target.value)}/></div>)}
      <Button disabled={mutation.isPending||!warehouse||!zone||!binCode.trim()} onClick={()=>save("locations/bins",{warehouseId:Number(warehouse),zoneId:Number(zone),code:binCode,...(aisle?{aisle}:{}),...(bay?{bay}:{}),...(shelf?{shelf}:{})})}>Register bin</Button></section>
    </div></details>
    <Card><CardHeader><CardTitle>Warehouse balance reconciliation</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="flex flex-wrap items-center gap-3"><Input className="max-w-md" aria-label="Search stock positions" placeholder="Search SKU, item or warehouse" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/>
      <Label htmlFor="position-state">Location state</Label><select id="position-state" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">All</option><option value="unresolved">Unresolved</option><option value="reconciled">Reconciled</option></select>
      <Label htmlFor="position-size">Rows</Label><select id="position-size" value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></div>
      {query.isPending&&<p role="status">Loading stock positions…</p>}{query.isError&&<p role="alert">{query.error.message} <Button variant="outline" onClick={()=>query.refetch()}>Retry</Button></p>}
      {query.data?.summary&&<p>{query.data.summary.reconciled} reconciled · {query.data.summary.unresolved} unresolved in the filtered results</p>}
      <p className="text-sm text-muted-foreground md:hidden">Scroll the table horizontally to view quality and actions.</p><div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stock positions table — horizontally scrollable"><table className="w-full min-w-[780px] text-left text-sm"><thead><tr>{["Item","Warehouse","On hand","Location evidence","Quality","Actions"].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{query.data?.items.map(p=><tr key={p.id} className="border-t"><td className="p-3">{p.sku}<br/>{p.name}</td><td>{p.warehouseName}</td><td>{p.onHand}</td><td>{p.locationState==="reconciled"?`${p.siteName} / ${p.zoneName} / ${p.binCode}`:`Unresolved — legacy label: ${p.legacyBin??p.legacyLocation??"none"}`}</td><td>{p.qualityState==="item_safety_hold"?"Item-wide safety hold":"Not assessed"}</td><td><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={query.isPlaceholderData} onClick={()=>{setSelected(p);setBin("");setReason("");setMessage("");}}>Verify {p.sku}</Button><Button variant="outline" onClick={()=>setSafety(p)}>Safety holds for {p.sku}</Button><Button variant="outline" onClick={()=>setHistory(p)}>History for {p.sku}</Button></div></td></tr>)}</tbody></table></div>
      <Pager page={page} size={size} total={query.data?.total??0} onPage={setPage}/>
    </CardContent></Card>
    {safety&&<ItemSafetyHolds key={safety.itemId} itemId={safety.itemId} sku={safety.sku} onClose={()=>setSafety(null)}/>}
    {history&&<PositionHistory key={history.id} position={history} onClose={()=>setHistory(null)}/>}
    {selected&&<Card><CardHeader><CardTitle>Verify {selected.sku} in {selected.warehouseName}</CardTitle></CardHeader><CardContent className="space-y-3">
      <p>Confirm all {selected.onHand} units in this warehouse balance are at the chosen bin. If stock is split across bins, do not reconcile this balance yet. This is not a physical stock count or quality release.</p>
      <LocationPicker key={selected.id} kind="bins" warehouseId={selected.warehouseId} value={bin} onChange={setBin} label="Verified bin"/>
      <Label htmlFor="position-reason">Verification evidence / reason</Label><Input id="position-reason" value={reason} onChange={e=>setReason(e.target.value)}/>
      <div className="flex flex-wrap gap-2"><Button disabled={mutation.isPending||!bin||reason.trim().length<5} onClick={()=>save(`positions/${selected.id}/reconcile`,{binId:Number(bin),revision:selected.revision,reason})}>Confirm whole-balance location</Button><Button variant="outline" onClick={()=>setSelected(null)}>Cancel verification</Button></div>
    </CardContent></Card>}
  </div>;
}
