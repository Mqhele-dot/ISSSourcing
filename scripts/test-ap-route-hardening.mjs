#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertContains(file, pattern, label) {
  const text = read(file);
  if (!pattern.test(text)) {
    throw new Error(`${label} missing in ${file}`);
  }
}

assertContains(
  "server/modules/accounts-payable/ap-route-validation.ts",
  /export const apApprovalActionBodySchema = z/,
  "shared AP approval action schema",
);
assertContains(
  "server/modules/accounts-payable/ap-route-validation.ts",
  /overrideReason is required when adminOverride is true\./,
  "override reason validation",
);
assertContains(
  "server/modules/accounts-payable/ap-route-adapters.ts",
  /comment:\s*typeof req\.body\?\.comment === "string" \? req\.body\.comment : undefined/,
  "approval context comment propagation",
);
assertContains(
  "server/modules/accounts-payable/service.ts",
  /comment:\s*context\.comment \?\? context\.overrideReason \?\? null/,
  "release approval history comment fallback",
);
assertContains(
  "server/modules/accounts-payable/service.ts",
  /reason:\s*context\.comment \?\? context\.overrideReason \?\? null/,
  "release audit reason fallback",
);
assertContains(
  "server/modules/accounts-payable/register-ap-routes.ts",
  /function paymentBatchReleaseHttpStatus/,
  "payment batch release error mapper",
);
assertContains(
  "server/modules/accounts-payable/register-ap-routes.ts",
  /PAYMENT_BATCH_RELEASE_INVALID_STATE/,
  "invalid release state code",
);
assertContains(
  "server/modules/accounts-payable/register-ap-routes.ts",
  /PAYMENT_BATCH_RELEASE_INVOICE_INVALID/,
  "invoice release validation code",
);
assertContains(
  "server/modules/accounts-payable/register-ap-routes.ts",
  /const body = apApprovalActionBodySchema\.parse\(req\.body \?\? \{\}\);/,
  "approval action body parsing",
);

console.log("AP route hardening contract checks passed.");
