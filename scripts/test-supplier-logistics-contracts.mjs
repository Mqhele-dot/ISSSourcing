#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supplierDefaults = readFileSync(new URL("../server/modules/procurement/supplier-defaults.ts", import.meta.url), "utf8");
const operationsCore = readFileSync(new URL("../server/modules/operations/operations-core.ts", import.meta.url), "utf8");
const operationsRoutes = readFileSync(new URL("../server/operations-routes.ts", import.meta.url), "utf8");
const supplierRoutes = readFileSync(new URL("../server/modules/suppliers/register-supplier-routes.ts", import.meta.url), "utf8");
const masterDataRoutes = readFileSync(new URL("../server/modules/master-data/register-master-data-routes.ts", import.meta.url), "utf8");
const logisticsPage = readFileSync(new URL("../client/src/pages/logistics.tsx", import.meta.url), "utf8");
const masterDataPage = readFileSync(new URL("../client/src/pages/master-data.tsx", import.meta.url), "utf8");

assert.match(
  supplierDefaults,
  /defaultCarrierId:\s*suppliers\.defaultCarrierId[\s\S]*defaultTransportMode:\s*suppliers\.defaultTransportMode/,
  "supplier diagnostics should load logistics defaults",
);
assert.match(
  supplierDefaults,
  /po\.supplier_id AS supplier_id[\s\S]*const inboundShipmentsBySupplier = new Map/,
  "supplier diagnostics should load shipment rows once and group them by supplier",
);
assert.match(
  supplierDefaults,
  /supplierId == null \? sql`` : sql`AND po\.supplier_id = \$\{supplierId\}`/,
  "supplier diagnostics should keep optional supplier filtering in the shared shipment query",
);
assert.match(
  supplierDefaults,
  /const inboundShipments = inboundShipmentsBySupplier\.get\(row\.id\) \?\? \[\];/,
  "supplier diagnostics should reuse grouped inbound shipments inside the supplier loop",
);
assert.match(
  supplierDefaults,
  /\(direction \?\? "inbound"\) !== "inbound"/,
  "supplier diagnostics should ignore non-inbound shipment directions",
);
assert.match(
  supplierDefaults,
  /Inbound shipment \$\{shipment\.shipmentId\} for PO \$\{shipment\.poNumber\} is missing carrierId[\s\S]*Inbound shipment \$\{shipment\.shipmentId\} for PO \$\{shipment\.poNumber\} uses transport mode \$\{shipment\.transportMode\}/,
  "supplier diagnostics should flag carrier and transport mode drift",
);

assert.match(
  operationsCore,
  /resolveSupplierCommercialDefaults\(poDefaults\.supplierId,\s*\{[\s\S]*transactionLabel:\s*"new inbound shipments"/,
  "shipment creation should resolve inbound shipment supplier defaults through the shared procurement module",
);
assert.match(
  operationsCore,
  /carrierId:\s*requestedCarrierId \?\? supplierDefaults\.carrierId \?\? null/,
  "shipment creation should default carrier from supplier defaults",
);
assert.match(
  operationsCore,
  /supplierDefaults\.transportMode \?\? null/,
  "shipment creation should default transport mode from supplier defaults",
);

assert.match(operationsRoutes, /SUPPLIER_INACTIVE/, "shipment routes should map inactive supplier errors");
assert.match(operationsRoutes, /SUPPLIER_BLOCKED/, "shipment routes should map blocked supplier errors");

assert.match(
  supplierRoutes,
  /const CARRIER_SUPPLIER_TYPES = new Set\(\["carrier", "logistics_provider"\]\)/,
  "supplier routes should define which supplier types produce carrier profiles",
);
assert.match(
  supplierRoutes,
  /supplierId:\s*supplier\.id[\s\S]*organizationId:\s*orgId/,
  "carrier profiles should retain their authoritative supplier and tenant ownership",
);
assert.match(
  supplierRoutes,
  /await syncCarrierProfile\(organizationId, approved\)/,
  "supplier approval should synchronize the operational carrier profile",
);
assert.match(
  masterDataRoutes,
  /CARRIER_SUPPLIER_AUTHORITY_REQUIRED/,
  "direct carrier identity edits should be rejected in favor of supplier authority",
);
assert.doesNotMatch(
  logisticsPage,
  /function CarrierFormDialog/,
  "Logistics should not expose a duplicate carrier editor",
);
assert.match(
  logisticsPage,
  /Carrier directory[\s\S]*governed in the Supplier directory/,
  "Logistics should explain the carrier directory authority",
);
assert.match(
  masterDataPage,
  /function CarrierDirectoryPanel[\s\S]*Open Suppliers/,
  "Master Data should route carrier maintenance to Suppliers",
);

console.log("test-supplier-logistics-contracts: all checks passed.");
