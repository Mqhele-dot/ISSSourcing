import { db, pool } from './db';
import { 
  inventoryItems,
  warehouses,
  categories,
  suppliers,
  users,
  permissions,
  stockMovements,
  appSettings
} from '@shared/schema';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PgTable } from 'drizzle-orm/pg-core';

const execAsync = promisify(exec);

/** Create the "session" table required by connect-pg-simple (Express session store). */
async function ensureSessionTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        PRIMARY KEY ("sid")
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    console.log('Session table (connect-pg-simple) ready');
  } catch (err) {
    console.warn('Could not ensure session table:', err instanceof Error ? err.message : err);
  }
}

/**
 * Initializes the database by ensuring all required tables exist
 * This is called during application startup to prepare the database
 */
export async function initializeDatabase(): Promise<boolean> {
  console.log('Initializing database schema...');

  await ensureSessionTable();

  try {
    // Check if users table exists by trying to query it
    const userCount = await db.select().from(users).limit(1);
    console.log(`Database already initialized with tables existing`);
    return true;
  } catch (error) {
    console.log('Tables do not exist, creating schema...');
    
    try {
      // Run the database schema push using drizzle-kit
      console.log('Running drizzle-kit push to create database schema...');
      
      try {
        const { stdout, stderr } = await execAsync('npx drizzle-kit push');
        console.log('Schema push successful:');
        console.log(stdout);
        
        if (stderr) {
          console.warn('Schema push warnings:', stderr);
        }
        
        return true;
      } catch (error) {
        if (error instanceof Error) {
          console.error('Failed to execute drizzle-kit push:', error.message);
        } else {
          console.error('Failed to execute drizzle-kit push:', error);
        }
        console.log('Please run "npm run db:push" manually to create the database schema');
        return false;
      }
    } catch (dbError) {
      console.error('Failed to initialize database schema:', dbError);
      return false;
    }
  }
}