import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { startDiagnosticMonitoringWorker } from "../server/diagnostics/monitoring-worker";
import { persistDiagnosticChecks } from "../server/diagnostics/persistent-findings";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { gotoAuthed } from "./test-helpers";

test("production monitoring timer executes critical/deep probes and recovers only after two scheduled passes", async ({ page }) => {
  test.setTimeout(120_000); requireDisposableE2eDatabase();
  expect(process.env.NODE_ENV).toBe("test"); expect(process.env.LOCAL_TEST_API_ONLY).not.toBe("1");
  const schedules = (await pool.query("SELECT * FROM diagnostic_schedules ORDER BY organization_id,tier")).rows;
  const previousFlag = process.env.ENABLE_TEST_DIAGNOSTIC_WORKER;
  const lifecycle = createServer();
  let worker: ReturnType<typeof startDiagnosticMonitoringWorker>;
  const businessTables = ["inventory_items", "warehouse_inventory", "stock_movements", "purchase_orders", "ap_receipts", "invoices", "payments", "financial_reporting_runs", "export_jobs"];
  const businessSnapshot = async () => {
    const client=await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      await client.query("SET LOCAL statement_timeout='10s'");
      const result=(await client.query(businessTables.map(table =>
        `SELECT '${table}' AS source,count(*)::text AS rows,md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY t.id),'')) AS digest FROM ${table} t`).join(" UNION ALL ") + " ORDER BY source")).rows;
      await client.query("COMMIT");return result;
    } catch(error) {await client.query("ROLLBACK");throw error;}finally{client.release();}
  };
  const schedule = async (tier: string) => (await pool.query(`SELECT last_completed_at,last_outcome,lease_token,lease_until,
    extract(epoch FROM next_run_at-last_completed_at)::int AS interval_seconds FROM diagnostic_schedules WHERE organization_id=1 AND tier=$1`, [tier])).rows[0];
  const incident = async () => (await pool.query("SELECT lifecycle,consecutive_passes FROM diagnostic_persistent_findings WHERE organization_id=1 AND finding_key='backend:DATABASE_READINESS'")).rows[0];
  try {
    // Only scheduling metadata is changed. Other active test tenants cannot steal
    // the intended check, and no operational condition is repaired or fabricated.
    await pool.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at)
      SELECT id,t.tier,now()+interval '1 day' FROM organizations CROSS JOIN (VALUES('critical'),('deep')) t(tier) WHERE active=true
      ON CONFLICT(organization_id,tier) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,lease_token=NULL,lease_until=NULL`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); const now = new Date().toISOString();
      await persistDiagnosticChecks(client, 1, randomUUID(), [{ id: "backend:DATABASE_READINESS", category: "backend", code: "DATABASE_READINESS", title: "Controlled worker recovery proof", message: "Test-owned incident; real scheduled SQL probes must establish recovery.", status: "failed", severity: "error", occurrences: 1, firstSeen: now, lastSeen: now, evidenceState: "current" }]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    const before = await businessSnapshot();
    await pool.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute' WHERE organization_id=1 AND tier='critical'");
    const startedAt = new Date(); process.env.ENABLE_TEST_DIAGNOSTIC_WORKER = "1";
    // The same entry point is called by production background-task bootstrap.
    // No fake collector, accelerated timer or direct cycle invocation is used.
    worker=startDiagnosticMonitoringWorker(lifecycle); expect(worker).toBeTruthy();
    await expect.poll(async () => (await schedule("critical")).last_completed_at?.getTime() ?? 0, { timeout: 25_000 }).toBeGreaterThanOrEqual(startedAt.getTime());
    const first = await schedule("critical");
    expect(first).toMatchObject({ last_outcome: "completed", interval_seconds: 300, lease_token: null, lease_until: null });
    expect(await incident()).toMatchObject({ lifecycle: "open", consecutive_passes: 1 });
    await pool.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute' WHERE organization_id=1 AND tier='critical'");
    await expect.poll(async () => (await schedule("critical")).last_completed_at?.getTime() ?? 0, { timeout: 25_000 }).toBeGreaterThan(first.last_completed_at.getTime());
    expect(await incident()).toMatchObject({ lifecycle: "resolved", consecutive_passes: 2 });
    await pool.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute' WHERE organization_id=1 AND tier='deep'");
    await expect.poll(async () => (await schedule("deep")).last_completed_at?.getTime() ?? 0, { timeout: 25_000 }).toBeGreaterThanOrEqual(startedAt.getTime());
    expect(await schedule("deep")).toMatchObject({ last_outcome: "completed", interval_seconds: 3600, lease_token: null, lease_until: null });
    lifecycle.emit("close"); await worker!.stop();
    expect(await businessSnapshot()).toEqual(before);
    await gotoAuthed(page, "/admin/system-diagnostics?view=overview");
    const health = await page.request.get("/api/diagnostics/module-health"); expect(health.status()).toBe(200);
    const healthBody = await health.json(); expect(healthBody.data ?? healthBody).toMatchObject({ monitoringState: "healthy", monitoringFresh: true });
    await expect(page.getByRole("region", { name: "Persistent diagnostic history" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("actual-scheduled-worker-evidence.png"), fullPage: true });
    // Login may legitimately visit Control Tower and create a reporting
    // observation. Report purity is asserted above across the worker-only
    // window; never mistake that later user observation for a probe mutation.
    const operational=(rows:typeof before)=>rows.filter(row=>row.source!=="financial_reporting_runs");
    expect(operational(await businessSnapshot())).toEqual(operational(before));
  } finally {
    lifecycle.emit("close");
    await worker?.stop();
    if (previousFlag === undefined) delete process.env.ENABLE_TEST_DIAGNOSTIC_WORKER; else process.env.ENABLE_TEST_DIAGNOSTIC_WORKER = previousFlag;
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("DELETE FROM diagnostic_schedules");
      for (const row of schedules) await client.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at,lease_token,lease_until,last_started_at,last_completed_at,last_outcome)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [row.organization_id, row.tier, row.next_run_at, row.lease_token, row.lease_until, row.last_started_at, row.last_completed_at, row.last_outcome]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
});
