import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInflateRaw} from 'node:zlib';
import {createHash} from 'node:crypto';
import {SaxesParser,type SaxesTagPlain} from 'saxes';
import type {CompactDetailColumn} from './compact-full-detail-writer';

type Entry={name:string;size:number;compressed:number;crc:number;offset:number;flags:number;method:number;start:number};
type Row=Record<string,string|number|boolean|null>;
const xmlNamespace='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNamespace='http://schemas.openxmlformats.org/package/2006/relationships';
const officeRel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crcUpdate(crc:number,chunk:Buffer){for(const value of chunk)crc=crcTable[(crc^value)&255]^(crc>>>8);return crc;}
function requireValid(condition:unknown):asserts condition{if(!condition)throw new Error('Workbook integrity or captured-detail parity could not be verified. No file was published.');}

/** Deliberately restricted ZIP32 reader for this writer's private artifacts.
 * It does not extract files or use ExcelJS. Reject ZIP64, comments, extra parts,
 * encryption, ambiguous paths and oversized metadata rather than guessing.
 */
async function archive(filePath:string,signal?:AbortSignal){
  const file=await open(filePath,'r');
  try{
    const before=await file.stat();requireValid(before.isFile()&&before.size>=22&&before.size<100_000_000);
    const read=async(length:number,offset:number)=>{signal?.throwIfAborted();requireValid(offset>=0&&offset+length<=before.size);const b=Buffer.alloc(length);requireValid((await file.read(b,0,length,offset)).bytesRead===length);return b;};
    const end=await read(22,before.size-22);
    requireValid(end.readUInt32LE(0)===0x06054b50&&end.readUInt16LE(4)===0&&end.readUInt16LE(6)===0&&end.readUInt16LE(20)===0);
    const count=end.readUInt16LE(10),size=end.readUInt32LE(12),offset=end.readUInt32LE(16);
    requireValid(count===end.readUInt16LE(8)&&count>=9&&count<=4096&&size<=2*1024*1024&&offset+size===before.size-22);
    const directory=await read(size,offset),entries:Entry[]=[];let cursor=0,total=0;
    for(let index=0;index<count;index++){
      requireValid(cursor+46<=directory.length&&directory.readUInt32LE(cursor)===0x02014b50);
      const nameLength=directory.readUInt16LE(cursor+28),extra=directory.readUInt16LE(cursor+30),comment=directory.readUInt16LE(cursor+32);
      requireValid(nameLength>0&&nameLength<200&&extra===0&&comment===0&&directory.readUInt16LE(cursor+34)===0&&cursor+46+nameLength<=directory.length);
      const entry:Entry={name:directory.subarray(cursor+46,cursor+46+nameLength).toString('utf8'),flags:directory.readUInt16LE(cursor+8),method:directory.readUInt16LE(cursor+10),crc:directory.readUInt32LE(cursor+16),compressed:directory.readUInt32LE(cursor+20),size:directory.readUInt32LE(cursor+24),offset:directory.readUInt32LE(cursor+42),start:0};
      requireValid(!(entry.flags&~0x808)&&[0,8].includes(entry.method)&&entry.compressed>0&&entry.compressed<100_000_000&&entry.size<=2*1024*1024*1024&&entry.offset<offset);
      total+=entry.size;requireValid(total<=2*1024*1024*1024);
      entries.push(entry);cursor+=46+nameLength;
    }
    requireValid(cursor===directory.length&&new Set(entries.map(e=>e.name)).size===entries.length);
    let next=0;
    for(const entry of [...entries].sort((a,b)=>a.offset-b.offset)){
      requireValid(entry.offset===next);
      const local=await read(30,entry.offset);requireValid(local.readUInt32LE(0)===0x04034b50&&local.readUInt16LE(6)===entry.flags&&local.readUInt16LE(8)===entry.method);
      const length=local.readUInt16LE(26),extra=local.readUInt16LE(28);requireValid(length<200&&extra===0);
      requireValid((await read(length,entry.offset+30)).toString('utf8')===entry.name);
      entry.start=entry.offset+30+length;next=entry.start+entry.compressed;
      if(entry.flags&8){const descriptor=await read(16,next);requireValid(descriptor.readUInt32LE(0)===0x08074b50&&descriptor.readUInt32LE(4)===entry.crc&&descriptor.readUInt32LE(8)===entry.compressed&&descriptor.readUInt32LE(12)===entry.size);next+=16;}
      else requireValid(local.readUInt32LE(14)===entry.crc&&local.readUInt32LE(18)===entry.compressed&&local.readUInt32LE(22)===entry.size);
      requireValid(next<=offset);
    }
    requireValid(next===offset);
    return {entries,before};
  }finally{await file.close();}
}

async function* xmlChunks(filePath:string,entry:Entry,signal?:AbortSignal){
  const source=createReadStream(filePath,{start:entry.start,end:entry.start+entry.compressed-1,highWaterMark:16*1024,signal});
  const inflate=entry.method===8?createInflateRaw({chunkSize:16*1024}):undefined;
  const sourceError=(error:Error)=>inflate?.destroy(error);source.on('error',sourceError);
  const stream=inflate?source.pipe(inflate):source;
  const decoder=new TextDecoder('utf-8',{fatal:true});let count=0,crc=0xffffffff,tokenLength=0;
  try{
    for await(const chunk of stream){
      signal?.throwIfAborted();count+=chunk.length;requireValid(count<=entry.size);crc=crcUpdate(crc,chunk);
      const text=decoder.decode(chunk,{stream:true});
      // Saxes buffers incomplete text/attributes. Bound those BEFORE feeding it,
      // including highly compressible malformed XML and oversized whitespace.
      for(const [index,fragment]of text.split('<').entries()){tokenLength=index===0?tokenLength+fragment.length:fragment.length;requireValid(tokenLength<=256*1024);}
      yield text;
    }
    const tail=decoder.decode();if(tail)yield tail;
    requireValid(count===entry.size&&((crc^0xffffffff)>>>0)===entry.crc);
  }finally{source.destroy();inflate?.destroy();}
}
function parser(){
  const p=new SaxesParser({xmlns:false});
  p.on('doctype',()=>requireValid(false));p.on('processinginstruction',()=>requireValid(false));
  return p;
}
async function parsePart(filePath:string,entry:Entry,onOpen:(node:SaxesTagPlain)=>void,signal?:AbortSignal){
  requireValid(entry.size<=2*1024*1024);const p=parser();let depth=0;p.on('opentagstart',()=>requireValid(++depth<=40));p.on('closetag',()=>{depth--;});p.on('opentag',onOpen);
  for await(const chunk of xmlChunks(filePath,entry,signal))p.write(chunk);p.close();
}
function columnIndex(reference:string,row:number){
  const match=/^([A-Z]{1,3})([1-9][0-9]*)$/.exec(reference);requireValid(match&&Number(match[2])===row);
  let index=0;for(const char of match![1])index=index*26+char.charCodeAt(0)-64;return index-1;
}

async function* sheetRows(filePath:string,entry:Entry,width:number,signal?:AbortSignal){
  const p=parser(),queue:Array<Array<string|null>>=[];let row:Array<string|null>|undefined,cell=-1,cellText='',runText='',inText=false,lastColumn=-1,ordinal=0,root=false,rowCharacters=0,dataSections=0,cellStrings=0,cellRuns=0,runTexts=0;
  const stack:string[]=[];
  const allowed=new Set(['worksheet','sheetFormatPr','sheetViews','sheetView','pane','selection','sheetData','row','c','is','r','t','autoFilter','pageMargins','pageSetup','sheetPr','outlinePr','pageSetUpPr']);
  p.on('opentag',node=>{
    const parent=stack[stack.length-1];stack.push(node.name);requireValid(allowed.has(node.name)&&stack.length<=20);
    requireValid(node.attributes.xmlns===undefined||node.name==='worksheet'&&node.attributes.xmlns===xmlNamespace);
    if(node.name==='worksheet'){requireValid(!root&&stack.length===1&&node.attributes.xmlns===xmlNamespace);root=true;}
    else if(['sheetFormatPr','sheetViews','sheetData','autoFilter','pageMargins','pageSetup','sheetPr'].includes(node.name))requireValid(parent==='worksheet');
    else if(node.name==='sheetView')requireValid(parent==='sheetViews');
    else if(['pane','selection'].includes(node.name))requireValid(parent==='sheetView');
    else if(['outlinePr','pageSetUpPr'].includes(node.name))requireValid(parent==='sheetPr');
    if(node.name==='sheetData')requireValid(++dataSections===1);
    if(node.name==='row'){requireValid(parent==='sheetData'&&!row&&Number(node.attributes.r)===++ordinal&&ordinal<=1_048_576&&node.attributes.hidden===undefined);row=Array(width).fill(null);lastColumn=-1;rowCharacters=0;}
    if(node.name==='c'){
      requireValid(parent==='row'&&row&&node.attributes.t==='inlineStr'&&node.attributes.s===undefined);
      cell=columnIndex(String(node.attributes.r),ordinal);requireValid(cell>lastColumn&&cell<width);lastColumn=cell;cellText='';row![cell]='';cellStrings=0;cellRuns=0;
    }
    if(node.name==='is')requireValid(parent==='c'&&cell>=0&&++cellStrings===1);
    if(node.name==='r'){requireValid(parent==='is'&&++cellRuns<=32768);runTexts=0;runText='';}
    if(node.name==='t'){requireValid(parent==='r'&&row&&cell>=0&&++runTexts===1);inText=true;}
  });
  p.on('text',value=>{if(inText){cellText+=value;runText+=value;rowCharacters+=value.length;requireValid(cellText.length<=32767&&rowCharacters<=8*1024*1024);}else requireValid(value.trim()==='');});
  p.on('cdata',()=>requireValid(false));
  p.on('closetag',node=>{
    requireValid(stack.pop()===node.name);
    if(node.name==='t')inText=false;
    if(node.name==='r')requireValid(runTexts===1&&!/\r|_x[0-9a-fA-F]{4}_/.test(runText));
    if(node.name==='c'){requireValid(row&&cell>=0&&cellStrings===1&&cellRuns>=1&&runTexts===1);row![cell]=cellText;cell=-1;}
    if(node.name==='row'){requireValid(row);queue.push(row!);row=undefined;}
  });
  for await(const chunk of xmlChunks(filePath,entry,signal)){p.write(chunk);while(queue.length)yield queue.shift()!;}
  p.close();while(queue.length)yield queue.shift()!;requireValid(root&&dataSections===1&&ordinal>0&&!row&&!stack.length);
}

/** Independent ZIP/XML validation in the credential-free worker. Streaming row
 * parity is against the integrity-checked capture, not an ExcelJS round-trip.
 * Passing this does not certify native Excel performance or grant publication.
 */
export async function validateCompactWorkbook(input:{filePath:string;expectedSha256:string;dataset:string;observationReference:string;schemaVersion:string;normalizedFilters:Record<string,unknown>;sourceInformation?:Record<string,string|null>;columns:CompactDetailColumn[];expectedRows:number;sheetCount:number;rows:AsyncIterable<Row>;signal?:AbortSignal}){
  requireValid(Number.isSafeInteger(input.expectedRows)&&input.expectedRows>=0&&Number.isSafeInteger(input.sheetCount)&&input.sheetCount>=1&&input.sheetCount<=4088&&input.columns.length>0&&input.columns.length<=16384);
  const {entries,before}=await archive(input.filePath,input.signal),parts=new Map(entries.map(entry=>[entry.name,entry]));
  const expected=['xl/theme/theme1.xml','_rels/.rels','xl/styles.xml','xl/_rels/workbook.xml.rels','xl/workbook.xml','docProps/app.xml','docProps/core.xml','[Content_Types].xml',...Array.from({length:input.sheetCount+1},(_,i)=>`xl/worksheets/sheet${i+1}.xml`)];
  requireValid(expected.length===entries.length&&expected.every(name=>parts.has(name)));
  const relationships=new Map<string,string>(),sheets:Array<{name:string;rel:string}>=[];
  const contentTypes=new Map<string,string>(),defaults=new Set<string>();
  const expectedTypes=new Map<string,string>([
    ['/xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
    ['/xl/styles.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ['/xl/theme/theme1.xml','application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/docProps/core.xml','application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml','application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    ...Array.from({length:input.sheetCount+1},(_,i)=>[`/xl/worksheets/sheet${i+1}.xml`,'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'] as const),
  ]);
  for(const name of expected.filter(name=>!name.startsWith('xl/worksheets/'))){
    let nodes=0;const ids=new Set<string>(),targets=new Set<string>();
    await parsePart(input.filePath,parts.get(name)!,node=>{
      if(nodes++===0){
        if(name.endsWith('.rels'))requireValid(node.name==='Relationships'&&node.attributes.xmlns===relNamespace);
        if(name==='xl/workbook.xml')requireValid(node.name==='workbook'&&node.attributes.xmlns===xmlNamespace);
        if(name==='[Content_Types].xml')requireValid(node.name==='Types'&&node.attributes.xmlns==='http://schemas.openxmlformats.org/package/2006/content-types');
      }
      requireValid(!['f','definedName','externalReference','hyperlink','oleObject'].includes(node.name));
      if(name==='xl/workbook.xml')requireValid(node.name!=='extLst');
      if(name.endsWith('.rels')&&node.name==='Relationships')requireValid(node.attributes.xmlns===relNamespace);
      if(node.name==='Relationship'){
        requireValid(name.endsWith('.rels'));
        const {Id,Target,Type,TargetMode}=node.attributes;requireValid(!TargetMode&&typeof Target==='string'&&typeof Type==='string'&&typeof Id==='string');
        const permitted=name==='_rels/.rels'?new Map([['xl/workbook.xml',`${officeRel}officeDocument`],['docProps/core.xml','http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'],['docProps/app.xml',`${officeRel}extended-properties`]]):new Map([['styles.xml',`${officeRel}styles`],['theme/theme1.xml',`${officeRel}theme`],...Array.from({length:input.sheetCount+1},(_,i)=>[`worksheets/sheet${i+1}.xml`,`${officeRel}worksheet`] as const)]);
        requireValid(permitted.get(Target)===Type);
        requireValid(!ids.has(Id)&&!targets.has(Target));ids.add(Id);targets.add(Target);
        if(name==='xl/_rels/workbook.xml.rels'){requireValid(!relationships.has(Id));relationships.set(Id,Target);}
      }
      if(name==='xl/workbook.xml'&&node.name==='sheet'){requireValid(node.attributes.state===undefined||node.attributes.state==='visible');sheets.push({name:String(node.attributes.name),rel:String(node.attributes['r:id'])});}
      if(name==='[Content_Types].xml'){
        requireValid(['Types','Default','Override'].includes(node.name));
        if(node.name==='Override'){
          const {PartName,ContentType}=node.attributes;requireValid(typeof PartName==='string'&&typeof ContentType==='string'&&expectedTypes.get(PartName)===ContentType&&!contentTypes.has(PartName));contentTypes.set(PartName,ContentType);
        }
        if(node.name==='Default'){
          // ExcelJS emits an unused VML default even with no comments. The
          // archive allowlist still forbids all VML/comment/drawing parts.
          const {Extension,ContentType}=node.attributes;requireValid(typeof Extension==='string'&&!defaults.has(Extension)&&(Extension==='rels'&&ContentType==='application/vnd.openxmlformats-package.relationships+xml'||Extension==='xml'&&ContentType==='application/xml'||Extension==='vml'&&ContentType==='application/vnd.openxmlformats-officedocument.vmlDrawing'));defaults.add(Extension);
        }
      }
    },input.signal);
    if(name==='_rels/.rels')requireValid(ids.size===3);
  }
  requireValid(contentTypes.size===expectedTypes.size&&defaults.has('rels')&&defaults.has('xml'));
  requireValid(sheets.length===input.sheetCount+1&&relationships.size===input.sheetCount+3);
  for(let i=0;i<sheets.length;i++)requireValid(sheets[i].name===(i===0?'Export information':`Data ${i}`)&&relationships.get(sheets[i].rel)===`worksheets/sheet${i+1}.xml`);
  const metadata=new Map<string,string|null>();
  for await(const row of sheetRows(input.filePath,parts.get('xl/worksheets/sheet1.xml')!,2,input.signal)){requireValid(row[0]!==null&&!metadata.has(row[0]));metadata.set(row[0],row[1]);}
  const required:Record<string,string|null>={'Profile':'Compact Excel — complete selected detail','Dataset':input.dataset,'Observation':input.observationReference,'Source rows':String(input.expectedRows),'Schema version':input.schemaVersion,'Writer version':'compact-full-detail-v2-rich-text','Filters':JSON.stringify(input.normalizedFilters),'Selected columns':JSON.stringify(input.columns.map(c=>c.key)),'Precision':'Values are literal text. Decimal, identifier and timestamp columns must arrive as exact strings; no formulas, macros or external links are generated.','Scope':'Every captured record and selected column is included. No summaries, separate archives or automatic format changes.',...Object.fromEntries(Object.entries(input.sourceInformation??{}).map(([k,v])=>[`Source information: ${k}`,v]))};
  requireValid(metadata.size===Object.keys(required).length);
  for(const [key,value]of Object.entries(required))requireValid(metadata.has(key)&&metadata.get(key)===value);
  const source=input.rows[Symbol.asyncIterator]();let rows=0;
  try{
    for(let i=0;i<input.sheetCount;i++){
      let sheetOrdinal=0;
      for await(const row of sheetRows(input.filePath,parts.get(`xl/worksheets/sheet${i+2}.xml`)!,input.columns.length,input.signal)){
        if(sheetOrdinal++===0){requireValid(row.every((v,c)=>v===input.columns[c].label));continue;}
        const next=await source.next();requireValid(!next.done);
        for(let c=0;c<input.columns.length;c++){const value=next.value![input.columns[c].key];requireValid(Object.hasOwn(next.value!,input.columns[c].key)&&row[c]===(value===null?null:Object.is(value,-0)?'-0':String(value)));}
        requireValid(++rows<=input.expectedRows);
      }
      requireValid(i===0||sheetOrdinal>1);
    }
    requireValid(rows===input.expectedRows&&(await source.next()).done);
  }finally{await source.return?.();}
  const hash=createHash('sha256');for await(const chunk of createReadStream(input.filePath,{signal:input.signal}))hash.update(chunk);
  const sha256=hash.digest('hex'),after=await stat(input.filePath);
  requireValid(sha256===input.expectedSha256&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs);
  return {validatorVersion:'compact-zip-xml-v2-rich-text' as const,verifiedRows:rows,verifiedDataSheets:input.sheetCount,sha256,actualBytes:after.size};
}
