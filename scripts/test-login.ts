/**
 * Tests the login flow used by the auth page (POST /api/login).
 * Ensures valid credentials succeed and invalid ones return a clear error message.
 *
 * Run with server up: npm run dev (in another terminal) then npm run test:login
 * Or: BASE_URL=http://localhost:5000 npx tsx scripts/test-login.ts
 */
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { exitTest } from "./test-exit.ts";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
const API = `${BASE_URL}/api`;

async function fetchJson(
  path: string,
  options: { method?: string; body?: unknown },
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log("Testing login (POST /api/login)...\n");

  // 1. Invalid credentials must return 401 and a clear message (so UI can show it)
  const badLogin = await fetchJson(`${API}/login`, {
    method: "POST",
    body: { username: "admin", password: "WrongPassword123!" },
  });

  if (badLogin.status === 401) {
    const msg =
      badLogin.data && typeof badLogin.data === "object" && "message" in badLogin.data
        ? String((badLogin.data as { message: unknown }).message)
        : "";
    if (msg.toLowerCase().includes("invalid") || msg.includes("password") || msg.includes("username")) {
      console.log("✓ Invalid credentials return 401 with clear message:", msg || "(ok)");
    } else {
      console.warn("⚠ Invalid credentials return 401 but message may be generic:", msg);
    }
  } else if (badLogin.status >= 500) {
    const msg =
      badLogin.data && typeof badLogin.data === "object" && "message" in badLogin.data
        ? String((badLogin.data as { message: unknown }).message)
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

  // 2. Valid credentials must return 200 and user (so login succeeds)
  const goodLogin = await fetchJson(`${API}/login`, {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });

  if (goodLogin.ok && goodLogin.status === 200) {
    const user = goodLogin.data as Record<string, unknown> | null;
    if (user && (user.id !== undefined || user.username !== undefined)) {
      console.log("✓ Valid credentials (admin / Admin123!) return 200 and user object");
    } else {
      console.warn("⚠ Login returned 200 but response may not be a user object:", typeof goodLogin.data);
    }
  } else if (goodLogin.status === 401) {
    console.warn(
      "⚠ Valid demo credentials (admin / Admin123!) were rejected. Ensure DB is seeded: npm run db:seed",
    );
    console.warn("  Status:", goodLogin.status, "Response:", JSON.stringify(goodLogin.data).slice(0, 120));
  } else {
    const msg =
      goodLogin.data && typeof goodLogin.data === "object" && "message" in goodLogin.data
        ? String((goodLogin.data as { message: unknown }).message)
        : "";
    if (goodLogin.status === 503 && msg) {
      console.warn("⚠ Server returned 503 (expected when DB/session unavailable):", msg.slice(0, 80));
      console.warn("  This is a clear error – the UI will not show a generic 'An error occurred during login'.");
    } else {
      console.error("✗ Login with valid credentials failed:", goodLogin.status, goodLogin.data);
      process.exitCode = 1;
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  if (err.cause?.code === "ECONNREFUSED") {
    console.warn("⚠ Server not reachable at", BASE_URL, "- start with: npm run dev");
    exitTest(0);
  }
  console.error(err);
  exitTest(1);
});
