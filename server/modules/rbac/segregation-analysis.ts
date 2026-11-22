import type {PoolClient} from "pg";
import {sodAnalyzeSchema,sodMutationSchema,sodExceptionSchema,type SodAnalyze,type SodAnalysis,type SodConflict} from "@shared/procurement-governance";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {GovernanceError,governanceHash,governanceRetry,requireGovernanceAdmin} from "./governance-context";
import {recordGovernanceNotification} from "../../services/notification-emitter";
const missing=()=>new GovernanceError("SOD_SUBJECT_UNAVAILABLE","This user or role is unavailable in your organization.",404);
export async function analyzeSod(c:PoolClient,org:number,input:SodAnalyze):Promise<SodAnalysis>{
  const request=sodAnalyzeSchema.parse(input);
  let role=request.role??"viewer",customRoleId=request.customRoleId??null,active=true,label=role as string,revision="",subjectKey="";
  if(request.kind==="user"){
    if(!request.userId)throw missing();
    const {rows:[member]}=await c.query(`SELECT m.application_role,m.active AND m.status='active' AND u.active AS active,
      m.sod_revision,u.username,u.preferences,u.updated_at FROM organization_members m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.user_id=$2 FOR SHARE OF m,u`,[org,request.userId]);
    if(!member)throw missing();
    role=member.application_role;customRoleId=role==="custom"?Number(member.preferences?.customRoleId)||null:null;
    active=member.active;label=member.username;subjectKey=`user:${request.userId}`;
    revision=governanceHash([member.sod_revision,member.updated_at]);
  }else subjectKey=customRoleId?`custom:${customRoleId}`:`system:${role}`;
  if(request.proposedRole){role=request.proposedRole;customRoleId=request.proposedCustomRoleId??null;}
  if(role==="custom"||customRoleId){
    if(!customRoleId)throw missing();
    const {rows:[custom]}=await c.query("SELECT name,is_active,sod_revision FROM custom_roles WHERE organization_id=$1 AND id=$2 FOR SHARE",[org,customRoleId]);
    if(!custom)throw missing();
    if(request.kind==="role")label=custom.name;
    active=active&&custom.is_active;revision=governanceHash([revision,custom.sod_revision]);
  }
  const baseline:string[]=active?(await c.query("SELECT sod_role_permissions($1,$2,$3) keys",[org,role,customRoleId])).rows[0].keys:[];
  revision=governanceHash([revision,baseline]);
  let permissions:string[]=request.proposedGrants?(await c.query("SELECT coalesce(array_agg(DISTINCT k ORDER BY k),ARRAY[]::text[]) keys FROM unnest($1::text[]) k",
    [request.proposedGrants.map(p=>`${p.resource}:${p.permissionType}`)])).rows[0].keys:baseline;
  if(request.proposedActive!==undefined){
    if(request.kind!=="role"||role!=="custom")throw new GovernanceError("SOD_PROPOSAL_INVALID","Active-state previews apply only to custom roles.",400);
    active=request.proposedActive;
    permissions=active?(await c.query(`SELECT coalesce(array_agg(DISTINCT p.resource::text||':'||p.permission_type::text ORDER BY p.resource::text||':'||p.permission_type::text),ARRAY[]::text[]) keys
      FROM custom_role_permissions p JOIN custom_roles r ON r.id=p.role_id WHERE r.organization_id=$1 AND r.id=$2`,[org,customRoleId])).rows[0].keys:[];
  }
  const fingerprint=(await c.query("SELECT md5(array_to_string($1::text[],'|')) fingerprint",[permissions])).rows[0].fingerprint;
  if(!revision)revision=governanceHash([role,permissions]);
  const matches=(await c.query<SodConflict>("SELECT * FROM sod_matching_rules($1,$2,$3,$4)",[org,permissions,subjectKey,role==="custom"?`custom:${customRoleId}`:`system:${role}`])).rows;
  revision=governanceHash([revision,matches.map(r=>[r.rule_id,r.severity,r.enforcement_mode])]);
  const conflicts=matches.map(row=>({...row,status:row.exception_id?"MITIGATED":"EXISTING_CONFLICT"}));
  return {subjectKey,label,role,customRoleId,active,revision,permissions,fingerprint,conflicts,
    blocked:conflicts.some(r=>r.enforcement_mode!=="WARN"&&!r.exception_id),
    limitation:"One application role per active membership. Custom grants are tenant-bound; approval policies, individual limits and transaction-time independence still apply. Admin's broad canonical permissions are analyzed, not presumed safe."};
}
export function newlyBlocked(before:SodAnalysis,after:SodAnalysis){
  const previous=new Set(before.conflicts.map(r=>r.code));
  return after.conflicts.filter(r=>r.enforcement_mode!=="WARN"&&!r.exception_id&&!previous.has(r.code));
}
export async function mutateSod(c:PoolClient,org:number,user:number,key:string,raw:unknown){
  await requireGovernanceAdmin(c);const input=sodMutationSchema.parse(raw);
  await c.query("SELECT pg_advisory_xact_lock(723410,$1)",[org]);
  return governanceRetry(c,org,user,key,"SOD_ROLE_CHANGED",input,async()=>{
    const source:SodAnalyze=input.kind==="assign"?{kind:"user",userId:input.userId}:{kind:"role",role:"custom",customRoleId:input.roleId};
    const before=await analyzeSod(c,org,source);
    if(before.revision!==input.revision)throw new GovernanceError("SOD_REVISION_CHANGED","This access profile changed. Refresh and review it before saving.");
    let proposal:SodAnalyze=source;
    if(input.kind==="grant"){
      if(!input.grant||typeof input.enabled!=="boolean")throw new GovernanceError("SOD_INVALID","Choose a permission and whether to enable it.",400);
      const grantKey=`${input.grant.resource}:${input.grant.permissionType}`;
      const keys=new Set(before.permissions);if(input.enabled)keys.add(grantKey);else keys.delete(grantKey);
      proposal={...source,proposedGrants:[...keys].map(k=>{const [resource,permissionType]=k.split(":");return {resource,permissionType} as NonNullable<SodAnalyze["proposedGrants"]>[number];})};
    }else if(input.kind==="assign"){
      if(!input.role)throw missing();
      if(user===input.userId)throw new GovernanceError("SOD_SELF_ASSIGNMENT_DENIED","Ask a different administrator to change your own access.",403);
      proposal={...source,proposedRole:input.role,proposedCustomRoleId:input.customRoleId};
    }else if(input.kind==="role")proposal={...source,proposedActive:input.isActive};
    const after=await analyzeSod(c,org,proposal),failures=newlyBlocked(before,after);
    if(failures.length)throw new GovernanceError("SOD_ASSIGNMENT_CONFLICT","This change adds an unmitigated access conflict. Review the required controls.",409,failures);
    if(input.kind==="grant"){
      const g=input.grant!;
      if(input.enabled)await c.query(`INSERT INTO custom_role_permissions(role_id,resource,permission_type)
        SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM custom_role_permissions WHERE role_id=$1 AND resource=$2 AND permission_type=$3)`,[input.roleId,g.resource,g.permissionType]);
      else await c.query("DELETE FROM custom_role_permissions WHERE role_id=$1 AND resource=$2 AND permission_type=$3",[input.roleId,g.resource,g.permissionType]);
    }else if(input.kind==="assign"){
      // Assign preferences before the membership to avoid inheriting a previous
      // custom role. The organization lock serializes every governed edit.
      const proposedCustom=input.role==="custom"?input.customRoleId??null:null;
      const elsewhere=await c.query(`SELECT 1 FROM organization_members m JOIN users u ON u.id=m.user_id
        WHERE m.user_id=$2 AND m.organization_id<>$1 AND m.active AND m.status='active' AND m.application_role='custom'
        AND (u.preferences->>'customRoleId') IS DISTINCT FROM $3::text LIMIT 1`,[org,input.userId,proposedCustom===null?null:String(proposedCustom)]);
      if(elsewhere.rowCount)throw new GovernanceError("SOD_MEMBERSHIP_SCOPE_REVIEW_REQUIRED","This shared profile has custom access in another organization. Review its tenant-specific assignment before changing the shared custom-role pointer; no organization was changed.");
      await c.query(`UPDATE users u SET preferences=coalesce(preferences,'{}'::jsonb)||jsonb_build_object('customRoleId',$3::int),updated_at=clock_timestamp()
        WHERE u.id=$2 AND EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=$1 AND m.user_id=u.id)`,[org,input.userId,proposedCustom]);
      await c.query("UPDATE organization_members SET application_role=$3 WHERE organization_id=$1 AND user_id=$2",[org,input.userId,input.role]);
    }else{
      if(typeof input.isActive!=="boolean")throw new GovernanceError("SOD_INVALID","Choose the role's active state.",400);
      await c.query("UPDATE custom_roles SET is_active=$3,sod_revision=sod_revision+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,input.roleId,input.isActive]);
    }
    const result=await analyzeSod(c,org,source);
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"SOD_ROLE_CHANGED",resourceType:input.kind==="assign"?"user":"custom_role",
      resourceId:input.userId??input.roleId,before,after:result,reason:input.reason});
    return result;
  });
}
export async function requestSodException(c:PoolClient,org:number,user:number,key:string,raw:unknown){
  await requireGovernanceAdmin(c);const input=sodExceptionSchema.parse(raw);
  return governanceRetry(c,org,user,key,"SOD_EXCEPTION_REQUESTED",input,async()=>{
    const analysis=await analyzeSod(c,org,input.analysis);
    if(analysis.revision!==input.revision)throw new GovernanceError("SOD_REVISION_CHANGED","Refresh the proposed access before requesting mitigation.");
    const rule=analysis.conflicts.find(r=>r.rule_id===input.ruleId);
    if(!rule||rule.enforcement_mode!=="REQUIRE_MITIGATION")throw new GovernanceError("SOD_EXCEPTION_NOT_PERMITTED","This rule cannot be waived through an exception. Separate the conflicting permissions.");
    if(new Date(input.expiresAt)<=new Date())throw new GovernanceError("SOD_EXCEPTION_EXPIRED","Choose a future expiry date.",400);
    const {rows:[row]}=await c.query(`INSERT INTO sod_conflict_exceptions(organization_id,rule_id,subject_key,permission_fingerprint,source_evidence,
      reason,compensating_control,requested_by,starts_at,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *`,
      [org,input.ruleId,analysis.subjectKey,analysis.fingerprint,JSON.stringify({input:input.analysis,analysis}),input.reason,input.control,user,input.startsAt,input.expiresAt]);
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"SOD_EXCEPTION_REQUESTED",resourceType:"sod_exception",resourceId:Number(row.id),after:row,reason:input.reason});
    await recordGovernanceNotification(c,org,{entityType:"sod_exception",entityId:Number(row.id),transitionKey:`sod-exception:${row.id}:requested`,title:"Independent access mitigation review required",
      body:"Review the exact proposed permissions, compensating control and expiry. The requester and affected holder cannot approve this request.",targetPath:"/admin/segregation-of-duties?view=exceptions"});
    return row;
  });
}
export async function approveSodException(c:PoolClient,org:number,user:number,id:number,key:string,reason:string){
  const actor=await requireGovernanceAdmin(c);
  return governanceRetry(c,org,user,key,"SOD_EXCEPTION_APPROVED",{id,reason},async()=>{
    const row=(await c.query("SELECT * FROM sod_conflict_exceptions WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id])).rows[0];
    if(!row)throw missing();
    if(row.requested_by===user||row.subject_key===`user:${user}`||row.subject_key===`custom:${actor.customRoleId}`||row.subject_key===`system:${actor.role}`)
      throw new GovernanceError("SOD_INDEPENDENT_APPROVAL_REQUIRED","The requester and affected access holder cannot approve their own mitigation.",403);
    if(row.status!=="PENDING"||new Date(row.expires_at)<=new Date())throw new GovernanceError("SOD_EXCEPTION_NOT_PENDING","This exception is no longer pending and valid.");
    const current=await analyzeSod(c,org,row.source_evidence.input);
    if(current.revision!==row.source_evidence.analysis.revision||current.fingerprint!==row.permission_fingerprint)
      throw new GovernanceError("SOD_REVISION_CHANGED","Access changed after this request. Submit a fresh mitigation review.");
    const result=(await c.query("UPDATE sod_conflict_exceptions SET status='APPROVED',approved_by=$3,approved_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",[org,id,user])).rows[0];
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"SOD_EXCEPTION_APPROVED",resourceType:"sod_exception",resourceId:id,before:row,after:result,reason});
    return result;
  });
}

// Set-based projection: bounded pages and complete counts over the same tenant
// observation; never fetch 5,000 profiles and query their permissions in a loop.
export const sodProjection=`WITH subjects AS (
 SELECT m.user_id,'user:'||m.user_id subject_key,u.username label,m.application_role role,
   CASE WHEN m.application_role='custom' AND u.preferences->>'customRoleId' ~ '^[0-9]{1,9}$' THEN (u.preferences->>'customRoleId')::int END custom_id
 FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active
 WHERE m.organization_id=$1 AND m.active AND m.status='active'
 UNION ALL SELECT NULL::int,'custom:'||c.id,c.name,'custom',c.id FROM custom_roles c WHERE c.organization_id=$1 AND c.is_active
 UNION ALL SELECT NULL::int,'system:'||role::text,role::text,role::text,NULL::int FROM unnest(enum_range(NULL::user_role)) role WHERE role::text<>'custom'
), role_ids AS MATERIALIZED(SELECT DISTINCT role,custom_id FROM subjects),
 distinct_roles AS MATERIALIZED(SELECT role,custom_id,sod_role_permissions($1,role,custom_id) keys FROM role_ids),
 role_findings AS MATERIALIZED(SELECT p.role,p.custom_id,md5(array_to_string(p.keys,'|')) fingerprint,r.* FROM distinct_roles p
 CROSS JOIN LATERAL sod_matching_rules($1,p.keys,CASE WHEN p.role='custom' THEN 'custom:'||p.custom_id ELSE 'system:'||p.role END)r),
 findings AS(SELECT s.subject_key,s.label,s.role,s.custom_id,r.rule_id,r.code,r.name,r.severity,r.enforcement_mode,r.permissions,r.explanation,r.mitigation,
 coalesce(e.id,r.exception_id) exception_id,coalesce(e.expires_at,r.exception_expires_at) exception_expires_at
 FROM subjects s JOIN role_findings r ON r.role=s.role AND r.custom_id IS NOT DISTINCT FROM s.custom_id
 LEFT JOIN LATERAL(SELECT x.id,x.expires_at FROM sod_conflict_exceptions x WHERE x.organization_id=$1 AND x.rule_id=r.rule_id
 AND x.subject_key=s.subject_key AND x.permission_fingerprint=r.fingerprint AND x.status='APPROVED' AND x.starts_at<=now() AND x.expires_at>now()
 ORDER BY x.expires_at DESC,x.id DESC LIMIT 1)e ON true)`;

export const sodUserWorklist=`SELECT s.subject_key,s.label,s.role,s.custom_id,u.id,u.username,u.full_name AS "fullName",u.email,u.work_persona AS "workPersona",m.role AS "organizationRole",true active,
 jsonb_build_object('customRoleId',s.custom_id,'allowedNavPaths',u.preferences->'allowedNavPaths') preferences,
 count(rule_id)::int conflicts,count(rule_id) FILTER(WHERE severity='CRITICAL' AND exception_id IS NULL)::int critical
 FROM subjects s JOIN users u ON u.id=s.user_id JOIN organization_members m ON m.user_id=u.id AND m.organization_id=$1
 LEFT JOIN findings f USING(subject_key) WHERE s.user_id IS NOT NULL AND ($2::text='' OR concat_ws(' ',u.username,u.full_name,u.email,s.role,u.work_persona) ILIKE '%'||$2||'%')
 GROUP BY s.subject_key,s.label,s.role,s.custom_id,u.id,m.id`;
