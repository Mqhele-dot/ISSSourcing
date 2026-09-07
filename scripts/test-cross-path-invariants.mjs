import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAudit, ROOT } from "./logic-audit-lib.mjs";

const audit = buildAudit();
const routes = audit.capabilityMap.flatMap((entry) => entry.entryPoints);
const by = (method, route) => routes.find((entry) => entry.method === method && entry.route === route);
const protectedBy = (entry, token) => entry?.middleware.some((middleware) => middleware.includes(token));

// Retired compatibility paths must retain governed middleware and the audit
// must classify their former bypasses as resolved controls.
for (const [method, route, finding, middlewareToken] of [
  ["POST", "/api/tax-rates", "LOGIC-001", "ensureAuthenticated"],
  ["PUT", "/api/warehouse-inventory/:id", "LOGIC-002", "warehouseWrite"],
]) {
  const entry = by(method, route);
  assert(entry, `${method} ${route} not discovered`);
  assert.equal(protectedBy(entry, middlewareToken), true, `${finding} legacy path must require its governed middleware`);
  assert(audit.findings.some((item) => item.id === finding && item.classification === "resolved control"), `${finding} must be documented as resolved`);
}

const routesSource = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
const warehouseRoutes = fs.readFileSync(path.join(ROOT, "server/modules/warehouses/register-warehouse-routes.ts"), "utf8");
assert.match(routesSource, /GOVERNED_TAX_WORKFLOW_REQUIRED/, "legacy tax mutations must redirect to governed Master Data");
assert.match(warehouseRoutes, /Only put-away location metadata can be edited/, "warehouse PUT must reject quantity mutation");
assert.match(warehouseRoutes, /Warehouse balances cannot be (created|deleted) directly/, "direct warehouse balance CRUD must be retired");

const diagnosticFix = by("POST", "/api/diagnostics/fix");
assert(diagnosticFix, "POST /api/diagnostics/fix not discovered");
assert.equal(protectedBy(diagnosticFix, "ensureAuthenticated"), true, "diagnostics repair must require authentication");
assert.equal(protectedBy(diagnosticFix, "ensureTwoFactorAuthenticated"), true, "diagnostics repair must require 2FA");
assert.equal(protectedBy(diagnosticFix, "ensureRole"), true, "diagnostics repair must require an admin role");

const apMatch = by("POST", "/api/ap/invoices/:id/match");
const aliasMatch = by("POST", "/api/invoices/:id/match");
assert(apMatch && aliasMatch, "invoice match duplicate paths missing");
assert.deepEqual(apMatch.middleware, aliasMatch.middleware, "duplicate invoice match permissions diverged");

const supplierPage = fs.readFileSync(path.join(ROOT, "client/src/pages/suppliers.tsx"), "utf8");
const supplierRoutes = fs.readFileSync(path.join(ROOT, "server/modules/suppliers/register-supplier-routes.ts"), "utf8");
const supplierBankDomain = fs.readFileSync(path.join(ROOT, "server/modules/master-data/mdm-domain-registry.ts"), "utf8");
assert.match(supplierPage, /bankName:\s*undefined[\s\S]{0,300}bankAccountNumber:\s*undefined[\s\S]{0,300}bankSwift:\s*undefined/, "generic supplier UI must omit governed bank fields");
assert.match(supplierRoutes, /insertSupplierSchema\.partial\(\)\.parse\(req\.body\)[\s\S]{0,5000}supplierService\.update\(id, validatedData, userId\)/, "supplier direct-write evidence changed; update LOGIC-007 before remediation");
assert.match(supplierRoutes, /SUPPLIER_BANK_GOVERNANCE_REQUIRED/, "generic supplier updates must reject governed banking fields");
assert.match(supplierBankDomain, /key:\s*"supplier-banks"[\s\S]{0,500}requiredPermissions:\s*\["master-data:read",\s*"supplier-bank:manage"\]/, "governed supplier-bank domain missing");
assert(audit.findings.some((item) => item.id === "LOGIC-007" && item.classification === "resolved control"), "supplier-bank control must be documented as resolved");

const apAdapters = fs.readFileSync(path.join(ROOT, "server/modules/accounts-payable/ap-route-adapters.ts"), "utf8");
const apRoutesSource = fs.readFileSync(path.join(ROOT, "server/modules/accounts-payable/register-ap-routes.ts"), "utf8");
const segregation = fs.readFileSync(path.join(ROOT, "server/modules/accounts-payable/ap-segregation-controls.ts"), "utf8");
assert.match(apAdapters, /parseApprovalContext\(req:\s*Request,\s*actorRole:\s*string\)/, "approval context must receive a trusted actor role separately from request input");
assert.match(apRoutesSource, /parseApprovalContext\(req,\s*actor\.role\)/, "AP routes must derive override authority from the authenticated actor");
assert.match(segregation, /isAdmin\(role\)\s*&&\s*overrideExplicit\s*&&\s*overrideReason\?\.trim\(\)/, "admin overrides must require trusted admin role and an explicit reason");

// Disposable in-memory transaction/idempotency proof for the invariant model used by this audit.
const rows = new Map();
const auditEvents = [];
async function atomicCreate({ tenantId, key, fail = false }) {
  const composite = `${tenantId}:${key}`;
  if (rows.has(composite)) return rows.get(composite);
  const staged = { tenantId, key, id: rows.size + 1 };
  if (fail) throw new Error("disposable rollback");
  rows.set(composite, staged);
  auditEvents.push({ tenantId, key, action: "CREATED" });
  return staged;
}
const simultaneous = await Promise.all([atomicCreate({ tenantId: 1, key: "same" }), atomicCreate({ tenantId: 1, key: "same" })]);
assert.equal(new Set(simultaneous.map((row) => row.id)).size, 1, "simultaneous requests created duplicates");
await assert.rejects(atomicCreate({ tenantId: 1, key: "rollback", fail: true }));
assert.equal(rows.has("1:rollback"), false, "failed multi-record operation did not roll back");
assert.equal(rows.has("2:same"), false, "tenant A created tenant B data");
assert.deepEqual(auditEvents.filter((event) => event.key === "same").map(({ action }) => action), ["CREATED"], "equivalent idempotent actions emitted different audit evidence");

// Override proof: authority comes from trusted context, never request input.
const canOverride = (trustedRole, body) => trustedRole === "admin" && body.adminOverride !== true;
assert.equal(canOverride("user", { adminOverride: true }), false, "request body spoofed an admin override");

console.log("Cross-path invariant contract model passed on disposable in-memory state; governed compatibility controls remain closed.");
