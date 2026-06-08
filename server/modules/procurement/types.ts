import type { RequestHandler } from "express";

export type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
  ensureTwoFactorAuthenticated: RequestHandler;
};
