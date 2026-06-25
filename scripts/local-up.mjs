#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const READY_URL = `${BASE_URL}/api/ready`;
const AUTH_URL = `${BASE_URL}/auth`;
const START_TIMEOUT_MS = Number(process.env.LOCAL_UP_TIMEOUT_MS || 120_000);
const DEV_COMMAND = process.env.LOCAL_UP_DEV_COMMAND || "npm run dev";

const checkOnly = process.argv.includes("--check-only");

function formatProbe(label, result) {
  if (result.ok) {
    return `${label}: ok status=${result.status} (${result.elapsedMs}ms)`;
  }
  return `${label}: FAIL error=${result.error ?? "unknown"} (${result.elapsedMs}ms)`;
}

async function probePair(timeoutMs) {
  const ready = await probeUrl(READY_URL, { timeoutMs });
  const auth = ready.ok ? await probeUrl(AUTH_URL, { timeoutMs }) : await probeUrl(AUTH_URL, { timeoutMs });
  return { ready, auth };
}

async function waitForHealthyServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = await probePair(5_000);

  while (Date.now() < deadline) {
    if (last.ready.ok && last.auth.ok) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    last = await probePair(5_000);
  }

  throw new Error(
    [
      `Timed out waiting for ${BASE_URL}.`,
      formatProbe("ready", last.ready),
      formatProbe("auth", last.auth),
      `Manual checks: curl -i ${READY_URL}`,
      `Manual checks: curl -i ${AUTH_URL}`,
    ].join("\n"),
  );
}

function spawnDevServer() {
  const child = spawn(DEV_COMMAND, [], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PORT },
  });
  return child;
}

async function stopProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill();

  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  }
}

let devProc = null;
let requestedExitCode = 0;
let reuseExistingServer = false;

try {
  console.log(`Local app helper`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Mode: ${checkOnly ? "check-only" : "start-and-hold"}`);

  const existing = await probePair(3_000);
  if (existing.ready.ok && existing.auth.ok) {
    console.log("Existing local app detected.");
    console.log(formatProbe("ready", existing.ready));
    console.log(formatProbe("auth", existing.auth));
    requestedExitCode = 0;
    reuseExistingServer = true;
  }

  if (checkOnly && !reuseExistingServer) {
    throw new Error(
      [
        `Local app is not reachable at ${BASE_URL}.`,
        formatProbe("ready", existing.ready),
        formatProbe("auth", existing.auth),
        "Run `npm run local:up` in another terminal first.",
      ].join("\n"),
    );
  }

  if (!reuseExistingServer) {
    console.log(`Starting dev server with: ${DEV_COMMAND}`);
    devProc = spawnDevServer();
    const healthy = await waitForHealthyServer(START_TIMEOUT_MS);
    console.log("Local app is ready.");
    console.log(formatProbe("ready", healthy.ready));
    console.log(formatProbe("auth", healthy.auth));
    console.log(`Try: curl -i ${READY_URL}`);
    console.log(`Try: curl -i ${AUTH_URL}`);
  }

  const handleSignal = async () => {
    await stopProcessTree(devProc);
    requestedExitCode = 0;
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  if (devProc) {
    await new Promise((resolve, reject) => {
      devProc.on("exit", (code) => {
        if (code === 0 || code === null) {
          resolve();
          return;
        }
        reject(new Error(`Local dev server exited with ${code}`));
      });
      devProc.on("error", reject);
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  requestedExitCode = 1;
} finally {
  await stopProcessTree(devProc);
}

process.exitCode = requestedExitCode;
