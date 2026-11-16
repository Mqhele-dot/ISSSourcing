import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,readdir,readFile,writeFile,lstat} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import express from "express";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {resolveRequestId,sendError} from "../server/api-response";
if(!process.argv.includes("--local-disposable"))throw new Error("Use --local-disposable; business databases are forbidden.");
const failureMode=process.argv.find(arg=>arg.startsWith("--inject-failure="))?.split("=")[1]??"none";
if(!["none","membership-query","permission-query","membership-connect","cleanup-pool","hard-stop"].includes(failureMode))throw new Error("Unknown controlled failure mode; no resources created.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured);const url=new URL(configured);assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));url.pathname="/postgres";
const name=`iss_document_test_${randomUUID().replaceAll("-","")}`,temporaryParent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(temporaryParent,"iss-document-source-")),runId=randomUUID();
const identity={version:1,runId,database:name,uploadRoot:root};
const owner=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});let created=false,database:pg.Pool|undefined,server:ReturnType<express.Express["listen"]>|undefined;
let originalFailure:unknown,suitePassed=false,boundaryFailures=0,identityWritten=false;
try{
  console.log(JSON.stringify({kind:"document-runtime-identity",...identity}));
  await writeFile(path.join(root,".runtime-owner.json"),JSON.stringify(identity),{flag:"wx",mode:0o600});identityWritten=true;
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;
  console.log(JSON.stringify({kind:"document-runtime-database-created",runId,database:name}));
  url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());
  process.env.DATABASE_URL=url.toString();process.env.TEST_DATABASE_URL=url.toString();process.env.TEST_UPLOADS_DIR=root;process.env.NODE_ENV="test";
  database=(await import("../server/db")).pool;assert.equal((await database.query("SELECT current_database() AS name")).rows[0].name,name);
  await database.query("CREATE TABLE _document_runtime_owner(run_id text PRIMARY KEY)");
  await database.query("INSERT INTO _document_runtime_owner VALUES($1)",[runId]);
  await database.query(`CREATE TABLE organizations(id int PRIMARY KEY,active boolean);INSERT INTO organizations VALUES(1,true),(2,true);
    CREATE TABLE users(id int PRIMARY KEY,active boolean,warehouse_id int,username text,email text,full_name text);INSERT INTO users VALUES(1,true,null,'admin','admin@example.test','Admin'),(2,true,null,'foreign','foreign@example.test','Foreign'),(3,true,null,'portal','private-portal@example.test','Portal');
    CREATE TABLE organization_members(id int PRIMARY KEY,organization_id int,user_id int,active boolean,status text,application_role text);INSERT INTO organization_members VALUES(1,1,1,true,'active','admin'),(2,2,2,true,'active','admin'),(3,1,3,true,'active','supplier');
    CREATE TABLE permissions(id serial PRIMARY KEY,role text,resource text,permission_type text);
    INSERT INTO permissions(role,resource,permission_type) VALUES('viewer','documents','read'),('viewer','suppliers','read'),('viewer','suppliers','update'),('viewer','purchases','read');
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int);INSERT INTO suppliers VALUES(10,1),(20,2);
    CREATE TABLE purchase_orders(id int PRIMARY KEY,organization_id int,supplier_id int,order_number text,email_sent_date timestamp,created_at timestamp,created_by_user_id int);
    CREATE TABLE purchase_requisitions(id int PRIMARY KEY,organization_id int);CREATE TABLE invoices(id int PRIMARY KEY,organization_id int);
    CREATE TABLE warehouses(id int PRIMARY KEY,organization_id int);CREATE TABLE supplier_contracts(id int PRIMARY KEY,organization_id int);
    CREATE TABLE documents(id serial PRIMARY KEY,organization_id int,entity_type text,entity_id int,file_url text,file_name text,mime_type text,file_size int,checksum text,version int DEFAULT 1,uploaded_by int,uploaded_at timestamp DEFAULT now(),archived_at timestamp,last_verified_at timestamp);
    INSERT INTO documents(organization_id,entity_type,entity_id,file_url,file_name) SELECT 1,'supplier',10,'/uploads/documents/legacy-'||n||'.txt','Legacy source '||n FROM generate_series(1,5000)n;
    INSERT INTO documents(organization_id,entity_type,entity_id,file_url,file_name) VALUES(2,'supplier',20,'/uploads/documents/foreign.txt','FOREIGN-PRIVATE'),(1,'supplier',20,'/uploads/documents/orphan.txt','ORPHAN-PRIVATE');
    CREATE TABLE audit_logs(id serial PRIMARY KEY,organization_id int,user_id int,action text,resource_type text,resource_id int,details jsonb,reason text,previous_hash text,event_hash text,hash_version int,request_id text,ip_address text,user_agent text,created_at timestamptz);
    CREATE TABLE supplier_portal_mappings(id serial PRIMARY KEY,organization_id int,supplier_id int,user_id int,active boolean,created_by_user_id int,updated_at timestamp,UNIQUE(organization_id,user_id));
    CREATE TABLE sourcing_invitations(id int,organization_id int,supplier_id int,event_id int,invited_at timestamp,status text,invited_by_user_id int);
    CREATE TABLE supplier_quotes(id int,organization_id int,supplier_id int,event_id int,created_at timestamp,status text,submitted_by_user_id int);
    CREATE TABLE supplier_communication_events(id int,organization_id int,supplier_id int,source_type text,source_id int,occurred_at timestamp,status text,error_summary text,actor_user_id int);
    CREATE TABLE po_supplier_confirmations(id int,organization_id int,supplier_id int,purchase_order_id int,created_at timestamp,status text,actor_user_id int);
    CREATE TABLE supplier_communication_notes(id serial PRIMARY KEY,organization_id int,supplier_id int,actor_user_id int,occurred_at timestamp DEFAULT now(),channel text,summary text,document_id int);
    CREATE TABLE retention_policies(id serial PRIMARY KEY,document_type text,retention_years int,is_active boolean DEFAULT true);`);
  const {runWithTenantContext}=await import("../server/organization-context");const {queryRolePermission}=await import("../server/services/permission-query-service");
  const {registerDocumentRoutes}=await import("../server/modules/documents/register-document-routes");const {registerSupplierRoutes}=await import("../server/modules/suppliers/register-supplier-routes");
  const {mountUploadsStatic}=await import("../server/http/upload-config");const {documentPage}=await import("../server/modules/documents/document-evidence");
  const {runDocumentRetention}=await import("../server/modules/documents/document-retention");
  const app=express();app.use(express.json());app.use((_req,res,next)=>{resolveRequestId(res);next();});mountUploadsStatic(app);
  app.use(async(req,res,next)=>{
    try {
      res.locals.fixtureStage="membership";
      if(failureMode==="membership-connect")await Promise.reject(Object.assign(new Error("Synthetic connection dependency rejection"),{code:"ETIMEDOUT"}));
      const org=Number(req.get("Org")??1);const membership=(await database!.query("SELECT application_role FROM organization_members WHERE id=$1",[org])).rows[0];
      assert.ok(membership,"Synthetic membership required");Object.assign(req,{user:{id:org,role:membership.application_role}});
      runWithTenantContext({organizationId:org,userId:org,membershipId:org,userRole:membership.application_role,membershipRole:"member",effectivePermissions:[],correlationId:resolveRequestId(res)},next);
    }catch(error){next(error);}
  });
  const allow:express.RequestHandler=(_q,_r,next)=>next();
  const auth={ensureAuthenticated:allow,ensureTwoFactorAuthenticated:allow,ensureRole:(roles:string[])=>(req:express.Request,res:express.Response,next:express.NextFunction)=>roles.includes((req as any).user.role)?next():res.status(403).json({message:"Role denied"}),
    ensurePermission:(resource:string,action:string)=>async(req:express.Request,res:express.Response,next:express.NextFunction)=>{
      try{res.locals.fixtureStage="permission";return await queryRolePermission(database!,(req as any).user.role,resource,action)?next():res.status(403).json({message:"Access denied"});}
      catch(error){next(error);}
    }};
  registerDocumentRoutes(app,auth);registerSupplierRoutes(app,auth);
  app.use(((_error,req,res,_next)=>{
    boundaryFailures++;
    console.log(JSON.stringify({kind:"document-runtime-boundary",runId,stage:res.locals.fixtureStage,route:req.path,status:503,requestId:resolveRequestId(res)}));
    return sendError(res,503,"TEST_DEPENDENCY_UNAVAILABLE","The test dependency could not be read. No business repair was attempted.");
  }) as express.ErrorRequestHandler);
  if(failureMode==="membership-query")await database.query("ALTER TABLE organization_members RENAME COLUMN application_role TO unavailable_fixture_role");
  if(failureMode==="permission-query")await database.query("UPDATE organization_members SET application_role='viewer' WHERE id=1; ALTER TABLE permissions RENAME COLUMN permission_type TO unavailable_fixture_permission");
  server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const call=(route:string,options:RequestInit={})=>fetch(base+route,{...options,signal:AbortSignal.timeout(10000)});
  const firstReply=await call("/api/v2/documents?entityType=supplier&entityId=10"),first=await firstReply.json();
  assert.equal(first.error?.requestId??first.meta?.requestId,firstReply.headers.get("X-Request-Id"));
  if(firstReply.status>=500)assert.deepEqual(Object.keys(first.error).sort(),["code","message","requestId"],"No SQL, stack or ownership fields may leak through the test error boundary.");
  console.log(JSON.stringify({kind:"document-runtime-first-response",runId,status:firstReply.status,requestId:firstReply.headers.get("X-Request-Id")}));
  if(failureMode==="hard-stop")process.kill(process.pid,"SIGKILL");
  assert.equal(firstReply.status,200,"A failed dependency must FAIL this suite, not be treated as empty/healthy.");
  assert.equal(first.data.total,5000);assert.equal(first.data.items.length,25);assert.equal(first.data.summary.unverified,5000);assert.ok(!JSON.stringify(first).includes("FOREIGN-PRIVATE"));assert.ok(!JSON.stringify(first).includes("storedUrl"));
  const counted=await database.connect();let queries=0;
  try{await counted.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const proxy={query:(...args:any[])=>{queries++;return(counted.query as any)(...args);}} as pg.PoolClient;
    const result=await documentPage(proxy,1,["supplier"],{archived:"exclude",sort:"newest",fileStatus:"all"},4975,25);assert.equal(result.total,5000);assert.equal(result.items.length,25);assert.ok(queries<=14,`No per-row queries: ${queries}`);await counted.query("COMMIT");}finally{counted.release();}
  for(const route of ["/api/v2/documents?pageSize=5000","/api/v2/documents?unsupported=1","/api/documents?limit=1000"])assert.equal((await call(route)).status,400);
  assert.equal((await call("/api/documents/1/download")).status,409,"Legacy paths cannot establish verified ownership.");
  assert.equal((await call("/api/documents/5001/download")).status,404);assert.equal((await call("/api/documents/5002/download")).status,404);
  for(const documentId of [5001,5002]){const hidden=await(await call(`/api/v2/documents?documentId=${documentId}&archived=include`)).json();assert.equal(hidden.data.total,0);assert.equal(hidden.data.items.length,0);}
  for(const query of ["documentId=invalid","documentId=0","documentId=1&documentId=2"])assert.equal((await call(`/api/v2/documents?${query}`)).status,400);
  const legacyTarget=await(await call("/api/v2/documents?documentId=1&entityType=supplier&entityId=10")).json();assert.equal(legacyTarget.data.total,1);assert.equal(legacyTarget.data.items[0].fileStatus,"unverified");
  assert.equal((await(await call("/api/v2/documents?documentId=1&entityType=supplier&entityId=20")).json()).data.total,0,"A document ID cannot bypass source scope.");
  const evidenceBefore=(await database.query("SELECT md5(string_agg(row_to_json(d)::text,',' ORDER BY id)) AS digest FROM documents d WHERE organization_id=1")).rows[0].digest;
  const reconciliation=await call("/api/documents/reconcile",{method:"POST"});assert.equal(reconciliation.status,200);assert.equal((await reconciliation.json()).data.changesApplied,false);
  assert.equal((await database.query("SELECT md5(string_agg(row_to_json(d)::text,',' ORDER BY id)) AS digest FROM documents d WHERE organization_id=1")).rows[0].digest,evidenceBefore,"Reconciliation cannot certify or rewrite legacy evidence.");
  const upload=()=>{const form=new FormData();form.append("entityType","supplier");form.append("entityId","10");form.append("file",new Blob(["SYNTHETIC AUTHORIZED FILE"],{type:"text/plain"}),"source-proof.txt");return call("/api/documents/upload",{method:"POST",body:form});};
  const realNow=Date.now;let pair:Response[];
  try{const fixed=realNow();Date.now=()=>fixed;pair=await Promise.all([upload(),upload()]);}finally{Date.now=realNow;}
  for(const response of pair)assert.equal(response.status,201,await response.clone().text());const saved=await Promise.all(pair.map(reply=>reply.json()));assert.notEqual(saved[0].version,saved[1].version);
  assert.equal((await database.query("SELECT count(DISTINCT file_url) FROM documents WHERE organization_id=1 AND id=ANY($1::int[])",[saved.map(row=>row.id)])).rows[0].count,"2","Same-clock uploads cannot overwrite another version's file.");
  const id=saved[0].id;assert.equal(await(await call(`/api/documents/${id}/download`)).text(),"SYNTHETIC AUTHORIZED FILE");
  // Preserve the legacy hardening gate's lifecycle/search/version assertions,
  // using real authorized uploads rather than arbitrary metadata paths.
  assert.deepEqual(saved.map(row=>row.version).sort((a,b)=>a-b),[2,3]);
  const archivedId=saved[1].id;
  assert.equal((await call(`/api/documents/${archivedId}`,{method:"DELETE"})).status,200);
  assert.equal((await call(`/api/documents/${archivedId}`,{method:"DELETE"})).status,200);
  assert.equal((await database.query("SELECT count(*) FROM audit_logs WHERE organization_id=1 AND action='DOCUMENT_ARCHIVED' AND resource_id=$1",[archivedId])).rows[0].count,"1");
  const search="entityType=supplier&entityId=10&q=source-proof.txt";
  const activeRows=await(await call(`/api/documents?${search}`)).json();assert.deepEqual(activeRows.map((row:any)=>row.id),[id]);
  const archivedRows=await(await call(`/api/documents?${search}&archived=only`)).json();assert.deepEqual(archivedRows.map((row:any)=>row.id),[archivedId]);
  const included=await call(`/api/documents?${search}&archived=include`);assert.equal(included.headers.get("x-total-count"),"2");
  assert.deepEqual((await included.json()).map((row:any)=>row.id).sort((a:number,b:number)=>a-b),[id,archivedId].sort((a,b)=>a-b));
  const filteredPage=await(await call(`/api/v2/documents?${search}&archived=include`)).json();assert.equal(filteredPage.data.total,2);assert.equal(filteredPage.data.summary.active,1);assert.equal(filteredPage.data.summary.archived,1);
  const archivedTarget=await(await call(`/api/v2/documents?documentId=${archivedId}&entityType=supplier&entityId=10&archived=include`)).json();assert.equal(archivedTarget.data.total,1);assert.equal(archivedTarget.data.items[0].id,archivedId);assert.ok(archivedTarget.data.items[0].archivedAt);
  assert.equal((await(await call(`/api/v2/documents?documentId=${archivedId}`)).json()).data.total,0);
  const raw=(await database.query("SELECT file_url FROM documents WHERE organization_id=1 AND id=$1",[id])).rows[0].file_url;
  for(const prefix of ["documents","%64ocuments","DOCUMENTS.","documents%20"]){assert.equal((await call(raw.replace("documents",prefix))).status,404);}
  const filename=path.basename(raw),filePath=path.join(root,"documents",filename),bytes=await readFile(filePath);await writeFile(filePath,Buffer.alloc(bytes.length,65));assert.equal((await call(`/api/documents/${id}/download`)).status,409);await writeFile(filePath,bytes);
  assert.equal((await call("/api/documents",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileUrl:raw,entityType:"supplier",entityId:10})})).status,409);
  const filesBefore=await readdir(path.join(root,"documents"));const countBefore=(await database.query("SELECT count(*) FROM documents")).rows[0].count;
  await database.query("ALTER TABLE audit_logs ADD CONSTRAINT injected_upload_audit_failure CHECK(action<>'DOCUMENT_FILE_STORED_V1') NOT VALID");assert.equal((await upload()).status,503);await database.query("ALTER TABLE audit_logs DROP CONSTRAINT injected_upload_audit_failure");
  assert.equal((await database.query("SELECT count(*) FROM documents")).rows[0].count,countBefore);assert.deepEqual((await readdir(path.join(root,"documents"))).sort(),filesBefore.sort());
  const portal=await call("/api/suppliers/10/portal-users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:3})});assert.equal(portal.status,201,await portal.clone().text());
  assert.equal((await call("/api/suppliers/10/portal-users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:3})})).status,200);
  assert.equal((await(await call("/api/suppliers/10/portal-users")).json()).length,1);
  await database.query(`INSERT INTO users(id,active,warehouse_id,username,email,full_name) SELECT n,true,null,'Scoped portal '||n,'portal-'||n||'@example.test','Scoped identity' FROM generate_series(100,130)n;
    INSERT INTO organization_members SELECT n,1,n,true,'active','supplier' FROM generate_series(100,130)n;
    INSERT INTO supplier_portal_mappings(organization_id,supplier_id,user_id,active,created_by_user_id) SELECT 1,10,n,true,1 FROM generate_series(100,130)n;`);
  const portalFirst=await call("/api/suppliers/10/portal-users");assert.equal((await portalFirst.json()).length,25);assert.equal(portalFirst.headers.get("x-has-next"),"true");
  const portalNext=await call("/api/suppliers/10/portal-users?page=2&pageSize=25");assert.equal((await portalNext.json()).length,7);assert.equal(portalNext.headers.get("x-has-next"),"false");
  await database.query("UPDATE organization_members SET application_role='viewer' WHERE id=1; DELETE FROM permissions WHERE role='viewer' AND resource='documents'");
  assert.equal((await call("/api/v2/documents")).status,403);assert.equal((await call(`/api/documents/${id}/download`)).status,403);assert.equal((await call("/api/suppliers/10/portal-users")).status,403);
  const hidden=await(await call("/api/v2/suppliers/10/communications")).json();assert.ok(hidden.data.items.every((row:any)=>row.kind!=="document"));assert.equal(hidden.data.scope.documents,false);
  assert.equal((await call("/api/v2/suppliers/10/communications/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channel:"phone",summary:"Contact without attachment",documentId:id})})).status,403);
  await database.query("UPDATE organization_members SET application_role='admin',active=false WHERE id=1");assert.equal((await call("/api/v2/documents")).status,403);
  await database.query("UPDATE organization_members SET active=true WHERE id=1; UPDATE users SET warehouse_id=9 WHERE id=1");assert.equal((await call("/api/v2/documents")).status,403);await database.query("UPDATE users SET warehouse_id=null WHERE id=1");
  const old=(await database.query("INSERT INTO documents(organization_id,entity_type,entity_id,file_url,file_name,uploaded_at) VALUES(1,'supplier',10,'/uploads/documents/retained.txt','Old authorized metadata','2000-01-01') RETURNING id")).rows[0].id;
  await database.query("UPDATE documents SET uploaded_at='2000-01-01' WHERE organization_id=2; INSERT INTO retention_policies(document_type,retention_years) VALUES('supplier',1)");
  const actor={organizationId:1,userId:1,membershipId:1,userRole:"admin",membershipRole:"member",effectivePermissions:[],correlationId:"retention-test"};
  await database.query("ALTER TABLE audit_logs ADD CONSTRAINT injected_retention_audit_failure CHECK(action<>'DOCUMENT_RETENTION_APPLIED') NOT VALID");await assert.rejects(()=>runDocumentRetention(database!,actor,"retention-rollback"));await database.query("ALTER TABLE audit_logs DROP CONSTRAINT injected_retention_audit_failure");assert.equal((await database.query("SELECT archived_at FROM documents WHERE id=$1",[old])).rows[0].archived_at,null);
  const cycles=await Promise.all([runDocumentRetention(database,actor,"retention-one"),runDocumentRetention(database,actor,"retention-two")]);assert.equal(cycles.reduce((n,x)=>n+x.archivedCount,0),1);
  assert.equal((await database.query("SELECT count(*) FROM documents WHERE organization_id=2 AND archived_at IS NOT NULL")).rows[0].count,"0");assert.equal((await database.query("SELECT count(*) FROM audit_logs WHERE action='DOCUMENT_RETENTION_APPLIED'")).rows[0].count,"1");
  console.log(`PASS document source runtime: 5000 records, bounded cursor (${queries} queries), source/tenant/member/location denial, atomic concurrent uploads and audit rollback, hash/legacy/static refusal, scoped portal identities, atomic tenant-only retention. Database: ${name}`);
  suitePassed=true;
}catch(error){originalFailure=error;throw error;
}finally{
  const cleanupErrors:Error[]=[];let serverClosed=!server,poolClosed=!database,databaseRemoved=!created,uploadsRemoved=false;
  const attempt=async(stage:string,operation:()=>Promise<void>)=>{try{await operation();}catch(error){cleanupErrors.push(new Error(`Document test cleanup stage failed: ${stage}`,{cause:error}));console.error(JSON.stringify({kind:"document-runtime-cleanup-stage-failed",runId,database:name,stage}));}};
  await attempt("server",async()=>{if(server){const closing=new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server.closeAllConnections();await closing;serverClosed=true;}});
  await attempt("pool",async()=>{if(database){await database.end();poolClosed=true;if(failureMode==="cleanup-pool")throw new Error("Synthetic post-close cleanup failure");}});
  await attempt("database",async()=>{if(created){assert.match(name,/^iss_document_test_[a-f0-9]{32}$/);await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[name]);await owner.query(`DROP DATABASE "${name}"`);databaseRemoved=true;console.log(`Removed exact disposable document database ${name}.`);}});
  await attempt("owner",async()=>{await owner.end();});
  await attempt("uploads",async()=>{
    assert.equal(path.dirname(path.resolve(root)),temporaryParent);assert.match(path.basename(root),/^iss-document-source-[a-zA-Z0-9_-]+$/);
    if(identityWritten)assert.deepEqual(JSON.parse(await readFile(path.join(root,".runtime-owner.json"),"utf8")),identity);
    else assert.equal((await readdir(root)).length,0,"Only this newly created empty root may be removed without a written marker.");
    const check=async(directory:string)=>{assert.equal((await lstat(directory)).isSymbolicLink(),false);for(const entry of await readdir(directory,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())await check(path.join(directory,entry.name));}};
    await check(root);await rm(root,{recursive:true,force:false});uploadsRemoved=true;
  });
  console.log(JSON.stringify({kind:"document-runtime-cleanup",...identity,failureMode,suitePassed,boundaryFailures,serverClosed,poolClosed,databaseCreated:created,databaseRemoved,uploadsRemoved,status:cleanupErrors.length?"failed":"passed"}));
  if(cleanupErrors.length)throw new AggregateError([...(originalFailure?[originalFailure]:[]),...cleanupErrors],"Document test cleanup failed; review exact resource identities above.");
}
