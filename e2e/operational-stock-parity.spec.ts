import {expect,test} from '@playwright/test';
import {pool} from '../server/db';
import {INVENTORY_BASE_SQL} from '../server/modules/inventory/operational-stock-query';
import {gotoAuthed} from './test-helpers';
import {requireDisposableE2eDatabase} from './wave7-helpers';

test('planning and dashboard stock classifications agree with exact operational evidence',async({page})=>{
  test.setTimeout(90000);requireDisposableE2eDatabase();
  await gotoAuthed(page,'/inventory');
  const suffix=Date.now(),ids:number[]=[];
    for(const [label,quantity,threshold,held] of [['legacy',4,10,false],['held',10,10,true],['precision',16777217,16777216,false]] as const) {
      const result=await pool.query(`INSERT INTO inventory_items(organization_id,name,sku,quantity,price,low_stock_threshold,status,safety_hold,created_at,updated_at)
        VALUES(1,$1,$1,$2,1,$3,'active',$4,now()-interval '120 days',now()) RETURNING id`,[`PARITY-${label}-${suffix}`,quantity,threshold,held]);
      ids.push(result.rows[0].id);
    }
    const get=async(path:string)=>{const response=await page.request.get(path);expect(response.status()).toBe(200);const body=await response.json();return body.data??body;};
    const expected=await pool.query(`${INVENTORY_BASE_SQL} SELECT count(*) FILTER(WHERE available<=low_stock_threshold)::int AS low FROM base`,[1]);
    const inventory=await get('/api/v2/inventory?low=1');
    const analytics=await get('/api/analytics/inventory');
    const tower=await get('/api/dashboard/control-tower');
    expect(inventory.summary.lowStock).toBe(expected.rows[0].low);
    expect(analytics.kpis.inventoryHealth.details.lowStock).toBe(expected.rows[0].low);
    expect(tower.kpis.lowStockItems).toBe(expected.rows[0].low);
    const planning=await get('/api/v2/inventory/reorder-suggestions?pageSize=100');
    const legacy=planning.items.find((row:{id:number})=>row.id===ids[0]);
    expect(legacy.availableNow).toBe('4');expect(legacy.suggestedQuantity).toBe('6');expect(legacy.unassignedQuantity).toBe('4');
    expect(planning.items.some((row:{id:number})=>[ids[1],ids[2]].includes(row.id))).toBe(false);
    const slow=await get('/api/v2/inventory/slow-moving?pageSize=100');
    expect(slow.items.find((row:{id:number})=>row.id===ids[1]).availableNow).toBe('0');
    await page.goto('/inventory/reorder',{waitUntil:'load'});
    await expect(page.getByText('Demand-based suggestions')).toBeVisible();
    await expect(page.getByText(/do not confirm quality-eligible stock/)).toBeVisible();
  // Keep held evidence intact. The guarded runner removes the whole test-owned
  // database; fixture cleanup must not bypass stock-quality deletion guards.
});
