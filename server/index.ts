import type { NextFunction, Response } from "express";
import express, { type Request } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeWebSocketService, checkLowStockAlerts } from "./websocket-service";
import { storage } from "./storage";
import { pool } from "./db";
import { initializeDatabase, ensureSessionTable } from "./init-db";
import { seedDatabaseIfEmpty } from "./seed";
import { initializeOperationalData } from "./operations-core";
import { initializeAccountsPayableData } from "./modules/accounts-payable/ap-ddl";
import { initializeExportCenterData } from "./modules/exports/export-center-ddl";
import { seedOperationalIfEmpty } from "./seed-operational";
import { setDbReady, setSchemaReady, setSessionStoreReady, setWebsocketReady } from "./readiness";
import { sendError } from "./api-response";
import type { PoolClient } from "pg";
import { appEnv } from "./config/env";
import { getBuildInfo } from "./lib/build-info";
import { logger } from "./lib/logger";
import { getMetricsSnapshot, incrementMetric, observeRequestLatency } from "./observability/metrics";
import { handleCSRFError } from "./services/security-service";
import { startExportWorker } from "./modules/exports/export-worker";

const app = express();

function registerSecurityMiddleware() {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "connect-src": ["'self'", "ws:", "wss:", "https:"],
          "script-src": ["'self'", "'unsafe-inline'"],
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

registerSecurityMiddleware();

async function verifyRequiredTables(client: PoolClient): Promise<void> {
  const result = await client.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [["organizations", "organization_settings", "users", "session"]],
  );
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = ["organizations", "organization_settings", "users", "session"].filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Required tables are missing: ${missing.join(", ")}`);
  }
}

async function initializeRuntime(): Promise<void> {
  const client = await pool.connect();
  try {
    setDbReady(true);
    logger.info("Database connection successful", {
      build: getBuildInfo(),
    });
    if (appEnv.allowStartupBootstrap) {
      await ensureSessionTable();
      setSessionStoreReady(true);
      await initializeDatabase();

      if (appEnv.autoSeedOnEmptyDb) {
        const seeded = await seedDatabaseIfEmpty();
        logger.info("Database seed check completed", { seeded });
      }

      await initializeOperationalData();
      await initializeAccountsPayableData();
      await initializeExportCenterData();
      const opSeed = await seedOperationalIfEmpty();
      setSchemaReady(true);
      logger.info("Development bootstrap completed", { opSeed });
    } else {
      await verifyRequiredTables(client);
      setSessionStoreReady(true);
      setSchemaReady(true);
      logger.info("Production startup verified migrations-only state");
    }
  } finally {
    client.release();
  }
}

(async () => {
  try {
    await initializeRuntime();
  } catch (err) {
    logger.error("Startup validation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  const server = await registerRoutes(app);
  startExportWorker();

  app.get("/metrics", (_req, res) => {
    res.json({
      ok: true,
      data: {
        build: getBuildInfo(),
        metrics: getMetricsSnapshot(),
      },
    });
  });

  // Initialize the WebSocket service for real-time inventory updates
  const wsService = initializeWebSocketService(server, storage);
  setWebsocketReady(Boolean(wsService));
  
  // Set up a periodic check for low stock alerts based on app settings
  let lowStockCheckInterval: NodeJS.Timeout;
  
  // Function to set up the low stock check interval
  const setupLowStockAlertInterval = async () => {
    // Clear existing interval if it exists
    if (lowStockCheckInterval) {
      clearInterval(lowStockCheckInterval);
    }
    
    try {
      // Get application settings
      const appSettings = await storage.getAppSettings();
      
      // Default to 30 minutes if not configured or real-time updates disabled
      const checkFrequencyMinutes = appSettings?.realTimeUpdatesEnabled 
        ? (appSettings?.lowStockAlertFrequency || 30)
        : 30;
      
      logger.info("Setting up low stock alert checks", {
        checkFrequencyMinutes,
      });
      
      // Set up the new interval using the checkLowStockAlerts function
      lowStockCheckInterval = setInterval(async () => {
        try {
          await checkLowStockAlerts();
        } catch (error) {
          logger.warn("Low stock check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, checkFrequencyMinutes * 60 * 1000);
      
      // Run an initial check for low stock items
      try {
        await checkLowStockAlerts();
      } catch (error) {
        logger.warn("Initial low stock check failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      logger.warn("Failed to configure low stock interval; using fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback to 30 minutes if there was an error
      lowStockCheckInterval = setInterval(async () => {
        try {
          await checkLowStockAlerts();
        } catch (error) {
          logger.warn("Fallback low stock check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, 30 * 60 * 1000);
    }
  };
  
  // Initial setup
  setupLowStockAlertInterval();
  
  // Set up a daily check to refresh the interval based on potentially updated settings
  setInterval(() => {
    setupLowStockAlertInterval();
  }, 24 * 60 * 60 * 1000);

  // Optional: periodic operational exception scans (same engine as POST /api/exceptions/run-checks)
  const exceptionScanMinutes = appEnv.operationalExceptionScanIntervalMinutes;
  if (exceptionScanMinutes > 0) {
    const safeMinutes = Math.max(5, exceptionScanMinutes);
    const ms = safeMinutes * 60 * 1000;
    logger.info("Operational exception scans enabled", { everyMinutes: safeMinutes });
    setInterval(async () => {
      try {
        const { runOperationalExceptionChecks } = await import("./operations-core");
        await runOperationalExceptionChecks("scheduler");
      } catch (err) {
        logger.warn("Scheduled operational exception scan failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, ms);
  }

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err?.code === "EBADCSRFTOKEN") {
      return handleCSRFError(err, req, res, next);
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.locals.errorCode = status >= 500 ? "UNHANDLED_SERVER_ERROR" : "REQUEST_FAILED";
    logger.error("Unhandled request error", {
      requestId: res.locals?.requestId,
      route: req.path,
      method: req.method,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
    sendError(
      res,
      status,
      status >= 500 ? "UNHANDLED_SERVER_ERROR" : "REQUEST_FAILED",
      message,
      { details: appEnv.isProduction ? undefined : err?.stack },
    );
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
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

  server.listen(port, host, () => {
    const isDev = appEnv.isDevelopment;
    const bannerLine = "=".repeat(76);
    console.log(`\n${bannerLine}`);
    console.log("  ISS Sourcing — web app (API + static/Vite)");
    console.log(`  Browser URL:  ${localUrl}`);
    console.log(`  Port:         ${port}   (set PORT in .env to change; default 5000)`);
    console.log(`  Health check: ${localUrl}/api/ready`);
    if (forwardedUrl) {
      console.log(`  Codespaces:   ${forwardedUrl}`);
    }
    if (isDev) {
      const urlFile = path.join(process.cwd(), ".local-dev-url");
      try {
        fs.writeFileSync(
          urlFile,
          `# Written on server start — open this file to copy the app URL\nAPP_URL=${localUrl}\nPORT=${port}\n`,
          "utf8",
        );
        console.log(`  URL file:     ${urlFile}  (gitignored, for copy/paste)`);
      } catch {
        // ignore disk errors
      }
    }
    console.log(`${bannerLine}\n`);

    log(`serving on ${host}:${port}`);
    log(`Startup URL (local): ${localUrl}`);
    if (forwardedUrl) {
      log(`Startup URL (Codespaces): ${forwardedUrl}`);
    }
    log(`WebSocket server for real-time inventory sync is active`);
    logger.info("Server listening", {
      host,
      port,
      build: getBuildInfo(),
      runtimeProfile: appEnv.runtimeProfile,
    });
  });
  

})();
