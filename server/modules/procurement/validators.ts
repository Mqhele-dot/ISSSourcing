import { z } from "zod";

/** Optional body for approve / reject requisition actions */
export const requisitionApproveBodySchema = z
  .object({
    approverId: z.number().optional(),
    comment: z.string().optional(),
  })
  .strict()
  .optional();

export const requisitionRejectBodySchema = z
  .object({
    approverId: z.number().optional(),
    reason: z.string().optional(),
  })
  .strict()
  .optional();
