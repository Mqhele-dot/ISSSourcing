import {expect,test} from "@playwright/test";
import {pool} from "../server/db";
import {seedCustomPermissionUser} from "../scripts/runtime-fixtures/expanded-security-fixtures";
import {gotoAuthed} from "./test-helpers";
import {loginAsSeededUser,requireDisposableE2eDatabase} from "./wave7-helpers";

test.describe.configure({mode:"serial"});
test.describe("Analytics source permissions and complete totals",()=>{
  let viewer:Awaited<ReturnType<typeof seedCustomPermissionUser>>;
  test.beforeAll(async()=>{
    requireDisposableE2eDatabase();
    viewer=await seedCustomPermissionUser({label:"Analytics reports only",permissions:[{resource:"reports",actions:["read"]}]});
  });
  test("reports-only users cannot query protected sources or see fabricated empty states",async({page})=>{
    await loginAsSeededUser(page,viewer.username,viewer.userId);
    // A missing protected table must not even be queried for this user.
    await pool.query("ALTER TABLE invoices RENAME TO invoices_access_test");
    try {
      const response=await page.request.get("/api/analytics/finance");expect(response.status()).toBe(200);
      const wrapped=await response.json(),data=wrapped.data??wrapped;
      expect(data.meta.partialFailures).toEqual([]);
      expect(data.meta.restrictedSources).toContain("finance");
      expect(data.kpis.systemHealth.value).toBe("Limited access");
      expect(data.kpis.openPurchaseOrders.value).toBe("Unavailable");
      expect(data.kpis.inventoryHealth.value).toBe("Unavailable");
      expect(data.tables.overdueInvoices.rows).toEqual([]);
      expect(data.tables.oldestOpenExceptions.rows).toEqual([]);
      expect(data.charts.invoiceStatus).toEqual([]);
      expect(data.meta.unavailableCharts.apAging).toContain("read access");
      expect(data.filterOptions.suppliers).toEqual([]);expect(data.filterOptions.owners).toEqual([]);
      expect(data.recommendations).toEqual([]);
    }finally{await pool.query("ALTER TABLE invoices_access_test RENAME TO invoices");}
    expect((await page.request.get("/api/reports/analytics")).status()).toBe(403);
    await page.goto("/analytics/finance",{waitUntil:"load"});
    await expect(page.getByText(/your current role does not have read access/).first()).toBeVisible({timeout:25000});
  });
  test("query failures are sanitized and cannot become healthy zero totals",async({page})=>{
    await gotoAuthed(page,"/procurement/orders");
    await pool.query("ALTER TABLE operational_exceptions RENAME TO exceptions_failure_test");
    try {
      const response=await page.request.get("/api/analytics/overview");expect(response.status()).toBe(200);
      const text=await response.text();expect(text).not.toMatch(/does not exist|SELECT |stack|postgresql:/);
      const wrapped=JSON.parse(text),data=wrapped.data??wrapped;
      expect(data.kpis.openExceptions.value).toBe("Unavailable");
      expect(data.kpis.systemHealth.value).toBe("Degraded");
      expect(data.meta.partialFailures.some((row:{area:string})=>row.area==="exceptions")).toBe(true);
      expect(data.meta.unavailableCharts.exceptionsBySeverity).toContain("temporarily unavailable");
    }finally{await pool.query("ALTER TABLE exceptions_failure_test RENAME TO operational_exceptions");}
    const retry=await page.request.get("/api/analytics/overview");expect(retry.status()).toBe(200);
    const body=await retry.json(),data=body.data??body;
    expect(data.meta.partialFailures).toEqual([]);expect(typeof data.kpis.openExceptions.value).toBe("number");
  });
  test("more than 5000 source records produce complete totals and bounded output",async({page})=>{
    test.setTimeout(120000);
    await gotoAuthed(page,"/procurement/orders");
    const suffix=Date.now();
    // Repair only test-fixture sequences before ordinary inserts in this guarded DB.
    await pool.query("SELECT setval(pg_get_serial_sequence('organizations','id'),COALESCE((SELECT max(id) FROM organizations),1),true),setval(pg_get_serial_sequence('organization_members','id'),COALESCE((SELECT max(id) FROM organization_members),1),true)");
    const organization=await pool.query("INSERT INTO organizations(name) VALUES($1) RETURNING id",[`Analytics volume ${suffix}`]);
    const org=organization.rows[0].id;
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,application_role,active,status) VALUES($1,1,'member','admin',true,'active')",[org]);
    const supplier=await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES($1,$2,'active') RETURNING id",[org,`Analytics volume ${suffix}`]);
    const selectOrganization=async(organizationId:number)=>{
      const tokenResponse=await page.request.get("/api/csrf-token"),token=await tokenResponse.json();
      const response=await page.request.post("/api/organization/active",{headers:{"X-CSRF-Token":token.csrfToken??token.data?.csrfToken},data:{organizationId}});
      expect(response.status()).toBe(200);
    };
    await selectOrganization(org);
    try {
    await pool.query(`INSERT INTO invoices(organization_id,supplier_id,invoice_number,currency_code,total,paid_amount,due_amount,status,issue_date,due_date,created_by)
      SELECT $1,$2,'ACCESS-VOLUME-'||$3::text||'-'||g,'ZAR',1,0,1,'APPROVED',now(),now()-interval '2 days',1 FROM generate_series(1,5001) g`,[org,supplier.rows[0].id,suffix]);
    await pool.query(`INSERT INTO shipments(organization_id,po_number,status,eta) SELECT $1,'ACCESS-VOLUME-'||$2::text||'-'||g,'in_transit',now()-interval '2 days' FROM generate_series(1,5001) g`,[org,suffix]);
    await pool.query(`INSERT INTO operational_exceptions(organization_id,type,title,status) SELECT $1,'access_volume','Volume test','open' FROM generate_series(1,5001)`,[org]);
    const expected=await pool.query(`SELECT (SELECT count(*)::int FROM invoices WHERE organization_id=$1) invoices,
      (SELECT count(*)::int FROM operational_exceptions WHERE organization_id=$1 AND status IN ('open','in_progress')) exceptions,
      (SELECT count(*)::int FROM shipments WHERE organization_id=$1 AND eta<now() AND lower(status) NOT IN ('delivered','cancelled')) shipments`,[org]);
    const response=await page.request.get("/api/analytics/overview");expect(response.status()).toBe(200);
    const text=await response.text(),wrapped=JSON.parse(text),data=wrapped.data??wrapped;
    expect(data.meta.partialFailures).toEqual([]);
    expect(data.charts.invoiceStatus.reduce((sum:number,row:{value:number})=>sum+row.value,0)).toBe(expected.rows[0].invoices);
    expect(data.kpis.openExceptions.value).toBe(expected.rows[0].exceptions);
    expect(data.kpis.lateShipments.value).toBe(expected.rows[0].shipments);
    for(const table of Object.values(data.tables) as Array<{rows:unknown[]}>)expect(table.rows.length).toBeLessThanOrEqual(25);
    expect(text.length).toBeLessThan(120000);
    const range=await page.request.get("/api/analytics/overview?dateFrom=2000-01-01&dateTo=2026-01-01");
    const rangeBody=await range.json(),scoped=rangeBody.data??rangeBody;
    expect(scoped.meta.unavailableCharts.operationsTrend).toContain("366 days");
    expect(scoped.meta.partialFailures.some((row:{code:string})=>row.code==="TREND_RANGE_UNSUPPORTED")).toBe(true);
    }finally{await selectOrganization(1);}
  });
});
