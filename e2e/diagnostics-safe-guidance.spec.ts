import {test,expect} from '@playwright/test';
import {gotoAuthed} from './test-helpers';
import {requireDisposableE2eDatabase,loginAsSeededUser} from './wave7-helpers';
import {pool} from '../server/db';

test('diagnostics cannot repair business data; audit and AP links expose evidence',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await gotoAuthed(page,'/admin/system-diagnostics');
  const before=(await pool.query(`SELECT md5(string_agg(value,',' ORDER BY value)) AS fingerprint FROM (
    SELECT 'item:'||row_to_json(i)::text AS value FROM inventory_items i UNION ALL SELECT 'supplier:'||row_to_json(s)::text FROM suppliers s
    UNION ALL SELECT 'shipment:'||row_to_json(s)::text FROM shipments s UNION ALL SELECT 'invoice:'||row_to_json(i)::text FROM invoices i
    UNION ALL SELECT 'index:'||indexdef FROM pg_indexes WHERE schemaname='public') facts`)).rows[0].fingerprint;
  const tokenResponse=await page.request.get('/api/csrf-token'),token=await tokenResponse.json();
  for(const category of ['database','data','configuration','system']){
    const r=await page.request.post('/api/diagnostics/fix',{headers:{'X-CSRF-Token':token.csrfToken??token.data?.csrfToken},data:{category}});
    expect(r.status()).toBe(409);expect(await r.json()).toMatchObject({changesApplied:false,success:false});
  }
  const after=(await pool.query(`SELECT md5(string_agg(value,',' ORDER BY value)) AS fingerprint FROM (
    SELECT 'item:'||row_to_json(i)::text AS value FROM inventory_items i UNION ALL SELECT 'supplier:'||row_to_json(s)::text FROM suppliers s
    UNION ALL SELECT 'shipment:'||row_to_json(s)::text FROM shipments s UNION ALL SELECT 'invoice:'||row_to_json(i)::text FROM invoices i
    UNION ALL SELECT 'index:'||indexdef FROM pg_indexes WHERE schemaname='public') facts`)).rows[0].fingerprint;
  expect(after).toBe(before);
  await page.getByRole('button',{name:'Run safe probes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Run safe probes',exact:true})).toBeEnabled();
  const history=page.getByRole('region',{name:'Persistent diagnostic history'});
  await expect(history.getByText('AP balance reconciliation',{exact:true})).toBeVisible();
  await history.getByRole('listitem').filter({has:page.getByRole('heading',{name:'AP balance reconciliation',exact:true})}).getByRole('button',{name:'Acknowledge',exact:true}).click();
  await expect(history.getByText(/acknowledged · degraded/)).toBeVisible();
  const audit=(await pool.query("SELECT details->>'findingKey' AS key FROM audit_logs WHERE action='DIAGNOSTIC_FINDING_ACKNOWLEDGED' ORDER BY id DESC LIMIT 1")).rows[0];
  expect(audit?.key).toBeTruthy();
  for(const query of ['page=0','pageSize=999','actor=not-a-number','unknown=true'])expect((await page.request.get(`/api/audit/events?${query}`)).status()).toBe(400);
  const auditResponse=await page.request.get(`/api/audit/events?findingKey=${encodeURIComponent(audit.key)}&pageSize=25`);
  expect(auditResponse.status()).toBe(200);expect((await auditResponse.json()).data.items.length).toBeGreaterThan(0);
  await page.goto(`/admin/audit-logs?view=governed&findingKey=${encodeURIComponent(audit.key)}`);
  await expect(page.getByRole('heading',{name:'diagnostic finding acknowledged',exact:true})).toBeVisible();
  await page.goto('/finance/accounts-payable/aging#opening-baselines');
  await expect(page.locator('#opening-baselines')).toHaveAttribute('open','');
  await expect(page.getByRole('textbox',{name:'Finance review reason',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('ap-deep-link.png'),fullPage:true});
  expect(pageErrors).toEqual([]);
});

test('ordinary users cannot retrieve technical diagnostic evidence',async({page})=>{
  requireDisposableE2eDatabase();
  const viewer=(await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0];expect(viewer).toBeTruthy();
  await loginAsSeededUser(page,'viewer',viewer.id);
  for(const endpoint of ['/api/diagnostics/findings','/api/diagnostics/history','/api/diagnostics/snapshot','/api/diagnostics/daily-summaries']){
    const r=await page.request.get(endpoint);expect(r.status()).toBe(403);expect(await r.text()).not.toContain('technicalDetails');
  }
});

test('historical AP filters preserve entered dates and apply only on confirmation',async({page})=>{
  test.setTimeout(90000);requireDisposableE2eDatabase();
  const current=page.waitForResponse(r=>{
    const url=new URL(r.url());
    return url.pathname==='/api/v2/ap/aging'&&!url.searchParams.has('asOf')&&r.request().method()==='GET';
  },{timeout:25_000});
  await gotoAuthed(page,'/finance/accounts-payable/aging');
  const currentResponse=await current;
  expect(currentResponse.status(),`Current AP observation ${currentResponse.headers()['x-request-id']??'unknown'}`).toBe(200);
  const date=page.getByLabel('As-of date (blank means current)',{exact:true});
  const apply=page.getByRole('button',{name:'Apply AP filters',exact:true});
  await expect(apply).toBeEnabled();
  await expect(date).toHaveValue(''); // 1: current mode
  const observed=await page.getByText(/Shared observation:/).innerText();
  await date.fill('2020-01-01');
  await expect(date).toHaveValue('2020-01-01'); // 2: retained draft
  await expect(page.getByRole('status').filter({hasText:'Filter changes are not applied yet'})).toBeVisible(); // 3
  await expect(page.getByText(/Shared observation:/)).toHaveText(observed); // 4: typing does not transact a report
  const historical=page.waitForResponse(r=>r.url().includes('/api/v2/ap/aging?')&&r.url().includes('asOf=2020-01-01'));
  await apply.click();expect((await historical).status()).toBe(200); // 5
  await expect(date).toHaveValue('2020-01-01'); // 6: survives completed observation
  await expect(page.getByRole('status').filter({hasText:'Filter changes are not applied yet'})).toHaveCount(0); // 7
  await expect(page.getByRole('region',{name:'Financial measures',exact:true}).getByText(/Separate financial measures.*As of 2020-01-01\./)).toBeVisible(); // 8: displayed scope
  await date.fill('');
  await expect(page.getByRole('status').filter({hasText:'Filter changes are not applied yet'})).toBeVisible(); // 9
  await apply.click();await expect(date).toHaveValue('');await expect(page.getByRole('status').filter({hasText:'Filter changes are not applied yet'})).toHaveCount(0); // 10: cached current observation is valid and keeps its original timestamp
});

test('AP reporting explains failures and recovers through retry without losing entered filters',async({page})=>{
  test.setTimeout(90000);requireDisposableE2eDatabase();
  const endpoint=/\/api\/v2\/ap\/aging(?:\?|$)/;
  await page.route(endpoint,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'AP_AGING_UNAVAILABLE',message:'The invoice report could not be prepared. Retry shortly.',requestId:'test-owned-report-failure'}})}));
  await gotoAuthed(page,'/finance/accounts-payable/aging');
  const report=page.getByRole('region',{name:'AP balance reporting',exact:true});
  await expect(report.getByRole('alert')).toContainText('AP reporting is unavailable'); // 1
  await expect(report.getByRole('alert')).not.toContainText('AP_AGING_UNAVAILABLE'); // 2
  await expect(report.getByRole('alert')).toContainText('Request ID: test-owned-report-failure');
  await expect(report.getByRole('region',{name:'Financial measures',exact:true})).toHaveCount(0); // 3: no invented totals
  await expect(report.getByRole('button',{name:'Retry AP report',exact:true})).toBeEnabled(); // 4
  const retryFailure=page.waitForResponse(r=>endpoint.test(r.url())&&r.status()===503);
  await report.getByRole('button',{name:'Retry AP report',exact:true}).click();await retryFailure;
  await expect(report.getByRole('alert')).toContainText('AP reporting is unavailable'); // 5: failed retries stay failed
  await page.unroute(endpoint);
  const recovered=page.waitForResponse(r=>endpoint.test(r.url())&&r.status()===200);
  await report.getByRole('button',{name:'Retry AP report',exact:true}).click();await recovered;
  await expect(report.getByRole('alert')).toHaveCount(0); // 6
  await expect(report.getByRole('region',{name:'Financial measures',exact:true})).toBeVisible(); // 7
  const date=report.getByLabel('As-of date (blank means current)',{exact:true});await date.fill('2999-01-01');
  const invalid=page.waitForResponse(r=>endpoint.test(r.url())&&r.status()===400);
  await report.getByRole('button',{name:'Apply AP filters',exact:true}).click();await invalid;
  await expect(report.getByRole('alert')).toBeVisible(); // 8
  await expect(date).toHaveValue('2999-01-01'); // 9: invalid inputs remain available for correction
  await date.fill('2020-01-01');
  const valid=page.waitForResponse(r=>endpoint.test(r.url())&&r.status()===200&&r.url().includes('asOf=2020-01-01'));
  await report.getByRole('button',{name:'Apply AP filters',exact:true}).click();await valid;
  await expect(report.getByRole('alert')).toHaveCount(0);await expect(date).toHaveValue('2020-01-01'); // 10
});
