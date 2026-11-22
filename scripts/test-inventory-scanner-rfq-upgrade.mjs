import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [repository, scanService, barcodeRoutes, inventoryRoutes, scannerPage, sourcingService, sourcingRoutes, sourcingPage] = await Promise.all([
  read("server/repositories/inventory-item-repository.ts"),
  read("server/modules/inventory/inventory-scan-movement-service.ts"),
  read("server/modules/inventory/register-barcode-routes.ts"),
  read("server/modules/inventory/register-inventory-routes.ts"),
  read("client/src/pages/barcode-scanner-page.tsx"),
  read("server/modules/sourcing/service.ts"),
  read("server/modules/sourcing/register-sourcing-routes.ts"),
  read("client/src/pages/sourcing.tsx"),
]);

assert.match(repository, /INV-\$\{organizationId\}/, "New inventory items must receive an automatic primary barcode.");
assert.match(repository, /type: "QR"/, "New inventory items must receive a QR deep link.");
assert.match(repository, /db\.transaction/, "Item identity and generated codes must be persisted atomically.");
assert.match(barcodeRoutes, /\/api\/barcodes\/scan-movement/, "The scanner movement endpoint must be registered.");
assert.match(scanService, /pg_advisory_xact_lock/, "Concurrent scans must serialize warehouse balance changes.");
assert.match(scanService, /requireLocationForItems/, "Inbound scanning must honor the location policy.");
assert.match(scanService, /allowNegativeInventory/, "Outbound scanning must honor the negative-stock policy.");
assert.match(scanService, /workflowIdempotency/, "Scan posting must be idempotent.");
assert.match(scanService, /eq\(warehouses\.organizationId, input\.organizationId\)/, "Warehouses must be tenant scoped.");
assert.match(scanService, /eq\(inventoryItems\.organizationId, input\.organizationId\)/, "Items must be tenant scoped.");
assert.doesNotMatch(inventoryRoutes, /"Main Warehouse"/, "Inventory detail must never fabricate a warehouse position.");
assert.match(inventoryRoutes, /warehouseQuantity/, "Inventory detail must distinguish canonical warehouse stock.");
assert.match(inventoryRoutes, /unassignedQuantity/, "Inventory detail must distinguish unassigned master stock.");
assert.match(scannerPage, /Confirm stock in/, "Scanner UI must expose inbound confirmation.");
assert.match(scannerPage, /Confirm stock out/, "Scanner UI must expose outbound confirmation.");
assert.match(scannerPage, /Warehouse setup required/, "Scanner UI must gate movement when no warehouse exists.");
assert.match(sourcingService, /previewSourcingInvitationEmails/, "Sourcing must build server-authoritative supplier previews.");
assert.match(sourcingService, /recipientState: recipient\.email/, "RFQ previews must flag suppliers without email addresses.");
assert.match(sourcingRoutes, /\/email-preview/, "RFQ email preview API must be registered.");
assert.match(sourcingPage, /Preview supplier emails/, "RFQ detail must expose email preview.");
assert.match(sourcingPage, /This preview does not send email/, "Preview UI must not imply that email was sent.");

console.log("Inventory scanner, warehouse policy, logistics, and RFQ email-preview contracts passed.");
