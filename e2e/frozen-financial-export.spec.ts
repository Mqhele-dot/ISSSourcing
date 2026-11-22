import { expect,test } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { gotoAuthed } from "./test-helpers";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { pool } from "../server/db";

test("shared financial observation queues a frozen export through the real worker",async({page})=>{
  test.setTimeout(90_000);
  requireDisposableE2eDatabase();
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await gotoAuthed(page,"/procurement/overview");
  const panel=page.getByRole("region",{name:"Financial measures"});
  await expect(panel.getByText(/Shared observation:/)).toBeVisible({timeout:25_000});
  const queued=page.waitForResponse(response=>response.url().includes("/financial-measures/ordered/export")&&response.request().method()==="POST");
  await panel.getByRole("button",{name:"Export this observation",exact:true}).first().click();
  const response=await queued;
  expect(response.status()).toBe(202);
  const body=await response.json();
  const {jobId,runId}=body.data??body;
  expect(jobId).toBeGreaterThan(0);
  await expect.poll(async()=>{
    const result=await pool.query("SELECT status,last_error FROM export_jobs WHERE id=$1",[jobId]);
    if(result.rows[0]?.status==="failed") throw new Error(result.rows[0].last_error);
    return result.rows[0]?.status;
  },{timeout:40_000}).toBe("succeeded");
  const result=await pool.query("SELECT download_token,filters FROM export_jobs WHERE id=$1",[jobId]);
  expect(result.rows[0].filters).toEqual({runId,measure:"ordered"});
  const download=await page.request.get(`/api/export/download/${jobId}?token=${result.rows[0].download_token}`);
  expect(download.status()).toBe(200);
  const csv=gunzipSync(await download.body()).toString("utf8");
  expect(csv).toContain(runId);
  expect(csv).toContain('"evidenceHash"');
  const observationsBefore=(await pool.query("SELECT count(*)::int AS count FROM financial_reporting_runs")).rows[0].count;
  const direct=await page.request.get(`/api/export/financial_measure/csv?measure=ordered&runId=${runId}`);
  expect(direct.status()).toBe(200);
  expect(await direct.text()).toBe(csv);
  expect((await pool.query("SELECT count(*)::int AS count FROM financial_reporting_runs")).rows[0].count).toBe(observationsBefore);
  const again=await page.request.get(`/api/export/download/${jobId}?token=${result.rows[0].download_token}`);
  expect(await again.body()).toEqual(await download.body());
  const owner=await pool.query("SELECT organization_id,created_by FROM export_jobs WHERE id=$1",[jobId]);
  await pool.query("UPDATE organization_members SET active=false WHERE organization_id=$1 AND user_id=$2",[owner.rows[0].organization_id,owner.rows[0].created_by]);
  try {
    const denied=await page.request.get(`/api/export/download/${jobId}?token=${result.rows[0].download_token}`);
    expect([401,403,404]).toContain(denied.status());
    const directDenied=await page.request.get(`/api/export/financial_measure/csv?measure=ordered&runId=${runId}`);
    expect([401,403,404]).toContain(directDenied.status());
  } finally {
    await pool.query("UPDATE organization_members SET active=true WHERE organization_id=$1 AND user_id=$2",[owner.rows[0].organization_id,owner.rows[0].created_by]);
  }
  expect(errors).toEqual([]);
});
