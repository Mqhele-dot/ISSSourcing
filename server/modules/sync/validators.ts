import { z } from "zod";

export const syncBatchItemSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  type: z.enum(["scan", "adjustment", "receive_note", "generic"]),
  payload: z.record(z.unknown()).default({}),
});

export const syncBatchBodySchema = z.object({
  actions: z.array(syncBatchItemSchema).min(1).max(50),
});
