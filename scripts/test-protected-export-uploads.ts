import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import {isProtectedExportUploadPath} from "../server/http/protected-export-path";
for(const route of ["/documents/a.pdf","/%64ocuments/a","/DOCUMENTS./a","/documents%5ca","/exports/a","/%65xports/a","/EXPORTS/a","//exports//a","/exports./a","/exports%20/a","/exports%5corg-1%5ca","/x/../exports/a","/exports::$INDEX_ALLOCATION/a","/%GG"])
  assert.equal(isProtectedExportUploadPath(route),true,route);
for(const route of ["/company-logos/logo.png","/exports-logo.png","/myexports/a"])
  assert.equal(isProtectedExportUploadPath(route),false,route);
const root=await mkdtemp(path.join(os.tmpdir(),"iss-protected-export-"));
process.env.NODE_ENV="test";process.env.TEST_UPLOADS_DIR=root;
process.env.DATABASE_URL="postgresql://unconfigured@127.0.0.1:1/iss_export_test_924b44698b1145b5abe642f6c0d578bf";
process.env.TEST_DATABASE_URL=process.env.DATABASE_URL;
const {mountUploadsStatic}=await import("../server/http/upload-config");
const app=express();mountUploadsStatic(app);
await mkdir(path.join(root,"exports","org-1"),{recursive:true});
const retained=path.join(root,"exports/org-1/job-1-old.csv");await writeFile(retained,"SYNTHETIC PRIVATE RETAINED FILE");
await writeFile(path.join(root,"company-logos","visible.txt"),"Public logo fixture");
const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
try{
  const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  for(const prefix of ["exports","%65xports","EXPORTS","exports.","exports%20","exports%5corg-1%5c.."]){
    const reply=await fetch(`${base}/uploads/${prefix}/org-1/job-1-old.csv`);assert.equal(reply.status,404,prefix);assert.doesNotMatch(await reply.text(),/SYNTHETIC PRIVATE/);
  }
  assert.equal(await(await fetch(`${base}/uploads/company-logos/visible.txt`)).text(),"Public logo fixture");
  assert.equal(await readFile(retained,"utf8"),"SYNTHETIC PRIVATE RETAINED FILE");
  console.log("Protected export uploads passed: unauthenticated plain/encoded/case/Windows aliases refused, public assets unchanged, retained bytes untouched.");
}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
