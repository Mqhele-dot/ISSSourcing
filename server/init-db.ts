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

export async function ensureOrganizationSubscriptionColumns(): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE organization_settings
        ADD COLUMN IF NOT EXISTS legal_name TEXT,
        ADD COLUMN IF NOT EXISTS registration_number TEXT,
        ADD COLUMN IF NOT EXISTS tax_number TEXT,
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS contact_email TEXT,
        ADD COLUMN IF NOT EXISTS contact_phone TEXT,
        ADD COLUMN IF NOT EXISTS website TEXT,
        ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS billing_provider TEXT DEFAULT 'local',
        ADD COLUMN IF NOT EXISTS billing_customer_id TEXT,
        ADD COLUMN IF NOT EXISTS billing_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP,
        ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP,
        ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS usage_snapshot JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS last_billing_sync_at TIMESTAMP
    `);
    await pool.query(`
      UPDATE organization_settings
      SET
        subscription_status = COALESCE(subscription_status, 'active'),
        billing_provider = COALESCE(billing_provider, 'local'),
        cancel_at_period_end = COALESCE(cancel_at_period_end, FALSE),
        usage_snapshot = COALESCE(usage_snapshot, '{}'::jsonb)
    `);
  } catch (err) {
    console.warn(
      'Could not ensure organization subscription columns:',
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

/** Keep the persisted RBAC resource enum aligned with the server permission catalog. */
export async function ensurePermissionResourceEnumValues(): Promise<void> {
  const requiredValues = ["invoices", "billing", "taxes", "payments", "master_data"];
  try {
    const type = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource') AS exists",
    );
    if (!type.rows[0]?.exists) return;
    for (const value of requiredValues) {
      await pool.query(`ALTER TYPE resource ADD VALUE IF NOT EXISTS '${value}'`);
    }
  } catch (err) {
    console.warn("Could not align permission resource enum:", err instanceof Error ? err.message : err);
  }
}

/** Add fail-closed tenancy and audit-chain columns without rewriting historical business records. */
export async function ensureTenantSecurityColumns(): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ZA';
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_currency_code TEXT NOT NULL DEFAULT 'ZAR';
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-ZA';
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg';

      ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS application_role TEXT NOT NULL DEFAULT 'viewer';
      WITH ranked_memberships AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY organization_id, user_id
                 ORDER BY active DESC, (role = 'owner') DESC, id ASC
               ) AS duplicate_rank
        FROM organization_members
      )
      DELETE FROM organization_members
      WHERE id IN (SELECT id FROM ranked_memberships WHERE duplicate_rank > 1);
      CREATE UNIQUE INDEX IF NOT EXISTS organization_members_org_user_uidx
        ON organization_members (organization_id, user_id);
      UPDATE organization_members om
      SET application_role = COALESCE(NULLIF(u.role::text, ''), 'viewer')
      FROM users u
      WHERE u.id = om.user_id
        AND (om.application_role IS NULL OR om.application_role = 'viewer');

      CREATE UNIQUE INDEX IF NOT EXISTS permissions_role_resource_type_uidx
        ON permissions (role, resource, permission_type);
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'admin'::user_role, resource_value, permission_value
      FROM unnest(enum_range(NULL::resource)) AS resource_value
      CROSS JOIN unnest(enum_range(NULL::permission_type)) AS permission_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'manager'::user_role, resource_value, permission_value
      FROM unnest(enum_range(NULL::resource)) AS resource_value
      CROSS JOIN unnest(enum_range(NULL::permission_type)) AS permission_value
      WHERE NOT (resource_value = 'system'::resource AND permission_value = 'admin'::permission_type)
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'planner'::user_role, resource_value, permission_value
      FROM unnest(ARRAY['purchases','suppliers','reports','documents','analytics','dashboards']::resource[]) AS resource_value
      CROSS JOIN unnest(ARRAY['create','read','update','approve','manage','print','download','upload','view_reports']::permission_type[]) AS permission_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'planner'::user_role, resource_value, permission_value
      FROM unnest(ARRAY['inventory','warehouses','stock_movements']::resource[]) AS resource_value
      CROSS JOIN unnest(ARRAY['read','update','execute','scan','download']::permission_type[]) AS permission_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'warehouse_staff'::user_role, resource_value, permission_value
      FROM unnest(ARRAY['inventory','warehouses','stock_movements','reorder_requests','documents']::resource[]) AS resource_value
      CROSS JOIN unnest(ARRAY['create','read','update','execute','transfer','scan','upload','download']::permission_type[]) AS permission_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT role_value, resource_value, 'read'::permission_type
      FROM unnest(ARRAY['viewer','sales']::user_role[]) AS role_value
      CROSS JOIN unnest(enum_range(NULL::resource)) AS resource_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'auditor'::user_role, resource_value, permission_value
      FROM unnest(enum_range(NULL::resource)) AS resource_value
      CROSS JOIN unnest(ARRAY['read','audit','export','download','view_reports']::permission_type[]) AS permission_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;
      INSERT INTO permissions (role, resource, permission_type)
      SELECT 'supplier'::user_role, resource_value, permission_value
      FROM unnest(ARRAY['purchases','suppliers','documents','notifications']::resource[]) AS resource_value
      CROSS JOIN unnest(ARRAY['read','update','upload','download']::permission_type[]) AS permission_value
      ON CONFLICT (role, resource, permission_type) DO NOTHING;

      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_hash TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_org_event_hash_uidx
        ON audit_logs (organization_id, event_hash)
        WHERE event_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx
        ON audit_logs (organization_id, created_at, id);

      CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY: audit events cannot be updated or deleted';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS audit_logs_append_only_guard ON audit_logs;
      CREATE TRIGGER audit_logs_append_only_guard
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'prospective';
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES users(id);
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_once_off BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS once_off_expires_at TIMESTAMP;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS risk_rating TEXT DEFAULT 'unrated';
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS service_regions JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supported_currencies JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category_codes JSONB DEFAULT '[]'::jsonb;
      UPDATE suppliers
      SET onboarding_status = 'approved',
          approved_at = COALESCE(approved_at, updated_at, created_at, NOW())
      WHERE LOWER(COALESCE(status, 'active')) = 'active'
        AND onboarding_status = 'prospective'
        AND created_by_user_id IS NULL;

      CREATE TABLE IF NOT EXISTS supplier_portal_mappings (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, user_id)
      );
      INSERT INTO supplier_portal_mappings (organization_id, user_id, supplier_id, active)
      SELECT s.organization_id, u.id, u.supplier_id, TRUE
      FROM users u
      INNER JOIN suppliers s ON s.id = u.supplier_id
      WHERE u.supplier_id IS NOT NULL
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    `);
    console.log('Tenant security and audit chain columns ready');
  } catch (err) {
    console.warn('Could not ensure tenant security columns:', err instanceof Error ? err.message : err);
  }
}

/** Add the tenant-scoped strategic sourcing workflow without changing historical procurement records. */
export async function ensureStrategicSourcingTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_events (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_number TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        owner_user_id INTEGER NOT NULL REFERENCES users(id),
        requisition_id INTEGER REFERENCES purchase_requisitions(id),
        legal_entity_id INTEGER REFERENCES mdm_legal_entities(id),
        reporting_currency_code TEXT NOT NULL DEFAULT 'ZAR',
        deadline TIMESTAMP NOT NULL,
        minimum_responses INTEGER NOT NULL DEFAULT 1,
        competition_required BOOLEAN NOT NULL DEFAULT TRUE,
        locked_fx_snapshot JSONB DEFAULT '{}'::jsonb,
        terms TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        published_at TIMESTAMP,
        closed_at TIMESTAMP,
        archived_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT sourcing_events_status_check CHECK (status IN ('DRAFT','PUBLISHED','OPEN','CLOSED','EVALUATING','AWARDED','CANCELLED','ARCHIVED')),
        CONSTRAINT sourcing_events_minimum_responses_check CHECK (minimum_responses > 0),
        UNIQUE (organization_id, event_number)
      );

      CREATE TABLE IF NOT EXISTS sourcing_event_lines (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
        line_number INTEGER NOT NULL,
        item_id INTEGER REFERENCES inventory_items(id),
        description TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_of_measure_id INTEGER REFERENCES units_of_measure(id),
        tax_code_id INTEGER REFERENCES tax_codes(id),
        cost_centre_id INTEGER REFERENCES mdm_cost_centres(id),
        gl_account_code TEXT,
        delivery_site_id INTEGER REFERENCES mdm_sites(id),
        required_date TIMESTAMP,
        target_unit_price REAL,
        target_currency_code TEXT,
        requirements JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, line_number)
      );

      CREATE TABLE IF NOT EXISTS sourcing_evaluation_criteria (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        criterion_type TEXT NOT NULL DEFAULT 'commercial',
        weight REAL NOT NULL CHECK (weight > 0 AND weight <= 100),
        knockout BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        guidance TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sourcing_invitations (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        status TEXT NOT NULL DEFAULT 'INVITED',
        invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
        invited_at TIMESTAMP NOT NULL DEFAULT NOW(),
        viewed_at TIMESTAMP,
        responded_at TIMESTAMP,
        UNIQUE (event_id, supplier_id)
      );

      CREATE TABLE IF NOT EXISTS supplier_quotes (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        quote_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        version INTEGER NOT NULL DEFAULT 1,
        supersedes_quote_id INTEGER,
        submitted_by_user_id INTEGER REFERENCES users(id),
        currency_code TEXT NOT NULL,
        exchange_rate_to_reporting REAL NOT NULL DEFAULT 1 CHECK (exchange_rate_to_reporting > 0),
        subtotal REAL NOT NULL DEFAULT 0,
        tax_total REAL NOT NULL DEFAULT 0,
        landed_cost_total REAL NOT NULL DEFAULT 0,
        reporting_total REAL NOT NULL DEFAULT 0,
        validity_date TIMESTAMP,
        payment_terms TEXT,
        delivery_days INTEGER,
        notes TEXT,
        compliance_status TEXT NOT NULL DEFAULT 'PENDING',
        submitted_at TIMESTAMP,
        withdrawn_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT supplier_quotes_status_check CHECK (status IN ('DRAFT','SUBMITTED','WITHDRAWN','SUPERSEDED')),
        UNIQUE (organization_id, quote_number)
      );

      CREATE TABLE IF NOT EXISTS supplier_quote_lines (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        quote_id INTEGER NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
        event_line_id INTEGER NOT NULL REFERENCES sourcing_event_lines(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_price REAL NOT NULL CHECK (unit_price >= 0),
        tax_amount REAL NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
        freight_amount REAL NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
        landed_cost REAL NOT NULL DEFAULT 0 CHECK (landed_cost >= 0),
        promised_date TIMESTAMP,
        supplier_item_code TEXT,
        alternative_description TEXT,
        compliant BOOLEAN NOT NULL DEFAULT TRUE,
        exception_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (quote_id, event_line_id)
      );

      CREATE TABLE IF NOT EXISTS sourcing_clarifications (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
        supplier_id INTEGER REFERENCES suppliers(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'PRIVATE',
        parent_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sourcing_evaluations (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
        quote_id INTEGER NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
        criterion_id INTEGER NOT NULL REFERENCES sourcing_evaluation_criteria(id),
        evaluator_user_id INTEGER NOT NULL REFERENCES users(id),
        score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
        weighted_score REAL NOT NULL,
        comment TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (quote_id, criterion_id, evaluator_user_id)
      );

      CREATE TABLE IF NOT EXISTS sourcing_awards (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        event_id INTEGER NOT NULL REFERENCES sourcing_events(id),
        status TEXT NOT NULL DEFAULT 'DRAFT',
        recommended_by_user_id INTEGER NOT NULL REFERENCES users(id),
        approved_by_user_id INTEGER REFERENCES users(id),
        justification TEXT NOT NULL,
        override_reason TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        submitted_at TIMESTAMP,
        approved_at TIMESTAMP,
        rejected_at TIMESTAMP,
        converted_purchase_order_id INTEGER REFERENCES purchase_orders(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT sourcing_awards_status_check CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED'))
      );

      CREATE TABLE IF NOT EXISTS sourcing_award_lines (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        award_id INTEGER NOT NULL REFERENCES sourcing_awards(id) ON DELETE CASCADE,
        event_line_id INTEGER NOT NULL REFERENCES sourcing_event_lines(id),
        quote_line_id INTEGER NOT NULL REFERENCES supplier_quote_lines(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        awarded_quantity REAL NOT NULL CHECK (awarded_quantity > 0),
        awarded_unit_price REAL NOT NULL CHECK (awarded_unit_price >= 0),
        currency_code TEXT NOT NULL,
        reporting_amount REAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS workflow_idempotency (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        idempotency_key TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id INTEGER,
        response JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS sourcing_events_org_status_idx ON sourcing_events(organization_id, status);
      CREATE INDEX IF NOT EXISTS sourcing_quotes_org_event_idx ON supplier_quotes(organization_id, event_id);
      CREATE INDEX IF NOT EXISTS sourcing_awards_org_event_idx ON sourcing_awards(organization_id, event_id);
      CREATE INDEX IF NOT EXISTS sourcing_clarifications_org_event_idx ON sourcing_clarifications(organization_id, event_id);
      ALTER TABLE sourcing_event_lines ADD COLUMN IF NOT EXISTS cost_centre_id INTEGER REFERENCES mdm_cost_centres(id);
      ALTER TABLE sourcing_event_lines ADD COLUMN IF NOT EXISTS gl_account_code TEXT;
    `);
    console.log('Strategic sourcing tables ready');
  } catch (err) {
    console.warn('Could not ensure strategic sourcing tables:', err instanceof Error ? err.message : err);
  }
}

export async function ensureCommercialQuotationTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commercial_quotations (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        quotation_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ISSUED','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
        version INTEGER NOT NULL DEFAULT 1,
        recipient_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (recipient_source IN ('SUPPLIER_MASTER','MANUAL')),
        recipient_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        recipient_company TEXT NOT NULL,
        recipient_name TEXT,
        recipient_email TEXT,
        recipient_phone TEXT,
        recipient_address TEXT,
        recipient_registration_number TEXT,
        recipient_tax_number TEXT,
        recipient_physical_address TEXT,
        recipient_billing_address TEXT,
        recipient_delivery_address TEXT,
        supplier_legal_name TEXT,
        supplier_registration_number TEXT,
        supplier_tax_number TEXT,
        supplier_physical_address TEXT,
        supplier_email TEXT,
        supplier_phone TEXT,
        supplier_website TEXT,
        currency_code TEXT NOT NULL,
        reporting_currency_code TEXT NOT NULL,
        exchange_rate_to_reporting REAL NOT NULL CHECK (exchange_rate_to_reporting > 0),
        subtotal REAL NOT NULL DEFAULT 0,
        discount_total REAL NOT NULL DEFAULT 0,
        tax_total REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        reporting_total REAL NOT NULL DEFAULT 0,
        valid_until TIMESTAMP NOT NULL,
        payment_terms_id INTEGER REFERENCES payment_terms(id),
        incoterm_id INTEGER REFERENCES incoterms(id),
        acceptance_method TEXT NOT NULL DEFAULT 'SIGNATURE' CHECK (acceptance_method IN ('SIGNATURE','PURCHASE_ORDER','EMAIL_CONFIRMATION')),
        acceptance_terms TEXT NOT NULL,
        legal_terms TEXT,
        notes TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        approved_by_user_id INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        issued_at TIMESTAMP,
        accepted_by_name TEXT,
        accepted_at TIMESTAMP,
        acceptance_reference TEXT,
        rejected_by_name TEXT,
        rejected_at TIMESTAMP,
        rejection_reason TEXT,
        rejection_reference TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, quotation_number)
      );
      CREATE TABLE IF NOT EXISTS commercial_quotation_lines (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        quotation_id INTEGER NOT NULL REFERENCES commercial_quotations(id) ON DELETE CASCADE,
        line_number INTEGER NOT NULL,
        line_type TEXT NOT NULL CHECK (line_type IN ('CATALOG','NON_STOCK','SERVICE')),
        inventory_item_id INTEGER REFERENCES inventory_items(id),
        sku TEXT,
        description TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_of_measure_id INTEGER REFERENCES units_of_measure(id),
        unit_of_measure_code TEXT NOT NULL,
        unit_price REAL NOT NULL CHECK (unit_price >= 0),
        discount_percent REAL NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
        tax_code_id INTEGER REFERENCES tax_codes(id),
        tax_code TEXT,
        tax_rate REAL NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
        net_amount REAL NOT NULL,
        tax_amount REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (quotation_id, line_number)
      );
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS rejected_by_name TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS rejection_reference TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_source TEXT NOT NULL DEFAULT 'MANUAL';
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_registration_number TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_tax_number TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_physical_address TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_billing_address TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS recipient_delivery_address TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_legal_name TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_registration_number TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_tax_number TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_physical_address TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_email TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_phone TEXT;
      ALTER TABLE commercial_quotations ADD COLUMN IF NOT EXISTS supplier_website TEXT;
      UPDATE commercial_quotations
      SET recipient_physical_address = recipient_address
      WHERE recipient_physical_address IS NULL AND recipient_address IS NOT NULL;
      CREATE INDEX IF NOT EXISTS commercial_quotations_org_status_updated_idx ON commercial_quotations(organization_id, status, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS commercial_quotations_org_recipient_supplier_idx ON commercial_quotations(organization_id, recipient_supplier_id, updated_at DESC, id DESC) WHERE recipient_supplier_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS commercial_quotation_lines_org_quote_idx ON commercial_quotation_lines(organization_id, quotation_id, line_number);
      INSERT INTO mdm_document_sequences (organization_id, document_type, prefix, year, next_number, padding)
      SELECT id, 'COMMERCIAL_QUOTATION', CONCAT('QUO-', EXTRACT(YEAR FROM NOW())::int, '-'), EXTRACT(YEAR FROM NOW())::int, 1, 6
      FROM organizations WHERE COALESCE(active, TRUE) = TRUE
      ON CONFLICT (organization_id, document_type, prefix) DO NOTHING;
      INSERT INTO mdm_document_templates (organization_id, document_type, name, terms_text, footer_text)
      SELECT id, 'COMMERCIAL_QUOTATION', 'Default commercial quotation',
        'Acceptance confirms agreement to the quoted scope, price, validity period, payment terms, and incorporated conditions. Changes require a revised quotation.',
        'This quotation is subject to the organization terms shown above.'
      FROM organizations o
      WHERE COALESCE(o.active, TRUE) = TRUE
        AND NOT EXISTS (SELECT 1 FROM mdm_document_templates t WHERE t.organization_id = o.id AND t.document_type = 'COMMERCIAL_QUOTATION')
      ON CONFLICT DO NOTHING;
    `);
    console.log('Commercial quotation tables ready');
  } catch (err) {
    console.warn('Could not ensure commercial quotation tables:', err instanceof Error ? err.message : err);
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
    table: "suppliers",
    uniqueIndexName: "suppliers_org_code_uidx",
    uniqueIndexCols: "(organization_id, supplier_code)",
    fkName: "suppliers_organization_id_organizations_id_fk",
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
  {
    table: "custom_roles",
    uniqueIndexName: "custom_roles_org_name_uidx",
    uniqueIndexCols: "(organization_id, name)",
    fkName: "custom_roles_organization_id_organizations_id_fk",
  },
];

/** Tables that need `organization_id` + FK but have no composite unique on (org, …) in legacy repair. */
const LEGACY_ORG_ID_COLUMN_ONLY: readonly { table: string; fkName: string }[] = [
  { table: "notifications", fkName: "notifications_organization_id_organizations_id_fk" },
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

/**
 * Barcode ownership must follow the canonical inventory item rather than a guessed default tenant.
 * Rows whose item no longer exists remain unassigned and fail closed in operational queries.
 */
async function ensureBarcodeOrganizationIdColumn(): Promise<void> {
  const table = await pool.query(`SELECT to_regclass('public.barcodes') AS table_name`);
  if (!table.rows[0]?.table_name) return;

  await pool.query(`ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS organization_id INTEGER`);
  await pool.query(`
    UPDATE barcodes AS barcode
    SET organization_id = item.organization_id
    FROM inventory_items AS item
    WHERE barcode.organization_id IS NULL
      AND barcode.item_id = item.id
      AND item.organization_id IS NOT NULL
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE barcodes
        ADD CONSTRAINT barcodes_organization_id_organizations_id_fk
        FOREIGN KEY (organization_id) REFERENCES organizations(id);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS barcodes_org_value_uidx ON barcodes(organization_id, value)`);

  const unresolved = await pool.query(`SELECT COUNT(*)::int AS count FROM barcodes WHERE organization_id IS NULL`);
  if (Number(unresolved.rows[0]?.count ?? 0) === 0) {
    await pool.query(`ALTER TABLE barcodes ALTER COLUMN organization_id SET NOT NULL`);
  } else {
    console.warn(`${unresolved.rows[0].count} barcode row(s) remain unassigned because their inventory item could not be resolved.`);
  }
  console.log("barcodes.organization_id ownership and index ready");
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
  try {
    await ensureBarcodeOrganizationIdColumn();
  } catch (err) {
    console.warn(
      "Could not ensure barcodes.organization_id:",
      err instanceof Error ? err.message : err,
    );
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
        item_id INTEGER,
        line_number INTEGER NOT NULL DEFAULT 1,
        line_type TEXT NOT NULL DEFAULT 'CATALOG',
        description TEXT,
        item_code_snapshot TEXT,
        item_description_snapshot TEXT,
        manual_entry_reason TEXT,
        fulfilment_type TEXT NOT NULL DEFAULT 'GOODS_RECEIPT',
        receipt_required BOOLEAN NOT NULL DEFAULT TRUE,
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
    await pool.query(`ALTER TABLE purchase_requisition_items ALTER COLUMN item_id DROP NOT NULL`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS line_number INTEGER NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG'`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS description TEXT`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_code_snapshot TEXT`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_description_snapshot TEXT`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS manual_entry_reason TEXT`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS fulfilment_type TEXT NOT NULL DEFAULT 'GOODS_RECEIPT'`);
    await pool.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT TRUE`);
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
        version INTEGER NOT NULL DEFAULT 1,
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
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
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
        occurrence_count INTEGER DEFAULT 1 NOT NULL,
        last_occurred_at TIMESTAMP DEFAULT NOW() NOT NULL,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS last_occurred_at TIMESTAMP DEFAULT NOW() NOT NULL;
      WITH duplicate_groups AS (
        SELECT
          MAX(id) AS keeper_id,
          COALESCE(organization_id, 1) AS organization_id,
          user_id,
          type,
          title,
          COUNT(*)::int AS occurrence_count,
          MAX(COALESCE(last_occurred_at, created_at)) AS last_occurred_at,
          CASE WHEN BOOL_OR(read_at IS NULL) THEN NULL ELSE MAX(read_at) END AS read_at
        FROM notifications
        GROUP BY COALESCE(organization_id, 1), user_id, type, title
        HAVING COUNT(*) > 1
      )
      UPDATE notifications notification
      SET
        occurrence_count = GREATEST(notification.occurrence_count, duplicate_groups.occurrence_count),
        last_occurred_at = duplicate_groups.last_occurred_at,
        read_at = duplicate_groups.read_at
      FROM duplicate_groups
      WHERE notification.id = duplicate_groups.keeper_id;

      WITH keepers AS (
        SELECT MAX(id) AS keeper_id, COALESCE(organization_id, 1) AS organization_id, user_id, type, title
        FROM notifications
        GROUP BY COALESCE(organization_id, 1), user_id, type, title
      )
      DELETE FROM notifications notification
      USING keepers
      WHERE COALESCE(notification.organization_id, 1) = keepers.organization_id
        AND notification.user_id = keepers.user_id
        AND notification.type = keepers.type
        AND notification.title = keepers.title
        AND notification.id <> keepers.keeper_id;

      DELETE FROM notifications
      WHERE read_at IS NOT NULL
        AND COALESCE(last_occurred_at, created_at) < NOW() - INTERVAL '90 days';

      CREATE INDEX IF NOT EXISTS idx_notifications_org_user_recent
        ON notifications (organization_id, user_id, last_occurred_at DESC);
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
      CREATE TABLE IF NOT EXISTS mdm_import_rows (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        batch_id INTEGER NOT NULL,
        row_number INTEGER NOT NULL,
        raw_data JSONB DEFAULT '{}'::jsonb,
        normalized_data JSONB DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'pending',
        duplicate_candidate BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_import_errors (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        batch_id INTEGER NOT NULL,
        row_id INTEGER,
        field_name TEXT,
        error_code TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT DEFAULT 'error',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_change_requests (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        domain TEXT NOT NULL,
        entity_id INTEGER,
        action TEXT NOT NULL,
        proposed_patch JSONB DEFAULT '{}'::jsonb,
        before_state JSONB,
        risk_level TEXT DEFAULT 'medium' NOT NULL,
        status TEXT DEFAULT 'draft' NOT NULL,
        submitted_by INTEGER,
        approved_by INTEGER,
        rejected_by INTEGER,
        reason TEXT,
        target_version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        decided_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS mdm_change_request_steps (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        change_request_id INTEGER NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        actor_id INTEGER,
        reason TEXT,
        before_state JSONB,
        after_state JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mdm_change_request_comments (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL DEFAULT 1,
        change_request_id INTEGER NOT NULL,
        comment TEXT NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
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
      DO $$
      DECLARE
        mdm_table TEXT;
      BEGIN
        FOREACH mdm_table IN ARRAY ARRAY[
          'mdm_legal_entities',
          'mdm_sites',
          'mdm_cost_centres',
          'mdm_supplier_documents',
          'mdm_supplier_contacts',
          'mdm_supplier_bank_accounts',
          'mdm_supplier_items',
          'mdm_item_categories',
          'mdm_uom_classes',
          'mdm_uom_conversions',
          'mdm_exchange_rates',
          'mdm_procurement_policies',
          'mdm_approval_rules',
          'mdm_document_sequences',
          'mdm_document_templates',
          'mdm_gl_mappings'
        ]
        LOOP
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS status TEXT', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by INTEGER', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by INTEGER', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS approved_by INTEGER', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT ''ISSSourcing''', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS external_reference TEXT', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP', mdm_table);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS archived_by INTEGER', mdm_table);
        END LOOP;
      END $$;
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
      ALTER TABLE purchase_requisition_items ALTER COLUMN item_id DROP NOT NULL;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS line_number INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG';
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_code_snapshot TEXT;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_description_snapshot TEXT;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS manual_entry_reason TEXT;
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS fulfilment_type TEXT NOT NULL DEFAULT 'GOODS_RECEIPT';
      ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS contract_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS incoterm_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'DRAFT';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES users(id);
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sourcing_award_id INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'NOT_SENT';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS dispatch_error TEXT;
      ALTER TABLE purchase_order_revisions ADD COLUMN IF NOT EXISTS organization_id INTEGER;
      UPDATE purchase_order_revisions r
      SET organization_id = po.organization_id
      FROM purchase_orders po
      WHERE po.id = r.order_id AND r.organization_id IS NULL;
      ALTER TABLE purchase_order_revisions ALTER COLUMN organization_id SET NOT NULL;
      CREATE INDEX IF NOT EXISTS purchase_order_revisions_org_order_idx
        ON purchase_order_revisions (organization_id, order_id, revision_number);
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
      ALTER TABLE purchase_order_items ALTER COLUMN item_id DROP NOT NULL;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_number INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG';
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_code_snapshot TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_description_snapshot TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS manual_entry_reason TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS fulfilment_type TEXT NOT NULL DEFAULT 'GOODS_RECEIPT';
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE invoice_items ALTER COLUMN item_id DROP NOT NULL;
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS purchase_order_item_id INTEGER REFERENCES purchase_order_items(id);
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG';
      ALTER TABLE approval_policies ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
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
      SELECT
        id,
        UPPER(COALESCE(NULLIF(slug, ''), 'DEFAULT')),
        name,
        COALESCE(NULLIF(default_currency_code, ''), 'ZAR'),
        COALESCE(NULLIF(country_code, ''), 'ZA')
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
      SELECT
        o.id,
        c.code,
        COALESCE(NULLIF(o.default_currency_code, ''), 'ZAR'),
        CASE
          WHEN UPPER(c.code) = UPPER(COALESCE(NULLIF(o.default_currency_code, ''), 'ZAR')) THEN 1
          ELSE c.exchange_rate_to_zar
        END,
        CASE
          WHEN UPPER(c.code) = UPPER(COALESCE(NULLIF(o.default_currency_code, ''), 'ZAR')) THEN 'organization-base'
          ELSE 'legacy-zar-master'
        END,
        DATE_TRUNC('day', NOW()),
        TRUE
      FROM organizations o
      CROSS JOIN currencies c
      WHERE COALESCE(o.active, TRUE) = TRUE
        AND COALESCE(c.active, TRUE) = TRUE
        AND (
          UPPER(c.code) = UPPER(COALESCE(NULLIF(o.default_currency_code, ''), 'ZAR'))
          OR UPPER(COALESCE(NULLIF(o.default_currency_code, ''), 'ZAR')) = 'ZAR'
        )
        AND COALESCE(c.exchange_rate_to_zar, 0) > 0
      ON CONFLICT (organization_id, from_currency_code, to_currency_code, effective_date) DO NOTHING;

      INSERT INTO mdm_procurement_policies (organization_id, code, name, policy_type, config, active)
      SELECT
        o.id,
        'RFQ-COMPETITION',
        'Competitive sourcing threshold',
        'sourcing',
        jsonb_build_object(
          'competitionRequired', TRUE,
          'competitionThreshold', CASE UPPER(COALESCE(o.country_code, 'ZA'))
            WHEN 'GB' THEN 2500
            WHEN 'US' THEN 3000
            ELSE 50000
          END,
          'minimumResponses', 3,
          'allowSoleSourceException', TRUE,
          'exceptionRequiresApproval', TRUE
        ),
        TRUE
      FROM organizations o
      WHERE COALESCE(o.active, TRUE) = TRUE
      ON CONFLICT (organization_id, code) DO NOTHING;

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
        COALESCE(NULLIF(s.default_currency_code, ''), NULLIF(o.default_currency_code, ''), 'ZAR'),
        TRUE
      FROM suppliers s
      JOIN organizations o ON o.id = s.organization_id
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
        (1, 'PURCHASE_ORDER', 'Default purchase order template', 'Supplier terms are governed by the selected payment terms and incoterms.', 'Generated from ISSSourcing Master Data & Control Centre.'),
        (1, 'GRN', 'Default goods receipt template', 'Receipt quantities are subject to warehouse inspection and tolerance policy.', 'Generated from ISSSourcing Master Data & Control Centre.')
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

  try {
    // Check if users table exists by trying to query it
    const userCount = await db.select().from(users).limit(1);
    console.log(`Database already initialized with tables existing`);
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

  await ensureSessionTable();
  await ensurePermissionResourceEnumValues();
  await ensureDefaultOrganization();
  await ensureOrganizationSubscriptionColumns();
  await ensureContractDateConstraint();
  await ensureSuppliersTaxIdColumn();
  await ensureTenantSecurityColumns();
  await ensureLegacyOrgIdColumnsForSeed();
  await pool.query(`
    WITH ranked_defaults AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY updated_at DESC NULLS LAST, id DESC) AS default_rank
      FROM warehouses
      WHERE is_default = TRUE
    )
    UPDATE warehouses SET is_default = FALSE, updated_at = NOW()
    WHERE id IN (SELECT id FROM ranked_defaults WHERE default_rank > 1);
    CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_org_default_uidx
      ON warehouses (organization_id) WHERE is_default = TRUE;
  `);
  await ensurePurchaseRequisitionsTables();
  await ensureProfessionalSupplyChainTables();
  await ensureStrategicSourcingTables();
  await ensureCommercialQuotationTables();

  return true;
}
