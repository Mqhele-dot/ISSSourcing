import { z } from "zod";

export const countPageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().refine(value => [25, 50, 100].includes(value)).default(25),
}).strict();
export const countCreateSchema = z.object({warehouseId: z.number().int().positive()}).strict();
export const countEntrySchema = z.object({countedQuantity: z.number().int().min(0).max(2147483647)}).strict();
export const countActionSchema = z.object({reason: z.string().trim().min(5).max(1000).optional()}).strict();
export function assertCountAction(status: string, action: string, counter: number | null, actor: number) {
  const states: Record<string, readonly string[]> = {
    start: ["planned", "PLANNED", "in_progress", "RECOUNT_REQUIRED"],
    submit: ["COUNTING"], approve: ["PENDING_APPROVAL"], post: ["APPROVED"],
    recount: ["COUNTING", "PENDING_APPROVAL", "APPROVED", "RECOUNT_REQUIRED"],
    cancel: ["planned", "in_progress", "PLANNED", "COUNTING", "PENDING_APPROVAL", "APPROVED", "RECOUNT_REQUIRED"],
  };
  if (!states[action]?.includes(status)) throw new Error("COUNT_STATE_CONFLICT");
  if (action === "approve" && counter === actor) throw new Error("COUNT_SELF_APPROVAL_DENIED");
  if (action === "submit" && counter !== actor) throw new Error("COUNT_COUNTER_REQUIRED");
}
