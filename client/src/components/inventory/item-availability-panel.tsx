import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requestJson } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { APP_ROUTES } from '@/lib/routes/app-routes';
type Availability={onHand:string;masterQuantity:string;unassignedQuantity:string;reserved:string;availableNow:string;datedInbound:string;undatedInbound:string;inspectionInbound:string;knownProjectedAvailable:string|null;reconciled:boolean;itemHeld:boolean;total:number;notice:string;reservationTiming:string;items:Array<{poLineId:number;poId:number;poNumber:string;expectedDate:string|null;quantity:string;inspectionRequired:boolean}>};
export function ItemAvailabilityPanel({itemId}:{itemId:number}) {
  const [open,setOpen]=useState(false),[through,setThrough]=useState(()=>new Date().toISOString().slice(0,10)),[page,setPage]=useState(1);
  const query=useQuery({queryKey:['item-availability',itemId,through,page],enabled:open&&!!through,queryFn:()=>requestJson<Availability>('GET',`/api/v2/inventory/items/${itemId}/availability?through=${encodeURIComponent(through)}&page=${page}&pageSize=25`)});
  const data=query.data;
  return <section className="min-w-0 rounded border p-3"><Button className="h-auto max-w-full whitespace-normal text-left" variant="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>Availability and inbound evidence</Button>{open&&<div className="mt-3 space-y-3 text-sm">
    <label className="block">Project through (inclusive)<Input type="date" value={through} onChange={e=>{setThrough(e.target.value);setPage(1);}}/></label>
    {!through&&<p role="status">Choose a date to calculate availability.</p>}
    {!!through&&query.isPending&&<p role="status">Loading availability…</p>}{query.isError&&<p role="alert">{query.error.message} <Button variant="outline" onClick={()=>query.refetch()}>Retry</Button></p>}
    {!!through&&<Button variant="outline" disabled={query.isFetching} onClick={()=>query.refetch()}>Refresh availability</Button>}
    {query.isFetching&&!query.isPending&&<p role="status">Refreshing availability…</p>}
    {data&&<>
      {!data.reconciled&&<p role="alert">Unreconciled item/warehouse totals: {data.unassignedQuantity} units. Projection is unavailable until these are reconciled.</p>}
      {data.itemHeld&&<p role="status">Item-wide hold is active. Available quantity remains zero; reservations are not subtracted again.</p>}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">{Object.entries({'Warehouse on hand':data.onHand,'Active reservations':data.reserved,'Available now':data.availableNow,'Dated inbound by horizon':data.datedInbound,'Undated inbound (excluded)':data.undatedInbound,'Inspection inbound (excluded)':data.inspectionInbound,'Known projected available':data.knownProjectedAvailable??'Reconciliation required'}).map(([label,value])=><div key={label} className="rounded border p-2"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl>
      <p>{data.reservationTiming}</p><p>{data.notice}</p>
      <h3 className="font-semibold">All open inbound PO lines</h3>
      {data.items.map(line=><article className="rounded border p-2" key={line.poLineId}><a className="underline" href={`${APP_ROUTES.procurement.orders}/${encodeURIComponent(line.poNumber)}`}>{line.poNumber}</a><p>Line #{line.poLineId} · {line.quantity} remaining · {line.expectedDate?new Date(line.expectedDate).toLocaleDateString():'No delivery date'}{line.inspectionRequired?' · Inspection required':''}</p></article>)}
      {data.total===0&&<p>No approved open inbound lines.</p>}
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page} · {data.total} lines</span><Button variant="outline" disabled={page*25>=data.total} onClick={()=>setPage(page+1)}>Next</Button></div>
    </>}
  </div>}</section>;
}
