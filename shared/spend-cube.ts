import {z} from "zod";
export const spendMeasures=["ordered","open_commitment","received","invoiced","recorded_payments"] as const;
export const spendDimensions=["supplier","department","contract","project","month","currency"] as const;
export type SpendDimension=typeof spendDimensions[number];
export type SpendDimensions=Record<SpendDimension,{key:string;label:string;state:"observed"|"unassigned"|"unavailable"}>;
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!v.startsWith("0000")&&Number.isFinite(Date.parse(v))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v);
export const spendCaptureSchema=z.object({measure:z.enum(spendMeasures),from:day.optional(),to:day.optional(),supplierId:z.number().int().positive().max(2147483647).optional()}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,"Start date must not follow end date");
export const spendPageSchema=z.object({dimension:z.enum(spendDimensions).default("supplier"),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)}).strict();
export const spendEvidenceSchema=spendPageSchema.extend({bucketKey:z.string().min(1).max(120)});
export const spendDimensionNotice="Dimensions and labels are observed source metadata at capture, not reconstructed transaction-time classifications. Measures have distinct bases and must not be added together.";
export function spendSourceResources(measure:string){return ["reports","suppliers","purchases","master_data",...(["invoiced","recorded_payments"].includes(measure)?["finance","invoices"]:[]),...(measure==="received"?["inventory"]:[])];}
