import type { Express, Response } from "express";
import express from "express";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { appEnv } from "../config/env";

export function registerSecurityMiddleware(app: Express): void {
  const allowUnsafeInlineScripts = !appEnv.isProduction;

  app.use((_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString("base64");
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "connect-src": ["'self'", "ws:", "wss:", "https:"],
          "script-src": allowUnsafeInlineScripts
            ? ["'self'", "'unsafe-inline'"]
            : ["'self'", (_req, res) => `'nonce-${String((res as Response).locals?.cspNonce ?? "")}'`],
        },
      },
      referrerPolicy: { policy: "no-referrer" },
      frameguard: { action: "sameorigin" },
      hsts: appEnv.isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: false,
          }
        : false,
    }),
  );
  app.disable("x-powered-by");
  app.use(express.json({ limit: appEnv.requestLimits.json }));
  app.use(express.urlencoded({ extended: false, limit: appEnv.requestLimits.form }));
  app.use(express.text({ type: "text/*", limit: appEnv.requestLimits.text }));
}
