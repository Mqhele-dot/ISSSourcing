import { z } from "zod";

export const intakeRoutes = ["CATALOG_REQUISITION","CONTRACT_RELEASE","STANDARD_REQUISITION","RFQ_OR_SOURCING",
  "SERVICE_REQUISITION","SUPPLIER_ONBOARDING_REQUIRED","MANUAL_PROCUREMENT_REVIEW"] as const;
export type IntakeRoute = typeof intakeRoutes[number];
const id=z.number().int().positive().max(2147483647);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{
  const d=new Date(s+"T00:00:00.000Z");
  return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;
});
export const intakeNeedSchema=z.object({
  description:z.string().trim().min(3).max(500),
  kind:z.enum(["goods","service","unsure"]),
  quantity:z.number().int().positive().max(1000000),
  estimatedValue:z.string().regex(/^\d{1,10}(\.\d{1,4})?$/).transform(s=>Number(s).toString()).optional(),
  currency:z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  requiredDate:day,
  justification:z.string().trim().min(5).max(2000),
  departmentId:id.optional(), costCentreId:id.optional(), siteId:id.optional(),
  itemId:id.optional(),supplierId:id.optional(),contractId:id.optional(),unitId:id.optional(),taxId:id.optional(),
  source:z.object({kind:z.enum(["requisition","order"]),id}).strict().optional(),
}).strict();
export const intakeConvertSchema=z.object({need:intakeNeedSchema,revision:z.string().regex(/^[a-f0-9]{64}$/),route:z.enum(intakeRoutes)}).strict();
export type IntakeNeed=z.infer<typeof intakeNeedSchema>;
export type IntakeBlocker={code:string;state:"blocked"|"setup_required"|"review";message:string};
export type IntakeEvaluation={
  normalized: IntakeNeed; recommendation:IntakeRoute; reasons:string[]; blockers:IntakeBlocker[]; alternatives:IntakeRoute[];
  supplier:{id:number;name:string}|null;
  agreement:{id:number;reference:string;lineId:string;unitPrice:string;currency:string}|null;
  currency:string;estimatedValue:string|null;requiredNextInformation:string[];
  sourcing:{required:boolean;threshold:number|null;minimumResponses:number|null};
  canCreateDraft:boolean;revision:string;evaluatedAt:string;
};
export const intakeOptionKinds=["departments","costCentres","sites","items","suppliers","contracts","units","taxes"] as const;
export type IntakeOptionKind=typeof intakeOptionKinds[number];
export type IntakeOption={id:number;label:string};
