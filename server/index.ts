import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeWebSocketService, checkLowStockAlerts } from "./websocket-service";
import { storage } from "./storage";
import { pool } from "./db";

// Test database connection on startup
pool.connect()
  .then(client => {
    console.log("✅ Database connection successful");
    console.log(`Connection format: postgresql://username:password@host:port/database`);
    client.release();
  })
  .catch(err => {
    console.error("❌ Failed to connect to database:", err.message);
    console.error("Please check your DATABASE_URL connection string in the format:");
    console.error("postgresql://username:password@host:port/database");
    console.error("For more details, see DATABASE_SETUP.md");
  });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
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

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    log(`WebSocket server for real-time inventory sync is active`);
  });
})();
