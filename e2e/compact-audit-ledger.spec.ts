import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {pool} from '../server/db';
import type * as CompactPipeline from '../server/modules/exports/compact-operational-controller';
import {cancelCompactJob} from '../server/modules/exports/compact-export-leases';
import {queueCompactSavedRetry} from '../server/modules/exports/compact-saved-retry';
import {gotoAuthed} from './test-helpers';
import {requireDisposableE2eDatabase,loginAsSeededUser} from './wave7-helpers';
import {seedCustomPermissionUser} from '../scripts/runtime-fixtures/expanded-security-fixtures';

const backendCommand=(process.env.PLAYWRIGHT_E2E_DEV_COMMAND??'npm run dev').trim();
if(!['node dist/index.js','npm run dev'].includes(backendCommand))throw new Error('Unknown Compact test backend; no source fallback is permitted.');
const packaged=backendCommand==='node dist/index.js';
const {executeCompactOperationalJob,CompactPipelineFailure,expireObservedExportFile,readExpiredExportFiles}:typeof CompactPipeline=packaged
  ?await import(pathToFileURL(path.resolve('dist/compact-operational-controller.js')).href)
  :await import('../server/modules/exports/compact-operational-controller');

test('private Compact capture/publication connects to governed audit without enabling public downloads',async({page})=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  test.info().annotations.push({type:'compact-runtime',description:packaged?'packaged controller and JavaScript child':'source controller and TSX child'});
  let started=0;const stages:Array<{stage:string;elapsedMs:number}>=[];
  const layouts:Array<{stage:string;viewportWidth:number;documentWidth:number;deviceScaleFactor:number}>=[];
  const checkLayout=async(stage:string)=>{
    const layout=await page.evaluate(()=>({viewportWidth:window.innerWidth,documentWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth??0),deviceScaleFactor:window.devicePixelRatio}));
    layouts.push({stage,...layout});
    expect(layout.documentWidth,`${stage}: no page-level horizontal overflow`).toBeLessThanOrEqual(layout.viewportWidth);
    if(test.info().project.name.includes('mobile-390'))expect(layout.viewportWidth).toBe(390);
  };
  const root=await mkdtemp(path.join(os.tmpdir(),'iss-compact-audit-browser-'));const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    await gotoAuthed(page,'/admin/audit-logs?view=governed');
    const jobId=Number((await pool.query("INSERT INTO export_jobs(organization_id,created_by,dataset,format,filters,profile,status) VALUES(1,1,'suppliers','excel','{}','compact_excel','queued') RETURNING id")).rows[0].id);
    const settings={root,storageId:`browser-${randomUUID()}`,organizationId:1,serverId:`browser-${randomUUID()}`,columns:['name'],policy:{temporaryBytes:4*1024**2,organizationTemporaryBytes:16*1024**2,totalTemporaryBytes:32*1024**2,organizationRetainedBytes:10_000_000,totalRetainedBytes:20_000_000,retentionDays:7,tokenTtlMinutes:30}};
    started=performance.now();stages.push({stage:'requested',elapsedMs:0});
    const result=await executeCompactOperationalJob(pool,settings,{deadlineMs:30000,onProgress:event=>{stages.push({stage:event.stage,elapsedMs:Math.round(performance.now()-started)});}});
    expect(result.status).toBe('succeeded');if(result.status!=='succeeded')throw new Error('Expected private completion');expect(result.jobId).toBe(jobId);
    const url=`/api/audit/events?resourceType=export_job&resourceId=${jobId}&pageSize=25`;
    const response=await page.request.get(url);expect(response.status()).toBe(200);const audit=(await response.json()).data;
    expect(audit.total).toBe(2);expect(audit.items.map((row:{action:string})=>row.action).sort()).toEqual(['COMPACT_CAPTURE_RECORDED','COMPACT_WORKBOOK_PUBLISHED']);expect(audit.items.every((row:{actorUserId:number})=>row.actorUserId===1)).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/leaseToken|downloadToken|captureSha256|file_path/);
    const integrity=await page.request.get('/api/audit/verify');expect(integrity.status()).toBe(200);expect((await integrity.json()).data.valid).toBe(true);
    await page.goto(`/admin/audit-logs?view=governed&resourceType=export_job&resourceId=${jobId}`);
    const governed=page.getByRole('region',{name:'Governed audit',exact:true});
    await expect(governed.getByRole('heading',{name:'compact capture recorded',exact:true})).toBeVisible();await expect(governed.getByRole('heading',{name:'compact workbook published',exact:true})).toBeVisible();
    const published=governed.locator('article').filter({has:page.getByRole('heading',{name:'compact workbook published',exact:true})});
    const technical=published.locator('summary');await technical.focus();await page.keyboard.press('Enter');await expect(published.locator('details')).toHaveAttribute('open','');
    await checkLayout('published-expanded');
    await page.screenshot({path:test.info().outputPath('compact-governed-audit.png'),fullPage:true,scale:'css'});
    const scoped=await page.request.get(`/api/export-jobs/${jobId}`);expect(scoped.status()).toBe(200);const metadata=await scoped.json();expect((metadata.data??metadata).downloadUrl).toBeNull();
    expect((await page.request.get(`/api/export/download/${jobId}?token=synthetic-no-access`)).status()).toBe(409);
    // Cancellation is a separate audited transition, not a published workbook.
    const cancelledJobId=Number((await pool.query("INSERT INTO export_jobs(organization_id,created_by,dataset,format,filters,profile,status) VALUES(1,1,'suppliers','excel','{}','compact_excel','queued') RETURNING id")).rows[0].id);
    expect(await cancelCompactJob(pool,{organizationId:1,actorId:1,jobId:cancelledJobId})).toBe(true);
    expect(await cancelCompactJob(pool,{organizationId:1,actorId:1,jobId:cancelledJobId})).toBe(false);
    const cancelledUrl=`/api/audit/events?resourceType=export_job&resourceId=${cancelledJobId}&pageSize=25`;
    const cancelledResponse=await page.request.get(cancelledUrl);expect(cancelledResponse.status()).toBe(200);
    const cancelledAudit=(await cancelledResponse.json()).data;expect(cancelledAudit.total).toBe(1);expect(cancelledAudit.items[0].action).toBe('COMPACT_EXPORT_CANCELLED');
    expect(JSON.stringify(cancelledAudit)).not.toMatch(/leaseToken|downloadToken|file_path/);
    await page.goto(`/admin/audit-logs?view=governed&resourceType=export_job&resourceId=${cancelledJobId}`);
    const cancelledHeading=governed.getByRole('heading',{name:'compact export cancelled',exact:true});await cancelledHeading.scrollIntoViewIfNeeded();await expect(cancelledHeading).toBeInViewport();
    await checkLayout('cancelled');
    await page.screenshot({path:test.info().outputPath('compact-cancellation-audit.png'),fullPage:true,scale:'css'});
    const retryJobId=Number((await pool.query("INSERT INTO export_jobs(organization_id,created_by,dataset,format,filters,profile,status) VALUES(1,1,'suppliers','excel','{}','compact_excel','queued') RETURNING id")).rows[0].id);
    await expect(executeCompactOperationalJob(pool,settings,{onProgress:event=>{if(event.stage==='captured')throw new Error('Synthetic stop after saved capture');}})).rejects.toBeInstanceOf(CompactPipelineFailure);
    const retryCommand={organizationId:1,actorId:1,jobId:retryJobId,commandId:randomUUID()};
    expect((await queueCompactSavedRetry(pool,retryCommand)).replayed).toBe(false);expect((await queueCompactSavedRetry(pool,retryCommand)).replayed).toBe(true);
    expect((await executeCompactOperationalJob(pool,settings)).status).toBe('succeeded');
    const retryUrl=`/api/audit/events?resourceType=export_job&resourceId=${retryJobId}&pageSize=25`;
    const retryResponse=await page.request.get(retryUrl);expect(retryResponse.status()).toBe(200);
    const retryAudit=(await retryResponse.json()).data;expect(retryAudit.total).toBe(4);expect(retryAudit.items.filter((row:{action:string})=>row.action==='COMPACT_EXPORT_RETRY_QUEUED')).toHaveLength(1);
    await page.goto(`/admin/audit-logs?view=governed&resourceType=export_job&resourceId=${retryJobId}`);
    const retryHeading=governed.getByRole('heading',{name:'compact export retry queued',exact:true});await retryHeading.scrollIntoViewIfNeeded();await expect(retryHeading).toBeInViewport();
    const retryArticle=governed.locator('article').filter({has:page.getByRole('heading',{name:'compact export retry queued',exact:true})});await retryArticle.locator('summary').focus();await page.keyboard.press('Enter');await expect(retryArticle.locator('details')).toHaveAttribute('open','');
    await checkLayout('retry-expanded');
    await page.screenshot({path:test.info().outputPath('compact-saved-retry-audit.png'),fullPage:true,scale:'css'});
    // Test-owned expiry goes through the same locked retention command as the
    // worker. It keeps publication evidence and creates one governed event.
    const retainedPath=(await pool.query('SELECT file_path FROM export_jobs WHERE id=$1',[retryJobId])).rows[0].file_path as string;expect(retainedPath).toBeTruthy();
    const retained={id:retryJobId,organizationId:1,primaryFilePath:retainedPath,filePaths:[retainedPath]};
    await pool.query("UPDATE export_jobs SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[retryJobId]);
    const discovered=(await readExpiredExportFiles(pool)).find(job=>job.id===retryJobId);if(discovered)expect(discovered).toEqual(retained);
    // The real server worker may win this race. Both paths must converge to one
    // committed expiry/audit event, never assume the test owns the row lock.
    expect(['expired','skipped']).toContain((await expireObservedExportFile(pool,retained)).status);
    await expect.poll(async()=>(await pool.query('SELECT file_path FROM export_jobs WHERE id=$1',[retryJobId])).rows[0].file_path).toBeNull();
    expect((await expireObservedExportFile(pool,retained)).status).toBe('skipped');
    const expired=(await pool.query('SELECT file_path,download_token FROM export_jobs WHERE id=$1',[retryJobId])).rows[0];expect(expired.file_path).toBeNull();expect(expired.download_token).toBeNull();
    const expiryEvidence=await page.request.get(retryUrl);expect(expiryEvidence.status()).toBe(200);const expiryAudit=(await expiryEvidence.json()).data;expect(expiryAudit.total).toBe(5);expect(expiryAudit.items.filter((row:{action:string})=>row.action==='COMPACT_EXPORT_FILE_EXPIRED')).toHaveLength(1);
    await page.goto(`/admin/audit-logs?view=governed&resourceType=export_job&resourceId=${retryJobId}`);
    const expiryHeading=governed.getByRole('heading',{name:'compact export file expired',exact:true});await expiryHeading.scrollIntoViewIfNeeded();await expect(expiryHeading).toBeInViewport();
    await checkLayout('expired');await page.screenshot({path:test.info().outputPath('compact-expiry-audit.png'),fullPage:true,scale:'css'});
    const expiryIntegrity=await page.request.get('/api/audit/verify');expect(expiryIntegrity.status()).toBe(200);expect((await expiryIntegrity.json()).data.valid).toBe(true);
    const denied=await seedCustomPermissionUser({label:'Export without governed audit',permissions:[{resource:'reports',actions:['read','export']},{resource:'suppliers',actions:['read']}]});
    await loginAsSeededUser(page,denied.username,denied.userId);expect((await page.request.get(url)).status()).toBe(403);expect((await page.request.get('/api/audit/verify')).status()).toBe(403);
    expect((await page.request.get(cancelledUrl)).status()).toBe(403);
    expect((await page.request.get(retryUrl)).status()).toBe(403);
    expect(pageErrors).toEqual([]);
  }finally{try{await test.info().attach('compact-stage-timings',{body:JSON.stringify({runtime:packaged?'packaged':'source',deadlineMs:30000,stages,layouts}),contentType:'application/json'});}finally{await rm(root,{recursive:true,force:true});}}
});
