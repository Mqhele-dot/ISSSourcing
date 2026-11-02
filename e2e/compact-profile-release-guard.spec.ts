import {test,expect} from '@playwright/test';
import {pool} from '../server/db';
import {getExportDatasetRegistry} from '../server/services/export-registry';
import {seedCustomPermissionUser} from '../scripts/runtime-fixtures/expanded-security-fixtures';
import {gotoAuthed} from './test-helpers';
import {loginAsSeededUser,requireDisposableE2eDatabase} from './wave7-helpers';

test('all registered datasets keep Compact Excel disabled without queuing a replacement',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await gotoAuthed(page,'/analytics/export-center');
  const token=await (await page.request.get('/api/csrf-token')).json(),headers={'X-CSRF-Token':token.csrfToken??token.data?.csrfToken};
  const before=Number((await pool.query('SELECT count(*) n FROM export_jobs')).rows[0].n);
  for(const dataset of getExportDatasetRegistry()){
    const response=await page.request.post('/api/export-jobs',{headers,data:{dataset:dataset.key,format:'excel',profile:'compact_excel'}});
    expect(response.status(),dataset.key).toBe(409);const body=JSON.stringify(await response.json());
    expect(body).toContain('EXPORT_PROFILE_NOT_ENABLED');expect(body).toContain('No replacement export was created');
  }
  expect(Number((await pool.query('SELECT count(*) n FROM export_jobs')).rows[0].n)).toBe(before);
  expect(errors).toEqual([]);
});

test('the final three record datasets cannot bypass source permissions through previews or jobs',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  const user=await seedCustomPermissionUser({label:'Record export source denial',permissions:[{resource:'reports',actions:['read','export']}]});
  await loginAsSeededUser(page,user.username,user.userId);
  const token=await (await page.request.get('/api/csrf-token')).json(),headers={'X-CSRF-Token':token.csrfToken??token.data?.csrfToken};
  for(const dataset of ['inventory','reorder_requests','invoices']){
    for(const endpoint of ['/api/export-center/custom-preview','/api/reports/preview','/api/export-jobs']){
      const response=await page.request.post(endpoint,{headers,data:{dataset,format:'csv'}});expect(response.status(),`${dataset} ${endpoint}`).toBe(403);
    }
    expect((await page.request.post('/api/export-jobs',{headers,data:{dataset,format:'excel',profile:'compact_excel'}})).status()).toBe(403);
  }
  expect((await pool.query('SELECT count(*)::int n FROM export_jobs WHERE created_by=$1',[user.userId])).rows[0].n).toBe(0);
});

test('retained or failed Compact jobs cannot fall back to standard retries or download paths while disabled',async({page})=>{
  requireDisposableE2eDatabase();await gotoAuthed(page,'/analytics/export-center');
  const me=await (await page.request.get('/api/user')).json(),userId=Number(me.id??me.data?.id);expect(userId).toBeGreaterThan(0);
  const memberships=await pool.query("SELECT organization_id FROM organization_members WHERE user_id=$1 AND active=true AND status='active' ORDER BY id LIMIT 1",[userId]);
  const organizationId=memberships.rows[0].organization_id;
  const seeded=await pool.query(`INSERT INTO export_jobs(organization_id,created_by,dataset,format,filters,profile,status,file_name,file_path,file_size,mime_type,download_token,download_token_expires_at,retention_expires_at)
    SELECT $1,$2,'purchase_orders','excel','{}','compact_excel',state,'private.xlsx','test-owned-not-a-public-file.xlsx',123,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','synthetic-test-token',now()+interval '30 minutes',now()+interval '7 days' FROM unnest(ARRAY['failed','succeeded']) state RETURNING id,status,download_token,download_token_expires_at,updated_at`,[organizationId,userId]);
  const before=Number((await pool.query('SELECT count(*) n FROM export_jobs')).rows[0].n);
  const token=await (await page.request.get('/api/csrf-token')).json(),headers={'X-CSRF-Token':token.csrfToken??token.data?.csrfToken};
  for(const job of seeded.rows){
    const detail=await (await page.request.get(`/api/export-jobs/${job.id}`)).json(),data=detail.data??detail;
    expect(data.canRetry).toBe(false);expect(data.downloadUrl).toBeNull();
    for(const endpoint of ['retry','download-token']){
      const response=await page.request.post(`/api/export-jobs/${job.id}/${endpoint}`,{headers,data:{}});expect(response.status()).toBe(409);expect(JSON.stringify(await response.json())).toContain('EXPORT_PROFILE_NOT_ENABLED');
    }
    const download=await page.request.get(`/api/export/download/${job.id}?token=synthetic-test-token`);expect(download.status()).toBe(409);expect(JSON.stringify(await download.json())).toContain('No file was delivered');
    const after=(await pool.query('SELECT status,download_token,download_token_expires_at,updated_at FROM export_jobs WHERE id=$1',[job.id])).rows[0];expect(after.status).toBe(job.status);expect(after.download_token).toBe(job.download_token);expect(after.download_token_expires_at).toEqual(job.download_token_expires_at);expect(after.updated_at).toEqual(job.updated_at);
  }
  expect(Number((await pool.query('SELECT count(*) n FROM export_jobs')).rows[0].n)).toBe(before);
  await page.reload();
  for(const job of seeded.rows){const card=page.getByTestId(`export-history-job-${job.id}`);await expect(card).toContainText('Downloads and retries are disabled.');await expect(card.getByRole('button',{name:/Download|Retry/})).toHaveCount(0);}
});
