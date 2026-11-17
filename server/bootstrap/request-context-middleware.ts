import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { incrementMetric, observeRequestLatency } from "../observability/metrics";
import { logger } from "../lib/logger";

export function registerRequestContextMiddleware(app: Express): void {
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const routePath = req.path;

    res.on("finish", () => {
      const duration = Date.now() - start;
      observeRequestLatency(duration);
      incrementMetric("requests.total");
      if (res.statusCode >= 400) {
        incrementMetric("requests.errors");
      }
      if (routePath.startsWith("/api")) {
        logger.info("HTTP request completed", {
          requestId: String(res.locals?.requestId ?? "-"),
          method: req.method,
          route: routePath,
          status: res.statusCode,
          durationMs: duration,
          orgId: res.locals?.orgId ?? null,
          userId: (req as Request & { user?: { id?: number } }).user?.id ?? null,
          errorCode: res.locals?.errorCode ?? null,
        });
      }
    });

    next();
  });
}
