import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import pg from "pg";
import { chromium } from "playwright";
import { assertDisposableE2eEnvironment } from "./e2e-database-guard.mjs";

const source = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"}`
  : undefined);
if (!source) throw new Error("Set DATABASE_URL or local PGHOST/PGUSER/PGPASSWORD before running the disposable browser gate.");
const ownerUrl = new URL(source);
if (!["localhost", "127.0.0.1", "[::1]"].includes(ownerUrl.hostname)) throw new Error("Disposable browser gate only creates databases on local PostgreSQL.");
ownerUrl.pathname = "/postgres";
const name = `iss_e2e_test_${randomUUID().replaceAll("-", "")}`;
if (!/^iss_e2e_test_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid test-owned database name.");
const testUrl = new URL(source);
testUrl.pathname = `/${name}`;
const env = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  TEST_DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
  ALLOW_COMMERCIAL_TEST_DB_INIT: "1",
  AUTO_SEED_ON_EMPTY_DB: "true",
  PLAYWRIGHT_REUSE_EXISTING_SERVER: "0",
  PLAYWRIGHT_EXTERNAL_DEV_SERVER: "0",
  DISABLE_NOTIFICATION_EMAIL: "true",
  DISABLE_NOTIFICATION_SMS: "true",
};
assertDisposableE2eEnvironment(env);

const owner = new pg.Client({ connectionString: ownerUrl.toString(), connectionTimeoutMillis: 5000 });
let created = false;
let exitCode = 1;
function run(script, specs = []) {
  if (specs.some((spec) => !/^e2e\/[A-Za-z0-9._/-]+\.spec\.ts$/.test(spec))) throw new Error("Invalid browser spec path.");
  const windows = process.platform === "win32";
  const child = spawnSync(windows ? "cmd.exe" : "npm", windows ? ["/d", "/s", "/c", `npm run ${script}${specs.length ? ` -- ${specs.join(" ")}` : ""}`] : ["run", script, ...(specs.length ? ["--", ...specs] : [])],
    { env, stdio: "inherit", shell: false });
  if (child.status !== 0) throw new Error(`${script} failed with exit code ${child.status ?? "unknown"}.`);
}
try {
  // Fail before creating/seeding a database when the browser runtime is unavailable.
  const browser = await chromium.launch({
    headless: true,
    ...(env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: env.PLAYWRIGHT_BROWSER_CHANNEL } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  await browser.close();
  await owner.connect();
  await owner.query(`CREATE DATABASE "${name}"`);
  created = true;
  console.log(`Created test-owned database ${name}. Current application database was not changed.`);
  run("db:push:force");
  run("db:init:commercial-test");
  run(process.argv.includes("--full") ? "test:e2e" : "test:e2e:small-business:direct", process.argv.filter((arg) => arg.endsWith(".spec.ts")));
  exitCode = 0;
} finally {
  try {
    if (created) {
      await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log(`Removed exact test-owned database ${name}; Playwright reports remain available.`);
    }
  } finally {
    await owner.end().catch(() => undefined);
  }
}
process.exitCode = exitCode;
