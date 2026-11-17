#!/usr/bin/env node
/**
 * Ensures the dev server answers /api/ready AND /auth on 127.0.0.1:PORT before Playwright runs.
 * Sets PLAYWRIGHT_EXTERNAL_DEV_SERVER=1 only for the Playwright child after both probes pass.
 *
 * With the dev server up, also runs (same as CI / local full E2E gate): purchase-order-endpoints,
 * dashboard-data, logistics-filters, control-tower-dashboard, exceptions-workflow — then all Playwright specs.
 * - If both are already healthy (e.g. CI or `npm run dev` in another terminal), only tests run.
 * - Otherwise starts `npm run dev`, waits for both URLs, runs tests, then stops only the server we started.
 */
import { spawn } from "node:child_process";
import {createServerObservationLog} from "./e2e-server-observations.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { probeUrl } from "./e2e-http-probe.mjs";
import { assertDisposableE2eEnvironment, assertDisposableE2eServer } from "./e2e-database-guard.mjs";
import { resolveE2eServerCommand, spawnE2eServer } from "./e2e-server-command.mjs";

const PORT = process.env.PORT || "5000";
const READY_URL = process.env.PLAYWRIGHT_E2E_READY_URL || `http://127.0.0.1:${PORT}/api/ready`;
const AUTH_URL = process.env.PLAYWRIGHT_E2E_AUTH_URL || `http://127.0.0.1:${PORT}/auth`;
const START_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_E2E_SERVER_TIMEOUT_MS || 120_000);
const POLL_MS = 500;
const DEV_COMMAND = process.env.PLAYWRIGHT_E2E_DEV_COMMAND || "npm run dev";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
resolveE2eServerCommand(DEV_COMMAND,repoRoot);
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const playwrightCli = path.join(repoRoot, "node_modules", "playwright", "cli.js");

function runCommand(command,args,options){
  return new Promise((resolve,reject)=>{const child=spawn(command,args,options);
    child.once("error",reject);child.once("exit",(status,signal)=>resolve({status,signal}));});
}
function runTsx(scriptPath) {
  return runCommand(process.execPath, [tsxCli, scriptPath], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
}

function logBanner(lines) {
  console.log("\n--- E2E dev server wrapper ---");
  for (const line of lines) console.log(line);
  console.log("---\n");
}

/** @type {{ status: number | null, signal: NodeJS.Signals | null } | null} */
let devExitInfo = null;

function formatProbe(label, r) {
  if (r.ok) return `${label}: ok status=${r.status} (${r.elapsedMs}ms)`;
  return `${label}: FAIL error=${r.error ?? "unknown"} (${r.elapsedMs}ms)`;
}

/**
 * Wait until /api/ready returns HTTP (any status after TCP success) and /auth returns HTTP.
 * Updates lastReady / lastAuth for timeout diagnostics.
 */
async function waitForApiAndAuthReachable() {
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (devExitInfo) {
      console.error("\n[E2E] Dev server process exited before /api/ready and /auth became reachable.");
      console.error(`[E2E] exitCode=${devExitInfo.status} signal=${devExitInfo.signal ?? "none"}`);
      console.error("[E2E] Fix startup errors above (DATABASE_URL, migrations, port in use), then retry.\n");
      throw new Error("Test server exited before readiness.");
    }

    lastResults.ready = await probeUrl(READY_URL, { timeoutMs: 5_000 });
    if (!lastResults.ready.ok) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }

    lastResults.auth = await probeUrl(AUTH_URL, { timeoutMs: 15_000 });
    if (!lastResults.auth.ok) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }

    return;
  }

  console.error(`\n[E2E] Timed out after ${START_TIMEOUT_MS}ms waiting for BOTH:`);
  console.error(`[E2E]   ${READY_URL}`);
  console.error(`[E2E]   ${AUTH_URL}`);
  console.error(`[E2E] Last /api/ready probe: ${formatProbe("ready", lastResults.ready)}`);
  console.error(`[E2E] Last /auth probe:     ${formatProbe("auth", lastResults.auth)}`);
  console.error("\n[E2E] Manual checks:");
  console.error(`[E2E]   ${DEV_COMMAND}`);
  console.error(`[E2E]   curl -i ${READY_URL}`);
  console.error(`[E2E]   curl -i ${AUTH_URL}`);
  console.error(
    "[E2E] Note: a working https://<codespace>-5000.app.github.dev URL does not prove 127.0.0.1:5000 is up inside the container.\n",
  );
  throw new Error("Test server readiness timed out.");
}

let devProc = null;
const serverEvidence=createServerObservationLog(process.env.E2E_SERVER_EVIDENCE_LOG);
let exitCode = 1;

const lastResults = {
  ready: { ok: false, error: "not probed yet", elapsedMs: 0 },
  auth: { ok: false, error: "not probed yet", elapsedMs: 0 },
};

try {
  const expectedDatabaseIdentity = assertDisposableE2eEnvironment();
  logBanner([
    `PORT=${PORT}`,
    `READY_URL=${READY_URL}`,
    `AUTH_URL=${AUTH_URL}`,
    `DEV_COMMAND=${DEV_COMMAND}`,
    `START_TIMEOUT_MS=${START_TIMEOUT_MS}`,
  ]);

  const quickReady = await probeUrl(READY_URL, { timeoutMs: 3_000 });
  const quickAuth = await probeUrl(AUTH_URL, { timeoutMs: 3_000 });
  if (quickReady.ok) await assertDisposableE2eServer(READY_URL, expectedDatabaseIdentity);
  const existingServer = quickReady.ok && quickAuth.ok;

  if (existingServer) {
    console.log("[E2E] Existing server detected (/api/ready and /auth both reachable).");
    console.log(`[E2E]   ${formatProbe("ready", quickReady)}`);
    console.log(`[E2E]   ${formatProbe("auth", quickAuth)}`);
    console.log("[E2E] Not spawning a second dev process.\n");
    lastResults.ready = quickReady;
    lastResults.auth = quickAuth;
  } else {
    console.log("[E2E] No healthy server on both URLs yet; spawning dev server.");
    console.log(`[E2E]   initial ${formatProbe("ready", quickReady)}`);
    console.log(`[E2E]   initial ${formatProbe("auth", quickAuth)}`);
    console.log(`[E2E] Command: ${DEV_COMMAND}`);
    console.log("[E2E] (stdio from dev server follows)\n");

    const launched=spawnE2eServer(DEV_COMMAND,{cwd:repoRoot,env:process.env});
    devProc=launched.child;
    devProc.once("spawn",()=>{
      serverEvidence.consume(JSON.stringify({timestamp:new Date().toISOString(),level:"info",message:"E2E owned server spawned",meta:{runtimeMode:launched.definition.mode,entryPoint:launched.definition.entryPoint,pid:devProc.pid}})+"\n","launcher");
      console.log(`[E2E] Actual backend: ${launched.definition.mode}; entry point: ${launched.definition.entryPoint}`);
    });

    // Child test commands are asynchronous below, so these pipes keep draining
    // throughout the browser gate rather than blocking the app on a full pipe.
    for(const [channel,stream] of [["stdout",devProc.stdout],["stderr",devProc.stderr]]){
      stream.on("data",chunk=>{serverEvidence.consume(chunk,channel);process.stdout.write(chunk);});
    }

    devProc.on("error", (err) => {
      console.error("[E2E] Failed to spawn dev server:", err);
      devExitInfo = { status: 1, signal: null };
    });

    devProc.on("exit", (code, signal) => {
      devExitInfo = { status: code, signal: signal ?? null };
    });

    await waitForApiAndAuthReachable();
    await assertDisposableE2eServer(READY_URL, expectedDatabaseIdentity);
    console.log(`[E2E] Ready: ${formatProbe("ready", lastResults.ready)}`);
    console.log(`[E2E] Ready: ${formatProbe("auth", lastResults.auth)}\n`);
  }

  const prePlayReady = await probeUrl(READY_URL, { timeoutMs: 5_000 });
  const prePlayAuth = await probeUrl(AUTH_URL, { timeoutMs: 15_000 });
  if (!prePlayReady.ok || !prePlayAuth.ok) {
    console.error("[E2E] Aborted: server not reachable immediately before Playwright.");
    console.error(`[E2E]   ${formatProbe("ready", prePlayReady)}`);
    console.error(`[E2E]   ${formatProbe("auth", prePlayAuth)}`);
    throw new Error("Test server became unavailable before browser execution.");
  }
  await assertDisposableE2eServer(READY_URL, expectedDatabaseIdentity);

  console.log("[E2E] Running npm run test:purchase-order-endpoints (server is up)...\n");
  const poEndpoints = await runTsx("scripts/test-purchase-order-endpoints.ts");
  if (poEndpoints.status !== 0) {
    throw new Error(`Purchase-order endpoint gate failed (${poEndpoints.status ?? "unknown"}).`);
  }

  console.log("[E2E] Running npm run test:dashboard-data (server is up)...\n");
  const dashData = await runTsx("scripts/test-dashboard-data.ts");
  if (dashData.status !== 0) {
    throw new Error(`Dashboard data gate failed (${dashData.status ?? "unknown"}).`);
  }

  for (const scriptPath of [
    "scripts/test-logistics-filters.ts",
    "scripts/test-control-tower-dashboard.ts",
    "scripts/test-exceptions-workflow.ts",
  ]) {
    const label = path.basename(scriptPath, path.extname(scriptPath));
    console.log(`[E2E] Running npm run ${label} (server is up)...\n`);
    const sub = await runTsx(scriptPath);
    if (sub.status !== 0) {
      throw new Error(`${label} gate failed (${sub.status ?? "unknown"}).`);
    }
  }

  const testResult = await runCommand(
    process.execPath,
    [playwrightCli, "test", "-c", "playwright.config.ts", ...process.argv.slice(2)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        PLAYWRIGHT_EXTERNAL_DEV_SERVER: "1",
      },
    },
  );
  exitCode = testResult.status ?? 1;
} finally {
  if (devProc) {
    try {
      if(devProc.exitCode===null&&devProc.signalCode===null){
        let timer;
        const closed=new Promise(resolve=>devProc.once("close",resolve));
        devProc.kill("SIGTERM");
        try{await Promise.race([closed,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("Owned test server did not stop")),5000);})]);}
        finally{clearTimeout(timer);}
      }
    } catch {
      console.error("Owned test-server shutdown could not be verified; release gate failed.");exitCode=1;
    }
  }
  try{serverEvidence.finish();}catch{console.error("Sanitized server evidence is incomplete; release gate failed.");exitCode=1;}
}

process.exit(exitCode);
