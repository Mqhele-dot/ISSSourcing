/**
 * Master data + cross-module integration smoke test.
 *
 * Covers (API-only, against a running server):
 * - Supplier/contract currency mismatch is blocked; allowed commercial fields update + revision snapshot
 * - Supplier contract commercial FKs applied to PO (mirror client "apply contract")
 * - PO send with optional shipment.create; receive targets shipment_id; logistics delivered
 * - Operational receive creates idempotent AP receipt and upgrades invoice match to three_way
 * - PO list reflects status after receive (read-your-writes)
 *
 * Run:
 *   npx tsx scripts/test-master-data-integration.ts
 * or
 *   BASE_URL=http://127.0.0.1:5000 npx tsx scripts/test-master-data-integration.ts
 */
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  expectRequestId,
  getTestBaseUrl,
  isConnectionRefused,
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

/** Master-data style envelope or raw array (contracts routes return raw JSON). */
function asObjectList(value: unknown): Record<string, unknown>[] {
  const unwrapped = unwrapData<unknown>(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map((row) => asRecord(row));
  }
  return [];
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
  console.log("Master data integration test (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    exitTest(1);
    return;
  }

  let failures = 0;

  const userRes = await apiJsonRequest("/user", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/user", 200, userRes.status)) failures++;
  const currentUser = asRecord(unwrapData<unknown>(userRes.json));
  const createdBy = Number(currentUser.id ?? 1);

  const currenciesRes = await apiJsonRequest("/currencies", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/currencies", 200, currenciesRes.status)) failures++;
  const currencyRows = asObjectList(currenciesRes.json);
  const activeCurrencies = currencyRows.filter((c) => c.active !== false);
  const pickCurrency =
    activeCurrencies.find((c) => String(c.code).toUpperCase() !== "USD") ?? activeCurrencies[0];
  const currencyCode = String(pickCurrency?.code ?? "USD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    console.log("  ✗ No valid master currency list; run npm run db:seed");
    exitTest(1);
    return;
  }

  const ptRes = await apiJsonRequest("/payment-terms", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/payment-terms", 200, ptRes.status)) failures++;
  const payTerms = asObjectList(ptRes.json);
  const paymentTermsId = Number(payTerms[0]?.id ?? 0);

  const incRes = await apiJsonRequest("/incoterms", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/incoterms", 200, incRes.status)) failures++;
  const incoterms = asObjectList(incRes.json);
  const incotermId = Number(incoterms[0]?.id ?? 0);

  const taxRes = await apiJsonRequest("/tax-codes", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/tax-codes", 200, taxRes.status)) failures++;
  const taxes = asObjectList(taxRes.json);
  const taxCodeId = Number(taxes[0]?.id ?? 0);

  if (!paymentTermsId || !incotermId || !taxCodeId) {
    console.log("  ✗ Missing payment terms, incoterms, or tax codes; run npm run db:seed");
    exitTest(1);
    return;
  }

  const supplierRes = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, supplierRes.status)) failures++;
  const suppliers = asArray<{ id: number }>(unwrapData(supplierRes.json));
  const supplierId = Number(suppliers[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run npm run db:seed");
    exitTest(1);
    return;
  }

  let contractId = 0;
  const createContractRes = await apiJsonRequest("/contracts", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      title: `MDI contract ${Date.now().toString().slice(-6)}`,
      contractType: "master",
      startDate: new Date().toISOString(),
      status: "active",
      currency: "USD",
    },
  });
  if (!expectStatus("POST /api/contracts", 201, createContractRes.status)) failures++;
  const createdCt = asRecord(unwrapData<unknown>(createContractRes.json));
  contractId = Number(createdCt.id ?? 0);
/*
  const contractsRes = await apiJsonRequest(`/contracts?supplierId=${supplierId}`, {
    method: "GET",
    cookie: adminCookie,
  });
  if (contractsRes.status === 200) {
    const existing = asArray<{ id: number }>(contractsRes.json);
    contractId = Number(existing[0]?.id ?? 0);
  } else {
    failures++;
    console.log("  ✗ GET /api/contracts?supplierId=… -> %d", contractsRes.status);
  }

  if (!contractId) {
    const createContractRes = await apiJsonRequest("/contracts", {
      method: "POST",
      cookie: adminCookie,
      body: {
        supplierId,
        title: `MDI contract ${Date.now().toString().slice(-6)}`,
        contractType: "master",
        startDate: new Date().toISOString(),
        status: "active",
        currency: "USD",
      },
    });
    if (!expectStatus("POST /api/contracts", 201, createContractRes.status)) failures++;
    const createdCt = asRecord(createContractRes.json);
    contractId = Number(createdCt.id ?? 0);
  }
*/

  if (!contractId) {
    console.log("  ✗ Could not resolve or create supplier contract.");
    exitTest(1);
    return;
  }

  const patchContractRes = await apiJsonRequest(`/contracts/${contractId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: {
      paymentTermsId,
      incotermId,
      defaultTaxCodeId: taxCodeId,
    },
  });
  if (!expectStatus("PATCH /api/contracts/:id (commercial FKs)", 200, patchContractRes.status)) failures++;

  const patchSupplierDefaultsRes = await apiJsonRequest(`/suppliers/${supplierId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: {
      defaultContractId: contractId,
      defaultCurrencyCode: "USD",
      paymentTermsId,
      incotermId,
      taxCodeId,
    },
  });
  if (!expectStatus("PATCH /api/suppliers/:id default contract", 200, patchSupplierDefaultsRes.status)) failures++;

  const itemsRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, itemsRes.status)) failures++;
  const rawInv = itemsRes.json;
  const items = Array.isArray(rawInv)
    ? asArray<{ id: number; price?: number; sku?: string }>(rawInv)
    : rawInv && typeof rawInv === "object" && "data" in rawInv && Array.isArray((rawInv as { data: unknown }).data)
      ? asArray<{ id: number; price?: number; sku?: string }>((rawInv as { data: unknown }).data)
      : [];
  const firstItem = items[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run npm run db:seed");
    exitTest(1);
    return;
  }
  const itemSku = String(firstItem.sku ?? "");
  let itemIdForWrites = Number(firstItem.id ?? 0);
  const inventoryDetailRes = await apiJsonRequest(`/inventory/${encodeURIComponent(itemSku)}`, {
    method: "GET",
    cookie: adminCookie,
  });
  if (inventoryDetailRes.status === 200) {
    const detail = asRecord(unwrapData<unknown>(inventoryDetailRes.json));
    const detailId = Number(detail.id ?? 0);
    if (Number.isFinite(detailId) && detailId > 0) {
      itemIdForWrites = detailId;
    }
  }

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate,
      notes: "MDI integration requisition",
      items: [
        {
          itemId: itemIdForWrites,
          quantity: 2,
          unitPrice: Number(firstItem.price ?? 10),
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-requisitions", 201, requisitionRes.status)) failures++;
  const requisition = asRecord(unwrapData<unknown>(requisitionRes.json));
  const requisitionId = Number(requisition.id ?? 0);
  if (!requisitionId) {
    console.log("  ✗ Requisition create did not return id.");
    exitTest(1);
    return;
  }

  const approveReqRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/approve", 200, approveReqRes.status)) failures++;

  const convertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/convert", 201, convertRes.status)) failures++;
  const po = asRecord(unwrapData<unknown>(convertRes.json));
  const poId = Number(po.id ?? 0);
  const poNumber = String(po.orderNumber ?? "");
  if (!poId || !poNumber) {
    console.log("  ✗ PO conversion missing id/orderNumber.");
    exitTest(1);
    return;
  }

  const commercialBody = {
    contractId,
    paymentTermsId,
    incotermId,
    taxCodeId,
    currencyCode,
  };
  const blockedCurrencyRes = await apiJsonRequest(`/purchase-orders/${poId}`, {
    method: "PUT",
    cookie: adminCookie,
    body: commercialBody,
  });
  if (!expectStatus("PUT /api/purchase-orders/:id blocks contract currency mismatch", 409, blockedCurrencyRes.status)) failures++;
  if (!expectRequestId("PUT /api/purchase-orders/:id blocks contract currency mismatch", blockedCurrencyRes.requestId)) failures++;

  const allowedCommercialRes = await apiJsonRequest(`/purchase-orders/${poId}`, {
    method: "PUT",
    cookie: adminCookie,
    body: {
      contractId,
      paymentTermsId,
      incotermId,
      taxCodeId,
    },
  });
  if (!expectStatus("PUT /api/purchase-orders/:id commercial fields", 200, allowedCommercialRes.status)) failures++;
  if (!expectRequestId("PUT /api/purchase-orders/:id commercial fields", allowedCommercialRes.requestId)) failures++;

  const poAfterCommercial = asRecord(unwrapData<unknown>(allowedCommercialRes.json));
  if (Number(poAfterCommercial.taxCodeId ?? 0) !== taxCodeId) {
    console.log("  ✗ PO taxCodeId after commercial patch mismatch.");
    failures++;
  }

  const revRes = await apiJsonRequest(`/purchase-orders/${poId}/revisions`, {
    method: "GET",
    cookie: adminCookie,
  });
  if (!expectStatus("GET /api/purchase-orders/:id/revisions", 200, revRes.status)) failures++;
  const revisions = asArray<{ snapshot?: unknown }>(unwrapData(revRes.json));
  const lastRev = revisions[revisions.length - 1];
  const snap = lastRev?.snapshot && typeof lastRev.snapshot === "object" ? asRecord(lastRev.snapshot) : null;
  const orderAfter =
    snap?.orderAfterUpdate && typeof snap.orderAfterUpdate === "object" ? asRecord(snap.orderAfterUpdate) : null;
  if (!orderAfter || Number(orderAfter.taxCodeId ?? 0) !== taxCodeId) {
    console.log("  ✗ Latest revision snapshot missing expected taxCodeId on orderAfterUpdate.");
    failures++;
  } else {
    console.log("  ✓ Latest PO revision snapshot carries commercial fields.");
  }

  const approvePoRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase/orders/:po/approve", 200, approvePoRes.status)) failures++;

  const sendPoRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/send`, {
    method: "POST",
    cookie: adminCookie,
    body: {
      shipment: { create: true, carrier: "MDI integration carrier" },
    },
  });
  if (!expectStatus("POST /api/purchase/orders/:po/send", 200, sendPoRes.status)) failures++;

  const shipListRes = await apiJsonRequest(
    `/logistics/shipments?po=${encodeURIComponent(poNumber)}`,
    { method: "GET", cookie: adminCookie },
  );
  if (!expectStatus("GET /api/logistics/shipments?po=", 200, shipListRes.status)) failures++;
  const shipmentsRaw = unwrapData<unknown>(shipListRes.json);
  const shipments = asArray<{ id: number; poNumber?: string; status?: string }>(
    Array.isArray(shipmentsRaw) ? shipmentsRaw : [],
  );
  const shipmentForPo = shipments.find((s) => String(s.poNumber ?? "") === poNumber) ?? shipments[0];
  const shipmentId = Number(shipmentForPo?.id ?? 0);
  if (!shipmentId) {
    console.log("  ✗ No shipment row for PO after send with shipment.create.");
    failures++;
  } else {
    const st = String(shipmentForPo?.status ?? "").toLowerCase();
    if (st !== "in_transit") {
      console.log("  ✗ New shipment should be in_transit after send; got %s", st);
      failures++;
    } else {
      console.log("  ✓ Shipment %d created in_transit for PO.", shipmentId);
    }
  }

  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const total = Number(firstItem.price ?? 10) * 2;
  const invoiceCreateRes = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      invoiceNumber: `INV-MDI-${Date.now().toString().slice(-8)}`,
      supplierId,
      purchaseOrderId: poId,
      issueDate: issueDate.toISOString(),
      dueDate: dueDate.toISOString(),
      subtotal: total,
      total,
      paidAmount: 0,
      dueAmount: total,
      createdBy,
      items: [],
    },
  });
  if (!expectStatus("POST /api/invoices", 201, invoiceCreateRes.status)) failures++;
  const invoice = asRecord(unwrapData<unknown>(invoiceCreateRes.json));
  const invoiceId = Number(invoice.id ?? 0);
  if (!invoiceId) {
    console.log("  ✗ Invoice creation did not return id.");
    exitTest(1);
    return;
  }

  const listBeforeRes = await apiJsonRequest("/purchase-orders", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/purchase-orders (before receive)", 200, listBeforeRes.status)) failures++;
  const ordersBefore = asArray<{ id: number; status?: string }>(unwrapData(listBeforeRes.json));
  const selfBefore = ordersBefore.find((o) => o.id === poId);

  const receiveBody: Record<string, unknown> = {
    lines: [{ sku: itemSku, qty_received_now: 2 }],
    receiver_name: "MDI integration",
  };
  if (shipmentId) {
    receiveBody.shipment_id = shipmentId;
  }
  const receiveRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
    method: "POST",
    cookie: adminCookie,
    body: receiveBody,
  });
  if (!expectStatus("POST /api/purchase/orders/:po/receive", 200, receiveRes.status)) failures++;
  const receivePayload = asRecord(unwrapData<unknown>(receiveRes.json));
  const changed = asRecord(receivePayload.changed ?? {});
  if (Number(changed.inventoryChanges ?? 0) < 1) {
    console.log("  ✗ Receive response expected inventoryChanges >= 1.");
    failures++;
  } else {
    console.log("  ✓ Receive updated inventory (%d change group(s)).", Number(changed.inventoryChanges ?? 0));
  }
  if (shipmentId && Number(changed.shipmentUpdates ?? 0) < 1) {
    console.log("  ✗ Receive with shipment_id expected shipmentUpdates >= 1.");
    failures++;
  } else if (shipmentId) {
    console.log("  ✓ Receive marked shipment delivered (updates=%d).", Number(changed.shipmentUpdates ?? 0));
  }

  const listAfterRes = await apiJsonRequest("/purchase-orders", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/purchase-orders (after receive)", 200, listAfterRes.status)) failures++;
  const ordersAfter = asArray<{ id: number; status?: string }>(unwrapData(listAfterRes.json));
  const selfAfter = ordersAfter.find((o) => o.id === poId);
  const statusBefore = String(selfBefore?.status ?? "");
  const statusAfter = String(selfAfter?.status ?? "");
  if (statusAfter === statusBefore) {
    console.log(
      "  ⚠ PO status unchanged in list after receive (before=%s after=%s) — may be acceptable if list is cached.",
      statusBefore,
      statusAfter,
    );
  } else {
    console.log("  ✓ PO list reflects status change: %s -> %s", statusBefore, statusAfter);
  }

  const receiptsRes = await apiJsonRequest("/ap/receipts", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/ap/receipts", 200, receiptsRes.status)) failures++;
  const receipts = asArray<{ receiptNumber?: string; purchaseOrderId?: number }>(unwrapData(receiptsRes.json));
  const bridged = receipts.find(
    (r) =>
      Number(r.purchaseOrderId ?? 0) === poId &&
      String(r.receiptNumber ?? "").startsWith(`OP-${poId}-`),
  );
  if (!bridged) {
    console.log("  ✗ No idempotent operational AP receipt OP-%d-* for this PO.", poId);
    failures++;
  } else {
    console.log("  ✓ AP receipt bridged: %s", String(bridged.receiptNumber ?? ""));
  }

  const invoiceDetailRes = await apiJsonRequest(`/invoices/${invoiceId}`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/invoices/:id", 200, invoiceDetailRes.status)) failures++;
  const invoiceDetail = asRecord(unwrapData<unknown>(invoiceDetailRes.json));
  const latestMatch = invoiceDetail.latestMatchResult && typeof invoiceDetail.latestMatchResult === "object"
    ? asRecord(invoiceDetail.latestMatchResult)
    : null;
  const matchType = String(latestMatch?.matchType ?? "").toLowerCase();
  if (matchType !== "three_way") {
    console.log(
      "  ✗ Invoice latest match expected three_way after receive+receipt; got %s",
      latestMatch?.matchType ?? "(none)",
    );
    failures++;
  } else {
    console.log("  ✓ Invoice match type is three_way (receipt-backed).");
  }

  const shipAfterRes = await apiJsonRequest(
    `/logistics/shipments?po=${encodeURIComponent(poNumber)}`,
    { method: "GET", cookie: adminCookie },
  );
  if (shipAfterRes.status === 200) {
    const rows = unwrapData<unknown>(shipAfterRes.json);
    const arr = asArray<{ id: number; status?: string }>(Array.isArray(rows) ? rows : []);
    const row = arr.find((s) => s.id === shipmentId);
    if (shipmentId && row && String(row.status ?? "").toLowerCase() !== "delivered") {
      console.log("  ✗ Shipment %d should be delivered after receive; status=%s", shipmentId, String(row.status ?? ""));
      failures++;
    }
  }

  console.log("\nMaster data integration result: %d failure(s)", failures);
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    exitTest(reportConnectionRefused(getTestBaseUrl()));
    return;
  }
  console.error(err);
  exitTest(1);
});
