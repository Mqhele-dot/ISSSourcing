import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync,readdirSync,statSync } from "node:fs";
import { assertDisposableE2eEnvironment } from "./e2e-database-guard.mjs";
import { releaseMigrations, apHistoryMigrations, compactExportMigrations, compactFullDetailMigrations, compactPublicationMigrations, compactWorkspaceMigrations, compactCaptureMigrations, compactRetryMigrations, supplierExportMigrations, supplierObservationMigrations, contractObligationMigrations, purchaseBudgetEvidenceMigrations } from "./release-migrations.mjs";
import { agreementReleaseEvidenceMigrations, purchaseOrderBudgetProvenanceMigrations,procurementGovernanceMigrations } from "./release-migrations.mjs";
import { smokeProductionPackage } from "./production-package-smoke.mjs";
import { acquireE2eWorkspaceLock } from "./e2e-workspace-lock.mjs";
import { captureReleaseCandidate } from "./release-candidate-evidence.mjs";
import { assertUnusedLocalTestPort } from "./e2e-port-preflight.mjs";
import { resolveE2eServerCommand } from "./e2e-server-command.mjs";

// Playwright accepts a list containing nonexistent paths when another path
// matches. Refuse an incomplete requested gate before build or database setup.
const requestedSpecs = process.argv.slice(2).filter((arg) => arg.endsWith(".spec.ts"));
const runKind=process.argv.includes("--production-smoke")?"production-smoke":process.argv.includes("--live-demo")?"live-demo":"browser";
const expectedSpecs=runKind!=="browser"?[]:process.argv.includes("--full")?(requestedSpecs.length?requestedSpecs:readdirSync("e2e").filter(file=>file.endsWith(".spec.ts")).map(file=>`e2e/${file}`).sort()):[...new Set(["e2e/small-business-release.spec.ts",...requestedSpecs])];
for (const spec of requestedSpecs) {
  if (!/^e2e\/[A-Za-z0-9._/-]+\.spec\.ts$/.test(spec) || spec.split("/").includes("..") || !existsSync(spec)||!statSync(spec).isFile()) {
    throw new Error(`Requested browser spec is missing or invalid: ${spec}. No test database was created.`);
  }
}
const releaseWorkspaceLock = acquireE2eWorkspaceLock(path.resolve("test-results"));
process.once("exit", releaseWorkspaceLock);

// Refuse another listener before building, creating a database or seeding. A
// successful check never authorizes reuse: runtime identity is checked again.
if (runKind !== "production-smoke") await assertUnusedLocalTestPort(process.env);
if(runKind==="browser")resolveE2eServerCommand(process.argv.includes("--built")?"node dist/index.js":process.env.PLAYWRIGHT_E2E_DEV_COMMAND,process.cwd());

// NODE_ENV=test serves packaged assets. Rebuild once before the viewport child
// runs so browser evidence always covers the current client source.
if (process.env.DISPOSABLE_E2E_BUILD_READY !== "1") {
  const windows=process.platform==="win32";
  const buildId=`build-${randomUUID()}`;
  const buildArtifacts=path.resolve("artifacts","release-runs");
  mkdirSync(buildArtifacts,{recursive:true});
  const startedAt=new Date().toISOString();
  const buildCandidate=captureReleaseCandidate();
  const built=spawnSync(windows?"cmd.exe":"npm",windows?["/d","/s","/c","npm run build"]:["run","build"],
    {stdio:["ignore","pipe","pipe"],shell:false,encoding:"utf8",maxBuffer:64*1024*1024,env:{...process.env,NODE_ENV:"production"}});
  const finishedCandidate=captureReleaseCandidate();
  const sourceUnchanged=buildCandidate.sourceFingerprint===finishedCandidate.sourceFingerprint&&buildCandidate.revision===finishedCandidate.revision;
  writeFileSync(path.join(buildArtifacts,`${buildId}.log`),`${built.stdout??""}\n${built.stderr??""}`);
  writeFileSync(path.join(buildArtifacts,`${buildId}.json`),JSON.stringify({runKind:"build",startedAt,completedAt:new Date().toISOString(),
    candidate:buildCandidate,finishedCandidate,sourceUnchanged,status:built.status===0&&sourceUnchanged?"passed":"failed",exitCode:built.status,
    errorCode:built.error?.code??null,testDatabaseCreated:false,command:"npm run build",nodeEnvironment:"production"},null,2));
  if(built.stdout)process.stdout.write(built.stdout);
  if(built.stderr)process.stderr.write(built.stderr);
  if(built.status!==0)throw new Error("Current-source build failed before disposable browser setup.");
  if(!sourceUnchanged)throw new Error("Source changed during the build. No test database was created; rebuild the unchanged candidate.");
  process.env.DISPOSABLE_E2E_BUILD_READY="1";
}

// Each viewport owns its database: approval and setup mutations in the desktop
// project must never become the mobile project's starting fixtures.
if (process.env.PLAYWRIGHT_BOTH_VIEWPORTS === "1") {
  for (const mobile of ["0", "1"]) {
    const child = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      env: { ...process.env, PLAYWRIGHT_BOTH_VIEWPORTS: "0", PLAYWRIGHT_MOBILE_GATE: mobile },
      stdio: "inherit", shell: false,
    });
    if (child.status !== 0) process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

const source = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"}`
  : undefined);
if (!source) throw new Error("Set DATABASE_URL or local PGHOST/PGUSER/PGPASSWORD before running the disposable browser gate.");
const ownerUrl = new URL(source);
if (!["localhost", "127.0.0.1", "[::1]"].includes(ownerUrl.hostname)) throw new Error("Disposable browser gate only creates databases on local PostgreSQL.");
ownerUrl.pathname = "/postgres";
const name = `iss_e2e_test_${randomUUID().replaceAll("-", "")}`;
if (!/^iss_e2e_test_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid test-owned database name.");
const testUrl = new URL(source);
testUrl.pathname = `/${name}`;
const uploadRoot = await mkdtemp(path.join(os.tmpdir(), `${name}-uploads-`));
const env = {
  ...process.env,
  BASE_URL: `http://127.0.0.1:${process.env.PORT || "5000"}`,
  PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${process.env.PORT || "5000"}`,
  DATABASE_URL: testUrl.toString(),
  TEST_DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
  ALLOW_COMMERCIAL_TEST_DB_INIT: "1",
  // AP Aging is mounted by ordinary supplier, Control Tower and Analytics views.
  // Its schema is part of the disposable candidate, not a business migration approval.
  ENABLE_AP_HISTORY_TESTS: "1",
  AUTO_SEED_ON_EMPTY_DB: "true",
  PLAYWRIGHT_REUSE_EXISTING_SERVER: "0",
  PLAYWRIGHT_EXTERNAL_DEV_SERVER: "0",
  PLAYWRIGHT_REQUIRE_COMPLETE_GATE: "1",
  PLAYWRIGHT_EXPECTED_SPECS: JSON.stringify(expectedSpecs),
  BROWSER_URL_SMOKE_SCREENSHOTS_DIR:path.resolve("test-results",name,"local-url-smoke"),
  BROWSER_WALKTHROUGH_SCREENSHOTS_DIR:path.resolve("test-results",name,"local-browser-walkthrough"),
  DISABLE_NOTIFICATION_EMAIL: "true",
  DISABLE_NOTIFICATION_SMS: "true",
  EMAIL_HOST:"",EMAIL_USER:"",EMAIL_PASS:"",ALLOW_ETHEREAL_TEST_ACCOUNT:"false",
  FX_PROVIDER_URL:"",FX_PROVIDER_TOKEN:"",
  TEST_UPLOADS_DIR: uploadRoot,
  PLAYWRIGHT_OUTPUT_DIR: path.resolve("test-results", name),
  PLAYWRIGHT_HTML_OUTPUT_DIR: path.resolve("playwright-report", name),
  PLAYWRIGHT_HTML_OPEN: "never",
};
assertDisposableE2eEnvironment(env);

// Playwright clears outputDir at startup: journals must live outside it.
const evidenceDirectory=path.resolve("artifacts","release-runs",name);
mkdirSync(evidenceDirectory,{recursive:true});
env.E2E_SERVER_EVIDENCE_LOG=path.join(evidenceDirectory,"server-observations.jsonl");
const candidate=captureReleaseCandidate();
const runJournal={testDatabase:name,runKind,candidate,requestedSpecs:expectedSpecs,viewport:env.PLAYWRIGHT_MOBILE_GATE==="1"?"mobile-390":"desktop",startedAt:new Date().toISOString(),status:"running",databaseRemoved:false,uploadsRemoved:false,
  runnerPid:process.pid,workspaceLockOwnerPid:Number(process.env.DISPOSABLE_E2E_LOCK_PID??process.pid),
  port:Number(env.PORT||5000),uploadRoot,evidenceDirectory,history:[]};
function checkpoint(phase) {
  runJournal.history.push({phase,at:new Date().toISOString()});
  try {
    writeFileSync(path.join(evidenceDirectory,"runner-state.json"),JSON.stringify(runJournal,null,2));
  } catch {
    // Evidence failure must not prevent exact test-owned resource cleanup.
    runJournal.evidenceWriteFailed=true;
    console.error("Disposable runner could not persist its progress evidence; release verification is incomplete.");
  }
}
checkpoint("preflight_complete");


// Do not load database/browser runtimes before the cheap occupied-port guard.
const {default:pg}=await import("pg");
const owner = new pg.Client({ connectionString: ownerUrl.toString(), connectionTimeoutMillis: 5000 });
let created = false;
let exitCode = 1;
function run(script, specs = []) {
  checkpoint(`command:${script}`);
  if (specs.some((spec) => !/^e2e\/[A-Za-z0-9._/-]+\.spec\.ts$/.test(spec))) throw new Error("Invalid browser spec path.");
  const windows = process.platform === "win32";
  const child = spawnSync(windows ? "cmd.exe" : "npm", windows ? ["/d", "/s", "/c", `npm run ${script}${specs.length ? ` -- ${specs.join(" ")}` : ""}`] : ["run", script, ...(specs.length ? ["--", ...specs] : [])],
    { env, stdio: "inherit", shell: false });
  if (child.status !== 0) throw new Error(`${script} failed with exit code ${child.status ?? "unknown"}.`);
}
try {
  // A writable directory does not necessarily permit atomic publication (for
  // example, a restricted Windows system-temp sandbox). Prove the required
  // operation on test-owned files, without weakening production publication.
  const probeSource=path.join(uploadRoot,"publication-probe.partial"),probeDestination=path.join(uploadRoot,"publication-probe.complete");
  try {
    await writeFile(probeSource,"synthetic publication preflight",{flag:"wx",mode:0o600});
    await rename(probeSource,probeDestination);
  } catch(error) {
    throw new Error("Test temporary storage cannot atomically publish files. Configure a writable, test-owned TEMP/TMP directory before retrying. No test database was created.",{cause:error});
  } finally {
    await rm(probeSource,{force:true}).catch(()=>undefined);
    await rm(probeDestination,{force:true}).catch(()=>undefined);
  }
  checkpoint("upload_filesystem_verified");
  // Fail before creating/seeding a database when the browser runtime is unavailable.
  const {chromium}=await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    ...(env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: env.PLAYWRIGHT_BROWSER_CHANNEL } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const videoRequired=runKind==="browser"&&env.PLAYWRIGHT_VIDEO!=="off"&&!env.CI;
  try {
    // A blank-page video recorder can outlive browser.close on Windows. Check
    // the pinned Playwright encoder directly and bound its lifetime instead;
    // the actual browser suite still records video under the normal policy.
    if(videoRequired){
      const require=createRequire(import.meta.url);
      const {registry}=require(path.join(path.dirname(require.resolve("playwright-core/package.json")),"lib/server/registry/index.js"));
      const encoder=registry.findExecutable("ffmpeg")?.executablePathOrDie("javascript");
      if(!encoder)throw new Error("The configured Playwright video runtime is unavailable. Configure its browser cache before retrying; no test database was created.");
      const encoderEnv={};for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","WINDIR","TEMP","TMP"])if(process.env[key])encoderEnv[key]=process.env[key];
      const result=spawnSync(encoder,["-version"],{env:encoderEnv,stdio:"ignore",timeout:5000,windowsHide:true,shell:false});
      if(result.error||result.status!==0)throw new Error("The configured Playwright video runtime could not start and exit safely. Repair the video runtime before retrying; no test database was created.");
    }
    const context=await browser.newContext();
    try { const page=await context.newPage(); await page.close(); }
    finally { await context.close(); }
    runJournal.browser={channel:env.PLAYWRIGHT_BROWSER_CHANNEL||"bundled-chromium",version:browser.version(),videoPreflight:videoRequired?"encoder_version_passed":"not_required"};
  } finally { await browser.close(); }
  checkpoint("browser_runtime_verified");
  await owner.connect();
  checkpoint("database_creation");
  await owner.query(`CREATE DATABASE "${name}"`);
  created = true;
  console.log(`Created test-owned database ${name}. Current application database was not changed.`);
  run("db:push:force");
  const fullCompactTests=env.ENABLE_COMPACT_FULL_DETAIL_TESTS==='1'||expectedSpecs.some(spec=>spec.endsWith('/compact-profile-release-guard.spec.ts'));
  if(fullCompactTests)env.ENABLE_COMPACT_FULL_DETAIL_TESTS='1';
  const compactTests=fullCompactTests||env.ENABLE_COMPACT_EXPORT_TESTS==="1"||expectedSpecs.some(spec=>spec.endsWith("/paired-export-download.spec.ts"));
  if(compactTests||supplierExportMigrations.length){
    checkpoint("export_schema_prerequisites");
    const prerequisite=spawnSync(process.execPath,["--import","tsx","scripts/initialize-export-test-schema.mjs"],{env,stdio:"inherit",shell:false});
    if(prerequisite.status!==0)throw new Error("Export schema prerequisites failed before paired migration or fixtures.");
  }
  // The release FK depends on canonical SQL-only procurement tables, normally
  // installed at development bootstrap. Install them before evidence and fixtures.
  const procurementPrerequisites = ["20260830143000_procurement_completion.sql", "20260907120000_blanket_agreements_completion.sql"];
  for (const migration of [...procurementPrerequisites,...releaseMigrations,...apHistoryMigrations,...supplierExportMigrations,...supplierObservationMigrations,...contractObligationMigrations,...purchaseBudgetEvidenceMigrations,...agreementReleaseEvidenceMigrations,...purchaseOrderBudgetProvenanceMigrations,...procurementGovernanceMigrations,...(compactTests?compactExportMigrations:[]),...(fullCompactTests?[...compactFullDetailMigrations,...compactPublicationMigrations,...compactWorkspaceMigrations,...compactCaptureMigrations,...compactRetryMigrations]:[])]) {
    checkpoint(`migration:${migration}`);
    const child = spawnSync(process.execPath, ["scripts/apply-sql-migration.mjs", migration], {
      env,
      stdio: "inherit",
      shell: false,
    });
    if (child.status !== 0) {
      throw new Error(`Migration ${migration} failed with exit code ${child.status ?? "unknown"}.`);
    }
  }
  const schemaCheck = spawnSync(process.execPath, ["scripts/verify-release-schema.mjs"], { env, stdio: "inherit" });
  if (schemaCheck.status !== 0) throw new Error("Release schema verification failed before fixtures.");
  run("db:init:commercial-test");
  if(process.argv.includes("--live-demo")) {
    // Keep the guarded, disposable app available for an operator-visible walkthrough.
    const net=await import("node:net");
    const reservation=net.createServer();
    await new Promise((resolve,reject)=>reservation.once("error",reject).listen(Number(env.PORT||5000),"127.0.0.1",resolve));
    await new Promise(resolve=>reservation.close(resolve));
    const child=spawn(process.execPath,["--import","tsx","server/index.ts"],{env:{...env,HOST:"127.0.0.1",ENABLE_TEST_DIAGNOSTIC_WORKER:"1"},stdio:"inherit"});
    console.log(`Disposable visible demo: ${env.BASE_URL}. Stop this runner to remove only ${name}.`);
    await new Promise((resolve,reject)=>{
      child.once("error",reject);
      child.once("exit",code=>code===0?resolve():reject(new Error(`Demo server exited: ${code}`)));
      for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>child.kill());
    });
    exitCode=0;
  } else if(process.argv.includes("--production-smoke")) {
    checkpoint("production_smoke");
    const evidence=await smokeProductionPackage(env);
    await writeFile(path.join(evidenceDirectory,"production-smoke.json"),JSON.stringify({...evidence,testDatabase:name,candidate},null,2));
    exitCode=0;
  } else {
  if (process.argv.includes("--built")) env.PLAYWRIGHT_E2E_DEV_COMMAND = "node dist/index.js";
  run(process.argv.includes("--full") ? "test:e2e" : "test:e2e:small-business:direct", process.argv.filter((arg) => arg.endsWith(".spec.ts")));
  exitCode = 0;
  }
} finally {
  checkpoint("cleanup_started");
  try {
    if (created) {
      await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      runJournal.databaseRemoved=true;
      console.log(`Removed exact test-owned database ${name}; Playwright reports remain available.`);
    }
  } finally {
    await owner.end().catch(() => undefined);
    await rm(uploadRoot, { recursive: true, force: true });
    runJournal.uploadsRemoved=true;
    try {
      const finalCandidate=captureReleaseCandidate();
      runJournal.candidateUnchanged=finalCandidate.sourceFingerprint===candidate.sourceFingerprint&&finalCandidate.revision===candidate.revision;
      if(!runJournal.candidateUnchanged) {exitCode=1;console.error("Release candidate changed during verification; rerun against one unchanged candidate.");}
    } catch {exitCode=1;runJournal.candidateUnchanged=false;}
    runJournal.status=exitCode===0&&runJournal.databaseRemoved&&!runJournal.evidenceWriteFailed?(runKind==="live-demo"?"unverified":"passed"):"failed";
    checkpoint("cleanup_finished");
  }
}
process.exitCode = runJournal.evidenceWriteFailed?1:exitCode;
