import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Default connection string format: postgresql://username:password@host:port/database
const DEFAULT_CONNECTION_STRING = 'postgresql://username:password@host:port/database';

// Function to build connection string from individual environment variables
function buildConnectionStringFromEnv(): string | undefined {
  const host = process.env.PGHOST;
  const port = process.env.PGPORT || '5432';
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;

  if (!host || !database || !user || !password) {
    return undefined;
  }

  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

console.log('Connecting to database...');
let connectionString: string | undefined = process.env.DATABASE_URL;

// If DATABASE_URL is not provided, try to construct from individual params
if (!connectionString) {
  console.warn('DATABASE_URL environment variable is not set');
  connectionString = buildConnectionStringFromEnv();

  if (connectionString) {
    console.log('Using database connection string built from individual parameters');
    process.env.DATABASE_URL = connectionString;
  } else {
    // No valid connection parameters found
    if (process.env.NODE_ENV === 'production') {
      throw new Error('No valid database connection parameters found. Please set DATABASE_URL or individual Postgres parameters (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT)');
    } else {
      // Use a default local database URL for development
      connectionString = 'postgresql://postgres:postgres@localhost:5432/inventory_dev';
      process.env.DATABASE_URL = connectionString;
      console.warn('Using default development database URL. Please set DATABASE_URL or individual Postgres parameters for production.');
    }
  }
}

// Create the database pool with the connection string
const poolOptions = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  // Add connection pool settings
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let pool: Pool;
let db: ReturnType<typeof drizzle>;

try {
  pool = new Pool(poolOptions);
  db = drizzle({ client: pool, schema });

  // Log connection status but not the actual connection string for security
  console.log('Database connection initialized');
  console.log('Database connection string format: postgresql://user:pass@host:port/db');
} catch (error) {
  console.error('Failed to initialize database connection:', error instanceof Error ? error.message : error);

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Database connection failed. Please check your connection parameters.');
  } else {
    console.warn('Database connection failed in development mode. Some features may not work correctly.');
    // Create fallback objects for non-production environments
    pool = new Pool({
      connectionString: 'postgresql://postgres:postgres@localhost:5432/inventory_dev',
      ssl: undefined
    }); 
    db = drizzle({ client: pool, schema });
  }
}

// Export the database objects
export { pool, db };