import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { pool } from "../server/db";

test("monitoring cannot appear healthy before execution or after a failed scheduled run", async ({ page }) => {
  test.setTimeout(90_000);
  requireDisposableE2eDatabase();
  const original=(await pool.query("SELECT * FROM diagnostic_schedules WHERE organization_id=1 ORDER BY tier")).rows;
  try {
    await pool.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at)
      VALUES(1,'critical',now()+interval '1 hour'),(1,'deep',now()+interval '1 hour')
      ON CONFLICT(organization_id,tier) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,
        last_completed_at=NULL,last_outcome=NULL,lease_token=NULL,lease_until=NULL`);
    await gotoAuthed(page,"/admin/system-diagnostics");
    const history=page.getByRole("region",{name:"Persistent diagnostic history"});
    await expect(history.getByText(/Last completed not yet verified/)).toHaveCount(2);
    const health=async()=>{
      const response=await page.request.get("/api/diagnostics/module-health");
      expect(response.status()).toBe(200);
      const body=await response.json();
      return body.data??body;
    };
    expect(await health()).toMatchObject({monitoringState:"unverified",monitoringFresh:false});
    await pool.query(`UPDATE diagnostic_schedules SET last_completed_at=now(),
      last_outcome=CASE WHEN tier='critical' THEN 'failed' ELSE 'completed' END WHERE organization_id=1`);
    await page.reload();
    await expect(history.getByText(/Last check could not complete — retry scheduled/)).toBeVisible();
    const failed=await health();
    expect(failed.monitoringState).toBe("degraded");
    expect(failed.state).not.toBe("healthy");
    await pool.query(`UPDATE diagnostic_schedules SET last_outcome='completed',next_run_at=now()-interval '6 minutes'
      WHERE organization_id=1`);
    await page.reload();
    await expect(history.getByText(/Overdue — monitoring evidence is stale/)).toHaveCount(2);
    expect(await health()).toMatchObject({monitoringState:"stale",monitoringFresh:false});
    await page.screenshot({path:test.info().outputPath("monitoring-stale-evidence.png"),fullPage:true});
  } finally {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM diagnostic_schedules WHERE organization_id=1");
      for(const row of original) await client.query(`INSERT INTO diagnostic_schedules
        (organization_id,tier,next_run_at,lease_token,lease_until,last_started_at,last_completed_at,last_outcome)
        VALUES(1,$1,$2,$3,$4,$5,$6,$7)`,[row.tier,row.next_run_at,row.lease_token,row.lease_until,row.last_started_at,row.last_completed_at,row.last_outcome]);
      await client.query("COMMIT");
    } catch(error){await client.query("ROLLBACK");throw error;}
    finally {client.release();}
  }
});
