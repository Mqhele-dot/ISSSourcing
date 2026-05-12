/**
 * Integration checks for exceptions list + run-checks (mutating). Needs dev server + DB + auth.
 * Prefer `verify:release` or local runs — not for shared read-only CI without coordination.
 * Run: npm run test:exceptions-workflow
 */
import assert from "node:assert/strict";
import { apiJsonRequest, clearSessionCookie, getTestBaseUrl, isConnectionRefused, peekSessionCookie } from "./test-http.ts";
import { exitTest } from "./test-exit.ts";

function unwrapList(json: unknown): unknown[] {
  if (json && typeof json === "object" && "ok" in json && (json as { ok?: boolean }).ok === true && "data" in json) {
    const data = (json as { data: unknown }).data;
    return Array.isArray(data) ? data : [];
  }
  throw new Error("expected { ok: true, data: array }");
}

async function main() {
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
  const cookie = peekSessionCookie();

  const listRes = await apiJsonRequest("/exceptions", { cookie });
  assert.ok(listRes.ok, `exceptions list: ${listRes.status}`);
  const list = unwrapList(listRes.json);
  assert.ok(list.length >= 0, "list is array");

  const first = list[0] as { id?: number } | undefined;
  if (first && typeof first.id === "number") {
    const one = await apiJsonRequest(`/exceptions/${first.id}`, { cookie });
    assert.ok(one.ok, `exception detail: ${one.status}`);
    const detail = (one.json as { ok?: boolean; data?: { id?: number } }).data;
    assert.equal(detail?.id, first.id);
  }

  const run = await apiJsonRequest("/exceptions/run-checks", { method: "POST", cookie });
  assert.ok(run.ok, `run-checks: ${run.status} ${JSON.stringify(run.json)}`);
  const payload = (run.json as { ok?: boolean; data?: Record<string, unknown> }).data;
  assert.ok(payload && typeof payload === "object");
  for (const key of ["created", "updated", "skippedDuplicates", "checksRun", "generatedAt"]) {
    assert.ok(key in payload, `missing ${key}`);
  }
  assert.ok(Array.isArray(payload.checksRun));
  assert.ok(typeof payload.generatedAt === "string");

  console.log("test-exceptions-workflow: all checks passed.");
  exitTest(0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.error("Server not reachable at", getTestBaseUrl(), "- start with: npm run dev");
    exitTest(1);
    return;
  }
  console.error(err);
  exitTest(1);
});
