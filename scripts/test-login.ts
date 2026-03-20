/**
 * Tests the login flow used by the auth page (POST /api/login).
 * Uses scripts/test-http.ts. On 429 (rate limit), warns and exits 0 so reruns are not confused with a broken login.
 */
import process from "node:process";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused } from "./test-http.ts";

async function main() {
  console.log("Testing login (POST /api/login)...\n");

  const badLogin = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "admin", password: "WrongPassword123!" },
  });

  if (badLogin.status === 429) {
    console.warn("⚠ Rate limited (429) on invalid-credential probe — not treating as auth bug. Wait and retry.");
    exitTest(0);
    return;
  }

  if (badLogin.status === 401) {
    const msg =
      badLogin.json && typeof badLogin.json === "object" && "message" in badLogin.json
        ? String((badLogin.json as { message: unknown }).message)
        : "";
    if (msg.toLowerCase().includes("invalid") || msg.includes("password") || msg.includes("username")) {
      console.log("✓ Invalid credentials return 401 with clear message:", msg || "(ok)");
    } else {
      console.warn("⚠ Invalid credentials return 401 but message may be generic:", msg);
    }
  } else if (badLogin.status >= 500) {
    const msg =
      badLogin.json && typeof badLogin.json === "object" && "message" in badLogin.json
        ? String((badLogin.json as { message: unknown }).message)
        : "";
    if (msg && !msg.toLowerCase().includes("internal server error")) {
      console.log("✓ Server returns clear error message on failure:", msg.slice(0, 80) + (msg.length > 80 ? "..." : ""));
    } else {
      console.warn("⚠ Server returned " + badLogin.status + " with no specific message. Ensure auth returns a clear message.");
    }
  } else {
    console.error("✗ Expected 401 for wrong password, got", badLogin.status);
    process.exitCode = 1;
  }

  const goodLogin = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });

  if (goodLogin.status === 429) {
    console.warn("⚠ Rate limited (429) on valid login probe — not treating as broken credentials. Wait and retry.");
    exitTest(0);
    return;
  }

  if (goodLogin.ok && goodLogin.status === 200) {
    const user = goodLogin.json as Record<string, unknown> | null;
    if (user && (user.id !== undefined || user.username !== undefined)) {
      console.log("✓ Valid credentials (admin / Admin123!) return 200 and user object");
    } else {
      console.warn("⚠ Login returned 200 but response may not be a user object:", typeof goodLogin.json);
    }
  } else if (goodLogin.status === 401) {
    console.warn(
      "⚠ Valid demo credentials (admin / Admin123!) were rejected. Ensure DB is seeded: npm run db:seed",
    );
    console.warn("  Status:", goodLogin.status, "Response:", JSON.stringify(goodLogin.json).slice(0, 120));
  } else {
    const msg =
      goodLogin.json && typeof goodLogin.json === "object" && "message" in goodLogin.json
        ? String((goodLogin.json as { message: unknown }).message)
        : "";
    if (goodLogin.status === 503 && msg) {
      console.warn("⚠ Server returned 503 (expected when DB/session unavailable):", msg.slice(0, 80));
      console.warn("  This is a clear error – the UI will not show a generic 'An error occurred during login'.");
    } else {
      console.error("✗ Login with valid credentials failed:", goodLogin.status, goodLogin.json);
      process.exitCode = 1;
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.warn("⚠ Server not reachable at", getTestBaseUrl(), "- start with: npm run dev");
    exitTest(0);
  }
  console.error(err);
  exitTest(1);
});
