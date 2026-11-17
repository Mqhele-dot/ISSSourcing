import { z } from "zod";
const id=z.coerce.number().int().positive();
const label=z.string().trim().min(1).max(80);
export const positionQuery=z.object({
  page:z.coerce.number().int().positive().default(1),
  pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25),
  q:z.string().trim().max(150).default(""),
  warehouseId:id.optional(),
  status:z.enum(["all","reconciled","unresolved"]).default("all"),
}).strict();
export const locationQuery=positionQuery.omit({status:true}).extend({kind:z.enum(["sites","warehouses","zones","bins"])});
export const siteLink=z.object({warehouseId:id,siteId:id,reason:z.string().trim().min(5).max(1000)}).strict();
export const zoneCreate=z.object({warehouseId:id,code:label,name:label}).strict();
export const binCreate=z.object({warehouseId:id,zoneId:id,code:label,aisle:label.optional(),bay:label.optional(),shelf:label.optional()}).strict();
export const positionReconcile=z.object({binId:id,revision:z.string().regex(/^\d+$/),reason:z.string().trim().min(5).max(1000)}).strict();
