import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../../db";
import { appSettings, organizationMembers, organizationSettings, organizations } from "@shared/schema";
import { getActiveOrganizationId, getOptionalTenantContext } from "../../organization-context";
import { getCountryPack } from "../master-data/country-pack-registry";

const bootstrapBody = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/).optional(),
  countryCode: z.enum(["ZA", "GB", "US"]).default("ZA"),
});

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
};

/**
 * Creates a new organization and membership for the current user (admin).
 * Switches session to the new org when a session exists.
 */
export function registerOnboardingRoutes(app: Express, auth: Auth): void {
  app.get("/api/onboarding/setup-progress", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const organizationId = getActiveOrganizationId();
      const result = await pool.query(`
        SELECT
          EXISTS (SELECT 1 FROM organization_settings WHERE organization_id=$1 AND nullif(trim(legal_name),'') IS NOT NULL) AS company,
          EXISTS (SELECT 1 FROM warehouses WHERE organization_id=$1 AND is_default=true) AS warehouse,
          EXISTS (SELECT 1 FROM tax_codes WHERE organization_id=$1 AND active=true) AS tax,
          EXISTS (SELECT 1 FROM suppliers WHERE organization_id=$1 AND status='active') AS supplier,
          EXISTS (SELECT 1 FROM audit_logs WHERE organization_id=$1 AND action='INVENTORY_CSV_IMPORTED') AS csv_import
      `, [organizationId]);
      const row = result.rows[0];
      return res.json({
        steps: [
          { id: "company", complete: row.company, required: true },
          { id: "warehouse", complete: row.warehouse, required: true },
          { id: "tax", complete: row.tax, required: true },
          { id: "supplier", complete: row.supplier, required: true },
          { id: "csv-import", complete: row.csv_import, required: false },
        ],
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("GET /api/onboarding/setup-progress:", error);
      return res.status(500).json({ ok: false, error: { code: "SETUP_PROGRESS_FAILED", message: "Could not check setup progress. Please retry." } });
    }
  });
  app.post(
    "/api/onboarding/bootstrap",
    auth.ensureAuthenticated,
    auth.ensureRole(["admin"]),
    async (req: Request, res: Response) => {
      try {
        const previousOrganizationId = getOptionalTenantContext()?.organizationId ?? null;
        const parsed = bootstrapBody.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.flatten().fieldErrors });
        }
        const { name, slug, countryCode } = parsed.data;
        const pack = getCountryPack(countryCode);
        const baseSlug = slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
        let created: typeof organizations.$inferSelect | undefined;
        let slugTry = baseSlug || `org-${Date.now()}`;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const [row] = await db
              .insert(organizations)
              .values({
                name,
                slug: slugTry,
                countryCode: pack.code,
                defaultCurrencyCode: pack.defaultCurrencyCode,
                locale: pack.locale,
                timezone: pack.timezone,
              })
              .returning();
            created = row;
            break;
          } catch {
            slugTry = `${baseSlug || "org"}-${Date.now()}-${attempt}`;
          }
        }
        if (!created?.id) {
          return res.status(500).json({ message: "Failed to create organization" });
        }
        await db.insert(organizationSettings).values({
          organizationId: created.id,
          displayName: name,
          legalName: name,
        }).onConflictDoNothing();
        await db.insert(appSettings).values({
          organizationId: created.id,
          companyName: name,
          currencyCode: pack.defaultCurrencyCode,
          businessCountryCode: pack.code,
        }).onConflictDoNothing();
        const userId = (req.user as { id?: number })?.id;
        if (userId) {
          const existing = await db
            .select({ id: organizationMembers.id })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, created.id),
                eq(organizationMembers.userId, userId),
              ),
            )
            .limit(1);
          if (existing.length === 0) {
            await db.insert(organizationMembers).values({
              organizationId: created.id,
              userId,
              role: "owner",
              applicationRole: "admin",
              active: true,
              status: "active",
            });
          }
        }
        if (req.session) {
          req.session.activeOrganizationId = created.id;
        }
        res.status(201).json({
          organizationId: created.id,
          organization: created,
          previousOrganizationId,
        });
      } catch (e) {
        console.error("POST /api/onboarding/bootstrap:", e);
        res.status(500).json({ message: "Onboarding failed" });
      }
    },
  );
}
