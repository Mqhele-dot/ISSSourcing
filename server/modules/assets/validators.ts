import { z } from "zod";

export const createTrackedAssetBodySchema = z.object({
  assetType: z.string().min(1).max(128),
  serialNumber: z.string().max(256).optional().nullable(),
  status: z.string().max(64).optional(),
  warehouseId: z.number().int().positive().optional().nullable(),
  siteId: z.number().int().positive().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const patchTrackedAssetBodySchema = createTrackedAssetBodySchema.partial();

export const createAssetEventBodySchema = z.object({
  eventType: z.string().min(1).max(64),
  payload: z.record(z.unknown()).optional(),
});

export type CreateTrackedAssetBody = z.infer<typeof createTrackedAssetBodySchema>;
export type PatchTrackedAssetBody = z.infer<typeof patchTrackedAssetBodySchema>;
export type CreateAssetEventBody = z.infer<typeof createAssetEventBodySchema>;
