import type { Response, NextFunction } from "express";
import express, { type Request } from "express";
import { randomUUID } from "node:crypto";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeWebSocketService, checkLowStockAlerts } from "./websocket-service";
import { storage } from "./storage";
import { pool } from "./db";
import { initializeDatabase, ensureSessionTable } from "./init-db";
import { seedDatabaseIfEmpty } from "./seed";
import { initializeOperationalData } from "./operations-core";
import { seedOperationalIfEmpty } from "./seed-operational";
import { setDbReady, setSchemaReady, setSessionStoreReady, setWebsocketReady } from "./readiness";
import { sendError } from "./api-response";
import type { PoolClient } from "pg";

// Non-blocking: init DB and schema in background so server can start immediately.
pool.connect()
  .then(async (client: PoolClient) => {
    setDbReady(true);
    console.log("✅ Database connection successful");
    console.log(`Connection format: postgresql://username:password@host:port/database`);
    client.release();

    try {
      await ensureSessionTable();
      setSessionStoreReady(true);
    } catch (sessionErr) {
      setSessionStoreReady(false);
      console.warn("Session table check failed:", sessionErr instanceof Error ? sessionErr.message : sessionErr);
    }

    try {
      await initializeDatabase();
      console.log("✅ Database schema initialized");

      const autoSeedEnabled =
        process.env.AUTO_SEED_ON_EMPTY_DB === "true" ||
        (process.env.AUTO_SEED_ON_EMPTY_DB !== "false" && process.env.NODE_ENV !== "production");

      if (autoSeedEnabled) {
        const seeded = await seedDatabaseIfEmpty();
        if (seeded) {
          console.log("✅ Demo data seeded (database was empty)");
        } else {
          console.log("ℹ️ Demo data seeding skipped (existing data detected)");
        }
      }

      await initializeOperationalData();
      const opSeed = await seedOperationalIfEmpty();
      setSchemaReady(true);
      console.log("✅ Operational workflow schema initialized");
      if (opSeed.purchaseOrders > 0 || opSeed.shipments > 0) {
        console.log("✅ Operational demo data seeded:", opSeed);
      }
    } catch (schemaError) {
      console.error("⚠️ Database schema initialization failed:", schemaError);
      console.error("The application may not function correctly without a properly initialized database");
    }
  })
  .catch((err: Error) => {
    console.error("❌ Failed to connect to database:", err.message);
    console.error("Please check your DATABASE_URL connection string in the format:");
    console.error("postgresql://username:password@host:port/database");
    console.error("For more details, see DATABASE_SETUP.md");
    console.warn("⚠️ Running with limited functionality due to database connection failure");
  });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const requestId = String(res.locals?.requestId ?? "-");
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      logLine += ` [req:${requestId}]`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

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
      
      console.log(`Setting up low stock alert checks every ${checkFrequencyMinutes} minutes`);
      
      // Set up the new interval using the checkLowStockAlerts function
      lowStockCheckInterval = setInterval(async () => {
        try {
          await checkLowStockAlerts();
        } catch (error) {
          console.error('Error checking low stock:', error);
        }
      }, checkFrequencyMinutes * 60 * 1000);
      
      // Run an initial check for low stock items
      try {
        await checkLowStockAlerts();
      } catch (error) {
        console.error('Error running initial low stock check:', error);
      }
    } catch (error) {
      console.error('Error setting up low stock alert interval:', error);
      // Fallback to 30 minutes if there was an error
      lowStockCheckInterval = setInterval(async () => {
        try {
          await checkLowStockAlerts();
        } catch (error) {
          console.error('Error checking low stock:', error);
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    sendError(
      res,
      status,
      status >= 500 ? "UNHANDLED_SERVER_ERROR" : "REQUEST_FAILED",
      message,
      { details: process.env.NODE_ENV === "production" ? undefined : err?.stack },
    );
    // Do not rethrow from Express error middleware; crashing here causes flaky 502s.
    if (process.env.NODE_ENV !== "production") {
      console.error("Unhandled request error:", err);
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 5000);
  const localReachableHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const localUrl = `http://${localReachableHost}:${port}`;
  const forwardedUrl =
    process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
      ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
      : null;

  server.listen(port, host, () => {
    log(`serving on ${host}:${port}`);
    log(`Startup URL (local): ${localUrl}`);
    if (forwardedUrl) {
      log(`Startup URL (Codespaces): ${forwardedUrl}`);
    }
    log(`WebSocket server for real-time inventory sync is active`);
  });
  

})();
