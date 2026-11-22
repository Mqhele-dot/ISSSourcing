#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const migrationName = process.argv[2];
if (!migrationName || path.basename(migrationName) !== migrationName || !migrationName.endsWith(".sql")) {
  throw new Error("Usage: node scripts/apply-sql-migration.mjs <migration-file.sql>");
}

const migrationPath = path.resolve("migrations", migrationName);
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Migration not found: migrations/${migrationName}`);
}

const connectionString = process.env.DATABASE_URL?.trim() ||
  (process.env.PGUSER && process.env.PGDATABASE
    ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD ?? "")}@${process.env.PGHOST ?? "127.0.0.1"}:${process.env.PGPORT ?? "5432"}/${encodeURIComponent(process.env.PGDATABASE)}?sslmode=${process.env.PGSSLMODE ?? "disable"}`
    : "");
if (!connectionString) {
  throw new Error("DATABASE_URL or PGUSER/PGDATABASE connection settings are required to apply a SQL migration.");
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(fs.readFileSync(migrationPath, "utf8"));
  await client.query("COMMIT");
  console.log(`Applied migrations/${migrationName}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
