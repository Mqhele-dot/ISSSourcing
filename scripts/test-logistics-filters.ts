/**
 * Read-only checks for GET /api/logistics/shipments (meta.generatedAt, invalid date → 400).
 * Run: npm run test:logistics-filters
 */
import assert from "node:assert/strict";
import { apiJsonRequest, clearSessionCookie, getTestBaseUrl, isConnectionRefused, peekSessionCookie } from "./test-http.ts";
import { exitTest } from "./test-exit.ts";

function unwrapEnvelope(json: unknown): { data: unknown; meta?: Record<string, unknown> } {
  if (json && typeof json === "object" && "ok" in json && (json as { ok?: boolean }).ok === true && "data" in json) {
    const meta = (json as { meta?: Record<string, unknown> }).meta;
    return { data: (json as { data: unknown }).data, meta };
  }
  throw new Error("expected { ok: true, data, meta? }");
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

  const ok = await apiJsonRequest("/logistics/shipments", { cookie });
  assert.ok(ok.ok, `shipments: ${ok.status} ${JSON.stringify(ok.json)}`);
  const env = unwrapEnvelope(ok.json);
  assert.ok(Array.isArray(env.data), "data is array");
  const generatedAt = env.meta?.generatedAt;
  assert.ok(typeof generatedAt === "string" && generatedAt.length > 5, "meta.generatedAt");

  const bad = await apiJsonRequest("/logistics/shipments?etaFrom=not-a-date", { cookie });
  assert.equal(bad.status, 400, "invalid etaFrom should be 400");
  const errBody = bad.json as { ok?: boolean; error?: { code?: string } };
  assert.equal(errBody.ok, false);
  assert.equal(errBody.error?.code, "INVALID_LOGISTICS_FILTER");

  console.log("test-logistics-filters: all checks passed.");
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
