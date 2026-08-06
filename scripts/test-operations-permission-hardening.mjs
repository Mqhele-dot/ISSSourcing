import assert from "node:assert/strict";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
const API_BASE = `${BASE_URL}/api`;

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : undefined;
}

async function fetchJson(path, { method = "GET", body, cookie, csrfToken } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const json = await response.json().catch(() => null);
  return { response, status: response.status, json, cookie: extractCookie(response) ?? cookie };
}

async function login(username, password) {
  const result = await fetchJson("/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.ok(result.cookie, `login failed for ${username}: ${JSON.stringify(result.json)}`);
  return result.cookie;
}

async function fetchCsrfToken(cookie) {
  const result = await fetchJson("/csrf-token", { cookie });
  const token = result.json?.data?.csrfToken ?? result.json?.csrfToken;
  assert.equal(typeof token, "string", "csrf token is required");
  return token;
}

async function postWithCsrf(path, cookie, body) {
  const csrfToken = await fetchCsrfToken(cookie);
  return fetchJson(path, { method: "POST", cookie, csrfToken, body });
}

function codes(payload) {
  return payload?.error?.code ?? payload?.code ?? null;
}

async function main() {
  const anonymousLogistics = await fetchJson("/logistics/shipments");
  assert.equal(anonymousLogistics.status, 401, "anonymous logistics access must fail closed");

  const anonymousExceptions = await fetchJson("/exceptions");
  assert.equal(anonymousExceptions.status, 401, "anonymous exceptions access must fail closed");

  const plannerCookie = await login("planner", "Admin123!");
  const viewerCookie = await login("viewer", "Admin123!");

  const plannerPermissions = await fetchJson("/permissions/me", { cookie: plannerCookie });
  assert.equal(plannerPermissions.status, 200, "planner permissions endpoint must load");
  const permissionPairs = Array.isArray(plannerPermissions.json?.permissions)
    ? plannerPermissions.json.permissions.map((permission) => `${permission.resource}:${permission.permissionType}`)
    : [];
  assert.ok(permissionPairs.includes("inventory:read"), "planner must have inventory:read");
  assert.ok(permissionPairs.includes("inventory:update"), "planner must have inventory:update");

  const plannerLogistics = await fetchJson("/logistics/shipments", { cookie: plannerCookie });
  assert.equal(plannerLogistics.status, 200, "planner must be allowed to read logistics");

  const plannerExceptions = await fetchJson("/exceptions", { cookie: plannerCookie });
  assert.equal(plannerExceptions.status, 200, "planner must be allowed to read exceptions");

  const viewerShipmentStatus = await postWithCsrf("/logistics/shipments/999999/status", viewerCookie, {
    toStatus: "delivered",
    note: "forbidden viewer probe",
  });
  assert.equal(viewerShipmentStatus.status, 403, "viewer shipment status mutation must be denied");
  assert.equal(codes(viewerShipmentStatus.json), "FORBIDDEN_PERMISSION_REQUIRED");

  const plannerShipmentStatus = await postWithCsrf("/logistics/shipments/999999/status", plannerCookie, {
    toStatus: "delivered",
    note: "authorized planner probe",
  });
  assert.notEqual(plannerShipmentStatus.status, 403, "planner shipment status must pass permission gate");
  assert.notEqual(plannerShipmentStatus.status, 401, "planner shipment status must stay authenticated");

  const viewerExceptionStatus = await postWithCsrf("/exceptions/999999/status", viewerCookie, {
    toStatus: "in_progress",
    note: "forbidden viewer probe",
  });
  assert.equal(viewerExceptionStatus.status, 403, "viewer exception mutation must be denied");
  assert.equal(codes(viewerExceptionStatus.json), "FORBIDDEN_PERMISSION_REQUIRED");

  const plannerExceptionStatus = await postWithCsrf("/exceptions/999999/status", plannerCookie, {
    toStatus: "in_progress",
    note: "authorized planner probe",
  });
  assert.notEqual(plannerExceptionStatus.status, 403, "planner exception status must pass permission gate");
  assert.notEqual(plannerExceptionStatus.status, 401, "planner exception status must stay authenticated");

  console.log("test-operations-permission-hardening: all checks passed.");
}

main().catch((error) => {
  console.error("test-operations-permission-hardening failed");
  console.error(error);
  process.exitCode = 1;
});
