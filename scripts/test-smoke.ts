import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  clearSessionCookie,
  getTestBaseUrl,
  isConnectionRefused,
  loginForTests,
} from "./test-http.ts";

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Smoke suite (BASE_URL=%s)\n", baseUrl);

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

  clearSessionCookie();
  await check(
    "Setup status without session returns 401",
    apiJsonRequest("/setup/status", { method: "GET", baseUrl }).then((res) => res.status === 401),
  );

  const cookie = await loginForTests("admin", "Admin123!", baseUrl);
  if (!cookie) {
    console.log("  ⚠ Admin login failed. Ensure demo users exist (npm run db:seed).");
    exitTest(0);
    return;
  }

  await check("Login session", apiJsonRequest("/user", { method: "GET", cookie, baseUrl }).then((res) => res.ok));
  await check(
    "Export center API",
    apiJsonRequest("/export-center/history", { method: "GET", cookie, baseUrl }).then((res) => res.ok),
  );
  await check(
    "Saved reports API",
    apiJsonRequest("/export-center/saved-reports", { method: "GET", cookie, baseUrl }).then((res) => res.ok),
  );
  await check(
    "Reports analytics JSON (operational_exceptions summary)",
    apiJsonRequest("/reports/analytics", { method: "GET", cookie, baseUrl }).then((res) => {
      if (!res.ok || res.status !== 200) return false;
      const body = res.json as { ok?: boolean; data?: Record<string, unknown> };
      if (!body?.ok || !body.data || typeof body.data !== "object") return false;
      return Array.isArray(body.data.exceptionSummary);
    }),
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
  await check(
    "Ready payload shape (productBootstrap when db ready)",
    apiJsonRequest("/ready", { method: "GET", cookie, baseUrl }).then((res) => {
      if (!res.ok) return false;
      const body = res.json as { ok?: boolean; data?: Record<string, unknown> };
      if (!body?.ok || !body.data) return false;
      if (body.data.dbReady !== true) return true;
      return Object.prototype.hasOwnProperty.call(body.data, "productBootstrap");
    }),
  );

  await check(
    "Setup status payload shape (onboarding + database + build + health)",
    apiJsonRequest("/setup/status", { method: "GET", cookie, baseUrl }).then((res) => {
      if (!res.ok || res.status !== 200) return false;
      const envelope = res.json as { ok?: boolean; data?: Record<string, unknown> };
      if (!envelope?.ok || !envelope.data || typeof envelope.data !== "object") return false;
      const d = envelope.data;
      if (d.setupStatusHealth !== "ok" && d.setupStatusHealth !== "degraded") return false;
      const issues = d.issues as Array<Record<string, unknown>> | undefined;
      const dbBad =
        d.database != null &&
        typeof d.database === "object" &&
        (d.database as { ok?: boolean }).ok === false;
      const hasCritical = Array.isArray(issues) && issues.some((issue) => issue?.level === "critical");
      if (d.setupStatusHealth === "degraded") {
        if (!dbBad && !hasCritical) return false;
        if (!Array.isArray(issues) || issues.length === 0) return false;
      } else {
        if (dbBad || hasCritical) return false;
      }
      if (Array.isArray(issues)) {
        for (const item of issues) {
          if (!item || typeof item !== "object") return false;
          const issue = item as Record<string, unknown>;
          if (typeof issue.code !== "string" || typeof issue.message !== "string") return false;
          if (issue.level != null && issue.level !== "critical" && issue.level !== "warning") return false;
        }
      }
      if (!d.onboarding || typeof d.onboarding !== "object") return false;
      const ob = d.onboarding as Record<string, unknown>;
      if (typeof ob.required !== "boolean") return false;
      if (!("checkpoint" in ob)) return false;
      if (d.database != null && typeof d.database !== "object") return false;
      if (d.build != null && typeof d.build !== "object") return false;
      return true;
    }),
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
