import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function includes(rel, needle, label) {
  const source = read(rel);
  assert.ok(source.includes(needle), `${label}: expected ${rel} to include ${needle}`);
}

function matches(rel, pattern, label) {
  const source = read(rel);
  assert.ok(pattern.test(source), `${label}: expected ${rel} to match ${pattern}`);
}

includes(
  "server/modules/inventory/register-inventory-routes.ts",
  "inventoryItemFormSchema.parse",
  "inventory create route uses coercing form validation",
);
includes(
  "server/modules/inventory/register-inventory-routes.ts",
  'ensurePermission("inventory", "create")',
  "inventory create route requires create permission",
);
includes(
  "client/src/pages/inventory.tsx",
  'data-testid="inventory-create-item-button"',
  "inventory page exposes add item action",
);
includes(
  "server/services/export-registry.ts",
  'key: "po_delivery_comparison"',
  "export registry includes PO vs delivery composite report",
);
includes(
  "server/modules/exports/register-export-center-routes.ts",
  '"/api/export-center/custom-preview"',
  "custom report preview endpoint is registered",
);
includes(
  "server/modules/exports/register-export-center-routes.ts",
  '"/api/export-center/custom-export"',
  "custom report compressed export endpoint is registered",
);
includes(
  "server/modules/exports/register-export-center-routes.ts",
  "application/gzip",
  "custom export downloads compressed gzip files",
);
matches(
  "server/modules/exports/export-worker.ts",
  /gzipSync\(rawBuffer,\s*\{\s*level:\s*9\s*\}\)/,
  "background export worker compresses stored artifacts",
);
includes(
  "client/src/pages/export-center.tsx",
  'data-testid="custom-report-preview"',
  "export center exposes custom preview button",
);
includes(
  "client/src/pages/export-center.tsx",
  'data-testid="custom-report-export"',
  "export center exposes compressed custom export button",
);
includes(
  "docs/APP-DATA-MAP.md",
  "Inventory Item Creation Process",
  "data map documents inventory creation process",
);

console.log("custom reports and inventory create wiring checks passed");
