import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pool } from "../server/db";
import { apiJsonRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";

type Finding = { code: string; category: string; status: string; evidence?: unknown };

async function loadFindings(cookie: string, category: string): Promise<Finding[]> {
  const response = await apiJsonRequest(`/diagnostics/findings?category=${encodeURIComponent(category)}`, { cookie });
  assert.equal(response.status, 200, `${category} diagnostics failed: ${JSON.stringify(response.json)}`);
  const payload = response.json as { category?: string; findings?: Finding[] };
  assert.equal(payload.category, category);
  assert.ok(Array.isArray(payload.findings));
  return payload.findings ?? [];
}

async function main() {
  const cookie = await loginForTests("admin", "Admin123!");
  assert.ok(cookie, "Seeded admin login is required");
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;

  await pool.query(
    `INSERT INTO export_jobs (
       organization_id, created_by, dataset, format, filters, status, last_error, created_at, updated_at
     ) VALUES (1, 1, 'purchase_requisitions', 'pdf', '{}'::jsonb, 'failed',
       '{"code":"W7_DIAGNOSTIC_EXPORT","message":"Wave 7 controlled export failure"}', NOW(), NOW())`,
  );
  await pool.query(
    `INSERT INTO notifications (
       organization_id, user_id, type, title, body, occurrence_count, last_occurred_at, created_at
     )
     SELECT 1, 1, 'wave7_backlog', 'Wave 7 notification backlog', 'Runtime diagnostics evidence', 1, NOW(), NOW()
     FROM generate_series(1, 101)`,
  );
  const entityType = `wave7_diag_${suffix}`;
  await pool.query(
    `INSERT INTO approval_policies (
       organization_id, name, entity_type, amount_min, amount_max, approval_level,
       approver_role, is_active, version, created_at, updated_at
     ) VALUES
       (1, $1, $3, 0, 1000, 1, 'manager', TRUE, 1, NOW(), NOW()),
       (1, $2, $3, 500, 1500, 1, 'admin', TRUE, 1, NOW(), NOW())`,
    [`Wave 7 Diagnostic A ${suffix}`, `Wave 7 Diagnostic B ${suffix}`, entityType],
  );
  await pool.query(
    `INSERT INTO suppliers (
       organization_id, name, status, contact_name, email, default_currency_code, updated_at
     ) VALUES (1, $1, 'active', 'Runtime Test', $2, 'ZAR', NOW())`,
    [`Runtime Supplier ${suffix}`, `runtime-diagnostics-${suffix}@example.test`],
  );

  const summaryResponse = await apiJsonRequest("/diagnostics/summary", { cookie });
  assert.equal(summaryResponse.status, 200);
  const summary = summaryResponse.json as {
    total?: number;
    openCount?: number;
    byCategory?: Record<string, number>;
    byStatus?: Record<string, number>;
  };
  assert.ok(Number(summary.total) > 0);
  assert.ok(Number(summary.openCount) > 0);
  assert.ok(Number(summary.byCategory?.integrations) > 0);
  assert.ok(Number(summary.byCategory?.business) > 0);

  const probesResponse = await apiJsonRequest("/diagnostics/probes/run", {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(probesResponse.status, 200, `diagnostic probes failed: ${JSON.stringify(probesResponse.json)}`);
  const probePayload = probesResponse.json as { findings?: Finding[]; summary?: { total?: number } };
  assert.ok(Number(probePayload.summary?.total) > 0);

  const integrations = await loadFindings(cookie, "integrations");
  assert.ok(integrations.some((finding) => finding.code === "EXPORT_JOB_FAILURES" && finding.status === "failed"));
  const notifications = await loadFindings(cookie, "notifications");
  assert.ok(notifications.some((finding) => finding.code === "NOTIFICATION_BACKLOG" && finding.status === "degraded"));
  const business = await loadFindings(cookie, "business");
  assert.ok(business.some((finding) => finding.code === "APPROVAL_POLICY_OVERLAP" && finding.status === "degraded"));
  const consistency = await loadFindings(cookie, "consistency");
  assert.ok(consistency.some((finding) => finding.code === "TEST_FIXTURE_POLLUTION" && finding.status === "degraded"));

  const diagnosticsUi = readFileSync("client/src/pages/system-diagnostics-page.tsx", "utf8");
  for (const label of [
    "Overview",
    "User-Visible Errors",
    "Frontend",
    "Backend",
    "Business Rules",
    "Integrations",
    "Data Consistency",
    "Notifications",
    "Security",
    "Audit Timeline",
  ]) assert.ok(diagnosticsUi.includes(`label: "${label}"`), `diagnostics UI must expose ${label}`);
  assert.match(diagnosticsUi, /new URLSearchParams\(window\.location\.search\)\.get\("view"\)/);
  assert.match(diagnosticsUi, /DiagnosticsWorkspacePanel/);
  console.log("  UI workspace evidence: source-contract proven; browser proof remains a separate release gate.");
  console.log("Diagnostics runtime workspace proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => pool.end().catch(() => undefined));
