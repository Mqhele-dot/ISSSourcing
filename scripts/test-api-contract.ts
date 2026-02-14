import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

type HttpResult = {
  status: number;
  ok: boolean;
  json: unknown;
};

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
      // server may still be starting
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for /health");
}

async function main() {
  const port = Number(process.env.CONTRACT_TEST_PORT ?? 5123);
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

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  const request = async (
    path: string,
    options?: {
      method?: string;
      body?: unknown;
    },
  ): Promise<HttpResult> => {
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
    return {
      status: response.status,
      ok: response.ok,
      json,
    };
  };

  try {
    await waitForHealthy(baseUrl, 120_000);

    const login = await request("/api/login", {
      method: "POST",
      body: {
        username: "admin",
        password: "Admin123!",
      },
    });
    assert(login.ok, `Login failed with status ${login.status}`);

    const reset = await request("/admin/demo/reset", { method: "POST" });
    assert(reset.ok, `Demo reset failed with status ${reset.status}`);

    const inventoryList = await request("/api/inventory");
    assert(inventoryList.ok, "Inventory list request failed");
    assert(
      typeof inventoryList.json === "object" &&
        inventoryList.json !== null &&
        "ok" in inventoryList.json &&
        (inventoryList.json as { ok: boolean }).ok === true &&
        Array.isArray((inventoryList.json as { data: unknown }).data),
      "Inventory list did not return ok envelope",
    );

    const inventoryItems = (inventoryList.json as { data: Array<Record<string, unknown>> }).data;
    const firstItem = inventoryItems[0];
    assert(firstItem, "Inventory list did not return any items");
    assert(typeof firstItem.sku === "string", "Inventory item missing sku");
    assert(typeof firstItem.id === "number", "Inventory item missing id");

    const suppliers = await request("/api/suppliers");
    assert(suppliers.ok, "Suppliers request failed");
    assert(Array.isArray(suppliers.json), "Suppliers endpoint should return array");
    const firstSupplier = (suppliers.json as Array<Record<string, unknown>>)[0];
    assert(firstSupplier && typeof firstSupplier.id === "number", "No supplier available");

    const createPo = await request("/api/purchase-orders", {
      method: "POST",
      body: {
        supplierId: firstSupplier.id,
        totalAmount: 100,
        status: "DRAFT",
        items: [
          {
            itemId: firstItem.id,
            quantity: 5,
            unitPrice: 20,
            totalPrice: 100,
          },
        ],
      },
    });
    assert(createPo.ok, `Create PO failed with status ${createPo.status}`);
    const poNumber =
      typeof (createPo.json as { orderNumber?: unknown }).orderNumber === "string"
        ? (createPo.json as { orderNumber: string }).orderNumber
        : null;
    assert(poNumber, "Created PO missing orderNumber");

    for (const status of ["open", "approved", "sent"] as const) {
      const statusUpdate = await request(`/api/purchase/orders/${encodeURIComponent(poNumber)}/status`, {
        method: "POST",
        body: { toStatus: status },
      });
      assert(statusUpdate.ok, `PO status update to ${status} failed with ${statusUpdate.status}`);
      assert(
        typeof statusUpdate.json === "object" &&
          statusUpdate.json !== null &&
          "ok" in statusUpdate.json &&
          (statusUpdate.json as { ok: boolean }).ok === true,
        `PO status update to ${status} missing ok envelope`,
      );
    }

    const receive = await request(`/api/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
      method: "POST",
      body: {
        lines: [{ sku: firstItem.sku, qty_received_now: 2 }],
      },
    });
    assert(receive.ok, `PO receive failed with status ${receive.status}`);
    assert(
      typeof receive.json === "object" &&
        receive.json !== null &&
        "ok" in receive.json &&
        (receive.json as { ok: boolean }).ok === true &&
        typeof (receive.json as { data?: unknown }).data === "object" &&
        (receive.json as { data: { changed?: unknown } }).data.changed !== undefined,
      "PO receive did not return ok envelope with changed payload",
    );

    const shortage = await request(`/api/inventory/${encodeURIComponent(firstItem.sku as string)}/adjust`, {
      method: "POST",
      body: {
        location:
          typeof firstItem.location === "string" && firstItem.location.length > 0
            ? firstItem.location
            : "Main Warehouse",
        delta: -999,
        reason: "Contract test shortage",
        ref: "CONTRACT-TEST",
      },
    });
    assert(shortage.ok, "Shortage adjustment failed");
    const shortageJson = shortage.json as {
      ok: true;
      data: { exception?: { id?: number } };
    };
    const exceptionId = shortageJson.data.exception?.id;
    assert(typeof exceptionId === "number", "Shortage adjustment did not create an exception");

    const invalidTransition = await request(`/api/exceptions/${exceptionId}/status`, {
      method: "POST",
      body: { toStatus: "not_a_valid_target" },
    });
    assert(invalidTransition.status === 400, "Invalid exception transition should return 400");
    assert(
      typeof invalidTransition.json === "object" &&
        invalidTransition.json !== null &&
        "ok" in invalidTransition.json &&
        (invalidTransition.json as { ok: boolean }).ok === false &&
        typeof (invalidTransition.json as { error?: unknown }).error === "object" &&
        invalidTransition.json !== null &&
        Array.isArray(
          ((invalidTransition.json as { error: { details?: { allowedTargets?: unknown } } }).error
            .details as { allowedTargets?: unknown })?.allowedTargets,
        ),
      "Invalid transition did not return err envelope with allowedTargets",
    );

    console.log("✅ API contract tests passed");
  } finally {
    child.kill("SIGTERM");
    await delay(1000);
    if (!child.killed) {
      child.kill("SIGKILL");
    }
    if (child.exitCode !== 0 && child.exitCode !== null) {
      process.stderr.write(logs);
    }
  }
}

main().catch((error) => {
  console.error("❌ API contract tests failed:", error);
  process.exit(1);
});
