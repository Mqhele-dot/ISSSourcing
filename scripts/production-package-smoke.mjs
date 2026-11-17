import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { assertDisposableE2eEnvironment } from "./e2e-database-guard.mjs";

export async function smokeProductionPackage(env) {
  assertDisposableE2eEnvironment(env);
  // Match the browser runner's 120s startup budget. The Windows runtime
  // fallback has demonstrated an 83s cold start; keep that duration visible.
  const startupTimeoutMs=Number(env.PRODUCTION_SMOKE_STARTUP_TIMEOUT_MS??120000);
  if(!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1000||startupTimeoutMs>300000)throw new Error("Production smoke startup timeout must be 1000–300000 milliseconds.");
  const reservation=net.createServer();
  await new Promise((resolve,reject)=>reservation.once("error",reject).listen(0,"127.0.0.1",resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,["dist/index.js"],{env:{...env,NODE_ENV:"production",RUNTIME_DEPLOYMENT:"hosted",
    HOST:"127.0.0.1",PORT:String(port),SESSION_SECRET:randomBytes(48).toString("hex"),
    INTERNAL_EXPORT_TOKEN:randomBytes(48).toString("hex"),AUTO_SEED_ON_EMPTY_DB:"false",ALLOW_DEV_BOOTSTRAP:"false"},stdio:["ignore","pipe","pipe"]});
  let exited=false;
  child.once("exit",()=>{exited=true;});
  // Retain only structured severity labels, never log bodies, SQL or environment.
  const startupLevels=[];
  const startupStages=new Map();
  const processStarted=Date.now();
  for(const stream of [child.stdout,child.stderr]) {
    let pending="";
    stream.on("data",chunk=>{
      pending=(pending+chunk.toString()).slice(-16384);
      const lines=pending.split(/\r?\n/); pending=lines.pop()??"";
      for(const line of lines)try {
        const entry=JSON.parse(line);
        if(["error","warn","info"].includes(entry.level))startupLevels.push(entry.level);
        for(const [pattern,stage] of [[/^Database pool initialized$/,"pool_initialized"],[/^Database connection successful$/,"database_connected"],[/^Server listening$/,"listening"]]) {
          if(pattern.test(String(entry.message))&&!startupStages.has(stage))startupStages.set(stage,Date.now()-processStarted);
        }
        if(startupLevels.length>20)startupLevels.shift();
      } catch {}
    });
  }
  const base=`http://127.0.0.1:${port}`;
  const startupStarted=Date.now();
  try {
    let ready=false;
    let lastReadyStatus="not_reachable";
    while(Date.now()-startupStarted<startupTimeoutMs) {
      if(exited)throw new Error("Built production process exited before readiness.");
      try { const response=await fetch(`${base}/api/ready`,{signal:AbortSignal.timeout(2000)}); lastReadyStatus=String(response.status); if(response.ok){ready=true;break;} } catch {}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error(`Production readiness deadline exceeded (last HTTP status: ${lastReadyStatus}; startup stages: ${JSON.stringify(Object.fromEntries(startupStages))}; structured startup levels: ${startupLevels.join(",")||"none"}). No raw server output was exposed.`);
    const startup=await fetch(`${base}/api/startup-diagnostics`,{signal:AbortSignal.timeout(10000)});
    const startupBody=await startup.json();
    if(!startup.ok || startupBody.ok!==true || 'events' in startupBody || startupBody.startupFailure!==null
      || Object.keys(startupBody.readiness??{}).some(key=>!["dbReady","schemaReady","sessionStoreReady","websocketReady"].includes(key)))
      throw new Error("Public startup diagnostics exposed an unsupported response or failed readiness.");
    const auth=await fetch(`${base}/auth`,{signal:AbortSignal.timeout(10000)});
    const html=await auth.text();
    if(!auth.ok || !html.includes('<html'))throw new Error("Production login shell unavailable.");
    const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match=>match[1]);
    if(!assets.length)throw new Error("Production shell has no packaged assets.");
    let productionReactVerified=false;
    for(const asset of assets) {
      const response=await fetch(base+asset,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error("Packaged asset unavailable.");
      if(/\/vendor-react-[^/]+\.js$/.test(asset)) {
        const body=await response.text();
        if(body.includes('react.development.js')||body.includes('react-dom.development.js'))throw new Error("Production package contains a development React runtime. Rebuild with production settings.");
        if(body.includes('Minified React error'))productionReactVerified=true;
      }
    }
    if(!productionReactVerified)throw new Error("Production React runtime could not be verified from packaged assets.");
    if((await fetch(`${base}/api/user`,{signal:AbortSignal.timeout(10000)})).status!==401)throw new Error("Anonymous protected API did not deny access.");
    const evidence={status:"passed",generatedAt:new Date().toISOString(),durationMs:Date.now()-startupStarted,startupTimeoutMs,
      startupStagesMs:Object.fromEntries(startupStages),checks:["readiness","login_shell","packaged_assets","production_react_runtime","anonymous_api_denial"],assetCount:assets.length};
    console.log(`Production profile smoke passed in ${evidence.durationMs}ms (budget ${startupTimeoutMs}ms; startup stages ${JSON.stringify(evidence.startupStagesMs)}): migrations-only startup, readiness, login shell, packaged assets and anonymous denial.`);
    return evidence;
  } finally {
    if(!exited) { const stopped=new Promise(resolve=>child.once("exit",resolve)); child.kill(); await stopped; }
  }
}
