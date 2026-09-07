import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";
import { sendError } from "../api-response";
import { appEnv } from "../config/env";
import { logger } from "../lib/logger";
import { storage } from "../storage";

function getRateLimiterKey(req: Request, includeUsername = false): string {
  const ip = req.ip || req.connection.remoteAddress || "unknown-ip";
  if (includeUsername && typeof req.body?.username === "string") {
    return `${ip}:${req.body.username.toLowerCase()}`;
  }
  return ip;
}

function setRetryHeaders(res: Response, error: RateLimiterRes): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((error.msBeforeNext ?? 1000) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
}

function createLimiter(points: number, durationSeconds = appEnv.rateLimits.windowSeconds): RateLimiterMemory {
  return new RateLimiterMemory({
    points,
    duration: durationSeconds,
    blockDuration: durationSeconds,
  });
}

const loginLimiter = createLimiter(appEnv.rateLimits.authPoints, 15 * 60);
const registerLimiter = createLimiter(Math.max(3, Math.floor(appEnv.rateLimits.authPoints / 2)), 60 * 60);
const emailVerificationLimiter = createLimiter(appEnv.rateLimits.authPoints, 60 * 60);
const passwordResetLimiter = createLimiter(Math.max(3, Math.floor(appEnv.rateLimits.authPoints / 2)), 60 * 60);
const apiLimiter = createLimiter(100);
const exportLimiter = createLimiter(appEnv.rateLimits.exportPoints);
const uploadLimiter = createLimiter(appEnv.rateLimits.uploadPoints);
const analyticsLimiter = createLimiter(appEnv.rateLimits.analyticsPoints);

async function runLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
  limiter: RateLimiterMemory,
  message: string,
  options?: { includeUsername?: boolean; code?: string },
) {
  try {
    const key = getRateLimiterKey(req, options?.includeUsername);
    await limiter.consume(key);
    next();
  } catch (error) {
    const rateError = error as RateLimiterRes;
    if (typeof rateError?.msBeforeNext === "number") {
      setRetryHeaders(res, rateError);
      return sendError(res, 429, options?.code ?? "RATE_LIMITED", message);
    }
    next(error);
  }
}

function getSessionCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

function readRequestCsrfToken(req: Request): string {
  return (
    req.get("x-csrf-token") ??
    req.get("csrf-token") ??
    (typeof req.body?._csrf === "string" ? req.body._csrf : "")
  );
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function issueCsrfToken(req: Request, res: Response): void {
  if (sendErrorIfSessionUnavailable(req, res)) {
    return;
  }
  res.json({ csrfToken: getSessionCsrfToken(req) });
}

function sendErrorIfSessionUnavailable(req: Request, res: Response): true | undefined {
  if (req.session) return undefined;
  sendError(res, 500, "SESSION_UNAVAILABLE", "Session is not available for CSRF protection.");
  return true;
}

export function csrfBypassForReadOnlyMethods(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  if (sendErrorIfSessionUnavailable(req, res)) {
    return;
  }

  const expected = getSessionCsrfToken(req);
  const actual = readRequestCsrfToken(req);
  if (!actual || !constantTimeEquals(actual, expected)) {
    return sendError(res, 403, "CSRF_TOKEN_INVALID", "Invalid or expired form submission.", {
      hint: "Refresh the page and try again.",
    });
  }

  return next();
}

export function handleCSRFError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (!err || typeof err !== "object" || !("code" in err) || (err as { code?: string }).code !== "EBADCSRFTOKEN") {
    return next(err);
  }

  return sendError(res, 403, "CSRF_TOKEN_INVALID", "Invalid or expired form submission.", {
    hint: "Refresh the page and try again.",
  });
}

export function shouldProtectAgainstCsrf(pathname: string): boolean {
  if (!pathname.startsWith("/api")) return false;
  if (pathname.startsWith("/api/csrf-token")) return false;
  if (pathname.startsWith("/api/export/download/")) return false;
  return true;
}

export const loginRateLimiter: RequestHandler = (req, res, next) => {
  if (process.env.DISABLE_LOGIN_RATE_LIMITER === "true") return next();
  return runLimiter(req, res, next, loginLimiter, "Too many login attempts. Please try again later.", {
    includeUsername: true,
    code: "AUTH_RATE_LIMITED",
  });
};

export async function clearLoginRateLimit(req: Request): Promise<void> {
  const key = getRateLimiterKey(req, true);
  await loginLimiter.delete(key);
}

export const registerRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, registerLimiter, "Too many registration attempts. Please try again later.", {
    code: "REGISTER_RATE_LIMITED",
  });

export const emailVerificationRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, emailVerificationLimiter, "Too many verification attempts. Please try again later.", {
    code: "EMAIL_VERIFICATION_RATE_LIMITED",
  });

export const passwordResetRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, passwordResetLimiter, "Too many password reset attempts. Please try again later.", {
    code: "PASSWORD_RESET_RATE_LIMITED",
  });

export const apiRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, apiLimiter, "Too many requests. Please try again later.");

export const exportRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, exportLimiter, "Too many export requests. Please try again later.", {
    code: "EXPORT_RATE_LIMITED",
  });

export const uploadRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, uploadLimiter, "Too many upload requests. Please try again later.", {
    code: "UPLOAD_RATE_LIMITED",
  });

export const analyticsRateLimiter: RequestHandler = (req, res, next) =>
  runLimiter(req, res, next, analyticsLimiter, "Too many analytics requests. Please try again later.", {
    code: "ANALYTICS_RATE_LIMITED",
  });

export function applyStateChangingCsrfProtection(req: Request, res: Response, next: NextFunction) {
  if (!shouldProtectAgainstCsrf(req.path)) {
    return next();
  }
  return csrfBypassForReadOnlyMethods(req, res, next);
}

export async function detectSuspiciousActivity(
  userId: number,
  ipAddress: string,
  userAgent: string,
): Promise<boolean> {
  try {
    const hasUsedIpBefore = await storage.hasUserUsedIpBefore(userId, ipAddress);
    const hasUsedUserAgentBefore = await storage.hasUserUsedUserAgentBefore(userId, userAgent);
    const recentFailedAttempts = await storage.getFailedLoginAttempts(userId, 24);
    const hasMultipleFailedAttempts = recentFailedAttempts.length >= 3;

    await storage.logUserAccess({
      userId,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      action: "login",
      details: {
        isSuspicious: !hasUsedIpBefore || !hasUsedUserAgentBefore || hasMultipleFailedAttempts,
      },
    });

    return !hasUsedIpBefore || !hasUsedUserAgentBefore || hasMultipleFailedAttempts;
  } catch (error) {
    logger.warn("Suspicious activity detection failed", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
    return false;
  }
}
