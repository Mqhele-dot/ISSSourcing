#!/usr/bin/env node
/**
 * Ensures the dev server answers /api/ready AND /auth on 127.0.0.1:PORT before Playwright runs.
 * Sets PLAYWRIGHT_EXTERNAL_DEV_SERVER=1 only for the Playwright child after both probes pass.
 *
 * - If both are already healthy (e.g. CI or `npm run dev` in another terminal), only tests run.
 * - Otherwise starts `npm run dev`, waits for both URLs, runs tests, then stops only the server we started.
 */
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const PORT = process.env.PORT || "5000";
const READY_URL = process.env.PLAYWRIGHT_E2E_READY_URL || `http://127.0.0.1:${PORT}/api/ready`;
const AUTH_URL = process.env.PLAYWRIGHT_E2E_AUTH_URL || `http://127.0.0.1:${PORT}/auth`;
const START_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_E2E_SERVER_TIMEOUT_MS || 120_000);
const POLL_MS = 500;
const DEV_COMMAND = process.env.PLAYWRIGHT_E2E_DEV_COMMAND || "npm run dev";

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
      process.exit(1);
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
  process.exit(1);
}

let devProc = null;
let exitCode = 1;

const lastResults = {
  ready: { ok: false, error: "not probed yet", elapsedMs: 0 },
  auth: { ok: false, error: "not probed yet", elapsedMs: 0 },
};

try {
  logBanner([
    `PORT=${PORT}`,
    `READY_URL=${READY_URL}`,
    `AUTH_URL=${AUTH_URL}`,
    `DEV_COMMAND=${DEV_COMMAND}`,
    `START_TIMEOUT_MS=${START_TIMEOUT_MS}`,
  ]);

  const quickReady = await probeUrl(READY_URL, { timeoutMs: 3_000 });
  const quickAuth = await probeUrl(AUTH_URL, { timeoutMs: 3_000 });
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

    devProc = spawn(DEV_COMMAND, [], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    devProc.on("error", (err) => {
      console.error("[E2E] Failed to spawn dev server:", err);
      process.exit(1);
    });

    devProc.on("exit", (code, signal) => {
      devExitInfo = { status: code, signal: signal ?? null };
    });

    await waitForApiAndAuthReachable();
    console.log(`[E2E] Ready: ${formatProbe("ready", lastResults.ready)}`);
    console.log(`[E2E] Ready: ${formatProbe("auth", lastResults.auth)}\n`);
  }

  const prePlayReady = await probeUrl(READY_URL, { timeoutMs: 5_000 });
  const prePlayAuth = await probeUrl(AUTH_URL, { timeoutMs: 15_000 });
  if (!prePlayReady.ok || !prePlayAuth.ok) {
    console.error("[E2E] Aborted: server not reachable immediately before Playwright.");
    console.error(`[E2E]   ${formatProbe("ready", prePlayReady)}`);
    console.error(`[E2E]   ${formatProbe("auth", prePlayAuth)}`);
    process.exit(1);
  }

  const testResult = spawnSync(
    "npx",
    ["playwright", "test", "-c", "playwright.config.ts", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      shell: true,
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
      devProc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

process.exit(exitCode);
