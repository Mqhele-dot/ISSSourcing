import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { appEnv } from "./config/env";
import { registerRequestContextMiddleware } from "./bootstrap/request-context-middleware";
import { registerSecurityMiddleware } from "./bootstrap/security-middleware";
import { initializeRuntime } from "./bootstrap/runtime-init";
import { registerMetricsRoute } from "./bootstrap/metrics-route";
import { startBackgroundTasks } from "./bootstrap/background-tasks";
import { registerGlobalErrorHandler } from "./bootstrap/global-error-handler";
import { attachStartupBannerListener } from "./bootstrap/startup-banner";

const app = express();

registerRequestContextMiddleware(app);
registerSecurityMiddleware(app);

(async () => {
  try {
    await initializeRuntime();
  } catch (err) {
    const { logger } = await import("./lib/logger");
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Startup validation failed", {
      error: message,
    });
    console.error("\n[FATAL] Server stopped during initializeRuntime() (DB bootstrap / env validation).");
    console.error(`[FATAL] ${message}`);
    if (err instanceof Error && err.stack) {
      console.error("[FATAL] Stack:");
      console.error(err.stack);
    }
    console.error(
      "[FATAL] Check DATABASE_URL / PG* / migrations, then run again. E2E wrapper will fail fast if this exits.\n",
    );
    process.exit(1);
  }

  const server = await registerRoutes(app);

  registerMetricsRoute(app);
  startBackgroundTasks(server);

  registerGlobalErrorHandler(app);

  if (appEnv.isDevelopment) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const host = appEnv.host;
  const port = appEnv.port;
  const localReachableHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const localUrl = `http://${localReachableHost}:${port}`;
  const forwardedUrl =
    process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
      ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
      : null;

  attachStartupBannerListener(server, { host, port, localUrl, forwardedUrl });
})();
