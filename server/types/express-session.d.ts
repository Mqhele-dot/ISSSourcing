import "express-session";

declare module "express-session" {
  interface SessionData {
    twoFactorAuthenticated?: boolean;
    /** Selected organization for multi-tenant APIs */
    activeOrganizationId?: number;
  }
}
