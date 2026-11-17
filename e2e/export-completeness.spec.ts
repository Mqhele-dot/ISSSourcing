import {test,expect} from "@playwright/test";
import {pool} from "../server/db";
import {gotoAuthed} from "./test-helpers";
import {requireDisposableE2eDatabase} from "./wave7-helpers";

test("quick purchasing exports include 10,000 rows or refuse rather than silently truncate",async({page})=>{
  test.setTimeout(120_000);requireDisposableE2eDatabase();
  await gotoAuthed(page,"/analytics/export-center");
  const order=(await pool.query(`SELECT po.id FROM purchase_orders po WHERE po.organization_id=1
    AND EXISTS(SELECT 1 FROM purchase_order_items i WHERE i.order_id=po.id) ORDER BY po.id LIMIT 1`)).rows[0];
  expect(order).toBeTruthy();
  const countRows=async()=>Number((await pool.query(`SELECT count(*)::text AS count FROM purchase_orders po
    LEFT JOIN purchase_order_items i ON i.order_id=po.id WHERE po.organization_id=1`)).rows[0].count);
  const before=await countRows();expect(before).toBeLessThan(10_000);
  const ids:number[]=[];
  const insert=async(count:number)=>{
    const result=await pool.query(`INSERT INTO purchase_order_items(order_id,line_number,line_type,description,quantity,unit_price,total_price)
      SELECT $1,100000+$3::int+n,'NON_STOCK','Disposable export completeness proof',1,1,1 FROM generate_series(1,$2::int) n RETURNING id`,[order.id,count,ids.length]);
    ids.push(...result.rows.map(row=>Number(row.id)));
  };
  try{
    await insert(10_000-before);expect(await countRows()).toBe(10_000);
    const complete=await page.request.get("/api/export/purchase_orders/csv");
    expect(complete.status()).toBe(200);expect(complete.headers()["x-export-row-count"]).toBe("10000");
    await insert(1);expect(await countRows()).toBe(10_001);
    const refused=await page.request.get("/api/export/purchase_orders/csv");
    expect(refused.status()).toBe(422);expect(refused.headers()["content-type"]).toContain("application/json");
    expect(JSON.stringify(await refused.json())).toContain("EXPORT_SCOPE_TOO_LARGE");
    expect(refused.headers()["content-disposition"]).toBeUndefined();
    const token=await (await page.request.get("/api/csrf-token")).json();
    const custom=await page.request.post("/api/export-center/custom-export",{headers:{"X-CSRF-Token":token.csrfToken??token.data?.csrfToken},data:{dataset:"purchase_orders",format:"csv",reportName:"Disposable completeness proof"}});
    expect(custom.status()).toBe(422);expect(JSON.stringify(await custom.json())).toContain("No partial export");
    expect(custom.headers()["content-disposition"]).toBeUndefined();
  }finally{
    if(ids.length)await pool.query("DELETE FROM purchase_order_items WHERE order_id=$1 AND id=ANY($2::int[])",[order.id,ids]);
    expect(await countRows()).toBe(before);
  }
});
