import type { NextFunction, Request, Response } from "express";
import type { Session } from "express-session";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { organizationMembers, organizations } from "@shared/schema";
import { organizationAsyncLocalStorage, type TenantContext } from "../organization-context";
import { sendError } from "../api-response";

type SessionWithOrg = Session & { activeOrganizationId?: number };

/**
 * Binds a verified organization membership to the request. Authenticated API calls fail closed
 * when the user has no active membership; unauthenticated auth/bootstrap routes continue normally.
 */
export async function organizationContextMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = req.session as SessionWithOrg | undefined;
  const user = req.user as { id?: number; role?: string; defaultOrganizationId?: number | null } | undefined;
  if (!req.isAuthenticated?.() || !user?.id) {
    next();
    return;
  }

  try {
    const requestedOrganizationId =
      session?.activeOrganizationId && Number.isFinite(session.activeOrganizationId)
        ? Number(session.activeOrganizationId)
        : user.defaultOrganizationId != null && Number.isFinite(user.defaultOrganizationId)
          ? Number(user.defaultOrganizationId)
          : null;

    const memberships = await db
      .select({
        membershipId: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        membershipRole: organizationMembers.role,
        applicationRole: organizationMembers.applicationRole,
        membershipActive: organizationMembers.active,
        organizationActive: organizations.active,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        requestedOrganizationId
          ? and(
              eq(organizationMembers.userId, user.id),
              eq(organizationMembers.organizationId, requestedOrganizationId),
            )
          : eq(organizationMembers.userId, user.id),
      );

    const membership = memberships.find((row) => row.membershipActive && row.organizationActive);
    if (!membership) {
      const onboardingAllowed = req.path === "/api/onboarding/bootstrap" || req.path === "/api/logout" || req.path === "/api/user";
      if (onboardingAllowed) {
        next();
        return;
      }
      sendError(res, 403, "MEMBERSHIP_NOT_ACTIVE", "No active organization membership is available for this account.", {
        hint: "Ask an organization administrator to reactivate your membership, or complete organization setup.",
      });
      return;
    }

    if (session) session.activeOrganizationId = membership.organizationId;
    const context: TenantContext = {
      organizationId: membership.organizationId,
      membershipId: membership.membershipId,
      userId: user.id,
      userRole: String(membership.applicationRole ?? user.role ?? "viewer"),
      membershipRole: membership.membershipRole,
      effectivePermissions: [],
      correlationId: String(res.locals.requestId ?? res.getHeader("X-Request-Id") ?? "unknown-request-id"),
    };
    res.locals.organizationId = context.organizationId;
    res.locals.tenantContext = context;
    organizationAsyncLocalStorage.run(context, () => next());
  } catch (error) {
    next(error);
  }
}
