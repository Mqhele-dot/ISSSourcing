import { pool } from "../../db";

export async function initializeExportCenterData(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS export_history (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id),
      user_id INTEGER,
      dataset TEXT NOT NULL,
      format TEXT NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'completed',
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      row_count INTEGER,
      source_page TEXT,
      request_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id),
      created_by INTEGER,
      report_name TEXT NOT NULL,
      dataset TEXT NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      visible_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_format TEXT NOT NULL DEFAULT 'csv',
      source_page TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS export_history_org_created_idx
      ON export_history (organization_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS saved_reports_org_created_idx
      ON saved_reports (organization_id, created_at DESC);
  `);
}
