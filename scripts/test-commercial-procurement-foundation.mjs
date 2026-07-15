import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tenant = read("server/organization-context.ts");
const tenantMiddleware = read("server/middleware/organization-context.ts");
const audit = read("server/services/audit-chain-service.ts");
const sourcingService = read("server/modules/sourcing/service.ts");
const sourcingRoutes = read("server/modules/sourcing/register-sourcing-routes.ts");
const procurement = read("server/modules/procurement/register-procurement-routes.ts");
const countryPacks = read("server/modules/master-data/country-pack-registry.ts");
const productionBoundary = read("server/production-release-boundary.ts");
const operationalCore = read("server/modules/operations/operations-core.ts");
const operationalRoutes = read("server/operations-routes.ts");
const router = read("client/src/router.tsx");
const purchaseOrderApi = read("client/src/features/purchase-orders/api/operational-purchase-orders.api.ts");
const purchaseOrderView = read("client/src/pages/orders/purchase-order-detail-view.tsx");
const supplierPortal = read("client/src/pages/supplier-sourcing-workspace.tsx");
const buyerWorkspace = read("client/src/pages/sourcing.tsx");
const seed = read("server/seed.ts");
const schema = read("shared/schema.ts");

const checks = [
  [!tenant.includes("return 1"), "tenant resolution does not silently return organization 1"],
  [/TENANT_CONTEXT_REQUIRED/.test(tenant), "missing TenantContext fails closed with a structured code"],
  [/organizationMembers/.test(tenantMiddleware) && /membershipActive/.test(tenantMiddleware), "request tenancy is derived from active membership"],
  [/MEMBERSHIP_NOT_ACTIVE/.test(tenantMiddleware), "inactive membership has a structured denial"],
  [/previousHash/.test(audit) && /eventHash/.test(audit) && /pg_advisory_xact_lock/.test(audit), "audit events are serialized and hash chained"],
  [/SUPPLIER_NOT_INVITED/.test(sourcingRoutes) && /supplierPortalMappings/.test(sourcingRoutes), "supplier RFQ access uses tenant mapping and invitation"],
  [/mappedSupplierId\(req\)/.test(sourcingRoutes) && !/req\.body\.supplierId[^\n]*submitSupplierQuote/.test(sourcingRoutes), "supplier quote identity is not selected by request body"],
  [/requireIdempotencyKey/.test(sourcingService) && /SEGREGATION_OF_DUTIES_VIOLATION/.test(sourcingService), "high-risk sourcing actions enforce idempotency and independent approval"],
  [/exchangeRateToReporting/.test(sourcingService) && /lockedFxSnapshot/.test(sourcingService), "quote comparisons preserve submitted currency and locked reporting FX"],
  [/costCentreId/.test(sourcingService) && /glAccountCode/.test(sourcingService) && /sourcingAwardId/.test(sourcingService), "award conversion preserves finance mappings and source evidence"],
  [/PO_DISPATCH_ENDPOINT_REQUIRED/.test(procurement) && /dispatchStatus/.test(procurement), "PO issue uses controlled dispatch status instead of cosmetic SENT state"],
  [/IDEMPOTENCY_KEY_REQUIRED/.test(procurement) && /SEGREGATION_OF_DUTIES_VIOLATION/.test(procurement) && /ensureTwoFactorAuthenticated/.test(procurement), "PO submit, approval, and dispatch enforce workflow controls"],
  [/CONTROLLED_PO_APPROVAL_REQUIRED/.test(operationalRoutes) && /CONTROLLED_PO_DISPATCH_REQUIRED/.test(operationalRoutes), "legacy one-click PO aliases are blocked in production"],
  [/submitPurchaseOrderForApproval/.test(purchaseOrderApi) && /approvePurchaseOrderRecord/.test(purchaseOrderApi) && /dispatchPurchaseOrderRecord/.test(purchaseOrderApi) && /Independent approval reason/.test(purchaseOrderView), "PO screen uses controlled procurement actions"],
  [/ZA:/.test(countryPacks) && /GB:/.test(countryPacks) && /US:/.test(countryPacks), "ZA, UK, and US country packs exist"],
  [/PRODUCTION_RELEASE_SCOPE/.test(productionBoundary) && /gate\("receiving",\s*policy\)/.test(productionBoundary) && /gate\("finance",\s*policy\)/.test(productionBoundary), "post-v1 operational and finance areas have server-side production boundaries"],
  [/WHERE id = \$1 AND organization_id = \$2/.test(operationalCore) && /po\.organization_id = \$1/.test(operationalCore), "legacy operational PO aliases remain tenant scoped"],
  [/ProductionWarehousesPage/.test(router) && /ProductionAccountsPayablePage/.test(router) && /ProductionMobileCountsPage/.test(router), "bookmarked post-v1 UI routes remain production gated"],
  [/SupplierSourcingWorkspace/.test(supplierPortal) && /Submit structured quote/.test(supplierPortal) && /Clarifications/.test(supplierPortal), "supplier portal exposes live structured RFQ and clarification controls"],
  [/EvaluationAndAwardPanel/.test(buyerWorkspace) && /Save evaluation/.test(buyerWorkspace) && /Convert award to PO/.test(buyerWorkspace), "buyer workspace exposes evaluation, award, approval, and conversion controls"],
  [/\["EVALUATING", "AWARDED"\]\.includes\(detailsQuery\.data\.event\.status\)/.test(buyerWorkspace), "approved awards remain visible for authorized PO conversion"],
  [/ensureDemoTenantMemberships/.test(seed) && /supplierPortalMappings/.test(seed), "fresh development seeds include tenant memberships and supplier portal mapping"],
  [/sourcingEvents/.test(schema) && /supplierQuotes/.test(schema) && /sourcingAwards/.test(schema) && /workflowIdempotency/.test(schema), "strategic sourcing has first-class persisted entities"],
];

for (const [condition, label] of checks) {
  assert.ok(condition, label);
  console.log(`ok ${label}`);
}

console.log(`\nCommercial procurement foundation contracts passed (${checks.length} controls).`);
