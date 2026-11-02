import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {pool} from "../server/db";
import {requireDisposableE2eDatabase} from "./wave7-helpers";
import {gotoAuthed} from "./test-helpers";

test('shipment previews and exports never reveal foreign or unassigned ownership',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID(),number=`SCOPE-${suffix}`,ownTracking=`OWN-${suffix}`,foreignTracking=`FOREIGN-${suffix}`,unknownTracking=`UNASSIGNED-${suffix}`;
  // Test bootstrap owns explicit IDs; do not assume its serial was advanced.
  const organization=(await pool.query("INSERT INTO organizations(id,name) SELECT COALESCE(MAX(id),0)+1,$1 FROM organizations RETURNING id",[`Shipment export scope ${suffix}`])).rows[0].id;
  const order=(await pool.query("INSERT INTO purchase_orders(organization_id,supplier_id,order_number) SELECT 1,id,$1 FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1 RETURNING id",[number])).rows[0].id;
  const rows=await pool.query(`INSERT INTO shipments(organization_id,purchase_order_id,po_number,status,tracking_number,updated_at) VALUES
    (1,$1,$2,'in_transit',$3,clock_timestamp()+interval '1 day'),($4,NULL,$2,'in_transit',$5,clock_timestamp()+interval '1 day'),(NULL,NULL,$2,'in_transit',$6,clock_timestamp()+interval '1 day') RETURNING id`,[order,number,ownTracking,organization,foreignTracking,unknownTracking]);
  try{
    await gotoAuthed(page,'/analytics/export-center');
    const csrf=await (await page.request.get('/api/csrf-token')).json(),headers={'X-CSRF-Token':csrf.csrfToken??csrf.data?.csrfToken};
    for(const endpoint of [`/api/logistics/shipments?po=${encodeURIComponent(number)}`,`/api/v2/logistics/shipments?q=${encodeURIComponent(number)}&pageSize=100`]){
      const response=await page.request.get(endpoint);expect(response.status()).toBe(200);
      const body=JSON.stringify(await response.json());expect(body).toContain(ownTracking);expect(body).not.toContain(foreignTracking);expect(body).not.toContain(unknownTracking);
    }
    for(const shipment of rows.rows.slice(1)){
      expect((await page.request.get(`/api/logistics/shipments/${shipment.id}`)).status()).toBe(404);
      expect((await page.request.get(`/api/logistics/shipments/${shipment.id}/delivery-note.pdf`)).status()).toBe(404);
      expect((await page.request.patch(`/api/logistics/shipments/${shipment.id}`,{headers,data:{trackingNumber:'FORBIDDEN_CHANGE'}})).status()).toBe(404);
      expect((await page.request.delete(`/api/logistics/shipments/${shipment.id}`,{headers})).status()).toBe(404);
    }
    expect((await pool.query('SELECT count(*)::int n FROM shipments WHERE id=ANY($1::int[])',[rows.rows.map(row=>row.id)])).rows[0].n).toBe(3);
    for(const dataset of ['shipments','po_delivery_comparison']){
      for(const endpoint of ['/api/export-center/custom-preview','/api/reports/preview']){
        const response=await page.request.post(endpoint,{headers,data:{dataset,limit:100,pageSize:100}});expect(response.status()).toBe(200);
        const body=JSON.stringify(await response.json());expect(body).toContain(ownTracking);expect(body).not.toContain(foreignTracking);expect(body).not.toContain(unknownTracking);
      }
      const response=await page.request.post('/api/export-center/custom-export',{headers,data:{dataset,reportName:'scope-test',format:'csv'}});expect(response.status()).toBe(200);
      const binary=await response.body(),content=response.headers()['content-type']?.includes('gzip')?gunzipSync(binary).toString('utf8'):binary.toString('utf8');
      expect(content).toContain(ownTracking);expect(content).not.toContain(foreignTracking);expect(content).not.toContain(unknownTracking);
    }
    expect((await pool.query('SELECT organization_id FROM shipments WHERE tracking_number=$1',[unknownTracking])).rows[0].organization_id).toBeNull();
    await gotoAuthed(page,'/operations/logistics');
    await page.getByTestId('logistics-tracking-filter').fill(ownTracking);
    const visible=page.getByTestId('logistics-shipment-row');await expect(visible).toHaveCount(1,{timeout:20000});
    await expect(visible).toContainText(ownTracking);await visible.click();
    await expect(page.getByTestId('logistics-detail-summary')).toBeVisible({timeout:20000});
    expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('shipment-export-scope.png'),fullPage:true});
  }finally{
    await pool.query('DELETE FROM shipments WHERE id=ANY($1::int[])',[rows.rows.map(row=>row.id)]);await pool.query('DELETE FROM purchase_orders WHERE id=$1 AND organization_id=1',[order]);
    // The guarded runner drops the entire test-owned database. Do not cascade
    // away any diagnostic/audit history a worker may have attached to this org.
  }
});
