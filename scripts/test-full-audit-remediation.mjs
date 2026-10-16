import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [v2, towerServer, towerClient, gasService, apRoutes, invoices, operations, diagnostics, fixtureCatalog, sidebar, sections, rbac, warehouseCrud, poDetail, mobileCounts, analyticsQueries, exceptionsPage, apiClient, inventoryItem, reorder, routePrefetch] = await Promise.all([
  read("server/modules/v2/register-v2-routes.ts"),
  read("server/modules/operations/control-tower-dashboard.ts"),
  read("client/src/pages/control-tower.tsx"),
  read("server/modules/gas/gas-service.ts"),
  read("server/modules/accounts-payable/register-ap-routes.ts"),
  read("client/src/pages/invoices.tsx"),
  read("server/modules/operations/operations-core.ts"),
  read("server/diagnostics/diagnostic-findings-service.ts"),
  read("server/diagnostics/fixture-definition-catalog.ts"),
  read("client/src/components/sidebar.tsx"),
  read("client/src/lib/routes/section-metadata.ts"),
  read("server/modules/rbac/register-rbac-routes.ts"),
  read("client/src/pages/warehouses/use-warehouse-crud.tsx"),
  read("client/src/pages/orders/purchase-order-detail-view.tsx"),
  read("client/src/pages/mobile-counts.tsx"),
  read("client/src/pages/analytics-workspace/use-analytics-workspace-queries.ts"),
  read("client/src/pages/exceptions.tsx"),
  read("client/src/api/client.ts"),
  read("client/src/pages/inventory-item.tsx"),
  read("client/src/pages/reorder.tsx"),
  read("client/src/lib/routes/route-prefetch.ts"),
]);

assert.match(v2, /inArray\(purchaseOrders\.status, query\.statuses\)/, "multi-status PO filtering must use a parameterized IN predicate");
assert.doesNotMatch(v2, /= ANY\(\$\{query\.statuses\}/, "raw JavaScript arrays must not be interpolated into PostgreSQL ANY predicates");
assert.match(v2, /qtyOrdered/);
assert.match(v2, /qtyReceived/);
assert.match(v2, /receivable_item\.quantity > COALESCE\(receivable_item\.received_quantity, 0\)/);

assert.match(towerServer, /if \(av <= th\)[\s\S]*lowStock \+= 1/, "Control Tower low stock must include zero and negative availability");
assert.match(gasService, /42P01.*42703/, "optional LP-gas relation and legacy-column errors must degrade without failing canonical Fuel");
assert.match(towerClient, /logistics\}\?risk=late/, "delayed-shipment KPI must retain its risk filter");
assert.match(towerClient, /exceptions\}\?status=active/, "exception KPI must retain active-status scope");
assert.match(towerClient, /requisitions\}\?status=active/, "requisition KPI must retain active-work scope");
assert.match(towerClient, /orders\}\?status=active/, "purchase-order KPI must retain active-work scope");
assert.match(towerClient, /invoices\}\?attention=due/, "AP attention KPI must open the bounded due-invoice view");

assert.match(apRoutes, /eligibility: z\.enum\(\["all", "payable", "due"\]\)/);
assert.match(apRoutes, /invoice\.due_date < CURRENT_DATE \+ INTERVAL '8 days'/);
assert.match(invoices, /attention.*due[\s\S]*eligibility.*due/, "Invoices must translate the attention deep link into the server filter");
assert.match(operations, /normalizedStatus === "active"[\s\S]*IN \('open', 'in_progress'\)/);

assert.match(diagnostics, /fixtureDiagnosticUnionSql/);
assert.match(fixtureCatalog, /warehouses: "name ~\* '\^subrt-'/);
assert.match(fixtureCatalog, /organization_members fixture_member/);
assert.match(rbac, /al\.resource_id::text = \$2::text/);
assert.match(rbac, /ah\.entity_id::text/);

assert.match(sections, /label: "Company setup"[\s\S]*icon: "building-2"/);
assert.match(sidebar, /"building-2": Building2/);
assert.match(warehouseCrud, /invalidateMasterDataDomain\(queryClient, "warehouses"\)/);
assert.match(poDetail, /refetchOnMount: "always"/);
assert.match(mobileCounts, /warehouseName\(session\.warehouseId\)/);
assert.match(mobileCounts, /masterDataSection\("warehouses"\)/);

assert.match(analyticsQueries, /\/api\/dashboard\/control-tower/, "Analytics must use the same authoritative Control Tower service as Operations");
assert.doesNotMatch(analyticsQueries, /\/api\/control-tower\/overview/, "Analytics must not use the legacy Control Tower aggregate");
assert.match(operations, /listOperationalExceptionsPage/);
assert.match(operations, /JOIN supplier_contracts sc[\s\S]*WHERE po\.organization_id = \$1[\s\S]*\[organizationId\]/, "contract exception checks must bind the tenant parameter");
assert.match(exceptionsPage, /fetchExceptionsPageEnvelope/);
assert.match(exceptionsPage, />First<\/Button>/);
assert.match(exceptionsPage, />Last<\/Button>/);
assert.match(apiClient, /export type ExceptionPage/);
assert.match(inventoryItem, /aria-label="Inventory item category"/);
assert.match(inventoryItem, /aria-label="Inventory item status"/);
assert.match(inventoryItem, /aria-label="Item default warehouse"/);
assert.match(reorder, /<h1[^>]*>Reorder Requests<\/h1>/);
assert.match(routePrefetch, /\/analytics\/reports/);
assert.match(routePrefetch, /\/admin\/settings/);
assert.match(routePrefetch, /\/inventory\/reorder/);

console.log("Full-app audit remediation contracts passed.");
