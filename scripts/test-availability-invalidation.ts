import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { invalidateInventoryDomain, invalidatePurchaseOrderDomain } from '../client/src/lib/domain-invalidation';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const keys = [['item-availability', 1, '2026-10-31', 1], ['item-availability', 2, '2026-11-30', 2]];
for (const invalidate of [invalidateInventoryDomain, invalidatePurchaseOrderDomain]) {
  for (const key of keys) client.setQueryData(key, { availableNow: '10' });
  client.setQueryData(['unrelated-editor'], { draft: 'keep' });
  await invalidate(client);
  for (const key of keys) assert.equal(client.getQueryState(key)?.isInvalidated, true);
  assert.equal(client.getQueryState(['unrelated-editor'])?.isInvalidated, false);
}
client.clear();
console.log('Availability invalidation passed: inventory and PO updates invalidate all dates/pages/items, preserving unrelated editor state.');
