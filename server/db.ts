import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

console.log('Connecting to database...');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is not set. Please add it to your deployment configuration in the Secrets section.');
  throw new Error('Missing DATABASE_URL configuration');
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});
export const db = drizzle({ client: pool, schema });
