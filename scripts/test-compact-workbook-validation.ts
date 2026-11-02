import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeCompactFullDetail} from '../server/modules/exports/compact-full-detail-writer';
import {validateCompactWorkbook} from '../server/modules/exports/compact-workbook-validation';
import {captureCompactSpool,readCompactSpool} from '../server/modules/exports/compact-capture-spool';

if(!process.env.COMPACT_TEST_PYTHON)throw new Error('Independent release validation requires COMPACT_TEST_PYTHON with OpenPyXL; no reader gate was skipped.');
const root=await mkdtemp(path.join(os.tmpdir(),'iss-independent-validation-'));
const columns=[{key:'id',label:'ID',kind:'identifier' as const},{key:'value',label:'Value',kind:'text' as const}];
const scope={organizationId:3,actorId:7,dataset:'synthetic',observationReference:'validation-source',schemaVersion:'v1',normalizedFilters:{from:'2016-01-01'},columns:columns.map(c=>c.key),sourceInformation:{basis:'Stored values; not verified financial measures',unknown:null}};
const values=[null,'','=1+1','literal &amp; < > " \'','Unicode Ω漢字😀\nLine','  space  ','000012345678901234567890.000001','_x000D_','_x005F_x000D_'];
const rows=async function*(){for(let i=0;i<5003;i++)yield {id:i%37===0?null:String(i).padStart(12,'0'),value:i%37===0?null:values[i%values.length]};};
try{
  await writeFile(path.join(root,'unrelated.txt'),'preserve');
  const captured=await captureCompactSpool({...scope,root,rows:rows()});
  const capture=await readCompactSpool(captured.directory,scope);
  const workbook=await writeCompactFullDetail({...scope,columns,jobId:55,outputDirectory:root,expectedRows:captured.manifest.rowCount,rows:capture.rows,maxRowsPerWorksheet:1001});
  const input={...scope,columns,filePath:workbook.filePath,expectedSha256:workbook.sha256,expectedRows:5003,sheetCount:6};
  const valid=await validateCompactWorkbook({...input,rows:(await readCompactSpool(captured.directory,scope)).rows});
  assert.equal(valid.verifiedRows,5003);assert.equal(valid.verifiedDataSheets,6);assert.equal(valid.actualBytes,workbook.actualBytes);
  await assert.rejects(validateCompactWorkbook({...input,dataset:'wrong',rows:rows()}));
  await assert.rejects(validateCompactWorkbook({...input,expectedSha256:'0'.repeat(64),rows:rows()}));
  await assert.rejects(validateCompactWorkbook({...input,rows:(async function*(){for await(const row of rows())yield {...row,value:'changed'};})()}));
  await assert.rejects(validateCompactWorkbook({...input,rows:(async function*(){yield {id:'1',value:null};})()}));
  const abort=new AbortController();abort.abort();await assert.rejects(validateCompactWorkbook({...input,rows:rows(),signal:abort.signal}));
  const bytes=await readFile(workbook.filePath),corrupt=path.join(root,'corrupt.xlsx');
  const broken=Buffer.from(bytes);broken[50]^=1;await writeFile(corrupt,broken);
  await assert.rejects(validateCompactWorkbook({...input,filePath:corrupt,rows:rows()}));
  await writeFile(corrupt,bytes.subarray(0,bytes.length-10));await assert.rejects(validateCompactWorkbook({...input,filePath:corrupt,rows:rows()}));
  let adversarialCases=0;
  if(process.env.COMPACT_TEST_PYTHON){
    for(const mode of ['unchanged','formula','external-link','changed-text','duplicate-entry','extra-part','doctype','giant-text','giant-attribute','hidden-sheet','wrong-sheet-link','omitted-row','duplicate-cell','wrong-metadata','changed-scope','repeated-data','foreign-namespace','implicit-empty','wrong-content-type','missing-root-link','unsegmented-escape']){
      const edited=path.join(root,`${mode}.xlsx`);
      const result=spawnSync(process.env.COMPACT_TEST_PYTHON,['-B','-c',`import zipfile,sys,re
source,target,mode=sys.argv[1:]
with zipfile.ZipFile(source) as src,zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as dst:
 for item in src.infolist():
  data=src.read(item.filename)
  if item.filename=='xl/worksheets/sheet2.xml':
   text=data.decode()
   if mode=='formula': text=text.replace('<is>','<f>1+1</f><is>',1)
   if mode=='changed-text': text=text.replace('Unicode','Altered',1)
   if mode=='doctype': text=text.replace('<worksheet','<!DOCTYPE worksheet [<!ENTITY e "bad">]><worksheet',1)
   if mode=='giant-text': text=text.replace('<t>ID</t>','<t>'+'x'*2000000+'</t>',1)
   if mode=='giant-attribute': text=text.replace('<worksheet ','<worksheet bad="'+'x'*2000000+'" ',1)
   if mode=='omitted-row': text=re.sub(r'<row r="3".*?</row>','',text,count=1)
   if mode=='duplicate-cell': text=text.replace('</row>','<c r="A1" t="inlineStr"><is><r><t>ID</t></r></is></c></row>',1)
   if mode=='repeated-data': text=text.replace('</sheetData>','</sheetData><sheetData/>',1)
   if mode=='foreign-namespace': text=text.replace('<sheetData>','<sheetData xmlns="urn:foreign">',1)
   if mode=='implicit-empty': text=text.replace('<is><r><t>ID</t></r></is>','<is/>',1)
   if mode=='unsegmented-escape': text=text.replace('<r><t>_</t></r><r><t>x000D_</t></r>','<r><t>_x000D_</t></r>',1)
   data=text.encode()
  if item.filename=='xl/worksheets/sheet1.xml' and mode=='wrong-metadata': data=data.replace(b'validation-source',b'wrong-source')
  if item.filename=='xl/worksheets/sheet1.xml' and mode=='changed-scope': data=data.replace(b'Every captured record',b'Only sampled records')
  if item.filename=='xl/workbook.xml' and mode=='hidden-sheet': data=data.replace(b'name="Data 1"',b'state="hidden" name="Data 1"')
  if item.filename=='[Content_Types].xml' and mode=='wrong-content-type': data=data.replace(b'spreadsheetml.sheet.main+xml',b'spreadsheetml.unsupported+xml')
  if item.filename=='_rels/.rels' and mode=='missing-root-link': data=re.sub(b'<Relationship Id="rId1"[^>]+/>',b'',data,count=1)
  if item.filename=='xl/_rels/workbook.xml.rels':
   if mode=='external-link': data=data.replace(b'Target="worksheets/sheet2.xml"',b'TargetMode="External" Target="https://example.invalid/"')
   if mode=='wrong-sheet-link': data=data.replace(b'Target="worksheets/sheet2.xml"',b'Target="worksheets/sheet3.xml"')
  dst.writestr(item.filename,data)
 if mode=='duplicate-entry': dst.writestr('xl/workbook.xml',src.read('xl/workbook.xml'))
 if mode=='extra-part': dst.writestr('xl/vbaProject.bin',b'not-allowed')
`,workbook.filePath,edited,mode],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      // A fresh supplied digest must NOT make a malformed or altered workbook
      // pass. These cases exercise XML/package/parity checks, not final hashing.
      const editedHash=createHash('sha256').update(await readFile(edited)).digest('hex');
      if(mode==='unchanged')assert.equal((await validateCompactWorkbook({...input,filePath:edited,expectedSha256:editedHash,rows:rows()})).verifiedRows,5003);
      else{await assert.rejects(validateCompactWorkbook({...input,filePath:edited,expectedSha256:editedHash,rows:rows()}),mode);adversarialCases++;}
    }
    const independent=spawnSync(process.env.COMPACT_TEST_PYTHON,['-B','-c',`import openpyxl,sys,json
w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False)
n=0
values=json.loads(sys.argv[2])
for s in w.worksheets[1:]:
 for r in s.iter_rows(min_row=2,max_col=2):
  assert r[0].value==(None if n%37==0 else str(n).zfill(12))
  assert r[1].value==(None if n%37==0 else values[n%len(values)])
  assert all(c.data_type!='f' for c in r)
  n+=1
assert n==5003
print(json.dumps({'reader':'openpyxl','rows':n}))`,workbook.filePath,JSON.stringify(values)],{encoding:'utf8'});
    assert.equal(independent.status,0,independent.stderr);console.log(independent.stdout.trim());
  }
  for(const sample of [[],[{id:null,value:null}],[{id:null,value:''},{id:null,value:null},{id:null,value:''}]]){
    const source=async function*(){yield*sample;};
    const workbook=await writeCompactFullDetail({...scope,columns,jobId:56,outputDirectory:root,expectedRows:sample.length,rows:source()});
    const proof=await validateCompactWorkbook({...input,filePath:workbook.filePath,expectedSha256:workbook.sha256,expectedRows:sample.length,sheetCount:1,rows:source()});assert.equal(proof.verifiedRows,sample.length);
  }
  // The validator is read-only; it neither extracts ZIP members nor creates files.
  assert.equal(await readFile(path.join(root,'unrelated.txt'),'utf8'),'preserve');
  console.log(JSON.stringify({status:'passed',rows:valid.verifiedRows,sheets:valid.verifiedDataSheets,adversarialCases,checks:['independent ZIP/XML parser','CRC and structural boundaries','literal text/null/empty rows','capture parity','source metadata','hash','corruption/truncation','cancellation','no extraction'],filesInTestRoot:(await readdir(root)).length,limitations:'Native Excel benchmarks, CR/escape text support and public export workflow remain pending.'}));
}finally{await rm(root,{recursive:true,force:true});console.log('Removed exact independent-validation test directory.');}
