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

/** Add tax_identification_number to suppliers table if missing (for legal/compliance). */
export async function ensureSuppliersTaxIdColumn(): Promise<void> {
  try {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'suppliers' AND column_name = 'tax_identification_number'
    `);
    if (r.rows.length > 0) return;
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_identification_number TEXT`);
    console.log('Suppliers tax_identification_number column ready');
  } catch (err) {
    console.warn('Could not ensure suppliers tax ID column:', err instanceof Error ? err.message : err);
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

/** Ensure roadmap tables/columns exist for professional supply chain features. */
export async function ensureProfessionalSupplyChainTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS units_of_measure (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT,
        base_unit_id INTEGER,
        system TEXT DEFAULT 'custom',
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS currencies (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        decimal_places INTEGER DEFAULT 2 NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tax_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        rate REAL DEFAULT 0 NOT NULL,
        type TEXT DEFAULT 'vat' NOT NULL,
        country_code TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commodity_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        category TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS incoterms (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_terms (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        net_days INTEGER DEFAULT 30 NOT NULL,
        discount_days INTEGER,
        discount_percent REAL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        cost_center_id TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approval_policies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        amount_min REAL DEFAULT 0 NOT NULL,
        amount_max REAL,
        approval_level INTEGER DEFAULT 1 NOT NULL,
        approver_role TEXT,
        approver_user_id INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approval_history (
        id SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        level INTEGER DEFAULT 1 NOT NULL,
        action TEXT NOT NULL,
        performed_by INTEGER NOT NULL,
        comment TEXT,
        previous_status TEXT,
        new_status TEXT,
        performed_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS purchase_order_revisions (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        revision_number INTEGER NOT NULL,
        snapshot JSONB NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        file_url TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER,
        checksum TEXT,
        version INTEGER DEFAULT 1 NOT NULL,
        uploaded_by INTEGER,
        uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL,
        archived_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS retention_policies (
        id SERIAL PRIMARY KEY,
        document_type TEXT UNIQUE NOT NULL,
        retention_years INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        entity_type TEXT,
        entity_id INTEGER,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        email_enabled BOOLEAN DEFAULT TRUE,
        sms_enabled BOOLEAN DEFAULT FALSE,
        in_app_enabled BOOLEAN DEFAULT TRUE,
        low_stock BOOLEAN DEFAULT TRUE,
        approval_request BOOLEAN DEFAULT TRUE,
        contract_expiry BOOLEAN DEFAULT TRUE,
        shipment_delay BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inventory_batches (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL,
        warehouse_id INTEGER,
        batch_number TEXT NOT NULL,
        manufacturing_date TIMESTAMP,
        expiry_date TIMESTAMP,
        quantity_received INTEGER DEFAULT 0 NOT NULL,
        quantity_on_hand INTEGER DEFAULT 0 NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inventory_serials (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL,
        warehouse_id INTEGER,
        serial_number TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'available' NOT NULL,
        current_location TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inventory_allocations (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL,
        warehouse_id INTEGER,
        quantity INTEGER NOT NULL,
        order_id INTEGER,
        requisition_id INTEGER,
        shipment_id INTEGER,
        status TEXT DEFAULT 'reserved' NOT NULL,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cycle_counts (
        id SERIAL PRIMARY KEY,
        warehouse_id INTEGER NOT NULL,
        zone TEXT,
        status TEXT DEFAULT 'planned' NOT NULL,
        count_date TIMESTAMP DEFAULT NOW() NOT NULL,
        counted_by INTEGER,
        variance INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cycle_count_lines (
        id SERIAL PRIMARY KEY,
        cycle_count_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        location TEXT,
        system_quantity INTEGER DEFAULT 0 NOT NULL,
        counted_quantity INTEGER DEFAULT 0 NOT NULL,
        variance INTEGER DEFAULT 0 NOT NULL
      );
    `);

    await pool.query(`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_name TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_swift TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_currency_code TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS insurance_expiry TIMESTAMP;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS compliance_notes TEXT;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier_part_number TEXT;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS commodity_code_id INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS manufacturing_date TIMESTAMP;
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS justification TEXT;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS contract_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS incoterm_id INTEGER;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
      ALTER TABLE invoices ALTER COLUMN customer_id DROP NOT NULL;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS receiver_user_id INTEGER;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS receiver_name TEXT;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_location TEXT;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS received_at TIMESTAMP;
    `);
    console.log('Professional supply chain tables and columns ready');
  } catch (err) {
    console.warn('Could not ensure professional supply chain tables:', err instanceof Error ? err.message : err);
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
  await ensureSuppliersTaxIdColumn();
  await ensurePurchaseRequisitionsTables();
  await ensureProfessionalSupplyChainTables();

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