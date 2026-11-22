import {z} from "zod";
import {resourceEnum,permissionTypeEnum,userRoleEnum} from "./schema";
const id=z.number().int().positive().max(2147483647);
export const sodGrantSchema=z.object({resource:z.enum(resourceEnum.enumValues),permissionType:z.enum(permissionTypeEnum.enumValues)}).strict();
export const sodAnalyzeSchema=z.object({kind:z.enum(["user","role"]),userId:id.optional(),role:z.enum(userRoleEnum.enumValues).optional(),
  customRoleId:id.optional(),proposedRole:z.enum(userRoleEnum.enumValues).optional(),proposedCustomRoleId:id.nullable().optional(),
  proposedActive:z.boolean().optional(),
  proposedGrants:z.array(sodGrantSchema).max(500).optional()}).strict();
export type SodAnalyze=z.infer<typeof sodAnalyzeSchema>;
export type SodConflict={rule_id:number;code:string;name:string;severity:string;enforcement_mode:string;permissions:string[];
  explanation:string;mitigation:string;exception_id:string|null;exception_expires_at:string|null;status:string};
export type SodAnalysis={subjectKey:string;label:string;role:string;customRoleId:number|null;active:boolean;revision:string;
  permissions:string[];fingerprint:string;conflicts:SodConflict[];blocked:boolean;limitation:string};
export const sodMutationSchema=z.object({kind:z.enum(["grant","assign","role"]),revision:z.string().min(1).max(128),reason:z.string().trim().min(5).max(2000),
  roleId:id.optional(),userId:id.optional(),role:z.enum(userRoleEnum.enumValues).optional(),customRoleId:id.nullable().optional(),
  grant:sodGrantSchema.optional(),enabled:z.boolean().optional(),isActive:z.boolean().optional()}).strict();
export const sodExceptionSchema=z.object({analysis:sodAnalyzeSchema,revision:z.string().min(1).max(128),ruleId:id,
  reason:z.string().trim().min(10).max(2000),control:z.string().trim().min(10).max(2000),
  startsAt:z.string().datetime(),expiresAt:z.string().datetime()}).strict().refine(v=>{
    const duration=new Date(v.expiresAt).getTime()-new Date(v.startsAt).getTime();return duration>0&&duration<=90*86400000;
  },"Mitigations must expire after their start and within 90 days.");
export const governanceReviewSchema=z.object({reason:z.string().trim().min(10).max(2000),assessmentId:id.optional()}).strict();
export const riskPolicySchema=z.object({
 recentBankDays:z.number().int().min(1).max(90).default(7),historyDays:z.number().int().min(30).max(730).default(365),
 minimumHistory:z.number().int().min(3).max(100).default(3),abnormalMultiple:z.number().min(2).max(20).default(3),
 splitWindowHours:z.number().int().min(1).max(168).default(24),maxAgeHours:z.number().int().min(1).max(168).default(24),
 medium:z.number().int().min(1).max(98).default(25),high:z.number().int().min(2).max(99).default(50),critical:z.number().int().min(3).max(100).default(75),
 independentRelease:z.literal(true).default(true),
}).strict().refine(p=>p.medium<p.high&&p.high<p.critical,"Risk thresholds must be strictly increasing");
export const defaultRiskPolicy=riskPolicySchema.parse({});
export type PaymentRiskSignal={code:string;resourceKey:string;points:number;explanation:string;evidence:Record<string,unknown>};
export type PaymentRiskView={id:number;batchId:number;version:number;assessedAt:string;assessedBy:number;status:string;riskLevel:string;score:number;
 amount:string;currency:string;sourceFingerprint:string;signals:PaymentRiskSignal[];nextAction:string;staleReason:string|null;
 reviewedBy:number|null;approvalBound:boolean;canAssess:boolean;canReview:boolean};
