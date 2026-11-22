import {test,expect} from "@playwright/test";
import {spawn} from "node:child_process";
import {requireDisposableE2eDatabase} from "./wave7-helpers";
import {pool} from "../server/db";

// Real affected compatibility workflows run against the same isolated server.
// Build 4's own spec separately exercises enabled enforcement; these prove that
// installing its additive schema does not silently activate it for other orgs.
for(const script of ["test-rbac.ts","test-ap-workflow.ts","test-ap-controls.ts","test-audit-chain-integrity.ts"]){
 test(`affected regression: ${script}`,async({},info)=>{
  test.setTimeout(120_000); // Standalone workflow command includes its own HTTP steps.
  requireDisposableE2eDatabase();
  expect((await pool.query("SELECT current_database() name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  const flags=(await pool.query("SELECT feature_flags FROM organization_settings WHERE organization_id=1")).rows[0].feature_flags;
  expect(flags?.sod??false).toBe(false);expect(flags?.payment_risk??false).toBe(false);
  const policies=(await pool.query("SELECT id,is_active FROM approval_policies WHERE organization_id=1 AND entity_type IN ('invoice','payment_batch')")).rows;
  try{
  const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,["--import","tsx",`scripts/${script}`],{env:process.env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
   let output="";child.stdout.on("data",chunk=>{output+=String(chunk);});child.stderr.on("data",chunk=>{output+=String(chunk);});
   const timer=setTimeout(()=>{output+="\nStandalone regression exceeded its 110-second execution deadline.\n";child.kill();},110_000);
   child.once("error",e=>{clearTimeout(timer);reject(e);});child.once("close",code=>{clearTimeout(timer);resolve({code,output});});
  });
  await info.attach(script+".log",{body:Buffer.from(result.output),contentType:"text/plain"});
  expect(result.code,result.output).toBe(0);
  }finally{
   // Restore only disposable test configuration; preserve policies and history.
   await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type IN ('invoice','payment_batch')");
   await pool.query("UPDATE approval_policies p SET is_active=x.is_active FROM jsonb_to_recordset($1::jsonb)x(id int,is_active boolean) WHERE p.organization_id=1 AND p.id=x.id",[JSON.stringify(policies)]);
  }
 });
}
