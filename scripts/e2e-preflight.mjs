#!/usr/bin/env node
/**
 * Quick check that the app is reachable at /api/ready and /auth (same targets as the E2E wrapper).
 */
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const PORT = process.env.PORT || "5000";
const READY_URL = process.env.PLAYWRIGHT_E2E_READY_URL || `http://127.0.0.1:${PORT}/api/ready`;
const AUTH_URL = process.env.PLAYWRIGHT_E2E_AUTH_URL || `http://127.0.0.1:${PORT}/auth`;

function line(label, r) {
  if (r.ok) return `  ${label}: reachable (HTTP ${r.status}) ${r.elapsedMs}ms`;
  return `  ${label}: NOT reachable — ${r.error} (${r.elapsedMs}ms)`;
}

async function main() {
  console.log("E2E preflight (expect dev server already running: npm run dev)\n");
  const ready = await probeUrl(READY_URL, { timeoutMs: 10_000 });
  const auth = await probeUrl(AUTH_URL, { timeoutMs: 15_000 });

  console.log(line(READY_URL, ready));
  console.log(line(AUTH_URL, auth));

  if (!ready.ok || !auth.ok) {
    console.log("\nNext steps:");
    console.log("  Terminal 1: npm run dev");
    console.log(`  Terminal 2: curl -i ${READY_URL}`);
    console.log(`              curl -i ${AUTH_URL}`);
    console.log("              npm run test:e2e");
    process.exit(1);
  }

  console.log("\nPreflight OK — you can run: npm run test:e2e\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
