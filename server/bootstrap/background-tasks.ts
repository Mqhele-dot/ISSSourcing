import type { Server } from "node:http";
import { checkLowStockAlerts, initializeWebSocketService } from "../websocket-service";
import { storage } from "../storage";
import { setWebsocketReady } from "../readiness";
import { appEnv } from "../config/env";
import { logger } from "../lib/logger";
import { startExportWorker } from "../modules/exports/export-worker";
import { pool } from "../db";
import { runWithTenantContext } from "../organization-context";
import { runAuditIntegrityChecks } from "../services/audit-integrity-monitor";

export function startBackgroundTasks(server: Server): void {
  startExportWorker();

  const auditIntegrityIntervalMinutes = Math.max(60, Number(process.env.AUDIT_INTEGRITY_INTERVAL_MINUTES ?? 1440));
  void runAuditIntegrityChecks().catch((error) => {
    logger.warn("Initial audit chain integrity check failed", { error: error instanceof Error ? error.message : String(error) });
  });
  setInterval(() => {
    void runAuditIntegrityChecks().catch((error) => {
      logger.warn("Scheduled audit chain integrity check failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }, auditIntegrityIntervalMinutes * 60 * 1000);

  const fxIntervalMinutes = Math.max(60, Number(process.env.FX_IMPORT_INTERVAL_MINUTES ?? 1440));
  if (process.env.FX_PROVIDER_URL) {
    const runFxImport = async () => {
      try {
        const { importFxRatesForOrganizations } = await import("../modules/master-data/fx-provider-service");
        const result = await importFxRatesForOrganizations();
        logger.info("FX provider import completed", result);
      } catch (error) {
        logger.warn("FX provider import failed", { error: error instanceof Error ? error.message : String(error) });
      }
    };
    void runFxImport();
    setInterval(() => void runFxImport(), fxIntervalMinutes * 60 * 1000);
  }

  const wsService = initializeWebSocketService(server, storage);
  setWebsocketReady(Boolean(wsService));

  let lowStockCheckInterval: NodeJS.Timeout;

  const runLowStockChecksForActiveOrganizations = async () => {
    const organizations = await pool.query<{ id: number }>("SELECT id FROM organizations WHERE active = TRUE ORDER BY id");
    for (const organization of organizations.rows) {
      await runWithTenantContext({
        organizationId: organization.id,
        membershipId: 0,
        userId: 0,
        userRole: "system",
        membershipRole: "system",
        effectivePermissions: ["inventory:read", "notifications:create"],
        correlationId: `low-stock-scan-${organization.id}-${Date.now()}`,
        systemActor: { id: "low-stock-monitor", purpose: "scheduled tenant low-stock monitoring" },
      }, () => checkLowStockAlerts());
    }
  };

  const setupLowStockAlertInterval = async () => {
    if (lowStockCheckInterval) {
      clearInterval(lowStockCheckInterval);
    }

    try {
      const settings = await pool.query<{ low_stock_alert_frequency: number | null }>(`
        SELECT s.low_stock_alert_frequency
        FROM organizations o
        LEFT JOIN app_settings s ON s.organization_id = o.id
        WHERE o.active = TRUE AND COALESCE(s.real_time_updates_enabled, TRUE) = TRUE
      `);
      const checkFrequencyMinutes = Math.max(5, Math.min(30, ...settings.rows.map((row) => Number(row.low_stock_alert_frequency ?? 30))));

      logger.info("Setting up low stock alert checks", {
        checkFrequencyMinutes,
      });

      lowStockCheckInterval = setInterval(async () => {
        try {
          await runLowStockChecksForActiveOrganizations();
        } catch (error) {
          logger.warn("Low stock check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, checkFrequencyMinutes * 60 * 1000);

      try {
        await runLowStockChecksForActiveOrganizations();
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
          await runLowStockChecksForActiveOrganizations();
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
