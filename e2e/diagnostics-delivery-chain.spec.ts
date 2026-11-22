import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { pool } from "../server/db";
import { deliverDiagnosticNotificationIntents, generateDiagnosticDailySummaries } from "../server/diagnostics/diagnostic-delivery";
import { runDiagnosticMonitoringCycle } from "../server/diagnostics/monitoring-worker";
import type { DiagnosticFinding } from "../shared/diagnostics/findings";

test.describe.configure({mode:"serial"});

test("browser incident reaches its authorized inbox without clearing the fault",async({page})=>{
  test.setTimeout(90_000);requireDisposableE2eDatabase();
  await gotoAuthed(page,"/action-inbox?privateValue=never-upload");
  await expect(page.getByTestId("action-inbox-page")).toBeVisible();
  const captured=page.waitForResponse(r=>r.url().endsWith("/api/diagnostics/events")&&r.request().method()==="POST"&&r.status()===202);
  await page.evaluate(()=>window.dispatchEvent(new ErrorEvent("error",{message:"Isolated browser delivery proof"})));
  await captured;
  const key=`frontend:BROWSER_INCIDENT:${createHash("sha256").update("browser_error|/action-inbox").digest("hex")}`;
  await Promise.all([deliverDiagnosticNotificationIntents(),deliverDiagnosticNotificationIntents()]);
  const notices=(await pool.query("SELECT id FROM notifications WHERE organization_id=1 AND user_id=1 AND finding_code=$1",[key])).rows;
  expect(notices).toHaveLength(1);
  await deliverDiagnosticNotificationIntents();
  expect((await pool.query("SELECT count(*)::int n FROM notifications WHERE organization_id=1 AND user_id=1 AND finding_code=$1",[key])).rows[0].n).toBe(1);
  await page.reload();
  const item=page.getByTestId(`action-inbox-item-notification:${notices[0].id}`);
  await expect(item).toBeVisible();
  await item.getByRole("link",{name:"Open work item"}).click();
  await expect(page).toHaveURL(/\/admin\/system-diagnostics\?view=user-errors/);
  const tokenBody=await (await page.request.get("/api/csrf-token")).json();
  const headers={"X-CSRF-Token":tokenBody.csrfToken??tokenBody.data?.csrfToken};
  expect((await page.request.post(`/api/notifications/${notices[0].id}/read`,{headers})).status()).toBe(200);
  expect((await page.request.post(`/api/notifications/${notices[0].id}/archive`,{headers})).status()).toBe(200);
  expect((await pool.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1 AND finding_key=$1",[key])).rows[0].lifecycle).toBe("open");
  await page.goto("/action-inbox");
  await expect(item).toBeVisible(); // Clearing a message cannot complete its underlying work.
  const role=(await pool.query("SELECT application_role FROM organization_members WHERE organization_id=1 AND user_id=1")).rows[0].application_role;
  try{
    await pool.query("UPDATE organization_members SET application_role='viewer' WHERE organization_id=1 AND user_id=1");
    const response=await page.request.get("/api/v2/action-inbox?pageSize=100");
    expect(response.status()).toBe(200);
    expect((await response.json()).data.items.some((row:{id:string})=>row.id===`notification:${notices[0].id}`)).toBe(false);
  }finally{await pool.query("UPDATE organization_members SET application_role=$1 WHERE organization_id=1 AND user_id=1",[role]);}
});

test("two executed scheduled probes recover work and move its original notice to history",async({page})=>{
  test.setTimeout(90_000);requireDisposableE2eDatabase();
  const saved=(await pool.query("SELECT * FROM diagnostic_schedules")).rows;
  const key="backend:DATABASE_READINESS:browser-recovery-proof";
  try{
    await pool.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at)
      SELECT o.id,t.tier,now()+interval '1 day' FROM organizations o CROSS JOIN (VALUES('critical'),('deep')) t(tier)
      WHERE o.active=true ON CONFLICT(organization_id,tier) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,lease_token=NULL,lease_until=NULL`);
    const cycle=async()=>{
      await pool.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute' WHERE organization_id=1 AND tier='critical'");
      await runDiagnosticMonitoringCycle({database:pool,collect:async(org)=>{
        expect(org).toBe(1);
        const ready=(await pool.query("SELECT to_regclass('public.e2e_browser_recovery_proof') IS NOT NULL AS ready")).rows[0].ready;
        const now=new Date().toISOString();
        const finding:DiagnosticFinding={id:"browser-recovery-proof",resourceKey:"browser-recovery-proof",category:"backend",code:"DATABASE_READINESS",
          title:"Read-only browser recovery probe",message:"Test-owned relation availability was checked by a read-only query.",
          status:ready?"working":"failed",severity:ready?"info":"error",firstSeen:now,lastSeen:now,occurrences:1,evidenceState:"current",targetRoute:"/admin/system-diagnostics"};
        return [finding];
      }});
    };
    const lifecycle=async()=>(await pool.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1 AND finding_key=$1",[key])).rows[0]?.lifecycle;
    await cycle();expect(await lifecycle()).toBe("open");
    await deliverDiagnosticNotificationIntents();
    const notice=(await pool.query("SELECT id FROM notifications WHERE organization_id=1 AND user_id=1 AND finding_code=$1 AND type='diagnostic_transition'",[key])).rows[0];
    expect(notice).toBeTruthy();
    await gotoAuthed(page,"/action-inbox");
    const original=page.getByTestId(`action-inbox-item-notification:${notice.id}`);
    await expect(original).toBeVisible();
    await pool.query("CREATE TABLE e2e_browser_recovery_proof(id integer PRIMARY KEY)");
    await cycle();expect(await lifecycle()).toBe("open");
    await cycle();expect(await lifecycle()).toBe("resolved");
    await Promise.all([deliverDiagnosticNotificationIntents(),deliverDiagnosticNotificationIntents()]);
    const recovered=(await pool.query("SELECT id FROM notifications WHERE organization_id=1 AND user_id=1 AND finding_code=$1 AND type='diagnostic_recovery'",[key])).rows;
    expect(recovered).toHaveLength(1);
    await page.reload();await expect(original).toHaveCount(0);
    await page.getByRole("button",{name:"History",exact:true}).click();
    await expect(original).toContainText("completed");
    await expect(page.getByTestId(`action-inbox-item-notification:${recovered[0].id}`)).toContainText("information");
    await page.screenshot({path:test.info().outputPath("diagnostic-recovery-inbox.png"),fullPage:true});
  }finally{
    const client=await pool.connect();
    try{await client.query("BEGIN");await client.query("DROP TABLE IF EXISTS e2e_browser_recovery_proof");await client.query("DELETE FROM diagnostic_schedules");
      for(const row of saved)await client.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at,lease_token,lease_until,last_started_at,last_completed_at,last_outcome)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[row.organization_id,row.tier,row.next_run_at,row.lease_token,row.lease_until,row.last_started_at,row.last_completed_at,row.last_outcome]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
});

test("daily summary delivery uses the saved snapshot and catches up once",async({page})=>{
  test.setTimeout(90_000);requireDisposableE2eDatabase();
  const first=new Date("2026-10-20T06:01:00Z");
  await Promise.all([generateDiagnosticDailySummaries(first),generateDiagnosticDailySummaries(first)]);
  const snapshot=(await pool.query("SELECT * FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-20'")).rows;
  expect(snapshot).toHaveLength(1);
  await generateDiagnosticDailySummaries(new Date("2026-10-22T06:01:00Z"));
  expect((await pool.query("SELECT count(*)::int n FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-21'")).rows[0].n).toBe(0);
  await generateDiagnosticDailySummaries(first);
  expect((await pool.query("SELECT * FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-20'")).rows[0]).toEqual(snapshot[0]);
  await Promise.all([deliverDiagnosticNotificationIntents(),deliverDiagnosticNotificationIntents()]);
  const notices=(await pool.query("SELECT id,body FROM notifications WHERE organization_id=1 AND user_id=1 AND type='diagnostic_daily_summary' AND title='Reliability summary — 2026-10-20'")).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0].body).toContain(`${snapshot[0].outstanding_count} outstanding at that time`);
  expect(notices[0].body).toContain("Africa/Johannesburg");
  await gotoAuthed(page,"/action-inbox");
  await page.getByRole("button",{name:"History",exact:true}).click();
  await expect(page.getByTestId(`action-inbox-item-notification:${notices[0].id}`)).toContainText("Historical snapshot");
});

test("actual delivery failure degrades Diagnostics until two real scheduled queue probes pass",async({page})=>{
  test.setTimeout(120_000);requireDisposableE2eDatabase();
  const saved=(await pool.query("SELECT * FROM diagnostic_schedules")).rows;
  const key="notifications:DIAGNOSTIC_DELIVERY:diagnostic-delivery";
  const lifecycle=async()=>(await pool.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1 AND finding_key=$1",[key])).rows[0]?.lifecycle;
  try{
    await pool.query(`CREATE FUNCTION e2e_reject_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.title='Browser delivery worker failure' THEN RAISE EXCEPTION 'Injected private delivery failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER e2e_reject_delivery BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION e2e_reject_delivery()`);
    await pool.query(`INSERT INTO diagnostic_notification_intents(organization_id,finding_key,transition,transition_key,payload)
      VALUES(1,'test:browser-delivery','opened','browser-delivery-proof', $1::jsonb)`,
      [JSON.stringify({title:"Browser delivery worker failure",message:"Test-owned delivery proof",targetRoute:"/admin/system-diagnostics"})]);
    await deliverDiagnosticNotificationIntents();
    expect(await lifecycle()).toBe("open");
    await gotoAuthed(page,"/admin/system-diagnostics?view=notifications");
    const history=page.getByRole("region",{name:"Persistent diagnostic history"});
    await expect(history.getByRole("heading",{name:"Reliability notification delivery failed",exact:true})).toBeVisible();
    const findings=await page.request.get("/api/diagnostics/findings?category=notifications");
    expect(findings.status()).toBe(200);const response=await findings.json(),body=response.data??response;
    const check=body.findings.find((row:{code:string})=>row.code==="DIAGNOSTIC_DELIVERY");
    expect(check.status).toBe("failed");expect(JSON.stringify(check)).not.toContain("Injected private");
    await pool.query("DROP TRIGGER e2e_reject_delivery ON notifications; DROP FUNCTION e2e_reject_delivery()");
    await deliverDiagnosticNotificationIntents();
    const preserved=(await pool.query(`SELECT
      (SELECT count(*)::int FROM financial_reporting_runs) AS reports,
      (SELECT count(*)::int FROM export_jobs) AS exports,
      (SELECT md5(string_agg(row_to_json(i)::text,',' ORDER BY id)) FROM inventory_items i) AS inventory,
      (SELECT md5(string_agg(row_to_json(i)::text,',' ORDER BY id)) FROM invoices i) AS invoices`)).rows[0];
    await pool.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at)
      SELECT o.id,t.tier,now()+interval '1 day' FROM organizations o CROSS JOIN (VALUES('critical'),('deep')) t(tier)
      WHERE o.active=true ON CONFLICT(organization_id,tier) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,lease_token=NULL,lease_until=NULL`);
    const actualCycle=async()=>{
      await pool.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute' WHERE organization_id=1 AND tier='critical'");
      await runDiagnosticMonitoringCycle({database:pool}); // Production collector, not a supplied successful finding.
    };
    await actualCycle();expect(await lifecycle()).toBe("open");
    await actualCycle();expect(await lifecycle()).toBe("resolved");
    const after=(await pool.query(`SELECT
      (SELECT count(*)::int FROM financial_reporting_runs) AS reports,
      (SELECT count(*)::int FROM export_jobs) AS exports,
      (SELECT md5(string_agg(row_to_json(i)::text,',' ORDER BY id)) FROM inventory_items i) AS inventory,
      (SELECT md5(string_agg(row_to_json(i)::text,',' ORDER BY id)) FROM invoices i) AS invoices`)).rows[0];
    expect(after).toEqual(preserved);
    await deliverDiagnosticNotificationIntents();await page.reload();
    const recovered=history.getByRole("listitem").filter({has:page.getByRole("heading",{name:"Reliability notification delivery",exact:true})});
    await expect(recovered).toContainText("resolved · working");
    await page.screenshot({path:test.info().outputPath("actual-delivery-recovery.png"),fullPage:true});
  }finally{
    const client=await pool.connect();
    try{await client.query("BEGIN");await client.query("DROP TRIGGER IF EXISTS e2e_reject_delivery ON notifications; DROP FUNCTION IF EXISTS e2e_reject_delivery()");
      await client.query("DELETE FROM diagnostic_schedules");
      for(const row of saved)await client.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at,lease_token,lease_until,last_started_at,last_completed_at,last_outcome)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[row.organization_id,row.tier,row.next_run_at,row.lease_token,row.lease_until,row.last_started_at,row.last_completed_at,row.last_outcome]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
});
