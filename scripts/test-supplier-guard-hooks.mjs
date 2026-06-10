#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supplierDefaults = readFileSync(new URL("../server/modules/procurement/supplier-defaults.ts", import.meta.url), "utf8");
const procurementRoutes = readFileSync(new URL("../server/modules/procurement/register-procurement-routes.ts", import.meta.url), "utf8");
const apService = readFileSync(new URL("../server/modules/accounts-payable/service.ts", import.meta.url), "utf8");
const apRoutes = readFileSync(new URL("../server/modules/accounts-payable/register-ap-routes.ts", import.meta.url), "utf8");
const databaseStorage = readFileSync(new URL("../server/database-storage.ts", import.meta.url), "utf8");

assert.match(
  supplierDefaults,
  /if \(status === "inactive"\)[\s\S]*SUPPLIER_INACTIVE/,
  "supplier guard should reject inactive suppliers",
);
assert.match(
  supplierDefaults,
  /if \(status === "blocked" \|\| complianceStatus === "blocked"\)[\s\S]*SUPPLIER_BLOCKED/,
  "supplier guard should require explicit blocked status before rejecting transactions",
);
assert.doesNotMatch(
  supplierDefaults,
  /if \(status === "blocked" \|\| complianceStatus === "blocked" \|\| blockedReason\)/,
  "blockedReason alone should not freeze otherwise-active suppliers",
);

assert.match(
  procurementRoutes,
  /assertSupplierTransactionAllowed\([\s\S]*"new requisitions"/,
  "procurement routes should block inactive suppliers when creating requisitions",
);
assert.match(
  procurementRoutes,
  /assertSupplierTransactionAllowed\([\s\S]*"updated requisitions"/,
  "procurement routes should block inactive suppliers when updating requisitions",
);
assert.match(
  databaseStorage,
  /applySupplierDefaultsToPurchaseOrder\({[\s\S]*taxCodeId:/,
  "requisition conversion should flow through centralized supplier defaults",
);
assert.match(
  apService,
  /resolveSupplierCommercialDefaults\(supplierId,\s*\{[\s\S]*transactionLabel:\s*"new AP invoices"/,
  "AP invoice creation should reuse the centralized supplier commercial default resolver",
);
assert.match(
  apService,
  /resolveSupplierCommercialDefaults\(input\.supplierId,\s*\{[\s\S]*transactionLabel:\s*"new AP captures"/,
  "AP capture creation should reuse the centralized supplier commercial default resolver",
);
assert.match(
  apRoutes,
  /if \(e\?\.code && e\?\.status\) \{[\s\S]*sendError\(res, e\.status, e\.code/,
  "AP routes should surface supplier guard error codes to clients",
);

console.log("test-supplier-guard-hooks: all checks passed.");
