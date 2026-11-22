import { expect,test,type Page } from "@playwright/test";
import { gotoAuthed, readBrowserApi } from "./test-helpers";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { pool } from "../server/db";

async function orderedSummary(page:Page,supplierId?:number) {
  const response=await readBrowserApi(page, `/api/v2/analytics/financial-measures?measure=ordered${supplierId?`&supplierId=${supplierId}`:""}`);
  expect(response.status()).toBe(200);
  const body=await response.json();
  return body.data??body;
}

test("financial consumers preserve shared amounts and explicitly separate unsupported scopes",async({page})=>{
  test.setTimeout(120_000);
  requireDisposableE2eDatabase();
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await gotoAuthed(page,"/procurement/overview");
  page.on("console",message=>{if(message.type()==="error") errors.push(message.text());});
  const baseline=await orderedSummary(page);
  const amount=baseline.amount===null?"Unavailable":`${baseline.currencyCode} ${baseline.amount}`;
  for(const route of ["/procurement/overview","/operations/control-tower","/procurement/orders"]) {
    await page.goto(route,{waitUntil:"load"});
    const card=page.getByTestId("financial-measure-ordered");
    await expect(card.getByText(amount,{exact:true}).first()).toBeVisible({timeout:25_000});
    await card.getByRole("button",{name:"Why this number?"}).click();
    await expect(card.getByText(`${baseline.includedCount} included; ${baseline.excludedCount} excluded.`,{exact:false})).toBeVisible();
    await expect(card.getByRole("table")).toBeVisible();
  }
  await page.goto("/procurement/orders?q=PO-FQA",{waitUntil:"load"});
  await expect(page.getByText(/Financial totals are hidden while list search/)).toBeVisible({timeout:25_000});
  await expect(page.getByTestId("financial-measure-ordered")).toHaveCount(0);
  const supplier=await pool.query("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1");
  expect(supplier.rowCount).toBe(1);
  const supplierId=Number(supplier.rows[0].id);
  const scoped=await orderedSummary(page,supplierId);
  const agingResponse=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.pathname==="/api/v2/ap/aging"&&url.searchParams.get("supplierId")===String(supplierId)
      &&response.request().method()==="GET";
  },{timeout:25_000});
  await page.goto(`/procurement/suppliers/${supplierId}`,{waitUntil:"load"});
  const aging=await agingResponse;
  const agingBody=await aging.json();
  expect(aging.status(),`Supplier AP Aging request ${aging.headers()["x-request-id"]??"unknown"}`).toBe(200);
  expect(agingBody.data.measures.map((measure:{measure:string})=>measure.measure).sort()).toEqual(["ap_disputed","ap_outstanding","ap_unapproved"]);
  expect(agingBody.data.measures.every((measure:{normalizedFilters:{supplierId:number}})=>measure.normalizedFilters.supplierId===supplierId)).toBe(true);
  await expect(page.getByTestId("financial-measure-ordered").getByText(scoped.amount===null?"Unavailable":`${scoped.currencyCode} ${scoped.amount}`,{exact:true}).first()).toBeVisible({timeout:25_000});
  expect(scoped.normalizedFilters).toEqual({supplierId});
  expect(errors).toEqual([]);
});

test('legacy Analytics responses do not expose ten unsupported financial output paths',async({page})=>{
  test.setTimeout(90000);requireDisposableE2eDatabase();await gotoAuthed(page,'/analytics/procurement');
  const response=await readBrowserApi(page, '/api/analytics/procurement');expect(response.status()).toBe(200);
  const wrapped=await response.json(),data=wrapped.data??wrapped;
  expect(data.kpis.procurementSpend.value).toBe('Unavailable');
  expect(data.kpis.apExposure.value).toBe('Unavailable');
  expect(data.kpis.openPurchaseOrders.details).not.toHaveProperty('value');
  expect(data.charts.spendBySupplier).toEqual([]);
  expect(data.charts.spendByCategory).toEqual([]);
  expect(data.charts.apAging.every((row:Record<string,unknown>)=>!('amount' in row))).toBe(true);
  expect(data.charts.supplierRisk.every((row:Record<string,unknown>)=>!('amount' in row))).toBe(true);
  expect(data.tables.highRiskSuppliers.rows.every((row:Record<string,unknown>)=>!('exposure' in row))).toBe(true);
  expect(data.tables.overdueInvoices.rows.every((row:Record<string,unknown>)=>!('amount' in row))).toBe(true);
  expect(data.meta.financialMeasureNotice).toContain('shared reporting-currency measures');
  await expect(page.getByTestId('analytics-spend-by-supplier-chart')).toContainText('Unavailable until this breakdown uses dated reporting-currency evidence');
  await expect(page.getByTestId('analytics-spend-by-category-chart')).toContainText('Mixed-currency totals are not displayed');
});
