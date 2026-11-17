import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { supplierDeliveryQueryKey } from "../shared/supplier-delivery-scorecard";
import { invalidateSupplierDomain, invalidatePurchaseOrderDomain, invalidateInventoryDomain, invalidateAfterOperationalReceive } from "../client/src/lib/domain-invalidation";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const base = { userId: 1, organizationId: 1, warehouseId: null };
const keys = [
  supplierDeliveryQueryKey(base, 10, { from: "", to: "" }, 1, 25),
  supplierDeliveryQueryKey(base, 10, { from: "2026-01-01", to: "2026-01-31" }, 2, 100),
  supplierDeliveryQueryKey({ ...base, organizationId: 2 }, 10, { from: "", to: "" }, 1, 25),
  supplierDeliveryQueryKey({ ...base, userId: 2 }, 10, { from: "", to: "" }, 1, 25),
  supplierDeliveryQueryKey({ ...base, warehouseId: 9 }, 10, { from: "", to: "" }, 1, 25),
];
assert.equal(new Set(keys.map(key => JSON.stringify(key))).size, keys.length, "User, organization, location, dates and page scopes cannot share a cached scorecard.");
for (const invalidate of [invalidateSupplierDomain, invalidatePurchaseOrderDomain, invalidateInventoryDomain, invalidateAfterOperationalReceive]) {
  for (const key of keys) client.setQueryData(key, { measured: 12 });
  client.setQueryData(["financial-evidence", "saved-run"], { amount: "42.00" });
  client.setQueryData(["unrelated-editor"], { draft: "keep" });
  await invalidate(client);
  for (const key of keys) assert.equal(client.getQueryState(key)?.isInvalidated, true);
  assert.equal(client.getQueryState(["financial-evidence", "saved-run"])?.isInvalidated, false);
  assert.equal(client.getQueryState(["unrelated-editor"])?.isInvalidated, false);
}
client.clear();
console.log("Supplier delivery cache passed: isolated actor/org/location keys; canonical supplier/PO/stock/receiving invalidation covers all dates/pages and preserves frozen evidence/editor state.");
