import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { organizationSettings, organizations } from "@shared/schema";
import { getActiveOrganizationId } from "../../organization-context";

type Auth = {
  ensureAuthenticated: import("express").RequestHandler;
};

/** GET branding / plan metadata for the active organization (Phase 4). */
export function registerOrganizationRoutes(app: Express, auth: Auth): void {
  app.get("/api/organization/settings", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      const [settings] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, orgId))
        .limit(1);
      res.json({
        organizationId: orgId,
        organization: org ?? null,
        settings: settings ?? null,
      });
    } catch (e) {
      console.error("GET /api/organization/settings:", e);
      res.status(500).json({ message: "Failed to load organization settings" });
    }
  });
}
