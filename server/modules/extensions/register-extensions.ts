import type { Express, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { projects } from "@shared/schema";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { registerTrackedAssetExtensionRoutes } from "../assets/register-asset-routes";
import { requireExtensionsEnabled } from "./extension-guard";
import { INDUSTRY_EXTENSION_MODULES } from "./industry-registry";

type ExtensionMeta = { id: string; name: string; routes: string[] };

type Auth = {
  ensureAuthenticated: RequestHandler;
};

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
    res.json({ extensions: REGISTERED_EXTENSIONS, industryModules: INDUSTRY_EXTENSION_MODULES });
  });

  app.get("/api/extensions/projects", auth.ensureAuthenticated, requireExtensionsEnabled, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const rows = await db
        .select()
        .from(projects)
        .where(eq(projects.organizationId, orgId))
        .limit(500);
      return sendOk(res, rows);
    } catch (e) {
      console.error("extensions/projects:", e);
      return sendError(res, 503, "PROJECTS_EXTENSION_UNAVAILABLE", "Projects and sites could not be loaded.", {
        hint: "Check the database schema and extension migration status before assigning a requisition to a project.",
        details: e instanceof Error ? e.message : String(e),
      });
    }
  });

  registerTrackedAssetExtensionRoutes(app, auth);
}
