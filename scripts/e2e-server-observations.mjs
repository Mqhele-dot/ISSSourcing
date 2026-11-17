import {appendFileSync,mkdirSync} from "node:fs";
import path from "node:path";

export function sanitizeServerObservation(line){
  let event;try{event=JSON.parse(line);}catch{return null;}
  if(!event||typeof event!=="object"||Array.isArray(event))return null;
  if(!["info","warn","error"].includes(event.level))return null;
  const meta=event.meta??{},safe={level:event.level};
  if(typeof event.timestamp==="string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(event.timestamp))safe.timestamp=event.timestamp;
  const known=["HTTP request completed","Database pool initialized","Database connection successful","Server listening","E2E owned server spawned","Analytics observation timing"];
  safe.event=known.includes(event.message)?event.message:"Other structured server event";
  if(event.message==="E2E owned server spawned"){
    if(["source","built"].includes(meta.runtimeMode))safe.runtimeMode=meta.runtimeMode;
    if(["server/index.ts","dist/index.js"].includes(meta.entryPoint))safe.entryPoint=meta.entryPoint;
    if(Number.isSafeInteger(meta.pid)&&meta.pid>0)safe.pid=meta.pid;
  }
  if(typeof meta.requestId==="string" && /^[a-z0-9-]{1,100}$/i.test(meta.requestId))safe.requestId=meta.requestId;
  if(["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"].includes(meta.method))safe.method=meta.method;
  if(typeof meta.route==="string" && !/[\\\r\n]/.test(meta.route) && /^\/(?:api\/|auth(?:$|[?#])|health(?:$|\/))/.test(meta.route))
    safe.route=meta.route.split(/[?#]/)[0].slice(0,240);
  if(Number.isInteger(meta.status)&&meta.status>=100&&meta.status<=599)safe.status=meta.status;
  if(Number.isFinite(meta.durationMs)&&meta.durationMs>=0)safe.durationMs=meta.durationMs;
  if(typeof meta.errorCode==="string" && /^[A-Z0-9_]{1,100}$/.test(meta.errorCode))safe.errorCode=meta.errorCode;
  if(event.message==="Analytics observation timing"&&Array.isArray(meta.sourceTimings)){
    const sources=new Set(["filter_suppliers","filter_warehouses","filter_categories","filter_departments","filter_owners","procurement","procurement_pipeline","requisition_pipeline","supplier_spend","category_spend","inventory","logistics","finance","exceptions","supplier_risk","operations_trend"]);
    safe.sourceTimings=meta.sourceTimings.slice(0,16).flatMap(t=>{
      if(!t||!sources.has(t.source)||!["passed","failed","denied","unsupported","retired"].includes(t.state))return [];
      const timing={source:t.source,state:t.state};
      for(const field of ["poolWaitMs","executionMs","transactionMs","totalMs"])if(Number.isFinite(t[field])&&t[field]>=0&&t[field]<=86400000)timing[field]=t[field];
      if(Number.isSafeInteger(t.rows)&&t.rows>=0)timing.rows=t.rows;
      return [timing];
    });
  }
  return safe;
}

export function createServerObservationLog(file){
  if(!file)return {consume(){},finish(){}};
  const root=path.resolve("artifacts","release-runs"),target=path.resolve(file);
  const relative=path.relative(root,target);
  if(relative.startsWith("..")||path.isAbsolute(relative)||path.basename(target)!=="server-observations.jsonl")
    throw new Error("Server evidence must stay in the release artifact directory");
  mkdirSync(path.dirname(target),{recursive:true});
  const pending=new Map();let failed=false;
  const save=line=>{const safe=sanitizeServerObservation(line);if(safe)try{appendFileSync(target,JSON.stringify(safe)+"\n");}catch{failed=true;}};
  return {
    consume(chunk,channel="stdout"){const lines=((pending.get(channel)??"")+chunk.toString()).split(/\r?\n/);
      const tail=lines.pop()??"";pending.set(channel,tail.length>65536?"":tail);
      for(const line of lines)save(line);if(tail.length>65536)failed=true;},
    finish(){for(const tail of pending.values())if(tail)save(tail);pending.clear();if(failed)throw new Error("Sanitized server evidence is incomplete");},
  };
}
