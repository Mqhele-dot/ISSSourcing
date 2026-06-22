import type { Server } from "node:http";
import { checkLowStockAlerts, initializeWebSocketService } from "../websocket-service";
import { storage } from "../storage";
import { setWebsocketReady } from "../readiness";
import { appEnv } from "../config/env";
import { logger } from "../lib/logger";
import { startExportWorker } from "../modules/exports/export-worker";

export function startBackgroundTasks(server: Server): void {
  startExportWorker();

  const wsService = initializeWebSocketService(server, storage);
  setWebsocketReady(Boolean(wsService));

  let lowStockCheckInterval: NodeJS.Timeout;

  const setupLowStockAlertInterval = async () => {
    if (lowStockCheckInterval) {
      clearInterval(lowStockCheckInterval);
    }

    try {
      const appSettings = await storage.getAppSettings();

      const checkFrequencyMinutes = appSettings?.realTimeUpdatesEnabled
        ? appSettings?.lowStockAlertFrequency || 30
        : 30;

      logger.info("Setting up low stock alert checks", {
        checkFrequencyMinutes,
      });

      lowStockCheckInterval = setInterval(async () => {
        try {
          await checkLowStockAlerts();
        } catch (error) {
          logger.warn("Low stock check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, checkFrequencyMinutes * 60 * 1000);

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
      lowStockCheckInterval = setInterval(async () => {
        try {
          await checkLowStockAlerts();
        } catch (err) {
          logger.warn("Fallback low stock check failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, 30 * 60 * 1000);
    }
  };

  void setupLowStockAlertInterval();

  setInterval(() => {
    void setupLowStockAlertInterval();
  }, 24 * 60 * 60 * 1000);

  const exceptionScanMinutes = appEnv.operationalExceptionScanIntervalMinutes;
  if (exceptionScanMinutes > 0) {
    const safeMinutes = Math.max(5, exceptionScanMinutes);
    const ms = safeMinutes * 60 * 1000;
    logger.info("Operational exception scans enabled", { everyMinutes: safeMinutes });
    setInterval(async () => {
      try {
        const { runOperationalExceptionChecks } = await import("../operations-core");
        await runOperationalExceptionChecks("scheduler");
      } catch (err) {
        logger.warn("Scheduled operational exception scan failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, ms);
  }
}
