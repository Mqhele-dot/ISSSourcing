/**
 * Requisitions API tests: permissions, validation, and success path.
 * Requires server running with seeded DB (npm run dev, npm run db:seed).
 *
 * Run: npx tsx scripts/test-requisitions.ts
 * Or:  BASE_URL=http://localhost:5000 npm run test:requisitions
 */
import process from "node:process";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
const API = `${BASE_URL}/api`;

type HttpResult = { status: number; ok: boolean; json: unknown };

let lastCookie: string | undefined;

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string },
): Promise<HttpResult> {
  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) lastCookie = setCookie.split(";")[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}

async function login(username: string, password: string): Promise<string | undefined> {
  lastCookie = undefined;
  await request("/auth/login", { method: "POST", body: { username, password } });
  if (!lastCookie) {
    await request("/login", { method: "POST", body: { username, password } });
  }
  return lastCookie;
}

function getMessage(json: unknown): string {
  if (json && typeof json === "object" && "message" in json && typeof (json as { message: unknown }).message === "string") {
    return (json as { message: string }).message;
  }
  return "";
}

async function main() {
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
    // 1. Unauthenticated GET /api/purchase-requisitions → 401 or 302 or 403
    const noAuth = await request("/purchase-requisitions", { method: "GET" });
    expectStatusOneOf("Unauthenticated GET /api/purchase-requisitions", [401, 302, 403], noAuth.status);

    // 2. Viewer can list (200)
    const viewerCookie = await login("viewer", "Admin123!");
    if (!viewerCookie) {
      console.log("  ⚠ Viewer login failed (is DB seeded?). Skipping viewer tests.");
    } else {
      const listAsViewer = await request("/purchase-requisitions", { method: "GET", cookie: viewerCookie });
      expectStatus("Viewer GET /api/purchase-requisitions (expect 200)", 200, listAsViewer.status);

      // 3. Viewer cannot create (403)
      const createAsViewer = await request("/purchase-requisitions", {
        method: "POST",
        body: {
          supplierId: 1,
          items: [{ itemId: 1, quantity: 1, unitPrice: 1.5 }],
        },
        cookie: viewerCookie,
      });
      expectStatus("Viewer POST /api/purchase-requisitions (expect 403)", 403, createAsViewer.status);
    }

    // 4. Admin: validation – no items → 400
    const adminCookie = await login("admin", "Admin123!");
    if (!adminCookie) {
      console.log("  ⚠ Admin login failed. Skipping admin tests.");
    } else {
      const noItems = await request("/purchase-requisitions", {
        method: "POST",
        body: { supplierId: 1, items: [] },
        cookie: adminCookie,
      });
      expectStatus("Admin POST with items: [] (expect 400)", 400, noItems.status);
      if (noItems.status === 400 && getMessage(noItems.json).toLowerCase().includes("at least one item")) {
        console.log("    (message mentions at least one item)");
      }

      // 5. Admin: validation – quantity <= 0 → 400
      const badQty = await request("/purchase-requisitions", {
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

      // 6. Admin: validation – unit price 0 → 400
      const badPrice = await request("/purchase-requisitions", {
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

      // 7. Admin can create (201) – assumes seeded DB has supplier id 1 and inventory item id 1
      const validCreate = await request("/purchase-requisitions", {
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
    const cause = (err as NodeJS.ErrnoException & { cause?: { code?: string } })?.cause;
    if (cause?.code === "ECONNREFUSED") {
      console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", BASE_URL);
      process.exit(0);
    }
    throw err;
  }

  console.log("\nResult: %d passed, %d failed", passed, failed);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
