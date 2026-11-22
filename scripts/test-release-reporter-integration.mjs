import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

// These are framework tests without browser fixtures, application servers or DBs.
const directory=mkdtempSync(path.join(os.tmpdir(),"iss-release-reporter-"));
const cli=fileURLToPath(new URL("../node_modules/playwright/cli.js",import.meta.url));
const testModule=new URL("../node_modules/@playwright/test/index.mjs",import.meta.url).href;
const reporter=fileURLToPath(new URL("./e2e-release-completeness-reporter.mjs",import.meta.url));
try {
  const config=path.join(directory,"playwright.config.mjs");
  writeFileSync(config,`export default ${JSON.stringify({testDir:directory,testMatch:"*.spec.mjs",outputDir:path.join(directory,"results"),reporter:[[reporter]],workers:1,retries:1,forbidOnly:true})};`);
  for(const [name,body,success] of [
    ["pass",`test('executed',()=>expect(1).toBe(1));`,true],
    ["skipped",`test.skip('not executed',()=>{});`,false],
    ["known failure",`test('not implemented',()=>{test.fail();expect(1).toBe(2);});`,false],
    ["retry",`test('unstable',({},info)=>expect(info.retry).toBe(1));`,false],
    ["focused",`test.only('focused',()=>{});`,false],
  ]) {
    writeFileSync(path.join(directory,"fixture.spec.mjs"),`import {test,expect} from ${JSON.stringify(testModule)};\n${body}`);
    const result=spawnSync(process.execPath,[cli,"test","--config",config],{encoding:"utf8",timeout:60000,windowsHide:true,env:{...process.env,PLAYWRIGHT_HTML_OPEN:"never"}});
    assert.equal(result.status===0,success,`${name}: ${result.stdout}\n${result.stderr}`);
    console.log(`Real Playwright release-reporter scenario passed: ${name}.`);
  }
}finally{rmSync(directory,{recursive:true,force:true});}
