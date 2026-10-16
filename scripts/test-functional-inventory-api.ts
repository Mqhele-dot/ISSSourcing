/**
 * DB-backed checks: operational GET /api/inventory semantics via listOperationalInventory.
 * Run after `npm run seed:functional-qa`. Invoked from `npm run test:functional-audit`.
 */
import assert from "node:assert/strict";
import { organizationAsyncLocalStorage } from "../server/organization-context.ts";
import { listOperationalInventory } from "../server/modules/operations/operations-core.ts";
import { FQA_SKUS, FQA_INVENTORY_MASTER } from "../shared/functional-qa-constants.ts";

async function inOrg<T>(fn: () => Promise<T>): Promise<T> {
  return organizationAsyncLocalStorage.run({ organizationId: 1 }, fn);
}

function fqaSkusIn(rows: { sku: string }[]): string[] {
  return rows
    .map((r) => r.sku)
    .filter((s) => FQA_SKUS.includes(s as (typeof FQA_SKUS)[number]))
    .sort();
}

async function main() {
  const all = await inOrg(() =>
    listOperationalInventory({ q: "", location: "", category: "", low: false }),
  );
  const fqaRows = all.filter((r) => FQA_SKUS.includes(r.sku as (typeof FQA_SKUS)[number]));
  assert.equal(fqaRows.length, 4, `expected 4 FQA SKUs in operational list, got ${fqaRows.length}`);

  for (const sku of FQA_SKUS) {
    const row = fqaRows.find((r) => r.sku === sku);
    assert.ok(row, `missing ${sku}`);
    const exp = FQA_INVENTORY_MASTER[sku];
    assert.equal(row.onHand, exp.quantity, `${sku} onHand`);
    assert.equal(row.allocated, exp.allocatedUi, `${sku} allocated`);
    assert.equal(row.available, exp.availableUi, `${sku} available`);
    assert.equal(row.lowStockThreshold, exp.lowStockThreshold, `${sku} threshold`);
  }

  const elecId = all.find((r) => r.sku === "SKU-A")?.categoryId;
  assert.ok(typeof elecId === "number", "Electronics category id from SKU-A");

  const qA = await inOrg(() => listOperationalInventory({ q: "SKU-A", location: "", category: "", low: false }));
  assert.deepEqual(fqaSkusIn(qA), ["SKU-A"]);

  const elec = await inOrg(() =>
    listOperationalInventory({ q: "", location: "", category: String(elecId), low: false }),
  );
  assert.deepEqual(fqaSkusIn(elec), ["SKU-A", "SKU-B"]);

  const jhb = await inOrg(() =>
    listOperationalInventory({ q: "", location: "Johannesburg", category: "", low: false }),
  );
  assert.deepEqual(fqaSkusIn(jhb), ["SKU-A", "SKU-D"]);

  const low = await inOrg(() =>
    listOperationalInventory({ q: "", location: "", category: "", low: true }),
  );
  assert.deepEqual(fqaSkusIn(low), ["SKU-B", "SKU-D"]);

  const consId = all.find((r) => r.sku === "SKU-C")?.categoryId;
  assert.ok(typeof consId === "number", "Consumables category id from SKU-C");
  const consLow = await inOrg(() =>
    listOperationalInventory({ q: "", location: "", category: String(consId), low: true }),
  );
  assert.deepEqual(fqaSkusIn(consLow), ["SKU-D"]);

  console.log("test-functional-inventory-api: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
