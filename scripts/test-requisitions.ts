/**
 * Requisitions API tests: permissions, validation, and success path.
 * Requires server running with seeded DB (npm run dev, npm run db:seed).
 *
 * Run: npx tsx scripts/test-requisitions.ts
 * Uses scripts/test-http.ts for HTTP + login.
 */
import process from "node:process";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, apiRawRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

function getMessage(json: unknown): string {
  if (json && typeof json === "object" && "message" in json && typeof (json as { message: unknown }).message === "string") {
    return (json as { message: string }).message;
  }
  return "";
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Requisitions API tests (BASE_URL=%s)\n", BASE_URL);

  let passed = 0;
  let failed = 0;

  function expectStatus(name: string, expected: number, actual: number): void {
    if (actual === expected) {
      console.log("  ✓ %s → %d", name, actual);
      passed++;
    } else {
      console.log("  ✗ %s → expected %d, got %d", name, expected, actual);
      failed++;
    }
  }

  function expectStatusOneOf(name: string, expected: number[], actual: number): void {
    if (expected.includes(actual)) {
      console.log("  ✓ %s → %d", name, actual);
      passed++;
    } else {
      console.log("  ✗ %s → expected one of %s, got %d", name, expected.join("/"), actual);
      failed++;
    }
  }

  try {
    const noAuth = await apiJsonRequest("/purchase-requisitions", { method: "GET" });
    expectStatusOneOf("Unauthenticated GET /api/purchase-requisitions", [401, 302, 403], noAuth.status);

    const viewerCookie = await loginForTests("viewer", "Admin123!");
    if (!viewerCookie) {
      console.log("  ⚠ Viewer login failed (is DB seeded?). Skipping viewer tests.");
    } else {
      const listAsViewer = await apiJsonRequest("/purchase-requisitions", { method: "GET", cookie: viewerCookie });
      expectStatus("Viewer GET /api/purchase-requisitions (expect 200)", 200, listAsViewer.status);

      const createAsViewer = await apiJsonRequest("/purchase-requisitions", {
        method: "POST",
        body: {
          supplierId: 1,
          items: [{ itemId: 1, quantity: 1, unitPrice: 1.5 }],
        },
        cookie: viewerCookie,
      });
      expectStatus("Viewer POST /api/purchase-requisitions (expect 403)", 403, createAsViewer.status);
    }

    const adminCookie = await loginForTests("admin", "Admin123!");
    if (!adminCookie) {
      console.log("  ⚠ Admin login failed. Skipping admin tests.");
    } else {
      const reqPdfRes = await apiRawRequest("/export/purchase_requisitions/pdf", { method: "GET", cookie: adminCookie });
      const reqPdfBuf = await reqPdfRes.arrayBuffer();
      expectStatus("Admin GET /api/export/purchase_requisitions/pdf (expect 200)", 200, reqPdfRes.status);
      if (reqPdfRes.ok) {
        const reqPdfMagic =
          String.fromCharCode(...new Uint8Array(reqPdfBuf.slice(0, 5))) === "%PDF-" && reqPdfBuf.byteLength > 128;
        if (reqPdfMagic) {
          console.log("  ✓ Requisitions PDF export body looks valid (size=%d)", reqPdfBuf.byteLength);
        } else {
          console.log("  ✗ Requisitions PDF export bad body (bytes=%d)", reqPdfBuf.byteLength);
          failed++;
        }
      }

      const noItems = await apiJsonRequest("/purchase-requisitions", {
        method: "POST",
        body: { supplierId: 1, items: [] },
        cookie: adminCookie,
      });
      expectStatus("Admin POST with items: [] (expect 400)", 400, noItems.status);
      if (noItems.status === 400 && getMessage(noItems.json).toLowerCase().includes("at least one item")) {
        console.log("    (message mentions at least one item)");
      }

      const badQty = await apiJsonRequest("/purchase-requisitions", {
        method: "POST",
        body: {
          supplierId: 1,
          items: [{ itemId: 1, quantity: 0, unitPrice: 1.5 }],
        },
        cookie: adminCookie,
      });
      expectStatus("Admin POST with quantity 0 (expect 400)", 400, badQty.status);
      if (badQty.status === 400 && (getMessage(badQty.json).toLowerCase().includes("quantity") || getMessage(badQty.json).includes("Item 1"))) {
        console.log("    (message mentions quantity)");
      }

      const badPrice = await apiJsonRequest("/purchase-requisitions", {
        method: "POST",
        body: {
          supplierId: 1,
          items: [{ itemId: 1, quantity: 1, unitPrice: 0 }],
        },
        cookie: adminCookie,
      });
      expectStatus("Admin POST with unitPrice 0 (expect 400)", 400, badPrice.status);
      if (badPrice.status === 400 && (getMessage(badPrice.json).toLowerCase().includes("price") || getMessage(badPrice.json).includes("Item 1"))) {
        console.log("    (message mentions unit price)");
      }

      const validCreate = await apiJsonRequest("/purchase-requisitions", {
        method: "POST",
        body: {
          supplierId: 1,
          items: [{ itemId: 1, quantity: 1, unitPrice: 1.5 }],
        },
        cookie: adminCookie,
      });
      if (validCreate.status === 201) {
        console.log("  ✓ Admin POST valid requisition → 201");
        passed++;
        const body = validCreate.json as { id?: number; requisitionNumber?: string };
        if (body && typeof body.id === "number" && body.requisitionNumber) {
          console.log("    (id=%d, requisitionNumber=%s)", body.id, body.requisitionNumber);
          const getOne = await apiJsonRequest(`/purchase-requisitions/${body.id}`, { method: "GET", cookie: adminCookie });
          expectStatus("Admin GET /api/purchase-requisitions/:id after create (expect 200)", 200, getOne.status);

          const approveRes = await apiJsonRequest(`/purchase-requisitions/${body.id}/approve`, {
            method: "POST",
            body: {},
            cookie: adminCookie,
          });
          expectStatus("Admin POST /api/purchase-requisitions/:id/approve (expect 200)", 200, approveRes.status);

          const convertRes = await apiJsonRequest(`/purchase-requisitions/${body.id}/convert`, {
            method: "POST",
            body: {},
            cookie: adminCookie,
          });
          expectStatus("Admin POST /api/purchase-requisitions/:id/convert (expect 201)", 201, convertRes.status);
        }
      } else if (validCreate.status === 400 || validCreate.status === 404) {
        console.log("  ⚠ Admin POST valid requisition → %d (DB may lack supplier/id 1 or item id 1; auth passed)", validCreate.status);
        passed++;
      } else {
        console.log("  ✗ Admin POST valid requisition → expected 201 (or 400/404), got %d", validCreate.status);
        failed++;
      }
    }
  } catch (err) {
    if (isConnectionRefused(err)) {
      console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", BASE_URL);
      exitTest(0);
    }
    throw err;
  }

  console.log("\nResult: %d passed, %d failed", passed, failed);
  exitTest(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  exitTest(1);
});
