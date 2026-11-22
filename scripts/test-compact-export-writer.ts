import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createGunzip} from "node:zlib";
import {createInterface} from "node:readline";
import os from "node:os";
import path from "node:path";
import {writeCompactExportFiles} from "../server/modules/exports/compact-export-writer";

const root=await mkdtemp(path.join(os.tmpdir(),"iss-compact-writer-test-"));
const common={outputDirectory:root,jobId:23,snapshotReference:"test-frozen-observation",dataset:"synthetic source rows",groupColumns:[{key:"month",label:"Month"},{key:"currencyCode",label:"Currency"}]};
try{
  await writeFile(path.join(root,"unrelated.txt"),"preserve");
  const started=Date.now();
  async function* records(){for(let id=0;id<100_000;id++)yield {id:String(id).padStart(8,"0"),month:`${2016+id%10}-01`,currencyCode:id%2?"USD":"ZAR",amount:"123456789012345.670000",note:"=HYPERLINK(\"https://example.invalid\")",details:"Full original record ".repeat(8)};}
  const result=await writeCompactExportFiles({...common,rows:records()});
  assert.equal(result.sourceRowCount,100_000);assert.equal(result.groupCount,10);assert.ok(result.summarySize<100_000_000);
  let count=0,metadata=false,completion=false;
  const lines=createInterface({input:createReadStream(result.archivePath).pipe(createGunzip()),crlfDelay:Infinity});
  for await(const line of lines){
    const entry=JSON.parse(line);
    if(entry.type==="metadata"){metadata=true;assert.equal(entry.snapshotReference,result.snapshotReference);}
    else if(entry.type==="completion"){completion=true;assert.equal(entry.sourceRowCount,100_000);}
    else{assert.equal(entry.ordinal,++count);assert.equal(entry.data.id,String(count-1).padStart(8,"0"));assert.equal(entry.data.amount,"123456789012345.670000");}
  }
  assert.equal(count,100_000);assert.ok(metadata&&completion);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(result.summaryPath);
  assert.equal(workbook.getWorksheet("Export evidence")!.getCell("B2").value,result.snapshotReference);
  const sheet=workbook.getWorksheet("Summary")!;
  let total=0;sheet.eachRow((row,n)=>{if(n>1)total+=Number(row.getCell(3).value);});assert.equal(total,count);
  const formula=await writeCompactExportFiles({...common,groupColumns:[{key:"name",label:"Name"}],rows:(async function*(){yield {name:"=1+1",amount:"0.000001"};})()});
  const safe=new ExcelJS.Workbook();await safe.xlsx.readFile(formula.summaryPath);assert.equal(safe.getWorksheet("Summary")!.getCell("A2").value,"=1+1");
  const before=(await readdir(root)).sort();
  await assert.rejects(writeCompactExportFiles({...common,maxSummaryBytesExclusive:100_000_001,rows:records()}),/at most 100 MB/);
  await assert.rejects(writeCompactExportFiles({...common,maxSummaryBytesExclusive:300,rows:(async function*(){yield {month:"one"};})()}),/size limit/);
  await assert.rejects(writeCompactExportFiles({...common,rows:(async function*(){yield {month:"ok"};throw new Error("Injected source failure");})()}),/Injected source failure/);
  await assert.rejects(writeCompactExportFiles({...common,rows:(async function*(){yield {amount:NaN};})()}),/finite scalar/);
  await assert.rejects(writeCompactExportFiles({...common,rows:(async function*(){yield {month:"x".repeat(32768)};})()}),/cell limit/);
  await assert.rejects(writeCompactExportFiles({...common,rows:(async function*(){for(let i=0;i<10001;i++)yield {month:String(i)};})()}),/too many groups/);
  await assert.rejects(writeCompactExportFiles({...common,rows:(async function*(){for(let i=0;i<300;i++)yield {month:String(i)+"x".repeat(32000)};})()}),/too much memory/);
  const abort=new AbortController();
  await assert.rejects(writeCompactExportFiles({...common,signal:abort.signal,rows:(async function*(){for(let i=0;i<100;i++){if(i===10)abort.abort();yield {month:"one"};}})()}));
  assert.deepEqual((await readdir(root)).sort(),before);assert.equal(await readFile(path.join(root,"unrelated.txt"),"utf8"),"preserve");
  const empty=await writeCompactExportFiles({...common,rows:(async function*(){})()});assert.equal(empty.sourceRowCount,0);assert.equal(empty.groupCount,0);
  console.log(JSON.stringify({status:"passed",syntheticSourceRows:count,summaryBytes:result.summarySize,archiveBytes:result.archiveSize,elapsedMs:Date.now()-started,checks:["full-detail parity","exact decimal strings","literal formula-like text","bounded grouping","source failure cleanup","abort cleanup","empty source"],limitations:"File-generation test only; no production source capture, native Excel memory benchmark or release sign-off."}));
}finally{await rm(root,{recursive:true,force:true});console.log("Removed exact test-owned compact-writer directory.");}
