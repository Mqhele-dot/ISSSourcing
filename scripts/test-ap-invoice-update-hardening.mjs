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
  "server/modules/accounts-payable/service.ts",
  /AP_INVOICE_COMMERCIAL_RELINK_LOCKED/,
  "draft-only AP invoice commercial relink guard",
);
assertContains(
  "server/modules/accounts-payable/service.ts",
  /resolveSupplierCommercialDefaults\(nextSupplierId,\s*\{\s*transactionLabel:\s*"updated AP invoices"/,
  "supplier defaults re-applied on AP invoice update",
);
assertContains(
  "server/modules/accounts-payable/service.ts",
  /invoiceNumberExistsForSupplier\(\{\s*orgId:\s*getActiveOrganizationId\(\),[\s\S]{0,240}excludeInvoiceId:\s*invoiceId/s,
  "duplicate supplier invoice guard on AP invoice update",
);
assertContains(
  "server/modules/accounts-payable/register-ap-routes.ts",
  /if \(e\?\.code && e\?\.status\) \{\s*return sendError\(res,\s*e\.status,\s*e\.code,\s*e\.message \|\| "Failed to update invoice"\);/s,
  "AP invoice update route preserves service status codes",
);

console.log("AP invoice update hardening checks passed.");
