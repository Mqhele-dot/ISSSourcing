import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
for (const page of ["approval-policies", "employee-profiles", "master-data"]) {
  const source = await read(`client/src/pages/${page}.tsx`);
  assert.doesNotMatch(source, /setLocation\("\/m\/home"\)/, `${page} must not silently redirect compact browsers`);
  assert.match(source, /Open mobile hub/, `${page} must offer an explicit exit`);
}
const ap = await read("server/modules/accounts-payable/register-ap-routes.ts");
const payable = ap.slice(ap.indexOf('if (query.eligibility === "payable")'), ap.indexOf('if (query.eligibility === "due")'));
assert.match(payable, /purchase_order_id IS NOT NULL AND latest_match.status::text = 'MATCHED'/);
assert.match(payable, /COALESCE\(invoice.due_amount, invoice.total, 0\) > 0/);
assert.match(payable, /APPROVED.*PARTIALLY_PAID.*OVERDUE/);
const tower = await read("server/modules/operations/control-tower-dashboard.ts");
assert.match(tower, /\["PENDING", "PENDING_APPROVAL", "SUBMITTED"\]\.includes\(s\)/);
const overview = await read("server/modules/procurement-completion/register-procurement-completion-routes.ts");
assert.match(overview, /upper\(trim\(status\)\) IN \('DRAFT','SUBMITTED','PENDING','PENDING_APPROVAL','NEEDS_INFO','APPROVED'\)/);
const tours = await read("client/src/components/tutorial/tutorial-route-map.ts");
assert.ok(tours.indexOf("APP_ROUTES.inventory.positions") < tours.indexOf('label: "This SKU"'));
console.log("PASS: September audit source contracts (navigation, payable pagination, requisition scopes, position tour).");
