import type { Pool as PgPool } from "pg";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { appEnv } from "./config/env";
import { assertDisposableDatabaseUrl } from "./config/database-safety";
import { logger } from "./lib/logger";

const { Pool } = pg;

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (testDatabaseUrl) {
  assertDisposableDatabaseUrl(testDatabaseUrl);
}
const databaseUrl = testDatabaseUrl || appEnv.databaseUrl;
const sslMode = process.env.PGSSLMODE ?? databaseUrl.match(/[?&]sslmode=(\w+)/)?.[1];
const useDatabaseSsl =
  (databaseUrl.includes("neon.tech") && sslMode !== "disable") || sslMode === "require";

// TEST_DATABASE_URL is explicit and always takes precedence for test-owned processes.
const poolOptions = {
  connectionString: databaseUrl,
  ssl: useDatabaseSsl ? { rejectUnauthorized: false } : undefined,
  // Add connection pool settings
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let pool: PgPool;
let db: ReturnType<typeof drizzle>;

try {
  pool = new Pool(poolOptions);
  db = drizzle(pool, { schema });
  logger.info("Database pool initialized", {
    runtimeProfile: appEnv.runtimeProfile,
    ssl: useDatabaseSsl,
    disposableTestDatabase: Boolean(testDatabaseUrl),
  });
} catch (error) {
  logger.error("Failed to initialize database connection", {
    error: error instanceof Error ? error.message : String(error),
  });

  if (appEnv.isProduction || testDatabaseUrl) {
    throw new Error("Database connection failed. Please check your connection parameters.");
  } else {
    logger.warn("Database connection failed in development mode. Falling back to local dev database.");
    // Create fallback objects for non-production environments
    pool = new Pool({
      connectionString: "postgresql://postgres:postgres@localhost:5432/inventory_dev",
      ssl: undefined,
    }); 
    db = drizzle(pool, { schema });
  }
}

// Export the database objects
export { pool, db };
