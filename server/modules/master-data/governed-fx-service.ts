import { pool } from "../../db";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { parseReportingDecimal } from "../../lib/exact-reporting-decimal";

type Input={organizationId:number;id:number;actorId:number;reason?:string};
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code,status:409});
const payload=(r:Record<string,unknown>)=>({action:r.action,entityId:r.action==='create'?null:r.entity_id,patch:r.proposed_patch});

export async function approveReportingFx(input:Input) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const r=(await c.query("SELECT * FROM mdm_change_requests WHERE organization_id=$1 AND id=$2 AND domain='exchange-rates' FOR UPDATE",[input.organizationId,input.id])).rows[0];
    if(!r) throw fail('FX_REQUEST_NOT_FOUND','The exchange-rate request was not found.');
    if(!r.submitted_by || Number(r.submitted_by)===input.actorId) throw fail('FX_INDEPENDENT_APPROVAL_REQUIRED','A different authorized person must approve this exchange rate.');
    if(!['submitted','validation_passed','pending_approval'].includes(r.status)) throw fail('FX_REQUEST_NOT_APPROVABLE','Submit this request for approval before continuing.');
    const target=r.entity_id?(await c.query('SELECT to_jsonb(r) snapshot FROM mdm_exchange_rates r WHERE organization_id=$1 AND id=$2 FOR UPDATE',[input.organizationId,r.entity_id])).rows[0]?.snapshot:null;
    if(r.action!=='create'&&!target) throw fail('FX_RATE_NOT_FOUND','The exchange rate was not found in your organization.');
    await c.query('INSERT INTO reporting_fx_approvals(organization_id,change_request_id,payload,target_snapshot,approved_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',
      [input.organizationId,input.id,JSON.stringify(payload(r)),target?JSON.stringify(target):null,input.actorId]);
    await c.query("UPDATE mdm_change_requests SET status='approved',approved_by=$3,decided_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[input.organizationId,input.id,input.actorId]);
    await c.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,created_at) VALUES($1,$2,'approval','approved',$3,$4,now())",[input.organizationId,input.id,input.actorId,input.reason??null]);
    await appendAuditEventWithClient(c,{organizationId:input.organizationId,actor:{userId:input.actorId},action:'REPORTING_FX_APPROVED',resourceType:'mdm_change_request',resourceId:input.id,after:payload(r)});
    await c.query('COMMIT');return {id:input.id,status:'approved'};
  } catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function applyReportingFx(input:Input) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const r=(await c.query("SELECT * FROM mdm_change_requests WHERE organization_id=$1 AND id=$2 AND domain='exchange-rates' FOR UPDATE",[input.organizationId,input.id])).rows[0];
    if(!r) throw fail('FX_REQUEST_NOT_FOUND','The exchange-rate request was not found.');
    const prior=(await c.query('SELECT id::text,applied_at AS "appliedAt" FROM reporting_fx_revisions WHERE organization_id=$1 AND change_request_id=$2',[input.organizationId,input.id])).rows[0];
    const approval=(await c.query('SELECT *,payload=$3::jsonb AS matches FROM reporting_fx_approvals WHERE organization_id=$1 AND change_request_id=$2',[input.organizationId,input.id,JSON.stringify(payload(r))])).rows[0];
    if(prior&&approval?.matches){await c.query('COMMIT');return {id:input.id,status:'applied',revisionId:prior.id,appliedAt:prior.appliedAt};}
    if(r.status!=='approved'||!approval||!approval.matches||Number(approval.approved_by)===Number(r.submitted_by)) throw fail('FX_APPROVAL_REQUIRED','An unchanged, independently approved request is required. Resubmit the change for review.');
    const target=approval.target_snapshot;
    const patch=r.proposed_patch??{};
    const aliases:Record<string,string>={fromCurrencyCode:'from_currency_code',toCurrencyCode:'to_currency_code',effectiveDate:'effective_date',expiresAt:'expires_at',manualOverrideAllowed:'manual_override_allowed'};
    const normalized=Object.fromEntries(Object.entries(patch).map(([k,v])=>[aliases[k]??k,v]));
    const allowed=['from_currency_code','to_currency_code','effective_date','expires_at','rate','active','source','manual_override_allowed'];
    if(Object.keys(normalized).some(k=>!allowed.includes(k))) throw fail('FX_INVALID_PATCH','The rate request contains unsupported fields.');
    const value={...target,...normalized};
    const from=String(value.from_currency_code??'').trim().toUpperCase(),to=String(value.to_currency_code??'').trim().toUpperCase();
    const effective=new Date(String(value.effective_date));
    const expiry=value.expires_at?new Date(String(value.expires_at)):null;
    const rate=String(value.rate??'');
    let positive=false;try{positive=parseReportingDecimal(rate).coefficient>0n;}catch{/* handled below */}
    if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)||from===to||!positive||!Number.isFinite(effective.getTime())||(expiry&&(!Number.isFinite(expiry.getTime())||expiry<=effective))) throw fail('FX_INVALID_RATE','Provide different active currencies, a positive decimal rate and valid effective dates.');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${input.organizationId}:reporting-fx:${from}:${to}`]);
    const currencies=await c.query('SELECT DISTINCT code FROM currencies WHERE organization_id=$1 AND active=true AND code=ANY($2::text[])',[input.organizationId,[from,to]]);
    if(currencies.rowCount!==2) throw fail('FX_CURRENCY_UNAVAILABLE','Both currencies must be active in your organization.');
    if(target){
      const current=(await c.query('SELECT to_jsonb(r)=$3::jsonb AS matches FROM mdm_exchange_rates r WHERE organization_id=$1 AND id=$2 FOR UPDATE',[input.organizationId,r.entity_id,JSON.stringify(target)])).rows[0];
      if(!current?.matches) throw fail('FX_STALE_APPROVAL','The rate changed after approval. Submit a fresh request.');
    }
    const published=await c.query('SELECT * FROM reporting_fx_revisions WHERE organization_id=$1 AND source_rate_id=$2 ORDER BY version DESC LIMIT 1',[input.organizationId,r.entity_id??0]);
    if(published.rowCount){const p=published.rows[0];if(p.from_currency_code!==from||p.to_currency_code!==to||new Date(p.effective_at).getTime()!==effective.getTime()) throw fail('FX_SERIES_IMMUTABLE','Withdraw the published series and create a new one to change currencies or its effective date.');}
    const duplicate=await c.query('SELECT id FROM reporting_fx_revisions WHERE organization_id=$1 AND from_currency_code=$2 AND to_currency_code=$3 AND effective_at=$4 AND source_rate_id<>$5 LIMIT 1',[input.organizationId,from,to,effective,r.entity_id??0]);
    if(duplicate.rowCount) throw fail('FX_DUPLICATE_SERIES','A reporting rate already starts on this date. Submit a correction to that rate instead.');
    const withdrawn=['deactivate','archive'].includes(r.action)||value.active===false;
    let sourceId=r.entity_id;
    if(r.action==='create') {
      sourceId=(await c.query(`INSERT INTO mdm_exchange_rates(organization_id,from_currency_code,to_currency_code,rate,effective_date,expires_at,active,source,manual_override_allowed)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[input.organizationId,from,to,rate,effective,expiry,!withdrawn,value.source??'Manual approved',value.manual_override_allowed??false])).rows[0].id;
    } else {
      await c.query('UPDATE mdm_exchange_rates SET rate=$3,effective_date=$4,expires_at=$5,active=$6,source=$7,manual_override_allowed=$8,from_currency_code=$9,to_currency_code=$10 WHERE organization_id=$1 AND id=$2',[input.organizationId,sourceId,rate,effective,expiry,!withdrawn,value.source??null,value.manual_override_allowed??false,from,to]);
    }
    const revision=(await c.query(`INSERT INTO reporting_fx_revisions(organization_id,source_rate_id,version,from_currency_code,to_currency_code,rate,effective_at,expires_at,approved_at,approved_by,approval_reference,applied_at,change_request_id,withdrawn)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp(),$12,$13) RETURNING id::text,applied_at AS "appliedAt"`,[input.organizationId,sourceId,(published.rows[0]?.version??0)+1,from,to,rate,effective,expiry,approval.approved_at,approval.approved_by,`mdm-change-request:${input.id}`,input.id,withdrawn])).rows[0];
    await c.query("UPDATE mdm_change_requests SET status='applied',entity_id=$3 WHERE organization_id=$1 AND id=$2",[input.organizationId,input.id,sourceId]);
    await c.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,after_state,created_at) VALUES($1,$2,'apply','applied',$3,$4,$5::jsonb,now())",[input.organizationId,input.id,input.actorId,input.reason??null,JSON.stringify(revision)]);
    await appendAuditEventWithClient(c,{organizationId:input.organizationId,actor:{userId:input.actorId},action:'REPORTING_FX_APPLIED',resourceType:'mdm_change_request',resourceId:input.id,after:{...revision,withdrawn,sourceId}});
    await c.query('COMMIT');return {id:input.id,status:'applied',revisionId:revision.id,appliedAt:revision.appliedAt};
  }catch(e){
    await c.query('ROLLBACK');
    await c.query(`INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,created_at)
      SELECT organization_id,id,'apply_attempt','failed_to_apply',$3,$4,now() FROM mdm_change_requests
      WHERE organization_id=$1 AND id=$2 AND domain='exchange-rates'`,[input.organizationId,input.id,input.actorId,
      e instanceof Error && 'code' in e ? String(e.code) : 'FX_APPLICATION_ROLLED_BACK']).catch(()=>undefined);
    throw e;
  }finally{c.release();}
}
