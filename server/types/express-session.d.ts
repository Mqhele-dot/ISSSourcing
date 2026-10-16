import "express-session";

declare module "express-session" {
  interface SessionData {
    twoFactorAuthenticated?: boolean;
    /** Session-bound CSRF token issued to the web client and checked on state-changing API requests. */
    csrfToken?: string;
    /** Selected organization for multi-tenant APIs */
    activeOrganizationId?: number;
  }
}
