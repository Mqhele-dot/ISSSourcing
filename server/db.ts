import type { Pool as PgPool } from "pg";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { appEnv } from "./config/env";
import { logger } from "./lib/logger";

const { Pool } = pg;

// Create the database pool with the connection string
const poolOptions = {
  connectionString: appEnv.databaseUrl,
  ssl: appEnv.useDatabaseSsl ? { rejectUnauthorized: false } : undefined,
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
    ssl: appEnv.useDatabaseSsl,
  });
} catch (error) {
  logger.error("Failed to initialize database connection", {
    error: error instanceof Error ? error.message : String(error),
  });

  if (appEnv.isProduction) {
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