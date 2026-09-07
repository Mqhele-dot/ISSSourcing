import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("migrations/20260830143000_procurement_completion.sql");
const routes = read("server/modules/procurement-completion/register-procurement-completion-routes.ts");
const procurement = read("server/modules/procurement/register-procurement-routes.ts");
const sourcing = read("server/modules/sourcing/service.ts");
const router = read("client/src/router.tsx");
const routeRegistry = read("client/src/lib/routes/app-routes.ts");
const authority = read("shared/authority-catalogs.ts");
const receivingPage = read("client/src/pages/procurement-receiving.tsx");

for (const table of [
  "procurement_feature_settings",
  "po_supplier_confirmations",
  "supplier_contract_lines",
  "supplier_contract_releases",
  "supplier_price_lists",
  "finance_budgets",
  "budget_commitments",
  "goods_receipt_reversals",
  "purchase_returns",
  "supplier_debit_notes",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be migrated`);
}

assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS (goods_receipts|grns)\b/i, "receiving must reuse canonical receipt evidence");
assert.match(routes, /FROM ap_receipts r/, "v2 receiving must read canonical AP receipts");
assert.match(routes, /RECEIPT_REVERSAL/, "receipt reversal must create compensating stock movements");
assert.match(routes, /SELECT \* FROM supplier_contract_releases WHERE organization_id=\$1 AND idempotency_key=\$2/, "contract release retries must resolve before value mutation");
assert.match(routes, /already_returned/, "return validation must account for earlier non-cancelled returns");
assert.match(routes, /reserveRequisitionBudget/, "approval must reserve Finance budget capacity");
assert.match(procurement, /source_type='REQUISITION'.*status='ACTIVE'/s, "PO conversion must transfer the requisition commitment");
assert.match(procurement, /po_supplier_confirmations[\s\S]*'AWAITING'/, "PO dispatch must create supplier confirmation evidence");
assert.match(sourcing, /RFQ_EARLY_CLOSE_REASON_REQUIRED/, "early RFQ close must require a reason");
assert.match(sourcing, /AWARD_QUOTE_EXPIRED/, "expired quotes must be guarded at award");

for (const path of ["overview", "receiving", "settings", "rfqs", "analytics", "exceptions"]) {
  assert.match(routeRegistry, new RegExp(`${path}:`), `procurement route registry must include ${path}`);
}
for (const route of ["APP_ROUTES.procurement.overview", "APP_ROUTES.procurement.receiving", "APP_ROUTES.procurement.settings"]) {
  assert.ok(router.includes(route), `${route} must be mounted`);
}
for (const workflow of ["contract_release", "receipt_reversal", "budget_override", "purchase_return", "supplier_debit_note"]) {
  assert.ok(authority.includes(`\"${workflow}\"`), `${workflow} must be governed`);
}
assert.match(receivingPage, /Goods receipt evidence/, "receiving UI must expose canonical evidence");
assert.doesNotMatch(receivingPage, /asChild><a href=\{`\/api\/v2\/procurement\/receipts/, "receipt review must not navigate users to raw JSON");

console.log("Procurement completion contract checks passed.");
