import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {mkdtemp,readdir,rm,writeFile,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {writeCompactFullDetail} from "../server/modules/exports/compact-full-detail-writer";

const root=await mkdtemp(path.join(os.tmpdir(),"iss-full-detail-test-"));
const common={outputDirectory:root,jobId:31,dataset:"Synthetic ten-year test",observationReference:"frozen-test-observation",schemaVersion:"test-v1",normalizedFilters:{from:"2016-01-01",to:"2025-12-31"},columns:[{key:"id",label:"Identifier",kind:"identifier" as const},{key:"amount",label:"Amount",kind:"decimal" as const},{key:"currency",label:"Currency",kind:"text" as const},{key:"notes",label:"Notes",kind:"text" as const}]};
const count=25000;
const decoded=(value:ExcelJS.CellValue)=>value&&typeof value==="object"&&"richText"in value?value.richText.map(run=>run.text).join(""):value;
async function* rows(){for(let id=0;id<count;id++)yield {id:String(id).padStart(10,"0"),amount:"123456789012345.670000",currency:id%2?"USD":"ZAR",notes:id===0?"=1+1":`Unicode Ω 漢字 😀 ${id}\nOriginal notes`};}
try{
  await writeFile(path.join(root,"unrelated.txt"),"preserve");
  const result=await writeCompactFullDetail({...common,expectedRows:count,rows:rows(),maxRowsPerWorksheet:1001});
  assert.equal(result.processedRows,count);assert.equal(result.sheetCount,25);assert.ok(result.actualBytes<100_000_000);assert.match(result.sha256,/^[a-f0-9]{64}$/);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(result.filePath);
  let observed=0;
  for(const sheet of workbook.worksheets.slice(1)){
    assert.equal(decoded(sheet.getRow(1).getCell(1).value),"Identifier");
    for(let n=2;n<=sheet.rowCount;n++){
      const row=sheet.getRow(n);assert.equal(decoded(row.getCell(1).value),String(observed).padStart(10,"0"));assert.equal(decoded(row.getCell(2).value),"123456789012345.670000");
      assert.equal(decoded(row.getCell(4).value),observed===0?"=1+1":`Unicode Ω 漢字 😀 ${observed}\nOriginal notes`);observed++;
    }
  }
  assert.equal(observed,count);
  if(process.env.COMPACT_TEST_PYTHON){
    const independent=spawnSync(process.env.COMPACT_TEST_PYTHON,["-B","-c",`import openpyxl,sys,json
w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False)
n=0
for sheet in w.worksheets[1:]:
 for row in sheet.iter_rows(min_row=2,max_col=4):
  assert row[0].value==str(n).zfill(10)
  assert row[1].value=='123456789012345.670000'
  assert row[3].value==('=1+1' if n==0 else 'Unicode Ω 漢字 😀 '+str(n)+'\\nOriginal notes')
  assert all(c.data_type!='f' for c in row)
  n+=1
assert n==25000
print(json.dumps({'reader':'openpyxl','verifiedRows':n,'dataWorksheets':len(w.worksheets)-1}))`,result.filePath],{encoding:"utf8"});
    assert.equal(independent.status,0,independent.stderr);console.log(independent.stdout.trim());
  }
  const baseline=(await readdir(root)).sort();
  const one=(notes:string)=>(async function*(){yield {id:"0001",amount:"0.000001",currency:"ZAR",notes};})();
  for(const notes of ["CR\ronly","CRLF\r\ntext"])await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:one(notes)}),/cannot verify lossless/);
  for(const notes of ["x".repeat(32768),"bad\u0000value","bad\u007fvalue","bad\ud800value","\n".repeat(254)])await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:one(notes)}),/cannot be preserved/);
  await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:one("ok"),maxBytesExclusive:300}),/complete export cannot fit/);
  await assert.rejects(writeCompactFullDetail({...common,expectedRows:2,rows:one("ok")}),/incomplete/);
  await assert.rejects(writeCompactFullDetail({...common,expectedRows:0,rows:one("ok")}),/count does not match/);
  await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:(async function*(){yield {id:"1",amount:1.23,currency:"ZAR",notes:"wrong precision"};})()}),/exact source string/);
  await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:(async function*(){throw new Error("Injected capture failure");})()}),/Injected capture failure/);
  const abort=new AbortController();abort.abort();await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:one("ok"),signal:abort.signal}));
  assert.deepEqual((await readdir(root)).sort(),baseline);assert.equal(await readFile(path.join(root,"unrelated.txt"),"utf8"),"preserve");
  const empty=await writeCompactFullDetail({...common,expectedRows:0,rows:(async function*(){})()});assert.equal(empty.processedRows,0);assert.equal(empty.sheetCount,1);
  const blank=await writeCompactFullDetail({...common,expectedRows:3,rows:(async function*(){yield {id:null,amount:null,currency:null,notes:null};yield {id:"0002",amount:null,currency:null,notes:""};yield {id:null,amount:null,currency:null,notes:null};})()});
  const blankBook=new ExcelJS.Workbook();await blankBook.xlsx.readFile(blank.filePath);
  const blankSheet=blankBook.getWorksheet("Data 1")!;assert.equal(blankSheet.rowCount,4);
  for(const n of [2,4])for(let c=1;c<=4;c++)assert.equal(blankSheet.getCell(n,c).value,null);
  assert.equal(decoded(blankSheet.getCell("A3").value),"0002");assert.deepEqual(blankSheet.getCell("D3").value,{richText:[{text:""}]});
  if(process.env.COMPACT_TEST_PYTHON){const independent=spawnSync(process.env.COMPACT_TEST_PYTHON,["-B","-c","import openpyxl,sys; w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False); s=w['Data 1']; rows=list(s.iter_rows(min_row=2,max_row=4,max_col=4,values_only=True)); assert rows[0]==(None,None,None,None); assert rows[1]==('0002',None,None,''); assert rows[2]==(None,None,None,None)",blank.filePath],{encoding:"utf8"});assert.equal(independent.status,0,independent.stderr);}
  console.log(JSON.stringify({status:"passed",sourceRows:observed,dataWorksheets:result.sheetCount,actualXlsxBytes:result.actualBytes,checks:["full detail parity","rollover","exact text","Unicode LF","literal formula text","CR/CRLF refusal","size refusal","count mismatch","unrepresentable values","precision rejection","source failure cleanup","empty source","null row"],limitations:"Raw internal writer remains pending independent validation. CR preservation, native Excel benchmarks and production rollout remain gated."}));
}finally{await rm(root,{recursive:true,force:true});console.log("Removed exact test-owned full-detail workbook directory.");}
