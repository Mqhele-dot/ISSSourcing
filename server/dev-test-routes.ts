import type { Express, NextFunction, Request, Response } from "express";
import { appEnv } from "./config/env";
import { allowDevOnlyRoutes } from "./lib/deployment-behavior";
import { storage } from "./storage";

/** Matches seeded demo admin in `server/seed.ts` (`ensureAdminUser`). */
const SEEDED_DEV_ADMIN_USERNAME = "admin";

const DEFAULT_POST_LOGIN = "/operations/control-tower";

const DEV_TEST_ROUTE_LIST = [
  "/operations/control-tower",
  "/inventory",
  "/warehouses",
  "/warehouse-operations",
  "/cycle-counts",
  "/reorder",
  "/barcode-scanner",
  "/procurement/purchase-orders",
  "/requisitions",
  "/suppliers",
  "/contracts",
  "/finance/accounts-payable",
  "/finance/payments",
  "/analytics/overview",
  "/admin/settings",
  "/system-diagnostics",
] as const;

function environmentLabel(): string {
  if (appEnv.isProduction) return "production";
  if (appEnv.isTest) return "test";
  return "development";
}

/** Single-segment internal path only; rejects protocol-relative and absolute URLs. */
export function safeInternalPath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const t = raw.trim();
  if (!t.startsWith("/")) return fallback;
  if (t.startsWith("//")) return fallback;
  if (t.includes("://")) return fallback;
  if (t.includes("\0")) return fallback;
  if (t === "/auth") return fallback;
  return t;
}

function stripPasswordForSession<T extends { password?: string | null }>(user: T) {
  const { password: _p, ...rest } = user;
  return rest;
}

export function registerDevTestRoutes(app: Express): void {
  app.get("/dev-test-status", (req: Request, res: Response) => {
    if (!allowDevOnlyRoutes()) {
      res.sendStatus(404);
      return;
    }
    const u = req.user as { email?: string | null } | undefined;
    const orgRaw = res.locals.organizationId;
    const orgId = typeof orgRaw === "number" && Number.isFinite(orgRaw) ? orgRaw : null;
    res.json({
      ok: true,
      app: "ISSSourcing",
      environment: environmentLabel(),
      authenticated: req.isAuthenticated(),
      userEmail: u?.email ?? null,
      orgId,
      recommendedEntry: "/dev-test-entry",
      recommendedLogin: "/dev-test-login",
      routes: [...DEV_TEST_ROUTE_LIST],
    });
  });

  app.get("/dev-test-entry", (req: Request, res: Response) => {
    if (!allowDevOnlyRoutes()) {
      res.sendStatus(404);
      return;
    }
    const target = safeInternalPath(req.query.redirect, DEFAULT_POST_LOGIN);
    if (req.isAuthenticated()) {
      res.redirect(302, target);
      return;
    }
    res.redirect(302, `/auth?next=${encodeURIComponent(target)}`);
  });

  app.get("/dev-test-login", (req: Request, res: Response, next: NextFunction) => {
    if (!allowDevOnlyRoutes()) {
      res.sendStatus(404);
      return;
    }
    if (!appEnv.devTestLoginEnabled) {
      res.sendStatus(404);
      return;
    }

    const target = safeInternalPath(req.query.redirect, DEFAULT_POST_LOGIN);

    void (async () => {
      try {
        const user = await storage.getUserByUsername(SEEDED_DEV_ADMIN_USERNAME);
        if (!user?.active) {
          res.status(409).json({
            ok: false,
            error: "DEV_USER_MISSING",
            message:
              "No active seeded development user (username: admin). Run database migrations and seed (e.g. npm run db:push && npm run db:seed), then retry.",
          });
          return;
        }

        const safeUser = stripPasswordForSession(user);
        req.login(safeUser, (err) => {
          if (err) {
            next(err);
            return;
          }
          if (user.twoFactorEnabled) {
            req.session.twoFactorAuthenticated = true;
          }
          res.redirect(302, target);
        });
      } catch (e) {
        next(e);
      }
    })();
  });
}
