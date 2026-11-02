import { randomUUID, createHash } from "node:crypto";
import { pool } from "../db";
import { getOptionalTenantContext } from "../organization-context";
import { diagnosticStorageReady, persistDiagnosticChecks } from "./persistent-findings";
import { setDiagnosticEventSink, type ServerDiagnosticEvent } from "./server-diagnostics-store";

let pending=0;
const captureGaps=new Map<number,number>();
export function recordDiagnosticCaptureGap(organizationId:number){
  if(Number.isSafeInteger(organizationId)&&organizationId>0)
    captureGaps.set(organizationId,(captureGaps.get(organizationId)??0)+1);
}
export function captureGapFinding(organizationId:number) {
  const count=captureGaps.get(organizationId)??0;
  if(!count)return null;
  const timestamp=new Date().toISOString();
  return {
    id:`backend:DIAGNOSTIC_CAPTURE_GAP:${organizationId}`,category:"backend" as const,code:"DIAGNOSTIC_CAPTURE_GAP",
    resourceKey:"diagnostic-capture",title:"Some diagnostic events may be missing",
    message:"Monitoring detected incidents that could not be stored. Database outages and process termination can lose in-flight diagnostic evidence.",
    severity:"warning" as const,status:"degraded" as const,firstSeen:timestamp,lastSeen:timestamp,occurrences:count,
    evidenceState:"current" as const,targetRoute:"/admin/system-diagnostics",evidence:{missedEvents:count},
  };
}
export function clearCaptureGap(organizationId:number){captureGaps.delete(organizationId);}
export function startDurableDiagnosticCapture() {
  setDiagnosticEventSink(event=>{
    if(event.severity!=="error" && event.severity!=="critical")return;
    const context=getOptionalTenantContext();
    const details=event.details && typeof event.details==="object" ? event.details as Record<string,unknown> : {};
    const org=context?.organizationId ?? Number(details.organizationId);
    if(!Number.isSafeInteger(org)||org<1)return; // Never infer a tenant for global events.
    if(pending>=50){captureGaps.set(org,(captureGaps.get(org)??0)+1);return;}
    pending++;
    void persistEvent(org,event).catch(()=>{
      captureGaps.set(org,(captureGaps.get(org)??0)+1);
      console.warn("Diagnostic event capture unavailable; a monitoring evidence gap was recorded in memory.");
    }).finally(()=>{pending--;});
  });
}

async function persistEvent(org:number,event:ServerDiagnosticEvent) {
  const client=await pool.connect();
  try {
    if(!await diagnosticStorageReady(client))throw new Error("Diagnostic schema unavailable");
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'");
    const route=(event.route??"unknown").split('?')[0].slice(0,200);
    const resourceKey=createHash('sha256').update(`${event.source}|${event.method??""}|${route}`).digest('hex');
    const details=event.details && typeof event.details==="object" ? event.details as Record<string,unknown> : {};
    const incident={
      id:event.id,category:"backend",code:"OBSERVED_FAILURE",resourceKey,title:"Application action failed",
      message:"An application action failed. Use the request reference to investigate; recovery has not been verified.",
      severity:event.severity,status:"failed",firstSeen:event.timestamp,lastSeen:event.timestamp,occurrences:1,
      evidenceState:"current",requestId:typeof details.requestId==="string"?details.requestId:undefined,
      evidence:{source:event.source,captureGap:captureGaps.get(org)??0},
    } as const;
    const gap=captureGapFinding(org);
    await persistDiagnosticChecks(client,org,randomUUID(),gap?[incident,gap]:[incident]);
    await client.query("COMMIT");
    captureGaps.delete(org);
  } catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally {client.release();}
}
