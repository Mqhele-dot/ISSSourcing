import type { Express, NextFunction, Request, Response } from "express";
import { sendError } from "../api-response";
import { appEnv } from "../config/env";
import { logger } from "../lib/logger";
import { handleCSRFError } from "../services/security-service";
import { recordServerDiagnosticEvent } from "../diagnostics/server-diagnostics-store";
import { TenantContextError } from "../organization-context";

export function registerGlobalErrorHandler(app: Express): void {
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const e = err as { code?: string; status?: number; statusCode?: number; message?: string; stack?: string };
    if (e?.code === "EBADCSRFTOKEN") {
      return handleCSRFError(err, req, res, next);
    }
    if (err instanceof TenantContextError) {
      return sendError(res, 403, err.code, err.message, {
        hint: "Select an active organization or ask an administrator to restore your membership.",
      });
    }
    const status = e?.status || e?.statusCode || 500;
    const internalMessage = e?.message || "Internal Server Error";
    const message = status >= 500 ? "The request could not be completed." : internalMessage;
    res.locals.errorCode = status >= 500 ? "UNHANDLED_SERVER_ERROR" : "REQUEST_FAILED";
    logger.error("Unhandled request error", {
      requestId: res.locals?.requestId,
      route: req.path,
      method: req.method,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
    recordServerDiagnosticEvent({
      severity: status >= 500 ? "error" : "warning",
      source: "request",
      title: "Unhandled request error",
      message: internalMessage,
      route: req.path,
      method: req.method,
      status,
      stack: appEnv.isProduction ? undefined : e?.stack,
      details: {
        requestId: res.locals?.requestId,
      },
    });
    sendError(
      res,
      status,
      status >= 500 ? "UNHANDLED_SERVER_ERROR" : "REQUEST_FAILED",
      message,
      { details: appEnv.isProduction ? undefined : e?.stack },
    );
  });
}
