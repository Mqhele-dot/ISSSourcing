/**
 * Contract check for operational PO APIs + commercial PUT + activity filter.
 * Requires: DB + `npm run dev` on BASE_URL (default http://127.0.0.1:5000).
 * Resets FQA POs via `seed:functional-qa`, then mutates PO-FQA-001 (draft→approved→sent).
 *
 * Run: npm run test:purchase-order-endpoints
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  apiJsonRequest,
  clearSessionCookie,
  getTestBaseUrl,
  isConnectionRefused,
  peekSessionCookie,
} from "./test-http.ts";
import { exitTest } from "./test-exit.ts";
import { pool } from "../server/db.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function unwrapData<T>(json: unknown, label: string): T {
  if (json && typeof json === "object" && "ok" in json && (json as { ok?: boolean }).ok === true && "data" in json) {
    return (json as { data: T }).data;
  }
  throw new Error(`${label}: expected { ok: true, data }`);
}

async function setOperationalPoStatus(orderNumber: string, status: string): Promise<void> {
  const r = await pool.query(`UPDATE purchase_orders SET status = $1, updated_at = now() WHERE order_number = $2`, [
    status,
    orderNumber,
  ]);
  assert.ok((r.rowCount ?? 0) >= 1, `expected row update for ${orderNumber}`);
}

async function main() {
  const seed = spawnSync("npm", ["run", "seed:functional-qa"], {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (seed.status !== 0) {
    console.error("test-purchase-order-endpoints: seed:functional-qa failed");
    exitTest(1);
    return;
  }

  clearSessionCookie();
  const login = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });
  if (!login.ok) {
    console.error("Login failed:", login.status, login.json);
    exitTest(1);
    return;
  }
  const sessionCookie = peekSessionCookie();
  if (!sessionCookie) {
    console.warn("test-purchase-order-endpoints: no session cookie captured after login — requests may 401.");
  }

  await setOperationalPoStatus("PO-FQA-001", "draft");

  const get0 = await apiJsonRequest("/purchase/orders/PO-FQA-001", { cookie: sessionCookie });
  if (!get0.ok) {
    console.error("GET PO-FQA-001 failed:", get0.status, get0.json);
    exitTest(1);
    return;
  }
  const d0 = unwrapData<{ status: string }>(get0.json, "GET PO detail draft");
  assert.match(String(d0.status).toLowerCase(), /draft/);

  const get1 = await apiJsonRequest("/purchase/orders/PO-FQA-001", { cookie: sessionCookie });
  if (!get1.ok) {
    console.error("GET PO-FQA-001 failed:", get1.status, get1.json);
    exitTest(1);
    return;
  }
  const d1 = unwrapData<{
    poNumber: string;
    status: string;
    lines: unknown[];
    shipments: unknown[];
    progress: { percent?: number };
  }>(get1.json, "GET PO detail");
  assert.equal(d1.poNumber, "PO-FQA-001");
  assert.ok(typeof d1.status === "string");
  assert.ok(Array.isArray(d1.lines));
  assert.ok(Array.isArray(d1.shipments));
  assert.ok(d1.progress && typeof d1.progress === "object");

  const approve = await apiJsonRequest("/purchase/orders/PO-FQA-001/approve", {
    method: "POST",
    body: {},
    cookie: sessionCookie,
  });
  if (!approve.ok) {
    console.error("Approve failed:", approve.status, approve.json);
    exitTest(1);
    return;
  }
  const afterApprove = unwrapData<{ status: string }>(approve.json, "approve");
  assert.match(String(afterApprove.status).toLowerCase(), /approved/);

  const send = await apiJsonRequest("/purchase/orders/PO-FQA-001/send", {
    method: "POST",
    body: {},
    cookie: sessionCookie,
  });
  if (!send.ok) {
    console.error("Send failed:", send.status, send.json);
    exitTest(1);
    return;
  }
  const afterSend = unwrapData<{ status: string }>(send.json, "send");
  assert.match(String(afterSend.status).toLowerCase(), /sent/);

  await setOperationalPoStatus("PO-FQA-001", "draft");
  const sendDraft = await apiJsonRequest("/purchase/orders/PO-FQA-001/send", {
    method: "POST",
    body: {},
    cookie: sessionCookie,
  });
  assert.equal(sendDraft.status, 400, "send from draft should be 400");

  await setOperationalPoStatus("PO-FQA-001", "open");
  const sendOpen = await apiJsonRequest("/purchase/orders/PO-FQA-001/send", {
    method: "POST",
    body: {},
    cookie: sessionCookie,
  });
  assert.equal(sendOpen.status, 400, "send from open should be 400");

  clearSessionCookie();
  const loginViewer = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "viewer", password: "Admin123!" },
  });
  assert.ok(loginViewer.ok, `viewer login: ${loginViewer.status}`);
  const viewerCookie = peekSessionCookie();
  await setOperationalPoStatus("PO-FQA-001", "open");
  const viewerApprove = await apiJsonRequest("/purchase/orders/PO-FQA-001/approve", {
    method: "POST",
    body: {},
    cookie: viewerCookie,
  });
  assert.equal(viewerApprove.status, 403, "viewer approve should be forbidden");

  clearSessionCookie();
  const loginPlanner = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "planner", password: "Admin123!" },
  });
  if (!loginPlanner.ok) {
    console.warn(
      "Planner login failed (run migrations/20260513_user_role_planner.sql if role missing):",
      loginPlanner.status,
      loginPlanner.json,
    );
  } else {
    const plannerCookie = peekSessionCookie();
    await setOperationalPoStatus("PO-FQA-001", "draft");
    const plannerApprove = await apiJsonRequest("/purchase/orders/PO-FQA-001/approve", {
      method: "POST",
      body: {},
      cookie: plannerCookie,
    });
    if (plannerApprove.ok) {
      const st = unwrapData<{ status: string }>(plannerApprove.json, "planner approve");
      assert.match(String(st.status).toLowerCase(), /approved/);
    } else {
      console.warn("Planner approve skipped:", plannerApprove.status, plannerApprove.json);
    }
  }

  clearSessionCookie();
  const loginAdmin2 = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });
  assert.ok(loginAdmin2.ok);
  const adminCookie2 = peekSessionCookie();

  const get2 = await apiJsonRequest("/purchase/orders/PO-FQA-002", { cookie: adminCookie2 });
  if (!get2.ok) {
    console.error("GET PO-FQA-002 failed:", get2.status);
    exitTest(1);
    return;
  }
  const id2 = unwrapData<{ id: number }>(get2.json, "PO-FQA-002").id;
  const put2 = await apiJsonRequest(`/purchase-orders/${id2}`, {
    method: "PUT",
    body: {
      departmentId: null,
      contractId: null,
      paymentTermsId: null,
      incotermId: null,
    },
    cookie: adminCookie2,
  });
  assert.ok(put2.ok, `PUT commercial PO-FQA-002 should succeed: ${put2.status} ${JSON.stringify(put2.json)}`);

  const get3 = await apiJsonRequest("/purchase/orders/PO-FQA-003", { cookie: adminCookie2 });
  if (!get3.ok) {
    console.error("GET PO-FQA-003 failed");
    exitTest(1);
    return;
  }
  const id3 = unwrapData<{ id: number }>(get3.json, "PO-FQA-003").id;
  const put3 = await apiJsonRequest(`/purchase-orders/${id3}`, {
    method: "PUT",
    body: { departmentId: null, contractId: null, paymentTermsId: null, incotermId: null },
    cookie: adminCookie2,
  });
  assert.ok(
    put3.status === 403 || put3.status === 409,
    `Locked PO should return 403/409, got ${put3.status} ${JSON.stringify(put3.json)}`,
  );
  assert.ok(put3.status < 500, "Commercial lock must not be a 500");

  const t0 = Date.now();
  const actFiltered = await apiJsonRequest(
    "/activity?entity_type=purchase_order&entity_id=PO-FQA-001&limit=20",
    { cookie: adminCookie2 },
  );
  const elapsed = Date.now() - t0;
  assert.ok(actFiltered.ok, `activity filtered failed: ${actFiltered.status}`);
  const actData = unwrapData<unknown[]>(actFiltered.json, "activity");
  assert.ok(Array.isArray(actData));
  assert.ok(elapsed < 15_000, `activity filtered took ${elapsed}ms`);

  const actHuge = await apiJsonRequest("/activity?limit=999", { cookie: adminCookie2 });
  assert.ok(actHuge.ok);
  const hugeData = unwrapData<unknown[]>(actHuge.json, "activity huge");
  assert.ok(hugeData.length <= 100, `limit should cap at 100, got ${hugeData.length}`);

  const actDefault = await apiJsonRequest("/activity", { cookie: adminCookie2 });
  assert.ok(actDefault.ok);
  const defData = unwrapData<unknown[]>(actDefault.json, "activity default");
  assert.ok(defData.length <= 50, `default activity limit should be 50 max, got ${defData.length}`);

  await pool.end().catch(() => undefined);

  console.log("test-purchase-order-endpoints: all checks passed.");
  exitTest(0);
}

main().catch((err) => {
  void pool.end().catch(() => undefined);
  if (isConnectionRefused(err)) {
    console.error("Server not reachable at", getTestBaseUrl(), "- start with: npm run dev");
    exitTest(1);
    return;
  }
  console.error(err);
  exitTest(1);
});
