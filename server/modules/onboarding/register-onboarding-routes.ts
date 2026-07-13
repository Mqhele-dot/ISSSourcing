import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { organizationMembers, organizations } from "@shared/schema";
import { getOptionalTenantContext } from "../../organization-context";
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
