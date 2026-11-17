/**
 * Pure filter regression tests (no browser).
 * Run: npm run test:functional-filters
 */
import assert from "node:assert/strict";
import {
  apInvoiceMatchesStatus,
  contractMatchesStatus,
  inventoryMatchesCategoryId,
  inventoryMatchesLocation,
  inventoryMatchesLowStock,
  inventoryMatchesSearch,
  purchaseOrderMatchesStatus,
  purchaseOrderMatchesSupplier,
  requisitionMatchesStatus,
  supplierMatchesSearch,
} from "../shared/functional-filters.ts";

function main() {
  const skuA = { sku: "SKU-A", name: "Item A", location: "Johannesburg", categoryId: 1, available: 7, lowStockThreshold: 5 };

  assert.ok(inventoryMatchesSearch(skuA, "SKU-A"));
  assert.ok(!inventoryMatchesSearch(skuA, "SKU-B"));

  assert.ok(inventoryMatchesLocation(skuA, "Johannesburg"));
  assert.ok(!inventoryMatchesLocation(skuA, "Cape Town"));

  assert.ok(inventoryMatchesCategoryId(skuA, "1"));
  assert.ok(!inventoryMatchesCategoryId(skuA, "2"));

  assert.ok(!inventoryMatchesLowStock(skuA));
  assert.ok(inventoryMatchesLowStock({ ...skuA, available: 3 }));

  assert.ok(purchaseOrderMatchesStatus({ status: "draft" }, "draft"));
  assert.ok(!purchaseOrderMatchesStatus({ status: "draft" }, "approved"));

  assert.ok(purchaseOrderMatchesSupplier({ supplierId: 5 }, 5));
  assert.ok(purchaseOrderMatchesSupplier({ supplierId: 5 }, null));

  assert.ok(requisitionMatchesStatus({ status: "PENDING" }, "PENDING"));

  assert.ok(supplierMatchesSearch({ id: 1, name: "Acme Corp" }, "acme"));

  assert.ok(contractMatchesStatus({ status: "active" }, "active"));

  assert.ok(apInvoiceMatchesStatus({ status: "APPROVED" }, "APPROVED"));

  console.log("test-functional-filters: all checks passed");
}

main();
