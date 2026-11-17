import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {acquireE2eWorkspaceLock} from "./e2e-workspace-lock.mjs";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
// Share the browser-runner lock across BOTH asset and server packaging. A
// browser run may pass its existing verified ownership token to this wrapper.
const release=acquireE2eWorkspaceLock(path.join(projectRoot,"test-results"));
process.once("exit",release);
for(const script of ["build-client.mjs","build-server.mjs"]){
  const child=spawnSync(process.execPath,[path.join(projectRoot,"scripts",script)],{cwd:projectRoot,env:process.env,stdio:"inherit",shell:false});
  if(child.error||child.status!==0){
    console.error("Application packaging failed; no release success is implied.");
    process.exitCode=child.status??1;break;
  }
}
