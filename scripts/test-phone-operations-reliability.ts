import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { phoneOperationsTarget, PHONE_OPERATIONS_MEDIA_QUERY } from "../client/src/lib/layout/phone-operations-entry";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

assert.equal(PHONE_OPERATIONS_MEDIA_QUERY, "(max-width: 767px)");
assert.equal(phoneOperationsTarget(), "/m/home");
assert.equal(phoneOperationsTarget("?from=pwa&shift=night"), "/m/home?from=pwa&shift=night");
assert.equal(phoneOperationsTarget("from=tasks"), "/m/home?from=tasks");

const [router, operations, launcher, home, receive, counts, service, v2, manifest, worker, pick] = await Promise.all([
  read("client/src/router.tsx"),
  read("client/src/pages/operations-overview-page.tsx"),
  read("client/src/pages/mobile-workflows-launcher-page.tsx"),
  read("client/src/pages/mobile-hub-home.tsx"),
  read("client/src/pages/mobile-receive.tsx"),
  read("client/src/pages/mobile-counts.tsx"),
  read("server/modules/mobile-counts/mobile-count-service.ts"),
  read("server/modules/v2/register-v2-routes.ts"),
  read("client/public/manifest.webmanifest"),
  read("client/public/sw.js"),
  read("client/src/pages/mobile-pick.tsx"),
]);

assert.match(operations, /PHONE_OPERATIONS_MEDIA_QUERY/);
assert.match(launcher, /phone-workflow-preview/);
assert.match(launcher, /mobileCounts/);
assert.match(home, /MobileHubTasksPage/);
assert.match(router, /mobileTasks[\s\S]*LegacyRedirect/);
assert.match(receive, /useInfiniteQuery/);
assert.doesNotMatch(receive, /useAsyncResource/);
assert.match(receive, /pageSize:\s*25/);
assert.match(v2, /status and statuses cannot be combined/);
assert.match(v2, /inArray\(purchaseOrders\.status, query\.statuses\)/);
assert.match(counts, /mobile-count-warehouse-select/);
assert.doesNotMatch(counts, /useState\("1"\)/);
assert.match(service, /MOBILE_COUNT_WAREHOUSE_INVALID/);
assert.match(service, /canonicalQuantityByItem\.get\(target\.itemId\)/);
assert.match(pick, /APP_ROUTES\.inventory\.warehouseOperations/);
assert.equal(JSON.parse(manifest).start_url, "/operations");
assert.match(worker, /invtrack-shell-v4/);
assert.match(worker, /"\/m\/receive"/);

console.log("Phone Operations reliability contracts passed.");
