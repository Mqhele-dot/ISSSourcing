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
import { registerDevTestRoutes } from "./dev-test-routes";
import {
  getServerDiagnosticEvents,
  recordServerDiagnosticEvent,
  registerProcessDiagnosticHandlers,
} from "./diagnostics/server-diagnostics-store";
import { readiness, setDbReady, setSchemaReady, setSessionStoreReady, setWebsocketReady } from "./readiness";

const app = express();
let startupFailure: { message: string; stack?: string; at: string } | null = null;

registerProcessDiagnosticHandlers();

registerRequestContextMiddleware(app);
registerSecurityMiddleware(app);

app.get(["/startup-diagnostics", "/api/startup-diagnostics"], (_req, res) => {
  res.status(startupFailure ? 503 : 200).json({
    ok: !startupFailure,
    startupFailure,
    readiness,
    events: getServerDiagnosticEvents().filter((event) => event.source === "startup").slice(0, 20),
  });
});

(async () => {
  try {
    await initializeRuntime();
  } catch (err) {
    const { logger } = await import("./lib/logger");
    const message = err instanceof Error ? err.message : String(err);
    startupFailure = {
      message,
      stack: err instanceof Error ? err.stack : undefined,
      at: new Date().toISOString(),
    };
    setDbReady(false);
    setSchemaReady(false);
    setSessionStoreReady(false);
    setWebsocketReady(false);
    recordServerDiagnosticEvent({
      severity: "critical",
      source: "startup",
      title: "Startup validation failed",
      message,
      stack: err instanceof Error ? err.stack : undefined,
      details: err,
    });
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
      "[FATAL] Check DATABASE_URL / PG* / migrations, then run again.\n",
    );
    if (!appEnv.isDevelopment && appEnv.deploymentMode !== "test") {
      process.exit(1);
    }
    console.error("[RECOVERY] Development/Codespaces mode: continuing so diagnostics and app shell can be served.\n");
  }

  const server = await registerRoutes(app);

  registerMetricsRoute(app);
  startBackgroundTasks(server);

  registerGlobalErrorHandler(app);

  registerDevTestRoutes(app);

  if (appEnv.isDevelopment && process.env.LOCAL_DEV_STATIC === "1") {
    serveStatic(app);
  } else if (appEnv.isDevelopment && process.env.LOCAL_TEST_API_ONLY !== "1") {
    await setupVite(app, server);
  } else if (!appEnv.isDevelopment) {
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
