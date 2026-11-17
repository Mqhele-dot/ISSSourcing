import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {compactLiteralText} from '../server/modules/exports/compact-literal-text';
import {writeCompactFullDetail} from '../server/modules/exports/compact-full-detail-writer';
import {validateCompactWorkbook} from '../server/modules/exports/compact-workbook-validation';
import {captureCompactSpool} from '../server/modules/exports/compact-capture-spool';
import {runCompactIsolatedWorker} from '../server/modules/exports/compact-isolated-worker';
const run=process.env.COMPACT_BUILT_MODULE?(await import(pathToFileURL(process.env.COMPACT_BUILT_MODULE).href)).runCompactIsolatedWorker as typeof runCompactIsolatedWorker:runCompactIsolatedWorker;

if(!process.env.COMPACT_TEST_PYTHON)throw new Error('Independent text validation requires COMPACT_TEST_PYTHON with OpenPyXL; no reader gate was skipped.');
const root=await mkdtemp(path.join(os.tmpdir(),'iss-literal-text-'));
const edge:Array<string|null>=['',null,'=1+1','Unicode LF\nΩ漢字😀','literal &amp; <tag> " apostrophe\'','_x000D_','_x000d_','_x005F_','_x005f_','_x005F_x000D_','_x000D__x000A_','prefix_x0A0a_suffix','_X000D_','invalid_xZZZZ_','_x000D_\n_x000A_\tUnicode Ω😀',' _x000D_ ','\\_x000D_','= _x000D_','0'.repeat(24),'_x000D_'.repeat(4681),'_x005F_x000D_'.repeat(2000)];
const values=[...edge,...Array.from({length:65536},(_,i)=>`_x${i.toString(16).padStart(4,'0')}_`),...Array.from({length:65536},(_,i)=>`_x${i.toString(16).toUpperCase().padStart(4,'0')}_`)];
const columns=[{key:'ordinal',label:'Source ordinal',kind:'identifier' as const},{key:'value',label:'Literal _x000A_ text',kind:'text' as const}];
const sourceInformation={notice:'Literal metadata _x000D_ and _x005F_x000D_ remains unchanged.'};
const common={outputDirectory:root,jobId:77,dataset:'Synthetic literal-text proof',observationReference:'literal-text-source',schemaVersion:'v1',normalizedFilters:{example:'_x000D_'},sourceInformation,columns};
const rows=(source:Array<string|null>)=>(async function*(){for(let i=0;i<source.length;i++)yield {ordinal:String(i).padStart(8,'0'),value:source[i]};})();
const decode=(value:ExcelJS.CellValue)=>value&&typeof value==='object'&&'richText'in value?value.richText.map(run=>run.text).join(''):value;
let retain=false;
try{
  for(const value of values)if(value!==null){const runs=compactLiteralText(value).richText;assert.equal(runs.map(run=>run.text).join(''),value);assert.ok(runs.every(run=>!/_x[0-9a-fA-F]{4}_/.test(run.text)));assert.ok(runs.length<=value.length+1);}
  const scope={organizationId:7,actorId:9,dataset:common.dataset,observationReference:common.observationReference,schemaVersion:common.schemaVersion,normalizedFilters:common.normalizedFilters,sourceInformation,columns:columns.map(column=>column.key)};
  const capture=await captureCompactSpool({...scope,root,rows:rows(values)});
  const result=await run({captureDirectory:capture.directory,outputRoot:root,jobId:77,scope,columns});
  assert.equal(result.validationState,'independently_validated');assert.equal(result.validation.verifiedRows,values.length);assert.ok(result.heapLimitBytes<=384*1024*1024);assert.equal(result.credentialEnvironmentPresent,false);
  const proof=await validateCompactWorkbook({...common,filePath:result.filePath,expectedSha256:result.sha256,expectedRows:values.length,sheetCount:1,rows:rows(values)});assert.equal(proof.verifiedRows,values.length);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(result.filePath);const sheet=workbook.getWorksheet('Data 1')!;
  assert.equal(sheet.rowCount,values.length+1);assert.equal(decode(sheet.getCell('B1').value),columns[1].label);
  for(let i=0;i<values.length;i++)assert.equal(decode(sheet.getCell(i+2,2).value),values[i],`ExcelJS row ${i}`);
  const expectedFile=path.join(root,'expected.json');await writeFile(expectedFile,JSON.stringify(values));
  const python=spawnSync(process.env.COMPACT_TEST_PYTHON,['-B','-c',`import openpyxl,json,sys
expected=json.load(open(sys.argv[2],encoding='utf-8'))
w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False)
s=w['Data 1']
n=0
for row in s.iter_rows(min_row=2,max_col=2):
 assert row[0].value==str(n).zfill(8)
 assert row[1].value==expected[n],(n,row[1].value,expected[n])
 assert row[1].data_type!='f'
 n+=1
assert n==len(expected)
assert s.cell(1,2).value=='Literal _x000A_ text'
info=dict(w['Export information'].iter_rows(max_col=2,values_only=True))
assert info['Source information: notice']=='Literal metadata _x000D_ and _x005F_x000D_ remains unchanged.'
print(json.dumps({'reader':'openpyxl','verifiedRows':n}))`,result.filePath,expectedFile],{encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);console.log(python.stdout.trim());
  for(const value of ['CR\ronly','CRLF\r\nvalue'])await assert.rejects(writeCompactFullDetail({...common,expectedRows:1,rows:rows([value])}),/carriage returns/);
  if(process.env.COMPACT_KEEP_NATIVE_FIXTURE==='1'){
    const native=await writeCompactFullDetail({...common,jobId:78,expectedRows:edge.length,rows:rows(edge)});
    await validateCompactWorkbook({...common,filePath:native.filePath,expectedSha256:native.sha256,expectedRows:edge.length,sheetCount:1,rows:rows(edge)});
    await writeFile(path.join(root,'native-expected.json'),JSON.stringify(edge));retain=true;
    console.log(JSON.stringify({nativeFixture:native.filePath,testOwnedRoot:root,rows:edge.length,notice:'Synthetic workbook only; no macros, formulas, external links or business data. Close without saving before exact-root cleanup.'}));
  }
  console.log(JSON.stringify({status:'passed',mode:process.env.COMPACT_BUILT_MODULE?'built-runtime':'source',rows:values.length,completeHexSpace:65536,hexVariants:'lowercase and uppercase',actualXlsxBytes:result.actualBytes,heapLimitBytes:result.heapLimitBytes,readers:['ExcelJS','OpenPyXL','independent ZIP/XML'],checks:['credential-free bounded child','unchanged literal escapes','overlapping and adjacent escapes','mixed-case hex','maximum-length strings','Unicode/LF/tab/entities','null versus empty','metadata/header/filters','literal formula text','CR/CRLF refusal'],limitations:'Native Excel compatibility/performance and CR preservation remain separate gates. Public Compact stays disabled.'}));
}finally{if(!retain){await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned literal-text root.');}}
