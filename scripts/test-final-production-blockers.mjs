#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativeFile) {
  return readFileSync(path.join(root, relativeFile), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok ${message}`);
  }
}

const paymentDialog = read("client/src/components/billing/payment-dialog.tsx");
assert(paymentDialog.includes('import { useAuth } from "@/hooks/use-auth";'), "payment dialog reads authenticated user");
assert(paymentDialog.includes("receivedBy: user.id"), "payment receipt actor uses current user id");
assert(!paymentDialog.includes("receivedBy: 1"), "payment receipt actor is not hardcoded");

const storage = read("server/storage.ts");
assert(storage.includes("INVENTORY_ITEM_MISSING"), "missing inventory item uses structured error code");
assert(!storage.includes("item: inventoryItem ?? placeholder"), "inventory detail paths do not manufacture item data");
assert(!storage.includes('name: "Unknown item"'), "storage does not create fake unknown inventory item records");

const fallbackHook = read("client/src/hooks/use-fallback-state.ts");
const fallbackStore = read("client/src/lib/fallback-store.ts");
assert(!/\bDEMO\b/.test(fallbackHook), "fallback hook does not expose demo badge");
assert(!/\bDEMO\b/.test(fallbackStore), "fallback store does not expose demo badge");
assert(fallbackStore.includes('export type SystemBadge = "LIVE" | "DEGRADED"'), "fallback badge has production-safe states");

const logistics = read("client/src/pages/logistics.tsx");
const exceptions = read("client/src/pages/exceptions.tsx");
assert(!/run the demo|Overview \/ Demo|logistics-outbound-placeholder/i.test(logistics), "logistics route removes production demo wording");
assert(logistics.includes("logistics-outbound-v1-excluded"), "logistics outbound path is explicitly v1-excluded");
assert(!/run the demo|Overview \/ Demo/i.test(exceptions), "exceptions route removes production demo wording");

const operationsCore = read("server/modules/operations/operations-core.ts");
assert(!/Create demo purchase order|DEMO-WALKTHROUGH|PO-DEMO|Demo Carrier|Demo walkthrough/i.test(operationsCore), "operations walkthrough avoids production demo labels");
assert(operationsCore.includes("Create guided purchase order"), "operations walkthrough uses guided setup wording");

const workflowFile = ".github/workflows/playwright-release-gate.yml";
assert(existsSync(path.join(root, workflowFile)), "Playwright release gate workflow exists with requested filename");
const workflow = read(workflowFile);
for (const required of [
  "npm ci",
  "npm run verify:package-manifests",
  "npm run verify:production-base",
  "npm run build",
  "npx playwright install --with-deps chromium",
  "npm run verify:release:e2e",
]) {
  assert(workflow.includes(required), `Playwright release gate runs ${required}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("Final production blocker regression checks passed.");
