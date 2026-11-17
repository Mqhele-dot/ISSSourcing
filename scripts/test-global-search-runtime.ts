import assert from "node:assert/strict";
import process from "node:process";
import { pool } from "../server/db";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";
import { apiJsonRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";
import { removeEvidenceUsers, seedCustomPermissionUser, type SeededEvidenceUser } from "./runtime-fixtures/expanded-security-fixtures";

type SearchResult = {
  type: string;
  title: string;
  subtitle: string;
  href: string;
};

function unwrapResults(payload: unknown): SearchResult[] {
  if (Array.isArray(payload)) {
    return payload as SearchResult[];
  }
  const maybeData =
    payload &&
    typeof payload === "object" &&
    "data" in payload
      ? (payload as { data?: unknown }).data
      : undefined;
  return Array.isArray(maybeData) ? (maybeData as SearchResult[]) : [];
}

async function main() {
  assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
  const adminCookie = await loginForTests("admin", "Admin123!");
  assert.ok(adminCookie, "Seeded admin login is required.");

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const evidenceUsers: SeededEvidenceUser[] = [];

  try {
    const inventoryUser = await seedCustomPermissionUser({
      suffix,
      label: "Inventory Search",
      permissions: [{ resource: "inventory", permissionType: "read" }],
    });
    const supplierUser = await seedCustomPermissionUser({
      suffix,
      label: "Supplier Search",
      permissions: [{ resource: "suppliers", permissionType: "read" }],
    });
    evidenceUsers.push(inventoryUser, supplierUser);

    const invalid = await apiJsonRequest("/v2/search?q=x", { cookie: adminCookie });
    assert.equal(invalid.status, 400, "search must reject one-character queries");

    const adminSearch = await apiJsonRequest("/v2/search?q=Tech%20Solutions&limit=5", { cookie: adminCookie });
    assert.equal(adminSearch.status, 200, `admin search failed: ${JSON.stringify(adminSearch.json)}`);
    const adminResults = unwrapResults(adminSearch.json);
    assert.ok(
      adminResults.some((result) => result.type === "supplier" && result.title.includes("Tech Solutions")),
      "admin search must return supplier records",
    );

    const inventoryCookie = await loginForTests(inventoryUser.username, inventoryUser.password);
    assert.ok(inventoryCookie, "inventory-only user login is required.");
    const inventorySearch = await apiJsonRequest("/v2/search?q=MBP16-2024&limit=5", { cookie: inventoryCookie });
    assert.equal(inventorySearch.status, 200, `inventory search failed: ${JSON.stringify(inventorySearch.json)}`);
    const inventoryResults = unwrapResults(inventorySearch.json);
    assert.ok(inventoryResults.some((result) => result.type === "inventory"), "inventory search must return inventory results");
    assert.ok(
      inventoryResults.every((result) => result.type === "inventory"),
      "inventory-only user must not receive supplier or procurement results",
    );

    const supplierCookie = await loginForTests(supplierUser.username, supplierUser.password);
    assert.ok(supplierCookie, "supplier-only user login is required.");
    const supplierSearch = await apiJsonRequest("/v2/search?q=Tech%20Solutions&limit=5", { cookie: supplierCookie });
    assert.equal(supplierSearch.status, 200, `supplier search failed: ${JSON.stringify(supplierSearch.json)}`);
    const supplierResults = unwrapResults(supplierSearch.json);
    assert.ok(supplierResults.some((result) => result.type === "supplier"), "supplier search must return supplier results");
    assert.ok(
      supplierResults.every((result) => result.type === "supplier"),
      "supplier-only user must not receive inventory or procurement results",
    );
    assert.ok(
      supplierResults.every((result) => result.href.startsWith("/procurement/suppliers/")),
      "supplier results must link to supplier detail routes",
    );

    console.log("global search runtime checks passed");
  } finally {
    await removeEvidenceUsers(evidenceUsers);
    await pool.end();
  }
}

main().then(
  () => exitTest(0),
  async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    exitTest(1);
  },
);
