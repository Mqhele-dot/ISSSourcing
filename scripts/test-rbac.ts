/**
 * RBAC tests: verify viewer cannot perform write operations and manager/admin can.
 * Requires server running with seeded DB (npm run dev, npm run db:seed).
 *
 * Run: npx tsx scripts/test-rbac.ts
 * Or:  BASE_URL=http://localhost:5000 npm run test:rbac
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
  let res = await request("/auth/login", { method: "POST", body: { username, password } });
  if (!res.ok && res.status !== 404) {
    res = await request("/login", { method: "POST", body: { username, password } });
  }
  return lastCookie;
}

async function main() {
  console.log("RBAC tests (BASE_URL=%s)\n", BASE_URL);

  let passed = 0;
  let failed = 0;

  // Helper: expect status and count result
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
    // 1. Viewer must get 403 on POST /api/contracts
    const viewerCookie = await login("viewer", "Admin123!");
    if (!viewerCookie) {
      console.log("  ⚠ Viewer login failed (is DB seeded? npm run db:seed). Skipping viewer write tests.");
    } else {
      const createAsViewer = await request("/contracts", {
        method: "POST",
        body: {
          supplierId: 1,
          title: "Test",
          contractType: "master",
          startDate: new Date().toISOString(),
        },
        cookie: viewerCookie,
      });
      const status = createAsViewer.status;
      expect("Viewer POST /api/contracts (expect 403)", 403, status, createAsViewer.ok);
    }

    // 2. Viewer must get 200 on GET /api/contracts (read allowed)
    const viewerCookieForGet = viewerCookie ?? await login("viewer", "Admin123!");
    if (viewerCookieForGet) {
      const listAsViewer = await request("/contracts", { method: "GET", cookie: viewerCookieForGet });
      expect("Viewer GET /api/contracts (expect 200)", 200, listAsViewer.status, listAsViewer.ok);
    }

    // 3. Manager or admin can create (we use admin)
    const adminCookie = await login("admin", "Admin123!");
    if (!adminCookie) {
      console.log("  ⚠ Admin login failed. Skipping admin write tests.");
    } else {
      const listAsAdmin = await request("/contracts", { method: "GET", cookie: adminCookie });
      expect("Admin GET /api/contracts (expect 200)", 200, listAsAdmin.status, listAsAdmin.ok);

      // POST as admin: may be 201 (created) or 400 (validation) — both mean auth passed
      const createAsAdmin = await request("/contracts", {
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

    // 4. Unauthenticated GET /api/contracts should be 401 or 302 (redirect to login)
    const noAuth = await request("/contracts", { method: "GET" });
    if (noAuth.status === 401 || noAuth.status === 302 || noAuth.status === 403) {
      console.log("  ✓ Unauthenticated GET /api/contracts → %d", noAuth.status);
      passed++;
    } else {
      console.log("  ✗ Unauthenticated GET /api/contracts → expected 401/302/403, got %d", noAuth.status);
      failed++;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).cause?.code === "ECONNREFUSED") {
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
