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
export async function ensureSessionTable(): Promise<void> {
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

const CONTRACT_DATE_CONSTRAINT_NAME = 'supplier_contracts_end_date_check';

/** Ensure supplier_contracts has a check constraint: end_date must be null or >= start_date. */
export async function ensureContractDateConstraint(): Promise<void> {
  try {
    const r = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'supplier_contracts' AND c.conname = $1
      ) AS exists
    `, [CONTRACT_DATE_CONSTRAINT_NAME]);
    if (r.rows[0]?.exists) {
      return;
    }
    await pool.query(`
      ALTER TABLE supplier_contracts
      ADD CONSTRAINT supplier_contracts_end_date_check
      CHECK (end_date IS NULL OR end_date >= start_date)
    `);
    console.log('Contract date constraint (end_date >= start_date) applied');
  } catch (err) {
    console.warn('Could not ensure contract date constraint:', err instanceof Error ? err.message : err);
  }
}

/** Ensure purchase_requisitions and purchase_requisition_items tables exist (for environments where drizzle-kit push has not run). */
export async function ensurePurchaseRequisitionsTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id SERIAL PRIMARY KEY,
        requisition_number TEXT NOT NULL UNIQUE,
        requestor_id INTEGER,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        notes TEXT,
        required_date TIMESTAMP,
        supplier_id INTEGER,
        total_amount REAL NOT NULL DEFAULT 0,
        shared_with_user_ids JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        approver_id INTEGER,
        approval_date TIMESTAMP,
        rejection_reason TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id SERIAL PRIMARY KEY,
        requisition_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        notes TEXT
      )
    `);
    console.log('Purchase requisitions tables ready');
  } catch (err) {
    console.warn('Could not ensure purchase requisitions tables:', err instanceof Error ? err.message : err);
  }
}

/**
 * Initializes the database by ensuring all required tables exist
 * This is called during application startup to prepare the database
 */
export async function initializeDatabase(): Promise<boolean> {
  console.log('Initializing database schema...');

  await ensureSessionTable();
  await ensureContractDateConstraint();
  await ensurePurchaseRequisitionsTables();

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