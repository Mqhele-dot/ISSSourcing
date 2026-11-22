import {test,expect} from "@playwright/test";
import {pool} from "../server/db";
import {seedCustomPermissionUser} from "../scripts/runtime-fixtures/expanded-security-fixtures";
import {loginAsSeededUser,requireDisposableE2eDatabase} from "./wave7-helpers";

test("export source access is enforced before preview, queue, worker and retained download",async({page})=>{
  test.setTimeout(120_000);requireDisposableE2eDatabase();
  const user=await seedCustomPermissionUser({label:"Export source proof",permissions:[{resource:"reports",actions:["read","export"]}]});
  await loginAsSeededUser(page,user.username,user.userId);
  expect((await page.request.get('/api/logistics/shipments/1/delivery-note.pdf')).status()).toBe(403);
  const token=await (await page.request.get("/api/csrf-token")).json();
  const headers={"X-CSRF-Token":token.csrfToken??token.data?.csrfToken};
  const payload={dataset:"purchase_orders",format:"csv"};
  for(const url of ["/api/export-center/custom-preview","/api/reports/preview","/api/export-center/custom-export","/api/export-jobs"]){
    const response=await page.request.post(url,{headers,data:payload});expect(response.status(),url).toBe(403);
  }
  expect((await page.request.get("/api/export/purchase_orders/csv")).status()).toBe(403);
  await pool.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES($1,'purchases','read')",[user.customRoleId]);
  const unsupportedProfile=await page.request.post("/api/export-jobs",{headers,data:{...payload,profile:"compact_excel"}});
  expect(unsupportedProfile.status()).toBe(409);
  expect(JSON.stringify(await unsupportedProfile.json())).toContain("No replacement export was created");
  expect((await pool.query("SELECT count(*)::int n FROM export_jobs WHERE created_by=$1",[user.userId])).rows[0].n).toBe(0);
  const queued=await page.request.post("/api/export-jobs",{headers,data:payload});expect(queued.status()).toBe(202);
  const queuedBody=await queued.json(),jobId=(queuedBody.data??queuedBody).id;
  expect(jobId).toBeGreaterThan(0);
  const visibleHistory=await page.request.get("/api/export-center/history");
  expect(visibleHistory.status()).toBe(200);
  const visibleBody=await visibleHistory.json();
  expect((visibleBody.data??visibleBody).some((row:{id:number})=>row.id===jobId)).toBe(true);
  await expect.poll(async()=>(await pool.query("SELECT status FROM export_jobs WHERE id=$1",[jobId])).rows[0]?.status,{timeout:40000}).toBe("succeeded");
  const saved=(await pool.query("SELECT download_token FROM export_jobs WHERE id=$1",[jobId])).rows[0];
  const download=`/api/export/download/${jobId}?token=${saved.download_token}`;
  expect((await page.request.get(download)).status()).toBe(200);
  await pool.query("DELETE FROM custom_role_permissions WHERE role_id=$1 AND resource='purchases' AND permission_type='read'",[user.customRoleId]);
  for(const url of [download,`/api/export-jobs/${jobId}`])expect((await page.request.get(url)).status(),url.split("?")[0]).toBe(403);
  expect((await page.request.post(`/api/export-jobs/${jobId}/download-token`,{headers})).status()).toBe(403);
  const history=await (await page.request.get("/api/export-center/history")).json();
  expect((history.data??history).some((row:{id:number})=>row.id===jobId)).toBe(false);
  // Simulate an already queued job whose source permission was revoked before execution.
  const stale=await pool.query(`INSERT INTO export_jobs(organization_id,created_by,dataset,format,filters,status)
    VALUES(1,$1,'purchase_orders','csv','{}','queued') RETURNING id`,[user.userId]);
  const staleId=stale.rows[0].id;
  await expect.poll(async()=>(await pool.query("SELECT status FROM export_jobs WHERE id=$1",[staleId])).rows[0]?.status,{timeout:40000}).toBe("failed");
  const rejected=(await pool.query("SELECT file_path,last_error FROM export_jobs WHERE id=$1",[staleId])).rows[0];
  expect(rejected.file_path).toBeNull();expect(rejected.last_error).toContain("source records");
});
