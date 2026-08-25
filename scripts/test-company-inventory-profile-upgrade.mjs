import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  schema,
  organizationRoutes,
  branding,
  documentGenerator,
  apRoutes,
  inventoryRoutes,
  operationsCore,
  inventoryPage,
  inventoryDetail,
  companyPage,
  router,
  navigation,
  initDb,
] = await Promise.all([
  read("shared/schema.ts"),
  read("server/modules/organization/register-organization-routes.ts"),
  read("server/services/organization-document-branding.ts"),
  read("server/services/document-generator-service.ts"),
  read("server/modules/accounts-payable/register-ap-routes.ts"),
  read("server/modules/inventory/register-inventory-routes.ts"),
  read("server/modules/operations/operations-core.ts"),
  read("client/src/pages/inventory.tsx"),
  read("client/src/pages/inventory-item.tsx"),
  read("client/src/pages/company-setup-page.tsx"),
  read("client/src/router.tsx"),
  read("client/src/lib/routes/section-metadata.ts"),
  read("server/init-db.ts"),
]);

for (const field of ["legalName", "registrationNumber", "taxNumber", "address", "contactEmail", "contactPhone", "website"]) {
  assert.match(schema, new RegExp(`${field}:`), `organization settings must persist ${field}`);
  assert.match(companyPage, new RegExp(field), `company setup must edit ${field}`);
}

assert.match(organizationRoutes, /\/api\/organization\/company-profile/, "company profile API must be registered");
assert.match(organizationRoutes, /company-profile[\s\S]*getActiveOrganizationId\(\)/, "company profile must use the authenticated active organization");
assert.match(organizationRoutes, /COMPANY_PROFILE_UPDATED/, "company profile edits must be audited");
assert.match(organizationRoutes, /db\.transaction/, "company identity stores must update atomically");
assert.match(branding, /organizationSettings/, "document branding must use authoritative organization settings");
assert.match(branding, /reportFooter/, "document branding must compose company footer details");
assert.match(documentGenerator, /organizationLogoPng/, "generated PDFs must support company logos");
assert.match(apRoutes, /getOrganizationDocumentBranding/, "AP evidence documents must use company branding");

assert.match(router, /company-setup/, "the company setup page must be routed");
assert.match(navigation, /companySetup/, "company setup must be discoverable in Admin navigation");
assert.match(companyPage, /Document preview/, "company setup must preview generated-document identity");
assert.match(companyPage, /missingFields/, "company setup must explain incomplete profiles");

assert.match(operationsCore, /description:/, "inventory detail must return editable master-data fields");
assert.match(operationsCore, /defaultWarehouseId:/, "inventory detail must expose its canonical default warehouse");
assert.match(inventoryDetail, /Edit item details/, "inventory detail must expose a full editor");
assert.match(inventoryDetail, /Adjust stock/, "quantity changes must remain a separate controlled action");
assert.match(inventoryDetail, /requestJson<[^>]+>\("PUT", `\/api\/inventory\/\$\{data\.id\}`/, "inventory editor must persist through the item API");
assert.match(inventoryPage, /edit=1/, "inventory preview must link directly to editing");
assert.match(inventoryRoutes, /INVENTORY_QUANTITY_ADJUSTMENT_REQUIRED/, "master-data update must reject direct quantity mutation");
assert.match(inventoryRoutes, /omit\(\{[\s\S]*organizationId: true[\s\S]*quantity: true/, "inventory update must protect tenant and stock fields");
assert.match(initDb, /SET organization_id = item\.organization_id/, "legacy barcodes must inherit ownership from their canonical item");
assert.doesNotMatch(initDb, /ALTER TABLE barcodes ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1/, "legacy barcode ownership must never be guessed as tenant 1");

console.log("Company profile, generated-document branding, and inventory review/edit contracts passed.");
