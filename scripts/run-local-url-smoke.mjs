#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;
const READY_URL = `${BASE_URL}/api/ready`;
const AUTH_URL = `${BASE_URL}/auth`;
const TARGET_PATH = process.env.LOCAL_BROWSER_TEST_PATH || "/inventory/cycle-counts";
const DEV_COMMAND = process.env.LOCAL_BROWSER_DEV_COMMAND || "npm run local:serve";
const START_TIMEOUT_MS = Number(process.env.LOCAL_BROWSER_URL_TIMEOUT_MS || 120_000);
const PLAYWRIGHT_TIMEOUT_MS = Number(process.env.LOCAL_BROWSER_PLAYWRIGHT_TIMEOUT_MS || 180_000);
const BROWSER_CHANNEL = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";

let devProc = null;
let devExitInfo = null;

function formatProbe(label, result) {
  if (result.ok) return `${label}: ok status=${result.status} (${result.elapsedMs}ms)`;
  return `${label}: FAIL error=${result.error ?? "unknown"} (${result.elapsedMs}ms)`;
}

function spawnDevServer() {
  const command = process.platform === "win32" ? "cmd.exe" : DEV_COMMAND;
  const args = process.platform === "win32" ? ["/d", "/s", "/c", DEV_COMMAND] : [];
  devProc = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      PORT,
      HOST: process.env.HOST || "127.0.0.1",
      RUNTIME_DEPLOYMENT: process.env.RUNTIME_DEPLOYMENT || "development",
      ALLOW_UNVERIFIED_EMAIL_LOGIN: process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN || "true",
      DEV_TEST_LOGIN_ENABLED: process.env.DEV_TEST_LOGIN_ENABLED || "true",
      SKIP_PRODUCT_ONBOARDING: process.env.SKIP_PRODUCT_ONBOARDING || "true",
      ALLOW_SETUP_SKIP: process.env.ALLOW_SETUP_SKIP || "true",
      AUTO_SEED_ON_EMPTY_DB: process.env.AUTO_SEED_ON_EMPTY_DB || "true",
    },
  });
  devProc.on("exit", (code, signal) => {
    devExitInfo = { code, signal };
  });
}

async function waitForApp() {
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
    auth = ready.ok ? await probeUrl(AUTH_URL, { timeoutMs: 10_000 }) : auth;
    if (ready.ok && auth.ok) return;

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
  console.log(`Target: ${TARGET_PATH}`);
  console.log(`Browser: ${BROWSER_CHANNEL}\n`);

  const quickReady = await probeUrl(READY_URL, { timeoutMs: 3_000 });
  const quickAuth = await probeUrl(AUTH_URL, { timeoutMs: 3_000 });

  if (quickReady.ok && quickAuth.ok) {
    console.log("Existing local app detected; reusing it.");
  } else {
    console.log("Starting the full local app for URL smoke testing.");
    spawnDevServer();
    await waitForApp();
  }

  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "-c",
      "playwright.config.ts",
      "e2e/local-url-smoke.spec.ts",
      "--reporter=line",
    ],
    {
      stdio: "inherit",
      shell: false,
      timeout: PLAYWRIGHT_TIMEOUT_MS,
      env: {
        ...process.env,
        PORT,
        PLAYWRIGHT_BASE_URL: BASE_URL,
        PLAYWRIGHT_EXTERNAL_DEV_SERVER: "1",
        PLAYWRIGHT_BROWSER_CHANNEL: BROWSER_CHANNEL,
        PLAYWRIGHT_VIDEO: "off",
        PLAYWRIGHT_USE_DEV_TEST_LOGIN: process.env.PLAYWRIGHT_USE_DEV_TEST_LOGIN || "1",
        LOCAL_BROWSER_TEST_PATH: TARGET_PATH,
      },
    },
  );

  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Local URL smoke stopped before completion (${result.signal}).`);
  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await stopDevServer();
}

process.exit(exitCode);
