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
/** Ensure row `organizations.id = 1` exists for single-org backfill and dev defaults. */
export async function ensureDefaultOrganization(): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO organizations (id, name, slug, created_at, updated_at)
      VALUES (1, 'Default Organization', 'default', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO organization_settings (organization_id, plan_tier, updated_at)
      VALUES (1, 'standard', NOW())
      ON CONFLICT (organization_id) DO NOTHING
    `);
  } catch (err) {
    console.warn(
      'Could not ensure default organization:',
      err instanceof Error ? err.message : err,
    );
  }
}

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

/** Tables that gained `organization_id` + composite unique indexes; legacy DBs may lack the column. */
const LEGACY_ORG_SCOPED_TABLES: readonly {
  table: string;
  uniqueIndexName: string;
  uniqueIndexCols: string;
  fkName: string;
}[] = [
  {
    table: "categories",
    uniqueIndexName: "categories_org_name_uidx",
    uniqueIndexCols: "(organization_id, name)",
    fkName: "categories_organization_id_organizations_id_fk",
  },
  {
    table: "departments",
    uniqueIndexName: "departments_org_code_uidx",
    uniqueIndexCols: "(organization_id, code)",
    fkName: "departments_organization_id_organizations_id_fk",
  },
  {
    table: "carriers",
    uniqueIndexName: "carriers_org_code_uidx",
    uniqueIndexCols: "(organization_id, code)",
    fkName: "carriers_organization_id_organizations_id_fk",
  },
  {
    table: "warehouses",
    uniqueIndexName: "warehouses_org_name_uidx",
    uniqueIndexCols: "(organization_id, name)",
    fkName: "warehouses_organization_id_organizations_id_fk",
  },
  {
    table: "inventory_items",
    uniqueIndexName: "inventory_items_org_sku_uidx",
    uniqueIndexCols: "(organization_id, sku)",
    fkName: "inventory_items_organization_id_organizations_id_fk",
  },
  {
    table: "app_settings",
    uniqueIndexName: "app_settings_org_uidx",
    uniqueIndexCols: "(organization_id)",
    fkName: "app_settings_organization_id_organizations_id_fk",
  },
  {
    table: "reorder_requests",
    uniqueIndexName: "reorder_requests_org_reqnum_uidx",
    uniqueIndexCols: "(organization_id, request_number)",
    fkName: "reorder_requests_organization_id_organizations_id_fk",
  },
  {
    table: "purchase_requisitions",
    uniqueIndexName: "purchase_req_org_number_uidx",
    uniqueIndexCols: "(organization_id, requisition_number)",
    fkName: "purchase_requisitions_organization_id_organizations_id_fk",
  },
  {
    table: "purchase_orders",
    uniqueIndexName: "purchase_orders_org_number_uidx",
    uniqueIndexCols: "(organization_id, order_number)",
    fkName: "purchase_orders_organization_id_organizations_id_fk",
  },
  {
    table: "inventory_serials",
    uniqueIndexName: "inventory_serials_org_sn_uidx",
    uniqueIndexCols: "(organization_id, serial_number)",
    fkName: "inventory_serials_organization_id_organizations_id_fk",
  },
];

/** Tables that need `organization_id` + FK but have no composite unique on (org, …) in legacy repair. */
const LEGACY_ORG_ID_COLUMN_ONLY: readonly { table: string; fkName: string }[] = [
  { table: "notifications", fkName: "notifications_organization_id_organizations_id_fk" },
  { table: "suppliers", fkName: "suppliers_organization_id_organizations_id_fk" },
  { table: "activity_logs", fkName: "activity_logs_organization_id_organizations_id_fk" },
  { table: "stock_movements", fkName: "stock_movements_organization_id_organizations_id_fk" },
  { table: "supplier_contracts", fkName: "supplier_contracts_organization_id_organizations_id_fk" },
  { table: "invoices", fkName: "invoices_organization_id_organizations_id_fk" },
  { table: "documents", fkName: "documents_organization_id_organizations_id_fk" },
  { table: "approval_policies", fkName: "approval_policies_organization_id_organizations_id_fk" },
  { table: "approval_history", fkName: "approval_history_organization_id_organizations_id_fk" },
  { table: "audit_logs", fkName: "audit_logs_organization_id_organizations_id_fk" },
  { table: "inventory_batches", fkName: "inventory_batches_organization_id_organizations_id_fk" },
  { table: "warehouse_inventory", fkName: "warehouse_inventory_organization_id_organizations_id_fk" },
  { table: "inventory_allocations", fkName: "inventory_allocations_organization_id_organizations_id_fk" },
  { table: "cycle_counts", fkName: "cycle_counts_organization_id_organizations_id_fk" },
];

async function ensureOrganizationIdColumnOnly(spec: (typeof LEGACY_ORG_ID_COLUMN_ONLY)[number]): Promise<void> {
  const r = await pool.query(
    `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'
  `,
    [spec.table],
  );
  if (r.rows.length > 0) return;

  await ensureDefaultOrganization();

  await pool.query(
    `ALTER TABLE ${spec.table} ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1`,
  );
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE ${spec.table}
        ADD CONSTRAINT ${spec.fkName}
        FOREIGN KEY (organization_id) REFERENCES organizations(id);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  console.log(`${spec.table}.organization_id column ready`);
}

async function ensureOrganizationIdOnLegacyTable(spec: (typeof LEGACY_ORG_SCOPED_TABLES)[number]): Promise<void> {
  const r = await pool.query(
    `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'
  `,
    [spec.table],
  );

  await ensureDefaultOrganization();

  if (r.rows.length === 0) {
    await pool.query(
      `ALTER TABLE ${spec.table} ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1`,
    );
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE ${spec.table}
          ADD CONSTRAINT ${spec.fkName}
          FOREIGN KEY (organization_id) REFERENCES organizations(id);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  // Column may already exist from a partial migration; Drizzle seed still needs the unique index for ON CONFLICT.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${spec.uniqueIndexName} ON ${spec.table} ${spec.uniqueIndexCols}`,
  );
  console.log(`${spec.table}.organization_id column and index ready`);
}

/** Multi-tenant column on `users` — Drizzle INSERT may reference it; legacy DBs often lack it. */
export async function ensureUsersDefaultOrganizationIdColumn(): Promise<void> {
  try {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'default_organization_id'
    `);
    if (r.rows.length > 0) return;

    await ensureDefaultOrganization();
    await pool.query(`
      ALTER TABLE users ADD COLUMN default_organization_id INTEGER REFERENCES organizations(id)
    `);
    console.log("users.default_organization_id column ready");
  } catch (err) {
    console.warn(
      "Could not ensure users.default_organization_id:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Backfill `organization_id` on org-scoped master tables when the DB predates multi-tenant columns.
 * Covers seed inserts that hit categories, departments, carriers (see `ensureMasterData` in seed.ts),
 * plus `users.default_organization_id` for Drizzle inserts.
 */
export async function ensureLegacyOrgIdColumnsForSeed(): Promise<void> {
  for (const spec of LEGACY_ORG_SCOPED_TABLES) {
    try {
      await ensureOrganizationIdOnLegacyTable(spec);
    } catch (err) {
      console.warn(
        `Could not ensure ${spec.table}.organization_id:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  for (const spec of LEGACY_ORG_ID_COLUMN_ONLY) {
    try {
      await ensureOrganizationIdColumnOnly(spec);
    } catch (err) {
      console.warn(
        `Could not ensure ${spec.table}.organization_id:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  await ensureUsersDefaultOrganizationIdColumn();
}

/** @deprecated Use {@link ensureLegacyOrgIdColumnsForSeed} — kept for call sites that only referenced categories. */
export async function ensureCategoriesOrganizationIdColumn(): Promise<void> {
  await ensureLegacyOrgIdColumnsForSeed();
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
        region_code TEXT DEFAULT 'ZA',
        region_name TEXT DEFAULT 'South Africa',
        is_main_for_region BOOLEAN DEFAULT FALSE,
        exchange_rate_to_zar REAL DEFAULT 1 NOT NULL,
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
      CREATE TABLE IF NOT EXISTS carriers (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        contact TEXT,
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
        organization_id INTEGER NOT NULL DEFAULT 1,
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
      CREATE TABLE IF NOT EXISTS stock_count_sessions (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER DEFAULT 1 NOT NULL,
        warehouse_id INTEGER NOT NULL,
        mode TEXT DEFAULT 'guided' NOT NULL,
        status TEXT DEFAULT 'assigned' NOT NULL,
        assigned_user_id INTEGER,
        started_at TIMESTAMP,
        submitted_at TIMESTAMP,
        approved_at TIMESTAMP,
        posted_at TIMESTAMP,
        variance_policy_id INTEGER,
        source TEXT DEFAULT 'mobile' NOT NULL,
        device_id TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stock_count_targets (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER DEFAULT 1 NOT NULL,
        session_id INTEGER NOT NULL,
        warehouse_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        location_id TEXT,
        lot_id INTEGER,
        serial_id INTEGER,
        system_qty_snapshot INTEGER DEFAULT 0 NOT NULL,
        blind_mode BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stock_count_lines (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER DEFAULT 1 NOT NULL,
        session_id INTEGER NOT NULL,
        target_id INTEGER,
        item_id INTEGER NOT NULL,
        count_seq INTEGER DEFAULT 1 NOT NULL,
        counted_qty INTEGER NOT NULL,
        scan_value TEXT,
        location_id TEXT,
        bin_code TEXT,
        counted_by TEXT,
        count_user_id INTEGER,
        idempotency_key TEXT NOT NULL,
        device_clock_at TIMESTAMP,
        sync_status TEXT DEFAULT 'synced' NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stock_count_variances (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER DEFAULT 1 NOT NULL,
        session_id INTEGER NOT NULL,
        target_id INTEGER,
        item_id INTEGER NOT NULL,
        delta_qty INTEGER DEFAULT 0 NOT NULL,
        delta_value REAL DEFAULT 0 NOT NULL,
        threshold_rule_id INTEGER,
        requires_approval BOOLEAN DEFAULT FALSE NOT NULL,
        reviewer_id INTEGER,
        disposition TEXT DEFAULT 'pending' NOT NULL,
        reason_code TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER DEFAULT 1 NOT NULL,
        session_id INTEGER NOT NULL,
        warehouse_id INTEGER NOT NULL,
        target_id INTEGER,
        item_id INTEGER NOT NULL,
        delta_qty INTEGER NOT NULL,
        movement_id INTEGER,
        posted_by INTEGER,
        posted_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mobile_sync_events (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER DEFAULT 1 NOT NULL,
        device_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        body JSONB DEFAULT '{}'::jsonb NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT DEFAULT 'accepted' NOT NULL,
        failure_reason TEXT,
        acked_at TIMESTAMP,
        applied_at TIMESTAMP,
        failed_at TIMESTAMP,
        retry_count INTEGER DEFAULT 0 NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_definitions (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        feature_map JSONB DEFAULT '{}'::jsonb NOT NULL,
        limits JSONB DEFAULT '{}'::jsonb NOT NULL,
        active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS billing_customers (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        provider TEXT DEFAULT 'stripe' NOT NULL,
        provider_customer_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        provider TEXT DEFAULT 'stripe' NOT NULL,
        provider_subscription_id TEXT NOT NULL,
        status TEXT DEFAULT 'incomplete' NOT NULL,
        plan_tier TEXT DEFAULT 'starter' NOT NULL,
        price_id TEXT,
        current_period_end TIMESTAMP,
        cancel_at_period_end BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entitlement_overrides (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        feature_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
        reason TEXT,
        expires_at TIMESTAMP,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_counters (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        counter_key TEXT NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        value INTEGER DEFAULT 0 NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS billing_webhook_events (
        id SERIAL PRIMARY KEY,
        provider TEXT DEFAULT 'stripe' NOT NULL,
        provider_event_id TEXT NOT NULL,
        signature_state TEXT DEFAULT 'unverified' NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb NOT NULL,
        processed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_change_audit (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        from_plan TEXT,
        to_plan TEXT NOT NULL,
        reason TEXT,
        changed_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS company_configuration_settings (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        scope TEXT DEFAULT 'organization' NOT NULL,
        scope_id TEXT,
        value JSONB NOT NULL,
        updated_by INTEGER,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_name TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_swift TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_number TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS finance_contact_name TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS logistics_contact_name TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS billing_address TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS remit_to_address TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pickup_site TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS delivery_site TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_sites JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_currency_code TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_code_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS incoterm_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_department_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_contract_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_carrier_id INTEGER;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_transport_mode TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bill_control_policy TEXT DEFAULT 'standard';
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS allow_currency_override BOOLEAN DEFAULT FALSE;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS require_approval_for_override BOOLEAN DEFAULT TRUE;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS region_code TEXT DEFAULT 'ZA';
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS region_name TEXT DEFAULT 'South Africa';
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS is_main_for_region BOOLEAN DEFAULT FALSE;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS exchange_rate_to_zar REAL DEFAULT 1 NOT NULL;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS risk_status TEXT DEFAULT 'unknown';
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS compliance_status TEXT DEFAULT 'unknown';
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS insurance_expiry TIMESTAMP;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS compliance_notes TEXT;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier_part_number TEXT;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS commodity_code_id INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_of_measure_id INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS default_warehouse_id INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS min_order_quantity INTEGER DEFAULT 1;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS lead_time INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reorder_point INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS max_stock_level INTEGER;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS taxable BOOLEAN DEFAULT TRUE;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS manufacturing_date TIMESTAMP;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS last_count_date TIMESTAMP;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS images JSONB;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS tags TEXT[];
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS custom_fields JSONB;
      ALTER TABLE cycle_counts ADD COLUMN IF NOT EXISTS organization_id INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS organization_id INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS justification TEXT;
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS project_id INTEGER;
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';
      ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS exchange_rate_to_zar REAL DEFAULT 1 NOT NULL;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS contract_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS incoterm_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_code_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS project_id INTEGER;
      ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS incoterm_id INTEGER;
      ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS default_tax_code_id INTEGER;
      ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS default_warehouse_id INTEGER;
      ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_of_measure_id INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS commodity_code_id INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_code_id INTEGER;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency_code TEXT;
      ALTER TABLE invoices ALTER COLUMN customer_id DROP NOT NULL;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS receiver_user_id INTEGER;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS receiver_name TEXT;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_location TEXT;
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS received_at TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approver_amount_limit REAL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS work_persona TEXT;
      ALTER TABLE stock_count_lines ADD COLUMN IF NOT EXISTS location_id TEXT;
      ALTER TABLE stock_count_lines ADD COLUMN IF NOT EXISTS bin_code TEXT;
      ALTER TABLE mobile_sync_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'accepted' NOT NULL;
      ALTER TABLE mobile_sync_events ADD COLUMN IF NOT EXISTS failure_reason TEXT;
      ALTER TABLE mobile_sync_events ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS stock_count_lines_org_idempotency_uidx
        ON stock_count_lines (organization_id, idempotency_key);
      CREATE UNIQUE INDEX IF NOT EXISTS mobile_sync_events_org_key_uidx
        ON mobile_sync_events (organization_id, idempotency_key);
      CREATE UNIQUE INDEX IF NOT EXISTS billing_webhook_events_provider_event_uidx
        ON billing_webhook_events (provider, provider_event_id);
      CREATE UNIQUE INDEX IF NOT EXISTS company_config_org_key_scope_uidx
        ON company_configuration_settings (organization_id, key, scope, COALESCE(scope_id, ''));
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
  await ensureDefaultOrganization();
  await ensureContractDateConstraint();
  await ensureSuppliersTaxIdColumn();
  await ensureLegacyOrgIdColumnsForSeed();
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
