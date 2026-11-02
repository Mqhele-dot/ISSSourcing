import assert from 'node:assert/strict';
import type {Request,Response,RequestHandler} from 'express';
import {setTimeout as pause} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {createExportDownloadRateLimiter} from '../server/modules/exports/export-download-rate-limit';
import {runWithTenantContext,type TenantContext} from '../server/organization-context';

const context=(organizationId:number,userId:number):TenantContext=>({organizationId,userId,membershipId:1,userRole:'viewer',membershipRole:'member',effectivePermissions:[],correlationId:'rate-test'});
async function call(handler:RequestHandler,organizationId:number|undefined,userId=1,ip='192.0.2.1',body:Record<string,unknown>={},sessionUser=userId){
  const req={user:{id:sessionUser},isAuthenticated:()=>sessionUser>0,ip,socket:{remoteAddress:ip},body} as unknown as Request;
  const headers:Record<string,string>={};let status=200;
  return new Promise<{status:number;headers:Record<string,string>;body?:{error:{code:string;message:string;hint?:string}}}>((resolve,reject)=>{
    const res={locals:{},headersSent:false,setHeader:(key:string,value:unknown)=>{headers[key.toLowerCase()]=String(value);},getHeader:(key:string)=>headers[key.toLowerCase()],status:(code:number)=>{status=code;return res;},json:(value:unknown)=>{resolve({status,headers,body:value as never});return res;}} as unknown as Response;
    const run=()=>Promise.resolve(handler(req,res,error=>error?reject(error):resolve({status:200,headers}))).catch(reject);
    if(organizationId===undefined)void run();else void runWithTenantContext(context(organizationId,userId),run);
  });
}
const limiter=createExportDownloadRateLimiter();
assert.equal((await call(limiter,undefined)).status,401);assert.equal((await call(limiter,1,1,'192.0.2.1',{},0)).status,401);assert.equal((await call(limiter,1,1,'192.0.2.1',{},2)).status,401);
for(let i=0;i<30;i++)assert.equal((await call(limiter,1)).status,200);
const exhausted=await call(limiter,1);assert.equal(exhausted.status,429);assert.equal(exhausted.body?.error.code,'EXPORT_DOWNLOAD_RATE_LIMITED');assert.ok(Number(exhausted.headers['retry-after'])>=1&&Number(exhausted.headers['retry-after'])<=60);assert.match(exhausted.body?.error.message??'',/wait \d+ seconds/);assert.match(exhausted.body?.error.hint??'',/do not need to generate/);
assert.equal((await call(limiter,1,2)).status,200,'Another authenticated user on the same IP has a separate retrieval budget');assert.equal((await call(limiter,2,1)).status,200,'Another tenant has a separate authenticated budget');
assert.equal((await call(limiter,1,1,'192.0.2.1',{organizationId:999,userId:999})).status,429,'Caller-supplied ownership cannot reset the real actor budget');
assert.equal((await call(limiter,1,1,'192.0.2.2')).status,429,'Changing IP cannot reset the actor budget');
const network=createExportDownloadRateLimiter({actorPoints:2,networkPoints:2,windowSeconds:1});assert.equal((await call(network,1,1)).status,200);assert.equal((await call(network,1,2)).status,200);assert.equal((await call(network,1,3)).status,429);assert.equal((await call(network,1,3,'192.0.2.9')).status,200);await pause(1100);assert.equal((await call(network,1,1)).status,200);
for(const options of [{actorPoints:0},{actorPoints:121},{networkPoints:10001},{windowSeconds:0},{windowSeconds:3601}])assert.throws(()=>createExportDownloadRateLimiter(options),/Invalid/);
const main=await readFile(new URL('../server/routes.ts',import.meta.url),'utf8'),routes=await readFile(new URL('../server/modules/exports/register-export-center-routes.ts',import.meta.url),'utf8');
assert.doesNotMatch(main,/app\.use\(["']\/api\/export(?:-jobs)?["'],\s*exportRateLimiter/,'Do not double-charge generation or charge job polling/retained files');
assert.match(main,/"\/api\/export\/:reportType\/:format",\s*exportRateLimiter/,'Legacy generation remains limited');
for(const endpoint of ['/api/export-jobs','/api/export-jobs/:id/retry','/api/export-center/custom-export']){const line=routes.split('\n').find(line=>line.includes(`app.post("${endpoint}"`));assert.ok(line?.includes('exportRateLimiter'),`${endpoint} generation remains limited once`);}
for(const endpoint of ['/api/export-jobs/:id/download-token','/api/export/download/:id']){const line=routes.split('\n').find(line=>line.includes(`"${endpoint}"`));assert.ok(line?.includes('...exportAccess, frozenSourceAccess, exportDownloadRateLimiter'),`${endpoint} retained-file limiter follows source permissions`);}
console.log(JSON.stringify({status:'passed',checks:['authenticated tenant/session ownership','30 actor requests then throttling','Retry-After and plain next action','same-IP users isolated','tenant budgets isolated','body ownership ignored','changing IP does not bypass actor budget','network abuse ceiling','expiry recovery','invalid configuration refusal','no blanket generation charging','generation handlers retain limiter','retained-file access gates precede separate limiter'],generationLimit:'Configured points unchanged; generation commands charged once, not twice. Polling does not consume generation capacity.',limitations:'Per-process memory limiter, matching the existing security infrastructure; not a distributed global quota. Route contracts supplement, not replace, the real browser gate.'}));
