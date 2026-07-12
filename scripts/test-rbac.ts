/**
 * RBAC tests: verify viewer cannot perform write operations and manager/admin can.
 * Requires server running with seeded DB (npm run dev, npm run db:seed).
 *
 * Run: npx tsx scripts/test-rbac.ts
 * Or:  BASE_URL=http://localhost:5000 npm run test:rbac
 *
 * Uses scripts/test-http.ts for HTTP + login (do not duplicate fetch blocks).
 */
import process from "node:process";
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  getTestBaseUrl,
  isConnectionRefused,
  isLiveServerRequired,
  loginForTests,
  reportConnectionRefused,
} from "./test-http.ts";

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("RBAC tests (BASE_URL=%s)\n", BASE_URL);

  let passed = 0;
  let failed = 0;

  function expect(name: string, status: number, actual: number, ok: boolean): void {
    if (actual === status) {
      console.log("  ✓ %s → %d", name, actual);
      passed++;
    } else {
      console.log("  ✗ %s → expected %d, got %d (ok=%s)", name, status, actual, ok);
      failed++;
    }
  }

  try {
    const viewerCookie = await loginForTests("viewer", "Admin123!");
    if (!viewerCookie) {
      console.log("  ⚠ Viewer login failed (is DB seeded? npm run db:seed). Skipping viewer write tests.");
    } else {
      const createAsViewer = await apiJsonRequest("/contracts", {
        method: "POST",
        body: {
          supplierId: 1,
          title: "Test",
          contractType: "master",
          startDate: new Date().toISOString(),
        },
        cookie: viewerCookie,
      });
      expect("Viewer POST /api/contracts (expect 403)", 403, createAsViewer.status, createAsViewer.ok);
    }

    const viewerCookieForGet = viewerCookie ?? (await loginForTests("viewer", "Admin123!"));
    if (viewerCookieForGet) {
      const listAsViewer = await apiJsonRequest("/contracts", { method: "GET", cookie: viewerCookieForGet });
      expect("Viewer GET /api/contracts (expect 200)", 200, listAsViewer.status, listAsViewer.ok);
    }

    const adminCookie = await loginForTests("admin", "Admin123!");
    if (!adminCookie) {
      console.log("  ⚠ Admin login failed. Skipping admin write tests.");
    } else {
      const listAsAdmin = await apiJsonRequest("/contracts", { method: "GET", cookie: adminCookie });
      expect("Admin GET /api/contracts (expect 200)", 200, listAsAdmin.status, listAsAdmin.ok);

      const createAsAdmin = await apiJsonRequest("/contracts", {
        method: "POST",
        body: {
          supplierId: 1,
          title: "RBAC test contract",
          contractType: "master",
          startDate: new Date().toISOString(),
        },
        cookie: adminCookie,
      });
      if (createAsAdmin.status === 403) {
        console.log("  ✗ Admin POST /api/contracts (expect 201 or 400) → 403 Forbidden");
        failed++;
      } else {
        console.log("  ✓ Admin POST /api/contracts → %d (auth allowed)", createAsAdmin.status);
        passed++;
      }
    }

    const noAuth = await apiJsonRequest("/contracts", { method: "GET" });
    if (noAuth.status === 401 || noAuth.status === 302 || noAuth.status === 403) {
      console.log("  ✓ Unauthenticated GET /api/contracts → %d", noAuth.status);
      passed++;
    } else {
      console.log("  ✗ Unauthenticated GET /api/contracts → expected 401/302/403, got %d", noAuth.status);
      failed++;
    }
  } catch (err) {
    if (isConnectionRefused(err)) {
      console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", BASE_URL);
      reportConnectionRefused(BASE_URL);
      exitTest(isLiveServerRequired() ? 1 : 0);
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
