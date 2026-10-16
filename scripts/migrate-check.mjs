import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const { Client } = pg;

const fallbackDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/inventory_dev";
const composeFile = path.join("scripts", "runtime-compose.yml");
const composeProject = "isssourcing-migrate-check";

loadEnv({ path: ".env" });

function resolveDatabaseUrl() {
  if (process.env.MIGRATE_CHECK_DATABASE_URL) {
    return process.env.MIGRATE_CHECK_DATABASE_URL;
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;

  if (host && port && database && user) {
    const credentials = `${encodeURIComponent(user)}:${encodeURIComponent((password ?? "").replace(/^"(.*)"$/, "$1"))}`;
    return `postgresql://${credentials}@${host}:${port}/${database}`;
  }

  return fallbackDatabaseUrl;
}

function hasSqlMigrations() {
  const migrationsDir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return false;
  }

  return fs.readdirSync(migrationsDir).some((entry) => entry.endsWith(".sql"));
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function canConnect(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    await client.end().catch(() => {});
    return false;
  }
}

async function waitForDatabase(databaseUrl, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await canConnect(databaseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Database did not become ready for migrate:check.");
}

async function startFallbackDatabase() {
  try {
    await run("docker", ["compose", "-f", composeFile, "-p", composeProject, "up", "-d", "postgres"]);
    return { command: "docker", args: ["compose", "-f", composeFile, "-p", composeProject, "down", "-v"] };
  } catch (error) {
    throw new Error(
      `Unable to start fallback Postgres for migrate:check. Set DATABASE_URL or ensure Docker is available. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
}

function createTemporaryDatabaseName() {
  return `isssourcing_migrate_check_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

async function createTemporaryDatabase(baseDatabaseUrl, databaseName) {
  const client = new Client({ connectionString: baseDatabaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function dropTemporaryDatabase(baseDatabaseUrl, databaseName) {
  const client = new Client({ connectionString: baseDatabaseUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (!hasSqlMigrations()) {
  console.error("migrate:check requires at least one checked-in SQL migration in the migrations directory.");
  process.exit(1);
}

await run("node", ["scripts/validate-migrations.mjs"]);

const databaseUrl = resolveDatabaseUrl();
let cleanup = null;

if (!(await canConnect(databaseUrl))) {
  if (!process.env.DATABASE_URL && !process.env.MIGRATE_CHECK_DATABASE_URL) {
    cleanup = await startFallbackDatabase();
  }
}

const effectiveDatabaseUrl = cleanup ? fallbackDatabaseUrl : databaseUrl;
await waitForDatabase(effectiveDatabaseUrl);

const tempDatabaseName = createTemporaryDatabaseName();
const tempDatabaseUrl = new URL(effectiveDatabaseUrl);
tempDatabaseUrl.pathname = `/${tempDatabaseName}`;

try {
  await createTemporaryDatabase(effectiveDatabaseUrl, tempDatabaseName);
  await waitForDatabase(tempDatabaseUrl.toString());
  await run(
    "npm",
    ["run", "db:push:force"],
    {
      ...process.env,
      DATABASE_URL: tempDatabaseUrl.toString(),
    },
  );
  console.log("Migration check passed.");
} finally {
  await dropTemporaryDatabase(effectiveDatabaseUrl, tempDatabaseName).catch(() => {});
  if (cleanup) {
    await run(cleanup.command, cleanup.args).catch(() => {});
  }
}
