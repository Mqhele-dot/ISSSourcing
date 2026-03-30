import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { assetEvents, projects, sites, trackedAssets } from "@shared/schema";
import { getActiveOrganizationId } from "../../organization-context";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";

type ExtensionMeta = { id: string; name: string; routes: string[] };

type Auth = {
  ensureAuthenticated: import("express").RequestHandler;
};

/** `organization_settings.feature_flags.extensions === false` disables extension APIs. */
async function requireExtensionsEnabled(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const flags = await getFeatureFlagsForActiveOrg();
    if (!isOrgFeatureEnabled(flags, "extensions")) {
      sendOrgFeatureDisabled(res, "extensions");
      return;
    }
    next();
  } catch {
    next();
  }
}

const REGISTERED_EXTENSIONS: ExtensionMeta[] = [
  { id: "projects", name: "Projects & sites", routes: ["/api/extensions/projects"] },
  {
    id: "assets",
    name: "Tracked assets",
    routes: [
      "/api/extensions/assets",
      "POST/PATCH/DELETE /api/extensions/assets/:assetId",
      "/api/extensions/assets/:assetId/events",
    ],
  },
];

/**
 * Industry / vertical extensions register here instead of growing `routes.ts`.
 */
export function registerExtensionRoutes(app: Express, auth: Auth): void {
  app.get("/api/extensions", (_req: Request, res: Response) => {
    res.json({ extensions: REGISTERED_EXTENSIONS });
  });

  app.get("/api/extensions/projects", auth.ensureAuthenticated, requireExtensionsEnabled, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const rows = await db
        .select()
        .from(projects)
        .where(eq(projects.organizationId, orgId))
        .limit(500);
      res.json(rows);
    } catch (e) {
      console.error("extensions/projects:", e);
      res.status(200).json([]);
    }
  });

  app.get("/api/extensions/assets", auth.ensureAuthenticated, requireExtensionsEnabled, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const rows = await db
        .select()
        .from(trackedAssets)
        .where(eq(trackedAssets.organizationId, orgId))
        .orderBy(desc(trackedAssets.updatedAt))
        .limit(500);
      res.json(rows);
    } catch (e) {
      console.error("extensions/assets list:", e);
      res.status(200).json([]);
    }
  });

  const createAssetBody = z.object({
    assetType: z.string().min(1).max(128),
    serialNumber: z.string().max(256).optional().nullable(),
    status: z.string().max(64).optional(),
    warehouseId: z.number().int().positive().optional().nullable(),
    siteId: z.number().int().positive().optional().nullable(),
    metadata: z.record(z.unknown()).optional(),
  });

  app.post("/api/extensions/assets", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    try {
      const parsed = createAssetBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.flatten() });
      }
      const orgId = getActiveOrganizationId();
      if (parsed.data.siteId != null) {
        const [site] = await db
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.id, parsed.data.siteId), eq(sites.organizationId, orgId)))
          .limit(1);
        if (!site) {
          return res.status(400).json({ message: "siteId not found in this organization" });
        }
      }
      const [created] = await db
        .insert(trackedAssets)
        .values({
          organizationId: orgId,
          assetType: parsed.data.assetType,
          serialNumber: parsed.data.serialNumber ?? null,
          status: parsed.data.status ?? "active",
          warehouseId: parsed.data.warehouseId ?? null,
          siteId: parsed.data.siteId ?? null,
          metadata: parsed.data.metadata ?? null,
        })
        .returning();
      res.status(201).json(created);
    } catch (e) {
      console.error("extensions/assets create:", e);
      res.status(500).json({ message: "Failed to create asset" });
    }
  });

  const patchAssetBody = createAssetBody.partial();

  app.patch("/api/extensions/assets/:assetId", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
      if (Number.isNaN(assetId)) {
        return res.status(400).json({ message: "Invalid asset id" });
      }
      const parsed = patchAssetBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.flatten() });
      }
      const orgId = getActiveOrganizationId();
      if (parsed.data.siteId != null) {
        const [site] = await db
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.id, parsed.data.siteId), eq(sites.organizationId, orgId)))
          .limit(1);
        if (!site) {
          return res.status(400).json({ message: "siteId not found in this organization" });
        }
      }
      const [existing] = await db
        .select({ id: trackedAssets.id })
        .from(trackedAssets)
        .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ message: "Asset not found" });
      }
      const patch = parsed.data as Record<string, unknown>;
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      const [updated] = await db
        .update(trackedAssets)
        .set({
          ...patch,
          updatedAt: new Date(),
        } as typeof trackedAssets.$inferInsert)
        .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
        .returning();
      res.json(updated);
    } catch (e) {
      console.error("extensions/assets patch:", e);
      res.status(500).json({ message: "Failed to update asset" });
    }
  });

  app.delete("/api/extensions/assets/:assetId", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
      if (Number.isNaN(assetId)) {
        return res.status(400).json({ message: "Invalid asset id" });
      }
      const orgId = getActiveOrganizationId();
      await db
        .delete(assetEvents)
        .where(and(eq(assetEvents.assetId, assetId), eq(assetEvents.organizationId, orgId)));
      const deleted = await db
        .delete(trackedAssets)
        .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
        .returning({ id: trackedAssets.id });
      if (deleted.length === 0) {
        return res.status(404).json({ message: "Asset not found" });
      }
      res.status(204).send();
    } catch (e) {
      console.error("extensions/assets delete:", e);
      res.status(500).json({ message: "Failed to delete asset" });
    }
  });

  const assetEventBody = z.object({
    eventType: z.string().min(1).max(64),
    payload: z.record(z.unknown()).optional(),
  });

  app.post("/api/extensions/assets/:assetId/events", auth.ensureAuthenticated, requireExtensionsEnabled, async (req: Request, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
      if (Number.isNaN(assetId)) {
        return res.status(400).json({ message: "Invalid asset id" });
      }
      const parsed = assetEventBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.flatten() });
      }
      const orgId = getActiveOrganizationId();
      const [asset] = await db
        .select({ id: trackedAssets.id })
        .from(trackedAssets)
        .where(and(eq(trackedAssets.id, assetId), eq(trackedAssets.organizationId, orgId)))
        .limit(1);
      if (!asset) {
        return res.status(404).json({ message: "Asset not found" });
      }
      const userId = (req as Request & { user?: { id?: number } }).user?.id ?? null;
      const [created] = await db
        .insert(assetEvents)
        .values({
          organizationId: orgId,
          assetId,
          eventType: parsed.data.eventType,
          payload: parsed.data.payload ?? null,
          performedBy: userId,
        })
        .returning();
      res.status(201).json(created);
    } catch (e) {
      console.error("extensions/assets event:", e);
      res.status(500).json({ message: "Failed to record asset event" });
    }
  });
}
