#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const rawUrl =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.CODESPACE_APP_URL ||
  process.env.APP_URL ||
  process.argv[2];

if (!rawUrl) {
  console.error(
    [
      "Remote app URL is required.",
      "Example:",
      "  $env:PLAYWRIGHT_BASE_URL='https://your-codespace-5000.app.github.dev'",
      "  npm run test:codespace:browser",
    ].join("\n"),
  );
  process.exit(1);
}

const BASE_URL = rawUrl.replace(/\/+$/, "");
const READY_URL = `${BASE_URL}/api/ready`;
const AUTH_URL = `${BASE_URL}/auth`;
const SCREENSHOTS_DIR =
  process.env.BROWSER_WALKTHROUGH_SCREENSHOTS_DIR ||
  "test-results/remote-browser-walkthrough";
const BROWSER_CHANNEL = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";
const PLAYWRIGHT_TIMEOUT_MS = Number(process.env.REMOTE_BROWSER_PLAYWRIGHT_TIMEOUT_MS || 180_000);

function formatProbe(label, result) {
  if (result.ok) return `${label}: ok status=${result.status} (${result.elapsedMs}ms)`;
  return `${label}: FAIL error=${result.error ?? "unknown"} (${result.elapsedMs}ms)`;
}

try {
  new URL(BASE_URL);
} catch {
  console.error(`Invalid remote app URL: ${BASE_URL}`);
  process.exit(1);
}

console.log("\nRemote browser walkthrough");
console.log(`Base URL: ${BASE_URL}`);
console.log(`Browser: ${BROWSER_CHANNEL}`);
console.log(`Screenshots: ${SCREENSHOTS_DIR}\n`);

const ready = await probeUrl(READY_URL, { timeoutMs: 15_000 });
const auth = await probeUrl(AUTH_URL, { timeoutMs: 30_000 });

console.log(formatProbe("ready", ready));
console.log(formatProbe("auth", auth));

if (!ready.ok || !auth.ok) {
  console.error(
    [
      "",
      "Remote app is not reachable enough for browser testing.",
      "In Codespaces, make sure:",
      "  - the app is running",
      "  - port 5000 is Public",
      "  - the URL points to the forwarded 5000 app",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync(
  process.platform === "win32" ? "cmd.exe" : "npx",
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npx playwright test -c playwright.browser.config.ts e2e/local-browser-walkthrough.spec.ts --reporter=line"]
    : [
        "playwright",
        "test",
        "-c",
        "playwright.browser.config.ts",
        "e2e/local-browser-walkthrough.spec.ts",
        "--reporter=line",
      ],
  {
    stdio: "inherit",
    shell: false,
    timeout: PLAYWRIGHT_TIMEOUT_MS,
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: BASE_URL,
      PLAYWRIGHT_BROWSER_CHANNEL: BROWSER_CHANNEL,
      BROWSER_WALKTHROUGH_SCREENSHOTS_DIR: SCREENSHOTS_DIR,
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`Remote browser walkthrough stopped before completion (${result.signal}).`);
  process.exit(1);
}

process.exit(result.status ?? 1);
