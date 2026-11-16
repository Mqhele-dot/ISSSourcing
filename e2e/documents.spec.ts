import { expect, test } from "@playwright/test";
import { gotoAuthed, readBrowserApi } from "./test-helpers";
import { pool } from "../server/db";
import { requireDisposableE2eDatabase,loginAsSeededUser } from "./wave7-helpers";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {documentsDir} from "../server/http/upload-config";
import {createHash,randomUUID} from "node:crypto";
import {appendAuditEventWithClient} from "../server/services/audit-chain-client";
import {DOCUMENT_UPLOAD_ACTION} from "../server/modules/documents/document-evidence";
import {documentLibraryHref} from "../shared/document-query";

test.describe("Documents workspace", () => {
  test("uploads and archives a document through the governed workflow", async ({ page }) => {
    // Includes cold authenticated navigation and the full upload/archive chain.
    // This is not the server-readiness or a per-assertion performance budget.
    test.setTimeout(60_000);
    const stamp = Date.now();
    requireDisposableE2eDatabase();
    const order = await pool.query<{ id: number }>("SELECT id FROM purchase_orders WHERE organization_id=1 ORDER BY id LIMIT 1");
    expect(order.rows[0]).toBeTruthy();
    const entityId = String(order.rows[0].id);
    const fileName = `playwright-doc-${stamp}.txt`;

    await gotoAuthed(page, "/admin/documents");
    await expect(page.getByRole("heading", { name: "Documents", exact: true, level: 1 })).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Entity ID").first().fill(entityId);
    await page.getByLabel("File").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Document workflow proof ${stamp}`, "utf8"),
    });

    await page.getByRole("button", { name: /^Upload\.\.\.$/ }).click();
    await expect(page.getByRole("dialog", { name: /process document/i })).toBeVisible();
    await page.getByRole("button", { name: /confirm upload/i }).click();

    await expect(page.getByText("Document version was saved successfully.", { exact: true })).toBeVisible();

    await page.getByText("Filter by entity type", { exact: true }).locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Purchase order" }).click();
    await page.getByLabel("Entity ID").nth(1).fill(entityId);
    await page.getByRole("textbox", { name: "Search", exact: true }).fill(fileName);

    const row = page.getByText(fileName, { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText(/Active/).first()).toBeVisible();

    await page.getByRole("button", { name: /archive/i }).click();
    await page.getByRole("dialog", { name: "Archive document?" }).getByRole("button", { name: "Archive document" }).click();
    await expect(page.getByText("Document archived", { exact: true })).toBeVisible();
    await expect(row).toHaveCount(0);

    await page.getByRole("dialog", { name: "Archive document?" }).getByRole("button", { name: "Close" }).click();
    await page.getByText("Archive state", { exact: true }).locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Archived only" }).click();
    await expect(page.getByText(fileName)).toBeVisible();
    await expect(page.getByText(/Archived/).first()).toBeVisible();
  });
});

test("Supplier document choices search and page beyond 100 while exact links preserve context",async({page},testInfo)=>{
  test.setTimeout(240000);requireDisposableE2eDatabase();
  expect(path.resolve(documentsDir)).toBe(path.join(path.resolve(process.env.TEST_UPLOADS_DIR!),"documents"));
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await gotoAuthed(page,"/admin/documents");
  const stamp=Date.now(),prefix=`Choice-${stamp}`,bytes=Buffer.from("SYNTHETIC DOCUMENT NAVIGATION FIXTURE");
  const supplier=(await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id",[`Document navigation ${stamp}`])).rows[0].id;
  // Synthetic, test-owned fixture only. Real files and canonical audit proofs let
  // the production reader exercise more than 100 available choices. No backfill.
  const fixtures=[];
  for(let index=0;index<125;index++){
    const stored=`navigation-${randomUUID()}.txt`;
    await writeFile(path.join(documentsDir,stored),bytes);
    fixtures.push({file_name:`${prefix}-${String(index).padStart(3,"0")}.txt`,file_url:`/uploads/documents/${stored}`,checksum:createHash("sha256").update(bytes).digest("hex"),uploaded_at:new Date(Date.UTC(2025,0,1)+index*1000).toISOString()});
  }
  const client=await pool.connect();let records:{id:number;file_name:string;file_url:string;checksum:string}[];
  try{
    await client.query("BEGIN");
    records=(await client.query(`INSERT INTO documents(organization_id,entity_type,entity_id,file_url,file_name,mime_type,file_size,checksum,version,uploaded_by,uploaded_at)
      SELECT 1,'supplier',$1,x.file_url,x.file_name,'text/plain',$2,x.checksum,1,1,x.uploaded_at
      FROM jsonb_to_recordset($3::jsonb) x(file_url text,file_name text,checksum text,uploaded_at timestamp) RETURNING id,file_name,file_url,checksum`,[supplier,bytes.length,JSON.stringify(fixtures)])).rows;
    for(const record of records)await appendAuditEventWithClient(client,{organizationId:1,actor:{userId:1},action:DOCUMENT_UPLOAD_ACTION,resourceType:"document",resourceId:record.id,
      details:{fileUrl:record.file_url,fileSize:bytes.length,sha256:record.checksum,entityType:"supplier",entityId:supplier,fileName:record.file_name,mimeType:"text/plain"},requestId:"synthetic-navigation-fixture"});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  const oldest=records.find(row=>row.file_name.endsWith("-000.txt"))!,newest=records.find(row=>row.file_name.endsWith("-124.txt"))!;
  const digest=async()=>(await pool.query("SELECT md5(string_agg(row_to_json(d)::text,',' ORDER BY id)) AS value FROM documents d WHERE organization_id=1 AND entity_type='supplier' AND entity_id=$1",[supplier])).rows[0].value;
  const before=await digest();
  await page.goto(`/procurement/suppliers/${supplier}`,{waitUntil:"load"});
  const search=page.getByLabel("Find supplier documents"),picker=page.getByLabel("Related document (optional)");
  await search.fill(prefix);await expect(page.getByText("125 available files · Page 1",{exact:true})).toBeVisible();
  await expect(picker.locator("option")).toHaveCount(26);
  for(let next=0;next<4;next++){await page.getByRole("button",{name:"Next document choices",exact:true}).click();await expect(page.getByText(`125 available files · Page ${next+2}`,{exact:true})).toBeVisible();}
  await picker.selectOption(String(oldest.id));await expect(page.getByTestId("supplier-selected-document")).toContainText(oldest.file_name);
  await search.fill(newest.file_name);await expect(page.getByText("1 available files · Page 1",{exact:true})).toBeVisible();await expect(picker).toHaveValue(String(oldest.id));
  await expect(page.getByTestId("supplier-selected-document")).toContainText(oldest.file_name);
  const summary=`Reviewed the older supplier evidence ${stamp}`;await page.getByLabel("Contact summary").fill(summary);
  const failDocuments=async(route:import("@playwright/test").Route)=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Synthetic document service interruption"})});
  await page.route("**/api/v2/documents?**",failDocuments);await search.fill("Synthetic retry filter");
  await expect(page.getByText(/selected attachment cannot be rechecked/)).toBeVisible();await expect(page.getByRole("button",{name:"Save contact note",exact:true})).toBeDisabled();await expect(page.getByLabel("Contact summary")).toHaveValue(summary);
  await page.unroute("**/api/v2/documents?**",failDocuments);await page.getByRole("button",{name:"Retry documents",exact:true}).click();
  await expect(page.getByText("0 available files · Page 1",{exact:true})).toBeVisible();await expect(picker).toHaveValue(String(oldest.id));
  await page.getByTestId("supplier-selected-document").scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("supplier-document-selection.png"),fullPage:false,scale:"css"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  const savedResponse=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname===`/api/v2/suppliers/${supplier}/communications/notes`);
  await page.getByRole("button",{name:"Save contact note",exact:true}).click();
  const saved=await savedResponse;expect(saved.status()).toBe(201);
  const savedBody=await saved.json();
  const persisted=(await pool.query("SELECT document_id,summary,channel FROM supplier_communication_notes WHERE organization_id=1 AND supplier_id=$1 AND id=$2",[supplier,savedBody.data.id])).rows[0];
  expect(persisted).toMatchObject({document_id:oldest.id,summary,channel:"phone"});
  await expect(page.getByText(`phone: ${summary}`,{exact:true})).toBeVisible();
  const related=page.getByRole("link",{name:"View related document",exact:true});const href=documentLibraryHref("supplier",supplier,oldest.id);
  await expect(related).toHaveAttribute("href",href);await related.focus();await page.keyboard.press("Enter");
  const oldRow=page.getByTestId(`document-row-${oldest.id}`);await expect(oldRow).toBeFocused();await expect(page.getByRole("textbox",{name:"Entity ID",exact:true}).nth(1)).toHaveValue(String(supplier));await expect(page.getByText(oldest.file_name,{exact:true})).toBeVisible();
  await expect(page.getByTestId(`document-row-${newest.id}`)).toHaveCount(0);
  const newHref=documentLibraryHref("supplier",supplier,newest.id);await page.goto(newHref,{waitUntil:"load"});await expect(page.getByTestId(`document-row-${newest.id}`)).toBeFocused();
  await page.goBack();await expect(oldRow).toBeFocused();await page.goForward();await expect(page.getByTestId(`document-row-${newest.id}`)).toBeFocused();
  expect(await digest()).toBe(before,"Navigation cannot rewrite document evidence.");
  const csrf=await(await readBrowserApi(page, "/api/csrf-token")).json();expect((await page.request.delete(`/api/documents/${oldest.id}`,{headers:{"X-CSRF-Token":csrf.data?.csrfToken??csrf.csrfToken}})).status()).toBe(200);
  await page.goto(href,{waitUntil:"load"});await expect(oldRow).toBeFocused();await expect(oldRow.getByText("Archived",{exact:true})).toBeVisible();
  await oldRow.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("document-context-link.png"),fullPage:false,scale:"css"});
  await page.goto("/admin/documents?documentId=invalid",{waitUntil:"load"});await expect(page.getByRole("alert").filter({hasText:"Document filters are invalid"})).toBeVisible();await expect(page.locator('[data-testid^="document-row-"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Clear all document filters",exact:true}).click();await expect(page).toHaveURL(/\/admin\/documents$/);await expect(page.getByRole("alert").filter({hasText:"Document filters are invalid"})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Document source permissions protect history, files, supplier timelines and portal identities",async({page},testInfo)=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  expect(path.resolve(documentsDir)).toBe(path.join(path.resolve(process.env.TEST_UPLOADS_DIR!),"documents"));
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const supplier=(await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id",[`Document evidence ${Date.now()}`])).rows[0].id;
  const stamp=Date.now(),legacyName=`Legacy-unverified-${stamp}.txt`,legacyPath=`/uploads/documents/legacy-${stamp}.txt`;
  await gotoAuthed(page,"/admin/documents");
  await writeFile(path.join(documentsDir,`legacy-${stamp}.txt`),"SYNTHETIC PRIVATE LEGACY FILE");
  const legacy=(await pool.query("INSERT INTO documents(organization_id,entity_type,entity_id,file_url,file_name) VALUES(1,'supplier',$1,$2,$3) RETURNING id",[supplier,legacyPath,legacyName])).rows[0].id;
  const csrf=async()=>{const body=await(await readBrowserApi(page, "/api/csrf-token")).json();return {"X-CSRF-Token":body.data?.csrfToken??body.csrfToken};};
  expect((await readBrowserApi(page, legacyPath)).status()).toBe(404);expect((await readBrowserApi(page, legacyPath.replace("documents","%64ocuments"))).status()).toBe(404);
  expect((await readBrowserApi(page, `/api/documents/${legacy}/download`)).status()).toBe(409);
  const original=(await pool.query("SELECT row_to_json(d) AS row FROM documents d WHERE organization_id=1 AND id=$1",[legacy])).rows[0].row;
  const uploaded=await page.request.post("/api/documents/upload",{headers:await csrf(),multipart:{entityType:"supplier",entityId:String(supplier),file:{name:`Verified-${stamp}.txt`,mimeType:"text/plain",buffer:Buffer.from("SYNTHETIC VERIFIED SUPPLIER FILE")}}});
  expect(uploaded.status()).toBe(201);const document=await uploaded.json();expect(await(await readBrowserApi(page, `/api/documents/${document.id}/download`)).text()).toBe("SYNTHETIC VERIFIED SUPPLIER FILE");
  await page.reload();await page.getByRole("textbox",{name:"Search",exact:true}).fill(legacyName);
  const legacyRow=page.getByTestId(`document-row-${legacy}`);await expect(legacyRow).toBeVisible();await expect(legacyRow.getByRole("status")).toContainText("unverified");await expect(legacyRow.getByRole("link",{name:"Download",exact:true})).toHaveCount(0);
  await legacyRow.scrollIntoViewIfNeeded();
  const replacement=legacyRow.getByLabel(`Reattach replacement for ${legacyName}`);await replacement.focus();await expect(replacement).toBeFocused();
  const cardBox=await legacyRow.boundingBox();expect(cardBox).not.toBeNull();
  for(const control of [legacyRow.getByRole("button",{name:"Archive",exact:true}),replacement.locator("..")]){
    const box=await control.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(cardBox!.x+cardBox!.width+1);expect(box!.x+box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({path:testInfo.outputPath("document-unverified-source.png"),fullPage:false,scale:"css"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  const viewer=(await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0].id;
  const extra=(await pool.query(`INSERT INTO permissions(role,resource,permission_type) VALUES('viewer','documents','read'),('viewer','suppliers','read'),('viewer','purchases','read') ON CONFLICT DO NOTHING RETURNING id`)).rows.map(row=>row.id);
  let saved:unknown[]=[],savedUserGrants:unknown[]=[];
  try{
    await loginAsSeededUser(page,"viewer",viewer);await page.goto(`/procurement/suppliers/${supplier}`,{waitUntil:"load"});
    await expect(page.getByText(`Verified-${stamp}.txt`,{exact:false}).first()).toBeVisible();
    savedUserGrants=(await pool.query("SELECT row_to_json(p) AS row FROM permissions p WHERE role='viewer' AND resource='users' AND permission_type='read'")).rows.map(row=>row.row);
    await pool.query("DELETE FROM permissions WHERE role='viewer' AND resource='users' AND permission_type='read'");
    expect((await readBrowserApi(page, `/api/suppliers/${supplier}/portal-users`)).status()).toBe(403);
    saved=(await pool.query("SELECT row_to_json(p) AS row FROM permissions p WHERE role='viewer' AND resource='documents' AND permission_type='read'")).rows.map(row=>row.row);
    await pool.query("DELETE FROM permissions WHERE role='viewer' AND resource='documents' AND permission_type='read'");
    for(const endpoint of ["/api/v2/documents",`/api/documents/${document.id}/download`])expect((await readBrowserApi(page, endpoint)).status()).toBe(403);
    const scoped=await(await readBrowserApi(page, `/api/v2/suppliers/${supplier}/communications`)).json();expect(scoped.data.scope.documents).toBe(false);expect(scoped.data.items.some((row:{kind:string})=>row.kind==="document")).toBe(false);expect(JSON.stringify(scoped)).not.toContain(legacyName);
    await page.reload();await expect(page.getByTestId("supplier-history-scope")).toBeVisible();await expect(page.getByText(`Verified-${stamp}.txt`,{exact:false})).toHaveCount(0);
    await page.getByTestId("supplier-history-scope").scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("supplier-restricted-document-scope.png"),fullPage:false,scale:"css"});
    expect((await pool.query("SELECT row_to_json(d) AS row FROM documents d WHERE organization_id=1 AND id=$1",[legacy])).rows[0].row).toEqual(original);
    expect(errors).toEqual([]);
  }finally{
    if(savedUserGrants.length)await pool.query("INSERT INTO permissions SELECT * FROM json_populate_recordset(NULL::permissions,$1::json) ON CONFLICT DO NOTHING",[JSON.stringify(savedUserGrants)]);
    if(saved.length)await pool.query("INSERT INTO permissions SELECT * FROM json_populate_recordset(NULL::permissions,$1::json) ON CONFLICT DO NOTHING",[JSON.stringify(saved)]);
    await pool.query("DELETE FROM permissions WHERE id=ANY($1::int[])",[extra]);
  }
});
