import {expect,test} from '@playwright/test';
import {pool} from '../server/db';
import {gotoAuthed} from './test-helpers';
import {requireDisposableE2eDatabase,loginAsSeededUser} from './wave7-helpers';
import {seedSystemRoleUser} from '../scripts/runtime-fixtures/expanded-security-fixtures';

test('FX proposal requires another approver and application before reporting changes',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  const suffix=String(Date.now());
  const reviewer=await seedSystemRoleUser({suffix,label:'FX independent reviewer',role:'admin'});
  const supplier=await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id",[`FX evidence ${suffix}`]);
  await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,currency_code,status,approval_status,total_amount,order_date,created_by_user_id,approved_by_user_id)
    VALUES(1,$1,$2,'USD','APPROVED','APPROVED',10,'2002-01-01',1,$3)`,[`FX-EVIDENCE-${suffix}`,supplier.rows[0].id,reviewer.userId]);
  const summary=async()=>{
    const response=await page.request.get(`/api/v2/analytics/financial-measures?measure=ordered&from=2002-01-01&to=2002-01-01&supplierId=${supplier.rows[0].id}`);
    expect(response.status()).toBe(200);const body=await response.json();return body.data??body;
  };
  await gotoAuthed(page,'/admin/master-data/exchangeRates');
  await expect(page.getByTestId('reporting-fx-workspace')).toBeVisible();
  const before=await summary();expect(before.state).toBe('unavailable');
  await page.getByLabel('From currency code',{exact:true}).fill('USD');
  await page.getByLabel('Reporting currency code',{exact:true}).fill('ZAR');
  await page.getByLabel('Exact direct rate',{exact:true}).fill('18.5000000001');
  await page.getByLabel('Effective date (00:00 UTC)',{exact:true}).fill('2001-01-01');
  await page.getByLabel('Business reason for FX proposal',{exact:true}).fill(`Disposable independent reporting approval ${suffix}`);
  const created=page.waitForResponse(response=>response.url().endsWith('/api/mdm/change-requests')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Submit FX proposal for independent approval',exact:true}).click();
  const response=await created;expect(response.status()).toBe(201);const body=await response.json(),request=body.data??body;
  await expect(page.getByText('Reporting has not changed.',{exact:false})).toBeVisible();
  expect((await summary()).state).toBe('unavailable');
  await page.getByRole('button',{name:'Review submitted request',exact:true}).click();
  await expect(page.getByTestId('mdm-change-request-detail')).toContainText('exchange-rates');
  await expect(page.getByTestId('mdm-admin-override-warning')).toHaveCount(0);
  const self=page.waitForResponse(result=>result.url().endsWith(`/change-requests/${request.id}/approve`)&&result.request().method()==='POST');
  await page.getByTestId('mdm-change-request-approve-button').click();
  expect((await self).status()).toBe(409);
  await loginAsSeededUser(page,reviewer.username,reviewer.userId);
  await page.goto('/admin/master-data/overview',{waitUntil:'load'});
  await page.getByTestId('master-data-review-approvals-button').click();
  await page.getByTestId(`mdm-change-request-row-${request.id}`).click();
  const approved=page.waitForResponse(result=>result.url().endsWith(`/change-requests/${request.id}/approve`)&&result.request().method()==='POST');
  await page.getByTestId('mdm-change-request-approve-button').click();expect((await approved).status()).toBe(200);
  expect((await summary()).state).toBe('unavailable');
  const applied=page.waitForResponse(result=>result.url().endsWith(`/change-requests/${request.id}/apply`)&&result.request().method()==='POST');
  await page.getByTestId('mdm-apply-change-request').click();const application=await applied;expect(application.status()).toBe(200);
  const fresh=await summary();expect(fresh.state).toBe('complete');expect(fresh.amount).toBe('185.00');
  const frozen=await page.request.get(`/api/v2/analytics/financial-measures/ordered/evidence?runId=${before.runId??before.id}`);
  expect(frozen.status()).toBe(200);const savedBody=await frozen.json(),saved=savedBody.data??savedBody;
  expect(saved.summary.state).toBe('unavailable');expect(saved.summary.amount).toBeNull();
  expect(saved.evidenceHash).toBe(before.evidenceHash);
  expect(saved.items).toHaveLength(1);expect(saved.items[0].exclusion).toBe('missing_approved_fx');
  const currentEvidenceResponse=await page.request.get(`/api/v2/analytics/financial-measures/ordered/evidence?runId=${fresh.id}`);
  expect(currentEvidenceResponse.status()).toBe(200);const currentBody=await currentEvidenceResponse.json(),current=currentBody.data??currentBody;
  expect(current.items[0].rateVersion).toBe(1);expect(current.items[0].reportingAmount).toBe('185.00');
  const globalResponse=await page.request.get('/api/v2/analytics/financial-measures?measure=ordered');
  expect(globalResponse.status()).toBe(200);const globalBody=await globalResponse.json(),global=globalBody.data??globalBody;
  expect(global.amount).not.toBeNull();
  for(const route of ['/procurement/overview','/analytics/procurement']) {
    await page.goto(route,{waitUntil:'load'});
    if(route.startsWith('/analytics')) {
      await page.getByLabel('From',{exact:true}).fill('2002-01-01');
      await page.getByLabel('To',{exact:true}).fill('2002-01-01');
      await page.getByTestId('analytics-supplier-filter').click();
      await page.getByRole('option',{name:`FX evidence ${suffix}`,exact:true}).click();
    }
    const expected=route.startsWith('/analytics')?fresh:global;
    await expect(page.getByTestId('financial-measure-ordered').getByText(`${expected.currencyCode} ${expected.amount}`,{exact:true}).first()).toBeVisible({timeout:25000});
  }
  await page.goto('/admin/master-data/exchangeRates',{waitUntil:'load'});
  await expect(page.getByText('Published reporting revision',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect((await page.request.get('/api/mdm/fx/rates?pageSize=1000')).status()).toBe(400);
});
