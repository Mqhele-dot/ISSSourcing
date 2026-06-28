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
        unit_of_measure_id INTEGER,
        tax_code_id INTEGER,
        cost_centre_id INTEGER,
        gl_account_code TEXT,
        notes TEXT
      )
    `);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS unit_of_measure_id INTEGER`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS tax_code_id INTEGER`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS cost_centre_id INTEGER`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS gl_account_code TEXT`);
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
      CREATE TABLE IF NOT EXISTS mdm_legal_entities (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        registration_number TEXT,
        tax_number TEXT,
        default_currency_code TEXT DEFAULT 'ZAR',
        country_code TEXT DEFAULT 'ZA',
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_sites (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        legal_entity_id INTEGER,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        site_type TEXT DEFAULT 'branch',
        address TEXT,
        default_warehouse_id INTEGER,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_cost_centres (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        department_id INTEGER,
        gl_account_code TEXT,
        owner_user_id INTEGER,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_supplier_documents (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        supplier_id INTEGER NOT NULL,
        document_type TEXT NOT NULL,
        document_id INTEGER,
        status TEXT DEFAULT 'pending',
        expiry_date TIMESTAMP,
        required_for_po BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_supplier_contacts (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        supplier_id INTEGER NOT NULL,
        contact_type TEXT DEFAULT 'primary' NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        role_title TEXT,
        is_primary BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_supplier_bank_accounts (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        supplier_id INTEGER NOT NULL,
        bank_name TEXT NOT NULL,
        account_number_masked TEXT,
        swift_code TEXT,
        currency_code TEXT DEFAULT 'ZAR',
        payment_method TEXT DEFAULT 'bank_transfer',
        verification_status TEXT DEFAULT 'unverified',
        is_default BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_supplier_items (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        supplier_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        supplier_item_code TEXT,
        preferred BOOLEAN DEFAULT FALSE,
        lead_time_days INTEGER,
        min_order_quantity REAL DEFAULT 1,
        default_price REAL,
        currency_code TEXT DEFAULT 'ZAR',
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_item_categories (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id INTEGER,
        default_gl_account_code TEXT,
        default_tax_code_id INTEGER,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_uom_classes (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        base_uom_id INTEGER,
        precision INTEGER DEFAULT 2,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_uom_conversions (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        from_uom_id INTEGER NOT NULL,
        to_uom_id INTEGER NOT NULL,
        item_id INTEGER,
        factor REAL DEFAULT 1 NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_exchange_rates (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        from_currency_code TEXT NOT NULL,
        to_currency_code TEXT DEFAULT 'ZAR' NOT NULL,
        rate REAL NOT NULL,
        source TEXT DEFAULT 'manual',
        effective_date TIMESTAMP DEFAULT NOW() NOT NULL,
        expires_at TIMESTAMP,
        manual_override_allowed BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_procurement_policies (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        policy_type TEXT DEFAULT 'requisition' NOT NULL,
        config JSONB DEFAULT '{}'::jsonb,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_approval_rules (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        min_local_value REAL DEFAULT 0,
        max_local_value REAL,
        department_id INTEGER,
        cost_centre_id INTEGER,
        category_code TEXT,
        supplier_risk TEXT,
        approver_role TEXT,
        approval_level INTEGER DEFAULT 1,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_document_sequences (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        document_type TEXT NOT NULL,
        prefix TEXT NOT NULL,
        legal_entity_id INTEGER,
        site_id INTEGER,
        year INTEGER,
        next_number INTEGER DEFAULT 1 NOT NULL,
        padding INTEGER DEFAULT 6 NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_document_templates (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        document_type TEXT NOT NULL,
        name TEXT NOT NULL,
        logo_url TEXT,
        terms_text TEXT,
        footer_text TEXT,
        banking_details TEXT,
        registration_details TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_gl_mappings (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        mapping_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        gl_account_code TEXT NOT NULL,
        cost_centre_id INTEGER,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_audit_logs (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        domain TEXT NOT NULL,
        record_id INTEGER,
        action TEXT NOT NULL,
        summary TEXT,
        before JSONB,
        after JSONB,
        performed_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_import_batches (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        domain TEXT NOT NULL,
        file_name TEXT NOT NULL,
        status TEXT DEFAULT 'validating',
        total_rows INTEGER DEFAULT 0,
        valid_rows INTEGER DEFAULT 0,
        invalid_rows INTEGER DEFAULT 0,
        validation_report JSONB DEFAULT '{}'::jsonb,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        completed_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS mdm_data_quality_issues (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        domain TEXT NOT NULL,
        severity TEXT DEFAULT 'warning' NOT NULL,
        issue_code TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        affected_entity_type TEXT,
        affected_entity_id INTEGER,
        recommended_action TEXT,
        status TEXT DEFAULT 'open',
        last_seen_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        resolved_at TIMESTAMP
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
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS unit_of_measure_id INTEGER;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS tax_code_id INTEGER;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS cost_centre_id INTEGER;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS gl_account_code TEXT;
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
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS cost_centre_id INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS gl_account_code TEXT;
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
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_legal_entities_org_code_uidx ON mdm_legal_entities (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_sites_org_code_uidx ON mdm_sites (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_cost_centres_org_code_uidx ON mdm_cost_centres (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_supplier_contacts_org_supplier_type_uidx ON mdm_supplier_contacts (organization_id, supplier_id, contact_type, COALESCE(email, ''));
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_supplier_bank_org_supplier_bank_uidx ON mdm_supplier_bank_accounts (organization_id, supplier_id, bank_name, COALESCE(account_number_masked, ''));
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_supplier_items_org_supplier_item_uidx ON mdm_supplier_items (organization_id, supplier_id, item_id);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_item_categories_org_code_uidx ON mdm_item_categories (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_uom_classes_org_code_uidx ON mdm_uom_classes (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_exchange_rates_org_pair_date_uidx ON mdm_exchange_rates (organization_id, from_currency_code, to_currency_code, effective_date);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_procurement_policies_org_code_uidx ON mdm_procurement_policies (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_approval_rules_org_code_uidx ON mdm_approval_rules (organization_id, code);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_document_sequences_org_doc_uidx ON mdm_document_sequences (organization_id, document_type, prefix);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_gl_mappings_org_source_uidx ON mdm_gl_mappings (organization_id, mapping_type, source_type, source_id);
      CREATE UNIQUE INDEX IF NOT EXISTS mdm_dq_org_code_entity_uidx ON mdm_data_quality_issues (organization_id, issue_code, COALESCE(affected_entity_type, ''), COALESCE(affected_entity_id, 0));
    `);

    await pool.query(`
      INSERT INTO mdm_legal_entities (organization_id, code, name, default_currency_code, country_code)
      SELECT id, UPPER(COALESCE(NULLIF(slug, ''), 'DEFAULT')), name, 'ZAR', 'ZA'
      FROM organizations
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        default_currency_code = EXCLUDED.default_currency_code,
        updated_at = NOW();

      INSERT INTO mdm_sites (organization_id, legal_entity_id, code, name, site_type, address, default_warehouse_id)
      SELECT w.organization_id, le.id, UPPER(REGEXP_REPLACE(w.name, '[^A-Za-z0-9]+', '-', 'g')), w.name, 'warehouse', w.address, w.id
      FROM warehouses w
      LEFT JOIN mdm_legal_entities le ON le.organization_id = w.organization_id
      WHERE NOT EXISTS (
        SELECT 1 FROM mdm_sites s WHERE s.organization_id = w.organization_id AND s.default_warehouse_id = w.id
      )
      ON CONFLICT (organization_id, code) DO NOTHING;

      INSERT INTO mdm_cost_centres (organization_id, code, name, department_id, gl_account_code)
      SELECT d.organization_id, COALESCE(NULLIF(d.cost_center_id, ''), d.code), d.name, d.id, NULLIF(d.cost_center_id, '')
      FROM departments d
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        department_id = EXCLUDED.department_id,
        updated_at = NOW();

      INSERT INTO mdm_item_categories (organization_id, code, name)
      SELECT c.organization_id, UPPER(REGEXP_REPLACE(c.name, '[^A-Za-z0-9]+', '-', 'g')), c.name
      FROM categories c
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW();

      INSERT INTO mdm_exchange_rates (organization_id, from_currency_code, to_currency_code, rate, source, effective_date, manual_override_allowed)
      SELECT 1, c.code, 'ZAR', COALESCE(NULLIF(c.exchange_rate_to_zar, 0), CASE WHEN c.code = 'ZAR' THEN 1 ELSE 1 END), 'currency-master', DATE_TRUNC('day', NOW()), TRUE
      FROM currencies c
      WHERE COALESCE(c.active, TRUE) = TRUE
      ON CONFLICT (organization_id, from_currency_code, to_currency_code, effective_date) DO NOTHING;

      INSERT INTO mdm_supplier_contacts (organization_id, supplier_id, contact_type, name, email, phone, role_title, is_primary)
      SELECT s.organization_id, s.id, 'primary', COALESCE(NULLIF(s.contact_name, ''), s.name), s.email, s.phone, 'Primary contact', TRUE
      FROM suppliers s
      WHERE COALESCE(NULLIF(s.contact_name, ''), s.email, s.phone) IS NOT NULL
      ON CONFLICT (organization_id, supplier_id, contact_type, COALESCE(email, '')) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        active = TRUE,
        updated_at = NOW();

      INSERT INTO mdm_supplier_bank_accounts (
        organization_id, supplier_id, bank_name, account_number_masked, swift_code, currency_code, is_default
      )
      SELECT
        s.organization_id,
        s.id,
        s.bank_name,
        CASE
          WHEN s.bank_account_number IS NULL OR LENGTH(s.bank_account_number) <= 4 THEN s.bank_account_number
          ELSE CONCAT(REPEAT('*', GREATEST(LENGTH(s.bank_account_number) - 4, 0)), RIGHT(s.bank_account_number, 4))
        END,
        s.bank_swift,
        COALESCE(NULLIF(s.default_currency_code, ''), 'ZAR'),
        TRUE
      FROM suppliers s
      WHERE s.bank_name IS NOT NULL AND s.bank_name <> ''
      ON CONFLICT (organization_id, supplier_id, bank_name, COALESCE(account_number_masked, '')) DO UPDATE SET
        swift_code = EXCLUDED.swift_code,
        currency_code = EXCLUDED.currency_code,
        active = TRUE,
        updated_at = NOW();

      INSERT INTO mdm_supplier_items (
        organization_id, supplier_id, item_id, supplier_item_code, preferred, lead_time_days, min_order_quantity, default_price, currency_code
      )
      SELECT
        COALESCE(NULLIF(i.organization_id::text, '')::int, 1),
        i.supplier_id,
        i.id,
        i.supplier_part_number,
        TRUE,
        i.lead_time,
        COALESCE(i.min_order_quantity, 1),
        COALESCE(i.cost, i.price),
        COALESCE(s.default_currency_code, 'ZAR')
      FROM inventory_items i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.supplier_id IS NOT NULL
      ON CONFLICT (organization_id, supplier_id, item_id) DO UPDATE SET
        supplier_item_code = EXCLUDED.supplier_item_code,
        lead_time_days = EXCLUDED.lead_time_days,
        min_order_quantity = EXCLUDED.min_order_quantity,
        default_price = EXCLUDED.default_price,
        currency_code = EXCLUDED.currency_code,
        updated_at = NOW();

      INSERT INTO mdm_procurement_policies (organization_id, code, name, policy_type, config)
      VALUES
        (1, 'REQ-CATALOGUE-DEFAULT', 'Catalogue-first requisitions', 'requisition', '{"onceOffRequiresReason":true,"requiresDepartment":true,"requiresCostCentre":true,"requiresTaxCode":true}'::jsonb),
        (1, 'PO-MATCH-STANDARD', 'Standard PO and invoice matching', 'purchase_order', '{"grnRequired":true,"quantityTolerancePct":5,"priceTolerancePct":3,"lockExchangeRateOnSend":true}'::jsonb)
      ON CONFLICT (organization_id, code) DO NOTHING;

      INSERT INTO mdm_document_sequences (organization_id, document_type, prefix, year, next_number, padding)
      VALUES
        (1, 'REQUISITION', CONCAT('REQ-', EXTRACT(YEAR FROM NOW())::int, '-'), EXTRACT(YEAR FROM NOW())::int, 1, 6),
        (1, 'PURCHASE_ORDER', CONCAT('PO-', EXTRACT(YEAR FROM NOW())::int, '-'), EXTRACT(YEAR FROM NOW())::int, 1, 6),
        (1, 'GRN', CONCAT('GRN-', EXTRACT(YEAR FROM NOW())::int, '-'), EXTRACT(YEAR FROM NOW())::int, 1, 6),
        (1, 'INVOICE_BATCH', CONCAT('APB-', EXTRACT(YEAR FROM NOW())::int, '-'), EXTRACT(YEAR FROM NOW())::int, 1, 6)
      ON CONFLICT (organization_id, document_type, prefix) DO NOTHING;

      INSERT INTO mdm_document_templates (organization_id, document_type, name, terms_text, footer_text)
      VALUES
        (1, 'PURCHASE_ORDER', 'Default purchase order template', 'Supplier terms are governed by the selected payment terms and incoterms.', 'Generated from InvTrack Master Data & Control Centre.'),
        (1, 'GRN', 'Default goods receipt template', 'Receipt quantities are subject to warehouse inspection and tolerance policy.', 'Generated from InvTrack Master Data & Control Centre.')
      ON CONFLICT DO NOTHING;

      INSERT INTO mdm_approval_rules (organization_id, code, name, entity_type, min_local_value, max_local_value, approver_role, approval_level)
      SELECT organization_id, CONCAT('POLICY-', id), name, entity_type, amount_min, amount_max, approver_role, approval_level
      FROM approval_policies
      WHERE COALESCE(is_active, TRUE) = TRUE
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        min_local_value = EXCLUDED.min_local_value,
        max_local_value = EXCLUDED.max_local_value,
        approver_role = EXCLUDED.approver_role,
        approval_level = EXCLUDED.approval_level,
        updated_at = NOW();
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
