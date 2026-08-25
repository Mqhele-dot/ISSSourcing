import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pool } from "../server/db";
import { analyticsAreas, buildAnalyticsInsights } from "../server/modules/reports/analytics-insights-service";

const expectedAreas = ["overview", "procurement", "inventory", "logistics", "suppliers", "finance", "exceptions", "diagnostics", "reports"];
const expectedKpis = ["procurementSpend", "openPurchaseOrders", "inventoryHealth", "lateShipments", "openExceptions", "apExposure", "supplierRisk", "systemHealth"];

try {
  assert.deepEqual(analyticsAreas, expectedAreas, "analytics area registry must remain complete");
  const organization = await pool.query<{ id: number }>("SELECT id FROM organizations ORDER BY id LIMIT 1");
  assert.ok(organization.rows[0], "analytics contract test requires one organization");

  const response = await buildAnalyticsInsights(organization.rows[0].id, "overview", {});
  assert.ok(!Number.isNaN(Date.parse(response.generatedAt)), "generatedAt must be an ISO timestamp");
  assert.ok(Number.isFinite(response.meta.queryMs), "query duration must be finite");
  assert.deepEqual(Object.keys(response.kpis), expectedKpis, "executive KPI contract drifted");
  assert.ok(Object.keys(response.charts).length >= 10, "chart contract must cover every primary domain");
  assert.ok(Object.keys(response.tables).length >= 5, "attention tables must remain available");

  const hrefs = [
    ...Object.values(response.kpis).map((item) => item.href),
    ...response.recommendations.map((item) => item.href),
    ...response.reportTemplates.map((item) => item.href),
  ].filter((value): value is string => Boolean(value));
  assert.ok(hrefs.every((href) => href.startsWith("/") && !href.startsWith("//")), "analytics actions must use safe internal routes");

  const page = await readFile(new URL("../client/src/pages/analytics-workspace/analytics-insights-page.tsx", import.meta.url), "utf8");
  for (const id of [
    "analytics-page", "analytics-date-range-filter", "analytics-business-area-filter",
    "analytics-kpi-procurement-spend", "analytics-recommendations-panel",
    "analytics-data-quality-warnings", "analytics-export-current-view",
  ]) assert.match(page, new RegExp(id), `missing analytics UI contract: ${id}`);

  console.log(`Analytics contracts passed (${response.meta.partialFailures.length} degraded feeds reported explicitly).`);
} finally {
  await pool.end();
}
