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
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL environment variable must be set in production');
  } else {
    // Use a default local database URL for development
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/inventory_dev';
    console.warn('Using default development database URL. Please set DATABASE_URL for production.');
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
