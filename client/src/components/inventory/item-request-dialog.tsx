import { useState, type ChangeEvent } from 'react';
import { useMutation,useQuery } from '@tanstack/react-query';
import { requestJson,queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
type RequestRow={id:number;sku:string;name:string;status:string;itemId:number|null};
export function ItemRequestDialog() {
  const [open,setOpen]=useState(false),[sku,setSku]=useState(''),[name,setName]=useState(''),[reason,setReason]=useState(''),[page,setPage]=useState(1);
  const [requestKey,setKey]=useState(()=>crypto.randomUUID());
  const path='/api/v2/inventory/item-requests';
  const list=useQuery({queryKey:[path,page],enabled:open,queryFn:()=>requestJson<{items:RequestRow[];total:number}>('GET',`${path}?page=${page}&pageSize=25`)});
  const save=useMutation({mutationFn:()=>requestJson<{id:number}>('POST',path,{sku,name,reason,requestKey}),onSuccess:async()=>{setSku('');setName('');setReason('');setKey(crypto.randomUUID());setPage(1);await queryClient.invalidateQueries({queryKey:[path]});}});
  const change=(setter:(s:string)=>void)=>(event:ChangeEvent<HTMLInputElement>)=>{setter(event.target.value);setKey(crypto.randomUUID());save.reset();};
  return <><Button variant="outline" onClick={()=>setOpen(true)}>Request New Item</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Request a new inventory item</DialogTitle><DialogDescription>A request creates no item or stock. Master Data reviewers approve it independently. An authorized maintainer supplies the unit and commercial details, creates the item with zero stock, then applies the approved request to link it.</DialogDescription></DialogHeader>
    <label>Proposed SKU (required)<Input disabled={save.isPending} value={sku} onChange={change(setSku)} maxLength={100}/></label>
    <label>Item name (required)<Input disabled={save.isPending} value={name} onChange={change(setName)} maxLength={200}/></label>
    <label>Business reason (at least 10 characters)<Input disabled={save.isPending} value={reason} onChange={change(setReason)} maxLength={2000}/></label>
    <Button disabled={save.isPending||!sku.trim()||name.trim().length<2||reason.trim().length<10} onClick={()=>save.mutate()}>Submit item request</Button>
    {save.isError&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">Request #{save.data.id} sent to the Master Data approval queue.</p>}
    <h2 className="font-semibold">Your requests</h2>
    {list.isPending&&<p role="status">Loading requests…</p>}{list.isError&&<p role="alert">{list.error.message} <Button variant="outline" onClick={()=>list.refetch()}>Retry</Button></p>}
    {list.data?.items.map(row=><article key={row.id} className="rounded border p-2 text-sm"><p>#{row.id} · {row.sku} — {row.name}</p><p>{row.status.replaceAll('_',' ')}{row.itemId?` · linked item #${row.itemId}`:''}</p></article>)}
    {list.data?.total===0&&<p>No requests yet.</p>}
    <div className="flex items-center gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page} · {list.data?.total??0} requests</span><Button variant="outline" disabled={!list.data||page*25>=list.data.total} onClick={()=>setPage(page+1)}>Next</Button></div>
  </DialogContent></Dialog></>;
}
