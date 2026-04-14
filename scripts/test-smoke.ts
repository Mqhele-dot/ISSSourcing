import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  getTestBaseUrl,
  isConnectionRefused,
  loginForTests,
} from "./test-http.ts";

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Smoke suite (BASE_URL=%s)\n", baseUrl);

  const cookie = await loginForTests("admin", "Admin123!", baseUrl);
  if (!cookie) {
    console.log("  ⚠ Admin login failed. Ensure demo users exist (npm run db:seed).");
    exitTest(0);
    return;
  }

  let failures = 0;
  const check = async (label: string, promise: Promise<boolean>) => {
    try {
      const ok = await promise;
      if (ok) console.log("  ✓ %s", label);
      else {
        failures++;
        console.log("  ✗ %s", label);
      }
    } catch (error) {
      failures++;
      console.log("  ✗ %s — %s", label, error instanceof Error ? error.message : String(error));
    }
  };

  await check("Login session", apiJsonRequest("/user", { method: "GET", cookie, baseUrl }).then((res) => res.ok));
  await check(
    "Export center API",
    apiJsonRequest("/export-center/history", { method: "GET", cookie, baseUrl }).then((res) => res.ok),
  );
  await check(
    "Saved reports API",
    apiJsonRequest("/export-center/saved-reports", { method: "GET", cookie, baseUrl }).then((res) => res.ok),
  );
  await check("AP overview API", apiJsonRequest("/ap/invoices", { method: "GET", cookie, baseUrl }).then((res) => res.ok));
  await check(
    "Canonical analytics route",
    fetch(`${baseUrl}/analytics/export-center`, { headers: { Cookie: cookie } }).then((res) => res.ok),
  );
  await check(
    "Mobile workflow route",
    fetch(`${baseUrl}/m/tasks`, { headers: { Cookie: cookie } }).then((res) => res.ok),
  );

  console.log("\nSmoke suite result: %d failure(s)", failures);
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", getTestBaseUrl());
    exitTest(0);
    return;
  }
  console.error(err);
  exitTest(1);
});
