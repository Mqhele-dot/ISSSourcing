import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("migrations/20260830143000_procurement_completion.sql");
const blanketMigration = read("migrations/20260907120000_blanket_agreements_completion.sql");
const routes = read("server/modules/procurement-completion/register-procurement-completion-routes.ts");
const procurement = read("server/modules/procurement/register-procurement-routes.ts");
const sourcing = read("server/modules/sourcing/service.ts");
const router = read("client/src/router.tsx");
const routeRegistry = read("client/src/lib/routes/app-routes.ts");
const authority = read("shared/authority-catalogs.ts");
const receivingPage = read("client/src/pages/procurement-receiving.tsx");
const agreementsPage = read("client/src/pages/blanket-agreements.tsx");
const capabilities = read("shared/erp-capability-catalog.ts");

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
assert.match(routes, /supplier_contract_releases r JOIN purchase_orders po[\s\S]*idempotency_key=\$2/, "contract release retries must resolve with their PO evidence before value mutation");
for (const table of ["supplier_contract_price_breaks", "supplier_contract_versions", "supplier_contract_release_lines"]) {
  assert.match(blanketMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must preserve blanket agreement evidence`);
}
assert.match(routes, /upper\(status\)='APPROVED'.*FOR UPDATE/, "blanket releases require and lock an approved requisition");
assert.match(routes, /INSERT INTO purchase_orders/, "blanket release must generate its PO transactionally");
assert.match(routes, /UPDATE supplier_contract_lines SET committed_quantity=committed_quantity\+\$1/, "release must consume line quantity");
assert.match(routes, /AGREEMENT_AMENDMENT_OPENED/, "approved agreement changes must create immutable version evidence");
assert.match(routes, /app\.patch\("\/api\/v2\/procurement\/contracts\/:id"/, "draft agreement headers must be editable");
assert.match(routes, /STALE_AGREEMENT_VERSION/, "draft edits must reject concurrent stale versions");
assert.match(blanketMigration, /approval_status IN \('DRAFT', 'PENDING_APPROVAL'\)[\s\S]*status = 'active'/, "legacy unapproved agreements must be removed from active pricing authority");
assert.match(routes, /contracts\/:id\/document\.pdf/, "agreements must expose a canonical branded PDF");
assert.match(agreementsPage, /Blanket purchase agreements/, "production contracts route must expose the agreement workspace");
assert.match(agreementsPage, /Create release purchase order/, "agreement UI must expose approved-requisition release creation");
assert.match(agreementsPage, /Edit draft/, "agreement UI must expose governed draft editing");
assert.match(agreementsPage, /Preview agreement PDF/, "agreement UI must expose its generated agreement document");
assert.match(capabilities, /partial:\["Purchase contracts"/, "capability catalog must not overstate blanket purchasing before its full release gate");
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
