/**
 * GET /api/logistics/shipments filter semantics + meta shape.
 * Creates temporary shipments (POST), asserts filtered GET results, then DELETE.
 * Run: npm run test:logistics-filters
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  apiJsonRequest,
  clearSessionCookie,
  getTestBaseUrl,
  isConnectionRefused,
  peekSessionCookie,
} from "./test-http.ts";
import { exitTest } from "./test-exit.ts";
import { pool } from "../server/db.ts";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type ShipmentRow = {
  id: number;
  poNumber: string;
  status: string;
  riskBucket?: string;
  trackingNumber?: string | null;
  carrier?: string | null;
};

function unwrapEnvelope(json: unknown): { data: unknown; meta?: Record<string, unknown> } {
  if (json && typeof json === "object" && "ok" in json && (json as { ok?: boolean }).ok === true && "data" in json) {
    const meta = (json as { meta?: Record<string, unknown> }).meta;
    return { data: (json as { data: unknown }).data, meta };
  }
  throw new Error("expected { ok: true, data, meta? }");
}

function unwrapInsert(json: unknown): ShipmentRow {
  const { data } = unwrapEnvelope(json);
  if (data && typeof data === "object" && "id" in data) {
    return data as ShipmentRow;
  }
  throw new Error("expected shipment row");
}

async function main() {
  // Refuse before seeding; the shared HTTP helper only checks at the first mutation,
  // which is too late for this suite's fixture preparation step.
  assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
  const seed = spawnSync("npm", ["run", "seed:functional-qa"], {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (seed.status !== 0) {
    console.error("test-logistics-filters: seed:functional-qa failed");
    exitTest(1);
    return;
  }

  clearSessionCookie();
  const login = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });
  if (!login.ok) {
    console.error("Login failed:", login.status, login.json);
    exitTest(1);
    return;
  }
  const cookie = peekSessionCookie();

  const ok = await apiJsonRequest("/logistics/shipments", { cookie });
  assert.ok(ok.ok, `shipments: ${ok.status} ${JSON.stringify(ok.json)}`);
  const env0 = unwrapEnvelope(ok.json);
  assert.ok(Array.isArray(env0.data), "data is array");
  const generatedAt = env0.meta?.generatedAt;
  assert.ok(typeof generatedAt === "string" && generatedAt.length > 5, "meta.generatedAt");
  assert.ok(typeof env0.meta?.queryMs === "number", "meta.queryMs");

  const badFrom = await apiJsonRequest("/logistics/shipments?etaFrom=not-a-date", { cookie });
  assert.equal(badFrom.status, 400, "invalid etaFrom should be 400");
  const errFrom = badFrom.json as { ok?: boolean; error?: { code?: string } };
  assert.equal(errFrom.ok, false);
  assert.equal(errFrom.error?.code, "INVALID_LOGISTICS_FILTER");

  const badTo = await apiJsonRequest("/logistics/shipments?etaTo=not-a-date", { cookie });
  assert.equal(badTo.status, 400, "invalid etaTo should be 400");
  const errTo = badTo.json as { ok?: boolean; error?: { code?: string } };
  assert.equal(errTo.ok, false);
  assert.equal(errTo.error?.code, "INVALID_LOGISTICS_FILTER");

  const suffix = Date.now();
  const poLate = `PO-LT-${suffix}-late`;
  const poExc = `PO-LT-${suffix}-exc`;
  const poNoEta = `PO-LT-${suffix}-noeta`;
  const poFed = `PO-LT-${suffix}-fed`;
  const poEtaRange = `PO-LT-${suffix}-range`;
  const poSoon = `PO-LT-${suffix}-soon`;
  const poOnTime = `PO-LT-${suffix}-ontime`;

  const dayMs = 86400000;
  const etaPast = new Date(Date.now() - 2 * dayMs).toISOString();
  const etaRangeMid = new Date(Date.now() + 5 * dayMs).toISOString();
  const etaSoon = new Date(Date.now() + 2 * dayMs).toISOString();
  const etaFar = new Date(Date.now() + 10 * dayMs).toISOString();

  const createdIds: number[] = [];

  const ensurePurchaseOrder = async (poNumber: string) => {
    const supplier = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM suppliers
        WHERE organization_id = 1 AND COALESCE(status, 'active') NOT IN ('blocked', 'inactive')
        ORDER BY id
        LIMIT 1
      `,
    );
    assert.ok(supplier.rows[0]?.id, "logistics filter test requires a seeded active supplier");
    await pool.query(
      `
        INSERT INTO purchase_orders (organization_id, order_number, supplier_id, status, total_amount, currency_code, updated_at)
        VALUES (1, $1, $2, 'sent', 100, 'ZAR', NOW())
        ON CONFLICT (organization_id, order_number) DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          status = 'sent',
          updated_at = NOW()
      `,
      [poNumber, supplier.rows[0].id],
    );
  };

  for (const po of [poLate, poExc, poNoEta, poFed, poEtaRange, poSoon, poOnTime]) {
    await ensurePurchaseOrder(po);
  }

  const post = async (body: Record<string, unknown>) => {
    const r = await apiJsonRequest("/logistics/shipments", { method: "POST", body, cookie });
    assert.ok(r.ok, `POST shipment ${r.status} ${JSON.stringify(r.json)}`);
    const row = unwrapInsert(r.json);
    createdIds.push(row.id);
    return row;
  };

  const patchStatus = async (id: number, toStatus: string) => {
    const r = await apiJsonRequest(`/logistics/shipments/${id}/status`, {
      method: "POST",
      body: { toStatus },
      cookie,
    });
    assert.ok(r.ok, `status ${toStatus}: ${r.status} ${JSON.stringify(r.json)}`);
  };

  const q = (search: string) => apiJsonRequest(`/logistics/shipments${search}`, { cookie });

  try {
    const badPoCreate = await apiJsonRequest("/logistics/shipments", {
      method: "POST",
      body: { poNumber: "PO-NOT-REAL-ZZ-999999" },
      cookie,
    });
    assert.equal(badPoCreate.status, 400, "POST with unknown PO should be 400");
    const badPoJson = badPoCreate.json as { ok?: boolean; error?: { code?: string } };
    assert.equal(badPoJson.ok, false);
    assert.equal(badPoJson.error?.code, "PO_NOT_FOUND_FOR_SHIPMENT");

    await post({
      poNumber: poLate,
      carrier: "ZZ-Acme-Test-Carrier",
      eta: etaPast,
      trackingNumber: "ZZ-TRACK-ALPHA-99",
    });

    const rowExc = await post({ poNumber: poExc, carrier: "ZZ-Exc", eta: etaFar, trackingNumber: "ZZ-EXC-1" });
    await patchStatus(rowExc.id, "in_transit");
    await patchStatus(rowExc.id, "delayed");

    await post({ poNumber: poNoEta, carrier: "ZZ-NoEta", trackingNumber: "ZZ-NONE" });

    await post({
      poNumber: poFed,
      carrier: "FDEX",
      eta: etaFar,
      trackingNumber: "ZZ-FED",
    });

    await post({
      poNumber: poEtaRange,
      carrier: "ZZ-Range",
      eta: etaRangeMid,
      trackingNumber: "ZZ-RNG",
    });

    const rowSoon = await post({
      poNumber: poSoon,
      carrier: "ZZ-Soon",
      eta: etaSoon,
      trackingNumber: "ZZ-SOON",
    });
    await patchStatus(rowSoon.id, "in_transit");

    const rowOntime = await post({
      poNumber: poOnTime,
      carrier: "ZZ-OnTime",
      eta: etaFar,
      trackingNumber: "ZZ-OK",
    });
    await patchStatus(rowOntime.id, "in_transit");

    const qsMeta = new URLSearchParams({
      status: "eate",
      po: `${suffix}-late`,
      supplier: "acme-co",
      carrier: " zz ",
      risk: "",
      etaFrom: "",
      etaTo: "",
      tracking: "",
      direction: "",
      sourceType: "",
    });
    const rMetaShape = await apiJsonRequest(`/logistics/shipments?${qsMeta.toString()}`, { cookie });
    assert.ok(rMetaShape.ok);
    const envShape = unwrapEnvelope(rMetaShape.json);
    assert.deepEqual(envShape.meta?.appliedFilters, {
      status: "eate",
      po: `${suffix}-late`,
      supplier: "acme-co",
      carrier: "zz",
      risk: "",
      etaFrom: "",
      etaTo: "",
      tracking: "",
      direction: "",
      sourceType: "",
    });

    const rPo = await q(`?po=${encodeURIComponent(`${suffix}-late`)}`);
    assert.ok(rPo.ok);
    const envPo = unwrapEnvelope(rPo.json);
    const rowsPo = envPo.data as ShipmentRow[];
    assert.equal(rowsPo.length, 1);
    assert.equal(envPo.meta?.resultCount, 1);
    assert.ok(rowsPo.every((r) => r.poNumber === poLate));

    const rStatus = await q(`?status=eate`);
    assert.ok(rStatus.ok);
    const rowsStatus = unwrapEnvelope(rStatus.json).data as ShipmentRow[];
    assert.ok(rowsStatus.length >= 1);
    assert.ok(rowsStatus.every((s) => s.status.includes("eate")));

    const rTrack = await q(`?tracking=alpha-99`);
    assert.ok(rTrack.ok);
    const rowsTr = unwrapEnvelope(rTrack.json).data as ShipmentRow[];
    assert.ok(rowsTr.some((s) => s.poNumber === poLate));

    const rCarrierDirect = await q(`?carrier=acme-test`);
    assert.ok(rCarrierDirect.ok);
    assert.ok((unwrapEnvelope(rCarrierDirect.json).data as ShipmentRow[]).some((s) => s.poNumber === poLate));

    const rCarrierMaster = await q(`?carrier=fed`);
    assert.ok(rCarrierMaster.ok);
    assert.ok((unwrapEnvelope(rCarrierMaster.json).data as ShipmentRow[]).some((s) => s.poNumber === poFed));

    const poDetailRes = await apiJsonRequest("/purchase/orders/PO-FQA-001", { cookie });
    assert.ok(poDetailRes.ok, `GET PO-FQA-001: ${poDetailRes.status}`);
    const poDetail = (poDetailRes.json as { data: { supplierName?: string | null } }).data;
    const supNm = poDetail?.supplierName ? String(poDetail.supplierName).trim() : "";
    if (supNm.length > 0) {
      const needle = supNm.length >= 4 ? supNm.slice(0, 4).toLowerCase() : supNm.toLowerCase();
      const supRow = await post({
        poNumber: "PO-FQA-001",
        carrier: "ZZ-SUP-ROW",
        eta: etaFar,
        trackingNumber: `ZZ-SUP-${suffix}`,
      });
      const rSup = await q(
        `?supplier=${encodeURIComponent(needle)}&tracking=${encodeURIComponent(`ZZ-SUP-${suffix}`)}`,
      );
      assert.ok(rSup.ok);
      const supRows = unwrapEnvelope(rSup.json).data as ShipmentRow[];
      assert.ok(supRows.some((r) => r.id === supRow.id));
      assert.ok(supRows.length >= 1);
    }

    const rRiskLate = await q(`?risk=late&po=${encodeURIComponent(String(suffix))}`);
    assert.ok(rRiskLate.ok);
    const lateRows = unwrapEnvelope(rRiskLate.json).data as ShipmentRow[];
    assert.ok(lateRows.length >= 1);
    assert.ok(lateRows.some((s) => s.poNumber === poLate));
    assert.ok(lateRows.every((s) => s.riskBucket === "late"));

    const rRiskExc = await q(`?risk=exception&po=${encodeURIComponent(String(suffix))}`);
    assert.ok(rRiskExc.ok);
    const excRows = unwrapEnvelope(rRiskExc.json).data as ShipmentRow[];
    assert.equal(excRows.length, 1);
    assert.equal(excRows[0]?.poNumber, poExc);
    assert.ok(excRows.every((s) => s.riskBucket === "exception"));

    const rRiskNoEta = await q(`?risk=no_eta&po=${encodeURIComponent(String(suffix))}`);
    assert.ok(rRiskNoEta.ok);
    const neRows = unwrapEnvelope(rRiskNoEta.json).data as ShipmentRow[];
    assert.equal(neRows.length, 1);
    assert.equal(neRows[0]?.poNumber, poNoEta);
    assert.ok(neRows.every((s) => s.riskBucket === "no_eta"));

    const rRiskSoon = await q(`?risk=due_soon&po=${encodeURIComponent(String(suffix))}`);
    assert.ok(rRiskSoon.ok);
    const dsRows = unwrapEnvelope(rRiskSoon.json).data as ShipmentRow[];
    assert.equal(dsRows.length, 1);
    assert.equal(dsRows[0]?.poNumber, poSoon);
    assert.ok(dsRows.every((s) => s.riskBucket === "due_soon"));

    const rRiskOk = await q(`?risk=on_time&po=${encodeURIComponent(String(suffix))}`);
    assert.ok(rRiskOk.ok);
    const otRows = unwrapEnvelope(rRiskOk.json).data as ShipmentRow[];
    assert.ok(otRows.length >= 1);
    assert.ok(otRows.some((s) => s.poNumber === poOnTime));
    assert.ok(otRows.some((s) => s.poNumber === poFed));
    assert.ok(otRows.every((s) => s.riskBucket === "on_time"));

    const etaFromEnc = encodeURIComponent(new Date(Date.now() + 4 * dayMs).toISOString());
    const etaToEnc = encodeURIComponent(new Date(Date.now() + 7 * dayMs).toISOString());
    const rEta = await q(`?etaFrom=${etaFromEnc}&etaTo=${etaToEnc}`);
    assert.ok(rEta.ok);
    assert.ok((unwrapEnvelope(rEta.json).data as ShipmentRow[]).some((s) => s.poNumber === poEtaRange));

    const rDirIn = await q(`?direction=inbound&po=${encodeURIComponent(String(suffix))}`);
    assert.ok(rDirIn.ok);
    const dirInRows = unwrapEnvelope(rDirIn.json).data as ShipmentRow[];
    assert.ok(dirInRows.length >= 1);
    assert.ok(dirInRows.some((s) => s.poNumber === poLate));

    const rMetaCount = await q("");
    assert.ok(rMetaCount.ok);
    const envFull = unwrapEnvelope(rMetaCount.json);
    const fullRows = envFull.data as ShipmentRow[];
    assert.ok(Array.isArray(fullRows));
    assert.equal(envFull.meta?.resultCount, fullRows.length);
  } finally {
    for (const id of createdIds) {
      const del = await apiJsonRequest(`/logistics/shipments/${id}`, { method: "DELETE", cookie });
      if (!del.ok) {
        console.warn("cleanup DELETE failed", id, del.status);
      }
    }
  }

  console.log("test-logistics-filters: all checks passed.");
  exitTest(0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.error("Server not reachable at", getTestBaseUrl(), "- start with: npm run dev");
    exitTest(1);
    return;
  }
  console.error(err);
  exitTest(1);
});
