#!/usr/bin/env node
/**
 * Ensures something is listening on PORT (default 5000) with a healthy /api/ready before Playwright runs.
 * Sets PLAYWRIGHT_EXTERNAL_DEV_SERVER=1 so playwright.config.ts does not spawn a second webServer process.
 *
 * - If the app is already up (e.g. CI release-gate, or `npm run dev` in another terminal), we only run tests.
 * - Otherwise we start `npm run dev`, wait for readiness, run tests, then tear down only the server we started.
 */
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const PORT = process.env.PORT || "5000";
const READY_URL = process.env.PLAYWRIGHT_E2E_READY_URL || `http://127.0.0.1:${PORT}/api/ready`;
const START_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_E2E_SERVER_TIMEOUT_MS || 120_000);
const POLL_MS = 500;

async function isReady() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(READY_URL, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForReady() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isReady()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.error(`Timed out waiting for ${READY_URL} (${START_TIMEOUT_MS}ms).`);
  process.exit(1);
}

/** Prime Vite + SPA so the first Playwright navigation is less likely to hit the default test timeout. */
async function warmClientShell() {
  const authUrl = READY_URL.replace(/\/api\/ready\/?$/i, "/auth");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    await fetch(authUrl, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
  } catch {
    /* non-fatal */
  }
}

let devProc = null;
let exitCode = 1;

try {
  const alreadyUp = await isReady();

  if (!alreadyUp) {
    console.log(`Starting dev server for E2E (waiting for ${READY_URL})…`);
    devProc = spawn("npm", ["run", "dev"], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    devProc.on("error", (err) => {
      console.error(err);
      process.exit(1);
    });
    await waitForReady();
  } else {
    console.log("Using existing dev server (port already healthy).");
  }

  await warmClientShell();

  const testResult = spawnSync("npx", ["playwright", "test", "-c", "playwright.config.ts", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PLAYWRIGHT_EXTERNAL_DEV_SERVER: "1",
    },
  });
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
