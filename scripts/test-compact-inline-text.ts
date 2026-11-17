import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
const root=await mkdtemp(path.join(os.tmpdir(),"iss-text-probe-"));
try{
  const file=path.join(root,"probe.xlsx");
  const values=["",null,"=1+1","Unicode LF\nΩ漢字😀","literal &amp;"];
  const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:file,useSharedStrings:false,useStyles:false});
  const sheet=workbook.addWorksheet("Probe");
  for(let i=0;i<values.length;i++){const value=values[i];sheet.addRow([String(i),value===null?null:{richText:[{text:value}]}]).commit();}
  sheet.commit();await workbook.commit();
  const check=new ExcelJS.Workbook();await check.xlsx.readFile(file);
  const decoded=values.map((_,i)=>{const value=check.worksheets[0].getCell(i+1,2).value;return value&&typeof value==="object"&&"richText"in value?value.richText.map(run=>run.text).join(""):value;});
  console.log(JSON.stringify({reader:"exceljs",decoded}));assert.deepEqual(decoded,values);
  if(process.env.COMPACT_TEST_PYTHON){const result=spawnSync(process.env.COMPACT_TEST_PYTHON,["-B","-c","import openpyxl,json,sys; w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False); print(json.dumps([r[1].value for r in w.active.iter_rows(max_col=2)],ensure_ascii=True))",file],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);console.log(JSON.stringify({reader:"openpyxl",decoded:JSON.parse(result.stdout)}));assert.deepEqual(JSON.parse(result.stdout),values);}
}finally{await rm(root,{recursive:true,force:true});}
