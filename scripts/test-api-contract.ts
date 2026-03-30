import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

type HttpResult = {
  status: number;
  ok: boolean;
  json: unknown;
  /** Correlation id when server sets `X-Request-Id` (`server/index.ts`). */
  requestId: string | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function withNoTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
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
      // waiting for server startup
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for health endpoint at ${baseUrl}/health`);
}

function extractErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === false &&
    "error" in payload
  ) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    if (error?.code || error?.message) {
      return `[${error.code ?? "UNKNOWN"}] ${error.message ?? "Unknown error"}`;
    }
  }

  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return JSON.stringify(payload);
}

async function main() {
  const baseUrl = withNoTrailingSlash(process.env.BASE_URL ?? "http://127.0.0.1:5000");
  const apiBase = withNoTrailingSlash(process.env.API_BASE ?? `${baseUrl}/api`);
  let cookie = "";

  const request = async (
    url: string,
    options?: {
      method?: string;
      body?: unknown;
    },
  ): Promise<HttpResult> => {
    const response = await fetch(url, {
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
      requestId: response.headers.get("x-request-id"),
    };
  };

  const requestApi = (
    path: string,
    options?: {
      method?: string;
      body?: unknown;
    },
  ) => request(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, options);

  try {
    await waitForHealthy(baseUrl, 8_000);
  } catch (err) {
    console.warn(
      "⚠️ Skipping API contract tests: server not reachable at",
      baseUrl,
      "(start with npm run dev to run)",
    );
    process.exitCode = 0;
    return;
  }

  const loginPrimary = await requestApi("/auth/login", {
    method: "POST",
    body: {
      username: "admin",
      password: "Admin123!",
    },
  });

  let login = loginPrimary;
  if (!login.ok && login.status === 404) {
    // Backward compatibility with existing /api/login route.
    login = await requestApi("/login", {
      method: "POST",
      body: {
        username: "admin",
        password: "Admin123!",
      },
    });
  }

  if (!login.ok && (login.status >= 500 || login.status === 429)) {
    console.warn(
      "⚠️ Skipping API contract tests: login failed (server/auth unavailable or rate limited).",
      "Start the server with a seeded DB to run contract tests.",
    );
    process.exitCode = 0;
    return;
  }
  assert(
    login.ok,
    `Login failed with status ${login.status}: ${extractErrorMessage(login.json)}`,
  );
  assert(
    typeof login.requestId === "string" && login.requestId.length > 0,
    "Login response should include non-empty X-Request-Id header",
  );

  const reset = await requestApi("/admin/demo/reset", { method: "POST" });
  assert(
    reset.ok,
    `Demo reset failed with status ${reset.status}: ${extractErrorMessage(reset.json)}`,
  );

  const inventoryList = await requestApi("/inventory");
  assert(inventoryList.ok, "Inventory list request failed");
  // Dual contract: legacy raw array OR envelope { ok, data } (see docs/API_CONTRACTS.md)
  let inventoryItems: Array<Record<string, unknown>>;
  if (Array.isArray(inventoryList.json)) {
    inventoryItems = inventoryList.json as Array<Record<string, unknown>>;
  } else {
    assert(
      typeof inventoryList.json === "object" &&
        inventoryList.json !== null &&
        "ok" in inventoryList.json &&
        (inventoryList.json as { ok: boolean }).ok === true &&
        Array.isArray((inventoryList.json as { data: unknown }).data),
      "Inventory list did not return array or ok envelope",
    );
    inventoryItems = (inventoryList.json as { data: Array<Record<string, unknown>> }).data;
  }
  const firstItem = inventoryItems[0];
  assert(firstItem, "Inventory list did not return any items");
  assert(typeof firstItem.sku === "string", "Inventory item missing sku");
  assert(typeof firstItem.id === "number", "Inventory item missing id");

  const suppliers = await requestApi("/suppliers");
  assert(suppliers.ok, "Suppliers request failed");
  assert(Array.isArray(suppliers.json), "Suppliers endpoint should return array");
  const firstSupplier = (suppliers.json as Array<Record<string, unknown>>)[0];
  assert(firstSupplier && typeof firstSupplier.id === "number", "No supplier available");

  // Master data: currency POST without symbol (server defaults from code); PATCH name-only keeps symbol
  const curCode = `C${Date.now().toString().slice(-8)}`;
  const createCur = await requestApi("/currencies", {
    method: "POST",
    body: { code: curCode, name: "Contract Test Currency", decimalPlaces: 2 },
  });
  assert(createCur.ok, `Currency POST without symbol failed ${createCur.status}: ${extractErrorMessage(createCur.json)}`);
  const createdCur = createCur.json as { id?: unknown; symbol?: unknown; code?: unknown };
  assert(typeof createdCur.id === "number", "Currency create missing id");
  assert(
    typeof createdCur.symbol === "string" && createdCur.symbol.length > 0,
    "Currency should have symbol defaulted from code",
  );

  const patchCur = await requestApi(`/currencies/${createdCur.id}`, {
    method: "PATCH",
    body: { name: "Contract Test Currency (renamed)" },
  });
  assert(patchCur.ok, `Currency PATCH failed ${patchCur.status}: ${extractErrorMessage(patchCur.json)}`);
  const patchedCur = patchCur.json as { symbol?: unknown; name?: unknown };
  assert(
    typeof patchedCur.symbol === "string" && patchedCur.symbol.length > 0,
    "PATCH without symbol should preserve/default symbol",
  );
  assert(patchedCur.name === "Contract Test Currency (renamed)", "PATCH should update name");

  const delCur = await requestApi(`/currencies/${createdCur.id}`, { method: "DELETE" });
  assert(delCur.ok, `Currency DELETE failed ${delCur.status}`);

  // Warehouses master data smoke (legacy array)
  const warehouses = await requestApi("/warehouses");
  assert(warehouses.ok, "Warehouses list failed");
  assert(Array.isArray(warehouses.json), "Warehouses should return array");

  const createPo = await requestApi("/purchase-orders", {
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
    const statusUpdate = await requestApi(`/purchase/orders/${encodeURIComponent(poNumber)}/status`, {
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

  const receive = await requestApi(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
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

  const shortage = await requestApi(`/inventory/${encodeURIComponent(firstItem.sku as string)}/adjust`, {
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

  const invalidTransition = await requestApi(`/exceptions/${exceptionId}/status`, {
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

  // Dashboard analytics: stock usage (used by Stock Use chart)
  const stockUsage = await requestApi("/analytics/stock-usage?limit=5");
  assert(stockUsage.ok, `Stock usage request failed with status ${stockUsage.status}`);
  assert(
    typeof stockUsage.json === "object" && stockUsage.json !== null && "byItem" in stockUsage.json,
    "Stock usage response must have byItem",
  );
  const byItem = (stockUsage.json as { byItem: unknown }).byItem;
  assert(Array.isArray(byItem), "Stock usage byItem must be an array");
  if (byItem.length > 0) {
    const first = (byItem as Array<{ itemId?: unknown; itemName?: unknown; quantityUsed?: unknown }>)[0];
    assert(typeof first.itemId === "number", "Stock usage item must have itemId");
    assert(typeof first.quantityUsed === "number", "Stock usage item must have quantityUsed");
  }

  // Dashboard: inventory value (used by Value by Category / Inventory Value)
  const inventoryValue = await requestApi("/analytics/inventory-value");
  assert(inventoryValue.ok, "Inventory value request failed");
  assert(
    typeof inventoryValue.json === "object" &&
      inventoryValue.json !== null &&
      "items" in inventoryValue.json &&
      "totalValue" in inventoryValue.json,
    "Inventory value response must have items and totalValue",
  );

  console.log("✅ API contract tests passed");
}

main().catch((error) => {
  console.error("❌ API contract tests failed:", error);
  process.exit(1);
});
