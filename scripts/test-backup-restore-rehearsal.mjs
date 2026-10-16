import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { verifyAuditChainWithClient } from "../server/services/audit-chain-service.ts";

const { Pool } = pg;
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) {
    return `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT ?? "5432"}/${process.env.PGDATABASE}`;
  }
  return "postgresql://postgres:postgres@localhost:5432/inventory_dev";
}

const sourceUrl = process.env.BACKUP_RESTORE_SOURCE_URL ?? resolveDatabaseUrl();
const targetUrl = process.env.BACKUP_RESTORE_TARGET_URL;
assert.ok(targetUrl, "BACKUP_RESTORE_TARGET_URL is required and must point to a disposable rehearsal database.");

const source = new URL(sourceUrl);
const target = new URL(targetUrl);
const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ""));
const sourceDatabase = decodeURIComponent(source.pathname.replace(/^\//, ""));
assert.notEqual(sourceUrl, targetUrl, "Backup source and restore target must be different databases.");
assert.match(targetDatabase, /(?:^|_)restore_rehearsal$/i, "Restore target database name must end in _restore_rehearsal.");
assert.doesNotMatch(targetDatabase, /prod(?:uction)?|staging/i, "Refusing a production-like or staging-like restore target.");
if (process.env.BACKUP_RESTORE_ALLOW_REMOTE_TARGET !== "1") {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(target.hostname), "Remote restore targets require BACKUP_RESTORE_ALLOW_REMOTE_TARGET=1.");
}

const requiredTables = ["organizations", "organization_members", "suppliers", "sourcing_events", "supplier_quotes", "sourcing_awards", "purchase_orders", "audit_logs"];
const criticalCountTables = ["organizations", "organization_members", "sourcing_events", "supplier_quotes", "sourcing_awards", "audit_logs"];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.once("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function adminUrl(url) {
  const value = new URL(url);
  value.pathname = "/postgres";
  return value.toString();
}

function quotedIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function recreateTargetDatabase() {
  const admin = new Pool({ connectionString: adminUrl(targetUrl) });
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [targetDatabase]);
    await admin.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(targetDatabase)}`);
    await admin.query(`CREATE DATABASE ${quotedIdentifier(targetDatabase)}`);
  } finally {
    await admin.end();
  }
}

async function dropTargetDatabase() {
  const admin = new Pool({ connectionString: adminUrl(targetUrl) });
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [targetDatabase]);
    await admin.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(targetDatabase)}`);
  } finally {
    await admin.end();
  }
}

async function tableCount(pool, table) {
  const result = await pool.query(`SELECT COUNT(*)::integer AS count FROM ${quotedIdentifier(table)}`);
  return result.rows[0].count;
}

async function verifyRestore() {
  const sourcePool = new Pool({ connectionString: sourceUrl });
  const targetPool = new Pool({ connectionString: targetUrl });
  try {
    const targetTables = await targetPool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const present = new Set(targetTables.rows.map((row) => row.table_name));
    assert.deepEqual(requiredTables.filter((table) => !present.has(table)), [], "Restored commercial schema is incomplete.");

    for (const table of criticalCountTables) {
      assert.equal(await tableCount(targetPool, table), await tableCount(sourcePool, table), `Restored row count differs for ${table}`);
    }

    const targetClient = await targetPool.connect();
    try {
      const organizations = await targetClient.query("SELECT id FROM organizations WHERE active = TRUE ORDER BY id");
      for (const organization of organizations.rows) {
        const verification = await verifyAuditChainWithClient(targetClient, organization.id);
        assert.equal(verification.valid, true, `Restored audit chain is invalid for organization ${organization.id}`);
      }
    } finally {
      targetClient.release();
    }
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

async function main() {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "isssourcing-backup-rehearsal-"));
  const dumpPath = path.join(tempDirectory, `${sourceDatabase}.dump`);
  let targetCreated = false;
  try {
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPath, sourceUrl]);
    await recreateTargetDatabase();
    targetCreated = true;
    await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", targetUrl, dumpPath]);
    await verifyRestore();
    console.log(`Backup/restore rehearsal passed: ${sourceDatabase} -> ${targetDatabase}`);
  } finally {
    if (targetCreated) await dropTargetDatabase().catch((error) => console.error("Failed to remove rehearsal target:", error));
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
