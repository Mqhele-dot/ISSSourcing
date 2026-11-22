import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {pool} from '../server/db';
import {analyticsResources} from '../shared/analytics-source-access';
import {seedCustomPermissionUser} from '../scripts/runtime-fixtures/expanded-security-fixtures';
import {gotoAuthed} from './test-helpers';
import {loginAsSeededUser,requireDisposableE2eDatabase} from './wave7-helpers';

const dashboards=['/api/control-tower/overview','/api/dashboard/control-tower'];
async function csrf(page:Page){const body=await (await page.request.get('/api/csrf-token')).json();return {'X-CSRF-Token':body.csrfToken??body.data?.csrfToken};}
async function selectOrganization(page:Page,organizationId:number){expect((await page.request.post('/api/organization/active',{headers:await csrf(page),data:{organizationId}})).status()).toBe(200);}
async function advanceFixtureSequence(table:'organizations'|'organization_members'|'warehouses'|'app_settings'){
  requireDisposableE2eDatabase();
  // Bootstrap uses explicit IDs. Advance (never rewind) only these test-owned
  // sequences so later fixtures can continue to use ordinary serial inserts.
  await pool.query(`SELECT setval(pg_get_serial_sequence($1,'id'),GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),0),COALESCE(pg_sequence_last_value(pg_get_serial_sequence($1,'id')::regclass),0),1),true)`,[table]);
}
async function organization(name:string){await advanceFixtureSequence('organizations');return Number((await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',[name])).rows[0].id);}
async function data(page:Page,path:string){const response=await page.request.get(path);expect(response.status(),path).toBe(200);const body=await response.json();return body.data??body;}

test('combined dashboards deny anonymous, missing-source and revoked access',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  for(const path of dashboards)expect((await page.request.get(path)).status()).toBe(401);
  const limited=await seedCustomPermissionUser({label:'Dashboard reports only',permissions:[{resource:'reports',actions:['read']}]});
  await loginAsSeededUser(page,limited.username,limited.userId);
  for(const path of dashboards)expect((await page.request.get(path)).status()).toBe(403);
  const permitted=await seedCustomPermissionUser({label:'Dashboard all sources',permissions:[{resource:'reports',actions:['read']},...analyticsResources.map(resource=>({resource,actions:['read' as const]}))]});
  await loginAsSeededUser(page,permitted.username,permitted.userId);
  for(const path of dashboards)await data(page,path);
  await pool.query("UPDATE organization_members SET active=false,status='inactive' WHERE organization_id=1 AND user_id=$1",[permitted.userId]);
  try{for(const path of dashboards)expect([401,403]).toContain((await page.request.get(path)).status());}
  finally{await pool.query("UPDATE organization_members SET active=true,status='active' WHERE organization_id=1 AND user_id=$1",[permitted.userId]);}
});

test('tenant-scoped exception and stock KPIs remain complete beyond 5000 rows and failures never appear healthy',async({page,browser})=>{
  test.setTimeout(180000);requireDisposableE2eDatabase();const suffix=randomUUID(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await gotoAuthed(page,'/operations/control-tower');
  const own=await organization(`Dashboard volume ${suffix}`),foreign=await organization(`Foreign dashboard ${suffix}`);
  await advanceFixtureSequence('organization_members');
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,application_role,active,status) VALUES($1,1,'member','admin',true,'active')",[own]);
  // This gate tests established dashboard observations, not the onboarding
  // wizard. Prepare only this test-owned organization's fixture checkpoint.
  await advanceFixtureSequence('app_settings');
  await pool.query("INSERT INTO app_settings(organization_id,company_name,product_onboarding_completed_at) VALUES($1,$2,now()) ON CONFLICT(organization_id) DO UPDATE SET product_onboarding_completed_at=excluded.product_onboarding_completed_at",[own,`Dashboard volume ${suffix}`]);
  await pool.query(`INSERT INTO operational_exceptions(organization_id,type,title,status,created_at)
    SELECT $1::int,'scope_test','OWN-'||$3::text||'-'||g,'open','1900-01-01'::timestamp FROM generate_series(1,5001) g
    UNION ALL SELECT $2::int,'scope_test','FOREIGN-'||$3::text||'-'||g,'open','1800-01-01'::timestamp FROM generate_series(1,5001) g
    UNION ALL SELECT NULL::int,'scope_test','UNASSIGNED-'||$3::text,'open','1700-01-01'::timestamp`,[own,foreign,suffix]);
  await pool.query(`INSERT INTO ops_activity(organization_id,entity_type,entity_id,action,summary_json) VALUES
    ($1,'purchase_requisition',$3,'scope_test','{}'),($2,'purchase_requisition',$3,'scope_test','{}'),(NULL,'purchase_requisition',$3,'scope_test','{}')`,[own,foreign,suffix]);
  await pool.query(`INSERT INTO inventory_items(organization_id,name,sku,quantity,price,low_stock_threshold,status)
    SELECT $1,'Volume item','SCOPE-'||$2||'-'||g,0,0,1,'active' FROM generate_series(1,5001) g`,[own,suffix]);
  const allocated=(await pool.query("INSERT INTO inventory_items(organization_id,name,sku,quantity,price,low_stock_threshold,status) VALUES($1,'Reserved item',$2,10,0,1,'active') RETURNING id",[own,`ALLOCATED-${suffix}`])).rows[0].id;
  await pool.query("INSERT INTO inventory_allocations(organization_id,item_id,quantity,status) VALUES($1,$2,9,'reserved')",[own,allocated]);
  await pool.query("INSERT INTO inventory_items(organization_id,name,sku,quantity,price,low_stock_threshold,status) VALUES($1,'Inactive item',$2,0,0,1,'inactive'),($3,'Foreign shared SKU',$4,1000,0,1,'active')",[own,`INACTIVE-${suffix}`,foreign,`SCOPE-${suffix}-1`]);
  await pool.query("INSERT INTO inventory_positions(sku,location,on_hand,allocated) VALUES($1,'Unscoped legacy evidence',999,0)",[`SCOPE-${suffix}-1`]);
  await selectOrganization(page,own);
  try{
    const overview=await data(page,dashboards[0]),dashboard=await data(page,dashboards[1]),stock=await data(page,'/api/v2/inventory?low=1&pageSize=25');
    expect(overview.kpis.openExceptionsTotal).toBe(5001);expect(dashboard.kpis.operationalExceptions).toBe(5001);
    expect(overview.kpis.lowStockSkus).toBe(5002);expect(dashboard.kpis.lowStockItems).toBe(5002);expect(stock.total).toBe(5002);
    expect(stock.items).toHaveLength(25);expect(stock.summary.qualityEligible).toBe(false);
    expect(dashboard.spotlight.oldestOpenExceptions).toHaveLength(8);expect(dashboard.spotlight.oldestOpenExceptions.every((row:{title:string})=>row.title.startsWith('OWN-'))).toBe(true);
    expect(dashboard.operationsTrend.reduce((sum:number,row:{requisitions:number})=>sum+row.requisitions,0)).toBe(1);
    expect(JSON.stringify(dashboard)).not.toContain(`FOREIGN-${suffix}`);expect(JSON.stringify(dashboard)).not.toContain(`UNASSIGNED-${suffix}`);
    expect(JSON.stringify(dashboard).length).toBeLessThan(120000);
    const secondContext=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:page.viewportSize()??undefined});
    try{
      const second=await secondContext.newPage();await gotoAuthed(second,'/operations/control-tower');await selectOrganization(second,1);
      const otherCount=Number((await pool.query("SELECT count(*) n FROM operational_exceptions WHERE organization_id=1 AND status IN('open','in_progress')")).rows[0].n);
      expect(otherCount).not.toBe(5001);
      await Promise.all(Array.from({length:3},async()=>{
        const [first,other]=await Promise.all([data(page,dashboards[1]),data(second,dashboards[1])]);
        expect(first.kpis.operationalExceptions).toBe(5001);expect(first.kpis.lowStockItems).toBe(5002);
        expect(first.spotlight.oldestOpenExceptions.every((row:{title:string})=>row.title.startsWith('OWN-'))).toBe(true);
        expect(other.kpis.operationalExceptions).toBe(otherCount);expect(JSON.stringify(other)).not.toContain(`OWN-${suffix}`);
      }));
    }finally{await secondContext.close();}
    await page.goto('/operations/control-tower',{waitUntil:'load'});
    await expect(page.getByTestId('dashboard-kpi-exceptions')).toContainText('5001',{timeout:25000});
    await expect(page.getByTestId('dashboard-kpi-low-stock')).toContainText('5002');
    await pool.query('ALTER TABLE operational_exceptions RENAME TO dashboard_exceptions_failure_test');
    try{
      const failed=await data(page,dashboards[1]);expect(failed.kpis.operationalExceptions).toBeNull();
      expect(failed.meta.partialFailures.some((row:{area:string})=>row.area==='exceptions')).toBe(true);
      expect(JSON.stringify(failed)).not.toMatch(/does not exist|SELECT |postgresql:|stack/);
      expect((await page.request.get(dashboards[0])).status()).toBe(503);
      await page.getByTestId('dashboard-refresh-button').click();
      await expect(page.getByTestId('dashboard-kpi-exceptions')).toContainText('Unavailable',{timeout:20000});
      await expect(page.getByTestId('control-tower-partial-failures-banner')).toBeVisible();
      await page.screenshot({path:test.info().outputPath('exceptions-unavailable.png'),fullPage:true});
    }finally{await pool.query('ALTER TABLE dashboard_exceptions_failure_test RENAME TO operational_exceptions');}
    await page.getByTestId('dashboard-refresh-button').click();
    await expect(page.getByTestId('dashboard-kpi-exceptions')).toContainText('5001',{timeout:20000});
    expect(errors).toEqual([]);
  }finally{await selectOrganization(page,1);}
});

test('confirmed receiving uses canonical shipment identity and updates stock, receipt evidence and PO once',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();const suffix=randomUUID();await gotoAuthed(page,'/procurement/receiving');
  const supplier=(await pool.query('SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1')).rows[0].id;
  const item=(await pool.query("INSERT INTO inventory_items(organization_id,name,sku,quantity,price,status) VALUES(1,'Receipt identity test',$1,0,2,'active') RETURNING id,sku",[`RECEIPT-${suffix}`])).rows[0];
  await advanceFixtureSequence('warehouses');
  const warehouse=(await pool.query("INSERT INTO warehouses(organization_id,name,aisles,bins) VALUES(1,$1,'[]','[]') RETURNING id",[`Receipt warehouse ${suffix}`])).rows[0].id;
  const order=(await pool.query("INSERT INTO purchase_orders(organization_id,supplier_id,order_number,status,approval_status,currency_code,order_date) VALUES(1,$1,$2,'SENT','APPROVED','ZAR',now()) RETURNING id,order_number",[supplier,`RECEIPT-${suffix}`])).rows[0];
  const other=(await pool.query("INSERT INTO purchase_orders(organization_id,supplier_id,order_number,status,approval_status) VALUES(1,$1,$2,'SENT','APPROVED') RETURNING id",[supplier,`OTHER-${suffix}`])).rows[0].id;
  await pool.query("INSERT INTO purchase_order_items(order_id,item_id,quantity,unit_price,total_price,received_quantity,line_type) VALUES($1,$2,2,2,4,0,'CATALOG')",[order.id,item.id]);
  const wrong=(await pool.query("INSERT INTO shipments(organization_id,purchase_order_id,po_number,status) VALUES(1,$1,$2,'in_transit') RETURNING id",[other,order.order_number])).rows[0].id;
  const correct=(await pool.query("INSERT INTO shipments(organization_id,purchase_order_id,po_number,status) VALUES(1,$1,$2,'in_transit') RETURNING id",[order.id,`DIFFERENT-RAW-NUMBER-${suffix}`])).rows[0].id;
  const headers={...await csrf(page),'Idempotency-Key':randomUUID()},payload={warehouse_id:warehouse,shipment_id:wrong,lines:[{sku:item.sku,qty_received_now:2}],grn_number:`GRN-${suffix}`};
  const endpoint=`/api/procurement/purchase-orders/${order.id}/receive`;
  for(const invalid of ['not-a-shipment',0,-1,1.5,false,[correct]]){
    const response=await page.request.post(endpoint,{headers,data:{...payload,shipment_id:invalid}});expect(response.status()).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('Choose a valid shipment');
  }
  const rejected=await page.request.post(endpoint,{headers,data:payload});expect(rejected.status()).toBe(400);expect(JSON.stringify(await rejected.json())).toContain('does not belong');
  expect((await pool.query('SELECT count(*)::int n FROM ap_receipts WHERE purchase_order_id=$1',[order.id])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT quantity FROM inventory_items WHERE id=$1',[item.id])).rows[0].quantity).toBe(0);
  const confirmed=await page.request.post(endpoint,{headers,data:{...payload,shipment_id:correct}});expect(confirmed.status()).toBe(200);
  const again=await page.request.post(endpoint,{headers,data:{...payload,shipment_id:correct}});expect(again.status()).toBe(200);
  expect((await pool.query('SELECT count(*)::int n FROM ap_receipts WHERE purchase_order_id=$1',[order.id])).rows[0].n).toBe(1);
  expect((await pool.query('SELECT quantity FROM inventory_items WHERE id=$1',[item.id])).rows[0].quantity).toBe(2);
  expect(Number((await pool.query('SELECT quantity FROM warehouse_inventory WHERE item_id=$1 AND warehouse_id=$2',[item.id,warehouse])).rows[0].quantity)).toBe(2);
  expect((await pool.query('SELECT count(*)::int n FROM stock_movements WHERE item_id=$1 AND reference_type=\'ap_receipt\'',[item.id])).rows[0].n).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM receipt_value_evidence WHERE organization_id=1 AND receipt_item_id IN(SELECT id FROM ap_receipt_items WHERE item_id=$1)',[item.id])).rows[0].n).toBe(1);
  expect((await pool.query('SELECT status FROM purchase_orders WHERE id=$1',[order.id])).rows[0].status).toBe('RECEIVED');
  const shipment=await data(page,`/api/logistics/shipments/${correct}`);expect(shipment.purchaseOrderId).toBe(order.id);expect(shipment.grnNumber).toBe(payload.grn_number);
});
