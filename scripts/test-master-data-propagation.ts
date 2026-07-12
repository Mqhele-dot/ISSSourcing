/**
 * Master-data propagation smoke test: reference data reads, requisition→PO, commercial PATCH, AP list.
 *
 * Requires server running and seeded users (`npm run db:seed`).
 *
 * Run:
 *   npx tsx scripts/test-master-data-propagation.ts
 * or
 *   BASE_URL=http://127.0.0.1:5000 npx tsx scripts/test-master-data-propagation.ts
 */
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  expectRequestId,
  getTestBaseUrl,
  isConnectionRefused,
  isLiveServerRequired,
  loginForTests,
  reportConnectionRefused,
} from "./test-http.ts";

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function unwrapData<T>(value: unknown): T {
  if (
    value &&
    typeof value === "object" &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === true &&
    "data" in value
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function truncatedJsonSnippet(value: unknown, max = 480): string {
  try {
    const s = JSON.stringify(value);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  } catch {
    return String(value);
  }
}

function expectStatus(name: string, expected: number, actual: number): boolean {
  if (actual === expected) {
    console.log("  ✓ %s -> %d", name, actual);
    return true;
  }
  console.log("  ✗ %s -> expected %d, got %d", name, expected, actual);
  return false;
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Master-data propagation test (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    exitTest(1);
    return;
  }

  let failures = 0;

  const curRes = await apiJsonRequest("/currencies", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/currencies", 200, curRes.status)) failures++;
  const payRes = await apiJsonRequest("/payment-terms", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/payment-terms", 200, payRes.status)) failures++;
  const taxRes = await apiJsonRequest("/tax-codes", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/tax-codes", 200, taxRes.status)) failures++;
  const incotermsRes = await apiJsonRequest("/incoterms", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/incoterms", 200, incotermsRes.status)) failures++;
  const deptRes = await apiJsonRequest("/departments", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/departments", 200, deptRes.status)) failures++;
  const carriersRes = await apiJsonRequest("/carriers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/carriers", 200, carriersRes.status)) failures++;
  const warehousesRes = await apiJsonRequest("/warehouses", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/warehouses", 200, warehousesRes.status)) failures++;
  const apOverviewRes = await apiJsonRequest("/ap/overview", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/ap/overview", 200, apOverviewRes.status)) failures++;

  const invoicesRes = await apiJsonRequest("/invoices", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/invoices", 200, invoicesRes.status)) failures++;

  const currencies = asArray<{ code: string }>(unwrapData<unknown>(curRes.json));
  const firstCurrencyCode =
    typeof currencies[0]?.code === "string" && /^[A-Za-z]{3}$/.test(currencies[0].code)
      ? currencies[0].code.toUpperCase()
      : "USD";
  const paymentTerms = asArray<{ id: number }>(unwrapData<unknown>(payRes.json));
  const paymentTermsId = Number(paymentTerms[0]?.id ?? 0) || undefined;
  const taxCodes = asArray<{ id: number; active?: boolean | null }>(unwrapData<unknown>(taxRes.json));
  const defaultTaxCodeId = Number(taxCodes.find((taxCode) => taxCode.active !== false)?.id ?? 0) || undefined;
  const incoterms = asArray<{ id: number }>(unwrapData<unknown>(incotermsRes.json));
  const defaultIncotermId = Number(incoterms[0]?.id ?? 0) || undefined;
  const departments = asArray<{ id: number }>(unwrapData<unknown>(deptRes.json));
  const defaultDepartmentId = Number(departments[0]?.id ?? 0) || undefined;
  const carriers = asArray<{ id: number; name: string; active?: boolean | null }>(unwrapData<unknown>(carriersRes.json));
  const defaultCarrier = carriers.find((carrier) => carrier.active !== false && Number(carrier.id) > 0);
  const warehouses = asArray<{ id: number; name: string }>(unwrapData<unknown>(warehousesRes.json));
  const receiveWarehouse = warehouses.find((warehouse) => Number(warehouse.id) > 0);

  const supplierCreateRes = await apiJsonRequest("/suppliers", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: `Propagation Supplier ${Date.now()}`,
      contactName: "Propagation Test",
      email: `propagation-${Date.now()}@example.com`,
      defaultCurrencyCode: firstCurrencyCode,
      ...(paymentTermsId ? { paymentTermsId } : {}),
      ...(defaultTaxCodeId ? { taxCodeId: defaultTaxCodeId } : {}),
      ...(defaultIncotermId ? { incotermId: defaultIncotermId } : {}),
      ...(defaultDepartmentId ? { defaultDepartmentId } : {}),
      ...(defaultCarrier ? { defaultCarrierId: Number(defaultCarrier.id) } : {}),
      notes: "Created by master-data propagation smoke test",
    },
  });
  if (!expectStatus("POST /api/suppliers", 201, supplierCreateRes.status)) failures++;
  const createdSupplier = asRecord(unwrapData<unknown>(supplierCreateRes.json));
  const supplierId = Number(createdSupplier.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run npm run db:seed");
    exitTest(1);
    return;
  }

  const suppliersRes = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, suppliersRes.status)) failures++;

  const contractsForSupplierRes = await apiJsonRequest(`/contracts?supplierId=${supplierId}`, {
    method: "GET",
    cookie: adminCookie,
  });
  if (!expectStatus("GET /api/contracts?supplierId=…", 200, contractsForSupplierRes.status)) failures++;
  const contractsRaw = unwrapData<unknown>(contractsForSupplierRes.json);
  const contracts = asArray<{ id: number; supplierId?: number; currency?: string }>(contractsRaw);
  let contractForSupplier = contracts.find((c) => Number(c.supplierId) === supplierId) ?? null;
  if (!contractForSupplier) {
    const createContractRes = await apiJsonRequest("/contracts", {
      method: "POST",
      cookie: adminCookie,
      body: {
        supplierId,
        title: `Propagation contract ${Date.now().toString().slice(-6)}`,
        contractType: "master",
        startDate: new Date().toISOString(),
        status: "active",
        currency: firstCurrencyCode,
      },
    });
    if (!expectStatus("POST /api/contracts", 201, createContractRes.status)) failures++;
    contractForSupplier = asRecord(createContractRes.json) as { id: number; supplierId?: number; currency?: string };
  }
  const contractId = Number(contractForSupplier?.id ?? 0) || undefined;
  if (contractId) {
    const patchContractRes = await apiJsonRequest(`/contracts/${contractId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: {
        ...(paymentTermsId ? { paymentTermsId } : {}),
        ...(defaultTaxCodeId ? { defaultTaxCodeId } : {}),
        ...(defaultIncotermId ? { incotermId: defaultIncotermId } : {}),
      },
    });
    if (!expectStatus("PATCH /api/contracts/:id", 200, patchContractRes.status)) failures++;

    const patchSupplierDefaultsRes = await apiJsonRequest(`/suppliers/${supplierId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: {
        defaultContractId: contractId,
      },
    });
    if (!expectStatus("PATCH /api/suppliers/:id defaultContractId", 200, patchSupplierDefaultsRes.status)) failures++;
  }

  const itemsRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, itemsRes.status)) failures++;
  const items = asArray<{ id: number; price?: number; sku?: string }>(unwrapData<unknown>(itemsRes.json));
  const firstItem = items[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run npm run db:seed");
    exitTest(1);
    return;
  }
  const itemIdForWrites = Number(firstItem.id);

  const directPoRes = await apiJsonRequest("/purchase-orders", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      notes: "Master-data propagation direct PO",
      items: [
        {
          itemId: itemIdForWrites,
          quantity: 1,
          unitPrice: Number(firstItem.price ?? 10),
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-orders (supplier defaults)", 201, directPoRes.status)) failures++;
  const directPo = asRecord(unwrapData<unknown>(directPoRes.json));
  if (directPo.currencyCode !== firstCurrencyCode) {
    failures++;
    console.log(
      "  âœ— Direct PO currency default -> expected %s, got %s",
      firstCurrencyCode,
      String(directPo.currencyCode),
    );
  } else {
    console.log("  âœ“ Direct PO currency default -> %s", firstCurrencyCode);
  }
  if (paymentTermsId && Number(directPo.paymentTermsId ?? 0) !== paymentTermsId) {
    failures++;
    console.log(
      "  âœ— Direct PO payment terms default -> expected %d, got %s",
      paymentTermsId,
      String(directPo.paymentTermsId),
    );
  } else if (paymentTermsId) {
    console.log("  âœ“ Direct PO payment terms default -> %d", paymentTermsId);
  }

  if (defaultTaxCodeId && Number(directPo.taxCodeId ?? 0) !== defaultTaxCodeId) {
    failures++;
    console.log(
      "  X Direct PO tax code default -> expected %d, got %s",
      defaultTaxCodeId,
      String(directPo.taxCodeId),
    );
  } else if (defaultTaxCodeId) {
    console.log("  ok Direct PO tax code default -> %d", defaultTaxCodeId);
  }
  if (defaultIncotermId && Number(directPo.incotermId ?? 0) !== defaultIncotermId) {
    failures++;
    console.log(
      "  X Direct PO incoterm default -> expected %d, got %s",
      defaultIncotermId,
      String(directPo.incotermId),
    );
  } else if (defaultIncotermId) {
    console.log("  ok Direct PO incoterm default -> %d", defaultIncotermId);
  }
  if (defaultDepartmentId && Number(directPo.departmentId ?? 0) !== defaultDepartmentId) {
    failures++;
    console.log(
      "  X Direct PO department default -> expected %d, got %s",
      defaultDepartmentId,
      String(directPo.departmentId),
    );
  } else if (defaultDepartmentId) {
    console.log("  ok Direct PO department default -> %d", defaultDepartmentId);
  }

  const alternateCurrency = currencies.find((currency) => currency.code !== firstCurrencyCode)?.code;
  if (alternateCurrency) {
    const blockedOverrideRes = await apiJsonRequest("/purchase-orders", {
      method: "POST",
      cookie: adminCookie,
      body: {
        supplierId,
        currencyCode: alternateCurrency,
        notes: "Supplier currency override should be blocked",
        items: [
          {
            itemId: itemIdForWrites,
            quantity: 1,
            unitPrice: Number(firstItem.price ?? 10),
          },
        ],
      },
    });
    if (!expectStatus("POST /api/purchase-orders supplier currency override blocked", 409, blockedOverrideRes.status)) {
      failures++;
    }
  }

  if (defaultCarrier) {
    const directPoNumber = String(directPo.orderNumber ?? directPo.order_number ?? "");
    const shipmentRes = await apiJsonRequest("/logistics/shipments", {
      method: "POST",
      cookie: adminCookie,
      body: {
        poNumber: directPoNumber,
        trackingNumber: `PROP-${Date.now()}`,
      },
    });
    if (!expectStatus("POST /api/logistics/shipments (supplier carrier default)", 201, shipmentRes.status)) failures++;
    const shipment = asRecord(unwrapData<unknown>(shipmentRes.json));
    if (shipment.carrier !== defaultCarrier.name) {
      failures++;
      console.log(
        "  X Shipment carrier default -> expected %s, got %s",
        defaultCarrier.name,
        String(shipment.carrier),
      );
    } else {
      console.log("  ok Shipment carrier default -> %s", defaultCarrier.name);
    }
  }

  if (receiveWarehouse) {
    const directPoNumber = String(directPo.orderNumber ?? directPo.order_number ?? "");
    const approveDirectPo = await apiJsonRequest(`/procurement/purchase-orders/${directPoNumber}/approve`, {
      method: "POST",
      cookie: adminCookie,
      body: {},
    });
    if (!expectStatus("POST /api/procurement/purchase-orders/:po/approve", 200, approveDirectPo.status)) failures++;

    const directPoDetailRes = await apiJsonRequest(`/procurement/purchase-orders/${directPoNumber}`, {
      method: "GET",
      cookie: adminCookie,
    });
    if (!expectStatus("GET /api/procurement/purchase-orders/:po", 200, directPoDetailRes.status)) failures++;
    const directPoDetail = asRecord(unwrapData<unknown>(directPoDetailRes.json));
    const directPoLines = asArray<Record<string, unknown>>(directPoDetail.lines);
    const receiveSku = String(directPoLines[0]?.sku ?? "");
    if (!receiveSku) {
      failures++;
      console.log("  X Direct PO detail missing receive SKU");
    } else {
      const beforeWarehouseRes = await apiJsonRequest(`/warehouse-inventory/${receiveWarehouse.id}/${itemIdForWrites}`, {
        method: "GET",
        cookie: adminCookie,
      });
      const beforeWarehouse = asRecord(unwrapData<unknown>(beforeWarehouseRes.json));
      const beforeQty = Number(beforeWarehouse.quantity ?? 0);
      const receiveRes = await apiJsonRequest(`/procurement/purchase-orders/${directPoNumber}/receive`, {
        method: "POST",
        cookie: adminCookie,
        body: {
          lines: [{ sku: receiveSku, qty_received_now: 1 }],
          warehouseId: receiveWarehouse.id,
          receiverName: "Propagation Receiver",
          receivedAt: new Date().toISOString(),
        },
      });
      if (!expectStatus("POST /api/procurement/purchase-orders/:po/receive", 200, receiveRes.status)) failures++;
      const afterWarehouseRes = await apiJsonRequest(`/warehouse-inventory/${receiveWarehouse.id}/${itemIdForWrites}`, {
        method: "GET",
        cookie: adminCookie,
      });
      if (!expectStatus("GET /api/warehouse-inventory/:warehouseId/:itemId", 200, afterWarehouseRes.status)) failures++;
      const afterWarehouse = asRecord(unwrapData<unknown>(afterWarehouseRes.json));
      const afterQty = Number(afterWarehouse.quantity ?? 0);
      if (afterQty < beforeQty + 1) {
        failures++;
        console.log(
          "  X PO receive warehouse inventory -> expected at least %d, got %d",
          beforeQty + 1,
          afterQty,
        );
      } else {
        console.log("  ok PO receive warehouse inventory -> %d", afterQty);
      }
    }
  }

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate,
      notes: "Master-data propagation test requisition",
      items: [
        {
          itemId: itemIdForWrites,
          quantity: 1,
          unitPrice: Number(firstItem.price ?? 10),
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-requisitions", 201, requisitionRes.status)) failures++;
  if (!expectRequestId("POST /api/purchase-requisitions", requisitionRes.requestId)) failures++;
  const requisition = asRecord(unwrapData<unknown>(requisitionRes.json));
  const requisitionId = Number(requisition.id ?? 0);
  if (!requisitionId) {
    console.log(
      "  ✗ Requisition create response missing id. Body: %s",
      truncatedJsonSnippet(requisitionRes.json),
    );
    exitTest(1);
    return;
  }

  const approveRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/approve", 200, approveRes.status)) failures++;

  const convertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/convert", 201, convertRes.status)) failures++;
  const po = asRecord(unwrapData<unknown>(convertRes.json));
  const poId = Number(po.id ?? 0);
  if (!poId) {
    console.log("  ✗ PO conversion missing id. Body: %s", truncatedJsonSnippet(convertRes.json));
    exitTest(1);
    return;
  }

  if (po.currencyCode !== firstCurrencyCode) {
    failures++;
    console.log(
      "  âœ— Converted PO currency default -> expected %s, got %s",
      firstCurrencyCode,
      String(po.currencyCode),
    );
  } else {
    console.log("  âœ“ Converted PO currency default -> %s", firstCurrencyCode);
  }
  if (paymentTermsId && Number(po.paymentTermsId ?? 0) !== paymentTermsId) {
    failures++;
    console.log(
      "  âœ— Converted PO payment terms default -> expected %d, got %s",
      paymentTermsId,
      String(po.paymentTermsId),
    );
  } else if (paymentTermsId) {
    console.log("  âœ“ Converted PO payment terms default -> %d", paymentTermsId);
  }

  if (contractId && Number(po.contractId ?? 0) !== contractId) {
    failures++;
    console.log(
      "  X Converted PO contract default -> expected %d, got %s",
      contractId,
      String(po.contractId),
    );
  } else if (contractId) {
    console.log("  ok Converted PO contract default -> %d", contractId);
  }

  if (defaultTaxCodeId && Number(po.taxCodeId ?? 0) !== defaultTaxCodeId) {
    failures++;
    console.log(
      "  X Converted PO tax code default -> expected %d, got %s",
      defaultTaxCodeId,
      String(po.taxCodeId),
    );
  } else if (defaultTaxCodeId) {
    console.log("  ok Converted PO tax code default -> %d", defaultTaxCodeId);
  }
  if (defaultIncotermId && Number(po.incotermId ?? 0) !== defaultIncotermId) {
    failures++;
    console.log(
      "  X Converted PO incoterm default -> expected %d, got %s",
      defaultIncotermId,
      String(po.incotermId),
    );
  } else if (defaultIncotermId) {
    console.log("  ok Converted PO incoterm default -> %d", defaultIncotermId);
  }
  if (defaultDepartmentId && Number(po.departmentId ?? 0) !== defaultDepartmentId) {
    failures++;
    console.log(
      "  X Converted PO department default -> expected %d, got %s",
      defaultDepartmentId,
      String(po.departmentId),
    );
  } else if (defaultDepartmentId) {
    console.log("  ok Converted PO department default -> %d", defaultDepartmentId);
  }

  let commercialCurrency = firstCurrencyCode;
  if (
    contractForSupplier?.currency &&
    typeof contractForSupplier.currency === "string" &&
    /^[A-Za-z]{3}$/.test(contractForSupplier.currency)
  ) {
    const cc = contractForSupplier.currency.toUpperCase();
    if (currencies.some((c) => c.code === cc)) {
      commercialCurrency = cc;
    }
  }

  const commercialPatch = await apiJsonRequest(`/procurement/purchase-orders/records/${poId}/commercial`, {
    method: "PATCH",
    cookie: adminCookie,
    body: {
      currencyCode: commercialCurrency,
      ...(contractForSupplier ? { contractId: contractForSupplier.id } : {}),
    },
  });
  if (!expectStatus("PATCH /api/procurement/purchase-orders/records/:id/commercial", 200, commercialPatch.status)) {
    failures++;
  }

  if (failures > 0) {
    exitTest(1);
    return;
  }

  console.log("\n  All master-data propagation checks passed.");
  exitTest(0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    reportConnectionRefused(getTestBaseUrl());
    exitTest(isLiveServerRequired() ? 1 : 0);
    return;
  }
  console.error(err);
  exitTest(1);
});
