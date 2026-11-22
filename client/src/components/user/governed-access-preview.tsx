import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {requestJson,errorMessageWithRequestId,queryClient} from "@/lib/queryClient";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {SodAnalysis,SodAnalyze} from "@shared/procurement-governance";
type Command={kind:"grant"|"assign"|"role";roleId?:number;userId?:number;role?:SodAnalyze["role"];customRoleId?:number|null;grant?:{resource:string;permissionType:string};enabled?:boolean;isActive?:boolean};
type Preview={before:SodAnalysis;after:SodAnalysis;command:Command;key:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void};
export function useGovernedAccessPreview(){
 const context=useQuery<{enabled:boolean}>({queryKey:["sod-editor-context"],queryFn:()=>requestJson("GET","/api/v2/admin/sod/context"),retry:false});
 const [preview,setPreview]=useState<Preview|null>(null),[reason,setReason]=useState(""),[failure,setFailure]=useState<string|null>(null),[saving,setSaving]=useState(false);
 const change=async(command:Command):Promise<unknown>=>{
  const beforeInput:SodAnalyze=command.kind==="assign"?{kind:"user",userId:command.userId}:{kind:"role",role:"custom",customRoleId:command.roleId};
  const before=await requestJson<SodAnalysis>("POST","/api/v2/admin/sod/analyze",beforeInput);
  let proposed:SodAnalyze=beforeInput;
  if(command.kind==="assign")proposed={...beforeInput,proposedRole:command.role,proposedCustomRoleId:command.customRoleId};
  if(command.kind==="role")proposed={...beforeInput,proposedActive:command.isActive};
  if(command.kind==="grant"){
   const keys=new Set(before.permissions),key=`${command.grant!.resource}:${command.grant!.permissionType}`;
   if(command.enabled)keys.add(key);else keys.delete(key);
   proposed={...beforeInput,proposedGrants:[...keys].map(k=>{const[resource,permissionType]=k.split(":");return {resource,permissionType};}) as SodAnalyze["proposedGrants"]};
  }
  const after=await requestJson<SodAnalysis>("POST","/api/v2/admin/sod/analyze",proposed);
  setFailure(null);setReason("");return new Promise((resolve,reject)=>setPreview({before,after,command,key:crypto.randomUUID(),resolve,reject}));
 };
 const cancel=()=>{if(saving)return;preview?.reject(new Error("Access change cancelled; no changes applied."));setPreview(null);};
 const blocked=preview?.after.conflicts.filter(c=>!c.exception_id&&c.enforcement_mode!=="WARN"&&!preview.before.conflicts.some(p=>p.code===c.code))??[];
 const dialog=<Dialog open={Boolean(preview)} onOpenChange={open=>{if(!open)cancel();}}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Review proposed access</DialogTitle><DialogDescription>No permissions change until you confirm. The server rechecks current revisions and conflicts.</DialogDescription></DialogHeader>
  <p className="break-words">{preview?.before.label}</p>
  {preview?.after.conflicts.length?preview.after.conflicts.map(c=><div className="space-y-1 rounded border p-3" key={c.code}><p>{c.severity}: {c.name}</p><p className="text-sm break-words">{c.permissions.join(" + ")}</p><p>{c.explanation}</p><p>{c.mitigation}</p>{c.exception_id?<p>Mitigated until {c.exception_expires_at}</p>:null}</div>):<p>No configured conflict found. This is not financial approval.</p>}
  {blocked.length?<p role="alert">This change introduces an unmitigated conflict. Separate the permissions or request an allowed mitigation in Segregation of duties.</p>:null}
  <label>Change reason<Input aria-label="Access change reason" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  {failure?<p role="alert">{failure}</p>:null}
  <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={saving} onClick={cancel}>Cancel access change</Button><Button disabled={saving||blocked.length>0||reason.trim().length<5} onClick={async()=>{
   if(!preview)return;setSaving(true);try{const result=await requestJson("POST","/api/v2/admin/sod/commands",{...preview.command,revision:preview.before.revision,reason},{headers:{"Idempotency-Key":preview.key}});
    await queryClient.invalidateQueries({queryKey:["/api/v2/admin/sod"]});preview.resolve(result);setPreview(null);
   }catch(error){setFailure(errorMessageWithRequestId(error));}finally{setSaving(false);}
  }}>Confirm access change</Button></div>
 </DialogContent></Dialog>;
 return {enabled:context.data?.enabled===true,loading:context.isLoading,change,dialog};
}
