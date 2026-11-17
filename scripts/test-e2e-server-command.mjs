import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolveE2eServerCommand, spawnE2eServer } from "./e2e-server-command.mjs";

const parent=path.resolve("artifacts");await mkdir(parent,{recursive:true});
const root=await mkdtemp(path.join(parent,"entry-test-"));
try {
  await mkdir(path.join(root,"dist"));await mkdir(path.join(root,"server"));
  await writeFile(path.join(root,"package.json"),' {"type":"module"}');
  await writeFile(path.join(root,"dist/index.js"),'console.log(JSON.stringify({marker:"built",execArgv:process.execArgv}));');
  await writeFile(path.join(root,"server/index.ts"),'const marker: string="source";console.log(JSON.stringify({marker,execArgv:process.execArgv}));');
  for(const command of ["node dist/index.js; ignored","npm run dev && ignored","node other.js","node dist/../other.js"])
    assert.throws(()=>resolveE2eServerCommand(command,root),error=>error.code==="E2E_UNSUPPORTED_SERVER_COMMAND");
  for(const [command,mode]of [["node dist/index.js","built"],["npm run dev","source"]]){
    const env={};for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","WINDIR","TEMP","TMP"])if(process.env[key])env[key]=process.env[key];
    const {child,definition}=spawnE2eServer(command,{cwd:root,env});
    let output="",errors="",timer;
    child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{errors+=chunk;});
    const code=await Promise.race([new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error("Synthetic backend did not exit"));},15000);})]).finally(()=>clearTimeout(timer));
    assert.equal(code,0,errors);assert.equal(definition.mode,mode);
    const actual=JSON.parse(output.trim());assert.equal(actual.marker,mode);
    assert.equal(actual.execArgv.includes("--import"),mode==="source");
    if(mode==="built")assert.deepEqual(actual.execArgv,[],"Packaged backend must not load the TSX source compiler");
  }
  console.log(JSON.stringify({status:"passed",checks:["real Node child executes compiled entry", "compiled mode has no TSX loader", "source mode really transforms TypeScript", "unsupported/shell-like commands fail without fallback", "credential-free synthetic child environment"]}));
}finally{if(path.dirname(root)!==parent||!path.basename(root).startsWith("entry-test-"))throw new Error("Unsafe fixture cleanup");await rm(root,{recursive:true,force:true});}
