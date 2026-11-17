import assert from 'node:assert/strict';
import {assertDisposableE2eEnvironment,assertDisposableE2eServer} from './e2e-database-guard.mjs';

const identity=assertDisposableE2eEnvironment();
const base=process.env.DIAGNOSTICS_TEST_URL;
assert.ok(base&&/^http:\/\/127\.0\.0\.1:\d+$/.test(base),'Use an explicit local disposable server URL');
await assertDisposableE2eServer(`${base}/api/ready`,identity);
let cookie='';
async function call(path,options={}){
  const response=await fetch(base+path,{...options,headers:{...(cookie?{cookie}:{}),...options.headers},signal:AbortSignal.timeout(20000)});
  const cookies=response.headers.getSetCookie();if(cookies.length)cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  const body=await response.json();return {status:response.status,body};
}
assert.equal((await call('/api/diagnostics/history')).status,401);
const csrf=await call('/api/csrf-token');
const login=await call('/api/login',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf.body.csrfToken??csrf.body.data?.csrfToken},body:JSON.stringify({username:'admin',password:'Admin123!'})});
assert.equal(login.status,200,'Disposable admin sign-in failed');
for(const category of ['overview','user-errors','frontend','backend','business','integrations','consistency','notifications','security','audit']){
  const r=await call(`/api/diagnostics/findings?category=${category}`);assert.equal(r.status,200,category);assert.equal(r.body.category,category);assert.ok(Array.isArray(r.body.findings));
  assert.ok(r.body.findings.every(row=>row.id&&row.code&&row.status&&row.message));
  console.log(`PASS findings ${category}: ${r.body.findings.length}`);
}
for(const size of [25,50,100]){
  const r=await call(`/api/diagnostics/history?page=1&pageSize=${size}`);assert.equal(r.status,200);assert.ok(r.body.items.length<=size);assert.ok(r.body.schedules.length>0);assert.ok(r.body.items.every(row=>row.lifecycle&&row.lastSeen));
}
for(const path of ['/api/diagnostics/findings?category=invalid','/api/diagnostics/history?page=0','/api/diagnostics/history?pageSize=999','/api/diagnostics/history?unknown=true','/api/diagnostics/daily-summaries?pageSize=999'])assert.equal((await call(path)).status,400,path);
for(const path of ['/api/diagnostics/summary','/api/diagnostics/module-health','/api/diagnostics/snapshot','/api/v2/diagnostics/scan','/api/v2/diagnostics/capability-coverage'])assert.equal((await call(path)).status,200,path);
const daily=await call('/api/diagnostics/daily-summaries');assert.equal(daily.status,200);
assert.ok(daily.body.items.every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.localDate)&&row.generatedAt&&row.timezone));
console.log('PASS anonymous denial, all workspaces, history pagination, invalid-input responses, shared health, snapshot, scan, catalog and dated summaries. No business commands executed.');
