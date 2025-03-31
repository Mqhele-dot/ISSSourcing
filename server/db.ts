import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Default connection string format: postgresql://username:password@host:port/database
const DEFAULT_CONNECTION_STRING = 'postgresql://username:password@host:port/database';

console.log('Connecting to database...');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is not set');
  console.error('Please add DATABASE_URL to your deployment configuration:');
  console.error('1. Go to the Deployments tab');
  console.error('2. Click on Configuration');
  console.error('3. Under Secrets, add DATABASE_URL with your database connection string in the format:');
  console.error(`   ${DEFAULT_CONNECTION_STRING}`);
  
  // Instead of throwing an error, attempt to use fallback environment variables
  if (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE) {
    const port = process.env.PGPORT || '5432';
    process.env.DATABASE_URL = `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${port}/${process.env.PGDATABASE}`;
    console.log('Created DATABASE_URL from individual PostgreSQL environment variables');
  } else {
    throw new Error('DATABASE_URL environment variable must be set');
  }
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});
export const db = drizzle({ client: pool, schema });

// Log connection status but not the actual connection string for security
console.log('Database connection initialized');
console.log('Connection format example:', DEFAULT_CONNECTION_STRING);
