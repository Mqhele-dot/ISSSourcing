import {test,expect} from "@playwright/test";
import {writeFile,readFile} from "node:fs/promises";
import path from "node:path";
import {gzipSync} from "node:zlib";
import {pool} from "../server/db";
import {exportsDir} from "../server/http/upload-config";
import {buildExportFilePath} from "../server/modules/exports/export-file-store";
import {publishExportPair} from "../server/modules/exports/paired-export-artifacts";
import {generateDocument} from "../server/services/document-generator-service";
import {seedCustomPermissionUser} from "../scripts/runtime-fixtures/expanded-security-fixtures";
import {loginAsSeededUser,requireDisposableE2eDatabase} from "./wave7-helpers";
import {gotoAuthed} from "./test-helpers";

test("paired exports download natively, preserve one snapshot and reject corrupted files",async({page})=>{
  test.setTimeout(120_000);requireDisposableE2eDatabase();
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const job=(await pool.query(`INSERT INTO export_jobs(organization_id,created_by,dataset,format,filters,status)
    VALUES(1,1,'purchase_orders','excel','{}','running') RETURNING id`)).rows[0].id;
  const summary=buildExportFilePath(1,job,"summary.xlsx"),archive=buildExportFilePath(1,job,"details.jsonl.gz");
  const rows=[{documentNumber:"PAIR-ONE",lineNumber:1,lineDescription:"Example goods",quantity:2,unitPrice:3,lineTotal:6,currencyCode:"ZAR"}];
  const workbook=await generateDocument("purchase_orders","excel",rows,"Paired export test",{reportingCurrencyCode:"ZAR"});
  const detail=gzipSync(Buffer.from(rows.map(row=>JSON.stringify(row)).join("\n")+"\n"));
  await writeFile(summary.absolutePath,workbook);await writeFile(archive.absolutePath,detail);
  await publishExportPair(pool,{root:exportsDir,organizationId:1,jobId:job,snapshotReference:"browser-owned-pair-observation",sourceRowCount:1,tokenTtlMinutes:30,retentionDays:7,artifacts:[
    {kind:"summary",relativePath:path.relative(exportsDir,summary.absolutePath),fileName:"summary.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    {kind:"archive",relativePath:path.relative(exportsDir,archive.absolutePath),fileName:"details.jsonl.gz",mimeType:"application/gzip"},
  ]});
  await gotoAuthed(page,"/analytics/export-center");
  const card=page.getByTestId(`export-history-job-${job}`);
  await expect(card.getByRole("button",{name:"Summary workbook",exact:true})).toBeVisible();
  await expect(card.getByRole("button",{name:"Full-detail archive",exact:true})).toBeVisible();
  const metadata=await (await page.request.get(`/api/export-jobs/${job}`)).json();
  expect((metadata.data??metadata).artifacts.map((file:{snapshotReference:string})=>file.snapshotReference)).toEqual(["browser-owned-pair-observation","browser-owned-pair-observation"]);
  expect(JSON.stringify((metadata.data??metadata).artifacts)).not.toContain("filePath");
  // Binary files must never be materialized through the app's fetch/Blob path.
  await page.evaluate(()=>{const original=window.fetch;window.fetch=(...args)=>{
    if(String(args[0]).includes("/api/export/download/"))throw new Error("Binary downloads must use the browser download manager");
    return original(...args);
  };});
  for(const [label,expected,name]of [["Summary workbook",workbook,"summary.xlsx"],["Full-detail archive",detail,"details.jsonl.gz"]] as const){
    const refreshed=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/export-jobs/${job}/download-token`);
    const pending=page.waitForEvent("download",{timeout:30000});pending.catch(()=>undefined);
    await card.getByRole("button",{name:label,exact:true}).click();
    expect((await refreshed).status(),`${label} must be allowed to refresh its retained-file token independently of generation requests`).toBe(200);
    const download=await pending;expect(download.suggestedFilename()).toBe(name);
    const output=test.info().outputPath(name);await download.saveAs(output);expect(await readFile(output)).toEqual(expected);
    await expect(page).toHaveURL(/\/analytics\/export-center$/);
  }
  await page.screenshot({path:test.info().outputPath("paired-export-actions.png"),fullPage:true});
  const token=await (await page.request.get("/api/csrf-token")).json(),headers={"X-CSRF-Token":token.csrfToken??token.data?.csrfToken};
  const [a,b]=await Promise.all([page.request.post(`/api/export-jobs/${job}/download-token`,{headers,data:{artifact:"summary"}}),page.request.post(`/api/export-jobs/${job}/download-token`,{headers,data:{artifact:"archive"}})]);
  expect(a.status()).toBe(200);expect(b.status()).toBe(200);
  const aa=await a.json(),bb=await b.json(),first=aa.data??aa,second=bb.data??bb;
  expect(new URL(first.downloadUrl,"http://localhost").searchParams.get("token")).toBe(new URL(second.downloadUrl,"http://localhost").searchParams.get("token"));
  await writeFile(archive.absolutePath,Buffer.alloc(detail.length,7));
  const corrupt=await page.request.get(second.downloadUrl);expect(corrupt.status()).toBe(409);
  expect(corrupt.headers()["content-type"]).toContain("application/json");
  expect(JSON.stringify(await corrupt.json())).toContain("could not be verified");
  expect(corrupt.headers()["content-disposition"]).toBeUndefined();
  expect((await page.request.get(`${second.downloadUrl}&artifact=unsupported`)).status()).toBe(400);
  await writeFile(archive.absolutePath,detail);
  const other=await seedCustomPermissionUser({label:"Other pair owner",permissions:[{resource:"reports",actions:["read","export"]},{resource:"purchases",actions:["read"]}]});
  await loginAsSeededUser(page,other.username,other.userId);
  expect((await page.request.get(second.downloadUrl)).status()).toBe(404);
  expect(errors).toEqual([]);
});
