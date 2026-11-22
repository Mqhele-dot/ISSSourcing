import { z } from "zod";

export const scanResolveBodySchema = z.object({
  value: z.string().min(1).max(512),
  /** Optional workflow hint from the client (receive, transfer, return, …). */
  intent: z.string().max(64).optional(),
});
