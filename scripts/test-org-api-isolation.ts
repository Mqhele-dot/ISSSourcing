/**
 * HTTP-level org isolation: session scoped to org 1 must not return rows belonging to another organization.
 *
 * Requires: dev server (`npm run dev`) and DATABASE_URL reachable from this process.
 *
 * Run: npx tsx scripts/test-org-api-isolation.ts
 * Or:  BASE_URL=http://127.0.0.1:5000 npx tsx scripts/test-org-api-isolation.ts
 */
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  getTestBaseUrl,
  isConnectionRefused,
  loginForTests,
} from "./test-http.ts";

async function waitForHealthy(baseUrl: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Org API isolation (BASE_URL=%s)\n", BASE_URL);

  let passed = 0;
  let failed = 0;

  function ok(name: string): void {
    console.log("  ✓ %s", name);
    passed++;
  }

  function bad(name: string, detail: string): void {
    console.log("  ✗ %s — %s", name, detail);
    failed++;
  }

  try {
    await waitForHealthy(BASE_URL, 15_000);
  } catch {
    console.log("  ⚠ Server not healthy. Start with: npm run dev");
    exitTest(0);
    return;
  }

  const { pool } = await import("../server/db");

  let orgId: number | null = null;
  let supplierId: number | null = null;
  let inventoryItemId: number | null = null;
  let requisitionId: number | null = null;
  let purchaseOrderId: number | null = null;
  let documentId: number | null = null;

  try {
    const slug = `iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const orgRes = await pool.query<{ id: number }>(
      `INSERT INTO organizations (name, slug, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
      ["Isolation test org", slug],
    );
    orgId = orgRes.rows[0]?.id ?? null;
    if (!orgId) throw new Error("Failed to insert organization");

    await pool.query(
      `INSERT INTO organization_settings (organization_id, plan_tier, updated_at)
       VALUES ($1, 'standard', NOW())
       ON CONFLICT (organization_id) DO NOTHING`,
      [orgId],
    );

    const supRes = await pool.query<{ id: number }>(
      `INSERT INTO suppliers (organization_id, name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
      [orgId, "__org_isolation_supplier__"],
    );
    supplierId = supRes.rows[0]?.id ?? null;
    if (!supplierId) throw new Error("Failed to insert supplier");

    const sku = `iso-sku-${Date.now()}`;
    const invRes = await pool.query<{ id: number }>(
      `INSERT INTO inventory_items (organization_id, name, sku, price, quantity, created_at, updated_at)
       VALUES ($1, 'iso item', $2, 1, 0, NOW(), NOW()) RETURNING id`,
      [orgId, sku],
    );
    inventoryItemId = invRes.rows[0]?.id ?? null;

    const reqNum = `ISO-REQ-${Date.now()}`;
    const reqRes = await pool.query<{ id: number }>(
      `INSERT INTO purchase_requisitions (organization_id, requisition_number, status, total_amount, created_at, updated_at)
       VALUES ($1, $2, 'DRAFT', 0, NOW(), NOW()) RETURNING id`,
      [orgId, reqNum],
    );
    requisitionId = reqRes.rows[0]?.id ?? null;

    const poNum = `ISO-PO-${Date.now()}`;
    const poRes = await pool.query<{ id: number }>(
      `INSERT INTO purchase_orders (organization_id, order_number, supplier_id, status, total_amount, created_at, updated_at)
       VALUES ($1, $2, $3, 'DRAFT', 0, NOW(), NOW()) RETURNING id`,
      [orgId, poNum, supplierId],
    );
    purchaseOrderId = poRes.rows[0]?.id ?? null;

    const docRes = await pool.query<{ id: number }>(
      `INSERT INTO documents (organization_id, entity_type, entity_id, file_url, file_name, uploaded_at)
       VALUES ($1, 'iso_entity', 42, 'https://example.com/x', 'iso.txt', NOW()) RETURNING id`,
      [orgId],
    );
    documentId = docRes.rows[0]?.id ?? null;

    const adminCookie = await loginForTests("admin", "Admin123!");
    if (!adminCookie) {
      console.log("  ⚠ Admin login failed (seed DB?). Skipping.");
      exitTest(0);
      return;
    }

    const r = await apiJsonRequest(`/suppliers/${supplierId}`, {
      method: "GET",
      cookie: adminCookie,
      baseUrl: BASE_URL,
    });
    if (r.status === 404) ok(`GET /api/suppliers/${supplierId} (other org) → 404`);
    else bad(`GET /api/suppliers/${supplierId}`, `expected 404, got ${r.status}`);

    const list = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie, baseUrl: BASE_URL });
    const rows = Array.isArray(list.json) ? list.json : (list.json as { data?: unknown })?.data;
    const leaked =
      Array.isArray(rows) && supplierId != null && rows.some((x: { id?: number }) => x?.id === supplierId);
    if (!leaked) ok("GET /api/suppliers list excludes other-org supplier");
    else bad("GET /api/suppliers list", "leaked other-org supplier id");

    if (inventoryItemId != null) {
      const inv = await apiJsonRequest(`/inventory/${inventoryItemId}`, {
        method: "GET",
        cookie: adminCookie,
        baseUrl: BASE_URL,
      });
      if (inv.status === 404) ok(`GET /api/inventory/${inventoryItemId} (other org) → 404`);
      else bad(`GET /api/inventory/${inventoryItemId}`, `expected 404, got ${inv.status}`);
    }

    if (requisitionId != null) {
      const req = await apiJsonRequest(`/purchase-requisitions/${requisitionId}`, {
        method: "GET",
        cookie: adminCookie,
        baseUrl: BASE_URL,
      });
      if (req.status === 404) ok(`GET /api/purchase-requisitions/${requisitionId} (other org) → 404`);
      else bad(`GET /api/purchase-requisitions/${requisitionId}`, `expected 404, got ${req.status}`);
    }

    if (purchaseOrderId != null) {
      const po = await apiJsonRequest(`/purchase-orders/${purchaseOrderId}`, {
        method: "GET",
        cookie: adminCookie,
        baseUrl: BASE_URL,
      });
      if (po.status === 404) ok(`GET /api/purchase-orders/${purchaseOrderId} (other org) → 404`);
      else bad(`GET /api/purchase-orders/${purchaseOrderId}`, `expected 404, got ${po.status}`);
    }

    if (documentId != null) {
      const docs = await apiJsonRequest("/documents?entityType=iso_entity&entityId=42", {
        method: "GET",
        cookie: adminCookie,
        baseUrl: BASE_URL,
      });
      const docRows = Array.isArray(docs.json) ? docs.json : [];
      const leakedDoc = docRows.some((x: { id?: number }) => x?.id === documentId);
      if (!leakedDoc) ok("GET /api/documents (other org entity) does not leak document id");
      else bad("GET /api/documents", "leaked other-org document id");
    }
  } catch (err) {
    if (isConnectionRefused(err)) {
      console.log("  ⚠ Connection refused");
      exitTest(0);
      return;
    }
    console.error(err);
    failed++;
  } finally {
    if (documentId != null) {
      await pool.query(`DELETE FROM documents WHERE id = $1`, [documentId]).catch(() => {});
    }
    if (purchaseOrderId != null) {
      await pool.query(`DELETE FROM purchase_order_items WHERE order_id = $1`, [purchaseOrderId]).catch(() => {});
      await pool.query(`DELETE FROM purchase_orders WHERE id = $1`, [purchaseOrderId]).catch(() => {});
    }
    if (requisitionId != null) {
      await pool.query(`DELETE FROM purchase_requisition_items WHERE requisition_id = $1`, [requisitionId]).catch(() => {});
      await pool.query(`DELETE FROM purchase_requisitions WHERE id = $1`, [requisitionId]).catch(() => {});
    }
    if (inventoryItemId != null) {
      await pool.query(`DELETE FROM inventory_items WHERE id = $1`, [inventoryItemId]).catch(() => {});
    }
    if (supplierId != null) {
      await pool.query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => {});
    }
    if (orgId != null) {
      await pool.query(`DELETE FROM organization_settings WHERE organization_id = $1`, [orgId]).catch(() => {});
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
    }
  }

  console.log("\nResult: %d passed, %d failed", passed, failed);
  exitTest(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  exitTest(1);
});
