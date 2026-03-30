import type { NextFunction, Request, Response } from "express";
import type { Session } from "express-session";
import { organizationAsyncLocalStorage, DEFAULT_ORGANIZATION_ID } from "../organization-context";

type SessionWithOrg = Session & { activeOrganizationId?: number };

/**
 * Binds AsyncLocalStorage org scope for the rest of the request.
 * Prefer session.activeOrganizationId, then user's defaultOrganizationId, else default org 1.
 */
export function organizationContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as SessionWithOrg | undefined;
  const user = req.user as { defaultOrganizationId?: number | null } | undefined;

  let organizationId = DEFAULT_ORGANIZATION_ID;
  if (session?.activeOrganizationId && Number.isFinite(session.activeOrganizationId)) {
    organizationId = session.activeOrganizationId;
  } else if (user?.defaultOrganizationId != null && Number.isFinite(user.defaultOrganizationId)) {
    organizationId = user.defaultOrganizationId;
  }

  res.locals.organizationId = organizationId;
  organizationAsyncLocalStorage.run({ organizationId }, () => next());
}
