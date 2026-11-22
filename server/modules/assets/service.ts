import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { sites } from "@shared/schema";
import type { TrackedAsset } from "@shared/schema";
import { trackedAssetRepository } from "./repository";
import type { CreateAssetEventBody, CreateTrackedAssetBody, PatchTrackedAssetBody } from "./validators";

async function assertSiteInOrganization(orgId: number, siteId: number): Promise<boolean> {
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.organizationId, orgId)))
    .limit(1);
  return Boolean(site);
}

export const trackedAssetService = {
  async list(orgId: number) {
    return trackedAssetRepository.listByOrganization(orgId);
  },

  async create(orgId: number, body: CreateTrackedAssetBody) {
    if (body.siteId != null) {
      const ok = await assertSiteInOrganization(orgId, body.siteId);
      if (!ok) {
        return { ok: false as const, code: "SITE_NOT_FOUND" as const, message: "siteId not found in this organization" };
      }
    }
    const created = await trackedAssetRepository.insert({
      organizationId: orgId,
      assetType: body.assetType,
      serialNumber: body.serialNumber ?? null,
      status: body.status ?? "active",
      warehouseId: body.warehouseId ?? null,
      siteId: body.siteId ?? null,
      metadata: body.metadata ?? null,
    });
    return { ok: true as const, data: created };
  },

  async update(orgId: number, assetId: number, body: PatchTrackedAssetBody) {
    if (body.siteId != null) {
      const ok = await assertSiteInOrganization(orgId, body.siteId);
      if (!ok) {
        return { ok: false as const, code: "SITE_NOT_FOUND" as const, message: "siteId not found in this organization" };
      }
    }
    const raw = body as Record<string, unknown>;
    const patch = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== undefined),
    ) as Partial<Pick<TrackedAsset, "assetType" | "serialNumber" | "status" | "warehouseId" | "siteId" | "metadata">>;
    if (Object.keys(patch).length === 0) {
      return { ok: false as const, code: "EMPTY_PATCH" as const, message: "No fields to update" };
    }
    const existing = await trackedAssetRepository.findById(orgId, assetId);
    if (!existing) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: "Asset not found" };
    }
    const updated = await trackedAssetRepository.update(orgId, assetId, patch);
    return { ok: true as const, data: updated! };
  },

  async remove(orgId: number, assetId: number) {
    const deleted = await trackedAssetRepository.deleteWithEvents(orgId, assetId);
    if (!deleted) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: "Asset not found" };
    }
    return { ok: true as const };
  },

  async addEvent(orgId: number, assetId: number, body: CreateAssetEventBody, performedBy: number | null) {
    const asset = await trackedAssetRepository.findById(orgId, assetId);
    if (!asset) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: "Asset not found" };
    }
    const created = await trackedAssetRepository.insertEvent(orgId, assetId, {
      eventType: body.eventType,
      payload: body.payload ?? null,
      performedBy,
    });
    return { ok: true as const, data: created };
  },
};
