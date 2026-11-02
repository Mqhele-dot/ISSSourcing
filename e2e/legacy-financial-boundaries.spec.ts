import {expect,test} from "@playwright/test";
import {pool} from "../server/db";
import {gotoAuthed} from "./test-helpers";
import {requireDisposableE2eDatabase} from "./wave7-helpers";

test.describe("Compatibility financial boundaries",()=>{
  const suffix=String(Date.now());
  const ownType=`owned-boundary-${suffix}`,foreignType=`foreign-boundary-${suffix}`;
  const requisition=`MONEY-BOUNDARY-${suffix}`;
  test.beforeAll(async()=>{
    requireDisposableE2eDatabase();
    // Existing fixtures insert explicit organization IDs without advancing the
    // sequence. Allocate this isolated fixture from existing IDs, not defaults.
    const foreign=await pool.query("INSERT INTO organizations(id,name) SELECT COALESCE(MAX(id),0)+1,$1 FROM organizations RETURNING id",[`Foreign boundary ${suffix}`]);
    await pool.query("INSERT INTO operational_exceptions(organization_id,type,title,status) VALUES(1,$1,'Owned test evidence','open'),($2,$3,'Foreign test evidence','open')",[ownType,foreign.rows[0].id,foreignType]);
    const supplier=await pool.query("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1");
    expect(supplier.rowCount).toBe(1);
    await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,requestor_id,status,supplier_id,currency_code,total_amount,justification,updated_at)
      VALUES(1,$1,1,'PENDING_APPROVAL',$2,'USD',123.45,'Disposable document-currency evidence',now())`,[requisition,supplier.rows[0].id]);
  });

  test("deprecated money is unavailable and exception summaries remain tenant scoped",async({page})=>{
    await gotoAuthed(page,"/analytics/procurement");
    const response=await page.request.get("/api/reports/analytics");
    expect(response.status()).toBe(200);
    const body=await response.json(),data=body.data??body;
    expect(data.spendBySupplier).toEqual([]);
    expect(data.financialMeasures.state).toBe("unavailable");
    expect(data.financialMeasures.summaryEndpoint).toBe("/api/v2/analytics/financial-measures");
    expect(data.warehouseUtilization).toEqual([]);
    expect(data.unavailableMetrics.warehouseUtilization).toContain("capacity");
    expect(data.exceptionSummary.find((row:{type:string})=>row.type===ownType)?.openCount).toBe(1);
    expect(data.exceptionSummary.some((row:{type:string})=>row.type===foreignType)).toBe(false);
  });

  test("procurement compatibility totals cannot relabel original document amounts",async({page})=>{
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    await gotoAuthed(page,"/procurement/overview");
    const response=await page.request.get("/api/v2/procurement/overview");expect(response.status()).toBe(200);
    const body=await response.json(),data=body.data??body;
    expect(data.kpis.spendThisPeriod).toBeNull();expect(data.spendBySupplier).toEqual([]);
    expect(data.financialMeasures.state).toBe("unavailable");
    const row=data.needsAttention.find((value:{number:string})=>value.number===requisition);
    expect(row.currencyCode).toBe("USD");expect(row.amount).toBe("123.45");
    await expect(page.getByRole("columnheader",{name:"Document amount",exact:true})).toBeVisible();
    await expect(page.getByRole("row").filter({hasText:requisition})).toContainText("USD 123.45");
    await expect(page.getByRole("row").filter({hasText:requisition})).not.toContainText("ZAR 123.45");
    expect(errors).toEqual([]);
  });

  test("invalid and unsupported filters fail explicitly instead of being ignored",async({page})=>{
    await gotoAuthed(page,"/analytics/procurement");
    for(const route of ["/api/reports/analytics?from=2026-02-30","/api/reports/analytics?from=2026-10-02&to=2026-10-01","/api/reports/analytics?supplierId=1","/api/analytics/procurement?dateFrom=2026-02-30","/api/analytics/procurement?unexpected=1"]) {
      const response=await page.request.get(route);expect(response.status()).toBe(400);
      expect(await response.text()).not.toMatch(/SELECT |stack|password|postgresql:/);
    }
  });
});
