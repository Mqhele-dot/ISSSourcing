#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const READY_URL = `${BASE_URL}/api/ready`;
const AUTH_URL = `${BASE_URL}/auth`;
const TARGET_PATH = process.env.LOCAL_BROWSER_TEST_PATH || "/operations/control-tower";
const EXPECT_TEXT = process.env.LOCAL_BROWSER_EXPECT_TEXT || "";
const START_TIMEOUT_MS = Number(process.env.LOCAL_BROWSER_URL_TIMEOUT_MS || 120_000);
const PLAYWRIGHT_TIMEOUT_MS = Number(process.env.LOCAL_BROWSER_PLAYWRIGHT_TIMEOUT_MS || 150_000);
const SCREENSHOTS_DIR = process.env.BROWSER_WALKTHROUGH_SCREENSHOTS_DIR || "test-results/local-url-smoke";
const DEV_COMMAND = process.env.LOCAL_BROWSER_DEV_COMMAND || "npm run dev";
const BROWSER_CHANNEL = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
const isRemoteTarget = /^https?:\/\/(?!127\.0\.0\.1(?::|\/|$)|localhost(?::|\/|$))/i.test(BASE_URL);

let devProc = null;
let devExitInfo = null;

function formatProbe(label, result) {
  if (result.ok) {
    return `${label}: ok status=${result.status} (${result.elapsedMs}ms)`;
  }
  return `${label}: FAIL error=${result.error ?? "unknown"} (${result.elapsedMs}ms)`;
}

function spawnDevServer() {
  devProc = spawn(DEV_COMMAND, [], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PORT },
  });
  devProc.on("exit", (code, signal) => {
    devExitInfo = { code, signal };
  });
}

async function waitForFullApp() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let ready = { ok: false, error: "not probed", elapsedMs: 0 };
  let auth = { ok: false, error: "not probed", elapsedMs: 0 };

  while (Date.now() < deadline) {
    if (devExitInfo) {
      throw new Error(
        `Local app exited before it was ready. exitCode=${devExitInfo.code} signal=${devExitInfo.signal ?? "none"}`,
      );
    }

    ready = await probeUrl(READY_URL, { timeoutMs: 5_000 });
    auth = await probeUrl(AUTH_URL, { timeoutMs: 15_000 });

    if (ready.ok && auth.ok) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(
    [
      `Timed out waiting for the local app at ${BASE_URL}.`,
      formatProbe("ready", ready),
      formatProbe("auth", auth),
    ].join("\n"),
  );
}

async function stopDevServer() {
  if (!devProc || devProc.killed) return;
  devProc.kill();
  if (process.platform === "win32" && devProc.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(devProc.pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  }
}

let exitCode = 1;

try {
  console.log("\nLocal URL smoke");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Target path: ${TARGET_PATH}`);
  if (EXPECT_TEXT) {
    console.log(`Expected text: ${EXPECT_TEXT}`);
  }
  console.log(`Browser: ${BROWSER_CHANNEL}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}\n`);

  const quickReady = await probeUrl(READY_URL, { timeoutMs: 3_000 });
  const quickAuth = await probeUrl(AUTH_URL, { timeoutMs: 3_000 });

  if (quickReady.ok && quickAuth.ok) {
    console.log(isRemoteTarget ? "Remote app detected; using it." : "Existing local app detected; reusing it.");
  } else if (isRemoteTarget) {
    throw new Error(
      [
        `Remote app is not reachable at ${BASE_URL}.`,
        formatProbe("ready", quickReady),
        formatProbe("auth", quickAuth),
      ].join("\n"),
    );
  } else {
    console.log("Starting the full local app for route testing.");
    spawnDevServer();
    await waitForFullApp();
  }

  const result = spawnSync(
    "npx",
    ["playwright", "test", "-c", "playwright.local.config.ts", "e2e/local-url-smoke.spec.ts", "--reporter=line"],
    {
      stdio: "inherit",
      shell: true,
      timeout: PLAYWRIGHT_TIMEOUT_MS,
      env: {
        ...process.env,
        PORT,
        PLAYWRIGHT_BASE_URL: BASE_URL,
        PLAYWRIGHT_EXTERNAL_DEV_SERVER: "1",
        PLAYWRIGHT_BROWSER_CHANNEL: BROWSER_CHANNEL,
        BROWSER_WALKTHROUGH_SCREENSHOTS_DIR: SCREENSHOTS_DIR,
        LOCAL_BROWSER_TEST_PATH: TARGET_PATH,
        LOCAL_BROWSER_EXPECT_TEXT: EXPECT_TEXT,
      },
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`Local URL smoke stopped before completion (${result.signal}).`);
  }

  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await stopDevServer();
}

process.exit(exitCode);
