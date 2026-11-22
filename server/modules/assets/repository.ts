import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { assetEvents, trackedAssets } from "@shared/schema";
import type { AssetEvent, TrackedAsset } from "@shared/schema";

export const trackedAssetRepository = {
  listByOrganization(orgId: number, limit = 500): Promise<TrackedAsset[]> {
    return db
      .select()
      .from(trackedAssets)
      .where(eq(trackedAssets.organizationId, orgId))
      .orderBy(desc(trackedAssets.updatedAt))
      .limit(limit);
  },

  async findById(orgId: number, assetId: number): Promise<TrackedAsset | undefined> {
    const [row] = await db
      .select()
      .from(trackedAssets)
      .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
      .limit(1);
    return row;
  },

  insert(values: {
    organizationId: number;
    assetType: string;
    serialNumber: string | null;
    status: string;
    warehouseId: number | null;
    siteId: number | null;
    metadata: unknown;
  }): Promise<TrackedAsset> {
    return db
      .insert(trackedAssets)
      .values({
        organizationId: values.organizationId,
        assetType: values.assetType,
        serialNumber: values.serialNumber,
        status: values.status,
        warehouseId: values.warehouseId,
        siteId: values.siteId,
        metadata: values.metadata as TrackedAsset["metadata"],
      })
      .returning()
      .then(([r]) => r!);
  },

  update(
    orgId: number,
    assetId: number,
    patch: Partial<Pick<TrackedAsset, "assetType" | "serialNumber" | "status" | "warehouseId" | "siteId" | "metadata">>,
  ): Promise<TrackedAsset | undefined> {
    return db
      .update(trackedAssets)
      .set({
        ...patch,
        updatedAt: new Date(),
      } as typeof trackedAssets.$inferInsert)
      .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
      .returning()
      .then(([r]) => r);
  },

  async deleteWithEvents(orgId: number, assetId: number): Promise<boolean> {
    await db
      .delete(assetEvents)
      .where(and(eq(assetEvents.assetId, assetId), eq(assetEvents.organizationId, orgId)));
    const deleted = await db
      .delete(trackedAssets)
      .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
      .returning({ id: trackedAssets.id });
    return deleted.length > 0;
  },

  insertEvent(
    orgId: number,
    assetId: number,
    body: { eventType: string; payload: Record<string, unknown> | null; performedBy: number | null },
  ): Promise<AssetEvent> {
    return db
      .insert(assetEvents)
      .values({
        organizationId: orgId,
        assetId,
        eventType: body.eventType,
        payload: body.payload,
        performedBy: body.performedBy,
      })
      .returning()
      .then(([r]) => r!);
  },
};
