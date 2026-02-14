import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealthy(baseUrl: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // waiting for startup
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for health endpoint");
}

async function assertHomeKpiLinks() {
  const source = await fs.readFile("/workspace/client/src/pages/home.tsx", "utf8");
  const required = [
    `exceptions: "/exceptions?status=open&severity=high"`,
    `logistics: "/logistics?status=in_transit&risk=late"`,
    `purchase: "/purchase?status=approved"`,
    `inventory: "/inventory?low=1"`,
  ];
  for (const snippet of required) {
    assert(source.includes(snippet), `Missing KPI deep link snippet: ${snippet}`);
  }
}

async function main() {
  await assertHomeKpiLinks();

  const port = Number(process.env.DEEPLINK_TEST_PORT ?? 5124);
  const baseUrl = `http://127.0.0.1:${port}`;
  let cookie = "";

  const child = spawn("npm", ["run", "dev"], {
    cwd: "/workspace",
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      AUTO_SEED_ON_EMPTY_DB: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  const request = async (
    path: string,
    options?: { method?: string; body?: unknown },
  ): Promise<{ ok: boolean; status: number; json: any }> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options?.method ?? "GET",
      headers: {
        ...(options?.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  };

  try {
    await waitForHealthy(baseUrl, 120_000);

    const login = await request("/api/login", {
      method: "POST",
      body: { username: "admin", password: "Admin123!" },
    });
    assert(login.ok, `Login failed: ${login.status}`);

    const walkthrough = await request("/api/demo/walkthrough/run", {
      method: "POST",
      body: {},
    });
    assert(walkthrough.ok, `Walkthrough setup failed: ${walkthrough.status}`);

    const exceptions = await request("/api/exceptions?status=open&severity=high");
    assert(exceptions.ok && exceptions.json?.ok === true, "Exceptions filter endpoint failed");
    for (const row of exceptions.json.data as Array<{ status: string; severity: string }>) {
      assert(row.status === "open", "Exceptions filter did not apply status=open");
      assert(row.severity === "high", "Exceptions filter did not apply severity=high");
    }

    const logistics = await request("/api/logistics/shipments?status=in_transit&risk=late");
    assert(logistics.ok && logistics.json?.ok === true, "Logistics filter endpoint failed");
    for (const row of logistics.json.data as Array<{ status: string; atRisk: boolean }>) {
      assert(row.status === "in_transit", "Logistics filter did not apply status=in_transit");
      assert(row.atRisk === true, "Logistics filter did not apply risk=late");
    }

    const purchase = await request("/api/purchase/orders?status=approved");
    assert(purchase.ok && purchase.json?.ok === true, "Purchase filter endpoint failed");
    for (const row of purchase.json.data as Array<{ status: string }>) {
      assert(row.status === "approved", "Purchase filter did not apply status=approved");
    }

    const inventory = await request("/api/inventory?low=1");
    assert(inventory.ok && inventory.json?.ok === true, "Inventory low filter endpoint failed");
    for (const row of inventory.json.data as Array<{ available: number; lowStockThreshold: number }>) {
      assert(
        row.available <= row.lowStockThreshold,
        "Inventory filter did not enforce low=1",
      );
    }

    console.log("✅ KPI deep-link test passed");
  } finally {
    child.kill("SIGTERM");
    await delay(1000);
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error("❌ KPI deep-link test failed:", error);
  process.exit(1);
});
