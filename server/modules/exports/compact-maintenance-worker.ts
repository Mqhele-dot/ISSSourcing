import type {Pool} from 'pg';
import type {Server} from 'node:http';
import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {expireCompactLeases} from './compact-export-leases';
import {listCompactCleanupCandidates,cleanupCompactWorkspace} from './compact-workspaces';

type Storage={root:string;storageId:string};
/** Explicit private-storage configuration only. Never discover ownership by
 * scanning a disk, and never clean operational uploads or source documents.
 * Each call is bounded; database cleanup claims arbitrate multiple processes.
 */
export async function runCompactMaintenanceCycle(database:Pool,input:Storage){
  const expired=await expireCompactLeases(database),candidates=await listCompactCleanupCandidates(database,{...input,limit:25});
  let removed=0,blocked=0,skipped=0;
  for(const candidate of candidates){
    const result=await cleanupCompactWorkspace(database,{...input,workspaceId:candidate.id,organizationId:candidate.organization_id});
    if(result.status==='removed')removed++;else if(result.status==='blocked')blocked++;else skipped++;
  }
  return {expired,checked:candidates.length,removed,blocked,skipped};
}

/** Opt-in bootstrap primitive, disabled by default in application startup. Uses
 * production scheduling code in isolated tests; no operational writes, providers
 * or generation. Errors go to the supplied sanitized diagnostics/log callback.
 */
export function startCompactMaintenanceWorker(database:Pool,input:Storage,options:{intervalMs?:number;onResult?:(result:Awaited<ReturnType<typeof runCompactMaintenanceCycle>>)=>void;onFailure:()=>void}){
  const intervalMs=options.intervalMs??60_000;
  if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>3600000)throw new Error('Choose a maintenance interval between one second and one hour.');
  let stopped=false,pending:Promise<void>|undefined;
  const tick=()=>{
    if(stopped||pending)return;
    pending=(async()=>{try{const result=await runCompactMaintenanceCycle(database,input);options.onResult?.(result);}catch{try{options.onFailure();}catch{/* Never recursively report diagnostics failures. */}}finally{pending=undefined;}})();
  };
  const timer=setInterval(tick,intervalMs);timer.unref();tick();
  return {async stop(){stopped=true;clearInterval(timer);await pending;}};
}

/** Bootstrap integration stays OFF by default and never applies migrations.
 * Enabling housekeeping is separate from enabling Compact generation/routes.
 * Mixed browser suites also need an explicit isolated-test worker opt-in.
 */
export async function startConfiguredCompactMaintenanceWorker(database:Pool,server:Server,env:NodeJS.ProcessEnv,options:{onFailure:()=>void;onResult?:(result:Awaited<ReturnType<typeof runCompactMaintenanceCycle>>)=>void}){
  if(env.ENABLE_COMPACT_EXPORT_MAINTENANCE!=='1'||env.LOCAL_TEST_API_ONLY==='1'||env.NODE_ENV==='test'&&env.ENABLE_TEST_COMPACT_MAINTENANCE!=='1')return;
  const root=env.COMPACT_PRIVATE_STORAGE_ROOT,storageId=env.COMPACT_PRIVATE_STORAGE_ID;
  if(!root||!path.isAbsolute(root)||!storageId||!/^[A-Za-z0-9-]{1,100}$/.test(storageId))throw new Error('Compact housekeeping requires a configured absolute private root and storage identity.');
  let handle:ReturnType<typeof startCompactMaintenanceWorker>|undefined,closed=false;
  const stop=()=>{closed=true;void handle?.stop();};server.once('close',stop);
  try{
    const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Compact housekeeping requires a real private directory.');
    const ready=await database.query(`SELECT to_regclass('public.compact_export_attempts') IS NOT NULL
      AND to_regclass('public.compact_export_workspaces') IS NOT NULL AND to_regclass('public.audit_logs') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.compact_retry_command_uidx') AND indisvalid AND indisready) AS ready`);
    if(!ready.rows[0]?.ready)throw new Error('Install the separately approved Compact lifecycle migrations before enabling housekeeping.');
    const canonicalRoot=await realpath(root);if(closed)return;
    handle=startCompactMaintenanceWorker(database,{root:canonicalRoot,storageId},options);return handle;
  }finally{if(!handle)server.off('close',stop);}
}
