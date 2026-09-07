import type { PoolClient } from "pg";
import { pool } from "../db";
import { initializeDatabase, ensureSessionTable } from "../init-db";
import { seedDatabaseIfEmpty } from "../seed";
import { initializeOperationalData } from "../operations-core";
import { initializeAccountsPayableData } from "../modules/accounts-payable/ap-ddl";
import { initializeExportCenterData } from "../modules/exports/export-center-ddl";
import { initializeProcurementCompletionData } from "../modules/procurement-completion/ddl";
import { initializeShipmentInventoryCompletion } from "../modules/inventory-flow/ddl";
import { seedOperationalIfEmpty } from "../seed-operational";
import { setDbReady, setSchemaReady, setSessionStoreReady } from "../readiness";
import { appEnv } from "../config/env";
import { getBuildInfo } from "../lib/build-info";
import { logger } from "../lib/logger";

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

export async function initializeRuntime(): Promise<void> {
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
      await initializeProcurementCompletionData();
      await initializeShipmentInventoryCompletion();
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
